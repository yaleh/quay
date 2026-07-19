// Gate registry — name -> async gateFn(task, client) -> { ok, reason } (QENG-1).
//
// Ships exactly one gate, `dod`, a thin adapter over the existing `taskCheck`
// passthrough (`src/provider-client.js`), which itself routes to quay-native
// `store.js#check()`. This generalizes quay's already-shipped author->ready /
// execute->done gate into the first named engine gate — no gate logic is
// duplicated (proposal §"Gate registry + the `dod` gate").
//
// `dod` is status-relative (inherited from `check()`): it runs whichever gate
// matches the task's current status. See proposal §"Gate registry" and the
// QENG-1 fixtures for the reproducible contract.

/**
 * name -> async (task, client) => { ok: boolean, reason: string }
 * @type {Record<string, (task: any, client: any) => Promise<{ ok: boolean, reason: string }>>}
 */
export const gateRegistry = {
  dod: async (task, client) => {
    const r = await client.taskCheck(task.id); // reuse store.js#check() — no duplicate logic
    return { ok: r.ok === true, reason: r.reason };
  },
};

/** @returns {string[]} registered gate names */
export function listGates() {
  return Object.keys(gateRegistry);
}
