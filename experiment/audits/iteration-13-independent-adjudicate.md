# Iteration 13 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh `general-purpose` subagent, zero prior context, instructed not to read the same-session self-check.

**Verdict: PASS**

## Findings

1. **QN-027 fix is real.** `git show c4da786^:packages/quay/src/provider-client.js` (and `quay.js`) confirmed no `taskCheck`/`task check` passthrough existed pre-fix. Live: `quay-native task check QN-001 --json` vs `quay task check QN-001 --json` produced byte-identical JSON. QN-017 (`needs-human`) → `FAIL — soft stop; human action required`, exit 1; QN-001 → `PASS — terminal`, exit 0. Matches claims exactly.

2. **Regression suite: 12/12 pass**, independently re-run in full — identical file set and pass count as claimed.

3. **Scope confirmed via `git diff --stat c4da786^ c4da786`**: only the 7 claimed files changed (`README.md`, `iteration-13.md`, `provenance.md`, `quay.js`, `provider-client.js`, `task-check.test.mjs`, `QN-027.md`). No `store.js`/`mcp-server.js`/gate logic touched — matches QN-027's own stated constraint.

4. **σ arithmetic recomputed independently**: 19/26=0.7308, 21/26=0.8077, 25/26=0.9615 — all match. 26 `QN-*.md` files confirmed via `ls` (QN-001..QN-027, minus QN-018).

5. **V_instance/V_meta**: confirmed product formula in protocol §5.1/§5.2 (not mean). Recomputed: V_instance = 0.60×0.94×0.75×0.94 = 0.3976 ✓; V_meta = 0.74×0.20×0.60×0.64 = 0.0568 ✓. Both match exactly.

6. **Fabrication check — no red flags.** The report explicitly declines to self-credit the `validation` (V_meta) component, deferring to this independent audit — a self-limiting, non-inflationary move. It discloses (rather than hides) a provenance irregularity: QN-027's status was set via direct file edit, not a CLI round-trip. Language throughout is concrete and falsifiable.

7. **`experiment/directives/pending/` confirmed empty** via direct `ls`.

## One item outside independent reproduction (flagged explicitly, not silently passed)

The claim that this iteration's own dispatched session independently found the manda `Agent`/`Dispatch` tools live and ran a second real end-to-end dispatch cycle (recorded in `experiment/directives/README.md`, appended after DIR-004's section) could not be re-run by the auditor (no manda tool access in that subagent's own session). The auditor assessed textual/evidentiary plausibility instead: the README section exists exactly where claimed, is internally consistent with iteration-13.md's own transcript, and mirrors DIR-004's documented methodology and caveats (manual claim via CLI, no live auto-pickup within the test window) rather than overclaiming a fully autonomous handoff. Reads as plausible, not fabricated — but this is a plausibility assessment, not a reproduction, and is recorded as such rather than glossed over.

## Net assessment
No fabrication or overclaiming found on any independently-checkable claim. QN-027 closes a real, previously-silent ABI-symmetry gap (`task_check` had never been exercised through Core's provider-agnostic client despite 12+ iterations of scoring `abi_symmetry` at 0.90-0.92). σ, V_instance, V_meta, and scope-discipline claims all reproduce exactly from primary evidence. The one unverifiable claim (second live dispatch cycle from within the dispatched session) is explicitly flagged rather than either accepted or rejected outright — consistent with this experiment's established practice of hedging claims that can't be independently reproduced.
