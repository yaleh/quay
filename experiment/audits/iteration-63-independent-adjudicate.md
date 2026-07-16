# Iteration 63 — Independent Out-of-Band Audit (G3)

**Auditor:** independent session, fresh context (no prior iteration-63 context carried in); all commands in this report were personally re-run against the working tree at commit `0c26153` ("Iteration 63: close unrecognized-status-label precedence fallback gap (QN-067); skeleton +0.01").

**Scope:** `experiment/iterations/iteration-63.md` and the corresponding `experiment/provenance.md` update, per the audit task's 7-point checklist.

**Verdict: PASS**

---

## 1. Claimed fallback rule's origin (iteration 5 dating)

Read `experiment/iterations/iteration-5.md` §5.1 "Bug 3 — status-label tie-breaking" in full. It states verbatim:

> "Fixed by collecting *all* `status:*` labels found on an issue (not just the last one encountered), then resolving ties via a documented precedence order: `done > needs-human > ready > todo` (most-advanced lifecycle stage wins; **unrecognized values are lowest precedence**)."

This is the genuine origin of the rule — confirmed directly from iteration 5's own report, not merely from iteration 63's assertion. iteration-63's dating is correct.

Read the current source, `packages/quay-github/src/github-client.js` lines 91-107:

```js
let status = "todo";
if (statusLabelsFound.length === 1) {
  status = statusLabelsFound[0];
} else if (statusLabelsFound.length > 1) {
  // Multiple status:* labels present -- apply the documented precedence
  // rule rather than last-write-wins. Unrecognized label values (not in
  // STATUS_PRECEDENCE) are treated as lowest precedence, in the order
  // encountered, below all recognized ones.
  const ranked = [...statusLabelsFound].sort((a, b) => {
    const ai = STATUS_PRECEDENCE.indexOf(a);
    const bi = STATUS_PRECEDENCE.indexOf(b);
    const ra = ai === -1 ? STATUS_PRECEDENCE.length : ai;
    const rb = bi === -1 ? STATUS_PRECEDENCE.length : bi;
    return ra - rb;
  });
  status = ranked[0];
}
```

Confirmed: the rule exists exactly as described (`indexOf` returns `-1` for unrecognized values; the ternary remaps `-1` to `STATUS_PRECEDENCE.length`, i.e. "rank below every recognized value"). **Verified.**

## 2. New test coverage

Read `packages/quay-github/test/view-model.test.mjs` in full. Confirmed the 3 new tests exist immediately after the pre-existing 6 precedence cases, and genuinely mix recognized + unrecognized labels:

1. `["status:ready", "status:some-typo-value"]` → asserts `"ready"` (recognized first, unrecognized second).
2. `["status:some-typo-value", "status:ready"]` → asserts `"ready"` (unrecognized first, recognized second — rules out last-write-wins).
3. `["status:alpha-unrecognized", "status:beta-unrecognized"]` → asserts `"alpha-unrecognized"` (both unrecognized, encounter-order tie-break).

Independently confirmed via `git show` that no pre-iteration-63 test combined a recognized and unrecognized label:

```
$ git show 9f78744:packages/quay-github/test/view-model.test.mjs | grep -n "status:" | grep -v "ready\|todo\|needs-human\|done"
5://   3. multiple status:* labels on one issue silently used last-write-wins.
40:// --- Bug #3: multiple status:* labels -- defined precedence, not last-write-wins ---
```
(Only prose/comment lines matched — no test case combined recognized+unrecognized before this iteration. Claim confirmed.)

Full regression suite, personally re-run:

```
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 26
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

```
$ node packages/quay-native/test/abi-symmetry.mjs 2>&1 | tail -2
ALL FOUR SURFACES SYMMETRIC
```

Diff scope, personally re-checked:

```
$ git diff --stat -- 'packages/*/src/*.js'
(empty)
$ git diff --stat HEAD~1 HEAD
 experiment/iterations/iteration-63.md         | 571 ++++++++++++++++++++++++++
 experiment/provenance.md                      |  85 ++++
 packages/quay-github/test/view-model.test.mjs |  33 ++
 tasks/QN-067.md                               |  81 ++++
 4 files changed, 770 insertions(+)
