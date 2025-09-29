import http from "http";
import { uuid } from "mu";

const DEFAULT_RETRY_TIMEOUT = 250;

function formatChangesetBody(changeSets, options) {
  if (options.resourceFormat == "v0.0.1") {
    return JSON.stringify(
      changeSets.map((change) => {
        return {
          inserts: change.insert,
          deletes: change.delete,
        };
      })
    );
  }
  if (options.resourceFormat == "v0.0.0-genesis") {
    // [{delta: {inserts, deletes}]
    const newOptions = Object.assign({}, options, { resourceFormat: "v0.0.1" });
    const newFormat = JSON.parse(formatChangesetBody(changeSets, newOptions));
    return JSON.stringify({
      // graph: Not available
      delta: {
        inserts: newFormat
          .flatMap(({ inserts }) => inserts)
          .map(({ subject, predicate, object }) => ({
            s: subject.value,
            p: predicate.value,
            o: object.value,
          })),
        deletes: newFormat
          .flatMap(({ deletes }) => deletes)
          .map(({ subject, predicate, object }) => ({
            s: subject.value,
            p: predicate.value,
            o: object.value,
          })),
      },
    });
  } else {
    throw `Unknown resource format ${options.resourceFormat}`;
  }
}

const handleResponse = async (
  response,
  entry,
  changeSets,
  muCallIdTrail,
  muSessionId,
  extraHeaders,
  retriesLeft
) => {
  if (response.ok) {
    // currently no need to act on a successful response
    return;
  }

  const { method, url } = entry.callback;
  console.log(
    `Call to ${method} ${url} likely failed. Received status ${response.status}.`
  );

  if (retriesLeft === 0 || (response.status && response.status < 500)) {
    console.log(`NOT RETRYING`);
    return;
  }

  retriesLeft = retriesLeft - 1;
  console.log(`RETRYING (${retriesLeft} left)`);
  // in this case we want to retry, our error handling will deal with this.
  await new Promise((resolve) =>
    setTimeout(resolve, entry.retryTimeout || DEFAULT_RETRY_TIMEOUT)
  );
  await sendRequest(
    entry,
    changeSets,
    muCallIdTrail,
    muSessionId,
    extraHeaders,
    retriesLeft
  );
};

export async function sendRequest(
  entry,
  changeSets,
  muCallIdTrail,
  muSessionId,
  extraHeaders = {},
  retriesLeft = undefined
) {
  if (changeSets.length) {
    if (retriesLeft === undefined) {
      retriesLeft = entry.options?.retry || 0;
    }

    // construct the requestObject
    const method = entry.callback.method;
    const url = entry.callback.url;
    const headers = {
      ...extraHeaders,
      "Content-Type": "application/json",
      "mu-call-id-trail": muCallIdTrail,
      "mu-call-id": uuid(),
      "mu-session-id": muSessionId,
    };

    if (changeSets[0].allowedGroups) {
      headers["MU-AUTH-ALLOWED-GROUPS"] = changeSets[0].allowedGroups;
    }

    let body;
    if (entry.options && entry.options.resourceFormat) {
      // we should send contents
      body = formatChangesetBody(changeSets, entry.options);
    }
    if (process.env["DEBUG_DELTA_SEND"])
      console.log(`Executing send ${method} to ${url}`);
    try {
      const keepAliveAgent = new http.Agent({
        keepAlive: true,
      });
      const response = await fetch(url, {
        method,
        headers,
        body,
        agent: keepAliveAgent,
      });
      await handleResponse(
        response,
        entry,
        changeSets,
        muCallIdTrail,
        muSessionId,
        extraHeaders,
        retriesLeft
      );
    } catch (error) {
      console.log(error);
    }
  } else {
    if (process.env["DEBUG_DELTA_SEND"] || process.env["DEBUG_DELTA_NOT_SENDING_EMPTY"])
      console.log(`Changeset empty. Not sending to ${entry.callback.method} ${entry.callback.url}`);
  }
}
