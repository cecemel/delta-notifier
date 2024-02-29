import { app, uuid } from 'mu';
import services from './config/rules';
import bodyParser from 'body-parser';
import dns from 'dns';
import http from 'http';

// Log server config if requested
if( process.env["LOG_SERVER_CONFIGURATION"] )
  console.log(JSON.stringify( services ));

app.get( '/', function( req, res ) {
  res.status(200);
  res.send("Hello, delta notification is running");
} );

app.post( '/', bodyParser.json({limit: '500mb'}), function( req, res ) {
  if( process.env["LOG_REQUESTS"] ) {
    console.log("Logging request body");
    console.log(req.body);
  }

  const changeSets = req.body.changeSets;

  const originalMuCallIdTrail = JSON.parse( req.get('mu-call-id-trail') || "[]" );
  const originalMuCallId = req.get('mu-call-id');
  const muCallIdTrail = JSON.stringify( [...originalMuCallIdTrail, originalMuCallId] );
  const muSessionId = req.get('mu-session-id');

  const muCallScopeId = req.get('mu-call-scope-id');

  changeSets.forEach( (change) => {
    change.insert = change.insert || [];
    change.delete = change.delete || [];
  } );

  // inform watchers
  informWatchers( changeSets, res, muCallIdTrail, muSessionId, muCallScopeId );

  // push relevant data to interested actors
  res.status(204).send();
} );


async function informWatchers( changeSets, res, muCallIdTrail, muSessionId, muCallScopeId ){
  services.map( async (entry) => {
    // for each entity
    if( process.env["DEBUG_DELTA_MATCH"] )
      console.log(`Checking if we want to send to ${entry.callback.url}`);

    const matchSpec = entry.match;

    let originFilteredChangeSets = filterMatchesForMuScopeId( changeSets, entry, muCallScopeId );

    if(originFilteredChangeSets.length ){
      originFilteredChangeSets = await filterMatchesForOrigin( originFilteredChangeSets, entry );
      if( process.env["DEBUG_TRIPLE_MATCHES_SPEC"] && entry.options.ignoreFromSelf )
        console.log(`There are ${originFilteredChangeSets.length} changes sets not from ${hostnameForEntry( entry )}`);

      let allInserts = [];
      let allDeletes = [];

      originFilteredChangeSets.forEach( (change) => {
        allInserts = [...allInserts, ...change.insert];
        allDeletes = [...allDeletes, ...change.delete];
      } );

      const changedTriples = [...allInserts, ...allDeletes];

      const someTripleMatchedSpec =
          changedTriples
            .some( (triple) => tripleMatchesSpec( triple, matchSpec ) );

      if( process.env["DEBUG_TRIPLE_MATCHES_SPEC"] )
        console.log(`Triple matches spec? ${someTripleMatchedSpec}`);
      if( someTripleMatchedSpec ) {
        // inform matching entities
        if( process.env["DEBUG_DELTA_SEND"] )
          console.log(`Going to send ${entry.callback.method} to ${entry.callback.url}`);

        if( entry.options && entry.options.gracePeriod ) {
          setTimeout(
            () => sendRequest( entry, originFilteredChangeSets, muCallIdTrail, muSessionId ),
            entry.options.gracePeriod );
        } else {
          sendRequest( entry, originFilteredChangeSets, muCallIdTrail, muSessionId );
        }
      }
    }
  } );
}

function tripleMatchesSpec( triple, matchSpec ) {
  // form of triple is {s, p, o}, same as matchSpec
  if( process.env["DEBUG_TRIPLE_MATCHES_SPEC"] )
    console.log(`Does ${JSON.stringify(triple)} match ${JSON.stringify(matchSpec)}?`);

  for( let key in matchSpec ){
    // key is one of s, p, o
    const subMatchSpec = matchSpec[key];
    const subMatchValue = triple[key];

    if( subMatchSpec && !subMatchValue )
      return false;

    for( let subKey in subMatchSpec )
      // we're now matching something like {type: "url", value: "http..."}
      if( subMatchSpec[subKey] !== subMatchValue[subKey] )
        return false;
  }
  return true; // no false matches found, let's send a response
}


