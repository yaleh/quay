---
id: DIR-099-C
title: "MCP config_validate tool surface: registerConfigHandlers + CLI-MCP verdict parity"
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-099
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

**Depends on [[DIR-099-A]]** (hard dependency, blocked-by): this child's entire mechanism
and AC2/AC3/AC4 consume DIR-099-A's `validateConfig` module and its malformed-YAML/
unresolved-gate fixtures, which do not exist in the repo until DIR-099-A lands. This child
must NOT be prepared/executed before DIR-099-A is done. If dispatched before M229 lands,
its parity ACs fail closed (soft guard) but the dependency must be declared, not inferred
from parent prose.

Add the `config_validate` MCP tool to `packages/quay/src/mcp-handlers.ts` via a new
`registerConfigHandlers` (following the existing `register*Handlers` convention), proxying
the SAME shared `validateConfig({workspaceRoot, checkFiles}) -> {ok, issues}` module as
the CLI (DIR-099-A) so both surfaces report identical verdicts. MCP input is structured
fields (e.g. `checkFiles?: boolean`) consistent with the `{ok, issues}` contract — NO
`json` input (structuredContent is already JSON; grounded fact #3). Returns
`{ ok, issues[] }` in structuredContent. Third child of the DIR-099 split.

## Chosen mechanism

`registerConfigHandlers(server, deps)` in mcp-handlers.ts: registers a `config_validate`
tool whose handler calls the real `validateConfig()` (same module, no second
implementation — grep-confirmable that mcp-handlers.ts has no gate-shape literals / no
duplicated validation logic). `ok`/`issues` flow into structuredContent.

## Plan

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

## Finding

The original DIR-099 Proposal claimed the MCP surface ("Accepts the same inputs as the
CLI (--check-files, --json)") but no AC falsified it — the split review flagged the
unwired MCP claim and the muddled `--json`-on-a-tool semantics. `mcp-handlers.ts` uses the
`register*Handlers` convention (the CLI parity pattern).

## Requested action

1. `registerConfigHandlers(server, deps)` in mcp-handlers.ts registering `config_validate`
   with structured input (`checkFiles?: boolean`).
2. Handler calls the REAL shared `validateConfig()` — no duplicated logic (grep-guard:
   gate-shape literals absent from mcp-handlers.ts).
3. RED/GREEN tests driving the real MCP surface: CLI and MCP return byte-identical
   `issues[]` on the malformed-YAML and unresolved-gate fixtures (parity).

## Acceptance Criteria

- [ ] `config_validate` is registered via `registerConfigHandlers` (grep-confirmable in
  mcp-handlers.ts), with structured input `checkFiles?: boolean` (no `json` input).
- [ ] MCP `config_validate` returns `{ok, issues[]}` identical to the CLI on the AC2
  (malformed YAML) and AC4 (unresolved gate) fixtures — real parity, not asserted.
- [ ] `checkFiles: true` through MCP behaves identically to CLI `--check-files`.
- [ ] No second validation implementation: `grep` shows gate-shape literals / validation
  logic present in the shared module but NOT duplicated in mcp-handlers.ts.
- [ ] Tests: MCP-surface test driving the real handler, >=80% coverage on the new path.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real MCP `config_validate` dispatch returns the same verdict as the CLI.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does the MCP tool return the identical issue list as the CLI on the same config?

## Touches

- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/test/config-validate.test.mjs (new)` (or sibling MCP-surface test)
- `docs/plans/M231-dir-099-c.md`

**MCP contract clarifications (2026-08-01, from ProposalReview):**

- **`checkFiles` default**: omitted `checkFiles` maps to `false` (byte-parity with the CLI's
  no-flag default — `--check-files` is opt-in).
- **Error path**: a malformed config is a RESULT (`{ok:false, issues}`), not an error. An
  unreadable/absent `.quay/config.yml` or an internal `validateConfig` error returns
  `isError:true` per the repo convention (adr_get/action_run pattern in mcp-handlers.ts).
- **`structuredContent` is the output channel** (an AC names it, not just Proposal prose):
  the handler returns `{ok, issues[]}` in structuredContent — a text-only return violates
  the contract.
- **`registerConfigHandlers(server, cfg)`** follows the explicit-params convention (like
  each `register*Handler(server, getClient, cfg)`), binding `cfg.workspaceRoot` from
  `loadConfig` — not an untyped `deps`.
