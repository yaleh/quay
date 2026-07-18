# M28-outcome-eval — Outcome-Based / Job-to-be-Done Evaluation Report

- Milestone: M28-outcome-eval (DIR-001 item 3)
- Iteration: 0 (dogfooding evidence gate; explore-class, no VT points)
- Branch: exp5-m28-iteration-0, base commit f8d27c8575807949786f8ad0d430b109087bccfd
- Charter: experiments/quay-perpetual-stream/charters/M28-outcome-eval.md

## Methodology

All 5 scenarios were driven as ONE coherent build+verify pass, via REAL
primary interfaces only — no internal function calls, no static source
inspection substituting for execution. Two isolated scratch workspaces were
used, neither touching the real experiment task store (`tasks/` at repo
root untouched throughout):

- `/tmp/m28-quay-scratch` — native-provider-only `.quay/config.yml`,
  `QUAY_NATIVE_TASKS_DIR=/tmp/m28-quay-scratch/tasks`
- `/tmp/m28-github-scratch` — both providers enabled,
  `QUAY_GITHUB_REPO=yaleh/quay`

For each scenario, real TDD (RED test written and observed failing, then
GREEN implementation observed passing) was used for the scratch
deliverable, and `quay:author`/`quay:execute` Skill discipline was followed
(AC boxes checked only after actually observing a passing test run).

Every gap or bug found during execution was logged with an explicit
disposition and NOT fixed, per charter instruction ("log, don't fix").

Full raw transcripts for each scenario are at
`transcripts/scenario{1,2,3-native,3-github,4-webui,5-native,5-github}.txt`
in this directory. This report is the consolidated summary; it quotes the
load-bearing excerpts but the transcripts are the primary evidence.

## Scenario verdicts

### Scenario 1 — primitive task author→execute round-trip, native provider — PASS

Task `M28S1-001` created via `quay task edit --status todo` (upsert, per
M27 precedent) in `/tmp/m28-quay-scratch`, driven through
`quay:author`/`quay:execute` Skill discipline entirely via `quay task
check`/`task edit` CLI (zero manual `store.js` edits). Deliverable:
`scenario1-work/pagination.mjs` (`paginate(items, pageSize, pageIndex)`)
with `scenario1-work/pagination.test.mjs`, 5/5 tests passing, motivated by
real duplicated page-size-clamping logic in `packages/quay/bin/quay.js`
(`resolvePageSize`) and `packages/quay/src/serve.js` — deliverable does
NOT touch product code (out of scope).

Evidence (see `transcripts/scenario1-native.txt`):
- `task check` gate `author->ready`: `ok:true, reason:"all four artifacts
  present; eligible to move to ready"` only after all 4 artifact sections
  (Proposal/Plan/AC/DoD) were real and ≥40 chars.
- `task check` gate `execute->done`: `ok:true, reason:"all AC checkboxes
  checked; eligible to move to done"` only after AC boxes were checked
  post-verified-green-test-run.
- Final `task view M28S1-001 --json`: `"status": "done"`.
- `node --test scenario1-work/pagination.test.mjs`: 5 pass, 0 fail
  (empty input, exact-boundary page, partial last page, invalid pageSize
  throws, out-of-range pageIndex).

No gaps logged for this scenario.

### Scenario 2 — primitive task author→execute round-trip, github provider — PASS

Real freshly-created `yaleh/quay` issue #17, title-tagged
`[M28-outcome-eval-scratch]`. Same job as scenario 1, github provider,
driven via `quay task edit --provider github` / `task check --provider
github`, zero manual `gh api` mutation calls (raw `gh issue view` used
read-only for independent before/after verification only). Deliverable:
`scenario2-work/wordcount.mjs` (`countWords(text)`), 4/4 tests passing.

Evidence (see `transcripts/scenario2-github.txt`):
- `gh issue view 17` BEFORE: `"state":"OPEN"`, `status:todo` label,
  `body` = placeholder Proposal only.
