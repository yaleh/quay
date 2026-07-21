# Charter M88-history-mining-explore — meta-cc session-history mining (explore)

**Milestone id:** M88  
**Task:** `tasks/exp5-M-HISTORY-MINING-EXPLORE.md` (milestone-candidate, explore)  
**Surface:** exp5 Claude Code session history (process/provenance axis)  
**Type:** explore / discovery  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

M88 is a mandatory explore milestone (M84–M87 were four consecutive exploits; ≥1-in-5 rule
requires explore at M88). The process/provenance axis — what recurred, what was learned, what
drifted across sessions — is currently dark. Every high-value correction in exp5 has come from
a human running meta-cc ad hoc. This milestone does that mining systematically.

This is the **first direct use of the `history-mining.md` probe concept** shipped in M86
(DIR-056): the queries, finding taxonomy (defect/adr/pattern), and evidence requirement
(session-id + turn/commit ref) follow the probe spec. It is a ONE-TIME manual exploration, not
the standing routine (DIR-055 will wire the automation later).

**meta-cc tools available:**
- `query_session_signals` — signals / anomalies per session
- `analyze_errors` — recurring error patterns
- `query_edit_sequences` — edit patterns and reversions
- `query_session_content` — content search across sessions
- `get_tech_debt` — accumulated tech debt signals
- `get_work_patterns` — work pattern analysis
- `get_timeline` — session timeline

## Scope

**In scope:**

1. **Session history mining** — run ≥3 distinct meta-cc tool types against the exp5 project
   session history; document raw findings in `milestones/M88/audits/history-mining-findings.md`

2. **Finding classification** — classify each finding as defect/gap, ADR candidate, or
   crystallizable pattern (REFUTE-first: seek evidence of failure, not success)

3. **Filing tasks** — file ≥1 evidence-backed task per reachable class:
   - defect/gap → `milestone-candidate` label
   - ADR candidate → `adr-draft` label  
   - pattern → `crystallization` label
   Each task MUST cite a session-id + turn/commit reference; ref-less filings are rejected

4. **Findings report** — `milestones/M88/audits/history-mining-findings.md` with raw
   meta-cc output, classification rationale, and task IDs for every filed task

**Out of scope:**
- Implementing the standing routine (DIR-055)
- Changing product code
- Auto-executing any findings (FILE-only; SELECT drives them under normal gates/audit)

**REFUTE-first constraint:** all queries must seek to surface what went wrong, what recurred,
what was lost — never file self-congratulatory or loop-favorable tasks (ADR-004 anti-gaming).

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** Explore milestone; no per-file line delta. Scope: ≤1 findings
report artifact (~200L) + ≤3 filed task files (~60L each). Well under 2000L ceiling.

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** N/A — deliverable is a findings report + filed tasks (not
a domain-misfit category).

**(e) plan-time line-budget gate:** ~380L estimated. Under 2000L ceiling.

## Class routing

**Explore-class** (discovery → one-pass mining + file findings). Direct to execution.

## Value hypothesis

- **Y:** ≥1 evidence-backed defect/gap task + ≥1 ADR candidate or pattern task filed; process/provenance axis illuminated for the first time in exp5
- **Δv̂ = 0** (discover/explore, no VT chart-1 cell)
- **Value type:** discovery/explore + instrument-correction

## Done-when (binary)

1. `milestones/M88/audits/history-mining-findings.md` exists with ≥3 meta-cc tool types run and raw output pasted
2. ≥1 evidence-backed task filed per reachable class (defect, ADR, or pattern); each task has session-id + turn/commit ref in its body; paste task IDs
3. All filed tasks have correct labels per finding type
4. No product code changes (git-status clean of `packages/`; explore-only)
5. `tsc --noEmit` exits 0 (no regressions)
6. Test suite ≤ 11 failures (quay + quay-native)
7. Adversarial audit verdict recorded

## Inner termination (§3.2)

1. All 7 Done-when confirmed.
2. No findings of any class after exhaustive querying → declare "instrument run, no new findings" and close done (valid explore outcome).
3. meta-cc MCP unavailable → `needs-human`.
4. Past budget ~5 iterations.
5. External HALT.

## HARD GATES (by-reference):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly.

## Per-milestone acceptance audit (UNCONDITIONAL)

Specific charge:
1. Verify findings report at `milestones/M88/audits/history-mining-findings.md` — confirm ≥3 meta-cc tool types run, raw output present.
2. Verify ≥1 filed task per reachable class — read each filed task, confirm session-id/turn/commit ref present in body.
3. Confirm all filed tasks have correct labels per finding type.
4. Confirm no product code changes (git-status / git-diff against `packages/`).
5. Run `tsc --noEmit` — confirm exit 0.
6. Run test suite — confirm ≤11 failures.
7. Confirm REFUTE-first discipline: no self-congratulatory or loop-favorable task was filed.

Output to `milestones/M88/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-HISTORY-MINING-EXPLORE experiments/quay-perpetual-stream/charters/M88-history-mining-explore.md /tmp/m88-absorb-entry.md`
- `quay gate exp5-M-HISTORY-MINING-EXPLORE`
- Worktree: `milestones/M88/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m88 · exp5-M-HISTORY-MINING-EXPLORE · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M88/`
- No Web UI verification required (no Web UI surface change)
- VT Δ = 0
