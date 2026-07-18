# Dashboard — quay-perpetual-stream (Experiment 5)

**state: RUNNING**
**milestone_counter: 0** · **chart: 0** · **checkpoint cadence: every 5 milestones (non-blocking)**
**stop signals only: human `.halt` sentinel · internal exit (VT slope<threshold / hypothesis falsified)**

## VT — Value Trajectory (weighted surface-capability points; §4.1, §6.2)

Chart-0 surface weights (initial, soft — revise at checkpoint 1 from live data):

| surface | weight | cov (0..1) | points = weight·cov |
|---|---|---|---|
| CLI | 25 | 0.95 | 23.75 |
| MCP | 20 | 0.90 | 18.00 |
| Web UI | 20 | 0.95 | 19.00 |
| Packaging / Distribution | 20 | 0.55 (known low — DIR-004) | 11.00 |
| Docs | 15 | 0.70 | 10.50 |
| **VT₀ (chart-0 origin)** | **/100** | | **82.25** |

Scoring basis (bootstrap, from exp4 `gap-list.md` + `backlog.md` framing): CLI/MCP/Web UI
near-saturated (exp4 closed 102 cumulative gaps, only 4 open at FINAL: ENV-001, SH-006, NEW-001,
PKG-010 — all minor/env). Packaging is the clear low point: existing PKG-series closed (tgz
npm-pack works) but backlog explicitly frames the packaging *vision* (Node SEA/Bun compiled
release artifacts) as unmet — M-DIST rated URGENT, Δv̂≈+12 to reach ~0.8. Docs closed its gap
series but backlog flags coverage as "thin/irregular" — M-DOCS still open, Δv̂≈+4.

VT curve (append `Δv` per milestone): `[ (m0, 82.25) ]`
Slope (marginal points / milestone): _n/a until ≥2 points_

## Health tracks (§4.2–4.4, §6.1)

| track | current | alarm |
|---|---|---|
| ρ reuse rate | _n/a_ | must-not-fall |
| φ fold-back (confirmed edges) | _none yet_ | — |
| charter thickness (tokens) | _n/a_ | >2 K = dilution |
| discovery latency (mechanizable) | _n/a_ | >~8 iters late |
| calibration error \|Δv−Δv̂\|/Δv̂ | _n/a_ | trend must shrink |
| inner-convergence success | _n/a_ | mid-milestone re-scope = fail |

## Control limits (pre-declared; §6/§6.1)
- inner budget = 10 (past → default HALT, continue needs authorization)
- ΔV plateau <0.02 both layers, K=2 consecutive → stop
- gate-hash: any non-verbatim gate → block (0 tolerance)
- discovery-latency alarm: mechanizable-channel discovery >~8 iters late
- explore cadence: ≥1 explore milestone per 5

## Log
- Bootstrap (m0): confirmed exp4 stopped, carry-by-reference verified (backlog.md → exp4 reopened
  DIRs + open gaps; inherited-core.md → 3 extracted skills + exp4 methodology). Scored VT₀=82.25
  from exp4 gap-list.md. state → RUNNING. Selecting M-DIST next per backlog guidance (explore,
  URGENT).
- SELECT m1 = M-DIST (explore). Value hypothesis Δv̂=+6.0 (Packaging cov 0.55→0.85, weight 20)
  recorded BEFORE dispatch. Charter authored: `charters/M01-dist.md` (scope: DIR-004's undelivered
  half — Node SEA/Bun single-file executables, CI build+publish, no-Node verification; the existing
  npm-pack/.tgz path is NOT redone). Gate-hash transclusion + it0 checks recorded in-charter.
  Dispatching inner milestone next.
