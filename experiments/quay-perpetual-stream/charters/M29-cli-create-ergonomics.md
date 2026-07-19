# Charter M29-cli-create-ergonomics — Core CLI `task edit` upsert data-integrity fix
# (GAP-002), dedicated create-verb structural fix (GAP-001), stale --help text (G-02);
# first development-class (real product-code) milestone since early in the stream (Tier-A)

**Milestone id:** M29-cli-create-ergonomics · **surface:** CLI (`packages/quay`) · **type:** exploit
**Source:** `tasks/exp5-M-QUAY-CLI-CREATE-ERGONOMICS.md` (SELECTed m29, `milestone:M29-cli-create-
ergonomics`) — anchored on GAP-002, M27-competitive-bench's own report calling it "the single most
severe finding of the whole benchmark," a real correctness/data-integrity bug. Full provenance:
`experiments/quay-perpetual-stream/milestones/M27-competitive-bench/benchmark-report.md`
("Disposition of each gap" section; GAP-001/GAP-002/GAP-007/G-02).
**Charter authored:** m28→m29 boundary, 2026-07-18. Base commit (both iterations' worktrees):
`exp5-outer-driver` HEAD **`f7b3a0bf8aba98ee8e4d3f52eeedf93795a95fb4`** (SELECT m29 commit,
confirmed via `git rev-parse exp5-outer-driver` at charter-authoring time, no drift since SELECT).

## Value hypothesis
- Value type(s) (`inherited-core.md`'s value-typed SELECT ledger): **exploit / capability-growth
  (primary)** — fixes a real, confirmed data-integrity defect on the CLI surface (chart-1 weight 25)
  and closes a structural gap (no dedicated create verb) that was the root enabler of that defect.
  Secondary: **instrument-correction flavor** — GAP-002 was a genuine methodological miss by
  iteration-1 of M27 (its own scenario always supplied `--title`), so fixing it also closes a real
  gap the benchmark's own two-iteration pattern exists to catch.
- **Δv̂: small positive**, CLI surface (weight 25). Estimated `Δĉov_CLI ≈ +0.02` (a correctness fix
  to an existing, already-scored verb plus one small doc-accuracy fix — not a new capability
  category), i.e. `Δv̂ ≈ 25 × 0.02 = 0.5`. Recorded on `dashboard.md` before dispatch, per protocol
  §4.1/§6.2. This is deliberately a SMALL, not a headline, Δv̂ — the milestone's real value is
  correctness/trust (a silently-corrupted task record is a severe defect class regardless of its
  chart-weight contribution), which VT Δv̂ alone under-prices; noted here per the value-typed
  ledger's own "VT is one input, never the sole ranker" discipline.
- Metric `Y`: (1) GAP-002 no longer reproducible — `quay task edit <new-id> --status todo` (no
  `--title`) against a native-provider store either refuses (hard fail, no file written) or writes a
  task with a real, non-empty `title` (never a missing key, never the literal string `undefined`);
  (2) `--help` text for `task edit` lists the actual supported flag surface; (3) full test suite
  green before AND after, with new tests added under TDD (RED→GREEN) covering the fixed behavior.

## Current-state notes (re-verified directly against source at charter-authoring time)
- **The Core CLI entry point is `packages/quay/bin/quay.js`** (confirmed, same fact M27/M28's
  charters already used). `task` subcommands: `list`, `view`, `edit`, `check` — still no dedicated
  `create` verb at this layer (GAP-001 re-confirmed live, `grep -n 'sub === "' packages/quay/bin/
  quay.js`).
- **GAP-002's exact mechanism, traced to source.** `quay task edit <id> --status todo` (no
  `--title`) calls the Core CLI's generic `client.taskWrite(patch)` passthrough (`quay.js` lines
  401-467, `cmd === "task" && sub === "edit"`) with `patch = { status: "todo" }` (no `title` key at
  all, since `flags.title === undefined`). Over MCP this reaches the native provider's
  `store.js#write(id, {...})` (`packages/quay-native/src/store.js` lines 309-352). Because
  `existingRaw === null` (this is a NEW id, i.e. an upsert-as-create), line 319 builds
  `frontmatter = { id, title, status, ... }` from the raw destructured `title` parameter —
  `undefined` in this path — and `YAML.stringify` (line 182) silently OMITS a key whose value is
  `undefined` from the serialized frontmatter. This reproduces the benchmark's exact observation:
  `task view --json` has no `title` key; non-JSON `task view` prints `${t.title}` which is
  `undefined` → literal string `"undefined"` in the output. **Confirmed this is Core-CLI +
  native-provider specific**, not present on the github provider: `packages/quay-github/src/
  github-client.js`'s `taskWrite` only PATCHes fields on an ALREADY-EXISTING issue (no
  create-via-write upsert path at all — `Object.prototype.hasOwnProperty.call(fields, "title")`
  gates every field write, line ~679) — the github provider has no code path that can silently
  create a titleless issue this way, so no github-side test/fix is needed for GAP-002 itself.
