# M169 Iteration 0 Acceptance Audit (ADVERSARIAL — INDEPENDENT PASS)

**Audit session id:** 890af9ef-77fb-4a3c-9673-01ab2951058b

**Date:** 2026-07-26
**Auditor:** Claude (deepseek-v4-pro) — INDEPENDENT adversarial audit (fresh context, not the build agent)
**Task:** DIR-063-B
**Charter:** M169-dir063-b-chart-saturation-wiring.md

## Prior audit note

The pre-existing audit artifact (also at this path) was performed "inline by the same agent that ran the build verification" and explicitly stated "A post-land independent adversarial audit is recommended per inherited-core clause 1." This audit PASS is that independent post-land adversarial audit.

## AC Verification (independent, refute-first)

### AC-1: OUTER-LOOP.md wiring (chart-saturation-check as PRE-STEP + TRANSITION-DUE gating)

**Verdict: CONFIRMED (independent)**

Evidence (fresh reads, this session):
- `grep -n 'chart-saturation-check' OUTER-LOOP.md` → line 189: `saturated = invoke("scripts/chart-saturation-check.ts", {slope, headroom, counter: s.milestone_counter})` — inside `halt_self()` (lines 185-201)
- The function flow: slope computed (187) → headroom computed (188) → saturation computed (189-190) → THEN decision tree (193-196). The saturation check is a PRE-STEP — it runs BEFORE any halt verdict.
- `grep -n 'subagent_draft' OUTER-LOOP.md` → only at line 194: `saturated=TRANSITION-DUE → subagent_draft → TRANSITION-RECOMMENDED`. No other occurrence of subagent_draft anywhere in the file.
- Lines 198-199: explicit constraint `¬per-milestone; ¬unconditional per-checkpoint` — independently verified.

### AC-2: Golden-replay (cp-120, current, simulated saturated)

**Verdict: CONFIRMED (independent)**

