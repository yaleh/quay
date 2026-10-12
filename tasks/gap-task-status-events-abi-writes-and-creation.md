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

## Acceptance Criteria
- [ ] Tests exit 0, covering:
  - (a) `task create` ⇒ one `create` event with `from:null`;
  - (b) `task edit --status ready` with `--expect-status todo` ⇒ one event, and a failed CAS ⇒ zero events;
  - (c) MCP `task_write` status change ⇒ one event, `actor.kind:"mcp"`;
  - (d) a body-only edit ⇒ zero events;
  - (e) `correlationId` passed through when given, absent when not;
  - (f) lifecycle `promote` / `retreat` / `complete` each ⇒ one event.
- [ ] Negative control: remove the emit in a scratch copy ⇒ (a)–(c) red. Paste the output.
- [ ] Production reading: the next real `quay task create` or `task edit --status` in this workspace after landing has its event with `evidence.commit` resolving to the ABI commit. Paste both. （待外部）

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
