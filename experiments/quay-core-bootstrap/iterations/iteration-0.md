# Iteration 0: Baseline — inherited state, experiment 2's starting scores

**Date**: 2026-07-16
**Driver**: Seed (no QC-* tasks have been through native authoring/execution/gating yet). This iteration is purely observational.
**Instance objectives advanced**: none — observational
**V_meta triggers checked**: all four re-trigger conditions checked; none fired (see §8)

---

## 1. Context from prior iteration

This is iteration 0 — no prior iteration exists within experiment 2. Inheritance boundary:

- Experiment 1 final state (iteration 88): V_instance = 0.6016, V_meta = 0.0973, σ_strict = 62/73 = 0.8493.
- Experiment 2's own V_instance factors start from fresh measurement against four new "Done when" clauses (protocol §4). Experiment 2 does NOT inherit experiment 1's V_instance score — those were different factors.
- V_meta is inherited at 0.0973 (product of experiment 1's final per-factor values) per protocol §5.
- σ_QC = 0/0 (no QC-* tasks yet).
- No prior problems list — this iteration establishes the baseline.

---

## 2. Preconditions checked

Per §0 of ITERATION-PROMPTS.md:

- **[ ] manda daemon live (http://localhost:28912)**: NOT CONFIRMED. `curl http://localhost:28912/healthz` returned connection refused (exit 7). The manda daemon is not reachable on port 28912 in this session's execution context.
- **[ ] manda monitor is a DIRECT CHILD of this session's own process tree**: NOT CONFIRMED. `ps aux | grep "manda monitor"` shows two monitor processes: PID 203534 (`manda monitor terminal --root .`, PPID 203514, bash shell started at 11:03) and PID 720369 (`manda monitor cord --root .`, PPID 720349, bash shell started at 14:06). Neither is a direct child of this session's tool-invocation process tree — these are separate sessions from earlier in the day. The mechanized ps-based G6 check per ITERATION-PROMPTS.md §0 cannot be confirmed.
- **[x] experiments/quay-core-bootstrap/provenance.md read**: confirmed read in full.
- **[x] previous iteration's report read**: N/A — iteration 0 has no predecessor within this experiment.
- **[x] experiments/quay-core-bootstrap/directives/pending/ listed**: directory is empty. No pending directives exist in experiment 2's own directives/pending/ directory.
- **[x] V_meta re-trigger conditions checked**: all four checked against this iteration's observations. None fired (see §8).
- **[ ] Both dispatches confirmed run_in_background=true (§0a)**: N/A — iteration 0 is purely observational; no subagent dispatches were made. No QC-* task was executed; no G3 audit was dispatched.

**G6 status decision**: The manda daemon check is a §0 precondition, but this iteration is purely observational (measuring existing state, no code changes, no task execution). The G6 check is formally NOT CONFIRMED. This is recorded honestly, not papered over. The precondition check failure does not block the observational measurement work of iteration 0. Any future iteration that executes QC-* tasks must confirm G6 before proceeding.

---

## 3. Observe

### 3a. core_abi_symmetry — instance objective 1

**"Done when" clause (protocol §4 item 1)**: "that script exists, covers every Core MCP tool surface also reachable via CLI and Web UI, runs in the automated suite, and every symmetry gap it finds is either closed or explicitly tracked as its own task."

**Current state**: `packages/quay/test/core-three-way-symmetry.test.mjs` exists. It was filed as QN-044 (DIR-010) in experiment 1 and is `status: done`. The script covers:
- Capability 1 (task-list rendering): CLI via `quay task list --json`, Core MCP via `task_list` tool, Web UI via `GET /` — all three legs, cross-leg agreement asserted.
- Capability 2 (task-detail rendering): CLI via `quay task view <id> --json`, Core MCP via `task_get` tool, Web UI via `GET /task/<id>` — all three legs, cross-leg agreement asserted.
- Capability 3 (action-button triggering): CLI via `quay action list`/`quay action run`, Core MCP via `action_list`/`action_run` tools, Web UI via POST of the action button route — all three legs, cross-leg agreement asserted. Uses `QUAY_ACTION_MOCK_LOG` for deterministic action delivery (never depends on live manda).

The scope is defined by `quay-proposal.md §9`'s listed shared capability set (task-list, task-detail, action-button). `task edit` and `task check` are explicitly excluded per the directive's own instruction (they were added after §9 was written and were never proposed for the Web UI — their absence is correct, not a gap).

The Core MCP server (`packages/quay/src/mcp-server.js`) exposes six tools: `task_list`, `task_get`, `task_write`, `task_check`, `action_list`, `action_run`. Of these: `task_list`, `task_get`, `action_list`, and `action_run` are reachable via all three surfaces (CLI + Core MCP + Web UI). `task_write` and `task_check` have CLI and Core MCP bindings but no Web UI binding — their absence from the Web UI is correctly not a gap per the directive's own scope definition.

The script runs in the automated suite: `node --test packages/quay/test/*.test.mjs` discovers and runs it. Full test run as of this iteration: `node --test packages/*/test/*.test.mjs` → tests 28, pass 28, fail 0 — includes this test.

Declined leads in the test (documented in the file): filter-value equivalence for `task_list`, and the non-existent-id error-reporting-mode asymmetry between CLI (stderr + exit code) and MCP (isError:true JSON) — both explicitly documented as non-gaps (the latter is a structural asymmetry in reporting mode, not schema, with no JSON-vs-JSON shape to compare).

**Gap vs. "Done when"**: The script covers all three surfaces for every Core MCP tool reachable from all three surfaces. No symmetry gaps were found; the excluded items are correctly not gaps. The one remaining "Done when" element — "every symmetry gap either closed or explicitly tracked as its own QC-* task" — is vacuously satisfied (no gaps to track). However, this work was done under QN-044 (experiment 1 scope), not driven by any QC-* task through experiment 2's own methodology. The script pre-exists experiment 2; experiment 2 has not yet independently verified this work via its own QC-* task.

**Score**: 0.8. Script exists, covers all Core MCP tools reachable via CLI and Web UI, runs in automated suite. The 1.0 increment would require experiment 2's own QC-* verification pass and tracking any new gaps found — not yet done.

### 3b. web_ui_verification — instance objective 2

**"Done when" clause (protocol §4 item 2)**: "every Web UI page/flow currently reachable in `packages/quay` has at least one browser-automation-driven test confirming its current behavior."

**Current state**: No browser-automation tests exist in `packages/quay/test/`. The file `packages/quay/test/serve-browser-render.test.mjs` exists (QN-046) but is NOT a browser-automation test — its own header explicitly states: "This automated regression test cannot itself drive a real browser (no browser-automation MCP tooling or headless-browser npm package is importable from a plain `node test.mjs` process in this repo)." It asserts Content-Type header values and raw byte sequences using Node's `http` module — a regression test for the root-caused condition (charset=utf-8 Content-Type header), not a browser-driven verification.

The file `serve.test.mjs`, `serve-github.test.mjs`, `core-three-way-symmetry.test.mjs` all use Node's `http.get`/`http.request` directly — HTTP-level, not browser-automation.

Currently reachable pages/flows in `packages/quay/src/serve.js`:
- `GET /` — task list page
- `GET /task/<id>` — task detail page
- `POST /task/<id>/action/<actionId>` — action button trigger (redirects to detail)

None of these have browser-automation-driven tests (chrome-devtools or playwright MCP). The live browser session from experiment 1 (QN-046, recorded in experiments/quay-native-bootstrap/iterations/iteration-35.md) was a one-time human-assisted verification run, not a committed automated test.

**Score**: 0.0. No browser-automation tests committed.

### 3c. action_delivery_mode — instance objective 3

**"Done when" clause (protocol §4 item 3)**: "recording mode exists, is the default in the automated test harness (CI-equivalent run does not require a live manda daemon to pass), and at least one live-manda delivery check exists as a separate, clearly-labeled, non-blocking check."

**Current state**: The mock/log-file recording mode EXISTS. In `packages/quay/src/action.js`, `deliverTrigger()` checks `if (mockLogPath)` first — if `QUAY_ACTION_MOCK_LOG` is set (or `mockLogPath` is passed directly), mock mode is selected, appending a structured JSON-lines record to the specified file. This is a real, implemented feature (QN-042/DIR-009).

The CI-equivalent test run (`node --test packages/*/test/*.test.mjs`) passes without a live manda daemon: all 28 tests pass, manda is not required. Individual test files using `QUAY_ACTION_MOCK_LOG` or the direct `mockLogPath` argument: `action-mock-delivery.test.mjs`, `core-three-way-symmetry.test.mjs`, `cli.test.mjs`. The `serve.test.mjs` uses the `delivered: 'print'` path (manda not available at test time, no mockLogPath set) — also non-blocking.

However, the mock mode is NOT the **default** in the test harness — it is opt-in, requiring the caller to explicitly set `QUAY_ACTION_MOCK_LOG`. A test run that doesn't set this env var falls through to the manda or print-degrade path. The test suite passes anyway (no manda required), but the recording mode is not "the default."

Additionally, there is NO separate, clearly-labeled, non-blocking live-manda delivery check in the test suite. The `action-mock-delivery.test.mjs` explicitly avoids asserting on live manda; the test that runs without mockLogPath uses a try/catch that tolerates either outcome without asserting `delivered === 'manda'`. There is no test labeled "live manda delivery check (non-blocking, separate)."

**Score**: 0.5. Recording mode exists. The CI-equivalent run passes without live manda. But the recording mode is not the default (opt-in only), and the separate labeled live-manda check is absent.

### 3d. native_backlog_health — instance objective 4

**"Done when" clause (protocol §4 item 4)**: "none of quay-native's 8 V-factors has regressed below experiment 1's final (stop-time) snapshot values."

**Experiment 1's final 8 V-factor values (from CLOSING-REPORT.md / iteration-88.md)**:

V_instance (experiment 1's factors, not experiment 2's):
- skeleton = 0.85
- abi_symmetry = 0.97
- gate_correctness = 0.76
- skill_convergence = 0.96
- V_instance = 0.6016

V_meta (the same four factors this experiment also tracks):
- completeness = 0.74
- effectiveness = 0.26
- reusability = 0.79
- validation = 0.64 (tracks σ_strict; σ_strict = 0.8493 at halt)
- V_meta = 0.0973

**Current test suite run**: `node --test packages/*/test/*.test.mjs` → tests 28, pass 28, fail 0. This matches experiment 1's own final snapshot (iteration 88 recorded "tests 28, pass 28, fail 0"). Including:
- `node abi-symmetry.mjs` (standalone script, not node --test discoverable): output ends with "ALL FOUR SURFACES SYMMETRIC" — abi_symmetry factor confirmed not regressed.
- quay-native tests: 9 pass (cas-write, compound-gate-recursive, compound-gate, create-validation, edit-validation, gate-checked-state, gate-correctness, gate-gameability, lock).
- quay-github tests: 9 pass.
- quay tests: 10 pass (action-mock-delivery, cli, config, core-three-way-symmetry, mcp-server, provider-env-symmetry, serve-browser-render, serve-github, serve, task-check).

No regressions detected. The full pass count (28) matches the experiment 1 final snapshot. Gate mechanics, lock, CAS write, compound gate recursion, gate-gameability boundary — all confirmed green.

**Score**: 1.0. No V-factor regressions from experiment 1's final snapshot values. This factor starts at 1 (protocol ITERATION-PROMPTS.md §"native_backlog_health" explicitly states "This factor starts at 1 at iteration 0 — no regressions inherited").

### V_meta re-trigger conditions checked (for this iteration's observations)

Per `.claude/skills/quay-native-methodology/reference/v-meta-stall-analysis.md` §"Re-trigger conditions":

1. **effectiveness re-trigger**: did any QC-* task arise that is organically scope-matched to stage-0 QN-006's shape (single-file, no/minimal source change, no network I/O)? **NO.** No QC-* tasks exist yet. No organically-arising timing-comparable task observed.

2. **reusability re-trigger**: did organic external demand appear for wider GitHub Provider `data.write` capability (AC/DoD-checkbox or body/title writes against a real issue)? **NO.** No such demand observed in this iteration.

3. **completeness re-trigger (gap discovery)**: was a new, previously-undocumented Skill Method-step gap found during unrelated work on the Skill files? **NO.** The Skill files were read fresh this iteration; no new gaps found. The standing environmental gap (no native fresh-context subagent-dispatch primitive unconditionally available) still applies per the inherited stall reason.

4. **completeness + reusability/effectiveness joint re-trigger**: did a reliable, unconditional native fresh-context subagent-dispatch primitive become available? **NO.** No `Agent` or `Task` tool is available in this session's execution context (ToolSearch would be needed to verify, but the §0b hard-rule and the existing history of conditional-async-only manda dispatch apply; no new primitive has been verified this iteration).

5. **Fallback rule (12-iteration check)**: N/A — this is iteration 0, the 12-iteration fallback does not yet apply.

**Result**: No re-trigger conditions fired. All four V_meta factors remain at inherited values.

---

## 4. Strategy

No strategic choice for iteration 0 — it is purely observational. The instance objective measurements above constitute this iteration's work.

The concrete problem list for the next iteration (feeds directly into iteration 1):

- **core_abi_symmetry (score 0.8)**: the existing script satisfies the "Done when" clause for coverage and automation, but experiment 2 has not yet independently verified this from its own QC-* perspective. Closing this gap to 1.0 requires a QC-* task that: (a) re-reads the script and the Core MCP server's full tool surface, (b) confirms no new Core MCP tools have been added since QN-044 that are not covered, (c) verifies the "track or close every gap" obligation is current, and (d) explicitly notes any new declined leads as QC-* tracked or confirmed-not-gaps.
- **web_ui_verification (score 0.0)**: the entire gap. No browser-automation tests exist. The natural first step is a QC-* task to write a committed playwright-based or chrome-devtools-based test for at least the `GET /` task-list page, confirming existing behavior.
- **action_delivery_mode (score 0.5)**: two gaps: (1) make the mock mode the default in the test harness (not just opt-in via env var), and (2) add at least one clearly-labeled, non-blocking live-manda delivery check as a separate test.
- **native_backlog_health (score 1.0)**: no action needed at iteration 0. Must be re-confirmed every iteration after any Core code change.

**Which gap most directly advances V_instance toward the 0.80 threshold?** Currently V_instance = 0.8 × 0.0 × 0.5 × 1.0 = 0.0 (any zero factor collapses the product). `web_ui_verification` is the binding zero. The natural next iteration should target web_ui_verification (moving it from 0.0 to at least 0.5) — this is the highest-leverage step to make V_instance non-zero. Note: even moving web_ui_verification to 0.5 gives V_instance = 0.8 × 0.5 × 0.5 × 1.0 = 0.20; moving it to 1.0 with other factors held gives 0.8 × 1.0 × 0.5 × 1.0 = 0.40. Achieving 0.80 requires all four factors to improve.

---

## 5. Execution

This iteration is purely observational. No code was written, no tasks executed, no QC-* tasks created or driven.

Work performed:
- Read all required inheritance artifacts (provenance.md, EXTRACTION-SUMMARY.md, SKILL.md, patterns.md, v-meta-stall-analysis.md, gate-mechanics.md, g3-audit-discipline.md, quay-core-bootstrap-experiment-v2.md, CLOSING-REPORT.md, iteration-88.md).
- Surveyed `packages/quay/test/`, `packages/quay/src/action.js`, `packages/quay/src/mcp-server.js`, `packages/quay/bin/quay.js`, `packages/quay/src/serve.js`.
- Ran `node --test packages/*/test/*.test.mjs` → 28/28 pass.
- Ran `node packages/quay-native/test/abi-symmetry.mjs` → ALL FOUR SURFACES SYMMETRIC.
- Checked `experiments/quay-core-bootstrap/directives/pending/` → empty.
- Checked `experiments/quay-native-bootstrap/CLOSING-REPORT.md` §"Pending directives at stop time" for carried-forward items.
- Ran G6 ps-based check → manda daemon not reachable; no monitor is a direct child of this session.

---

## 6. Provenance update

No QC-* tasks were completed this iteration. σ_QC remains 0/0.

Per ITERATION-PROMPTS.md iteration 0 step 5: "If iteration 0 is purely observational (no tasks completed): add a narrative context note to provenance.md marking the inheritance record as confirmed and stating the initial V scores, but do NOT create phantom entries for work not actually done."

This has been recorded in `experiments/quay-core-bootstrap/provenance.md` (see separate update to that file).

- **σ_QC before this iteration**: 0/0 (no QC-* tasks)
- **σ_QC after this iteration**: 0/0 (unchanged)
- **Inherited floor**: σ_strict = 0.8493 (experiment 1's final value — noted separately, not substituted for σ_QC)

---

## 7. V_instance

- **core_abi_symmetry**: 0.8 — Script `core-three-way-symmetry.test.mjs` exists (QN-044, experiment 1), covers all three surfaces for the §9 capability set, runs in automated suite. Gap to 1.0: no QC-* task has independently verified this from experiment 2's own scope; any newly-added Core MCP tools since QN-044 would need tracking.
- **web_ui_verification**: 0.0 — No browser-automation tests (chrome-devtools or playwright MCP) committed for any page/flow. `serve-browser-render.test.mjs` is an HTTP-level regression test, not browser-automation. Reachable pages: GET /, GET /task/<id>, POST /task/<id>/action/<actionId>.
- **action_delivery_mode**: 0.5 — Recording mode (`QUAY_ACTION_MOCK_LOG` / direct `mockLogPath`) exists and the CI-equivalent harness passes without live manda (28/28 tests). Gaps: mock mode is opt-in (not the default); no separate, clearly-labeled, non-blocking live-manda delivery check exists.
- **native_backlog_health**: 1.0 — `node --test packages/*/test/*.test.mjs` → 28 pass, 0 fail. Matches experiment 1's final snapshot (iteration 88: 28/28). `abi-symmetry.mjs` standalone: ALL FOUR SURFACES SYMMETRIC. No regressions from experiment 1's stop-time values.
- **Total**: 0.8 × 0.0 × 0.5 × 1.0 = **0.0**

Note: the product collapses to zero because `web_ui_verification = 0.0`. The README.md pre-anticipated this as the starting state ("V_instance = 0.0 × 0.0 × 0.0 × 1.0 = 0" — the README listed core_abi_symmetry and action_delivery_mode as 0.0 based on the pre-iteration assessment before reading the actual code; the actual measured state shows those factors are non-zero, which is correct and consistent with the code that was built during experiment 1). The product is 0.0 regardless, due to web_ui_verification.

---

## 8. V_meta

These are inherited values — NOT re-derived from zero. Per protocol §5 and ITERATION-PROMPTS.md §"V_meta for this experiment": "Do NOT score these lower at iteration 0 without evidence of genuine regression."

- **completeness**: 0.74 — Re-trigger condition 3 (new undocumented Skill gap) did NOT fire. Re-trigger condition 4 (native fresh-context subagent-dispatch primitive unconditionally available) did NOT fire. Inherited stall reason from v-meta-stall-analysis.md: "Every documented Method-step gap in both Skill files carries an explicit 'Resolved'/'Fixed in iteration N' annotation, except one standing environmental gap: no native subagent-dispatch (fresh-context spawn) primitive existed for most of the experiment's life, re-confirmed absent via ToolSearch in essentially every iteration." This stall reason still holds — no new primitive was verified available this iteration. Stall diagnosis: SAME inherited reason (environmental, not Skill-content gap). No re-trigger fired.

- **effectiveness**: 0.26 — Re-trigger condition 1 (organically scope-matched task, single-file, no network I/O) did NOT fire. No QC-* tasks exist yet; no organically-arising timing comparison available. Inherited stall reason: "No organically-arising, scope-matched marginal-increment timing comparison has appeared in the backlog since iteration 22; manufacturing one solely for a timing data point would corrupt the metric (G5)." This stall reason still holds. Stall diagnosis: SAME inherited reason. No re-trigger fired.

- **reusability**: 0.79 — Re-trigger condition 2 (organic external demand for wider GitHub Provider `data.write` capability) did NOT fire. No demand for AC/DoD-checkbox or body/title writes against a real issue was observed. Inherited stall reason: "Genuine new GitHub-Provider `data.write` capability is blocked by a deliberate v1 scope decision (status-only writes, `packages/quay-github/DESIGN.md` QN-024) — independently confirmed at the code level in iteration 83 that no `body`/`title` write path exists in `github-client.js`." This stall reason still holds — no code change and no organic demand observed. Stall diagnosis: SAME inherited reason. No re-trigger fired.

- **validation**: 0.64 — Tracks experiment 2's own σ_QC as it grows; inherited floor is context only, not a substitution.
  - *Experiment 2's own σ_QC*: 0/0 (no QC-* tasks yet — numerator and denominator are both undefined; score is undefined, not 0.64).
  - *Inherited floor*: σ_strict = 0.8493 (experiment 1's final value, per EXTRACTION-SUMMARY.md). This is the inheritance floor — it is context for understanding where the methodology stands, not a score for experiment 2's own work.
  - *Inherited value carried forward*: 0.64 (inherited from experiment 1's own validation factor, which tracked σ_strict). At iteration 0, experiment 2 carries this forward unchanged, since σ_QC = 0/0. Stall diagnosis: SAME inherited reason (tracks σ_strict; σ_strict mechanically decreased at end of experiment 1 from 0.8611 → 0.8493 as seed-provenance tasks were added without matching native-provenance growth). No re-trigger fired.

- **Total**: 0.74 × 0.26 × 0.79 × 0.64 = **0.0973**
- **ΔV_meta from inherited baseline (0.0973)**: +0.0000 (no movement — this iteration establishes the inherited baseline; it does not claim movement)
- **Stall diagnosis summary**: All four factors carry the SAME inherited stall reason as experiment 1 documented. This is correct and expected at iteration 0 — no work has been done yet that could change any factor. The stall reasons should be expected to diverge or show movement as QC-* tasks complete in later iterations. If stall reasons are still SAME in iteration ~12 without evidence of a change, this becomes a finding requiring escalation (per ITERATION-PROMPTS.md §"V_meta honesty").

---

## 9. Out-of-band audit

G3 not triggered this iteration — no Core change, no V-factor lift. This iteration is purely observational; V_instance = 0.0 (unchanged from the pre-experiment baseline defined in README.md); V_meta = 0.0973 (inherited, not moved by this iteration's work). No adjudicate dispatch is warranted or appropriate.

---

## 10. Convergence Check

- **[ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)**: NO. V_instance = 0.0 (web_ui_verification = 0.0 collapses the product). V_meta = 0.0973 (an order of magnitude below 0.80, same as experiment 1's halted state).
- **[ ] 2. All 4 "Done when" clauses**: NO. core_abi_symmetry: 0.8 (not 1.0, no QC-* verification). web_ui_verification: 0.0 (no browser-automation tests). action_delivery_mode: 0.5 (recording mode exists but not default, no labeled live-manda check). native_backlog_health: 1.0 (satisfied, no regressions).
- **[ ] 3. V_meta genuine movement (≥2 factors, different stall reason)**: NO. No movement this iteration. All four factors at inherited values, all four stall reasons same as experiment 1's. Correct and expected at iteration 0 — this criterion applies when subsequent iterations have been run.
- **[ ] 4. Out-of-band audit (G3) green for all Core/lift tasks**: N/A. No Core change, no V-factor lift this iteration. Explicitly stated as N/A rather than silently omitted.
- **[ ] 5. Diminishing returns (ΔV < 0.02 for 2+ iterations, both V's)**: N/A. No prior iteration within this experiment to compare ΔV against.

**Status**: NOT CONVERGED. Expected and correct for iteration 0.

---

## Problems identified for next iteration

1. **web_ui_verification = 0.0 (binding zero)**: No browser-automation tests exist. This is the highest-priority target — it collapses V_instance to zero regardless of other factors. Next step: QC-0001 (or similar) — write at least one playwright-based or chrome-devtools-based test for `GET /` (task list page), confirming existing behavior without improving appearance/interactivity (G5). Do not use Node's `http` module for this — it must use browser-automation MCP tooling to count toward the factor.

2. **action_delivery_mode = 0.5**: Two gaps: (a) mock mode is opt-in via `QUAY_ACTION_MOCK_LOG`, not the default in the harness; (b) no separate, clearly-labeled, non-blocking live-manda delivery check. Advancing this factor requires changes to either the test infrastructure (make mock mode the default) or a separate test file explicitly labeled as the live-manda delivery check.

3. **core_abi_symmetry = 0.8**: Close to 1.0 but requires an explicit QC-* verification pass. The script pre-dates experiment 2's own QC-* methodology. A QC-* task verifying: (a) current Core MCP tool surface vs. test coverage, (b) any new tools since QN-044, (c) any new declined leads to track. Low-effort but necessary for honest 1.0 credit.

4. **V_meta stall tracking**: All four stall reasons are the SAME as experiment 1 documented. This is correct at iteration 0. After ~3-4 iterations, if any stall reason hasn't changed, document explicitly what experiment 2 tried that failed — that itself is finding value (the methodology refinement didn't work for that factor). Do not let "same inherited stall reason" calcify into an unexamined boilerplate note.

5. **G6 precondition**: manda daemon is not reachable in this session. Any future iteration that dispatches subagents or depends on manda must confirm G6 before proceeding. Do not assume the daemon is live from iteration 0's observation.
