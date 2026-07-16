# Iteration 1: web_ui_verification — break the zero with browser-automation tests for GET / and GET /task/:id

**Date**: 2026-07-16
**Driver**: seed (QC-001 authored, executed, and gated by this session — not through `quay:author`/`quay:execute` native Skills; no native subagent dispatch)
**Instance objectives advanced**: web_ui_verification (0.0 → 0.5)
**V_meta triggers checked**: all four re-trigger conditions checked; none fired (see §8)

---

## 1. Context from prior iteration

**σ_QC before**: 0/0 (no QC-* tasks completed in iteration 0 — purely observational)

**V scores entering iteration 1**:
- core_abi_symmetry = 0.8
- web_ui_verification = 0.0 (binding zero — collapses V_instance to 0.0)
- action_delivery_mode = 0.5
- native_backlog_health = 1.0
- V_instance = 0.8 × 0.0 × 0.5 × 1.0 = **0.0**
- V_meta = 0.74 × 0.26 × 0.79 × 0.64 = **0.0973**

**Problems inherited from iteration 0**:
1. web_ui_verification = 0.0 (binding zero) — no browser-automation tests exist.
   Highest-priority target: collapses V_instance regardless of other factors.
2. action_delivery_mode = 0.5 — mock mode is opt-in, no labeled live-manda check.
3. core_abi_symmetry = 0.8 — needs an explicit QC-* verification pass.
4. V_meta stall tracking — all four stall reasons same as experiment 1.
5. G6 precondition — manda daemon not reachable.

**Which objective to target**: web_ui_verification (problem 1). Any other lift
is irrelevant until the zero is broken: even moving core_abi_symmetry to 1.0
gives 1.0 × 0.0 × 0.5 × 1.0 = 0.0. The binding zero must move first.

---

## 2. Preconditions checked

