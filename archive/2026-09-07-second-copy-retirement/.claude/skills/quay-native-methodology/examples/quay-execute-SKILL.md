---
name: quay:execute
description: Use when driving a task at status `ready` toward `done` — implements the plan, self-audits against AC/DoD, and asserts the `ready -> done` gate via `quay task check`. Takes the epic branch (drive children to done, then integration-accept) when the task's derived role is `compound`. Invoke with a task id and, optionally, a provider id (default `native`).
---

# quay:execute

λ(taskId: TaskId, provider: ProviderId = "native") → ExecutionOutcome

Layer-2 orchestration Skill (quay-native-design.md §5) for the `ready` status.
Corresponds to the `execute` operation in the status model (design §3):
`ready → done ⟺ AC satisfied ∧ DoD passed (integration acceptance for epics)`.

**Honesty note (iteration 1):** still **not yet used** to drive any task —
per the fixed per-Skill retirement order (protocol §10.2), iteration 1's
scope was authoring-side only (`quay:author` — see QN-001/QN-003/QN-004/
QN-005 in `experiments/quay-native-bootstrap/provenance.md`). QN-006 (iteration 0's one task-to-
`done`) and any task driven to `done` since remain seed-executed. This
Skill's own authoring task (QN-004) was driven to `ready` by `quay:author`
in iteration 1 — that only means the *plan* to retire this Skill's seed
dependency now exists; the Skill itself remains unexercised. σ for
`quay:execute` remains 0 until a later iteration actually dispatches it and
records `execute_by: native`. Iteration 1 also confirmed (via `quay:author`'s
own exercise) that **this environment has no subagent-dispatch primitive**
— the same finding applies here, and is reflected in the Method/Gaps below.

**Honesty note (iteration 18, QN-029) — provider-parameterized.** Same
change, same rationale, as `quay:author`'s iteration-18 honesty note: every
Method step below previously hardcoded `quay-native task <cmd>`; all such
invocations are replaced with Core's generic `quay task <cmd> --provider
<provider>` passthrough (default `native`, unchanged behavior — see
`experiments/quay-native-bootstrap/iterations/iteration-18.md` §Phase 3 for the byte-identical
regression proof). This is what makes `quay-github`'s `skill` capability
declaration (same task) actually correct rather than aspirational — see
`quay:author`'s own honesty note for the full reasoning, not repeated here.

## Spec

```
ExecutionOutcome = Done | NeedsHuman(reason: String)

executeTask :: (TaskId, ProviderId) → ExecutionOutcome
executeTask(id, provider) = {
  task:    quay task view <id> --provider <provider> --json,
  assert:  task.status == "ready",
  role:    task.role,   -- DERIVED (design §2): children non-empty => compound
  return:  case role of
    "primitive" → executeLeaf(task, provider)
    "compound"  → executeEpic(task, provider)
}

-- Leaf path: implement the plan's Phases, TDD-style (borrowed discipline
-- from the seed's primitive-executor, scoped to quay-native's own tooling —
-- no epicd CLI calls).
executeLeaf :: (Task, ProviderId) → ExecutionOutcome
executeLeaf(task, provider) = {
  forEachPhase: implementPhaseRedGreen(task),   -- write/adjust tests, make them pass
  selfAudit:    reRunAC(task),                  -- check AC boxes only when actually verified true
  gate:         quay task check <id> --provider <provider>,
  return: case gate.ok of
    True  → { quay task edit <id> --status done --provider <provider> ; Done }
    False → NeedsHuman(gate.reason)
}