- `quay task view gh-17 --provider github`: confirms Core CLI sees the
  real issue, `status:"todo"`.
- Task driven todo→ready→done via the same Skill discipline as scenario 1.
- `gh issue view 17` AFTER (raw `gh` CLI, ground truth): `"state":"CLOSED"`
  — confirms github's done=close semantics.
- Independent `quay task view gh-17 --provider github`: `"status":"done"`
  despite the raw label list still showing a stale `status:ready` label —
  this is BY DESIGN per `computeStatusWrite()` in
  `packages/quay-github/src/github-client.js` (closed issue forces
  `status:done` on read regardless of label; confirmed via direct
  code-comment inspection, not treated as a false-positive gap).
- `node --test scenario2-work/wordcount.test.mjs`: 4 pass, 0 fail.
- Issue #17 was already closed by the done-transition; no separate
  `gh issue close` needed. No litter.

No gaps logged for this scenario beyond the already-documented,
by-design stale-label behavior (not a defect).

### Scenario 3 — compound/epic drive-to-done, BOTH providers, FRESH instances — PASS (with 1 real gap found and logged)

Fresh parent + 2 children on native (`M28S3-PARENT` +
`M28S3-CHILD-A`/`M28S3-CHILD-B`, NOT reusing gh-5/6/7) and fresh parent +
2 children on github (issues #26 parent, #21/#22 children, NOT reusing
prior milestones' scratch issues #3/#4/#11-14). Deliverables:
`scenario3-work/{palindrome,clamp}.mjs` (native, 9/9 tests) and
`scenario3-work-gh/{iseven,titlecase}.mjs` (github, 9/9 tests).

**childrenStatus() gate evidence (native)**, from
`transcripts/scenario3-native.txt`:
```
### task check M28S3-PARENT (execute->done gate, must roll up childrenStatus()) ###
{
  "id": "M28S3-PARENT", "gate": "execute->done", "ok": true,
  "acTotal": 2, "acChecked": 2,
  "reason": "all AC checkboxes checked; eligible to move to done",
  "childrenStatus": [
    {"id": "M28S3-CHILD-A", "status": "done"},
    {"id": "M28S3-CHILD-B", "status": "done"}
  ]
}
```
**childrenStatus() gate evidence (github)**, structurally identical
rollup shape confirmed in `transcripts/scenario3-github.txt` for parent
`gh-26` against children `gh-21`/`gh-22`.

Scope honesty note: in both providers, by the time the parent's
`execute->done` gate check was run, both children were already `done`
(the natural TDD-driven sequencing in this pass never left a child
un-done at parent-check time). The gate is CONFIRMED to correctly roll up
and report per-child status (structurally exercising the "gating"
mechanism, matching the charter's requirement that it "be shown gating
correctly"), but this run did not separately capture a live example of
the gate BLOCKING a parent because a child was still incomplete — that
specific negative-path click was not exercised. Recorded here for
completeness rather than silently rounded up.

**REAL GAP FOUND (native half) — CLI gate bypass**, quoted verbatim from
`transcripts/scenario3-native.txt` line 118:

> `quay task edit --status <x>` does NOT enforce the `task check` gate —
> it silently succeeded (M28S3-CHILD-A/B moved todo→ready with Plan
> artifact `reason:"missing artifacts: plan"`, `ok:false`) because
> `task edit` is a raw unguarded status setter; gate enforcement is
> Skill-level process discipline only, not CLI-level. Disposition:
> DEFERRED, future-candidate backlog note — generalizes the same class
> already self-documented in `quay:author`/`quay:execute` Skills' own
> "Gaps" sections ("gate is both contestant and judge", "checkbox-count
> gameability") to a new instance: the CLI write path itself has zero
> gate enforcement, so ANY caller (human or Skill-following-agent making
> a mistake, as happened live in this transcript) can bypass `task check`
> silently. Not fixed here per M28 charter's "log, don't fix" discipline
> — fixing would mean adding gate enforcement to `quay task edit
> --status`, a real product-code change out of scope for this milestone.

This was caught mid-run, and corrected in-transcript: both children were
reverted to `todo`, Plan sections rewritten with real ≥40-char content,
`task check` re-run to confirm `ok:true`, and the transition redone
properly before the parent's gate check.

**Verdict: PASS** for the scenario's own required behavior (fresh
parent+children, both providers, childrenStatus() gate observed
correctly rolling up and reporting), with one real, honestly-logged
product gap (CLI-level gate bypass) that does not block the scenario's
own PASS criteria but is a genuine finding for the backlog.

### Scenario 4 — Web UI task-board round-trip via action_buttons, real browser automation — FAIL

Driven via playwright MCP browser automation against a live `quay serve`
process (port 4128, scratch workspace `/tmp/m28-quay-scratch`) — real
clicks, not static source inspection. Full transcript:
`transcripts/scenario4-webui.txt`.

Step 1 (RED): clicked "Advance" while gate unsatisfied (missing
plan/ac/dod) → correctly redirected to
`?error=Gate+check+failed%3A+missing+artifacts%3A+plan%2C+ac%2C+dod`,
matching the CLI's own `task check` verdict. Sub-check PASS.

Step 2: completed all 4 artifacts with real content + checked AC boxes;
`task check` confirmed `ok:true`.

Step 3: reloaded and clicked "Advance" again → redirected to
`?success=Task+M28S4-WEBUI-001+advanced`, page re-render still showed
`<h1>...[todo]</h1>` (unchanged). Server log
(`/tmp/m28-serve.log`) pasted verbatim:
```
[quay serve] action advance on M28S4-WEBUI-001: gate blocked — Gate check failed: missing artifacts: plan, ac, dod
[quay action run] manda not available — degraded delivery.
Run this to drive the task:
  Drive task M28S4-WEBUI-001 forward one status transition using its current status's Skill (see status_skill_map).
[quay serve] action advance on M28S4-WEBUI-001: { delivered: 'print' }
```

Step 4 (independent verification, separate CLI process, not the UI's own
claim): `quay task view M28S4-WEBUI-001 --json` → `"status":"todo"`,
`updatedAt` byte-identical to the pre-click value — proof of zero
mutation from the click.

**Verdict: FAIL.** The "Advance" `action_button` gate-checks correctly,
but on success it only *delivers a trigger* (here: prints instructions to
the server's own stdout, since no `manda` dispatcher is configured in
this scratch environment) — it does not itself drive the task to its next
status. The UI's own success banner text ("Done: Task ... advanced")
actively overstates what happened. An operator relying only on the
browser UI, without an independent CLI/`task_get` check, would be misled
into believing the task transitioned. Per charter instruction ("be
honest — if something doesn't actually work end-to-end, mark it FAIL with
the real reason, do not round up"), this is reported as a genuine FAIL,
not a partial pass.

Gaps logged (disposition: DEFERRED, future-candidate backlog, not fixed
here):
- **G-S4-01** (UX honesty): success banner says "Done: ... advanced" even
  in plain-CLI-print degraded-delivery mode where nothing about the task
  has changed yet. Recommend conditioning the message on delivery mode.
- **G-S4-02** (capability/config gap, not a code defect): action_buttons'
  "advance" semantics depend entirely on which `deliverTrigger` mode is
  configured (manda / Claude-Code-inline / print / mock-log). In the
  print-degraded mode used here (representative of a bare `quay serve`
  deployment with no agent dispatcher wired up), the Web UI cannot
  complete an end-to-end round trip unassisted. Recommend either
  prominent in-UI documentation of this limitation, or wiring a default
  in-process delivery mode for `quay serve` so the button is functionally
  complete without external dispatcher setup.

Console error observed during browser navigation (`favicon.ico` 404) was
checked and confirmed harmless/unrelated (no favicon route registered);
not counted as a scenario defect.

### Scenario 5 — cross-provider parent/children write via real CLI verb, BOTH providers, independent re-read — PASS

**Native** (`transcripts/scenario5-native.txt`): fresh
`M28S5-PARENT-A`, `M28S5-PARENT-B`, `M28S5-CHILD-C` (child initially
parented to A). Reparent command:
`quay task edit M28S5-CHILD-C --parent M28S5-PARENT-B`. Independent
re-read via a separate `quay task view M28S5-CHILD-C` call (not the write
call's own return value) confirmed `"parent": "M28S5-PARENT-B"`.
Scope honesty note: only the child-side `parent` field was independently
re-verified in this half; the parent-side `children` array was not
separately re-queried on either parent A or B in this transcript.

**Github** (`transcripts/scenario5-github.txt`): fresh issues #27
(parent A), #28 (parent B), #29 (child C). Reparent command:
`quay task edit gh-29 --parent gh-28 --provider github`. Independent
verification here is STRONGER — via raw `gh issue view` (bypassing quay
entirely, genuinely independent source):
```
BEFORE #27 body: "...\n- [ ] #29\n"
BEFORE #28 body: "...(no checkbox)"
AFTER  #27 body: "...\n"                     (checkbox #29 removed)
AFTER  #28 body: "...\n- [ ] #29\n"          (checkbox #29 added)
```
Plus independent `quay task view gh-29 --provider github`:
`"parent": "gh-28"`. All three scratch issues (#27, #28, #29) explicitly
closed via `gh issue close` at end of run (looped, since `gh issue close`
does not accept multiple issue numbers in one invocation).

**Verdict: PASS.** Both providers demonstrated real, independently-
verified cross-provider parent/children reassignment via the actual CLI
verb `quay task edit <childId> --parent <newParentId>`, not the write
call's own return value.

## Gap/bug summary (all logged, none fixed, per charter discipline)

| ID | Scenario | Class | Disposition |
|----|----------|-------|-------------|
| G-S3-01 | 3 (native) | CLI `task edit --status` bypasses `task check` gate entirely (raw unguarded setter) | DEFERRED — future-candidate backlog note; would require product-code change to add gate enforcement to the CLI write path, out of scope here |
| G-S4-01 | 4 | Web UI success banner overstates outcome in print-degraded delivery mode | DEFERRED — future-candidate backlog note, UI copy-only fix |
| G-S4-02 | 4 | Web UI "Advance" cannot complete an end-to-end round trip without an external dispatcher (manda) configured | DEFERRED — future-candidate backlog note; documentation or default in-process delivery mode |

Non-gaps explicitly checked and ruled NOT defects (recorded to avoid
false-positive noise):
- Github's stale `status:*` label surviving issue-close — by design,
  confirmed via direct code inspection of `computeStatusWrite()`.
- `favicon.ico` 404 console error during Scenario 4 browser navigation —
  harmless, no favicon route registered, unrelated to the action_buttons
  mechanism under test.

## Test suite result (before-finishing gate)

`node --test --test-concurrency=1 packages/*/test/*.test.mjs` initially
reported 1 failing test file: `packages/quay/test/serve-github.test.mjs`
(2 of 8 assertions failed: `GET / body contains the real GitHub-backed
task id gh-3` and `GET / body contains gh-3's real live title`; all other
6 assertions in that file, including the `GET /task/gh-3` detail-page
checks, PASSED).

Investigated before treating as a regression:
- Re-ran the file in isolation — same 2 failures, deterministic.
- `gh issue view 3 --repo yaleh/quay` — issue #3 unchanged (`status:ready`
  label, correct title, still open) — not something this milestone's work
  touched.
- Repro'd the exact `GET /` list route against the live repo via a
  throwaway server: response showed `Page 1 of 2`, with the 20 tasks on
  page 1 being `gh-9` through `gh-29` (default page size 20) — `gh-3` and
  `gh-4` are pushed to page 2 by 28 total issues (all states) now present
  in `yaleh/quay`.
- Root cause: the test hardcodes an assumption (documented in its own
  file header as a known fragility: "If issue #3's status label ... changes
  ... the assertions ... would need revisiting") that `gh-3` appears on
  the unpaginated default `GET /` response. The live fixture repo has
  grown past the default page size (20) due to legitimate, expected
  concurrent milestone activity (this run's own scratch issues #17/#21/
  #22/#26-29, M28 iteration-1's `-it1`-tagged #16/#18-20/#23-25, and
  historical M09/M12 scratch issues #9-14) — not anything mutated or
  broken by this milestone's own work. No issue below #17 was touched or
  created by this run.

Conclusion: **pre-existing/environmental flake, not a regression caused
by M28-outcome-eval iteration-0.** Not fixed here (would require either
pagination-aware test assertions or reducing live-fixture issue count,
both out of scope for this "log, don't fix" milestone) — logged as a
gap:

- **G-TEST-01**: `serve-github.test.mjs`'s `GET /` list-page assertions
  for `gh-3` are not resilient to the live `yaleh/quay` fixture repo's
  issue count growing past the default page size. Disposition: DEFERRED
  — future-candidate backlog note recommending the test either pass an
  explicit `?label=`/search filter isolating issue #3, or paginate
  through all pages before asserting absence/presence, or switch to a
  dedicated low-numbered permanent fixture immune to page-size growth.

No other test files failed. Full raw tail of the initial run and the
isolated re-run are preserved in the session transcript; the key isolated
re-run output:
```
PASS: GET / returns 200 (got 200)
FAIL: GET / body contains the real GitHub-backed task id gh-3
FAIL: GET / body contains gh-3's real live title
PASS: GET /task/gh-3 returns 200 (got 200)
PASS: GET /task/gh-3 body contains gh-3's real live title
PASS: GET /task/gh-3 body reflects gh-3's real live derived status (ready, from its status:ready label)
PASS: GET /task/gh-3 renders the Advance action button (gh-3's live status 'ready' matches provider.yml's whenStatus)
```

## Pending directives disposition (HARD GATE)

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
```
Disposition: DIR-017 concerns stream-level DoD-installation-program
ordering/governance (a separate, higher-level concern about how future
DIRs get sequenced across the whole exp5 stream). It is NOT applicable to
M28-outcome-eval's own scope (a single dogfooding-evidence-gate milestone
executing 5 fixed scenarios); no action taken on it here. Left pending
for the dispatcher/outer-driver layer to address.

## Worktree isolation (HARD GATE)

```
$ git worktree list | grep M28
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M28-outcome-eval/worktrees/iteration-0  f8d27c8 [exp5-m28-iteration-0]
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M28-outcome-eval/worktrees/iteration-1  f8d27c8 [exp5-m28-iteration-1]
```
Confirms iteration-0 (this run) and iteration-1 (a separate, independent,
concurrently-running dispatch) are properly isolated in distinct
worktrees/branches, sharing only the live GitHub fixtures repo (expected
per charter — this explains the non-sequential scratch issue numbering
observed during scenario 3/5, where `-it1`-tagged issues #16/#18/#19/#20/
#23/#24/#25 interleaved with this run's issues due to concurrent
execution; all confirmed closed, no cross-contamination of task content).

## Correction note: work-directory placement

During execution, scratch-work and transcript files were initially
written to the OUTER repo's `experiments/quay-perpetual-stream/milestones/M28-outcome-eval/`
path rather than inside this iteration's own worktree
(`worktrees/iteration-0/experiments/quay-perpetual-stream/milestones/M28-outcome-eval/`).
This was caught before commit: verified against M27's own precedent
(`git log --all --name-only` showed M27's `benchmark-report.md` and
`transcripts/*.txt` were committed on `exp5-m27-iteration-0`, i.e. inside
that iteration's worktree), then corrected by moving all files into the
correct worktree-relative path and removing the mistaken outer-repo
copies (confirmed via `git status --porcelain` that the outer repo
(`exp5-outer-driver`) has zero pending changes from this run).
