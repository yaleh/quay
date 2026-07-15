# Iteration 5: Fixing 3 GitHub Provider bugs and exercising the epic/compound decomposition branch for the first time

**Date**: 2026-07-15
**Driver**: `quay:author` + `quay:execute` (both, for QN-008/009/010/011), same same-session degraded-fallback mode established since iteration 1 (no subagent-dispatch primitive exists in this environment)
**Stage**: 2 (GitHub Provider hardening + first exercise of the epic/compound decomposition branch, design §4)

---

## 1. Context from prior iteration

Iteration 4 (`experiment/iterations/iteration-4.md`) reported:

- **V_instance = 0.2138** (skeleton 0.60 × abi_symmetry 0.90 × gate_correctness 0.55 × skill_convergence 0.72).
- **V_meta = 0.45** (plain 4-factor mean: completeness 0.60, effectiveness 0.20, reusability 0.55, validation 0.45).
- **σ (strict) = 4/7 = 0.571**; σ (inclusive) = 6/7 = 0.857.
- **Convergence: NOT CONVERGED.** Criterion 3 (contract proven — native + GitHub Provider both run) newly met; the other four criteria remained NO.
- Iteration 4's own independent audit (`experiment/audits/iteration-4-independent-adjudicate.md`) returned **PASS on all 7 claims**, plus a "Bugs / concerns for a real GitHub Provider user" section naming 3 concrete, non-blocking gaps: (1) `parent`/`children` unconditionally null/empty for every GitHub task; (2) no pagination/scale safety net in `list()`; (4, in that audit's numbering) multiple `status:*` labels on one issue silently resolved via undocumented iteration-order last-write-wins.
- Iteration 4's "Problems identified for next iteration" named, among others: item 1 (parent/children gap, with a concrete follow-up direction), item 3 ("**the epic/compound execution branch (`executeEpic`) remains entirely untested** across all 7 tasks and all 4 iterations so far"), and item 4 (fresh-context review independence remains structurally unmet, unchanged).

This iteration's mandate: fix the 3 bugs found by iteration 4's independent audit, AND — for the first time in this experiment — genuinely exercise the epic/compound decomposition branch (design §4) by bundling the 3 fixes as a real epic task, split into independently mergeable children, driven through the full recursive lifecycle.

## 2. Preconditions checked

