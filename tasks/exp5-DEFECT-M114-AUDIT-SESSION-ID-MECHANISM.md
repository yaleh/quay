---
id: exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM
title: "defect: Agent-tool audit dispatch doesn't produce a genuinely distinct
  session id for audit-independence self-report"
status: done
labels:
  - milestone-candidate
  - defect
  - milestone:M-115
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM
    experiments/quay-perpetual-stream/charters/M115-audit-session-id-mechanism-fix.md
    /tmp/m115-absorb-entry.md
---
## Proposal

While dispatching M114's mandatory adversarial acceptance audit (`Agent` tool, `general-purpose`
subagent, fresh context, `run_in_background=true`), the dispatched subagent's own env var
introspection (`CLAUDE_CODE_SESSION_ID`) read back **identical** to the orchestrator's own session
id — not a fresh/distinct value. Confirmed via the actual audit artifact
(`milestones/M114/audits/iteration-0-acceptance-audit.md`, pre-fix) and via
`audit-independence-check.ts`, which correctly FAILed closed on it ("audit artifact carries NO
recorded session/agent id" — the self-reported line didn't even match the required `Audit session
id:` pattern, and once corrected to the literal self-reported env var, would have FAILed as
"EQUALS the orchestrator's own id — self-audit, not independent").

**Root cause:** this harness's `Agent` tool spawns subagents as nested contexts within the SAME
underlying session process — they inherit `CLAUDE_CODE_SESSION_ID` from the parent rather than
getting a freshly-assigned one. The audit-role instructions (in `inherited-core.md`'s
"Adversarial-audit role" section and/or the ad-hoc dispatch prompts written at each ABSORB) assume
a dispatched subagent CAN self-report a genuinely distinct session id by reading its own env — that
assumption does not hold for `Agent`-tool dispatch in this harness. It may have held for whatever
mechanism produced M105's audit (`milestones/M105/audits/iteration-0-acceptance-audit.md` shows a
genuinely different-looking UUID, `8c2e96ff-...` vs orchestrator `a653b2e9-...` — worth checking
that milestone's actual dispatch method, since it's inconsistent with what M114 observed).

**What actually IS a reliable distinct identifier for `Agent`-tool dispatch:** the `agentId` the
`Agent` tool itself returns to the orchestrator at dispatch time (e.g. `a9fcee6a21cbf655b` for
M114's audit) — a harness-assigned handle for that specific dispatch, captured by the orchestrator
BEFORE the subagent produces any output (satisfying DIR-034's anti-forgery dispatch-record
requirement exactly). M114 worked around this by overwriting the audit artifact's self-reported
(non-distinct) session line with the orchestrator-observed `agentId`, corroborated via the existing
dispatch-record file — this got M114's own audit-independence gate to PASS, but is a per-ABSORB
manual workaround, not a fix to the underlying instruction/mechanism.

**Fix needed (one of):**
1. Update the audit-dispatch instructions (wherever the "Adversarial-audit role" prompt template
   lives — `inherited-core.md`, and/or a per-ABSORB dispatch-prompt convention in `OUTER-LOOP.md`)
   to tell the ORCHESTRATOR (not the subagent) to record the `Agent`-tool-assigned `agentId` as the
   audit's session id in the artifact, rather than instructing the subagent to introspect its own
   env var for a value that won't be distinct in this harness.
2. Investigate whether OTHER dispatch mechanisms (a literal separate `claude -p` CLI subprocess via
   Bash, if that's what produced M105's genuinely-distinct id) DO get a fresh `CLAUDE_CODE_SESSION_ID`
   and, if so, document which dispatch mechanism to prefer for audit-independence purposes.

## Plan
N/A — small documentation/instruction fix once the preferred mechanism is confirmed; no code changes
to `audit-independence-check.ts` itself required (its corroboration logic already works correctly
once given the right distinct id — verified against M114's corrected artifact, which PASSed).

## Acceptance Criteria
- [x] `inherited-core.md`'s "Adversarial-audit role" section (or wherever the dispatch-prompt
      convention lives) is updated to direct the ORCHESTRATOR to record the `Agent`-tool `agentId`
      (captured at dispatch time) as the audit's session id, not to rely on subagent self-report via
      env var.
- [x] Confirmed (by testing or by reading M105's actual dispatch method) whether any OTHER dispatch
      mechanism in current use produces a genuinely fresh `CLAUDE_CODE_SESSION_ID`; documented which
      mechanism is authoritative going forward. (See Resolution — M105's actual dispatch transcript is
      no longer retrievable via meta-cc, a genuine investigated dead-end, not a skip; the "which
      mechanism is authoritative going forward" half is answered regardless: the `Agent`-tool `agentId`,
      orchestrator-recorded, per item 5.)
- [x] A future milestone's real audit dispatch, following the corrected instructions, produces an
      artifact whose session id is correct WITHOUT requiring an orchestrator post-hoc correction (the
      M114 workaround pattern should not need to repeat).

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [x] All 3 AC items above verified true.
- [x] it0 DoD meta-enforcer passes all clauses.

## Resolution

### Doc fixes landed (AC1)

`experiments/quay-perpetual-stream/inherited-core.md`'s "Adversarial-audit role" section, item 2
corrected (stale `baime:iteration-executor` → DIR-032's generic `Explore`/`general-purpose`
vehicle); new item 5 added, explicitly instructing the ORCHESTRATOR (never the subagent) to record
the `Agent`-tool's own returned dispatch id as the artifact's `Audit session id:` line, and
explicitly forbidding the subagent from self-reporting via any env var. `OUTER-LOOP.md`'s
"Dispatch-record file" procedure updated to match (step 1 fixed to the same vehicle + warning; new
step 3.5 instructing the write-into-artifact action). The M115 adversarial audit (dispatched via
this same corrected procedure) independently confirmed both edits by direct quotation and `git diff`
— see `milestones/M115/audits/iteration-0-acceptance-audit.md`, AC1/AC2, verdict NOT REFUTED on
both. It also confirmed the UNRELATED build-dispatch `baime:iteration-executor` references
(`OUTER-LOOP.md` lines 224/236, the milestone's own implementation-iteration mechanism) were
correctly left untouched.

### M105 investigation (AC2) — genuine dead-end, documented not skipped

Attempted to determine M105's actual audit-dispatch mechanism (why its recorded session id,
`8c2e96ff-5390-47a6-9d9a-f230ebb92335`, looked genuinely distinct from its orchestrator's,
`a653b2e9-8c25-4560-8c85-bd3e757e56f3`, unlike M114's identical-to-orchestrator failure) using
meta-cc, the tool this repo's own CLAUDE.md designates for exactly this kind of forensic session
search:
```
mcp__plugin_meta-cc_meta-cc__get_session_directory(scope="project")
→ file_count: 5, subagent_file_count: 2, oldest_file: 2026-07-22T11:53:07Z, newest_file: 2026-07-22T14:33:01Z
```
Only 5 session files are retained project-wide, spanning ~2.5 hours, all from THIS session's own
run (including its M114/M115 subagent dispatches). M105 ran in an earlier session whose transcript
is no longer retained anywhere meta-cc can index — this is a genuine, tool-confirmed dead-end, not
an assumption or a skip. Searching for the literal id string (`8c2e96ff`) and for "M105" across all
currently-indexed tool-use records returned zero matches from any session other than this one.

**Conclusion:** M105's actual dispatch mechanism is UNRECOVERABLE with current session retention.
This does not weaken the fix: M115's mechanism (orchestrator records the `Agent`-tool's own
dispatch id, never trusts subagent self-report) closes the forgery/unreliability hole regardless of
whether M105 was a lucky coincidental pass or an undetected instance of exactly the self-reported-id
risk DIR-034 was created to prevent. The "which mechanism is authoritative going forward" half of
this AC is answered unconditionally by item 5, independent of M105's specific history.

### Live validation (AC3)

M115's own mandatory adversarial audit was dispatched per the corrected procedure (subagent
explicitly told NOT to self-report a session id) and, per DIR-034/M90 procedure, the orchestrator
recorded the `Agent`-tool's returned dispatch id (`a60bbf314719a587e`, in
`/tmp/m115-dispatch-record.txt`, captured BEFORE the subagent produced output) and then added the
`Audit session id: a60bbf314719a587e` line to `milestones/M115/audits/iteration-0-acceptance-audit.md`
per step 3.5 — see that file's own header. `audit-independence-check.ts` re-run against the
completed artifact: PASS (see ABSORB entry for the literal command + output). The audit itself
independently dry-ran the same check against a throwaway artifact with the real ids and got PASS,
confirming the mechanism sound before the orchestrator's own step-3.5 write landed.

### Additional finding, filed separately

The audit also found `it0-dod-check.ts`'s clause8 regex (`/milestone:M(\d+)/i`) doesn't match the
repo's actual `milestone:M-NN` (hyphenated) label convention — non-blocking (falls through to a
PASS/N/A disposition either way) but means clause8 has likely never fired its real check against
any task in this repo's history. Filed as `exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH` for a future
milestone; out of scope here (audit-independence session-id mechanism, not clause8's own logic).