-- Compound (epic) path: design §4's execution process.
executeEpic :: (Task, ProviderId) → ExecutionOutcome
executeEpic(task, provider) = {
  ensureChildrenExist: task.children,           -- created at authoring or now, on a late split
  driveEach:  [ driveChildToDone(c, provider) | c <- task.children ],  -- recursive: todo->author->ready->execute->done
  integrationAccept: runEpicLevelACAndDoD(task),
  return: case integrationAccept of
    Pass → { quay task edit <id> --status done --provider <provider> ; Done }
    Fail → NeedsHuman("integration acceptance failed")
}
```

## Method — named steps, each with a stated environment-capability requirement and a degraded fallback (mirrors quay:author's QN-003 structure; leaf path only — epic path untested at v0)

1. **`implement-phase`** — `quay task view <id> --provider <provider>
   --json`; for each Plan phase, write/adjust tests first, confirm they
   fail for the expected reason, then implement the minimum change to pass
   (Red/Green, borrowed from the seed's `primitive-executor` discipline).
   - *Dispatch-capable target:* own fresh-context subagent per phase.
   - *Degraded fallback:* same-session sequential implementation (this
     environment's current mode — no subagent-dispatch primitive found, per
     `quay:author`'s QN-003 finding, which applies equally here).
   - **Negative/error-path sub-check (added iteration 61, generalizing a
     pattern discovered across iterations 58-60 — QN-062/063/064):** before
     treating a Plan phase's happy-path test as sufficient, explicitly ask
     whether the phase's target code has an **untested failure mode** at
     any of these three, now-repeatedly-demonstrated distinct points, and
     close it if genuinely open (do not manufacture one if the phase has
     none):
     1. **connection/startup failure** — does the call path correctly
        propagate a failure to *start* or *connect* to the thing being
        driven (a crashing subprocess, an unreachable Provider), rather
        than hanging or crashing the host process? (QN-062: a malformed
        `QUAY_GITHUB_REPO` causing `resolveRepo()` to throw, verified
        through both Core CLI's eager-connect and Core MCP's lazy-connect
        paths.)
     2. **malformed/absent input shape** — does the call path handle a
        real-but-degenerate data shape from an external source (`null`/
        `undefined` where a string is expected, an empty collection),
        distinct from every existing fixture, without crashing? (QN-063:
        `null`/`undefined` GitHub issue `body`, previously only exercised
        via an empty-string stand-in.)
     3. **live mid-session failure** — does the call path correctly
        surface a failure that occurs *after* a successful connection, in
        the middle of an otherwise-successful session (a live upstream
        call failing partway through), without crashing the host process
        or silently swallowing the failure? (QN-064: a live `gh api` 404
        from inside `fetchAllIssues()`, occurring after a successful
        Provider connect.)
     This sub-check is a **documented consequence of real, independently-
     justified work already performed** (iterations 58-60 each found and
     closed a genuinely distinct instance of this category by first
     grepping `experiments/quay-native-bootstrap/provenance.md`/the target source for prior
     coverage) — it is written here so a future `implement-phase` pass
     treats this as a standing consideration for *any* Plan phase touching
     an external boundary (a Provider subprocess, a network call, a
     parsed external data shape), not as three now-closed, one-off tasks.
     It does **not** mandate manufacturing a negative-path test where none
     is genuinely open (G5) — only that the question be asked and the
     answer (open/already-covered/not-applicable) be recorded, the same
     discipline `self-audit-ac` already requires for AC checkboxes.
2. **`self-audit-ac`** — check off `## AC` checkboxes **only when
   independently re-verified true** against the actual code/tests — never
   because "it should work."
   - *Dispatch-capable target:* an independent subagent re-runs
     tests/diff-review before checkboxes are trusted.
   - *Degraded fallback:* same-session re-run of the actual test suite
     (not trusting a prior "it passed" claim), matching iteration 0's
     QN-006 execution discipline.
   - **Independent-audit requirement (not optional):** this self-audit step
     is a **necessary but explicitly insufficient** substitute for G3's
     out-of-band audit. The `ready->done` gate transition produced by this
     Skill is **provisional** until a genuinely separate (fresh-context)
     adjudicate-style check co-signs it — see
     `experiments/quay-native-bootstrap/audits/iteration-N-adjudicate.md` for the mechanism this
     experiment currently uses to satisfy that requirement. Do not treat a
     green `self-audit-ac` + green `gate-check` as sufficient proof of
     correctness on its own (G3/G4).
3. **`gate-check`** — run `quay task check <id> --provider <provider>
   --json`. If `ok: true`, run `quay task edit <id> --status done
   --provider <provider>`. If `ok: false`, do not force it — report the
   gate's `reason` (e.g. "N/M AC checkboxes checked") and leave the task at
   `ready` for another pass, or route to `needs-human` if a genuine blocker
   (not an implementation-layer gap) is found.