function formatChangesetBody( changeSets, options ) {
  if( options.resourceFormat == "v0.0.1" ) {
    return JSON.stringify(
      changeSets.map( (change) => {
        return {
          inserts: change.insert,
          deletes: change.delete
        };
      } ) );
  }
  if( options.resourceFormat == "v0.0.0-genesis" ) {
    // [{delta: {inserts, deletes}]
    const newOptions = Object.assign({}, options, { resourceFormat: "v0.0.1" });
    const newFormat = JSON.parse( formatChangesetBody( changeSets, newOptions ) );
    return JSON.stringify({
      // graph: Not available
      delta: {
        inserts: newFormat
          .flatMap( ({inserts}) => inserts)
          .map( ({subject,predicate,object}) =>
                ( { s: subject.value, p: predicate.value, o: object.value } ) ),
        deletes: newFormat
          .flatMap( ({deletes}) => deletes)
          .map( ({subject,predicate,object}) =>
                ( { s: subject.value, p: predicate.value, o: object.value } ) )
      }
    });
  } else {
    throw `Unknown resource format ${options.resourceFormat}`;
  }
}

async function sendRequest( entry, changeSets, muCallIdTrail, muSessionId ) {
  let requestObject; // will contain request information

  // construct the requestObject
  const method = entry.callback.method;
  const url = entry.callback.url;
  const headers = { "Content-Type": "application/json", "MU-AUTH-ALLOWED-GROUPS": changeSets[0].allowedGroups, "mu-call-id-trail": muCallIdTrail, "mu-call-id": uuid() , "mu-session-id": muSessionId };

  let body;
  if( entry.options && entry.options.resourceFormat ) {
    // we should send contents
    body = formatChangesetBody( changeSets, entry.options );
  }
  if( process.env["DEBUG_DELTA_SEND"] )
    console.log(`Executing send ${method} to ${url}`);
  try {
    const keepAliveAgent = new http.Agent({
      keepAlive: true
    });
    const response = await fetch(url, { method, headers, body, agent: keepAliveAgent });
    if (!response.ok) {
      console.log(`Call to ${method} ${url} likely failed. Received status ${response.status}.`);
    }
  } catch(error) {
    console.log(`Could not send request ${method} ${url}`);
    console.log(error);
    console.log(`NOT RETRYING`); // TODO: retry a few times when delta's fail to send
  }
}

async function filterMatchesForOrigin( changeSets, entry ) {
  if( ! entry.options || !entry.options.ignoreFromSelf ) {
    return changeSets;
  } else {
    try {
      const originIpAddress = await getServiceIp( entry );
      return changeSets.filter( (changeSet) => changeSet.origin != originIpAddress );
    } catch(e) {
      console.error(`Could not filter changeset because an error was returned while looking up ip for ${entry.callback.url}`);
      console.error(e);
      return changeSets;
    }
  }
}

function filterMatchesForMuScopeId( changeSets, entry, muCallScopeId ){
  if( !muCallScopeId ){
    return changeSets;
  }
  //Note: if optIn and optOut are configured at the same time, optIn wins.
  else if( hasConfiguredMuScopeOptIn(entry) ){
    if( entry.options.optInMuScopeIds.indexOf(muCallScopeId) > -1 ){
      return changeSets;
    }
    else return [];
  }
  else if( hasConfiguredMuScopeOptOut(entry) ){
    if( entry.options.optOutMuScopeIds.indexOf(muCallScopeId) > -1 ){
      return [];
    }
    else return changeSets;
  }
  else {
    return changeSets;
  }
}

function hasConfiguredMuScopeOptOut( entry ){
  return entry.options && entry.options.optOutMuScopeIds && entry.options.optOutMuScopeIds.length;
}

function hasConfiguredMuScopeOptIn( entry ){
  return entry.options && entry.options.optInMuScopeIds && entry.options.optInMuScopeIds.length;
}

function hostnameForEntry( entry ) {
  return (new URL(entry.callback.url)).hostname;
}

async function getServiceIp(entry) {
  const hostName = hostnameForEntry( entry );
  return new Promise( (resolve, reject) => {
    dns.lookup( hostName, { family: 4 }, ( err, address) => {
      if( err )
        reject( err );
      else
        resolve( address );
    } );
  } );
};
