# Iteration 27

- **date:** 2026-07-15
- **status:** complete
- **primary driver:** iteration 25/26's own carried-forward "Problems
  identified for next iteration" item 1 (no new human directive was
  present — see §2 below)

## 1. Context from prior iteration

`experiments/quay-native-bootstrap/iterations/iteration-26.md` (614 lines, read in full fresh
this iteration) ended with:

- σ (strict) = 28/35 = 0.8000, σ (inclusive) = 30/35 = 0.8571,
  σ_author_only = 34/35 = 0.9714.
- **V_instance = 0.67 × 0.94 × 0.76 × 0.94 = 0.4499** (skeleton 0.67,
  abi_symmetry 0.94, gate_correctness 0.76, skill_convergence 0.94).
- **V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973** (completeness 0.74,
  effectiveness 0.26, reusability 0.79, validation 0.64).
- All 5 convergence criteria: NO. Criterion 3 ("contract proven") at a
  "materially strengthened, specifically-bounded NO" — DIR-007's Core-MCP
  work strengthened confidence in ABI stability generally but did not
  touch the specific named residual gap: `executeEpic`'s own
  compound-recursion path had still never been run end-to-end as a live
  `quay:execute` **Skill invocation** (as opposed to manual step-by-step
  commands standing in for it), across iterations 25 and 26 both.
- The iteration-26 independent out-of-band audit
  (`experiments/quay-native-bootstrap/audits/iteration-26-independent-adjudicate.md`) returned
  **PASS**, zero disqualifying findings — one cosmetic nit (the archived
  DIR-007's own `## Resolution` section loosely echoes the original
  directive's wording on `reusability`, superficially conflicting with
  iteration-26.md's own carefully-reasoned decision to hold it flat; the
  audit itself judged `provenance.md`/`iteration-26.md` the authoritative
  record and called this a lightweight future cleanup, not a scoring
  fault). Addressed this iteration — see §5h.
- **"Problems identified for next iteration"** named several open items,
  in priority order: (1) the `executeEpic` Skill-level live-drive gap
  (carried since iteration 25, named the single highest-value remaining
  gap for convergence criterion 3); (2) `mcp-server.js`'s stdio MCP
  transport under a real Claude-Code-session MCP client registration,
  never tested for any of the three MCP binaries; (3)
  `resolveProviderEnv()`/`quay serve`'s CLI-dispatch gaps (carried,
  untouched, several iterations); (4) `effectiveness` flat at 0.26 for
  5 iterations, still awaiting a genuinely Skill-orchestration-shaped
  marginal increment; (5) `reusability`'s single iteration-25 data point,
  awaiting a genuine second corroborating transfer instance.

## 2. Preconditions checked

- `docs/proposal/quay-bootstrap-experiment.md` re-read in full (protocol:
  self-hosting identity M(Q)=Q, §5.1/§5.2 value formulas as products of 4
  factors each, §6 guardrails G1-G6, §7's 5 convergence criteria, §10's
  resolved decisions).
- `experiments/quay-native-bootstrap/README.md` and `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` re-read in
  full (10-section report template, phase discipline, σ ladder).
- `experiments/quay-native-bootstrap/provenance.md` read: the tail (iterations 25-26 plus the
  post-hoc correction section, ~450 lines) read in full; earlier
  iterations' sections trusted per established convention (their own
  running tallies, not re-derived from memory).
- `ls experiments/quay-native-bootstrap/directives/pending/` at session start: **confirmed
  empty** — no new directive appeared since DIR-007's archival at the end
  of iteration 26. Per the mandatory-first-priority convention, iteration
  25's problem #1 (carried through iteration 26 unresolved) became this
  iteration's primary target, exactly as iteration 26's own final
  paragraph anticipated.
- `experiments/quay-native-bootstrap/audits/iteration-26-independent-adjudicate.md` read in full
  (verdict: PASS; one cosmetic nit re: DIR-007's archived Resolution
  wording — addressed §5h below).
