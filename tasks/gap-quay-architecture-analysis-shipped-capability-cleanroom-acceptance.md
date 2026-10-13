---
id: gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance
title: Quay架构分析作为已交付能力：OSD+architecture-review+arch-discovery+Method/Portfolio/Experience
  清洁隔离正负验收 + ClaudeCodeUI真实验证
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry
  - gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd
---
## Proposal
**The consolidation/acceptance leg of the approved "Quay architecture analysis as a shipped capability" initiative (2026-10-13).** Depends on both newly-filed deployability fixes for `architecture-review` (`gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry`, `gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd`) and reuses, without re-doing, the already-landed `gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-sources-never-works-off-quay-repo` (Task D, `b9ca7a9e2`) — which already staged the shared engine (`docs/analysis/*.mjs`, 8 files + 5 data files, including `discovery-method-registry.mjs`/`discovery-portfolio.mjs`/`discovery-experience-ledger.mjs`/`discovery-reflection.mjs` — i.e. Method/Portfolio/Experience's own engine modules) into the official plugin artifact and was already independently verified this session in a clean scratch project (no quay source checkout) for OSD specifically.

**What this task adds that Task D's own verification did not cover:** Task D's clean-room test exercised ONLY `open_semantic_discovery`. This task is the single combined acceptance that the whole bundle — OSD + `architecture-review` (once its two prerequisite tasks land) + `arch_discovery` + `discovery_method` (Method/Portfolio/Experience) — works TOGETHER as one coherent "shipped capability," on a host that:
1. Has NO Quay source checkout (official plugin install only) and NO hand-patched files (ruling out a repeat of this session's own private scratch-build shortcut).
2. Is config-driven end-to-end for every one of these routines via `.quay/config.yml` `loop.<name>:` blocks, uniformly — including, after this task's prerequisites land, `architecture_review`.
3. Produces a real finding → verify/refute → host task filed via the ABI → picked up by that clean host's own driver/fan-in, merged — for at least one of the bundle's routines, on real (not fixture) data.

**Explicitly out of scope — confirmed with the user:** `cross-project-dogfood` remains an independent, separately-scoped mechanism (its own already-filed, already-landed-or-in-flight tasks: `gap-cross-project-semantic-dogfooding-routine-configurable-source-projects` done, `gap-cross-project-dogfood-shares-no-diagnostics-or-retry-with-osd-seven-unattributed-exit1` in flight). This task does NOT fold cross-project-dogfood into the bundle, does not change its config, and does not require it to pass any part of this acceptance.

## Plan
1. **Positive control (clean host, no quay source):** reuse the exact methodology already run once for Task D — a fresh scratch git repo (own `develop` branch, no `plugin/`, no `docs/analysis/`) with the OFFICIAL plugin install (`dist-plugin` branch build, rebuilt fresh at this task's start so it includes the two architecture-review fixes) as its ONLY source of `plugin/scripts/*`. Enable all of `open_semantic_discovery`, `architecture_review`, `arch_discovery`, `discovery_method` via `.quay/config.yml`. Run the quality-kind loop for enough rounds to observe each routine either fire cleanly or report a real, legible `not-evaluated`/`not-triggered` (NOT a spawn error) — paste each routine's first real round record.
2. **Negative control:** run the SAME clean host against the PRE-fix official build (the one still carrying both architecture-review gaps) — confirm `architecture_review` fails exactly as predicted (spawn error from the wrong-root argv, uncontrollable cadence) while the other three routines are unaffected — proving the positive control's pass is attributable to the fixes, not to host coincidence.
3. **Real host leg:** deploy the SAME fixed official build to ClaudeCodeUI (via the established live anchor-takeover handoff mechanism, not a service interruption — same mechanism already used successfully twice this session) and let it run long enough, within its own existing budget caps, to observe a real round of at least one of the four routines firing on ClaudeCodeUI's actual source tree (not just its `.quay/*.jsonl` usage logs — distinguishing this explicitly from cross-project-dogfood's scope). Paste the real carrier record.
4. **Do not raise or bypass any budget cap** on either host to force a round or a confirmation — if the observation window closes without a natural confirmed finding, say so plainly (hard rule 4 corollary 3's carve-out) rather than forcing one.
5. Report, explicitly and separately, which of the four states — code exists / enabled / autonomously invoked / produced a verified landed result with no human pointing at the specific defect — each of the four bundled routines has reached on each of the two hosts, by the end of this task's observation window.

## Acceptance Criteria
- [ ] AC1: positive-control clean-host run — all four routines' first real round record pasted (no spawn errors attributable to packaging/root-resolution for any of them).
- [ ] AC2: negative-control clean-host run on the pre-fix build — `architecture_review` fails as predicted; the other three routines are shown unaffected (pasted side-by-side).
- [ ] AC3: ClaudeCodeUI real-host leg — the fixed official build is live (anchor takeover verified the same way as this session's prior two swaps: readlink/cmdline/driver status), and at least one real, naturally-occurring round from the bundle is pasted from that host's own carrier.
- [ ] AC4: no budget ceiling was changed on either host during this task — `.quay/config.yml` diffed before/after on both, pasted.
- [ ] AC5: the four-state classification (code exists / enabled / invoked / closed-loop-confirmed) is reported per routine per host — explicitly, not glossed over, including any routine that does NOT reach "closed-loop-confirmed" within the observation window.
- [ ] AC6: `scripts/test.sh` full-suite green (this task touches no single component's code directly — it is an integration acceptance — so the scoped `--for-task` gate does not apply; state this explicitly rather than skipping the check).

## Definition of Done
- AC1-AC6 checked with pasted, real evidence (not fixture-fabricated) for AC1-AC3; AC4-AC5 pasted comparisons/reports.
- This task does not modify `cross_project_dogfood`'s config, code, or task set.
- This task does not modify the global user-scope plugin installation on any host.
- If either prerequisite task has not landed when this task is picked up, this task blocks (declared via `depends_on`) rather than working around the gap with a manual patch.

## Touches
- tasks/gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance.md
- .quay/config.yml
- plugin/scripts/publish-dist-branch.sh
