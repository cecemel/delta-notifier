export default [
  {
    match: {
      // form of element is {subject,predicate,object}
      predicate: { type: "uri", value: "http://www.semanticdesktop.org/ontologies/2007/03/22/nmo#isPartOf" }
    },
    callback: {
      uri: "http://maildelivery/send", method: "PATCH"
    }
  },
  {
    match: {
      // react to any subject
      subject: {}
    },
    callback: {
      url: 'http://resource/.mu/delta',
      method: 'POST'
    },
    options: {
      // use the v0.0.1 format
      resourceFormat: 'v0.0.1',
      // bundle deltas for 10s after the first delta that comes in
      gracePeriod: 10000,
      // retry at most 3 times
      retry: 3,
      // wait 250ms before retrying
      retryTimeout: 250,
      // fold sequences of deleted/inserted quads that don't have any effect
      foldEffectiveChanges: true,
      // don't react to deltas from self
      ignoreFromSelf: true
    }
  }
];