- `git status --short` at session start: clean except one untracked file,
  `docs/proposal/baime-lite-driving-external-projects.md` — read in full;
  confirmed, per its own explicit stated status, to be forward-looking
  discussion notes only ("no protocol amendment... or commitment to
  build" follows from it), **not** a directive, mirroring
  `quay-core-scope-expansion-discussion.md`'s own treatment at iteration
  26. No action taken on it beyond reading and noting it (see Problems
  §9 below).
- `experiments/quay-native-bootstrap/directives/README.md` re-read in full (lifecycle mechanism:
  pending/ → archive/, required `## Resolution` section) — confirmed
  moot this iteration (no new directive to process).
- manda daemon: `.manda/config.yml` / `.manda/hub.addr` present (G6
  precondition file check; no subagent-dispatch primitive found this
  iteration either, reconfirmed via `ToolSearch` — same degraded-fallback
  mode as every prior iteration since iteration 1).
- `gh auth status`: confirmed user `yaleh`, scopes include `repo` +
  `workflow`, before any live GitHub-backed work this iteration.

## 3. Observe

Re-verified, not assumed, the exact shape of the residual gap named by
iterations 25 and 26:

- `packages/quay-native/skills/execute/SKILL.md` read in full: its own
  Gaps section confirms all *failure*-path branches of `executeEpic`
  (leaf gate failure, child-cannot-reach-done, integration-acceptance
  failure) were genuinely, mechanically exercised by iterations 7-9 — but
  every one of those proofs was on the **native** Provider, and none of
  them proved the **happy path** (`driveEach` completing successfully for
  every child, then `integrationAccept` passing) via the actual
  `quay:execute` Skill invocation on a **second, GitHub-backed** epic, nor
  via genuine live-captured intermediate partial-completion state.
- Checked directly (not assumed): iteration 5's QN-008/009/010/011 *did*
  exercise the happy path once, on native — but all 3 children's
  underlying implementation work was already complete *before* authoring,
  so no intermediate `ok:false` state was ever live-captured
  (`grep`-confirmed: no "not all children are done" string appears
  anywhere in `iteration-5.md`). Iterations 25/26's compound/epic
  live-verifications (QN-035/DIR-006, and this repo's pre-existing
  gh-7/gh-5/gh-6 fixture) exercised the **gate's own** recursive
  `childrenStatus()` logic directly via manual `task check`/`task edit`
  commands — never `executeEpic`'s own `driveEach`/`integrationAccept`
  control flow as an actual Skill-level drive.
- `gh issue list -R yaleh/quay --state all` confirmed the pre-existing
  compound fixture (issues #7/#5/#6, iteration 25's QN-035) was already
  `done`/closed at the start of this iteration — it could not serve as a
  fresh `todo`-to-`done` drive; a **new** fixture was required.
- `.quay/config.yml` confirmed `github.enabled: false` (native still the
  only enabled Provider by default) — a genuine multi-Provider-enabled
  live check requires deliberately, temporarily enabling `github`, same
  precondition iteration 26 named.

**Concrete gap, specifically:** no iteration has ever authored a fresh
GitHub-backed epic via `quay:author`'s own Method (with a genuine
decompose-test application) and then driven it via `quay:execute`'s own
`executeEpic` pseudocode end-to-end, live-capturing both the intermediate
partial-completion gate state and the final integration-accepted state.
This iteration closes exactly that gap.

## 4. Strategy

Chosen over the other four named candidates (stdio-transport-under-real-
Claude-session, `resolveProviderEnv`/`quay serve` cleanup, `effectiveness`
timing, `reusability` second instance) for the reasons iteration 26 itself
gave: this is "likely the single highest-value remaining gap for
convergence criterion 3," it is directly tractable with tools available
this session (`gh` CLI, live GitHub issues), and — unlike the
stdio-transport gap (see §9, honestly found to require a **fresh session
start** this session cannot self-verify) — it does not depend on any
environment capability this session lacks.

Plan, in order:

1. Create three fresh GitHub issues (two children, one epic referencing
   both) via `gh issue create`, all starting genuinely at `todo` — a new
   fixture, not a reuse of the already-`done` gh-7/gh-5/gh-6 fixture.
2. Author the epic via `quay:author`'s own documented Method, applying the
   decompose test for real (2 independently mergeable DESIGN.md
   doc-comment deliverables).
3. Drive the epic via `quay:execute`'s own `executeEpic` pseudocode:
   `driveEach` over both children (each via `quay:author` +
   `executeLeaf`), in genuine temporal order (child A fully `done` before
   child B is even authored), live-capturing the epic's own intermediate
   gate state between the two children's completion.
4. `integrationAccept`: re-check the epic's own gate once both children
   are `done`; update `quay:execute`'s SKILL.md Gaps section (closing this
   named gap); flip the epic to `done`.
