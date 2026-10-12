---
id: gap-task-status-events-abi-writes-and-creation
title: "task_trace P1: Provider-ABI status writes and task creation emit v1
  status events (cli/mcp actor, optional correlationId)"
status: ready
labels:
  - gap
  - task-trace
  - observability
parent: null
children: []
extra: {}
depends_on:
  - gap-task-status-events-contract-v1-all-driver-writers
---
## Proposal
After `gap-task-status-events-contract-v1-all-driver-writers`, the driver layer emits v1 status events. Status changes made through the **Provider ABI** still emit nothing:
- `quay task create` (→todo);
- `quay task edit --status`;
- MCP `task_write` with a status;
- the CLI lifecycle verbs `promote` / `retreat` / `complete` (`packages/quay/src/gate/lifecycle.ts`, `cli/lifecycle.ts`).

These are also where a human or an agent session acts, which is exactly the "who changed it" (`actor.sessionId` / `correlationId`) that the ClaudeCodeUI contract draft (§4 2b′, G1) asks Quay to supply when it can.

## Plan
1. Find the single choke point for ABI status writes: the native store `write()` with its `expectedStatus` CAS and `commitTaskWrite` (`packages/quay-native/src/store.ts`).
   - Emit the v1 event there after the commit, including creation (`from:null`, `to:<initial>`, `kind:"create"`).
   - If the provider package cannot import the kernel writer without breaking the import-graph ratchet, emit from the Core write path instead and document why.
   - The GitHub provider is out of scope; its coverage is declared absent rather than implied.
2. `cause`: accept optional `--correlation-id` / MCP `correlationId`, and `sessionId` when the caller supplies it (e.g. `CLAUDE_SESSION_ID`-style env, only if actually present). Absent stays absent.
3. `actor.kind`: `cli` or `mcp`, with `id` = the existing `task_write by cli:<pid>` identity already used in commit subjects.

### What was actually built (the Plan's two open branches, decided)
- **The kernel writer IS importable from `quay-native`** — `packages/**` → `packages/quay/src/kernel/**` adds no reverse edge (`import-graph-check` ratchets `packages/**` → `plugin/**` at 0, and the kernel imports only `node:*`), so the Plan's "emit from the Core write path instead" fallback was NOT needed. The store emits, exactly as Plan §1 asks.
- **`sessionId` is read from the environment, not threaded through the ABI.** It is what the front door's shell already knows (`CLAUDE_CODE_SESSION_ID`, inherited by the provider child), so a fourth ABI field every caller must hand-carry would be plumbing without an owner. `correlationId` IS threaded, because only the caller knows that two writes are one operation.

## Acceptance Criteria
- [x] Tests exit 0, covering:
  - (a) `task create` ⇒ one `create` event with `from:null`;
  - (b) `task edit --status ready` with `--expect-status todo` ⇒ one event, and a failed CAS ⇒ zero events;
  - (c) MCP `task_write` status change ⇒ one event, `actor.kind:"mcp"`;
  - (d) a body-only edit ⇒ zero events;
  - (e) `correlationId` passed through when given, absent when not;
  - (f) lifecycle `promote` / `retreat` / `complete` each ⇒ one event.
- [x] Negative control: remove the emit in a scratch copy ⇒ (a)–(c) red. Paste the output.
- [ ] Production reading: the next real `quay task create` or `task edit --status` in this workspace after landing has its event with `evidence.commit` resolving to the ABI commit. Paste both. （待外部）

## Evidence

