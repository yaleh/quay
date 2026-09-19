// `makeDocumentContractGate` — document-as-contract enforcement gate factory (D1).
//
// The SAME "continuously applied" shape as `makeAdrGate`, but for the `document`
// object kind: a document's `contracts` check its OWN live body content
// in-process (`contract-validator.ts#validateContracts`), no external shell-out.

import type { GateFn } from "../types.ts";
import { createDocumentStore } from "../../document-store.ts";
import { validateContracts } from "../../contract-validator.ts";
import type { Task } from "../../abi.ts";

/**
 * D1 — document-as-contract enforcement: wire a managed document carrying
 * `contracts` as a named `doc-<id>` gate. In-process validation via
 * `validateContracts` (no external shell-out). Fails closed when the document
 * is missing or has no (or empty) `contracts` — an unenforceable document must
 * never silently PASS, mirroring an ADR with no `enforcement` command.
 */
export function makeDocumentContractGate(docId: string, docDir: string): GateFn {
  return async (_task: Task) => {
    const store = createDocumentStore(docDir);
    const doc = store.get(docId);
    if (!doc) {
      return { ok: false, reason: `no such document: ${docId}` };
    }
    if (!Array.isArray(doc.contracts) || doc.contracts.length === 0) {
      return {
        ok: false,
        reason: `${docId} has no contracts defined (set its \`contracts:\` frontmatter field to a non-empty list of self-checks)`,
      };
    }
    const { ok, results } = validateContracts(doc);
    if (ok) return { ok: true, reason: `all ${results.length} contract(s) passed` };
    const failed = results.filter((r: { ok: boolean; reason?: string; pattern?: string; type?: string }) => !r.ok);
    const reason = failed
      .map((r: { ok: boolean; reason?: string; pattern?: string; type?: string }) => r.reason ?? `pattern ${JSON.stringify(r.pattern)} (${r.type}) failed`)
      .join("; ");
    return { ok: false, reason };
  };
}
