---
id: gap-drain-dispose-body-corruption
title: drain-directives.js Dispose-phase subagent can corrupt a task's body —
  real newlines collapsed into literal \n escape sequences
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Rewrite the DRAIN Dispose-phase `agent()` prompt so it can no longer reconstruct a task body from a
JSON-escaped intermediate representation — either by instructing it to use the Provider ABI's own
`body` field value directly (never a shell-printed/`--json`-piped copy), or by moving the actual
append operation out of the agent's freeform text handling into a small deterministic script step
the agent only invokes with arguments (id, section text). Add a mechanical post-write verification
in the Dispose/Verify phase that catches this exact corruption shape (implausible line-count
shrinkage, or literal `\n`/`\t` two-character sequences where real whitespace is expected) and fails
closed rather than trusting the workflow's own `{"failed":[]}` summary, which did not catch this the
first time. Retrofitted with a `## Proposal`/`## Plan`/`## Acceptance Criteria` structure
(2026-07-28) to bring this task into schema conformance; no change to the Finding/Requested
action substance below, which was already real and root-caused.

## Plan

N/A — directive resolved via a human-steered milestone (this touches
`.claude/workflows/drain-directives.js`, a driver execution-chain script — quay-directive skill
step-4 override applies).

## Finding

A real `Workflow({name:"drain-directives", args:{workspaceRoot:"/home/yale/work/quay"}})` call
(run `wf_bb989746-4a0`, 2026-07-26, dispatched from the orchestrating session to gather real
post-DIR-114-fix evidence) drained 5 directives (`DIR-113/114/115/116/117`) with a clean
`{"drained":5,"failed":[]}` result — but 3 of the 5 (`DIR-113`, `DIR-115`, `DIR-116`) came out of
the Dispose phase with their bodies corrupted: **every real newline was replaced by a literal
two-character `\n` escape sequence**, collapsing bodies from 122/100/99 real markdown lines down to
16-17 lines of unreadable escaped text. `DIR-114` and `DIR-117` (dispatched in the same Dispose
loop, same prompt template, same `task_write` instructions) came out fine.

This is NOT a bug in the checked-in `.claude/workflows/drain-directives.js` script — it already
carries the DIR-114 args-normalization fix and its own logic never touches body content directly;
the Dispose phase's prompt instructs a dispatched `agent()` to `task_get` the task, then
`task_write` an appended `## DRAIN disposition` section "append to existing body, do not replace".
The corruption is consistent with that dispatched subagent, when constructing the new body to pass
to `task_write`, using a JSON-escaped string representation of the body it read (e.g. piping through
a tool that returns/prints the body as a JSON string literal, like `\`task_get ... --json | jq
'.task.body'\`` without \`-r\`/raw-output, or otherwise treating the MCP tool result's body field as
literal text including its JSON escaping) instead of the actual unescaped multi-line string.

5 independent Dispose-loop iterations (one `agent()` call per directive, same prompt shape) → 3
corrupted, 2 clean. This reads as non-deterministic subagent execution, not a deterministic code
defect — meaning it cannot be "fixed" by a single code change to `drain-directives.js` alone; the
Dispose prompt likely needs either (a) an explicit, unambiguous instruction for how to construct
the appended body (never round-trip through a JSON-string intermediate), or (b) to switch from
"agent reads+manually reconstructs body" to a mechanical script step that does the append via a
proper markdown-string operation, not an LLM-mediated one.

**Real evidence (before repair, captured directly from disk):**
```
$ wc -l tasks/DIR-113.md tasks/DIR-115.md tasks/DIR-116.md
16 tasks/DIR-113.md   (was 122 lines pre-DRAIN)
17 tasks/DIR-115.md   (was 100 lines pre-DRAIN)
16 tasks/DIR-116.md   (was 99 lines pre-DRAIN)
```
Body content of e.g. `DIR-113.md` post-corruption (single line, truncated):
```
## Proposal\n\n把并发批次调度的 touches-orthogonality 预检，从"charter-authoring 之后"前移到...
```
— i.e. the literal two characters `\` and `n`, not a real line break, throughout.

**Blast radius:** this silently breaks EVERY tool that parses task body markdown structurally —
`## Touches` extraction (`parseTouches`), AC/DoD checkbox counting (`it0-dod-check.sh`'s
clause0-ac-dod-present), `human-steered-classify.ts`'s driver-file detection if it ever scans body
text, and any future `grep`/section-heading lookup — while `task_get`/`task_write` themselves keep
working fine (the string round-trips correctly at the storage layer; only the ON-DISK markdown
rendering is corrupted for human/mechanical-tool readability). A human skimming the file or a
`grep -n '^## '` would see the task as apparently gutted.

## Requested action

1. Investigate the Dispose-phase agent's actual tool-call sequence (via its own
   `agent-*.jsonl` in the drain-directives workflow's `subagents/workflows/wf_bb989746-4a0/`
   transcript) for the 3 corrupted vs. 2 clean directives, to nail the exact mechanism (which tool
   call round-tripped the body through JSON-escaping).
2. Rewrite the Dispose phase's `agent()` prompt to explicitly forbid reconstructing the body from
   a printed/JSON representation — e.g. instruct it to use the Provider ABI's own `body` field
   value directly (never a shell-printed/`--json`-piped copy), or move the actual append operation
   out of the agent's freeform text handling into a small deterministic script step the agent only
   invokes with arguments (id, section text), not one that re-types the whole body.
3. Add a mechanical post-write verification: after Dispose, re-`task_get` each disposed directive
   and assert the body's line count didn't shrink implausibly (e.g. new-line-count ≥ some fraction
   of old) and/or that it contains zero literal `\n`/`\t` two-character sequences immediately
   followed by non-whitespace in a position that would only appear from bad escaping — fail-closed,
   flag for human review rather than silently accepting a corrupted write.

## Acceptance Criteria

- [ ] Root cause identified from a real transcript (the Dispose-phase agent's own `agent-*.jsonl` in
  `subagents/workflows/wf_bb989746-4a0/`) — not speculation about which tool call round-tripped the
  body through JSON-escaping.
- [ ] Dispose-phase prompt (or its underlying mechanism) changed to prevent this class of
  corruption, landed on `master` in both `.claude/workflows/drain-directives.js` and
  `plugin/workflows/drain-directives.js`, byte-identical.
- [ ] The Verify/Dispose phase gains a mechanical post-write check — re-`task_get` each disposed
  directive and fail closed on implausible line-count shrinkage or literal `\n`/`\t` escape
  sequences where real whitespace is expected — since the original run's own `{"failed":[]}`
  summary and `## DRAIN disposition` presence check both silently passed on all 3 corrupted files.
- [ ] A real subsequent DRAIN run disposing ≥3 directives with non-trivial bodies (100+ lines each)
  produces zero corrupted bodies — verified by real line-count/content inspection post-run, not
  trusted from the workflow's own summary.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, a code change alone is insufficient — the real subsequent DRAIN run above is required
evidence, not asserted.

- [ ] Landed on `master` under human-steered discipline (drain-directives.js is a driver
  execution-chain script).
- [ ] The mechanical post-write corruption check is real and independently re-run, not just
  described.

## Touches

- .claude/workflows/drain-directives.js
- plugin/workflows/drain-directives.js

## DRAIN disposition

Repaired directly by the orchestrating session (2026-07-26): `DIR-113`, `DIR-115`, `DIR-116`
bodies restored from the authoring session's own verbatim record via `mcp__quay__task_write`.
`DIR-114`/`DIR-117` were unaffected, no repair needed.
