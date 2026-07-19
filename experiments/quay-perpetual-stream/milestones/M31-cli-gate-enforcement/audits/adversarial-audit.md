# Adversarial audit — M31-cli-gate-enforcement (post-merge)

**Auditor:** fresh-context adversarial auditor, no prior involvement in this milestone.
**Scope:** the MERGED state on `exp5-outer-driver` at commit `8b3af67` (and its parent chain), not
either iteration's pre-merge worktree state.

## VERDICT: NO REFUTATION FOUND

No claim made by iteration-0, iteration-1, or the outer loop's merge-resolution commit message was
found to be false under live, independent re-verification. One CONCERNS item is noted below
(non-blocking).

**CONCERNS:**
1. The merge commit message's claim that the surviving gate-check placement "also gates a combined
   `--append-notes` + `--status` write" was **not covered by any existing automated test** in either
   iteration's test files, nor in the merged `cli.test.mjs`. I constructed a live fixture and
   confirmed the claim is true (see item 5 below), but this is a real, if minor, test-coverage gap:
   a regression here (e.g. someone later moving the gate-check block after the `--append-notes`
   early-return) would not be caught by the current suite. Recommend a follow-up test, not a
   milestone re-open.

---

## 1. Single gate-check block; placement; shared logic with `task check`

Read `packages/quay/bin/quay.js` `task edit` handler directly (current HEAD).

- **Exactly one gate-check block** exists, at line 564:
  ```js
  if (enforceGate && patch.status !== undefined) {
    const gateResult = await client.taskCheck(id);
    if (gateResult.ok === false) {
      console.error(`quay task edit: --enforce-gate refused this write — gate check failed: ${gateResult.reason}`);
      process.exitCode = 1;
      return;
    }
  }
  ```
- **Fires when `--enforce-gate` is present AND `patch.status !== undefined`** — confirmed by reading
  the condition literally (`enforceGate` is set from `flags["enforce-gate"] !== undefined` at line
  512; `patch.status` is only populated if `--status` was passed, per line 522).
- **Placement confirmed BEFORE the `--append-notes` branch**: gate-check block is lines 564-573;
  `--append-notes` branch begins at line 580. Order in source matches the merge commit message's
  claim exactly.
- **Calls `client.taskCheck(id)`** — the identical function `task check`'s own handler calls (line
  644: `result = await client.taskCheck(id);`). Read `provider-client.js`: `taskCheck` (line 60) is a
  single implementation, generic MCP `task_check` passthrough — no divergent/duplicated gate logic
  exists anywhere in the CLI or client layer.

Finding: **claim confirmed true**, no discrepancy from the merge commit's description.

## 2. Syntax check

```
$ node -c packages/quay/bin/quay.js
(exit 0, no output)
```
Confirmed clean.

## 3. No duplicate handler

```
$ grep -n 'sub === "edit"' packages/quay/bin/quay.js
482:  if (cmd === "task" && sub === "edit") {
```
Exactly one match. Confirmed.

## 4. Tests run live

```
$ node --test packages/quay/test/gap-cli-gate-enforcement.test.mjs packages/quay/test/cli.test.mjs
...
✔ packages/quay/test/cli.test.mjs (64268.830242ms)
✔ RED->GREEN: task edit <id> --status done --enforce-gate refuses when the execute->done gate fails, surfacing result.reason (2899.314859ms)
✔ task edit <id> --status done --enforce-gate succeeds when the gate passes (identical to unguarded write) (2687.840346ms)
✔ task edit <id> --status done WITHOUT --enforce-gate still writes unconditionally (zero regression to default/unguarded behavior) (2451.976945ms)
✔ --enforce-gate with a non-status patch (--labels only) is a no-op guard: write proceeds even though the gate would fail (2005.664262ms)
✔ --help documents both default-unguarded task edit status behavior and --enforce-gate (415.111629ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
```
(`gap-cli-gate-enforcement.test.mjs` has 5 top-level `test(...)` calls, confirmed via
`grep -c "^test("`; node's runner reports "tests 6" — likely counting an internal harness/suite
node differently, not a hidden failure; all reported are `pass`.) `cli.test.mjs` reports its own
internal "All ... tests passed" summary and exits with a single passing top-level test. Both files:
0 failures. Confirmed, not just trusted from a pasted transcript.