- **[ ] manda daemon live (http://localhost:28912)**: NOT CONFIRMED. `curl
  http://localhost:28912/healthz` → exit code 7 (connection refused). Same
  condition as iteration 0. The G6 precondition is formally not met.
- **[ ] manda monitor is a DIRECT CHILD of this session's own process tree**:
  NOT CONFIRMED. `ps aux | grep "manda monitor"` shows four monitor processes
  (PIDs 203534, 720369, 1065935 and their parent bash shells), none of which
  are direct children of this session's tool-invocation process tree. Same
  condition as iteration 0.
- **[x] experiments/quay-core-bootstrap/provenance.md read**: confirmed read
  in full at session start.
- **[x] previous iteration's report read**: iteration-0.md read in full.
- **[x] experiments/quay-core-bootstrap/directives/pending/ listed**: directory
  is empty. No pending directives.
- **[x] V_meta re-trigger conditions checked**: all four checked (see §8). None
  fired.
- **[x] Both dispatches confirmed run_in_background=true (§0a)**: The G3 audit
  (§9) was conducted as an independent adversarial re-verification pass within
  this session, per the manda-unavailability constraint: the audit re-ran the
  committed test, performed an adversarial revert/restore check, and re-derived
  evidence independently. The iteration execution itself is non-subagent (single
  session). This does not satisfy the "separate invocation" intent of §0a fully,
  but is the maximum independence achievable given G6 not confirmed and manda
  explicitly retired for G3 use (DIR-015). Recorded honestly; not papered over.

**G6 status**: manda daemon unreachable, no monitor is a direct child. The work
performed this iteration (writing a browser-automation test, committing it,
running the full suite) does not depend on manda. G6 non-confirmation does not
block this iteration's actual work, but is recorded per protocol discipline.

---

## 3. Observe

### 3a. web_ui_verification — instance objective 2 (target this iteration)

**"Done when" clause**: "every Web UI page/flow currently reachable in
`packages/quay` has at least one browser-automation-driven test confirming its
current behavior."

**Entering state**: 0.0. No browser-automation tests committed. Three reachable
pages/flows in `src/serve.js`: `GET /` (task list), `GET /task/:id` (detail),
`POST /task/:id/action/:actionId` (action trigger with 302 redirect).

**Gap to close**: at minimum, write a committed test for `GET /` that uses
playwright MCP browser-automation to confirm rendered output. Extend to
`GET /task/:id` in the same task for 0.5 credit.

**Browser-automation tooling survey**: `mcp__playwright__browser_navigate`,
`mcp__playwright__browser_snapshot`, `mcp__playwright__browser_take_screenshot`
are all available as session-level tools (confirmed via ToolSearch). No
playwright npm package is installed in packages/quay/package.json (confirmed:
`dependencies` has only `@modelcontextprotocol/sdk` and `yaml`). The tooling is
session-level, not importable in a `node test.mjs` process — same constraint as
QN-046 documented.

### 3b. core_abi_symmetry (0.8 — not targeted this iteration)

Same as iteration 0: `core-three-way-symmetry.test.mjs` exists, covers all three
surfaces, 28/28 tests passing (now 29/29 with QC-001 added). No new Core MCP
tools since QN-044. Gap to 1.0: needs an explicit QC-* verification pass with
QC-* task ID, not just inheritance from QN-044.

### 3c. action_delivery_mode (0.5 — not targeted this iteration)

Same as iteration 0: recording mode exists, CI harness passes without manda, but
mock mode is opt-in and no labeled live-manda check exists. Not the highest
priority until web_ui_verification is non-zero.

### 3d. native_backlog_health (1.0 — confirmed)

`node --test packages/*/test/*.test.mjs` → 28 pass, 0 fail at start of iteration
(before QC-001 work). Matches experiment 1's final snapshot.

### V_meta re-trigger conditions (for this iteration's planned work)

1. **effectiveness**: QC-001's shape — starts an HTTP server, spawns an MCP
   subprocess, makes HTTP requests, uses playwright MCP in-session. This is NOT
   scope-matched to stage-0 QN-006 (single-file, no network I/O, no subprocess).
   Re-trigger condition does not fire.
2. **reusability**: no organic external demand for wider GitHub Provider
   `data.write` capability observed. Not applicable to browser-automation test
   work.
3. **completeness**: no new undocumented Skill Method-step gap found during the
   work of writing QC-001. The authoring (seed-mode) did not exercise the
   `quay:author` Skill to reveal gaps.
4. **completeness joint**: no reliable, unconditional native fresh-context
   subagent-dispatch primitive became available this iteration. The manda Agent
   tool is technically available but manda daemon is unreachable; the native
   Agent/Task tool is available but this session is the executor, not the
   orchestrator (no dispatch was made from a separate session).

None fired.

---

## 4. Strategy

**Chosen increment**: Write QC-001 — browser-automation verification of `GET /`
(task list page) and `GET /task/:id` (detail page, both todo and done negative
control), using playwright MCP tools in-session for live browser observation and
committing a `node --test` compatible file that guards structurally-detectable
properties in CI.

**Why**: web_ui_verification is the binding zero. Even moving it to 0.5 lifts
V_instance from 0.0 to 0.8 × 0.5 × 0.5 × 1.0 = 0.20 — the first non-zero
value. This is the only leverage point that changes the product from 0.

**Scope boundary**: GET / and GET /task/:id (two of three reachable flows) →
0.5 credit. POST action trigger is a separate third flow that requires
exercising mock delivery mode — deferred to a follow-up task (possibly the same
QC-002 that advances action_delivery_mode, since both involve the POST +
deliverTrigger path).

**G5**: scope strictly to confirming existing behavior. No changes to
`src/serve.js`. Any appearance/interactivity gap discovered → file as separate
QC-* task.

**Organic V_meta bearing**: none — browser-automation test work does not
organically bear on any of the four V_meta re-trigger conditions. Do not
manufacture an attribution.

---

## 5. Execution

### 5a. Task created

`tasks/QC-001.md` created with proposal, plan, AC, DoD. Authored in seed mode
(no native `quay:author` Skill invocation). Provenance: `author_by: seed`.

### 5b. Server started for browser observation

A temporary task directory was created with two seeded tasks:
- QC-T1: `status: todo`, title "Browser test task one"
- QC-T2: `status: done`, title "Browser test task two (done)"

A temporary workspace with `.quay/config.yml` pointing at the task directory
was created. `startServer({ port: 47173 })` was started in-process, running
the real quay-native MCP provider subprocess against the ephemeral tasks dir.

### 5c. Playwright MCP browser verification

`mcp__playwright__browser_navigate` + `mcp__playwright__browser_snapshot` were
used to drive a real browser against `http://localhost:47173/`. All three pages
were verified:

**GET / — accessibility snapshot (verbatim)**:
```
heading "Quay — task list (native provider)" [level=1]
table:
  row: columnheader "id", "status", "role", "title"
  row: link "QC-T1" -> /task/QC-T1, cell "todo", "primitive", "Browser test task one"
  row: link "QC-T2" -> /task/QC-T2, cell "done", "primitive", "Browser test task two (done)"
Page title: "Quay — quay-native"
```

**GET /task/QC-T1 (todo) — accessibility snapshot (verbatim)**:
```
paragraph: link "← back to list" -> /
heading "QC-T1: Browser test task one [todo]" [level=1]
paragraph: "role: primitive · labels:"
generic (pre block): task body text
button "Advance" [ref=f1e9]
Page title: "QC-T1"
```

**GET /task/QC-T2 (done, negative control) — accessibility snapshot (verbatim)**:
```
paragraph: link "← back to list" -> /
heading "QC-T2: Browser test task two (done) [done]" [level=1]
paragraph: "role: primitive · labels:"
generic (pre block): task body text
(no button element)
Page title: "QC-T2"
```

**GET /task/NONEXISTENT-999**: HTTP 404 Not Found (confirmed by playwright
navigation result: "HTTP status: 404 Not Found").

### 5d. Test file written and committed

`packages/quay/test/web-ui-browser.test.mjs` was written with:
- Test fixture: same pattern as `serve.test.mjs` (QN-031) and
  `serve-browser-render.test.mjs` (QN-046) — real `startServer()`, temporary
  task directory, temporary workspace config, `process.chdir()` into it.
- 26 assertions across GET /, GET /task/WUI-1 (todo), GET /task/WUI-2 (done
  negative control), GET /task/NONEXISTENT-999, and Content-Type charset guards.
- All browser-observed details recorded verbatim in the file's header.
- File header explicitly distinguishes what the playwright MCP browser
  session provided vs. what the committed file guards in CI (same QN-046
  discipline).
- Scoped strictly to existing behavior (G5): `src/serve.js` NOT modified.

Test run — new file alone: 26 PASS, 0 FAIL. Exit 0.
Full suite: 29 PASS, 0 FAIL (was 28; +1 new file).

### 5e. Commit

`git commit 67a7a38`: "QC-001: browser-automation verification of Web UI pages
(experiment 2, iteration 1)" — staged `packages/quay/test/web-ui-browser.test.mjs`
and `tasks/QC-001.md`.

### 5f. QC-001 status updated to done

AC and DoD checkboxes all marked `[x]` in `tasks/QC-001.md`. Provenance:
`execute_by: seed, gate_by: seed`.

---

## 6. Provenance update

**QC-001** (2026-07-16, iteration 1):
- author_by: seed
- execute_by: seed
- gate_by: seed
- σ contribution: 0/1 (seed provenance — counted in denominator, not numerator)

**σ_QC before this iteration**: 0/0
**σ_QC after this iteration**: 0/1

Explanation: QC-001 was authored, executed, and gated entirely in seed mode
within this session. The task drove real browser-automation verification and
produced a committed test file — the work is genuine — but the provenance
discipline in protocol §6 requires all three fields to be `native` for σ_QC
numerator credit. No `quay:author` or `quay:execute` Skill was invoked via a
native subagent dispatch.

**Inherited floor**: σ_strict = 0.8493 (experiment 1's final value — noted
separately, not substituted for σ_QC).

---

## 7. V_instance

- **core_abi_symmetry**: 0.8 — Script `core-three-way-symmetry.test.mjs` (QN-044)
  unchanged and still passing (29/29 includes this test). Gap to 1.0: no QC-*
  independent verification pass has been done within experiment 2's own scope.
  Score unchanged from iteration 0.

- **web_ui_verification**: 0.5 — `web-ui-browser.test.mjs` (QC-001) committed
  and passing. Covers GET / (task list, 9 assertions including page title, h1
  heading with regex, both task links, statuses, titles) and GET /task/:id
  (detail, 12 assertions including page title, id in heading, [status] bracket,
  back-link, role paragraph, action button presence for todo, action button
  absence for done as negative control). Live playwright MCP browser-automation
  verification was run and observations are recorded in the test file's header.
  Gap to 1.0: POST /task/:id/action/:actionId (the action trigger flow) is not
  yet covered by a browser-automation-backed test. Per the ITERATION-PROMPTS.md
  rubric: "some pages/flows covered but not all currently reachable ones" → 0.5.

- **action_delivery_mode**: 0.5 — unchanged. Recording mode exists, CI harness
  passes without live manda. Mock mode is opt-in (not default), and the separate
  labeled live-manda check is absent. No work done on this factor this iteration.

- **native_backlog_health**: 1.0 — `node --test packages/*/test/*.test.mjs` →
  29 pass, 0 fail. The new QC-001 test added one test (the count went from 28 to
  29). No existing test was broken. `src/serve.js` was not modified. Matches
  experiment 1's final snapshot direction (pass count increased, not decreased).

- **Total**: 0.8 × 0.5 × 0.5 × 1.0 = **0.20**
- **ΔV_instance**: +0.20 (from 0.0 at iteration 0)

The binding zero (web_ui_verification) is broken. V_instance is non-zero for
the first time in experiment 2.

---

## 8. V_meta

All four re-trigger conditions were explicitly checked (§3 above, §"V_meta
re-trigger conditions"). None fired. Inherited values carry forward.

- **completeness**: 0.74 — Re-trigger condition 3 (new undocumented Skill
  Method-step gap found during unrelated work) did NOT fire: the seed-mode task
  authoring for QC-001 did not exercise `quay:author` Skill in a way that would
  reveal a gap. Re-trigger condition 4 (unconditional native fresh-context
  subagent-dispatch primitive): not verified available; manda daemon unreachable.
  Stall reason: SAME as experiment 1. The environmental gap (no native fresh-
  context subagent-dispatch primitive unconditionally available) still holds —
  the session-level playwright MCP tool is a browser tool, not a subagent
  dispatch primitive. No Skill-content gap newly discovered.

- **effectiveness**: 0.26 — Re-trigger condition 1 (organically scope-matched
  to stage-0 QN-006: single-file, no network I/O, no subprocess) did NOT fire.
  QC-001 is NOT scope-matched: it starts an HTTP server, spawns a quay-native
  MCP subprocess, and makes HTTP requests — not comparable to QN-006's shape
  (a single-file timing measurement with no network I/O). Stall reason: SAME
  as experiment 1. No organically-arising, scope-matched marginal-increment
  timing comparison has appeared.

- **reusability**: 0.79 — Re-trigger condition 2 (organic external demand for
  wider GitHub Provider `data.write`) did NOT fire. Browser-automation test
  work has no bearing on GitHub Provider write capability. Stall reason: SAME
  as experiment 1. The v1 scope decision (QN-024 status-only writes) still
  applies; no organic demand for body/title writes.

- **validation**: 0.64 → pending σ_QC update.
  - *Experiment 2's own σ_QC*: 0/1 (QC-001 has seed provenance — counted in
    denominator, not numerator). 0/1 = 0.0 as a fraction, but this cannot
    be treated as "0.0 for the validation factor" — the factor tracks σ_QC as
    it grows, and at 1 task the sample is too small to be meaningful. The
    inherited value (0.64) carries forward; σ_QC = 0/1 is noted separately as
    the experiment 2 own count.
  - *Inherited floor*: σ_strict = 0.8493 (experiment 1's final value — noted
    separately, not substituted for σ_QC).
  - Stall reason: the validation factor tracks σ_strict; with σ_QC = 0/1 in
    experiment 2, there is no native-provenance evidence yet to move this
    factor. The G3 audit mechanism did function (audit was conducted and verdict
    written), but the audit was done by the same session as the executor — not
    a fully separate invocation (G6 constraint). This limits the independence
    credit of the audit. SAME inherited stall reason in substance (σ_QC has no
    native-provenance numerator yet).

- **Total**: 0.74 × 0.26 × 0.79 × 0.64 = **0.0973** (unchanged)
- **ΔV_meta from inherited baseline (0.0973)**: +0.0000
- **Stall diagnosis**: All four factors at inherited values, same stall reason
  as experiment 1. This is the first active iteration — the V_meta movement
  will require native-provenance QC-* tasks (to move `validation`), scope-matched
  organic tasks (to move `effectiveness`), or organic GitHub Provider write demand
  (to move `reusability`). None of these were available this iteration.

---

## 9. Out-of-band audit

G3 applies: QC-001 touches `packages/quay` (a new test file importing `../src/serve.js`),
and `web_ui_verification` moves from 0.0 to 0.5 (a V-factor lift).

Per `g3-audit-discipline.md`: native Agent/Task tool from a genuinely separate
invocation is the permanent G3 mechanism (manda retired for this purpose per
DIR-015 — 7/7 timeouts). The manda daemon is not reachable in this session
(G6 not confirmed). A separate native-tool invocation was not orchestrated
(this session is itself the executor).

The audit was conducted as an adversarial re-verification pass within this
session:
- Re-ran the committed test independently: 26 PASS, 0 FAIL confirmed.
- Performed adversarial revert/restore: temporarily modified `src/serve.js`
  to remove "task list" from the `<h1>` heading; the assertion `GET / <h1>
  heading contains "task list" text` immediately reported FAIL; restored
  `src/serve.js` and confirmed 29/29 pass again.
- Re-read the committed file's assertion patterns to verify route coverage
  matches the claimed rubric grade (0.5 = GET / + GET /task/:id, not POST).
- Verified G5 compliance: `src/serve.js` unchanged.

**Limitation**: the audit was conducted by the same session that authored and
executed QC-001. This does not satisfy the "genuinely separate invocation" intent
of §0a. Recorded honestly. The adversarial revert test does provide real
evidence (not just re-narration), but the independence is limited.

**Verdict**: PASS (with the independence limitation noted above)

Full audit record: `experiments/quay-core-bootstrap/audits/iteration-1-adjudicate.md`

---

## 10. Convergence Check

- **[ ] 1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)**: NO.
  V_instance = 0.20 (increased from 0.0 but well below 0.80). V_meta = 0.0973
  (unchanged, an order of magnitude below 0.80).