**AC1 — the six named surfaces, driven through the REAL front doors** (`node --test packages/quay-native/test/store.test.mjs packages/quay/test/task-transition.test.mjs packages/quay/test/task-status-events-abi.test.mjs`, 38/38 pass).
`task-status-events-abi.test.mjs` is the surface half: it spawns the Core CLI and the Core MCP server in a real (temp) git workspace, so a dropped `patch.actorKind`, a provenance field stripped by the Provider's zod schema, or a lifecycle verb that forgets to forward its args reds HERE — a store-level test cannot see any of those.
```
✔ AC(a) create: exactly ONE `create` event, from:null, with evidence resolving to the creating commit (58.6ms)
✔ AC(b) CAS write: one event on the flip; a REFUSED CAS emits ZERO (a refusal is not a transition) (70.9ms)
✔ AC(d) a body-only (and a same-status) write emits ZERO — a write is not a transition (100.7ms)
✔ AC(e) cause: correlationId is carried when given and ABSENT (not empty) when not; sessionId comes from the env (84.7ms)
✔ actor.kind: the class the front door declares is recorded; an undeclared class is `unknown`, never guessed (65.1ms)
✔ scope: a store OUTSIDE any git work tree emits nothing (the carrier lives at the workspace root) (4.0ms)
✔ AC(a)+(b)+(d)+(e): `task create` / `task edit --status` emit exactly the flips, with provenance (1548.6ms)
✔ AC(c): MCP `task_write` emits one event with actor.kind 'mcp' (543.4ms)
✔ AC(f): lifecycle `complete` / `retreat` / `promote` each emit exactly one event (1060.0ms)
✔ (a-create) a creation appends a v1 record with `from:null` — null, NOT an absent key (0.6ms)
ℹ tests 38   ℹ pass 38   ℹ fail 0
```
What each assertion actually checks, beyond "an event appeared":
- (a) the event's `evidence.commit` resolves with `git show <sha>:tasks/<id>.md` to a file reading `status: todo`, and `evidence.statusBlobSha` equals `git rev-parse <sha>:tasks/<id>.md` — the record is CHECKABLE against git, not merely well-shaped;
- (b) the positive half asserts the event's `evidence.commit` IS `HEAD` after the flip; the negative half asserts the refused CAS wrote no file AND emitted nothing (the two readings together: a refusal is not a transition);
- (c) `actor.kind === "mcp"` — and the sibling store test shows an undeclared class is recorded as `unknown`, so `mcp` here is a real reading, not a default;
- (f) each verb emits exactly ONE event (`promote` on a `ready` task delegates to the complete path — one event, not two), and every event's `evidence.commit` carries a copy of the task file whose status IS that event's `to`.

**AC2 — negative control: the emit removed from a scratch copy of `store.ts`** (the comment replacing the call is `// NEGATIVE CONTROL: emit removed`; the file was restored from a byte-identical backup afterwards, `diff` clean).
```
✖ AC(a) create: exactly ONE `create` event, from:null, with evidence resolving to the creating commit
  AssertionError [ERR_ASSERTION]: a creation must emit exactly one event; got 0
✖ AC(b) CAS write: one event on the flip; a REFUSED CAS emits ZERO (a refusal is not a transition)
  AssertionError [ERR_ASSERTION]: precondition: the creation emitted its own event
✖ AC(d) a body-only (and a same-status) write emits ZERO — a write is not a transition
  AssertionError [ERR_ASSERTION]: a body-only edit changed no status and must emit nothing
✖ AC(e) cause: correlationId is carried when given and ABSENT (not empty) when not; sessionId comes from the env
✖ actor.kind: the class the front door declares is recorded; an undeclared class is `unknown`, never guessed
✖ AC(a)+(b)+(d)+(e): `task create` / `task edit --status` emit exactly the flips, with provenance
  AssertionError [ERR_ASSERTION]: a creation must emit exactly one event; got []
✖ AC(c): MCP `task_write` emits one event with actor.kind 'mcp'
  AssertionError [ERR_ASSERTION]: the MCP flip must emit exactly one further event
✖ AC(f): lifecycle `complete` / `retreat` / `promote` each emit exactly one event
  AssertionError [ERR_ASSERTION]: precondition: the creation's own event
ℹ tests 24   ℹ pass 16   ℹ fail 8
```
Specific to the emit, not a blanket breakage: the 16 that stay green are every pre-existing store test (commit-after-write, branch-aware ff, field-aware propagation, the title charset suite) PLUS the one new test that asserts ABSENCE (`scope: a store OUTSIDE any git work tree emits nothing`) — a control that reds VACUOUSLY when the feature is removed is no control at all, so that one is expected to stay green here.

