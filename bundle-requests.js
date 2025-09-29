import { foldChangeSets } from './folding';
import { sendRequest } from "./send-request.js";

// map from bundle key to bundle object
const bundles = {};

const getBundleKey = (entry, muSessionId, changeSets) => {
  const allowedGroups = changeSets[0].allowedGroups;
  // should bundle with session id and allowedGroups because SEAS sessions and
  // access rights should be respected when handling deltas
  // note: allowedGroups is a json formatted string and can be long or out of order
  // this means that in theory some requests will not be bundled that could be bundled
  // in practice this hasn't happened yet and would simply create two bundles instead of one
  // the total changeset over all bundles (multiple or one) would still be the same
  return `${entry.index}-${muSessionId}-${allowedGroups}`;
};

const executeBundledRequest = (bundleKey) => {
  const bundle = bundles[bundleKey];
  delete bundles[bundleKey];

  if (!bundle) {
    console.error(
      `Bundle for key ${bundleKey} unexpectedly got handled already.`
    );
    return;
  }

  const foldedChangeSets = foldChangeSets(bundle.entry, bundle.changeSets);

  sendRequest(
    bundle.entry,
    foldedChangeSets,
    bundle.muCallIdTrail,
    bundle.muSessionId,
    {
      "mu-bundled-call-id-trails": bundle.bundledCallIdTrails.join(","),
    }
  );
};

export const sendBundledRequest = (
  entry,
  changeSets,
  muCallIdTrail,
  muSessionId
) => {
  const bundleKey = getBundleKey(entry, muSessionId, changeSets);
  const existingBundle = bundles[bundleKey];

  if (existingBundle) {
    // change sets in bundle are simply added to the existing bundle, have client remove noops from it if desired
    // as we don't know if noops are of interest to the client and we shouldn't judge
    existingBundle.changeSets = [
      ...bundles[bundleKey].changeSets,
      ...changeSets,
    ];
    existingBundle.bundledCallIdTrails.push(muCallIdTrail);
    // since an existing bundle exists, we don't need to send it after timeout,
    // the existing bundle will send us too
    if (process.env["DEBUG_DELTA_SEND"]) {
      console.log(
        `Adding to bundle for key ${bundleKey}, now contains ${existingBundle.changeSets.length} change sets`
      );
    }
  } else {
    if (process.env["DEBUG_DELTA_SEND"]) {
      console.log(
        `Creating bundle for key ${bundleKey}, sending in ${entry.options.gracePeriod}ms`
      );
    }
    bundles[bundleKey] = {
      entry,
      changeSets,
      muCallIdTrail,
      muSessionId,
      bundledCallIdTrails: [],
    };
    setTimeout(
      () => executeBundledRequest(bundleKey),
      entry.options.gracePeriod
    );
  }
};