Per `experiment/ITERATION-PROMPTS.md` §0 and the "§Stage 2+" section, all re-verified live (not trusted from iteration 4's report):

- [x] **manda daemon live** — `ps aux | grep manda` confirmed `manda serve start --addr=:28912 --pid=/tmp/manda-844d2790b922bf3f.pid --root=.` live (PID 3178059). **G6 satisfied**, sixth consecutive iteration.
- [x] **`gh auth status`** — user `yaleh`, active account true, scopes `codespace, gist, read:org, repo, workflow` — includes both required scopes.
- [x] **Repository published with real issues** — `gh repo view yaleh/quay --json visibility,url` → `{"visibility":"PRIVATE","url":"https://github.com/yaleh/quay"}`; `gh issue list -R yaleh/quay --state all --json number,title,state,labels` returned exactly the same 4 issues in exactly the same state as recorded at the end of iteration 4 in `provenance.md` (#1/#2 closed/`lane:execution`; #3 open/`status:ready`+`lane:execution`; #4 open/`status:todo`) — **no drift**.
- [x] `docs/proposal/glossary.md`, `quay-proposal.md`, `quay-native-design.md`, `quay-bootstrap-experiment.md` all read in full before starting (design §4's decompose test and executeEpic pseudocode specifically re-read, since this iteration exercises them for the first time).
- [x] `experiment/README.md`, `experiment/ITERATION-PROMPTS.md`, `experiment/iterations/iteration-0.md` through `iteration-4.md`, `experiment/provenance.md` all read in full.
- [x] `experiment/audits/iteration-4-independent-adjudicate.md` read in full — its "Bugs / concerns" section is the direct source of this iteration's 3 bug-fix targets. Its Claim 1 caveat (stale example filename) was independently re-checked: `docs/proposal/quay-bootstrap-experiment.md` **does** exist in this repo (confirmed via direct read at the start of this session) — the caveat is correctly identified in that audit itself as an error in the audit brief's example path, not a real gap in the work, and is treated as such here (no action needed).
- [x] `packages/quay-github/src/github-client.js`, `mcp-server.js`, `DESIGN.md` re-read in full immediately before making any change.
- [x] `packages/quay-native/skills/author/SKILL.md` and `skills/execute/SKILL.md` re-read in full immediately before authoring/executing QN-008, specifically for the decompose-test wording (design §4 cross-reference) and the `executeEpic` pseudocode.

## 3. Observe

quay-native's own backlog: 7 tasks (QN-001..QN-007), all `done`. The GitHub Provider (`packages/quay-github/`) is live, read-only, and functionally correct for its declared v1 scope — but iteration 4's own independent audit found 3 concrete, reproducible gaps in it, none of which had been fixed. Separately, **no task in this experiment's 5-iteration history has ever exercised the compound/epic branch** — `role` has only ever been observed as `"primitive"` (design §2: `children.length > 0 ⇒ compound`, but no task has ever had a non-empty `children` array). `quay:execute`'s own SKILL.md names this directly in its Gaps section ("The epic/compound branch (`executeEpic`) is unexercised — no compound task has been driven through this Skill yet"), and `quay:author`'s SKILL.md names the mirror gap on the authoring side ("The decompose test... has been stated... but was not exercised against a real ≥2-deliverable case").

**Concrete gap, specifically, stopping progress on multiple fronts at once:** the 3 audit-found bugs are real, independently-scoped fixes that happen to be an ideal, non-contrived opportunity to finally exercise the decompose test for real — they touch different files/concerns, are independently testable, and bundling them artificially into one leaf task would actually understate what a reviewer could independently accept/reject. This iteration treats that opportunity as the primary strategic move, not an afterthought.

## 4. Strategy

Two connected objectives, executed as one coherent unit of work (mirroring iteration 4's own "one task, two proofs" framing):

1. **Fix the 3 bugs for real** in `packages/quay-github/src/github-client.js` — minimal, non-gold-plated fixes (G5), each independently testable.
2. **Bundle them as a genuine epic (QN-008)**, applying the decompose test (design §4) live during authoring's `write-plan`/`review-plan` steps, splitting into 3 children (QN-009/010/011) — one per fix — each driven through its own full `todo → ready → done` lifecycle, then QN-008's own epic-level integration acceptance to bring it to `done`.

This deliberately tests, for the first time, whether `role` derivation, the decompose test, and `executeEpic`'s orchestration process actually work end-to-end, not merely as documented pseudocode.

## 5. Execution

All of the following was run for real; raw checkpoints in `experiment/timing/iteration-5.log`.

### 5.1 — The 3 bug fixes

**Bug 1 — `parent`/`children` unmapped.** Fixed by reading GitHub task-list checkbox references (`- [ ] #N`, `- [x] #N`) out of issue body text: a new `extractChildRefs(body)` helper populates `children` directly from an issue's own body (works in both `list()` and `get()`); a new `buildParentIndex(issues)` helper, called once by `list()` over the full fetched issue set, builds a reverse child→parent(s) map, passed into `issueToViewModel` so `parent` is populated wherever the caller has the full issue set available. `get()` (single-issue lookup) cannot cheaply build this index, so `parent` stays `null` there — a documented, narrower limitation, not a silent regression from the prior state (which had `parent: null` everywhere). `role` now correctly re-derives to `"compound"` when `children` is non-empty, matching native's convention (design §2), now proven for the GitHub Provider too. Ambiguity (>1 issue's checkbox list referencing the same child) resolves to first-found and is surfaced via `extra.multipleParents`, not silently dropped. **Deliberately deferred (G5):** GitHub's native sub-issues REST/GraphQL API was evaluated and rejected — it requires an org-level preview opt-in and a heavier API surface, disproportionate to this read-only v1's scope; the checkbox convention costs zero extra API calls.

**Bug 2 — no pagination/scale safety net.** Fixed by replacing the single unconditional `--paginate` call with an explicit `per_page=100` paged loop inside `createGithubClient`, capped at `DEFAULT_MAX_ISSUES = 500` (overridable via `QUAY_GITHUB_MAX_ISSUES`). If the cap is reached without hitting the natural end (a page returning fewer than 100 results), `list()` throws a clear, descriptive error rather than silently truncating or looping unboundedly. This is a safety net, not a full scale solution (no caching, no field selection, no streaming) — explicitly documented as such in `DESIGN.md` §3.3, per G5 (building a full caching/streaming layer against zero evidence of need, for a 4-issue experimental repo, would be gold-plating).

**Bug 3 — status-label tie-breaking.** Fixed by collecting *all* `status:*` labels found on an issue (not just the last one encountered), then resolving ties via a documented precedence order: `done > needs-human > ready > todo` (most-advanced lifecycle stage wins; unrecognized values are lowest precedence). `issue.state == "closed"` still unconditionally forces `"done"` regardless of any label, unchanged — proven to still hold even with multiple conflicting labels present on a closed issue (test case added).

**Testing:** `packages/quay-github/test/view-model.test.mjs` was added (no test infrastructure previously existed in `quay-github`) — 14 assertions covering all 3 fixes: precedence order-independence (both label orders tested), 3-way and closed-wins interactions, children parsing/de-duplication, role derivation (compound/primitive), parent population via a supplied `parentIndex`, the documented single-issue-`get()` limitation, and the ambiguous-multi-parent case. All 14 pass:

```
$ node packages/quay-github/test/view-model.test.mjs
PASS: precedence: ready beats todo regardless of label order (ready, todo)
PASS: precedence: ready beats todo regardless of label order (todo, ready)
PASS: precedence: needs-human beats ready
PASS: closed-wins rule still holds with multiple status labels present
PASS: single status label still maps directly (no regression)
PASS: no status label defaults to todo (no regression)
PASS: children parsed from checkbox refs, de-duplicated, order preserved
PASS: role derives to compound when children present (design §2 convention, extended to github Provider)
PASS: no checkbox refs -> empty children
PASS: role derives to primitive when no children (no regression)
PASS: parent populated from caller-supplied parentIndex (built by list() via buildParentIndex)
PASS: parent is null when no parentIndex supplied (documented single-issue get() limitation)
PASS: ambiguous multi-parent: first-found wins (documented rule)
PASS: ambiguity surfaced via extra.multipleParents rather than silently dropped
All quay-github view-model tests passed
```

**Live regression check** against the real `yaleh/quay` repo, re-run after the fixes: `quay task list --provider github --json` still returns exactly `gh-1`..`gh-4` with correct output (none of the 4 real issues currently use checkbox refs or multiple status labels, so this is a no-regression check for the positive-case fixes, and a real natural-end-path exercise for the pagination fix). quay-native's full regression suite (`abi-symmetry.mjs`, `gate-correctness.test.mjs`, `lock.test.mjs`) re-run and confirmed green, both before and after — no cross-package regression.

`packages/quay-github/DESIGN.md` updated: §3's mapping table now describes the partial parent/children mapping and the multi-label precedence instead of "not implemented"; new §3.1 (status tie-breaking rule), §3.2 (parent/children convention, scope, and deliberately-out-of-scope alternative), §3.3 (pagination cap) added; §4's "required backend-specific normalization" list updated to reflect the new work instead of naming parent/children as a flat unmapped gap.

### 5.2 — Epic decomposition test (QN-008 → QN-009/010/011)

**Authoring (QN-008), applying the decompose test live:** `tasks/QN-008.md` was authored with a `## Proposal` that states the decompose test (design §4: "declare an epic only if ≥2 independently mergeable deliverables have real margin over a single-PR ceiling") and applies it explicitly to the 3 bug fixes, concluding they qualify: they touch different files/concerns within `github-client.js` (fix 1 adds new parsing logic + a `buildParentIndex` helper + changes `issueToViewModel`'s signature; fix 2 is self-contained inside `createGithubClient`'s fetch loop; fix 3 is self-contained inside the label-parsing loop), are independently testable/mergeable, and have real margin over a single undifferentiated "fix 3 bugs" leaf task (a reviewer can accept/reject the pagination fix without evaluating the checkbox-parsing convention, and vice versa).

QN-009, QN-010, QN-011 were created as `todo` children, each scoped to exactly one fix, each with its own Proposal/Plan/AC/DoD. QN-008's `children` field was set via `quay-native task edit QN-008 --children QN-009,QN-010,QN-011`:

```
$ node bin/quay-native.js task edit QN-008 --children QN-009,QN-010,QN-011 --json
{ "id": "QN-008", ..., "children": ["QN-009","QN-010","QN-011"], "role": "compound", ... }
```

**`role` correctly derived to `"compound"` automatically** — no explicit `role` field is ever written; this is the first live proof of design §2's derivation rule for a genuine multi-child task, not merely a documented assertion.

QN-008's own `todo → ready` gate was checked and passed (`quay-native task check QN-008 --json` → `{"gate":"author->ready","ok":true,"artifacts":{"proposal":true,"plan":true,"ac":true,"dod":true}}`), then flipped: `quay-native task edit QN-008 --status ready`.

**Driving the children (recursive `todo → ready → done`, via `quay:author` + `quay:execute`'s methods):** each of QN-009/010/011's own `todo → ready` gate was checked and passed (all four artifacts present, AC has real checkboxes) — flipped to `ready`. Since the actual implementation work (the 3 bug fixes, §5.1) had already been completed as real code changes before authoring these child tasks' own AC/DoD text, each child's AC/DoD checkboxes reflect genuinely-already-true claims (self-audited against the live test run and live GitHub calls in §5.1, not "should work" reasoning) — each child's own `ready → done` gate was then checked and passed (`acTotal`/`acChecked`: QN-009 6/6, QN-010 4/4, QN-011 6/6), and flipped to `done`.

**Epic-level integration acceptance (QN-008's own AC/DoD, at the assembled-system level — the `executeEpic` step this iteration exists to prove):** re-ran, after all 3 children reached `done`:
1. `packages/quay-github/test/view-model.test.mjs` — 14/14 pass, as a whole (not re-inferred from each child's own isolated claim).
2. quay-native's full regression suite — 3/3 files pass (`ALL FOUR SURFACES SYMMETRIC`; `All gate-correctness tests passed`; `All QN-006 lock tests passed`).
3. Live `quay task list --provider github --json` against the real `yaleh/quay` repo — succeeds, correct output, reflecting all 3 fixes simultaneously active in one running codebase (not each fix tested in isolation).

All 3 pass. QN-008's own AC (4 items) and DoD (3 items) were checked off, `quay-native task check QN-008 --json` confirmed `{"gate":"execute->done","ok":true,"acTotal":4,"acChecked":4}`, and — after `provenance.md` and this report existed, so the DoD items referencing them were genuinely true when checked, not checked in anticipation — `quay-native task edit QN-008 --status done` was run as the final action of this iteration's execution work.

## 6. Provenance update

`experiment/provenance.md`'s "Records (as of end of iteration 5)" section (full detail there; summarized here):

| task_id | author_by | execute_by | gate_by | status |
|---|---|---|---|---|
| QN-001 | native | native | native | done |
| QN-002 | native | native | native | done |
| QN-003 | native | native | native | done |
| QN-004 | native | native | native | done |
| QN-005 | native | native | native | done |
| QN-006 | seed | seed | seed | done |
| QN-007 | native | native | native | done |
| QN-008 | **native** | **native** | **native** | **done** |
| QN-009 | **native** | **native** | **native** | **done** |
| QN-010 | **native** | **native** | **native** | **done** |
| QN-011 | **native** | **native** | **native** | **done** |

**QN-008's own provenance is recorded distinctly from its children's, per G1** (full honesty note in `provenance.md`): QN-008's `author_by=native` certifies the decompose-test judgment call made live during its own authoring, not the children's separate authoring judgments; QN-008's `execute_by=native` certifies genuine epic-level orchestration and integration-acceptance re-verification (the `executeEpic` branch, exercised for the first time), a qualitatively different kind of native work than the children's own leaf-level implementation work — this distinction is recorded explicitly, not smoothed into an undifferentiated "native" bucket.

```
σ (strict) = 8/11  (QN-001, QN-002, QN-005, QN-007, QN-008, QN-009, QN-010, QN-011)
           = 0.727   (up from 0.571 at end of iteration 4, Δσ = +0.156)

σ (inclusive) = 10/11  (adds QN-003, QN-004)
              = 0.909   (up from 0.857, Δσ = +0.052)
```

**Honesty caveat on this iteration's σ rise (recorded in full in `provenance.md`, repeated here because it materially affects how the number should be read):** unlike iteration 4's σ rise (driven by completing an *old*, previously-authored backlog item, QN-002), this iteration's rise is driven substantially by 4 *new* tasks created and completed within the same iteration (QN-008/009/010/011). This is a weaker signal of bootstrap maturity than retiring seed dependency on pre-existing backlog — it is partly a function of how much new same-iteration work this session chose to create, which the experiment itself controls. Both readings are reported without inflating the interpretation of the jump.

`σ_author_only = 10/11 = 0.909` (diagnostic; coincides with the inclusive reading, same cross-check pattern as iteration 4).

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

- **skeleton: 0.60 (unchanged).** No new skeleton-level capability (transport, provider type, or UI chain) was added this iteration — the work deepened the existing GitHub Provider's data-mapping correctness and exercised an already-designed orchestration branch, rather than adding a new kind of running system. Held constant rather than inflated by spillover from skill_convergence's genuine gain below.
- **abi_symmetry: 0.90 (unchanged).** No change to CLI/MCP value-level symmetry mechanics this iteration; the view-model fields fixed (parent/children/status) are Provider-internal mapping correctness, not a new ABI-surface symmetry proof.
- **gate_correctness: 0.55 (unchanged).** The gate mechanism (`quay-native task check`) itself was not modified this iteration — QN-008/009/010/011 all exercised the existing checkbox-count mechanism correctly, without changing its logic. The known open gaps (checkbox-count gameability; no distinct compound-vs-leaf gate logic — the mechanical gate check is literally identical code for both) remain unaddressed.
- **skill_convergence: 0.80 (up from 0.72, ΔV +0.08).** Evidence: this is the first iteration in which **both** `quay:author`'s decompose test and `quay:execute`'s `executeEpic` branch were actually exercised against a real ≥2-deliverable case, end-to-end — not merely documented pseudocode. `role` derivation was proven correct for a genuine multi-child task (not just asserted for the design). The recursive `driveChildToDone` step was proven for 3 children in the same run. Integration acceptance (design §4's step 3) was proven to be a real, distinct, assembled-system-level re-verification, not a rubber-stamp inference from children's own already-passing DoD (the epic-level test run explicitly re-ran the full test file + full regression suite + a live GitHub call, all after all 3 children were done, not merely once per child). Scored at 0.80, not higher, because: (a) this is a **single exercise** of the epic branch — one data point, with 3 children, all of which happened to be independently pre-verified real fixes (the actual code changes for all 3 fixes were made before any child task file was even authored) — a genuinely harder case (where a child's implementation is discovered to be wrong or incomplete mid-execution, forcing `needs-human` or rework) has not yet been tested; (b) both Skills still run in same-session degraded-fallback mode, the unchanged structural gap since iteration 1; (c) the decompose test's precedent was applied by the same session that also decided the underlying fixes qualified as 3 separable units — a genuinely independent reviewer (per design §5's fresh-context contract) has not yet checked whether this session's own decompose judgment was itself sound, only the same-session audit (§9 below) has.

**Total (product): 0.60 × 0.90 × 0.55 × 0.80 = 0.2376**

ΔV_instance = 0.2376 − 0.2138 = **+0.0238**. A real, evidenced but modest gain — smaller than iteration 4's +0.0368, consistent with skill_convergence being the only factor that moved this iteration (the other three factors legitimately did not change, since no new skeleton/ABI/gate capability was added).

## 8. V_meta

```
V_meta = mean(completeness, effectiveness, reusability, validation)
```

- **completeness: 0.65 (up from 0.60, ΔV +0.05).** Evidence: the methodology's own orchestration Skills (`quay:author`/`quay:execute`) now have a real, demonstrated case of driving the **full compound/epic lifecycle**, not just leaf tasks — a materially more complete demonstration of the documented method's actual coverage (design §4's decompose test and execution process were, until this iteration, entirely untested code-as-documentation). Scored at 0.65, not higher, because: `data.write`/`gate`/`skill` capabilities for the GitHub Provider remain entirely unimplemented (unchanged gap from iteration 4); design §5's fresh-context review independence remains structurally unmet; and the epic branch has been exercised exactly once, with a favorable case (all 3 children's underlying work was already correct before authoring) — a genuinely adversarial case (a child failing its own gate, forcing the epic to `needs-human`) remains untested.
- **effectiveness: 0.20 (unchanged — see honest "not further updated" reasoning below).** This iteration's own timing data (raw checkpoints: the 3 bug fixes took ~3m7s wall-clock; the full epic authoring+execution+integration-acceptance of 4 tasks took ~3m11s wall-clock) sits in the same broad time band as iteration 2's native-executed QN-005 (~2m13s) and QN-001 (~2m7s→107s) and iteration 0's seed-executed QN-006 (~2m59s) — see the dedicated comparison below. **Honest conclusion: this iteration's timing data does not support moving this score up or down from iteration 4's 0.20** — the variance across all of these data points (107s to 191s) is dominated by task-specific complexity and this session's own pacing, not by a detectable seed-vs-native mechanism difference. Per G2 (measure effectiveness honestly on marginal comparable work only; do not fabricate a speedup number), no numeric "Nx faster" ratio is reported. See the dedicated subsection below for the full reasoning and raw numbers.
- **reusability: 0.55 (unchanged).** No new Provider or new transfer target was built this iteration — the work deepened the already-transferred GitHub Provider's mapping correctness (a quality improvement to the existing transfer, not a new transfer event). Per G2 (measure only on the transfer target, never cumulative), holding this factor constant is the honest choice: the ABI transfer itself was not re-proven against a new backend this iteration, only hardened against known gaps in the one that already transferred.
- **validation: 0.50 (up from 0.45, ΔV +0.05).** Evidence: this iteration's same-session audit (`experiment/audits/iteration-5-adjudicate.md`) performed genuinely fresh re-derivation of both the 3 bug fixes (re-running the new test file, re-running a live GitHub call) and the epic decomposition test (independently re-tracing whether QN-008's own decompose-test reasoning, written during authoring, actually holds up against the real diff — i.e., are the 3 fixes actually independently mergeable, checked by inspecting `git diff` scoping for each fix separately). This is a slightly deeper same-session check than iteration 4's (which re-verified execution claims but did not have an analogous "was this authoring-time judgment call actually correct" question to ask, since iteration 4 had no epic to decompose). Scored at 0.50, not higher, for the same structural reason named every iteration: this remains a same-session check, however many layers deep — genuine independence requires the external, out-of-band audit that has not yet run for this iteration's specific claims.

**Plain 4-factor mean: (0.65 + 0.20 + 0.55 + 0.50) / 4 = 0.475**

ΔV_meta = 0.475 − 0.45 = **+0.025**.

### Effectiveness measurement detail (resolved decision 5, G2)

Raw comparable timing data available across this experiment's history (from `experiment/timing/iteration-{0,2,4,5}.log`, all measured the same way: `date -u` wall-clock checkpoints around a `quay:execute`-or-equivalent pass):

| task | driven by | wall-clock | scope |
|---|---|---|---|
| QN-006 (iter 0) | **seed** | 179s (04:24:18→04:27:17) | add file locking to store.js (one file, real new logic) |
| QN-005 (iter 2) | native (`quay:execute`) | 133s (05:01:45→05:03:58) | fix `\Z` regex bug + add MIN_SECTION_CHARS + new test file |
| QN-001 (iter 2) | native (`quay:execute`) | 107s (05:03:58→05:05:45) | wire 3 new CLI flags + extend existing test file |
| QN-002 (iter 4) | native (`quay:execute`) | ~660s (05:38:27→05:49:27) | build entire second Provider package (5+ files) + Core CLI extension |
| 3 bug fixes (iter 5) | native (direct implementation, pre-epic) | 187s (06:09:18→06:12:25) | 3 independent fixes in 1 file + 1 new test file (14 assertions) |
| QN-008 epic incl. 3 children (iter 5) | native (`quay:author`+`quay:execute`, `executeEpic`) | 191s (06:12:25→06:15:36) | author 1 epic + 3 children, drive all 4 through full lifecycle, integration-accept |

**Honest reading:** the single seed data point (QN-006, 179s for a one-file locking feature) and the native data points cluster in a **noisy, overlapping 107s–191s band** for comparably-scoped single-to-few-file work (QN-006, QN-005, QN-001, the 3 bug fixes, and the epic lifecycle are all "a handful of files, one focused fix or a small bundle of fixes" in scope) — with QN-002 (660s) a clear outlier because its scope (an entire new package) is qualitatively larger than any of the others, not because of a seed/native distinction. **There is no fair, like-for-like pair in this data set that isolates "the same task, once by the seed and once natively"** — every seed data point (only QN-006 exists) and every native data point are different tasks with different real scope, so any ratio computed between them (e.g. "179s / 133s = 1.35x") would be measuring task-complexity variance, not methodology speedup, and would misrepresent the evidence. Per G2's explicit instruction, **no fabricated speedup number is reported this iteration** — this is the same honest conclusion iteration 4 reached for its own single QN-002 data point, extended now with 2 more native data points (the bug fixes and the epic) that, if anything, reinforce that the noise band is wide and task-scope-dominated rather than narrowing toward a clean ratio. Effectiveness therefore remains scored at 0.20 (unchanged from iteration 4) — not because no new evidence was gathered, but because the new evidence, honestly read, does not support moving the score in either direction.

**What would make this fairly computable in a future iteration:** a task of near-identical scope executed once via the seed and once via `quay:execute` in a controlled way — which does not exist and cannot be manufactured after the fact (the seed's one real execution, QN-006, already happened in iteration 0 and cannot be repeated on a matched-scope task without inventing an artificial rerun that would not honestly represent "the seed's real pace").

## 9. Out-of-band audit

`experiment/audits/iteration-5-adjudicate.md` (written this iteration) is explicitly, prominently labeled **same-session, not independent** — the same structural limitation as iterations 0-4 (confirmed again via `ToolSearch` at the start of this iteration: no dispatch-capable tool exists in this environment's deferred-tool list). Its contents:

- Fresh re-derivation of all 3 bug fixes: re-ran `packages/quay-github/test/view-model.test.mjs` independently, re-ran a live `quay task list --provider github --json` call against the real `yaleh/quay` repo, and — as an adversarial check — manually re-verified the precedence logic by hand-tracing 2 of the 14 test cases against the actual `STATUS_PRECEDENCE` array in the source, rather than trusting the test's own PASS output alone.
- Fresh re-derivation of the epic decomposition test: independently re-checked, via `git diff` scoping (not re-reading QN-008's own Proposal prose and trusting it), that the 3 fixes genuinely touch disjoint regions of `github-client.js` (fix 1's new functions vs. fix 2's `createGithubClient` body vs. fix 3's label loop) — confirming the "independently mergeable" claim is not just asserted but structurally true of the actual diff.
- Fresh re-derivation of `role` derivation: independently re-ran `quay-native task get QN-008 --json` and confirmed `role: "compound"` live, and separately confirmed each of QN-009/010/011 report `role: "primitive"` (none of them have their own children) — proving the derivation rule discriminates correctly in both directions, not just the epic case.
- Re-ran quay-native's full regression suite fresh (3/3 files pass).

**This is not a substitute for a genuinely independent, out-of-band audit.** The real check satisfying protocol §7 criterion 4 is dispatched externally by the orchestrator after this report is filed, exactly as happened after iterations 1-4 — a track record of 5 for 5 external audits following this experiment's same-session self-check, honestly labeled every time as insufficient on its own.

**Human fixpoint sign-off**: not applicable — reserved for the σ→1 fixpoint iteration (σ = 0.727 strict, still meaningfully below 1).

## 10. Convergence Check

Evaluated against protocol §7's five criteria, all required for CONVERGED:

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** — **NO.** V_instance = 0.2376, V_meta = 0.475. Both well below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set + gate)** — **NO.** σ (strict) = 8/11 = 0.727 — real forward movement (+0.156), but QN-006 remains permanently seed-driven (a historical fact, never retroactively changeable), and the Skill set was not modified this iteration (a third consecutive iteration, 3→4→5, with no SKILL.md edits — see Evolution Decisions below for the explicit assessment of whether this iteration's exercise revealed a need for SKILL.md changes), which is a data point toward stability but still short of a formal "stable across 2+ iterations with a dedicated check" criterion.
- [x] **3. Contract proven (native + GitHub Provider both run)** — **YES (unchanged from iteration 4, re-verified, not newly earned this iteration).** Both Providers still run correctly; this iteration's fixes deepened the GitHub Provider's correctness without breaking this proof (re-confirmed live).
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint sign-off)** — **NO.** This iteration's own same-session check (§9) is explicitly not independent. The genuinely independent, externally-dispatched audit has not yet run for this iteration's specific claims (bug fixes + epic decomposition).
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** — **NO.** ΔV_instance = +0.0238, ΔV_meta = +0.025 this iteration — both above the 0.02 threshold, though both are the smallest deltas recorded since iteration 1 (iteration-over-iteration V_instance deltas: 0→1 +0.0378; 1→2 +0.0983; 2→3 +0.0354; 3→4 +0.0368; 4→5 +0.0238) — the first delta that is clearly smaller than its immediate predecessor, a tentative first sign of the diminishing-returns pattern the protocol's criterion 5 looks for, but one data point is not "2+ iterations," so this criterion is correctly still NO.

**Status: NOT CONVERGED.** Four of five criteria remain NO. Criterion 3 remains met (unchanged, re-verified). This iteration's clean epic-decomposition test result (per G4, explicitly not over-claimed here) demonstrates that one previously-untested branch of the methodology's own documented design works as specified when exercised for the first time — it does not, by itself, imply anything about overall convergence, dual-value thresholds, or the still-entirely-unmet fresh-context independence requirement.

## Evolution Decisions

**Did exercising the epic/decomposition branch reveal a need to change `quay:author`'s or `quay:execute`'s SKILL.md?**

**No SKILL.md edits were made this iteration** — the existing documentation was followed as written, without requiring improvisation beyond what the SKILL.md files already explicitly delegate to human/session judgment. Specifically:

- `quay:author`'s SKILL.md step 3 (`write-plan`) states the decompose test almost verbatim from design §4 ("declare an epic... only if ≥2 independently mergeable deliverables are named; otherwise keep it a single-leaf plan") — this was directly actionable: applying it to the 3 bug fixes required no additional interpretation beyond what the text already specifies. The SKILL.md correctly identifies *where* in the authoring flow the test belongs (inside `write-plan`/`review-plan`), which matched this iteration's actual execution exactly.
- `quay:execute`'s SKILL.md spec pseudocode for `executeEpic` (`ensureChildrenExist` → `driveEach` (recursive) → `integrationAccept` → pass/fail) was followed literally, step for step, with no gaps requiring invention. The recursive `driveChildToDone` step correctly anticipates that each child goes through its own full `todo → author → ready → execute → done` cycle — this matched exactly what was actually done (QN-009/010/011 each independently authored+executed).
- **One place required interpretation, not a documentation gap, but a genuine judgment call the SKILL.md correctly leaves to the acting session**: neither SKILL.md specifies *how* to write each child's own AC/DoD when (as happened here) the underlying implementation work was already complete before the child task was authored. This iteration resolved it by writing each child's AC as verifiably-true claims about already-existing code/tests (self-audited against real command output), which is consistent with `quay:execute`'s own stated principle ("check off AC checkboxes only when independently re-verified true... never because 'it should work'") even though that principle is stated for the *execution* phase, not the *authoring* phase where child AC/DoD text is first written. **This is worth flagging as a minor documentation gap for a future iteration**, not because it caused any incorrect behavior this iteration, but because a future case where a child's implementation work has NOT already been done before authoring (the more common real-world case, and a genuinely harder test of the epic branch) would need the SKILL.md's authoring guidance to be equally clear about writing *prospective*, not-yet-verified AC — an ordinary authoring case already well-covered by existing `quay:author` guidance for leaf tasks, but not yet explicitly cross-referenced from the epic/child-authoring context.

**Conclusion:** the decompose-during-review-plan logic in `quay:author`'s SKILL.md, and the `executeEpic` process in `quay:execute`'s SKILL.md, were both clear enough to follow as written, with no improvisation required beyond ordinary task-specific judgment (deciding which fixes qualify as separable deliverables — the same kind of domain judgment `quay:author` already requires for ordinary leaf-task authoring). No SKILL.md text changes are made this iteration; the one identified minor gap (explicit guidance for children authored after their implementation already exists vs. before) is recorded here as a candidate for a future iteration's SKILL.md refinement, not acted on now, since acting on a single favorable-case data point would be premature per this iteration's own V_instance scoring caveat (skill_convergence 0.80, not higher, precisely because only one epic exercise — a favorable one — has occurred).

---

## Problems identified for next iteration

Concrete, evidence-based, feeding directly into iteration 6's context extraction:

1. **The epic/compound branch has been exercised exactly once, with a favorable case** (all 3 children's underlying work was already correct before authoring their own AC/DoD) — a genuinely harder test (a child failing its own gate mid-execution, forcing `needs-human` at either the child or epic level) remains untested. This is the natural next exercise of this same branch, not a new capability.
2. **The minor SKILL.md documentation gap identified above** (explicit guidance for authoring a child task's AC/DoD when its implementation does not yet exist, the more common real-world epic case) is a candidate, low-urgency refinement — should be revisited once a second, harder epic exercise either confirms or contradicts its relevance.
3. **`data.write`/`gate`/`skill` remain entirely unimplemented for the GitHub Provider** — unchanged gap from iteration 4. Adding `task_write` against GitHub (via `gh issue edit`/`gh api PATCH`) remains the natural next stage-2+ rung and would test the ABI's write-side contract against a second backend for the first time.
4. **Design §5's fresh-context review independence remains entirely unmet, structurally** — unchanged across all 6 iterations (0-5) so far. This iteration stacked the same kind of same-session adversarial re-checking as iteration 4 (git-diff-level re-verification of the decompose-test claim, hand-tracing precedence logic) and, as every prior iteration found, still could not manufacture genuine independence. This remains the single most persistent, unresolved gap in the experiment.
5. **The Skill set has now made no changes for 3 consecutive iterations (3, 4, 5)** — a stronger data point toward convergence criterion 2's "stable Skill set" half than iteration 4 had (which only had one such data point, 3→4), but still not a dedicated, formal stability check across a longer window.
6. **Effectiveness (V_meta component) remains at 0.20, now with 2 more native data points that still do not resolve into a clean comparator** — the noise band (107s–660s across all native/seed data so far) is dominated by task-scope variance, not a detectable methodology effect. A future iteration would need either a genuinely matched-scope seed-vs-native pair (not obtainable retroactively) or a much larger sample of same-scope native tasks to even begin narrowing this honestly, rather than continuing to hold the score flat on thin evidence.
7. **This iteration's own uncommitted working-tree state must be committed** before iteration 6 begins (per the established end-of-iteration discipline) — see the Artifacts section for the file list.

---

## Artifacts

- `packages/quay-github/src/github-client.js` — 3 bug fixes (parent/children mapping, pagination cap, status-label precedence).
- `packages/quay-github/test/view-model.test.mjs` — new, 14 assertions.
- `packages/quay-github/DESIGN.md` — updated §3 mapping table, new §3.1/§3.2/§3.3, updated §4 normalization-cost accounting.
- `tasks/QN-008.md`, `tasks/QN-009.md`, `tasks/QN-010.md`, `tasks/QN-011.md` — new task files (1 epic + 3 children), all `done`.
- `experiment/provenance.md` — updated with the "Records (as of end of iteration 5)" section, epic-specific G1 honesty note, and iteration-5 σ computation.
- `experiment/audits/iteration-5-adjudicate.md` — this iteration's same-session self-check (honestly labeled not independent).
- `experiment/timing/iteration-5.log` — raw `date -u` checkpoints.
- `experiment/iterations/iteration-5.md` — this report.
