# quay-perpetual-stream — Experiment 5

- **Status**: RUNNING (active — perpetual; no terminal HALT/CONVERGED by design). Supersedes Experiment 4.

The first **perpetual** BAIME experiment: a standing, non-terminating OUTER loop that governs
open-ended quay development, with convergent BAIME experiments nested inside it as **milestones**.
Supersedes experiment 4 (`../quay-continuous-bootstrap/`) via three-way carry.

- **Protocol:** `../../docs/proposals/quay-perpetual-stream-experiment-v5.md`
- **Driver (execute this to run):** `OUTER-LOOP.md`
- **Offline evidence/calibration:** `../offline-replay/RESULTS.md` (155-sample corpus, harness)

## Layout
- `OUTER-LOOP.md` — the outer-loop driver prompt (thin; generates charters).
- `dashboard.md` — mutable outer health state (VT, ρ/φ, control limits). Starts UNINITIALIZED.
- `backlog.md` — milestone/opportunity candidates (from exp4 reopened DIRs + open gaps).
- `inherited-core.md` — Tier-B pinned methodology (3 skills + exp4 artifacts + exp5 additions).
- `charters/` — generated per-milestone Tier-A charters (M<NN>-<slug>.md).
- `milestones/` — per-milestone inner-experiment records.
- `checkpoints/` — non-blocking health snapshots every 5 milestones (async human review; loop continues).

## How to run
Execute `OUTER-LOOP.md`. First run bootstraps (scores VT origin, flips dashboard to RUNNING), then
runs the outer cycle one milestone at a time. Every 5 milestones it writes a **non-blocking** health
snapshot and **continues** — it never waits for a human. Runs autonomously under `/loop`. It stops
only on a human `.halt` sentinel or an internal exit signal (VT slope below threshold / hypothesis
falsified). The human is async throughout: **steer** via `/quay-directive` (consumed at the next
milestone boundary, never mid-milestone — §4.7), **stop** via `touch .halt`, **review** `checkpoints/`
and `dashboard.md` any time.

## Three-way carry from exp4 (by reference)
- **Code** → current product state (VT chart-0 origin, scored at bootstrap).
- **Open DIRs / gaps** → `backlog.md` (DIR-004 Distribution URGENT, DIR-006 directives-as-tasks, …).
- **Skills** → `inherited-core.md` (native / core / webui methodology deltas).

## Ledger (standing experiment — not a terminal V_meta)
| checkpoint | date | milestones | VT | slope | ρ | notes |
|---|---|---|---|---|---|---|
| — | — | 0 | — | — | — | not yet started |