```

Confirmed: zero `src/*.js` diff in the final committed state — test-only (plus provenance/report/task-file bookkeeping). **Verified.**

## 3. Adversarial-verification claim — independently reproduced

Backed up the source, then applied the exact mutation described in §5 of the iteration report (`ai === -1 ? STATUS_PRECEDENCE.length : ai` → `ai === -1 ? -1 : ai`, same for `bi`/`rb`):

```
$ cp packages/quay-github/src/github-client.js /tmp/github-client.js.audit-bak
$ git diff --stat -- packages/quay-github/src/github-client.js
(empty — confirmed clean before mutation)
```

After applying the mutation:

```
$ node packages/quay-github/test/view-model.test.mjs 2>&1 | grep -E "PASS|FAIL"
PASS: precedence: ready beats todo regardless of label order (ready, todo)
PASS: precedence: ready beats todo regardless of label order (todo, ready)
PASS: precedence: needs-human beats ready
PASS: closed-wins rule still holds with multiple status labels present
PASS: single status label still maps directly (no regression)
PASS: no status label defaults to todo (no regression)
FAIL: unrecognized status label ranks below a recognized one (recognized first, unrecognized second)
FAIL: unrecognized status label ranks below a recognized one (unrecognized first, recognized second -- not last-write-wins)
PASS: two unrecognized status labels: first one encountered wins (stable-sort tie-break)
PASS: children parsed from checkbox refs, de-duplicated, order preserved
PASS: role derives to compound when children present (design §2 convention, extended to github Provider)
PASS: no checkbox refs -> empty children
PASS: role derives to primitive when no children (no regression)
PASS: parent populated from caller-supplied parentIndex (built by list() via buildParentIndex)
PASS: parent is null when no parentIndex supplied (documented single-issue get() limitation)
PASS: ambiguous multi-parent: first-found wins (documented rule)
PASS: ambiguity surfaced via extra.multipleParents rather than silently dropped
PASS: null issue.body normalizes to empty string, not null/crash
PASS: null issue.body yields empty children (no crash in extractChildRefs)
PASS: null-body issue derives role: primitive (no children)
PASS: undefined issue.body normalizes to empty string, not undefined/crash
PASS: undefined issue.body yields empty children (no crash in extractChildRefs)
2 test(s) FAILED
```

Exactly the 2 of 3 new tests fail as claimed (the two ranking-dependent cases); the tie-break-only case (both unrecognized) correctly still passes, since both values rank equally under the mutation and encounter-order is unaffected — matching the report's own stated explanation exactly. No other test in the suite was affected. **Reproduced independently, matches claim precisely.**

Restored:

```
$ cp /tmp/github-client.js.audit-bak packages/quay-github/src/github-client.js
$ git diff --stat -- packages/quay-github/src/github-client.js
(empty)
$ git status --short -- packages/quay-github/src/github-client.js
(empty)
```

```
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 26
ℹ pass 26
ℹ fail 0
$ node packages/quay-native/test/abi-symmetry.mjs 2>&1 | tail -2
ALL FOUR SURFACES SYMMETRIC
```

Byte-identical restoration confirmed (empty `git diff`), full suite green again. Temp backup file removed after use; no temporary breakage was committed at any point. **Verified.**

## 4. Live-GitHub safety

Searched the iteration report body for any write-shaped `gh` invocation (`gh issue edit`, `gh api ... --method`/`-X`/`-f`/`--field`) — none found. The only live GitHub call recorded in the report is a single read-only `gh api repos/yaleh/quay/issues/3 --jq '{state, labels: [.labels[].name]}'`.

Independently re-ran the live safety check:

```
$ gh issue view 3 --repo yaleh/quay --json number,state,labels
{"labels":[{"id":"LA_kwDOTY9jJM8AAAACrxoLEw","name":"status:ready","description":"quay-native status: ready","color":"0e8a16"},{"id":"LA_kwDOTY9jJM8AAAACrxoMYA","name":"lane:execution","description":"quay-native lane: execution","color":"1d76db"}],"number":3,"state":"OPEN"}
```

State OPEN, labels exactly `status:ready` + `lane:execution` — matches the known-clean baseline exactly. No drift, no residual trace of iteration 62's near-miss or any new mutation. **Verified.**

## 5. QN-067 provenance and lifecycle

Read `tasks/QN-067.md` in full: contains a genuine `## Proposal` (correctly identifies the untested branch, cites the iteration-5-dated comment, shows a live probe confirming current behavior before any test was added), a `## Plan` (3 concrete steps matching what was executed), `## AC` (4 checked items), and `## DoD` (4 checked items) — a substantive artifact, not a rubber-stamped shortcut.

Independently re-ran the gate sequence's final states are consistent with the report's transcript (`author->ready` gate passed on all-4-artifacts-present, `execute->done` gate passed on 4/4 AC checked, terminal `"gate":"none"` confirmed). `experiment/timing/iteration-63.log` exists and its timestamps (00:29:32Z creation → 00:31:18Z terminal, ~1m46s) are consistent with the report's own disclosure that this measures only the terminal gate-walk, not total session effort — correctly not used as an effectiveness comparator.

Provenance table entry: `QN-067 | ... | native | native | native | done`, consistent with the standing degraded-mode caveat (no subagent-dispatch primitive exists in this environment) applied uniformly since iteration 1. **Verified — genuine gated lifecycle, not a shortcut.**

## 6. σ/V-factor arithmetic

```
$ ls tasks/QN-*.md | wc -l
66
```

Matches claim exactly (up from 65 at end of iteration 62).

```
$ python3 -c "print(59/66); print(0.79*0.96*0.76*0.96); print(0.74*0.26*0.79*0.64)"
0.8939393939393939
0.55332864
0.09727744000000002
```

- σ_strict = 59/66 = **0.8939** — matches claim.
- V_instance = 0.79 × 0.96 × 0.76 × 0.96 = **0.5533** — matches claim (skeleton 0.78 → 0.79 correctly applied).
- V_meta = 0.74 × 0.26 × 0.79 × 0.64 = **0.0973** — matches claim, unchanged from iteration 62.

**Reasoning quality for holding V_meta flat:** cross-checked against the two prior corrected overreaches (iteration 59's `effectiveness` credit, reverted per the twelfth post-hoc correction; iteration 61's `completeness` credit, reverted per the thirteenth). Both corrections are documented in `provenance.md`/`iteration-61.md` and are real, not invented for this audit. Iteration 63's `completeness`/`effectiveness`/`reusability` reasoning each explicitly cites the specific precedent chain it is following (iteration-9/18/29/61 for `completeness`'s literal §5.2 scope restriction to `quay:author`/`quay:execute`'s own Method content; QN-034/QN-048 and the 26-62 streak for `reusability`'s "test-coverage-only proving pre-existing behavior is not new transfer evidence" rule) rather than asserting flatness without justification. The report additionally self-flags (§9 item 10, Problems item 4) that this iteration's `reusability` case is a *closer* call than most of the 38-iteration streak, since the shipped change touches the GitHub Provider's own test suite directly (the transfer target) rather than Core-only content — and still resolves to flat, consistent with the established rule. This is the opposite of overreach: the report affirmatively surfaces the closest case for scrutiny rather than quietly taking the credit. **The reasoning is sound and calibrated, not another overreach in the making.**

## 7. `baime-lite-driving-external-projects.md` untouched

```
$ git log --all --oneline -- docs/proposal/baime-lite-driving-external-projects.md
(no output)
```

Confirmed: this file has never been committed in this repository's history and remains untracked (`git status --short` shows only `?? docs/proposal/baime-lite-driving-external-projects.md`, unchanged since iteration 62's own audit). **Verified untouched.**

---

## Summary of independent findings

| Check | Result |
|---|---|
| Fallback rule dates to iteration 5 | Confirmed verbatim in iteration-5.md §5.1 |
| Rule exists in current source as described | Confirmed, `github-client.js` lines 91-107 |
| 3 new tests exist, genuinely mix recognized/unrecognized labels | Confirmed, all 3 read directly |
| No pre-iteration-63 test combined recognized+unrecognized | Confirmed via `git show` of pre-iteration-63 blob |
| Full suite passes | 26/26, personally re-run |
| ABI symmetry | ALL FOUR SURFACES SYMMETRIC, personally re-run |
| `git diff --stat` for `src/*.js` is empty | Confirmed |
| Adversarial break reproduces exactly 2/3 new-test failures | Reproduced independently, exact match |
| Restoration is byte-identical (empty diff) | Confirmed |
| Zero live write calls this iteration | Confirmed, only one read-only `gh api` call |
| Issue #3 matches known-clean baseline | Confirmed: OPEN, `status:ready`+`lane:execution` |
| QN-067 genuine gated lifecycle | Confirmed, full Proposal/Plan/AC/DoD, real gate transcript |
| σ = 59/66 = 0.8939 | Confirmed |
| V_instance = 0.5533 | Confirmed |
| V_meta = 0.0973 (flat) | Confirmed, reasoning sound and well-precedented |
| `baime-lite-driving-external-projects.md` untouched | Confirmed |

No discrepancies, no unsupported claims, no evidence of post-hoc rationalization distinguishable from the genuine iteration-62 precedent it cites. The iteration's own self-critical framing (flagging the `reusability` case as the closest call in the 38-iteration streak, inviting scrutiny of exactly the point a skeptical auditor would probe) is itself a positive discipline signal.

**Verdict: PASS.** No post-hoc correction warranted. Clean-audit streak: 2 (iterations 62, 63).