## Gaps (honestly declared)

- **No subagent-dispatch primitive exists in this environment** (same
  finding as `quay:author`'s QN-003 — confirmed via an explicit tool check,
  not assumed). The `self-audit-ac` step above therefore cannot achieve true
  reviewer independence on its own; this is exactly why the independent-audit
  requirement in step 2 is stated as mandatory, not advisory.
- No independent adjudicate-style audit is built into this Skill itself yet
  — design §5's "review independence (no self-certification)" contract for
  execution is not enforced by tooling; it currently relies on a separate,
  explicitly-invoked audit pass (as iteration 0's
  `experiments/quay-native-bootstrap/audits/iteration-0-adjudicate.md` and iteration 1's
  `experiments/quay-native-bootstrap/audits/iteration-1-adjudicate.md` do), not on anything this
  Skill enforces mechanically.
- The epic/compound branch (`executeEpic`) was exercised for the first time
  in iteration 5 (QN-008/009/010/011) — one favorable-case data point (all
  children's underlying implementation work already correct before their own
  AC/DoD were written). Iteration 6 (QN-013, children QN-014/QN-015)
  deliberately designed one child (QN-015, a compare-and-swap concurrency
  primitive) to be genuinely hard and NOT pre-verified before authoring, so
  that its own gate outcome would be honest rather than manufactured. The
  **actual, unplanned result**: QN-015 genuinely passed its own gate on the
  first implementation attempt (6/6 AC, confirmed red-before-fix via `git
  stash`) — it did **not** land on `needs-human`. `executeEpic`'s
  `needs-human` fallback branch therefore **remained unexercised in
  practice** as of iteration 6, despite a deliberately-adversarial attempt —
  see `experiments/quay-native-bootstrap/iterations/iteration-6.md` §5/§9 for the honest account of
  why the attempt still counted as a genuine (not rigged) test.
