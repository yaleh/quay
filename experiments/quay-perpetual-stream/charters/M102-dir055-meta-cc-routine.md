# Charter M102-dir055-meta-cc-routine — meta-cc history-mining standing routine (DIR-055)

**Milestone id:** M102  
**Task:** `tasks/DIR-055.md` (milestone-candidate)  
**Surface:** `experiments/quay-perpetual-stream/.quay/loop.yml` (routines wiring) + real-fire attempt  
**Type:** development-class / methodology  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

DIR-055 industrialises the meta-cc session-history mining move as a standing ROUTINE. The probe spec (`plugin/probes/history-mining.md`) already exists at master HEAD with correct DIR-056 format:
- `instrument: meta-cc`
- `fallback: none`
- `output_routing: {defect: milestone-candidate, adr: adr-draft, pattern: crystallization, default: milestone-candidate}`
- REFUTE-first objective body

What's missing:
1. **`history-mining` not yet wired in `loop.yml` routines** — `self-validation` and `architecture-analysis` are present; `history-mining` is not.
2. **Output-routing validation**: confirm `read-probe-spec.mjs` and `routine-scheduler.mjs` actually consume `output_routing` from the probe spec frontmatter. Check if the label routing is implemented or still a TODO.
3. **Red+Green test**: no test verifying that a finding without a session-id/commit ref is REJECTED by routine-file-gate.
4. **Real fire**: the probe has never been fired in anger through the full routine path. Target: archguard workspace via tmux remote-drive (ADR-016); else `needs-human` for that leg.

## Scope

**In scope:**

1. **Add `history-mining` to `experiments/quay-perpetual-stream/.quay/loop.yml` routines section:**
   ```yaml
   - name: history-mining
     trigger: on(checkpoint)
     probe: history-mining
   ```
   Vendor-sync: if `plugin/` has its own copy of the configs, sync appropriately.

2. **Verify/implement output-routing in `scripts/routine-scheduler.mjs`** (or `read-probe-spec.mjs`): confirm that when the routine fires, the filed task's labels include the `output_routing` value for the finding type (defect→`milestone-candidate`, adr→`adr-draft`, pattern→`crystallization`). If not implemented, implement it in `routine-scheduler.mjs`. Update `plugin/scripts/routine-scheduler.mjs` via `sync-vendor.sh`.

3. **RED+GREEN test in `routine-file-gate.mjs` selfcheck or separate test**: prove that a history-mining finding WITHOUT a session-id/turn/commit ref in the body is REJECTED by the quality gate. The existing `routine-file-gate-selfcheck.sh` may be the right place.

4. **Graceful degrade test**: confirm that when `meta-cc` instrument is unavailable, the routine SKIPS + logs, never fails closed. This may already be implemented in `read-probe-spec.mjs`'s fallback handling — verify.

5. **Real fire attempt** (done-or-`needs-human`):
   - Check if an archguard tmux session is idle: `tmux list-sessions 2>/dev/null`
   - If yes: use 3-step tmux remote-drive (ADR-016): `send-keys C-u`, `send-keys "<probe dispatch command>"`, `send-keys Enter`; wait; read filed tasks from filesystem / meta-cc
   - If no session: land this leg as `needs-human` with instructions for the human
   - The rest of the milestone (loop.yml wiring, output-routing, tests) lands `done` regardless

6. **Bump plugin version** if any plugin/ files changed.

**Out of scope:**
- Wiring OUTER-LOOP.md to consume `routines:` key — that is `exp5-M-OUTERLOOP-ROUTINE-WIRING` (HUMAN-STEERED, separate task)
- Changing the probe spec itself (it's already correctly authored)
- Auto-executing findings (FILE-only invariant)
- DIR-052/053 routine changes

## Class routing

**Development-class** — code change in scripts/ + loop.yml. Requires quay-task-to-plan (N=2 proposals → adjudication → plan → executor). Per OUTER-LOOP.md step 5a.

## Acceptance Criteria

- [ ] `history-mining` routine wired in `experiments/quay-perpetual-stream/.quay/loop.yml` `routines:` section.
- [ ] Output-routing implemented in `routine-scheduler.mjs`: filed tasks receive labels from `output_routing` by finding type.
- [ ] Quality gate rejects a finding without session-id/commit ref (RED+GREEN test documented).
- [ ] Graceful degrade confirmed: meta-cc-absent path SKIPS + logs (test or documented demonstration).
- [ ] Real fire: ≥1 evidence-backed task filed through the gate on a real workspace — OR leg landed as `needs-human` with documented reason.

## Definition of Done

- [ ] loop.yml + output-routing + tests landed; graceful degrade confirmed.
- [ ] Real fire: done-or-`needs-human` (per DoD's own escape hatch).
- [ ] Plugin version bumped for any changed files; sync-vendor.sh run.
- [ ] Fresh-context adversarial audit: NO REFUTATION FOUND.
- [ ] it0 DoD meta-enforcer: all 12 clauses PASS.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`