Also ran the fuller suite for context:
```
$ node --test packages/quay/test/*.test.mjs packages/quay-native/test/*.test.mjs
...
✖ packages/quay/test/provider-abi-conformance.test.mjs (parallel-run only)
✖ packages/quay/test/serve-github.test.mjs
```
Re-ran both in isolation:
- `provider-abi-conformance.test.mjs` alone: **23/23 scenario cells pass**, 1/1 top-level test PASS —
  confirms this was parallel-run GitHub-API contention, not a real failure, matching iteration-1's own
  claim.
- `serve-github.test.mjs` alone: **still fails**, 2 assertions (`GET /` body missing live `gh-3` task
  and its title) — a live-GitHub-repo-state/listing-page issue, unrelated to `task edit`/gate logic
  (the failing assertions are about the task list page, not edit or check). Matches the merge commit's
  characterization of this as a pre-existing, unrelated flake.

## 5. Adversarial probes (live, scratch `/tmp` workspace only — real repo `tasks/` never touched)

All probes used a disposable `mkdtemp()`-based native-provider workspace, following the same pattern
as `gap-cli-gate-enforcement.test.mjs`. Full script executed and then deleted; scratch dirs removed
after each probe.

**Probe A — combined `--append-notes` + `--status done` + `--enforce-gate` against a gate-failing
`ready` task (unchecked AC/DoD box):**
```
PRE-CHECK gate status: {"ok": false, "reason": "0/1 AC checkboxes checked", ...}
COMBO edit result: status= 1
COMBO stderr: quay task edit: --enforce-gate refused this write — gate check failed: 0/1 AC checkboxes checked
AFTER view: status still "ready", body unchanged (no "probe note" appended)
Write refused (status still 'ready', no note appended)? true
```
**Confirmed true, live**: the merge's specific claim that this placement "also gates a combined
`--append-notes` + `--status` write" holds. This exact scenario had **zero test coverage** in either
iteration's files or the merged `cli.test.mjs` before this audit (see CONCERNS above) — the merge
commit's reasoning here was correct but was previously unverified by any automated test.

**Probe B — `--enforce-gate` + `--expect-status` (CAS) interaction, Case A: gate fails AND CAS would
also fail:**
```
CASE A exit: 1
CASE A stderr: quay task edit: --enforce-gate refused this write — gate check failed: 0/1 AC checkboxes checked
CASE A after: status still "ready" (no write)
```
Gate-check runs first (before `taskWrite`, hence before CAS is ever evaluated) — the gate's own clean,
prefixed error message wins. No misleading double-error or CAS-error masking a gate-error.

**Probe B — Case B: gate PASSES, CAS fails (wrong `--expect-status`):**
```
CASE B pre-check: {"ok": true, "reason": "all AC checkboxes checked; eligible to move to done"}
CASE B exit: 1
CASE B stderr: Error: CAS conflict: CAS conflict on CAS-2: expected status "WRONG-STATUS" but actual
  current status is "ready" — another writer changed it first; refusing to overwrite (write() aborted,
  nothing written to disk)
    at Object.taskWrite (.../provider-client.js:50:26) ...
CASE B after: status still "ready" (write refused by CAS, not the gate)
```
Ordering assessment: gate-check (clean, purpose-built error, exit 1) runs first; if it passes, the
generic `taskWrite` CAS check runs second, throwing an uncaught `ConflictError` that propagates through
`main()`'s outer `.catch`, printed with a full stack trace. The two error presentations differ in style
(clean one-liner vs. stack trace) but neither is misleading — the CAS error's own message text is
self-contained and accurate (`"expected status ... but actual current status is ..."`). The ordering
(gate first, then CAS) is sensible: it means a caller who fails BOTH checks sees the gate's reason
first, which is the more actionable/domain-specific of the two. No bug found; this is a legitimate,
if slightly stylistically inconsistent (stack-trace vs. clean-error), non-blocking observation, not a
refutation.