- **Resolved in iteration 7 (QN-017):** the `needs-human` fallback branch has
  now been genuinely exercised, via `executeLeaf`'s path (not `executeEpic`
  — the leaf path shares the same `gate.ok === false -> NeedsHuman` outcome).
  QN-017 was authored *deliberately unsatisfiable by construction*, not
  merely "hard": its AC required this environment's `review-proposal` step
  to have run in a genuinely separate, freshly-dispatched subagent — a real,
  re-confirmed-absent environmental precondition (no subagent-dispatch
  primitive has been found in 7 consecutive `ToolSearch` checks, iterations
  1-7), not a subjective difficulty estimate. `quay-native task check
  QN-017 --json` genuinely returned `{"ok": false, "acTotal": 2,
  "acChecked": 0, "reason": "0/2 AC checkboxes checked"}` at the
  `execute->done` gate, because AC item 1 could not honestly be checked
  true. Per this Skill's own Method step 3 ("route to `needs-human` if a
  genuine blocker... is found"), the task was flipped to status
  `needs-human` — a real, valid status (`store.js`'s `VALID_STATUSES`),
  producing `{"gate": "none", "ok": false, "reason": "soft stop; human
  action required"}` on subsequent checks. This is the first genuine,
  mechanically-produced (not narrated) exercise of this fallback path in
  the experiment's 7-iteration history. See
  `experiments/quay-native-bootstrap/iterations/iteration-7.md` §5 for the full account, including
  the honest correction that the initial attempt to trigger this via the
  *authoring* gate did not work (the `author->ready` gate only requires
  checkbox *presence*, not checked-state — a real, useful finding about
  gate design surfaced by this attempt) and the actual trigger point was
  the `execute->done` gate, as this Skill's own Method already documents.
- **Fixed in iteration 6 (QN-012):** `quay-native task check`'s mechanical
  gate is now compound-aware — a `done` compound task's gate check
  re-verifies that every child is itself `status: done` (returning `ok:
  false` and naming the offending/missing child otherwise), and a `ready`
  compound task's execute->done gate requires both AC-checkbox completion
  AND all-children-done. Previously the gate unconditionally rubber-stamped
  `ok: true, reason: "terminal"` for any `done` task regardless of role —
  this meant `executeEpic`'s "integrationAccept -> done" guarantee was
  enforced only by Skill-level process discipline, not by the gate itself.
  It is now enforced at the gate level too (see `store.js`'s `check()` and
  `childrenStatus()`), closing the gap iteration 5's independent audit
  named (`experiments/quay-native-bootstrap/audits/iteration-5-independent-adjudicate.md`, Claim 5).
  Primitive (leaf) task gate behavior is unchanged (verified by dedicated
  regression tests, `packages/quay-native/test/compound-gate.test.mjs`).
- **Fixed in iteration 7 (QN-016):** the QN-012 fix above only checked one
  level deep (`childrenStatus()` read `child.status` directly) — a `done`
  child whose own grandchild had reverted would still be reported `"done"`,
  so a 3-level epic could stay falsely `ok: true`. Found by iteration 6's
  independent, out-of-band audit (`experiments/quay-native-bootstrap/audits/
  iteration-6-independent-adjudicate.md`, Finding 1). `childrenStatus()` is
  now recursive: a compound child is only reported `"done"` if its own
  subtree is also fully done; otherwise it is reported as the distinct
  status `"stale-done"` (nameable, not silently collapsed into `"done"`).
  Cycle-safe (a cyclic children graph resolves to `"missing"`/`ok:false`
  rather than crashing or hanging). See
  `packages/quay-native/test/compound-gate-recursive.test.mjs`.
- **Resolved in iteration 8 (QN-020/QN-021):** the question left open above
  ("was `executeEpic`'s own branch adequately covered by the general
  leaf-level proof, or does it need a dedicated task?") is now answered:
  yes, it needed a dedicated task, and QN-020 (epic, one child QN-021) is
  it. `executeEpic`'s `needs-human` outcome has two structurally distinct
  triggers in the pseudocode (`executeEpic`'s Spec above): (1) a child
  cannot be driven to `done`, so `driveEach` cannot complete (`ok` never
  reached for that child) — the case this task exercises; and (2) all
  children reach `done`, but `integrationAccept` (`runEpicLevelACAndDoD`)
  itself fails — a narrower, still-**unexercised** sub-case this task does
  **not** resolve. QN-020's child QN-021 was authored with the same
  structurally-unsatisfiable AC item QN-017 used (no subagent-dispatch
  primitive found, 8th consecutive `ToolSearch` confirmation across
  iterations 1-8); QN-021 was actually driven — not narrated — and, because
  of QN-019's same-iteration `author->ready` gate tightening, failed one
  gate earlier than QN-017 did (`author->ready` itself, `1/2 AC checkboxes
  checked`, rather than `execute->done`). Either way QN-021 cannot reach
  `done`, so `driveEach` cannot complete; QN-020 was then actually flipped
  (`task edit QN-020 --status needs-human`), and `task check QN-020 --json`
  now genuinely returns `{"gate":"none","ok":false,"reason":"soft stop;
  human action required"}` — the first real, mechanically-produced exercise
  of `executeEpic`'s own distinct `needs-human` branch (not `executeLeaf`'s,
  which QN-017 already proved) in this experiment's 8-iteration history.
  See `experiments/quay-native-bootstrap/iterations/iteration-8.md` §5 for the full account. The
  "integration acceptance itself fails after all children complete"
  sub-case remains open for a future iteration.
- **Resolved in iteration 9 (QN-022/QN-023):** the narrower sub-case left
  open above is now exercised for real. Unlike QN-020/QN-021 (child cannot
  reach `done`), QN-023 (the child) genuinely reached `done` — confirmed
  via live `quay-native task check QN-023 --json` returning `{"gate":
  "none", "ok": true, "reason": "terminal"}`. QN-022's own AC was authored
  with 4 genuinely-satisfiable items at authoring time (so `author->ready`
  passed for real, `ok: true`), and only after QN-022 genuinely reached
  `ready` (and QN-023 was already `done`) was a 5th, honestly-unsatisfiable
  AC item added — the same structural precondition as QN-017/QN-020/
  QN-021 (no subagent-dispatch primitive found; 9th consecutive `ToolSearch`
  confirmation across iterations 1-9), but applied at the epic-integration
  sign-off level rather than a per-Skill-step level. `quay-native task check
  QN-022 --json` at that point genuinely returned `{"gate": "execute->done",
  "ok": false, "acTotal": 5, "acChecked": 4, "reason": "4/5 AC checkboxes
  checked", "childrenStatus": [{"id": "QN-023", "status": "done"}]}` —
  i.e. `acOk: false` while `childrenOk: true`, the one previously-untested
  boolean combination in `store.js`'s `ok = acOk && childrenOk` compound
  gate. QN-022 was then flipped to `needs-human`, producing the same
  soft-stop shape as the other two triggers. A genuine sequencing pitfall
  was caught and corrected mid-construction: an initial single-pass attempt
  to write all 5 AC items at once (while QN-022 was still `status: todo`)
  would have tripped the *wrong* gate (`author->ready`, not `execute->done`)
  for the wrong reason, since QN-019's checked-state fix made both gates
  inspect the same AC section — this was caught via a live `task check`
  call showing the mistaken `author->ready` failure, and the construction
  was redone in genuine temporal order before QN-022's status was ever
  advanced. See `experiments/quay-native-bootstrap/iterations/iteration-9.md` §5 for the full
  account. All three structurally distinct `needs-human` triggers named in
  `executeEpic`'s Spec/Gaps history are now genuinely, mechanically
  exercised: (1) `executeLeaf`'s own gate failure (QN-017), (2) a child
  that cannot reach `done` (QN-020/QN-021), (3) all children done but the
  epic's own integration acceptance fails (QN-022/QN-023). No further
  distinct branch in `executeEpic`'s own pseudocode is currently known to
  remain unexercised; if one is identified later it should be named here
  explicitly rather than assumed covered.
- **Resolved in iteration 27 (QN-037, gh-10/gh-8/gh-9):** iterations 25 and
  26 both named the same residual gap — every prior compound/epic live
  verification (native's QN-012/QN-016, GitHub's QN-035/DIR-006) exercised
  only the **gate's own** compound-recursion logic (`checkGate()`/
  `childrenStatus()`) via direct, manual `task check`/`task edit` commands
  standing in for this Skill, never `executeEpic`'s own **recursive
  orchestration** (`driveEach` over real children, followed by
  `integrationAccept`) as an actual Skill-level drive. Iteration 27 closes
  this: a fresh, real, two-child GitHub epic (issue #10, children #8/#9)
  was authored via `quay:author`'s own Method against the epic itself
  (decompose test genuinely satisfied — two independently mergeable
  DESIGN.md doc-comment deliverables), then driven via this Skill's own
  `executeEpic` pseudocode: `driveEach` recursively invoked `quay:author`
  then this Skill's own `executeLeaf` path (`implement-phase` — a real
  `packages/quay-github/DESIGN.md` diff per child; `self-audit-ac` — the
  full regression suite re-run after each child; `gate-check`) against
  each child in turn, in genuine temporal order (child A fully to `done`
  before child B was even authored), followed by `integrationAccept` — a
  live `quay task check gh-10 --provider github --json` re-run at the
  epic level. The intermediate proof was captured live, not narrated:
  with only child A done, the epic's own `execute->done` gate genuinely
  returned `{"ok":false,"reason":"AC checkboxes complete, but not all
  children are done: gh-9 (todo)","childrenStatus":[{"id":"gh-8",
  "status":"done"},{"id":"gh-9","status":"todo"}]}`; once both children
  reached `done`, the same gate call returned `{"ok":true,"reason":"all AC
  checkboxes checked; eligible to move to done","childrenStatus":
  [{"id":"gh-8","status":"done"},{"id":"gh-9","status":"done"}]}` — the
  epic was then flipped to `done` for real. This is still the same
  same-session degraded-fallback mode this experiment has used since
  iteration 1 (no subagent-dispatch primitive found, reconfirmed via
  `ToolSearch` this iteration) — what changed is that the *epic-level
  recursive orchestration itself* (not just leaf-level gate mechanics) was
  what was actually exercised and recorded. See
  `experiments/quay-native-bootstrap/iterations/iteration-27.md` §5 for the full transcript.
- **Iteration 28 finding (partial closure, real gap remains): `quay mcp`'s
  own stdio transport IS now registered as a real, mechanically-verified
  project-scoped MCP server** (`.mcp.json`, added via `claude mcp add
  --scope project quay -- node packages/quay/bin/quay.js mcp` — the actual
  Claude Code CLI mechanism, not a bespoke script). `claude mcp get quay`/
  `claude mcp list` both confirm the server is correctly configured and
  spawns (health-checked), but report its approval status as **"⏸ Pending
  approval (run `claude` to approve)"** — MCP servers named in a project's
  `.mcp.json` require per-project approval that is only prompted/resolved
  at a **fresh session's own startup**, not mid-session. This iteration
  additionally hand-drove the real MCP JSON-RPC protocol directly over the
  server's stdio (bypassing the Claude-session-registration boundary,
  as a diagnostic, not a substitute): a genuine `initialize` handshake,
  `notifications/initialized`, and `tools/list` all succeeded, returning
  the actual `task_list`/`task_get`/`task_write`/`task_check` tool schemas
  from the real running server process; a genuine `tools/call` for
  `task_list` with `{"status":"done"}` also succeeded, returning real task
  data matching this repo's own tasks (cross-checked in kind against `quay
  task list --status done --json`'s own output). This is materially
  stronger evidence than any prior iteration's manual-command-sequence
  proxy (it is the actual wire protocol, not a CLI stand-in) — but it is
  **still not** what remains the genuine residual gap: a real Claude Code
  session's own tool-use (its own `ToolSearch`/tool-call mechanism, inside
  its own already-initialized MCP client) discovering and invoking `quay`'s
  tools has never happened, and cannot be self-verified from within an
  already-running session (confirmed directly again this iteration:
  `ToolSearch` still surfaces zero `quay`-related deferred tools in this
  session, since `.mcp.json` was added after this session's own MCP client
  initialized). `.mcp.json` is now committed to the repository specifically
  so that the **next fresh session** started against this repo can check
  its own `ToolSearch` output as one of its first actions (after approving
  the pending server) and genuinely close this gap — see
  `experiments/quay-native-bootstrap/iterations/iteration-28.md` §5 for the full transcript and
  `experiments/quay-native-bootstrap/iterations/iteration-27.md`'s own problem #1 for the prior
  iteration's identical framing of what would constitute real closure.
- Not yet dispatched via manda in a background worker by this Skill itself
  (see quay:author's same gap note — dispatch binding is currently the
  host's job).
- **This Skill itself remains entirely unexercised as of iteration 1** — its
  own authoring task (QN-004) was driven to `ready`, but that is a plan for
  retiring its seed dependency, not the retirement itself. `execute_by` is
  `seed` for every task in `experiments/quay-native-bootstrap/provenance.md` as of iteration 1.
- **Fed back into the Method in iteration 61: the negative/error-path
  test-coverage discipline.** Iterations 58, 59, and 60 each independently
  found and closed a genuinely distinct instance of an untested failure
  mode at an external boundary (Provider-subprocess-connection failure;
  malformed/absent input shape; live mid-session upstream failure) — in
  each case, by first grepping this repo's own test files and
  `experiments/quay-native-bootstrap/provenance.md` to confirm the specific instance was
  genuinely open, not merely re-running or lightly varying prior coverage.
  This was real, repeated, independently-justified practice across three
  consecutive iterations, but until this iteration it existed only in
  `experiments/quay-native-bootstrap/provenance.md`'s own per-iteration narration — the Method
  above (step 1) was silent on it, so a future `implement-phase` pass had
  no standing instruction to consider this class of gap for a *new*
  feature's own boundary-touching code, only a historical record that
  three past *test-coverage-closure* tasks happened to find such gaps.
  This is now written into step 1 above as a standing sub-check (ask the
  question for any boundary-touching Plan phase; do not manufacture a
  test where no genuine gap exists, per G5). This closes a real,
  previously-unaddressed gap in this Skill's own self-containedness (the
  Method not reflecting real, established practice), not a cosmetic
  rewording — see `experiments/quay-native-bootstrap/iterations/iteration-61.md` for the full
  reasoning distinguishing this from iteration 18's "documenting
  newly-written capability" (which does not count) and iteration 29's
  reverted `completeness` credit (revising `ITERATION-PROMPTS.md`, an
  out-of-scope document, which also does not count).