5. Cross-check Core's MCP passthrough against `quay-github`'s own direct
   CLI for byte-identical proof; restore `.quay/config.yml`.
6. Create a native tracker task (`QN-037`) recording this work, matching
   this experiment's own convention (native tasks track/record
   GitHub-Provider-side proofs, e.g. QN-035/QN-036's own pattern).

**A genuine authoring-time mistake was made and corrected mid-construction
(recorded honestly, not silently fixed):** the epic's initial AC draft
described *execution outcomes* ("both children driven to done," "gate
reports ok:false while a child is not done," "gate reports ok:true once
both are done") — these cannot be truthfully checked at authoring time
(before any execution has occurred), yet `store.js`/`github-client.js`'s
`author->ready` gate genuinely requires **all** AC checkboxes checked
before `ready` (QN-019, iteration 8's tightening). A live `task check`
call surfaced this directly (`{"acChecked":0,"acTotal":4,"reason":"0/4 AC
checkboxes checked"}`) after only 1 of 4 items could honestly be checked.
The epic's AC was then rewritten to be genuinely author-time-verifiable
(decompose-test satisfaction, plan concreteness, children's own AC
quality) — following this project's own QN-020 precedent (an epic's AC is
authored to be truthfully checkable at authoring time; the actual
execution-outcome proof lives in DoD / the iteration report, and the
compound gate re-asserts children-done independently at `execute->done`,
not by re-litigating the same AC boxes). This is the single most
judgment-laden design decision in this iteration's work — named
explicitly for the next audit to check.

## 5. Execution

**5a. Three fresh GitHub issues created** (`gh issue create -R
yaleh/quay`):
- Issue #8 — `[QN-037-fixture] Child A` (primitive leaf).
- Issue #9 — `[QN-037-fixture] Child B` (primitive leaf).
- Issue #10 — `[QN-037] Epic` (references #8/#9 via `- [ ] #N` checkbox
  convention).

`quay task view gh-10 --provider github --json` confirmed `role:
"compound"`, `children: ["gh-8","gh-9"]` correctly derived from the
checkbox convention (`extractChildRefs()`, unmodified since iteration 5)
before any further work.

**5b. Epic authored via `quay:author`'s Method.** Initial gate check:
```
$ quay task check gh-10 --provider github --json
{"id":"gh-10","gate":"author->ready","ok":false,"artifacts":{"proposal":true,"plan":true,"ac":true,"dod":true},"acTotal":4,"acChecked":0,"reason":"0/4 AC checkboxes checked"}
```
AC rewritten per §4's correction (author-time-verifiable content only).
Re-check:
```
$ quay task check gh-10 --provider github --json
{"id":"gh-10","gate":"author->ready","ok":true,"artifacts":{...all true...},"reason":"all four artifacts present; eligible to move to ready"}
```
`quay task edit gh-10 --provider github --status ready` run.

**5c. Child A (gh-8) driven via `quay:author` + `executeLeaf`.**
Real `implement-phase` diff: a new §6 subsection added to
`packages/quay-github/DESIGN.md` documenting this fixture (`git diff
--stat` confirmed exactly one file, several lines, before AC was checked).
AC checked only after the diff existed:
```
$ quay task check gh-8 --provider github --json   # before implementation
{"...","acChecked":0,"acTotal":2,"reason":"0/2 AC checkboxes checked"}
$ quay task check gh-8 --provider github --json   # after implementation + AC checked
{"...","gate":"author->ready","ok":true,...}
```
`task edit gh-8 --status ready` → `task check` (`execute->done`,
`acChecked:2/2`, `ok:true`) → full regression suite re-run (self-audit,
zero failures) → DoD checked → `task edit gh-8 --status done`. Final:
`{"id":"gh-8","gate":"none","ok":true,"reason":"terminal"}`.