Independently executed `chart-saturation-check.ts` with three scenarios (this session, not the implementer's self-report):

| Scenario | slope | headroom | counter | Verdict | Confirmed |
|---|---|---|---|---|---|
| cp-120-like | 0.128 | 0.30 | 120 | NOT-DUE | Yes |
| current (healthy) | 9.33 | 0.30 | 169 | NOT-DUE | Yes |
| simulated saturated | 0.01 | 0.04 | 120 | TRANSITION-DUE | Yes |

Command: `node --no-warnings experiments/quay-perpetual-stream/scripts/chart-saturation-check.ts --slope <n> --headroom <n> --counter <n> --json`

Results match the AC claims. The detector correctly distinguishes saturation from slow-growth halt. The underlying slope/governance math is unchanged — the detector reads already-computed values, it does not compute them.

### AC-3: Existing driver selfchecks/fixtures stay green

**Verdict: CONFIRMED (independent)**

Independently executed (this session):
- `bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh` → **17/17 PASS** (all 17 DoD fixtures behaved as asserted)

### AC-4: split-or-commit check passes

**Verdict: CONFIRMED (independent)**

Independently executed (this session):
- `npx tsx experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` → **PASS: 428 task(s) checked — no split-or-commit violations**

## DoD Verification

### Mechanical gate (it0-dod-check.sh)

**Verdict: PASS — exit 0**

Independently executed (this session):
```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-063-B \
  experiments/quay-perpetual-stream/charters/M169-dir063-b-chart-saturation-wiring.md \
  /tmp/m169-absorb-entry.md
→ PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
```

Standard inherited-core clauses 0-12 all PASS or N/A — confirmed by independent mechanical gate run.

### Extra DoD clauses (task-specific)

**Clause 1:** "The detector is OPERATED on a REAL checkpoint (the next `cp-NN` after this lands) and its `TRANSITION-DUE`/counter output is recorded in that checkpoint as a real artifact — not a fixture."

**Status: POST-LANDING ESCROW — not satisfiable at this stage.** The clause explicitly says "after this lands." DIR-063-B is at `status: ready` — it has not landed. The next qualifying checkpoint is cp-170 (milestone_counter currently at 168, checkpoints every 5 milestones). This is correctly designed as a post-landing escrow condition. Task should remain at `ready` (or be promoted to `done` with this clause acknowledged as post-landing escrow).

**Clause 2:** "Authored `human-steered` (clause 1): under `.halt` off-loop, golden-replay behavior-preserving (diff pasted, no change to slope/governance math), independently adversarial-audited."

**Status: SUBSTANTIALLY CONFIRMED.** Task labels include `human-steered`. Proposal states "Authored under `.halt` off-loop." Golden-replay independently confirmed (see AC-2 above). The independent adversarial audit is this pass (session 890af9ef-77fb-4a3c-9673-01ab2951058b). The `.halt` sentinel exists on disk currently (`experiments/quay-perpetual-stream/.halt` — untracked, per git status snapshot). Historical `.halt` state at edit time cannot be reconstructed from git alone — but the human-steered labeling and Proposal attestation are consistent.

**Clause 3:** "Escrow: stays open until the real-checkpoint detector output + golden-replay-clean wiring both exist on `master`. On landing, [[DIR-063]] itself flips `dirStatus: applied`."

**Status: CONCERN — DIR-063 `dirStatus: applied` was flipped before a post-wiring checkpoint has fired.** DIR-063 currently shows `dirStatus: applied` (commit 3f921fa, 2026-07-24). The escrow condition requires "real-checkpoint detector output + golden-replay-clean wiring both exist on master." Golden-replay-clean wiring IS on master (OUTER-LOOP.md lines 185-201 confirmed). The real-checkpoint detector output: cp-135 (latest checkpoint, M135) has a manual saturation assessment ("Chart-2 headroom: 30.6%, No TRANSITION-DUE") but predates DIR-063-B's OUTER-LOOP.md wiring (M169). The post-wiring checkpoint (cp-170) has not yet been written. The cp-135 manual assessment is arguably sufficient in substance (same criteria evaluated, correct NOT-DUE result), but the strict DoD calls for post-wiring detector operation. Mild process concern.

## Scripts verified independently

| Script | Status | Evidence |
|---|---|---|
| `scripts/chart-saturation-check.ts` | EXISTS, golden-replay PASS | 3/3 scenarios independently confirmed |
| `scripts/chart-headroom.ts` | EXISTS, returns float | Output: 0.3058823529411765 (30.6% headroom) |
| `scripts/rolling-slope-check.ts` | EXISTS | Referenced in halt_self |
| `scripts/termination-delta-v-check.ts` | EXISTS | Referenced in halt_self |
| `scripts/it0-dod-check.sh` | PASS exit 0 | 12/12 clauses satisfied |
| `scripts/dod-fixture-selfcheck.sh` | 17/17 PASS | Independently confirmed |
| `scripts/it0-split-or-commit-check.ts` | PASS | 428 tasks, no violations |

## Overall verdict

**CONCERNS** — All 4 AC items independently confirmed. Standard inherited-core DoD satisfied (mechanical gate exit 0). One concern: DIR-063 parent directive `dirStatus: applied` was flipped before a post-wiring checkpoint has fired — cp-135's manual saturation assessment predates DIR-063-B's wiring. This is a mild process concern, not an implementation defect. The OUTER-LOOP.md wiring is correct, the chart-saturation-check detector works correctly (all 3 golden-replay scenarios independently verified), and the subagent-drafting is strictly gated behind TRANSITION-DUE (single occurrence at line 194, anti-cost-explosion constraint at lines 198-199).

The three extra DoD clauses are in tension: clause 1 requires post-landing checkpoint operation that hasn't happened yet (correct escrow design), clause 2 is substantially satisfied (golden-replay + independent audit confirmed), and clause 3 exposes a mild premature escrow release on the parent directive. The implementation itself is sound.
