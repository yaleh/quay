// sha256.ts — the ONE sha256 helper pair (`sha256OfString` / `sha256OfBuffer`), a plugin-scripts
// leaf. Both bodies are `createHash("sha256").update(...).digest("hex")`; the only difference is
// whether the input is a UTF-8 string or an already-encoded Buffer.
//
// WHY THIS LEAF EXISTS (`.quay/routine-findings.jsonl` finding `B1`, routine `semantic-dedup-scan`,
// runId `semantic-dedup-scan-1793491958069`, 2026-11-01): SEVEN independently-declared wrappers
// across six files all reduced to the same 1-2 line createHash('sha256') body —
//   · `plugin/scripts/experiment-manifest.ts`   `sha256Hex`                    (string)
//   · `plugin/scripts/proposal-convergence.ts`  `sha256`                       (string)
//   · `plugin/scripts/execution-policy.ts`      `sha256OfString`               (string)
//   · `plugin/scripts/stage-receipt.ts`         `sha256OfBuffer` / `sha256OfString`
//   · `plugin/scripts/run-identity.ts`          `sha256OfBuffer`
//   · `plugin/scripts/primitives-drift-check.ts` `sha256OfBuffer`
// ~30 repo-wide call sites. Every caller is a `plugin/scripts/*.ts` gate/instrument, so the leaf
// lives in this directory rather than `packages/quay/src/kernel/`: no `packages/**` caller needs it,
// and a `packages/**` → `plugin/**` edge would be a reverse edge (import-graph-check ratchet).
//
// NOT A CHECKER, NOT AN INSTRUMENT: it answers no question of its own and is deliberately absent
// from the capability catalog's QUESTION table — it is a primitive consumed by instruments that do.

import { createHash } from "node:crypto";

/** SHA-256 of a UTF-8 string, lowercase hex. */
export function sha256OfString(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** SHA-256 of a Buffer, lowercase hex. */
export function sha256OfBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
