---
id: gap-drain-dispose-body-corruption
title: drain-directives.js Dispose-phase subagent can corrupt a task's body —
  real newlines collapsed into literal \n escape sequences
status: done
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

- [x] Root cause identified from a real transcript (the Dispose-phase agent's own `agent-*.jsonl` in
  `subagents/workflows/wf_bb989746-4a0/`) — not speculation about which tool call round-tripped the
  body through JSON-escaping. Confirmed independently TWICE: once during the original repair
  (2026-07-26) and again by a fresh adversarial reviewer subagent (2026-07-31) who re-read the
  actual `task_write` tool-call *input* (not the on-disk artifact) for all 5 Dispose-loop agents
  and found real-newline vs. literal-`\n` counts matching the claimed corrupted/clean split exactly
  (DIR-113/115/116 corrupted, DIR-114/117 clean) — mechanism confirmed as reading `task_get`'s
  JSON-wire-escaped `body` field and copying that escaped text verbatim into the new `task_write`.
- [ ] **Deliberately left open (2026-07-31, mirrors the M204/DIR-126-E and
  gap-build-phase-iteration-evidence-path-not-single-sourced precedent):** "real production
  evidence... shown via a fresh run's own tool-call trace" cannot be produced at land time by
  construction without mutating real state. `drain-directives.js`'s Schedule phase fetches
  **every** `label:directive` task with `extra.dirStatus: pending` unscoped — there is no
  id-filter argument — and this repo currently has real pending directives on `master`
  (`DIR-070-B/C/D`, `DIR-084`, `DIR-085`, `DIR-087`, `DIR-088`, `DIR-118`, `DIR-121`). A real
  dispatch broad enough to exercise the Dispose phase would necessarily also drain those live
  directives (add `label:milestone-candidate`, set `dirStatus: applied`) as an uncontained side
  effect of gathering evidence for an unrelated defect fix — a hard-to-reverse production mutation
  this session is not authorized to trigger unilaterally. Both the implementer and an independent
  reviewer instead validated the mechanism via (a) a scripted CLI reproduction using the exact
  `quay task edit --append-notes` command the new prompt specifies, against a real scratch
  workspace, confirming 0 literal escapes / correct line growth, and (b) a reproduction of the
  *original* corruption shape against the same scratch workspace, confirming the new corruption
  checker correctly fails it closed. This proves the plumbing; it does not prove a live LLM
  subagent will comply with the new prompt in practice. Closes naturally on the next real,
  human-authorized DRAIN dispatch against this repo's live directive queue — no dedicated
  follow-up task needed, since the mechanical corruption check (AC4, unconditional) will catch a
  recurrence of this exact defect class regardless of whether this specific AC is ever
  retroactively checked.
- [x] Dispose-phase prompt (or its underlying mechanism) changed to prevent this class of
  corruption, landed on `master` in both `.claude/workflows/drain-directives.js` and
  `plugin/workflows/drain-directives.js`, byte-identical. Dispose now uses
  `quay task edit --append-notes` (real in-process string concatenation on the `labels`/`extra`
  Core CLI path — verified against `packages/quay/bin/quay.ts:894-901`) instead of having the
  agent retype the whole body via `task_write`.
- [x] The Verify/Dispose phase gains a mechanical post-write check — re-`task_get` each disposed
  directive and fail closed on implausible line-count shrinkage or literal `\n`/`\t` escape
  sequences where real whitespace is expected — since the original run's own `{"failed":[]}`
  summary and `## DRAIN disposition` presence check both silently passed on all 3 corrupted files.
  `drain-dispose-corruption-check.ts` (+ byte-identical `plugin/gate-scripts/` mirror), wired into
  the Verify phase with `oldLineCount` threaded through from Dispose.
- [ ] **Deliberately left open, same rationale as above** — "a real subsequent DRAIN run disposing
  ≥3 directives... produces zero corrupted bodies" requires the same unauthorized live-directive
  mutation. Closes naturally on the next real dispatch.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, a code change alone is insufficient — the real subsequent DRAIN run above is required
evidence, not asserted. **Note (2026-07-31):** the two AC items requiring that specific evidence
are deliberately left unchecked above rather than falsely asserted; see their notes for why this
session cannot produce that evidence without an unauthorized live-directive mutation.

- [x] Landed on `master` under human-steered discipline (drain-directives.js is a driver
  execution-chain script). This session's interactive user is the human steering it — mixed mode,
  per the same explicit instruction governing this batch of gap-fixes.
- [x] The mechanical post-write corruption check is real and independently re-run, not just
  described. `experiments/quay-perpetual-stream/test/drain-dispose-corruption-check.test.mjs`:
  14/14 pass, run independently by both the implementer and a fresh adversarial reviewer subagent,
  who additionally built a real scratch workspace and exercised both the clean and corrupted paths
  end-to-end against the actual `quay task edit`/checker CLI (not just the unit tests).

## Touches

- .claude/workflows/drain-directives.js
- plugin/workflows/drain-directives.js

## DRAIN disposition

Repaired directly by the orchestrating session (2026-07-26): `DIR-113`, `DIR-115`, `DIR-116`
bodies restored from the authoring session's own verbatim record via `mcp__quay__task_write`.
`DIR-114`/`DIR-117` were unaffected, no repair needed.

## Execution record

Executed directly (mixed mode, 2026-07-31, per explicit user instruction). Dispose-phase prompt
rewritten to route the append through `quay task edit --append-notes` instead of agent-retyped
`task_write`; new `drain-dispose-corruption-check.ts` (+ byte-identical `plugin/gate-scripts/`
mirror) wired into Verify. New test file
`experiments/quay-perpetual-stream/test/drain-dispose-corruption-check.test.mjs` (14/14 pass).
Independent verification via a fresh subagent reviewer standing in for Audit: verdict CONCERNS —
root cause, diff, `--append-notes` mechanism, byte-identity, and the checker's own test suite all
independently re-verified and held up (including the reviewer's own from-scratch end-to-end
reproduction against a real scratch workspace); the two AC items requiring a real live-directive
DRAIN dispatch were correctly flagged as unmet and are left deliberately open above rather than
falsely asserted, since satisfying them would require an unauthorized mutation of this repo's real
pending directives. One residual non-blocking observation from the reviewer (Dispose step 3 still
has the agent manually reconstruct a merged `extra` JSON object, which retains a narrower version
of the same retype-risk pattern on a field that in practice only ever holds single-line scalars
today) — not filed as a separate follow-up task per the reviewer's own framing ("worth flagging...
not a blocking defect"); noted here for visibility instead.

**Outcome:** done.