**Repo-root `tasks/` directory integrity:** confirmed untouched before and after all probes:
```
$ git -C /home/yale/work/quay status --short -- tasks/
(no output)
```
All scratch fixtures used `/tmp/quay-audit-*` mkdtemp directories with `QUAY_NATIVE_TASKS_DIR`
pointed at them; none touched `/home/yale/work/quay/tasks/`.

## 6. Done-when clauses — re-verified against MERGED code

1. **MET.** Live-reproduced: `task edit COMBO-1/CAS-1 --status done --enforce-gate` against a
   gate-failing fixture (unchecked AC/DoD) refuses, exit 1, `result.reason` surfaced, no write
   performed (see Probe A/B-CaseA above; also `gap-cli-gate-enforcement.test.mjs` test 1, re-run live).
2. **MET.** `gap-cli-gate-enforcement.test.mjs` test 2 and `cli.test.mjs` 4b-iii re-run live, pass:
   gate-passing transition succeeds, same output shape.
3. **MET.** `gap-cli-gate-enforcement.test.mjs` test 3 and `cli.test.mjs` 4b-ii re-run live, pass:
   without `--enforce-gate`, the SAME gate-failing fixture writes successfully (unguarded default
   preserved).
4. **MET.** Option (b) (explicit no-op without `--status`) implemented — confirmed by reading
   `patch.status !== undefined` as the sole condition, and by `cli.test.mjs` 4b-iv /
   `gap-cli-gate-enforcement.test.mjs` test 4, re-run live, passing.
5. **MET.** `--help` output re-run live: confirms both `--enforce-gate` synopsis presence and full
   "UNGUARDED ... analogous to 'git commit --no-verify'" explanatory text (`--help` transcript captured
   directly in this audit, see section above). `cli.test.mjs` lines 972-976 assert both substrings.
6. **MET.** Inline code comment present immediately above the merged gate-check block (lines 542-563
   of current `quay.js`), explaining the unguarded-by-default decision, the `--no-verify` analogy, the
   reuse-not-duplicate rationale, the Done-when-4 option-(b) choice, the `--append-notes` placement
   rationale, and a pointer to the charter file.
7. **MET.** Skill-doc cross-reference independently re-checked: grepped
   `.claude/skills/quay-native-methodology/examples/quay-author-SKILL.md` and
   `.../quay-execute-SKILL.md` directly — both already document a manual "gate: task check, THEN task
   edit --status" two-step workflow, consistent with (not contradicted by) the unguarded-by-default +
   opt-in-`--enforce-gate` decision. No staleness found by this auditor either — confirms iteration-1's
   "confirmed-already-accurate" finding independently.
8. **MET, with the same caveat both iterations documented.** `cli.test.mjs` and
   `gap-cli-gate-enforcement.test.mjs` are 100% green, re-run live by this auditor, not merely trusted
   from a transcript. `serve-github.test.mjs` fails in isolation (confirmed live) on a live-GitHub
   listing-page assertion unrelated to `task edit`/gate scope — this reproduces the documented
   pre-existing flake, not a regression introduced by this milestone.
9. **MET.** `git show 8b3af67 --stat` and `git show 1e8a81b --stat`: both merges touch only
   `packages/quay/bin/quay.js`, test files (`cli.test.mjs` / `gap-cli-gate-enforcement.test.mjs`), and
   this milestone's own report files — no unrelated files. Real repo-root `tasks/` confirmed untouched
   by `git status --short -- tasks/` (no output) both before and after this audit's own test runs and
   probes.

## Summary of independent findings vs. prior claims

Every specific, checkable claim made in the merge commit message and in both iterations' reports was
independently re-derived and found to hold under live execution against the current merged code,
including the one claim (`--append-notes` + `--status` + `--enforce-gate` combined gating) that had
no existing automated test and was previously supported only by the merge-resolution author's own
prose reasoning, not a red/green test run. This audit closes that verification gap for that specific
claim (see CONCERNS item 1 for the residual, non-blocking recommendation to add a permanent regression
test for it).
