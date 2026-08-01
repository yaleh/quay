# M211 / DIR-119-D3 — iteration-0 acceptance audit

**Audit session id:** fce11849-b5c4-4ce4-afe5-7b960ca2ad0c
**Date:** 2026-08-01 · **Auditor:** fresh-context adversarial acceptance audit (had NOT seen the build)
**Task:** `tasks/DIR-119-D3.md` · **Charter:** `experiments/quay-perpetual-stream/charters/M211-dir119d3-audit-readonly-shards.md`
**Build commit:** `69b57b7f` (the milestone's real implementation; misattributed message — see provenance) · **Dispatch base:** `efb8ec6f`
**MILESTONE_ROOT:** `milestones/M211` (via `gate_resolve_milestone_root 211`)

## Verdict: REFUTED

- **4 of 7 AC items CONFIRMED** with auditor-generated evidence: AC1 (the master item — production wiring), AC4, AC5, AC6.
- **3 of 7 AC items REFUTED as unconfirmable at iteration-0:** AC2, AC3, AC7 — each demands, in its own text, evidence off a REAL composite dispatch's `journal.jsonl` (typed-return shard-count equality / exactly-once combine / a fresh zero-finding wiring audit) that does not exist anywhere on disk.
- **DoD: 2 of 4 CONFIRMED** (landed on master under human-steered discipline; RED/GREEN evidence exists for the audit-shard read-only check), **2 REFUTED** (real non-fixture composite dispatch; fresh audit with zero unresolved findings).
- **Mechanical gate** `it0-dod-check.sh DIR-119-D3 <charter> milestones/M211/absorb-entry.md` → **exit 1**: `clause0-ac-dod-present` FAIL — "checklist-form AC has 3 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks)"; every other clause PASS/N/A (1–8, 10–12 PASS/N/A; 9 N/A, no needs-human declared).
- The audit charge's two REFUTED rules both fire: "Any AC you cannot confirm → REFUTED" and "Non-zero exit = REFUTED by construction."

This is a REFUTED-by-absence-of-required-evidence driven by a Plan/gate sequencing contradiction (root cause below), NOT a finding that anything about the implementation is false. Every structural/test half this audit could reach was reached and verified; nothing was refuted on the merits. This is structurally identical to the sibling M210/DIR-119-D2 acceptance audit (same session, one milestone earlier), which was REFUTED for the same post-Land-sequencing reason.

## REFUTED items — evidence

**Common evidence (auditor-run, 2026-08-01):** NO real composite dispatch through the new per-shard Audit dispatcher has ever run.
- `grep -l '"shardResult"'` and `grep -l '"bundleVerdict"'` over ALL 228 `journal.jsonl` under `~/.claude/projects/-home-yale-work-quay` → **0 files** carry either typed return. The journal shape this milestone's own Plan verified (`{type, key, agentId, result?}`, with the full typed return persisted on `result` entries) means a real `audit-shard-<id>` dispatch WOULD persist `.result.shardResult` and a real `audit-combine` WOULD persist `.result.bundleVerdict`; neither appears anywhere.
- The 9 journals containing the bare string `audit-shard` are embedded SOURCE/PROMPT text (the `execute-milestone.js` body and audit charge text carried in transcripts), not dispatch records — confirmed by the 0-count on the JSON-key forms `"shardResult"`/`"bundleVerdict"`.
- The builder's own `milestones/M211/iterations/iteration-0.md` AC table discloses this openly: AC1 = "STRUCTURAL half discharged; REAL-exercise half post-Land"; AC2/AC7 = "post-Land"; AC3 = "STRUCTURAL half discharged; count post-Land". The Plan's Stage 6 and its evidence appendix both say "To be appended after Land."

**AC2 (real composite dispatch `journal.jsonl` — `audit-shard-<id>` count == `auditShards[]` count, per-shard scope limited to its `taskIds`) — REFUTED.** The AC's evidence contract is a real dispatch's `journal.jsonl`; none exists (0/228 journals carry a `shardResult` typed return). Structural half verified by code reading: `_compositePerShardAudit()` maps each `auditShards[]` entry to exactly one `agent(_compositeAuditShardPrompt(shard,...), { label: \`audit-shard-${shard.id}\`, ... })` in a serial `for...of` (execute-milestone.js L508-545), and the shard prompt interpolates ONLY that shard's `id`/`kind`/`taskIds` (L429-432) with an explicit "inspect NOTHING outside it / do NOT reference any OTHER shard's task IDs" instruction (L429, L434) — so a real dispatch WOULD record one scope-limited entry per shard; the record does not exist.

**AC3 (`audit-combine` exactly once per composite dispatch, distinct label, excluded from shard count, invokes real `combineShardVerdicts`) — REFUTED on the AC's real-dispatch count clause.** The import-grep half IS confirmed: exactly one `audit-combine` dispatch (L549) with `label: 'audit-combine'` (L558, distinct from the `audit-shard-*` pattern) runs `composite-audit.ts --combine-json` (L554), which wraps the REAL exported `combineShardVerdicts()` via the thin `combineShardVerdictsFromJson` delegate (composite-audit.ts L159-165, `return combineShardVerdicts(...)`) — never a reimplementation; the "--combine-json wraps the REAL combineShardVerdicts (byte-equal to the direct-import result)" unit test passes. But "appears exactly once per composite dispatch" and "excluded from the shard-count check" are claims about a real dispatch's journal return-shape disjointness — no such dispatch exists, so the count/exclusion cannot be observed.

**AC7 (fresh independent wiring audit — briefed to trace import graphs — finds no refutation) — REFUTED.** THIS audit is that fresh independent wiring audit (fresh context, explicitly tracing the import/call graph for `composite-audit.ts`, not journal-count-only). On the import-graph surface it finds NO refutation (see AC1 — the import graph flipped from type-only/zero-runtime-importers to 2 real production callers, non-selftest reachability confirmed). But the audit as performed DID find refutations — the two absent real-dispatch evidence surfaces above (AC2/AC3) — so "finds no refutation" is false as of iteration-0. (Identical to M210's AC10 reasoning.)

## CONFIRMED items — evidence (all auditor-run)

**AC1 (MASTER — real production wiring) — CONFIRMED.**
- `grep` in BOTH mirrors (`.claude/workflows/execute-milestone.js`, `plugin/workflows/execute-milestone.js`): `composite-audit.ts --snapshot` ×3, `composite-audit.ts --guard` ×1, `composite-audit.ts --combine-json` ×2, all in non-selftest dispatch-prompt text (shard prompt L437/L439/L440; audit-combine prompt L554). `--selftest` references in execute-milestone.js: **0** (not selftest-only reachability).
- Mirror byte-identity: `diff` of the two `execute-milestone.js`, the two `composite-audit.ts`, and the two `composite-audit.test.mjs` files — all exit 0 (identical).
- Import-graph flip: at base the sole reference to `composite-audit.ts` was TYPE-ONLY (`import type { BundleAuditResult }` in composite-reconcile.ts, erased at compile — zero runtime connection, the task's own Finding). Now the workflow dispatches real production callsites in both mirrors.
- Live-path reachability: `const auditResult = (_isComposite && $a.compositeManifestFile) ? await _compositePerShardAudit() : await agent(<legacy prompt>)` (L590-592) — the composite Audit phase routes to the new dispatcher; the width-1 / manifest-less path stays the untouched single agent.
- Non-selftest CLI surface: `--snapshot`/`--guard`/`--combine-json` are independent `else if` argv branches AFTER the `--selftest` branch (composite-audit.ts process.argv block), each a pure wrap of the exported `takeGitSnapshot`/`guardShardReadOnly`/`combineShardVerdictsFromJson`.

**AC4 (RED/GREEN hostile-write catch) — CONFIRMED.** `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/composite-audit.test.mjs` → 19/19 pass, including (auditor-run output): "AC4 RED: a hostile shard window (untracked drop + tracked modification) is caught with the exact violation string"; "AC4 RED (CLI form): --guard exits 1 with the violation JSON on stdout for a hostile window"; "AC4 GREEN fixture: a compliant shard window with zero writes passes"; "AC4 GREEN (CLI form): --guard exits 0 with {ok:true}". Both RED and GREEN states shown — never GREEN-only. Violation string is exactly `audit-shard-write-violation:<shardId>` (guardShardReadOnly L154).

**AC5 (RED/GREEN in-process isolation insufficient) — CONFIRMED.** Same run, test "AC5: in-process deepFreeze/structuredClone isolation is PROVABLY BLIND to a real filesystem write, while the mechanical git-status diff catches that same write" passes — a real `fs.writeFileSync` through `runReadOnlyAuditShard` yields `outcome.ok === true` (blind), and `diffGitSnapshots(before, takeGitSnapshot())` on that same write has length > 0 (the mechanical diff is the real enforcement). Asserted, not narrated.

**AC6 (write-instruction language structurally absent) — CONFIRMED.** Fenced-region static grep in BOTH mirrors: `sed -n '/COMPOSITE-AUDIT-SHARD-PROMPT-BEGIN/,/COMPOSITE-AUDIT-SHARD-PROMPT-END/p' | grep -cE 'CHECKLIST WRITE-BACK|DISPOSITION APPEND|DEVIATION-LOG WRITE-BACK|cat >>|- \[x\]|dashboard\.md|milestone_counter'` → **0** per mirror. `node --check` exits 0 on both. The legacy width-1 Audit prompt body (L592+) retains its write instructions by design (that path is unchanged; composite write mutations move to Reconcile per the Non-goals), and the fenced composite shard prompt (L415-446) contains none — the structural check, not one run's clean tree.

**DoD item 1 (landed on master under human-steered discipline) — CONFIRMED.** `git merge-base --is-ancestor 69b57b7f master` → YES; `git branch --contains 69b57b7f` → `master`; the task carries the `human-steered` label; committed directly on master per the loop's corrected no-driver-branch design (DIR-027). Provenance caveat recorded (not refuting): the implementation was swept into commit `69b57b7f` under a MISATTRIBUTED message ("M212/DIR-119-D4: prepare-milestone PREPARED") by a concurrent prepare-milestone workflow's broad `git add`; documented in the provenance commit `b5aae8a7` and iteration-0.md; content correct and complete, only the commit message is wrong.

**DoD item 3 (RED/GREEN evidence exists for the audit-shard read-only check) — CONFIRMED.** Same auditor-run evidence as AC4/AC5 (composite-audit tests 19/19, both hostile-catch and compliant-pass states, both fn- and CLI-level).

## DoD REFUTED items

- **DoD item 2** ("a real, non-fixture composite Audit dispatch exercises the full new per-shard wiring end to end with journal evidence, not asserted") — REFUTED: no such dispatch exists (0/228 journals carry a shardResult/bundleVerdict typed return; common evidence above).
- **DoD item 4** ("a fresh independent wiring audit finds zero unresolved findings, with explicit confirmation of production import-graph wiring") — REFUTED: the production import-graph wiring IS explicitly confirmed (AC1), but this fresh audit HAS unresolved findings (AC2/AC3 real-dispatch absence) — so "zero unresolved findings" is false.

## Standard-DoD / suite evidence (auditor-run)

- composite-audit tests: `node --experimental-strip-types --test experiments/.../composite-audit.test.mjs` → 19/19 pass; `--selftest` on BOTH mirrors → exit 0 ("SELFTEST: all fixture cases PASS"); test-file pair `diff`-clean (byte-identical mirrors).
- Legacy golden replay (guardrail G2): `scripts/test.sh plugin/test/execute-milestone-build-phase-gate.test.mjs plugin/test/execute-milestone-disposition-conformance.test.mjs plugin/test/execute-milestone-preparation-gate.test.mjs` → **40/40 pass, exit 0** (width-1 path unregressed).
- `node --check` on both `execute-milestone.js` mirrors → exit 0; mirror `diff`-clean.
- Gate-adjacent hygiene (from the mechanical gate run): clause10 tree-hygiene PASS (clean); clause11 worktree-branch-hygiene PASS (clean); clause3 line-budget PASS; clause7 test-floor N/A (method-infra surface).

## Mechanical gate result (step 3)

```
it0-dod-check.sh DIR-119-D3 experiments/quay-perpetual-stream/charters/M211-dir119d3-audit-readonly-shards.md milestones/M211/absorb-entry.md
PASS: clause1-adversarial-audit (disposition present) · clause2-vmeta-lag · clause3-line-budget · clause4-impl-row
PASS: clause5-no-self-exemption · clause6 (N/A, not design-only) · clause7 (N/A, method-infra surface)
PASS: clause8 (N/A, pre-cutover task) · clause10-tree-hygiene · clause11-worktree-branch-hygiene · clause12 (N/A documented no-op)
N/A:  clause9-split-or-commit (no needs-human declared)
FAIL: clause0-ac-dod-present — checklist-form AC has 3 unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks):
      AC2, AC3, AC7 [tasks/DIR-119-D3.md]
GATE EXIT: 1
```

The 3 gate-flagged items are exactly the 3 this audit left unchecked (DIR-020 write-back performed honestly: confirmed items checked with evidence citations, unconfirmable items left unchecked).

## Root cause (machine-caught this pass; deviation row written to dashboard.md)

The checked Plan (`docs/plans/M211-dir-119-d3.md`, Stage 6) sequences the real-dispatch evidence for AC2/AC3(+AC7) and the fresh wiring audit as **POST-Land** ("Depends on: Stages 1–5 landed"; evidence appendix "To be appended after Land"). Three facts make the milestone unsatisfiable BY CONSTRUCTION at iteration-0:
1. the task's ACs are DIR-020 checklist-form, and `it0-dod-check` clause 0 HARD-blocks any unchecked checklist box at gate time (REFUTED-equivalent);
2. the lifecycle runs the iteration-0 acceptance audit BEFORE Land, so post-Land evidence is structurally unreachable at audit time;
3. a real nested composite dispatch from within the Build agent is additionally barred by single-driver serialization on the shared working tree (CLAUDE.md — and a concurrent prepare-milestone dispatch was in fact in flight during this milestone's Build, per the provenance note).

Method-level repair options (same as the sibling M210 audit; for the loop / a follow-up gap): (a) split the AC set into a structural-wiring child (confirmable pre-Land) and a real-dispatch-proof child run as a dedicated post-Land audit iteration before ABSORB; (b) run Stage 6 between Land and ABSORB and gate ABSORB on its evidence; or (c) add an explicit, waiver-style "post-Land evidence" disposition mechanism to clause 0 (analogous to the needs-human waiver in DIR-026) so a Plan-approved post-Land evidence schedule does not collide with the checklist HARD-block. This is now the SECOND consecutive DIR-119-D child (M210, M211) REFUTED for this identical structural reason — strong signal the loop should crystallize one of (a)/(b)/(c) rather than re-dispatch.

## Provenance note (transcribed from Build's own disclosure — caught-by: human deviation row)

The Build's iteration-0.md discloses that M211's staged 10 touch-set files were swept into a concurrently-authored M212/DIR-119-D4 prepare-milestone commit (`69b57b7f`) by a broad `git add` on the shared working tree seconds before M211's own Build commit. Consequence: all of M211's implementation is on `master` (verified: `git show 69b57b7f --stat` lists all 10 M211 files) but under a misattributed commit message. Deliberate response (per Build): NO history rewrite (would race concurrent drivers again and could invalidate M212's preparation receipt); provenance commit `b5aae8a7` + iteration-0.md are the audit trail; a root-level `.halt` sentinel guards the loop until `restart-readiness-check.sh` clears un-pause. This audit transcribes it as a caught-by:human CONCERNS deviation row (the audit does not originate it). DoD1 is unaffected — the code IS on master.

## Notes

- **Clause 12 (audit-independence) N/A:** the absorb-entry carries no `## Audit-independence check` section, consistent with the M206/M210 precedent (both ran real adversarial audits and passed clause 12 as documented no-op). This audit records its harness-discovered session id (`fce11849-b5c4-4ce4-afe5-7b960ca2ad0c`) as the first content line per DIR-093. Independence caveat (same as M210/M205): this audit SHARES its CLAUDE_CODE_SESSION_ID with the Build-carrying session (both run inside this one execute-milestone dispatch); evidence-level independence is demonstrated — fresh context, every verdict above derives from the audit's OWN live runs (grep/diff/test/gate), and the determining findings REFUTE the implementer's self-report (the builder marked AC2/AC3/AC7 "post-Land"/undischarged, and this audit confirms they are indeed unconfirmable, not that they pass).
- **Trust-boundary limitation (stated plainly, per the task's own framing):** the read-only enforcement is mechanical adjudication of returned `git status` command output within the existing agent/tool trust boundary, NOT a cryptographic attestation that an agent process cannot forge its own output; both raw snapshot arrays are retained in the shard's journaled typed return as the auditability backstop (execute-milestone.js L457-465, L531-538). This audit neither gates nor refutes that residual risk — the task's AC/DoD contain no forgery-injection item, and the workflow-side (not self-report) diff IS the enforcement point (L533, G6).
- **Line-budget overage (Stages 4+5 +183 net/file vs ≤+140 combined):** disclosed and justified in iteration-0.md (load-bearing typed-return schemas for Stage 6's G7 journal selectors + enforcement/trust-boundary comments required by the task's "stated plainly" clauses). clause3 PASSes (charter is sub-threshold); not a refutation.

## Write-backs performed by this audit (same pass)

1. `tasks/DIR-119-D3.md` — DIR-020 checklist write-back: 4 AC items (AC1, AC4, AC5, AC6) + 2 DoD items (1, 3) checked `- [x]` with inline evidence citations; 3 AC items (AC2, AC3, AC7) + 2 DoD items (2, 4) left `- [ ]` (unconfirmable — see evidence above).
2. `milestones/M211/absorb-entry.md` — appended `adversarial-audit disposition: REFUTED` (with the 4-confirmed/3-refuted breakdown) and the verbatim `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward` line (copied from `vmeta-lag-check.sh --counter 205`'s own output, exit 0). The `## Backlog row` (first column `DIR-119-D3`, `surface:method-infra`) was already present from Build pre-flight.
3. `experiments/quay-perpetual-stream/dashboard.md` — two DIR-017 Step 3 deviation rows appended: (i) level REFUTED · caught-by machine · caught-at M211 · the post-Land-sequencing REFUTED finding · status open · age 0; (ii) level CONCERNS · caught-by human · caught-at M211 · the concurrent-commit-race/misattribution disclosure transcribed from Build's iteration-0 provenance note · status open · age 0.
4. This audit artifact staged (`git add`) immediately after writing (DIR-M176).
