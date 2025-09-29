/**
 * Quads may be folded if
 * - a quad is deleted after it has been inserted
 * - a quad is inserted after it has been deleted
 *
 * Assumption: DELETE queries are always executed before INSERT queries.
 *   Therefore we handle deleted quads always before inserted quads.
 */
export function foldChangeSets(entry, changeSets) {
  if (entry.options?.foldEffectiveChanges) {
    // Create database
    const foldedDelete = {};
    const foldedInsert = {};

    // Process changeSets
    changeSets.forEach((changeSet) => {
      const { effectiveDelete, effectiveInsert } = changeSet;

      // Fold deleted quads if they have been inserted before
      effectiveDelete.forEach((quad) => {
        const key = JSON.stringify(quad);
        if (foldedInsert[key])
          delete foldedInsert[key];
        else
          foldedDelete[key] = quad;
      });

      // Do the inverse of effectiveDelete
      effectiveInsert.forEach((quad) => {
        const key = JSON.stringify(quad);
        if (foldedDelete[key])
          delete foldedDelete[key];
        else
          foldedInsert[key] = quad;
      });
    });

    // Collect resulting values
    const foldedChangeSets = [];
    const foldedDeleteQuads = Object.values(foldedDelete);
    if (foldedDeleteQuads.length)
      foldedChangeSets.push({ delete: foldedDeleteQuads, insert: [] });
    const foldedInsertQuads = Object.values(foldedInsert);
    if (foldedInsertQuads.length)
      foldedChangeSets.push({ delete: [], insert: foldedInsertQuads });

    if (process.env["DEBUG_DELTA_FOLD"])
      console.log(`Folded changeset from:\n ${JSON.stringify(changeSets)}\nto:\n ${JSON.stringify(foldedChangeSets)}`);

    return foldedChangeSets;
  } else {
    return changeSets;
  }
}