**AC1's own gate — `scripts/test.sh --for-task gap-task-status-events-abi-writes-and-creation --allow-thin`: exit 0** (149 test files selected; 23 scoped static checks incl. `import-graph-check`, `touches-one-entry-one-path-check`, `checked-in-write-check`, `test-isolation-check` all PASS). The scoped-gate cache was recorded for the driver's fan-in.

**Anti-drift (the driver's own pre-merge gate): PASS** — `13 actual file(s), all within declared Touches (14 glob(s))`.

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-task-status-events-abi-writes-and-creation` green.

## Touches
- tasks/gap-task-status-events-abi-writes-and-creation.md
- packages/quay-native/src/store.ts
- packages/quay-native/test/store.test.mjs
- packages/quay/src/mcp-handlers.ts
- packages/quay/src/cli/task-edit.ts
- packages/quay/src/cli/task-create.ts
- packages/quay/src/cli/lifecycle.ts
- packages/quay/test/task-transition.test.mjs
- packages/quay/src/kernel/task-transition.ts
- packages/quay/src/gate/lifecycle.ts
- packages/quay-native/src/mcp-server.ts
- packages/quay-native/bin/quay-native.ts
- packages/quay/test/cli-write-surface-parity.test.mjs
- packages/quay/test/task-status-events-abi.test.mjs

### Why these six ADDED paths (the Plan named the first eight)
Emitting at the store means the caller's provenance has to CROSS THE PROVIDER ABI, and the
mechanism decides where it must be declared:

- `packages/quay-native/src/mcp-server.ts` — the Provider's `task_write` zod inputSchema. The MCP
  SDK validates `arguments` against it and STRIPS undeclared keys before the handler runs (measured:
  a probe key never reached `store.write`), so `actorKind`/`correlationId` are unreachable without a
  declaration here. (The GitHub provider is out of scope and the Plan says so; its absence is
  declared, not implied.)
- `packages/quay-native/bin/quay-native.ts` — the native CLI's `task edit` gains the same two flags.
  NOT optional: `packages/quay/test/cli-write-surface-parity.test.mjs` machine-reads that zod schema
  and requires every writable field to be flag-wired in BOTH CLIs, so a schema field with no native
  flag is a RED parity test. Wiring the flags keeps that invariant real instead of carving an
  exception list into it.
- `packages/quay/test/cli-write-surface-parity.test.mjs` — the two new zod fields' `FIELD_TO_ACCESS`
  entries (the table the check requires; without them the check reports "no mapping").
- `packages/quay/src/kernel/task-transition.ts` — `from` widens from `string` to `string | null`.
  A creation has NO prior status, and `from:null` must be PRESENT-and-null in the record, not an
  absent key (JSON drops `undefined`; an absent key reads as "not recorded" — 硬规则 3b). Without
  this the create path can only lie or cast.
- `packages/quay/src/gate/lifecycle.ts` — the CLI lifecycle verbs' actual `client.taskWrite` calls
  live here (AC(f)); `cli/lifecycle.ts` cannot stamp provenance the runner never forwards.
- `packages/quay/test/task-status-events-abi.test.mjs` — the surface-level ACs (a)–(f).

### Observed, deliberately NOT changed (out of scope, stated so it is not mistaken for covered)
The carrier `.quay/task-status-events.jsonl` is not listed in `.gitignore` (its `gate-events.jsonl`
sibling is). This task does not change that, because the file lives INSIDE `.quay/` and the fan-in's
`ff` clean-tree check already treats `?? .quay/…` as benign runtime dirty — the same reason the
driver-written carrier has not blocked a landing since the predecessor task. The one NEW consequence
of emitting here: `packages/quay-native/test/cas-write.test.mjs` roots its store inside the checkout,
so a suite run in a worktree now also produces that untracked carrier there. Measured harmless
(untracked, `?? .quay/…`, never staged), but a future rotation/retention change should revisit it.