**5d. Intermediate epic-level gate state live-captured** (the key,
previously-never-recorded proof), with child B not yet even authored:
```
$ quay task check gh-10 --provider github --json
{
  "id": "gh-10", "gate": "execute->done", "ok": false,
  "acTotal": 4, "acChecked": 4,
  "reason": "AC checkboxes complete, but not all children are done: gh-9 (todo)",
  "childrenStatus": [{"id":"gh-8","status":"done"},{"id":"gh-9","status":"todo"}]
}
```
This is the first time this experiment has live-captured a genuine
mid-drive partial-completion state for a Skill-level epic execution (as
opposed to a manually-constructed gate-only fixture).

**5e. Child B (gh-9) driven identically** (own DESIGN.md sentence,
own AC/DoD checked only once genuinely true, full regression suite
re-run a second time, zero failures) through to `done`.

**5f. `integrationAccept` — final epic gate check:**
```
$ quay task check gh-10 --provider github --json
{
  "id": "gh-10", "gate": "execute->done", "ok": true,
  "acTotal": 4, "acChecked": 4,
  "reason": "all AC checkboxes checked; eligible to move to done",
  "childrenStatus": [{"id":"gh-8","status":"done"},{"id":"gh-9","status":"done"}]
}
```
`quay-native/skills/execute/SKILL.md`'s Gaps section updated (new entry,
placed before the "not yet dispatched via manda" gap) recording this as
the first genuine live Skill-level `executeEpic` drive-to-`done`, per the
epic's own DoD requirement. Epic's DoD then checked; `task edit gh-10
--status done` run. Final: `{"id":"gh-10","gate":"none","ok":true,
"reason":"terminal","childrenStatus":[{"id":"gh-8","status":"done"},
{"id":"gh-9","status":"done"}]}`.

**5g. Byte-identical cross-check** (direct `quay-github` CLI vs. Core's
`quay` passthrough):
```
DIRECT  = node packages/quay-github/bin/quay-github.js task check gh-10 --json
VIA_CORE = node packages/quay/bin/quay.js task check gh-10 --provider github --json
DIRECT == VIA_CORE  →  true (exact string match)
```
`.quay/config.yml`'s temporary `github.enabled: true` flip (needed only
to run Core's `--provider github` passthrough calls) restored to its
original `false` immediately after; `git diff .quay/config.yml` confirmed
empty at commit time.

**5h. DIR-007 archive hygiene fix** (the iteration-26 audit's one cosmetic
nit): `experiments/quay-native-bootstrap/directives/archive/DIR-007-implement-core-mcp-server.md`
read; its `## Resolution` section's stale echo of the original directive's
`reusability` wording was left as historical record of what the directive
*originally asked for* (not rewritten, since rewriting a directive's own
words after the fact would itself be a G1-adjacent honesty risk) — instead
a short clarifying note was appended immediately after that section,
explicitly cross-referencing `iteration-26.md` §8 and `provenance.md` as
the authoritative, internally-consistent scoring record, per the audit's
own suggested resolution.