- **GAP-001's standalone `quay-native` binary is NOT the same surface as the Core CLI, and its own
  `task create` verb does not actually fix GAP-002's failure mode either.** Direct inspection
  (`packages/quay-native/bin/quay-native.js` lines 157-175) shows `quay-native` (a SEPARATE
  entry point, not the Core CLI `quay` that GAP-001/GAP-002 were found against) already has its own
  dedicated `task create <id> [--title ...]` verb — but it does NOT mandate `--title`: line 165
  defaults `title: flags.title ?? id` (falls back to the id string, never `undefined`). This is a
  DIFFERENT bug shape (silently using the id as a fake title, not silently omitting the field) and
  is NOT itself GAP-002's mechanism (confirmed via `packages/quay-native/test/create-validation.
  test.mjs`, which only covers missing/empty `<id>`, never the missing-`--title` case). **This
  milestone's fix targets the Core CLI (`packages/quay/bin/quay.js`) exclusively** — `quay-native`'s
  own `task create` id-fallback behavior is a separate, lower-severity, NOT-in-scope observation
  (noted for a future candidate, not fixed here — see "Explicitly OUT of scope").
- **Fix-shape decision, made after reading the above (not assumed up front):** add a dedicated
  `quay task create <id> --title <title> [...]` verb to the Core CLI (`packages/quay/bin/quay.js`)
  that MANDATES `--title` at CLI-parsing level (hard usage error, no provider call made, if
  `--title` is missing/empty) — this is GAP-001's fix. Separately, harden `quay task edit <id>` for
  the create-via-upsert path specifically: since `task edit`'s own contract (per its `--help` and
  design intent) is "patch an existing task," and the actual silent-corruption failure mode is
  specific to editing a NON-EXISTENT id with no `--title`, the fix adds an explicit guard in the
  Core CLI's `task edit` handler — if the target id does not currently exist (checked via a
  `taskGet` read before the `taskWrite` patch call) AND no `--title` was supplied, refuse with a
  clear usage error (e.g. "quay task edit: task <id> does not exist yet; creating a new task requires
  --title (or use 'quay task create')") rather than silently upserting a titleless record. This
  covers GAP-002 directly (no code path can any longer reach `store.js#write()`'s title-omission
  case with title `undefined`, because the CLI now refuses before making the call) while GAP-001's
  new `task create` verb gives the ergonomic, discoverable alternative the benchmark's own
  disposition text recommends. **Both changes together are treated as ONE combined Done-when
  clause**, per the task-store row's own suggested combination, with the stated reason: the `task
  edit`-side guard is the actual correctness fix (closes GAP-002 unconditionally, including for any
  caller that never learns about the new `create` verb), and `task create` is the structural/
  ergonomic complement GAP-001 asks for — neither alone is a complete disposition of both findings.
- **G-02 re-verified live, still real, unchanged since M27.** `node packages/quay/bin/quay.js --help`
  (run directly at charter-authoring time) shows only `quay task edit <task-id> --status <status>
  [--json]` in the Usage block — no mention of `--title/--body/--body-file/--labels/--extra/
  --parent/--children/--expect-status/--append-notes`, all of which the code has supported since
  M16-cli-edit-parity-impl (confirmed present in `quay.js` lines 401-467). Small, low-risk,
  documentation-only fix: update the `--help` text (and the `Usage:`/`Options for task edit:` block)
  to list the actual flag surface, including the new `--title`-mandatory-for-create semantics and
  the new `task create` verb.
- **GAP-007 (MCP per-call subprocess latency) — explicit judgment call: MEASURED/DOCUMENTED, NOT
  FIXED, this milestone.** M27's own finding: quay's per-call MCP subprocess handshake (fresh Node
  process per CLI invocation) is ~2.6x slower per call than `backlog.md` for the same
  local-filesystem operation class — a real but architecturally large-scope performance item (would
  likely require a persistent-daemon or connection-reuse redesign of `provider-client.js`'s
  `connectProvider()` spawn-per-call model, touching the CLI/MCP-client boundary broadly, not a
  small localized change). Bundling a latency-architecture change into the SAME milestone as a
  correctness/data-integrity fix would risk exactly the OVER-SIZED failure mode `inherited-core.md`'s
  size gauge warns about (forced new build work / mid-milestone re-scope) and would dilute the
  TDD/dual-iteration rigor this milestone's correctness fix needs. **Judgment: GAP-007 is
  RE-CONFIRMED (re-measured, see Done-when below) and explicitly LOGGED as a future-candidate
  disposition — not attempted here.** This mirrors M28's own explicit discrepancy-correction
  judgment-call style: stated plainly, not silently dropped.
- **Development-class milestone diversity-policy check, re-verified (not assumed).** Grepped
  `inherited-core.md` directly: its "Two-class diversity policy" text (both occurrences) still
  states the narrower N-independent-proposal pattern is gated on "the `quay-task-to-plan` skill...
  does not yet exist." **Discrepancy found and flagged, not silently overridden:** the skill's files
  DO now exist on disk — `.claude/skills/quay-task-to-plan/SKILL.md` (26.9 KB, dated 2026-07-18,
  built by M20/M22) is a real, substantial skill implementing Phase 6 (proposal + adjudication +
  write-back) and Phase 7 (plan + TDD gate) of `docs/plans/3-7-quay-task-to-plan-skill.md`. However,
  that same SKILL.md's own text (lines ~29-37) states explicitly: **"`OUTER-LOOP.md` DISPATCH wiring
  and de-optionalizing the two-class diversity policy remain explicitly OUT OF SCOPE for this skill
  as currently built... nothing in `OUTER-LOOP.md` dispatches it automatically yet"** — i.e. the
  skill's own build explicitly declined to flip `inherited-core.md`'s policy precondition, by
  design, pending a future wiring milestone. Given that the skill's own text disclaims automatic
  availability and `inherited-core.md`'s policy text (the actual gating substrate `OUTER-LOOP.md`
  step 1 reads) has not been updated/consolidated to reflect the skill's existence, this charter
  treats the precondition as **NOT YET SATISFIED** (conservative reading — the skill exists but is
  not adopted into the outer loop's own gating policy) and uses the **STANDARD whole-milestone
  2-independent-iteration dual pattern**, per the charter-authoring instruction. This discrepancy
  (skill built, precondition text stale, skill's own text disclaims auto-wiring) is flagged here for
  a future SELECT/DRAIN pass to reconcile `inherited-core.md`'s policy text against the skill's
  actual M20/M22 build state — not silently resolved either way by this charter.
- **`node --test --test-concurrency=1 packages/*/test/*.test.mjs` is the real, confirmed full-suite
  invocation** (same command M27/M28 used) — run as the PRE-fix baseline at charter-authoring time;
  raw output pasted by the dispatched iteration in its own report (not reproduced here, per
  charter-thinness — the dispatched iteration re-runs this fresh in its own worktree regardless).

## In-scope work
1. **Fix GAP-002 + GAP-001 together (combined Done-when, reason stated above).** In
   `packages/quay/bin/quay.js`: (a) add a `quay task create <id> --title <title> [--body ...]
   [--labels ...] [--parent ...] [--json]` verb that hard-fails (usage error, no provider call) if
   `--title` is missing or empty; (b) harden `task edit`'s existing handler so that editing a
   currently-non-existent `<id>` with no `--title` supplied refuses with a clear usage error
   instead of silently upserting a titleless record (a `taskGet` existence check before the
   `taskWrite` patch call). TDD discipline: write a RED test reproducing GAP-002 exactly as M27
   found it (`task edit <new-id> --status todo` on a fresh scratch native-provider store, then
   `task view --json` — assert this currently produces either no `title` key or the literal string
   `undefined`), confirm RED against the pre-fix code, then implement until GREEN. Add equivalent
   RED→GREEN coverage for the new `task create` verb's `--title`-mandatory behavior.
2. **Fix G-02 — stale `--help` text.** Update `quay.js`'s help/usage text to list `task edit`'s full
   flag surface (`--title/--body/--body-file/--labels/--extra/--parent/--children/--expect-status/
   --append-notes`, already implemented per M16-cli-edit-parity) and document the new `task create`
   verb from item 1. Small, low-risk, no test-suite behavior change (help text has no existing
   automated assertion found in the codebase at charter-authoring time — the dispatched iteration
   should add one asserting the flag list appears, closing that gap as part of this fix rather than
   leaving the corrected text itself unverified).
3. **GAP-007 — measure and document, explicit non-fix (judgment call stated above).** Re-run a
   focused timing comparison (Core CLI `task edit`/`task view` per-call latency vs. `backlog.md`,
   same shape as M27's own methodology, a handful of calls is sufficient — this is a re-confirmation,
   not a full re-benchmark) to confirm the ~2.6x finding still holds post-fix (items 1-2 should not
   materially change per-call latency, since the fix adds one extra `taskGet` read on the create-path
   only, not on every call). Record the re-measured numbers and an explicit future-candidate
   disposition (e.g. persistent-daemon or connection-reuse redesign of `provider-client.js`) in this
   milestone's report. **No latency-architecture code change is made.**

## Explicitly OUT of scope this milestone
- **No latency-architecture fix for GAP-007** — measured/documented only, per the judgment call
  above; a future SELECT candidate, not built here.
- **No fix to `quay-native`'s own separate `task create` verb's id-fallback-as-title behavior**
  (noted above as a different, lower-severity bug than GAP-002, discovered incidentally while
  reading the current source) — out of scope for this milestone's anchor findings; log as a
  future-candidate observation in this milestone's report, do not fix inline.
- **No GAP-003/004/005/006/008, no G-01/G-03 through G-14** (other than G-02) — none of these are
  quay-side actionable per M27's own disposition, or are not part of this milestone's anchor finding.
- **No Web UI, GitHub provider, or MCP tool-surface changes** beyond what item 1's Core-CLI fix
  strictly requires (a read-then-write existence check inside the Core CLI's own `task edit`
  handler — no new Provider-ABI tool, no MCP server change).
- **No work toward M-WEBUI-TRIGGER-HONESTY, M-NATIVE-RELATION-SYNC, or M-CLI-GATE-ENFORCEMENT** —
  separate, not-selected-this-pass candidates from the same m28→m29 DRAIN batch.
- **No touching the real experiment `tasks/` directory for any manual/scratch testing.** Any
  scratch task-store instance used to reproduce/verify GAP-002 (or exercise the new `task create`
  verb) MUST be a throwaway directory (e.g. `QUAY_NATIVE_TASKS_DIR`-pointed `/tmp/...` scratch,
  mirroring `create-validation.test.mjs`'s/`edit-validation.test.mjs`'s own existing pattern) — never
  the real `tasks/` at repo root. No GitHub scratch issues are needed (native-provider-only bug).
- **No re-scoping GAP-001/GAP-002's combined treatment without the stated reason above** — adding or
  splitting requires an explicit stated reason in the charter or, if discovered mid-dispatch, in the
  iteration's own evidence trail.

## Line budget: small-milestone norm (no ceiling-expansion regime)
This milestone's in-scope list (3 top-level items above) is well under the small-milestone norm's
item-count proxy threshold (8) — no `Line budget: <N>` declaration over 2000 is warranted, no
phase/stage decomposition plan is required.

**Plan-time line-budget gate result (run at charter-authoring time, real output):**
```
$ experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh experiments/quay-perpetual-stream/charters/M29-cli-create-ergonomics.md
PASS: experiments/quay-perpetual-stream/charters/M29-cli-create-ergonomics.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
```

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` **Pre-fix baseline**: full existing test suite (`node --test --test-concurrency=1
   packages/*/test/*.test.mjs`) run and its raw pass/fail summary pasted, confirming the starting
   state (no regression assumed, actually run).
2. `[ ]` **RED**: a new test reproducing GAP-002 exactly (`task edit <new-id> --status todo`, no
   `--title`, against a scratch native-provider store — never the real `tasks/`) is written and
   shown FAILING (or, post-guard, shown correctly refusing) against the pre-fix code — pasted raw
   test-runner output.
3. `[ ]` **GREEN — combined GAP-002+GAP-001 fix (item 1)** implemented: (a) `quay task create <id>
   --title <title> [...]` verb added to `packages/quay/bin/quay.js`, hard-fails without `--title`;
   (b) `task edit` on a non-existent `<id>` with no `--title` refuses with a clear usage error
   instead of silently upserting a titleless record. New/updated tests pass — pasted raw output.
   Neither `store.js` (native provider) nor `github-client.js` is modified — the fix is entirely at
   the Core-CLI parsing layer (confirmed via `git diff --stat`, clause 8 below).
4. `[ ]` **G-02 fix (item 2)**: `--help`/usage text updated to list `task edit`'s full flag surface
   and the new `task create` verb; a new test asserting the corrected help text is added and passes
   — pasted raw output.
5. `[ ]` **GAP-007 re-measurement (item 3)**: focused timing comparison re-run, numbers pasted,
   explicit future-candidate disposition recorded in the milestone's report — no code change made
   for this item, confirmed via `git diff --stat` (clause 8).
6. `[ ]` **Post-fix full suite**: full existing test suite re-run (`node --test --test-concurrency=1
   packages/*/test/*.test.mjs`), 0 unexplained failures (any flake must be diagnosed to the same
   root cause class M27/M28 already documented — concurrent live-fixture GitHub tests racing across
   iteration worktrees — and confirmed clean on an isolated re-run, not silently waved off) — pasted
   raw output.
7. `[ ]` Written report exists (e.g. `experiments/quay-perpetual-stream/milestones/
   M29-cli-create-ergonomics/report.md`) covering: the RED→GREEN TDD trail for GAP-002/GAP-001, the
   G-02 fix, the GAP-007 re-measurement + disposition, and the `quay-native`-own id-fallback
   observation logged as a future-candidate note (not fixed).
8. `[ ]` `git diff --stat` against the base commit (`f7b3a0bf8aba98ee8e4d3f52eeedf93795a95fb4`)
   shows a scoped, small product-code diff confined to `packages/quay/` (bin/quay.js + its own
   test file(s)) plus this milestone's report — explicitly NOT expecting an empty diff (unlike
   M25-M28), but confirmed to touch no files outside `packages/quay/` and this milestone's own
   `experiments/.../M29-cli-create-ergonomics/` tree — pasted raw output.
9. `[ ]` No real-repo litter: confirm (pasted check) the real `tasks/` directory at repo root is
   unchanged by any scratch reproduction/verification step for GAP-002/`task create`.

Milestone is DONE when all nine are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first. Real independent-re-derivation material for iteration-1:
whether iteration-0's RED test genuinely reproduces GAP-002's exact mechanism (not a weaker/
different-shaped bug), whether the `task edit`-side guard actually closes every code path that could
reach `store.js#write()`'s title-omission case (not just the one CLI invocation iteration-0 tested —
e.g. does `--body`-only, `--labels`-only, or any other single-non-title-flag `task edit` on a
non-existent id still get refused correctly?), whether the new `task create` verb's `--title`
enforcement is genuinely a hard usage error with no provider call made (not merely a warning),
whether the G-02 help-text fix is complete against the actual current flag surface (not a partial
list), and whether GAP-007's re-measured numbers are independently recomputed (not copied from
iteration-0's report) — iteration-1 must independently re-derive/re-verify these from a fresh
worktree, per the explicit skepticism instruction in "Dispatcher notes" below.

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch. Run at charter-authoring time, directly against this file:
```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M29-cli-create-ergonomics.md
PASS: experiments/quay-perpetual-stream/charters/M29-cli-create-ergonomics.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```
(Same hash, unchanged since M06's original citation, reused unchanged through M28 per that
milestone's own citation — no drift; re-run once more immediately before dispatch as standard
practice.)

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive · (3) ceiling→redesign-OR-stop · (4) budget≈10 backstop, past→default HALT ·
(5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — N/A in the `gap-list.md`-id sense (task-store/benchmark-report
   sourced, same confirmed limitation as M13/M21-M28). GAP-001/GAP-002/GAP-007/G-02's presence in
   `benchmark-report.md` and live re-verification against current source (see "Current-state notes"
   above) are the direct evidence checked at charter-authoring time.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted raw output (test-runner
   output, `--help` text, `git diff --stat`, timing numbers) — no clause is narrative-only.
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s concrete decision procedure: Step 1,
   this milestone's Done-when list requires a real test-suite run (self-executed by the iteration
   that also writes the fix — self-referential in isolation, same as any local `node --test` run)
   PLUS the standard whole-milestone iteration-1 independent re-derivation (fresh worktree, fresh
   RED-test re-derivation, per "Dispatcher notes" below). Step 2, is iteration-0's own local test run
   self-referential? Yes (same process/assumptions). Step 3, per this domain's own established
   pattern (CLI/product-code milestones in this stream, e.g. M16-cli-edit-parity-impl), the
   INDEPENDENT mechanism is iteration-1 itself — a fresh worktree, fresh `npm install`, independently
   re-deriving the RED test and re-verifying the fix from scratch rather than trusting iteration-0's
   prose (this is the standard development-class dual-iteration pattern's own audit channel, not a
   separate CI/browser mechanism — no Web UI or cross-service surface is touched by this milestone,
   so the CI-job/browser-engine channels other milestones use do not apply here). Step 4, the same
   mechanism (iteration-1's fresh independent re-run) serves both the it0 declaration and the actual
   iteration-time verification — no divergence.
e. **Plan-time line-budget gate** — PASS (3 top-level in-scope items, well under threshold 8; no
   `Line budget: <N>` over 2000 declared) — full command + PASS output in "Line budget" section
   above.

## Adversarial-audit gate — evaluate at ABSORB (state explicitly, not here)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) fires here — this milestone
IS capability-growth-typed (per the value hypothesis above) and its ABSORB will append a nonzero
(small positive) VT Δv. **The adversarial-audit role MUST be dispatched at ABSORB for this
milestone** (unlike M25-M28, which were exempt by default as no-VT-weight methodology-infra). Do
not pre-judge the verdict here — state plainly at ABSORB, per the documented-no-op discipline
(inapplicable-exemption case does not apply this time; the audit is REQUIRED).

## V_meta consolidation-lag gate — evaluate at ABSORB (state explicitly, not here)
Check every `v-meta-ledger.md` row with status `confirmed`-but-not-`consolidated` against the K=2
alarm threshold at ABSORB time. Do not pre-judge the outcome here — state the check's real outcome
in the ABSORB log entry.

## Design-only-milestone impl-row gate — evaluate at ABSORB (state explicitly, not here)
This milestone is not design-only (it ships real product-code changes with tests, not a design doc
with a future-implementer checklist) — but do not pre-judge this at charter-authoring time. Run
`it0-impl-row-check.sh exp5-M-QUAY-CLI-CREATE-ERGONOMICS backlog.md` at ABSORB and paste the real
output as part of the closing evidence, per the standing gate's own invocation convention.

## DoD meta-enforcer gate — evaluate at ABSORB (state explicitly, not here)
Per DIR-017/M25, `scripts/it0-dod-check.sh` must run against this milestone's charter + backlog row
+ ABSORB-entry text before `milestone_counter++` may execute (HARD BLOCK, same shape as the other
three gates above). Do not pre-judge PASS/FAIL here. This will be the DoD meta-enforcer's FIFTH-ever
real (non-fixture, non-self-referential) test (M25 self-check → M26 → M27 → M28 → this milestone).

## Note for ABSORB
1. **State explicitly whether the adversarial-audit gate (REQUIRED this time, see above) found any
   REFUTED or CONCERNS-level issue** — this is the first capability-growth-typed, VT-scoring
   milestone since early in the stream to trigger this gate for real (as opposed to the documented
   no-op most of M25-M28 recorded); treat its outcome as load-bearing evidence on whether the gate
   still functions correctly against a real product-code change, not just a doc-only deliverable.
2. **State explicitly whether the development-class diversity-policy discrepancy flagged above
   (skill built at M20/M22 but `inherited-core.md`'s policy text/precondition not yet updated to
   reflect it) should be resolved** — either by a future consolidation edit to `inherited-core.md`
   (if the skill's own "not yet wired" disclaimer is judged satisfied enough to flip the
   precondition) or by leaving it open pending an explicit wiring milestone. This charter did NOT
   resolve it either way (used the conservative/standard pattern) — the ABSORB entry should record
   whether that conservative choice, in hindsight, was correct/necessary or whether the narrower
   pattern could safely have been used.
3. **State explicitly how the RED→GREEN TDD discipline actually played out** — did iteration-0
   genuinely write a failing test BEFORE the fix (not a fix-then-retrofit test), and did iteration-1
   independently confirm the same RED→GREEN shape from its own fresh worktree.
4. **State explicitly GAP-007's re-measured numbers and whether the "measure, don't fix" judgment
   call (see charter's Current-state notes) held up as the right sizing decision** — i.e. did
   staying correctness-only keep this milestone correctly-sized per the size gauge (iteration-1 had
   real material to re-derive, no forced new build work, no mid-milestone re-scope)?
5. **Confirm the realized Δv** (small positive, CLI surface) against the predicted `Δv̂ ≈ 0.5` stated
   above, and record the calibration error.

## Dispatcher notes
**Standard 2-iteration whole-milestone dual pattern** (development-class, per the two-class
diversity policy — narrower N-independent-proposal pattern NOT used, see "Current-state notes"
discrepancy flag above): iteration-0 (build: RED test, GREEN fix for items 1-2, GAP-007
re-measurement for item 3, full test suite before/after, report) + iteration-1 (fresh worktree,
independent re-derivation, explicitly told NOT to read iteration-0's worktree, branch, or report —
independently re-derives the RED test, independently re-verifies the GREEN fix closes every relevant
code path, independently re-runs the full test suite, independently re-measures GAP-007's timing,
and actively looks for a case iteration-0's fix might have missed, per the skepticism instruction
below). **Both worktrees created off `exp5-outer-driver` HEAD, not `master`** (DIR-018 /
M23-outer-driver-isolation discipline). Base commit for both M29 iteration worktrees/branches:
`exp5-outer-driver` HEAD at charter-authoring time, confirmed via `git rev-parse exp5-outer-driver`
→ **`f7b3a0bf8aba98ee8e4d3f52eeedf93795a95fb4`** (the SELECT-m29 commit itself — no drift since
SELECT). Worktree/branch paths: `experiments/quay-perpetual-stream/milestones/
M29-cli-create-ergonomics/worktrees/iteration-{0,1}`, branches `exp5-m29-iteration-{0,1}`. Merge
iteration-0/iteration-1 results into `exp5-outer-driver` first (per-file conflict resolution,
reconciliation notes per DIR-018 item 3's no-silent-drop discipline); only THEN merge
`exp5-outer-driver` → `master` as the single ABSORB publish commit (`git checkout master && git
merge --no-ff exp5-outer-driver`), sequenced after the adversarial-audit gate (REQUIRED this time),
V_meta consolidation-lag gate, design-only-milestone impl-row gate, AND the DoD meta-enforcer gate
all clear.

**iteration-1 skepticism instruction (explicit, not optional):** given this is a real
product-code/data-integrity fix (not a doc-only deliverable), iteration-1 must NOT simply read
iteration-0's report and rubber-stamp its RED→GREEN claims or its `git diff --stat` scope claim.
iteration-1 independently: (a) writes its OWN RED test reproducing GAP-002 from the charter's
mechanism description (not copying iteration-0's test file), confirms it fails the same way against
the pre-fix code in its own fresh worktree; (b) tries variant reproduction shapes iteration-0's own
test might not have covered (e.g. `--body`-only instead of `--status`-only, on a non-existent id,
with no `--title`) to check the guard is genuinely comprehensive, not narrowly patched to the exact
shape of the one reproduction M27 happened to use; (c) independently re-runs the full test suite
from a clean worktree; (d) independently re-measures GAP-007's timing numbers rather than trusting
iteration-0's pasted figures; (e) independently confirms the `git diff --stat` scope claim (files
touched confined to `packages/quay/` + this milestone's own tree). This mirrors M26/M27/M28's own
iteration-1-skepticism instruction, applied here to a real correctness-fix context: the risk is not
a rigged fixture, it is a fix that closes the ONE reproduction path tested while leaving a sibling
path (a different flag combination, a different provider) still silently vulnerable.