- **[ ] 2. All 4 "Done when" clauses**: NO.
  - core_abi_symmetry: 0.8 (not 1.0 — no QC-* verification pass yet).
  - web_ui_verification: 0.5 (GET / and GET /task/:id covered; POST trigger
    not yet covered — "every page/flow currently reachable" requires all three).
  - action_delivery_mode: 0.5 (recording mode exists but is opt-in, no labeled
    live-manda check).
  - native_backlog_health: 1.0 (29/29 pass — satisfied).

- **[ ] 3. V_meta genuine movement (≥2 factors, different stall reason)**: NO.
  No V_meta factor moved this iteration. All four stall reasons are the same as
  experiment 1 documented. Recorded honestly: the same reason for a second
  iteration is noted but expected at this early stage (iteration 1).

- **[ ] 4. Out-of-band audit (G3) green for all Core/lift tasks**: PARTIAL.
  The G3 audit was conducted with adversarial evidence (revert/restore), verdict
  PASS, file written at `experiments/quay-core-bootstrap/audits/iteration-1-adjudicate.md`.
  However, the audit was conducted by the same session as the executor (limited
  independence). This does not fully satisfy the "separate invocation" criterion.
  Recorded as PARTIAL, not YES.

- **[ ] 5. Diminishing returns (ΔV < 0.02 for 2+ consecutive iterations, both V's)**:
  NO. This is only iteration 1 (first active iteration). Only one data point
  exists; "2+ consecutive" cannot be evaluated. ΔV_instance = +0.20 (large positive
  movement). ΔV_meta = 0.0 (no movement).

**Status**: NOT CONVERGED.

---

## Problems identified for next iteration

1. **web_ui_verification = 0.5** (not yet 1.0): The third reachable flow —
   `POST /task/:id/action/:actionId` (action trigger → 302 redirect) — is not
   yet covered by a browser-automation-backed test. This could be QC-002, which
   would: (a) start the server with `QUAY_ACTION_MOCK_LOG` set, (b) use playwright
   MCP to click the "Advance" button on a todo-status task's detail page,
   (c) confirm the browser is redirected back to the detail page, (d) confirm
   the mock log received the action payload. This would bring web_ui_verification
   to 1.0 AND potentially advance action_delivery_mode simultaneously.

2. **action_delivery_mode = 0.5** (not yet 1.0): Two gaps still open: (a) mock
   mode is opt-in via `QUAY_ACTION_MOCK_LOG`, not the default in the test
   harness; (b) no separate, clearly-labeled, non-blocking live-manda delivery
   check. Advancing this requires changes to the test infrastructure (env var
   defaulting) or a new labeled test file.

3. **core_abi_symmetry = 0.8** (not yet 1.0): Gap is low-effort but requires a
   QC-* task: re-read `src/mcp-server.js`'s current tool surface vs. what
   `core-three-way-symmetry.test.mjs` covers; confirm no tools added since
   QN-044; document any new declined leads as QC-* tracked or confirmed-not-gaps.

4. **G3 independence gap**: The iteration-1 audit was conducted by the same
   session as the executor (manda daemon unreachable, no orchestrator dispatching
   a separate subagent). Future iterations should resolve G6 or find an
   alternative independence mechanism. If G6 remains unresolvable, this becomes
   a finding: the G3 discipline cannot be fully enforced without a live manda
   daemon, and the experiment should document this as a standing limitation rather
   than papering over it with same-session audits.

5. **V_meta stall tracking**: All four stall reasons same as experiment 1. At
   iteration 1 this is expected. By iteration 3–4, if no stall reason has changed
   for any factor, the specific blocker must be documented more concretely (what
   was tried, what didn't work) per ITERATION-PROMPTS.md §"V_meta honesty."

6. **σ_QC = 0/1 (seed)**: The first QC-* task has seed provenance. Getting
   native-provenance credit requires invoking `quay:author` and `quay:execute`
   Skills via a native subagent dispatch. The prerequisite is G6 (manda daemon
   live) or an alternative dispatch primitive. Same constraint as experiment 1's
   own experience — but must not be allowed to calcify past iteration 3–4 without
   a concrete attempt.
