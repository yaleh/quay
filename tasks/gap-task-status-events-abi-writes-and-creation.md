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
- packages/quay/src/kernel/task-transition.ts
- packages/quay/src/gate/lifecycle.ts
- packages/quay-native/src/mcp-server.ts
- packages/quay-native/bin/quay-native.ts
- packages/quay/test/cli-write-surface-parity.test.mjs
- packages/quay/test/task-status-events-abi.test.mjs

### Why these five ADDED paths (the Plan named the first eight)
Emitting at the store means the caller's provenance has to CROSS THE PROVIDER ABI, and the
Mechanism decides where it must be declared:

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
- `packages/quay/test/task-status-events-abi.test.mjs` — the surface-level ACs (a)–(f). The other
  two test files pin the store's choke point and the kernel contract; neither can see whether a Core
  CLI handler, a lifecycle verb or the Provider's schema actually carries the provenance to it.