**5i. `tasks/QN-037.md` created** (native-side tracker for this iteration's
GitHub-backed work, matching QN-035/QN-036's own convention) and driven
through the native lifecycle: `task check` confirmed the gate would
genuinely pass at `todo` (verified live by a temporary `status: todo`
edit + `task check` + restore, not merely asserted), then created directly
at `status: done` with all AC/DoD boxes reflecting the genuinely-completed
GitHub-side work recorded in §5a-5g above (mirroring QN-036's own
precedent for a task whose substantive proof lives on the GitHub side).

**Full regression suite re-run three times this iteration** (after child
A, after child B, and once more before the epic's own DoD sign-off): all
19 `*.test.mjs` files (8 quay-native + 6 quay-github + 5 quay) exit 0,
zero regressions each time; `abi-symmetry.mjs` still reports "ALL FOUR
SURFACES SYMMETRIC." `ps aux | grep quay` confirmed no orphaned
subprocesses after all manual verification steps.

## 6. Provenance update

`experiments/quay-native-bootstrap/provenance.md` updated with a full "Iteration 27 — QN-037"
narrative section and a σ-computation section:

```
σ (strict reading)     = 29 / 36 = 0.8056   (up from 0.8000, Δ +0.0056)
σ (inclusive reading)  = 31 / 36 = 0.8611   (up from 0.8571)
σ_author_only          = 35 / 36 = 0.9722   (up from 0.9714)
```

| task_id | title | author_by | execute_by | gate_by | status |
|---|---|---|---|---|---|
| QN-037 | Live-verify executeEpic's own Skill-level compound-recursion drive (native tracker for gh-10/gh-8/gh-9) | native | native | native | done |

Total native task count: 36 (QN-001..QN-037, minus the never-allocated
QN-018). The GitHub-side fixture (gh-8/gh-9/gh-10) is **not** counted in
this ledger — consistent with protocol §10.1 ("σ is counted per native
task, aligned with the native task model") and this project's own
established precedent (the pre-existing gh-7/gh-5/gh-6 fixture was never
counted either).

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

- **skeleton: 0.67 (unchanged).** No new v0-loop binding, transport, or
  consumer-layer capability was added this iteration — QN-037's work is
  entirely Skill-orchestration + GitHub-Provider-side exercise of
  already-existing bindings (`quay-github mcp`, `quay mcp`'s existing
  proxy). No diff to any binding/transport code this iteration.
- **abi_symmetry: 0.94 (unchanged).** `abi-symmetry.mjs` re-run fresh,
  unchanged, still "ALL FOUR SURFACES SYMMETRIC." No CLI/MCP schema
  change this iteration.
- **gate_correctness: 0.76 (unchanged).** Zero diff to `store.js`'s or
  `github-client.js`'s own gate logic this iteration (`git diff`
  confirms) — the compound-recursion gate mechanics (`checkGate()`/
  `childrenStatus()`) were genuinely **exercised**, not **changed**.
  Applying the exact discipline the iteration-25 correction established:
  credit belongs where the actual gate-logic evidence lives (none of it
  changed here); exercising an unmodified gate is not a `gate_correctness`
  event.
- **skill_convergence: 0.96 (up from 0.94, Δ +0.02).** This is the one
  factor this iteration's work genuinely targets. Evidence: this is the
  first time in the experiment's 27-iteration history that `executeEpic`'s
  own **happy-path** recursive orchestration (`driveEach` completing for
  every child, then `integrationAccept` passing) was exercised (a) via the
  actual `quay:execute` Skill invocation framing rather than a manual
  gate-only stand-in, (b) on the **GitHub** Provider rather than native
  (iteration 5's QN-008/009/010/011 proved the happy path once, but only
  on native), and (c) with a genuine **live-captured intermediate
  partial-completion state** (§5d — `ok:false`, naming the specific
  blocking child), which even iteration 5's own native happy-path proof
  never captured (all 3 of QN-008's children were pre-implemented before
  authoring, so no intermediate `ok:false` state was ever observed).
  Scored at the same modest increment (+0.02) iterations 8 and 9 used for
  their own analogous `executeEpic`-branch-specific proofs (needs-human /
  integration-failure), not larger, because: this is not a *new branch* of
  `executeEpic`'s pseudocode (the happy path itself was already proven
  once, at iteration 5) — it is the same branch, now proven on a second
  Provider with better (live-intermediate-state) evidence quality. This is
  a genuine, incremental, non-double-counted gain — deliberately not
  credited to `gate_correctness` (zero gate-logic diff) or `reusability`
  (see §8, this is Skill-exercise depth, not a fresh transfer-target
  capability-construction event).

```
V_instance = 0.67 × 0.94 × 0.76 × 0.96 = 0.4595
```

ΔV_instance = **+0.0096** (0.4499 → 0.4595). A single factor moved, by the
same conservative increment size this experiment's own precedent
establishes for this exact class of finding (a new `executeEpic` branch/
scenario genuinely exercised for the first time).

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **completeness: 0.74 (unchanged).** `quay:execute`'s SKILL.md gained a
  new Gaps-history entry (§5f) documenting this iteration's finding, but
  no new **Method step** — the orchestration Skill's own documented
  procedure (`Spec`/`Method` sections) is unchanged. Consistent with how
  iterations 20-26 each treated their own analogous
  capability-exercise/gap-closure work as distinct from methodology-content
  changes.
- **effectiveness: 0.26 (unchanged).** This iteration's work is, in kind,
  exactly the Skill-orchestration/decomposition-shaped increment iteration
  26's own problem list asked a future iteration to look for — but no
  clean, instrumented start/end timing log comparable to QN-006's
  (~2m59s, the stage-0 comparator iteration 21 used) was captured for this
  session's work. Per the honest-measurement discipline established at
  iteration 21 (a genuine timing attempt was made there and reported
  honestly even though it came out unfavorable; iterations 22-26 correctly
  declined to force a shaky repeat), this iteration declines to assert an
  effectiveness number without a comparably rigorous timing basis, rather
  than guess. This remains an open, named target for a future iteration
  that captures start/end timestamps explicitly, live, from the first
  command of the Skill-orchestration work.
- **reusability: 0.79 (unchanged).** Deliberately not moved, for a reason
  directly informed by iteration 26's own successfully-applied lesson:
  protocol §5.2 scopes `reusability` to "the methodology transfers to a
  second Provider... measured on the transfer target only" — specifically,
  iteration 25's own +0.11 gain was for **new capability construction on
  the transfer target** (compound-gate recursion logic itself, freshly
  built for GitHub). This iteration's work does not construct any new
  GitHub-Provider capability — `github-client.js`'s gate logic is
  unchanged (confirmed via `git diff`, zero lines). What this iteration
  proves is that the **already-transferred** Skill-orchestration
  methodology (`quay:author`/`quay:execute`, transferred since QN-029,
  iteration 18) can be exercised more thoroughly against GitHub for a new
  scenario (epic happy-path with intermediate-state capture) — genuine
  and valuable evidence, but it is Skill-**exercise** depth
  (`skill_convergence`'s own domain, credited there in §7 above), not a
  fresh Provider-**transfer** event. Per this iteration's own explicit
  instruction to watch for, but not manufacture, "a genuine second
  corroborating transfer instance" — this is honestly not that instance,
  and is not scored as one.
- **validation: 0.64 (unchanged).** Consistent with established precedent
  (iterations 17-26): `validation` credits an iteration once the
  out-of-band audit **for that iteration's own work** is obtained — which
  happens after this report is committed, via the top-level orchestrator's
  separate `Agent` dispatch. Correctly held flat pending that audit.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
```

ΔV_meta = **0.0000** (unchanged). Honestly reported: this iteration's
genuine gain lands entirely in V_instance (`skill_convergence`), for the
same reason iteration 26's gain landed entirely in V_instance
(`skeleton`) — the dual-layer scoring discipline correctly routes this
iteration's specific kind of progress (deeper Skill-orchestration exercise
of an already-transferred methodology on an already-established
Provider) to `skill_convergence`, not to `reusability` or `completeness`,
avoiding the exact double-counting failure mode G2 exists to prevent.

## 9. Out-of-band audit

**No new out-of-band audit was initiated or attempted by this
iteration-executor session**, per standing rules — G3 audit dispatch is
exclusively the top-level orchestrator's job, performed separately after
this report is committed, via its own native `Agent` tool.

`experiments/quay-native-bootstrap/audits/iteration-26-independent-adjudicate.md` (read in full
at the start of this session) remains the most recent independent audit;
its one cosmetic nit was addressed this iteration (§5h).

**This iteration's work merits close audit scrutiny on the following
points**, named explicitly for the next audit to check independently:

1. Whether the epic's AC-rewrite correction (§4, the "genuine
   authoring-time mistake made and corrected mid-construction") is judged
   a sound application of the QN-020 precedent, or whether an independent
   reviewer would find the rewritten AC too permissive (i.e., not actually
   testing what the original, execution-outcome-shaped AC intended to
   test) — this is the single most judgment-laden design call in this
   iteration's work.
2. Whether the live intermediate-state capture (§5d,
   `{"ok":false,"reason":"AC checkboxes complete, but not all children are
   done: gh-9 (todo)"}`) and the final `integrationAccept` state (§5f) are
   independently re-run and re-confirmed against the real `yaleh/quay`
   repository (issues #8/#9/#10 remain open in the repo as durable
   evidence, per this project's own convention, and are all now `done`/
   closed at audit time — an independent re-run would need to inspect the
   final state and the `experiments/quay-native-bootstrap/provenance.md` narrative rather than
   reproduce the exact intermediate transition, which is not
   re-creatable without new issues).
3. Whether the byte-identical cross-check (§5g) is independently re-run
   (`quay-github mcp` direct vs. `quay mcp --provider github`), and
   whether `.quay/config.yml` is confirmed correctly restored (`git diff`
   empty at audit time).
4. Whether `skill_convergence`'s +0.02 increment (§7) is judged
   proportionate — in particular, whether the distinction drawn between
   "a new `executeEpic` branch" (would warrant credit) and "the same
   happy-path branch proven on a second Provider with better evidence"
   (this iteration's actual claim, credited more conservatively) is
   correctly calibrated, or whether an independent reviewer would score
   it differently (higher, for the genuine cross-Provider proof; or zero,
   for not being a structurally new branch at all).
5. Whether `reusability` being held flat (§8) is judged correct — this is
   the same class of judgment call iteration 26 made for its own MCP-proxy
   work, and this iteration was explicitly instructed to watch for, but
   not manufacture, a second reusability data point; an independent
   reviewer should check whether this iteration's reasoning is genuinely
   distinct from iteration 25's own `reusability`-earning finding, or
   whether it undersells a legitimate transfer claim.
6. `git status --short` should show a clean working tree at audit time
   (confirmed clean at the end of this session, re-confirmed after
   commit, §Convergence Check below).

## 10. Convergence Check

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** — **NO.**
      V_instance = 0.4595 (up from 0.4499), V_meta = 0.0973 (unchanged).
      Both remain far below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set +
      gate)** — **NO.** σ (strict) = 0.8056, up from 0.8000, still far
      from 1. `quay:execute`'s SKILL.md gained a Gaps-history entry (not a
      Method-step change) this iteration — the Skill set's own documented
      procedure is unchanged, so this criterion is neither newly supported
      nor newly undermined; it remains NO for the same standing reason
      (σ < 1).
- [ ] **3. Contract proven (native + GitHub both run)** — **materially
      strengthened again, still NO overall, but the specific residual gap
      iterations 25/26 both named is now CLOSED.** This iteration directly
      addresses the exact gap those two iterations identified:
      `executeEpic`'s own compound-recursion path has now genuinely been
      run end-to-end as a live `quay:execute` Skill invocation, driving a
      real multi-child GitHub epic from `todo` to `done`, with both the
      intermediate partial-completion state and the final
      integration-accepted state live-captured. This closes the single
      most-cited residual gap for this criterion. It is still not scored
      YES overall: criterion 3 requires "native + GitHub Provider both
      run" as a general, durable contract-stability claim, and the
      stdio-transport-under-a-real-Claude-Code-session gap (named below,
      problem #1) remains a distinct, still-open piece of that same
      general claim, not resolved by this iteration's work. Net honest
      characterization: NO, but for a narrower, more specifically-bounded
      reason than iteration 26 left it — one major named sub-gap closed,
      one remains.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off)** — **NO.** No audit yet exists for this iteration's own
      work (correctly — it happens after this report is committed).
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** — **NO.**
      ΔV_instance = +0.0096 this iteration; combined with iteration 26's
      own +0.0134, two consecutive iterations show real, non-trivial,
      non-templated V_instance movement (from different factors:
      `skeleton` then `skill_convergence`) — the opposite of the
      diminishing-returns signal.

**Status**: **NOT CONVERGED**. Criterion 1 remains clearly NO. Criterion 2
remains clearly NO (σ still well below 1). Criterion 3 shows genuine,
material progress — the specific highest-value residual gap named across
two prior iterations is now closed — but remains NO overall pending the
stdio-transport gap and a broader durability claim. Criterion 4 remains
NO, correctly, pending the next out-of-band audit. Criterion 5 remains
NO — two consecutive iterations of real V_instance movement, not
diminishing.

## Problems identified for next iteration

1. **`mcp-server.js`'s own stdio MCP transport under a real, live Claude
   Code session's own MCP client registration remains untested** — now
   the single highest-priority named gap for convergence criterion 3,
   carried forward and sharpened. This iteration investigated directly
   (not merely repeated the prior note): registering a project-level
   `.mcp.json` and checking whether a fresh session's `ToolSearch` surfaces
   `quay mcp`'s tools would be the genuine test — but this **cannot be
   self-verified within a single running session**, since MCP servers are
   discovered at session startup, not mid-session (confirmed directly
   this iteration: `ToolSearch` found zero `quay`-related deferred tools
   before any `.mcp.json` existed, and adding one now would not be picked
   up by *this* session's own already-initialized MCP client). This
   iteration deliberately did **not** unilaterally add a permanent
   `.mcp.json` to the repository — doing so is a durable, repo-wide
   environment/tooling decision affecting every future session and
   contributor, not a routine per-iteration code increment, and is better
   suited to an explicit human decision or directive than a unilateral
   iteration-executor choice. A future iteration (or a directive) should
   decide whether to add `.mcp.json`, and if so, the **very next** fresh
   session after that must check its own `ToolSearch` output as one of
   its first actions, before any other tool use, to genuinely close this
   gap — honestly distinguishing "prepared" from "verified."
2. **`resolveProviderEnv()`'s absolute-path passthrough branch** and
   **`quay serve`'s own CLI dispatch branch** remain open (carried forward
   unchanged from iterations 23-26's problems lists) — untouched by this
   iteration's work, which did not modify `bin/quay.js` or
   `resolveProviderEnv()` at all.
3. **`effectiveness` remains at its honest ceiling (0.26)**, now for 6
   consecutive iterations (21-27). This iteration's work was the right
   *kind* (Skill-orchestration/decomposition, more Plan/AC complexity than
   the stage-0 comparator) but was not instrumented with a clean start/end
   timing log. A future iteration should explicitly capture wall-clock
   timestamps at the very start and end of its own Skill-orchestration
   work (e.g. `date -Iseconds` bracketing the session) so a rigorous
   comparison against the stage-0 QN-006 comparator (~2m59s) becomes
   possible, rather than attempting a retrospective estimate.
4. **`reusability` was deliberately held flat this iteration**, for the
   second consecutive iteration (26, 27) — both iterations found genuine,
   related-but-distinct work that a less careful analysis might have
   credited to `reusability`, and both correctly routed the credit
   elsewhere (`skeleton` at 26, `skill_convergence` at 27) after checking
   the actual diff against the factor's precise protocol definition. The
   single iteration-25 data point for `reusability`'s own +0.11 move
   remains the only such move in this ledger; a future iteration should
   continue watching for, but not manufacture, a genuine second
   corroborating transfer instance (new Provider-side capability
   construction on the transfer target, not Skill-exercise depth or
   Core-side infrastructure).
5. **The σ-ledger axis (QN-006) remains a provenly closed question** — no
   change to this conclusion; future iterations should not re-litigate it.
6. **The `Agent`/`Dispatch` tool schema-change observation from iteration
   20 remains open and untested by any iteration-executor session,
   correctly** — squarely a G3 audit question, not for a future
   iteration-executor session to test on itself.
7. **`docs/proposal/baime-lite-driving-external-projects.md` remains
   unresolved discussion notes**, not acted on beyond being read this
   iteration (its own stated status explicitly precludes treating it as a
   directive or protocol amendment). Its open question (generalizing the
   quay-bootstrap loop, with V_meta removed, to drive other projects)
   remains live for a future iteration, a directive, or the top-level
   orchestrator to decide on, not this session's to resolve unilaterally.
8. **No new pending directive exists as of the end of this iteration**
   (`experiments/quay-native-bootstrap/directives/pending/` is empty) — a future iteration's
   first priority, per standing convention, should be this iteration's
   own problem #1 (the stdio-transport-under-real-Claude-session gap,
   including the `.mcp.json` decision named above) absent a new directive
   appearing first.
