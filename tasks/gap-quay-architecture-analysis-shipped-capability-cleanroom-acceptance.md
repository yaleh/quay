---
id: gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance
title: Quay架构分析作为已交付能力：OSD+architecture-review+arch-discovery+Method/Portfolio/Experience
  清洁隔离正负验收 + ClaudeCodeUI真实验证
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry
  - gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd
  - gap-architecture-review-detectors-not-runnable-off-quay-repo
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
- [x] AC4: no budget ceiling was changed on either host during this task — `.quay/config.yml` diffed before/after on both, pasted.
- [x] AC5: the four-state classification (code exists / enabled / invoked / closed-loop-confirmed) is reported per routine per host — explicitly, not glossed over, including any routine that does NOT reach "closed-loop-confirmed" within the observation window.
- [x] AC6: `scripts/test.sh` full-suite green (this task touches no single component's code directly — it is an integration acceptance — so the scoped `--for-task` gate does not apply; state this explicitly rather than skipping the check).

## Definition of Done
- AC1-AC6 checked with pasted, real evidence (not fixture-fabricated) for AC1-AC3; AC4-AC5 pasted comparisons/reports.
- This task does not modify `cross_project_dogfood`'s config, code, or task set.
- This task does not modify the global user-scope plugin installation on any host.
- If either prerequisite task has not landed when this task is picked up, this task blocks (declared via `depends_on`) rather than working around the gap with a manual patch.

## Probe methodology (reproducible)

Two `dist-plugin` builds; in neither case was a quay source checkout used as the kernel:
- **FIXED** `/data/home/yale/work/quay-scratch/official-dist-acceptance-fixed` — built by `plugin/scripts/publish-dist-branch.sh --branch dist-plugin-acceptance-fixed` from develop `4732d018b` (both prerequisites landed). `grep -c readArchitectureReviewConfig scripts/dist/quality-gate-driver.js` = 3.
- **PRE-FIX** `/data/home/yale/work/quay-scratch/official-dist-020-dev` — built from `8bfe8df5d` (carries Task D's `docs/analysis` staging, not the two arch-review fixes). The same grep = 0.

Both prereqs ARE landed (`status: done`), so the DoD's block clause does not fire. Clean host = fresh git repo on branch `develop`, laid down by `<kernel>/vendor/quay/dist/quay.js init --root <host> --test-command "bash scripts/test.sh"`, four `loop.<name>:` blocks appended, `.quay/plugin` repointed at the KERNEL tree (never at `/data/home/yale/work/quay`). One real `quality-gate-driver --once` round per build. Raw evidence: `/data/home/yale/work/quay-scratch/acc-evidence/` (round JSONL, assembly logs, config before/after, suite logs).

## Verdict

The clean-room acceptance **FAILS at its core**. The bundle is only half-shipped: `open_semantic_discovery` and `arch_discovery` do run real rounds on a bare host; `architecture_review` cannot produce a single result in ANY install form; `discovery_method` is blocked by a host artifact. Cause filed as **`gap-architecture-review-detectors-not-runnable-off-quay-repo`**.

## Blocked — dependency declared (2026-10-14, continuation round)

`depends_on` now also carries `gap-architecture-review-detectors-not-runnable-off-quay-repo`, added **through the ABI** (`task_write`) in this round. Verified mechanically, not asserted: `depsReadinessFor` on this task returns `ready:false, blockingDeps:['gap-architecture-review-detectors-not-runnable-off-quay-repo'], doneDeps:[the two landed prereqs]`, and `slot-refill.ts:1084` defers on that predicate (`defer(id, "deps-not-ready")`) — so this task is out of the dispatch pool until that gap lands. This is the DoD's own block clause being invoked, not a manual patch.

The prior round's finding was re-verified this round against current develop (it is not a stale tail):
- `plugin/scripts/quality-gate-driver.ts` `kernelDetectorArgv` still builds `path.join(resolveKernelScriptsDir(), "<name>.ts")`, and its own doc-comment still records the residual verbatim — a dist-only install (no raw `.ts`) still ENOENTs, and it names `driver-runtime.kernelSiblingArgv()` as the thing "那是另一件事…不在本任务范围内".
- `identity-replication-check.ts:1301` still hard-refuses any root lacking `<root>/plugin/scripts` (`exit 2`) — true of every non-quay host, in **every** install form, which is why the two landed prerequisites cannot make AC1 pass.
- In the FIXED artifact: `identity-replication-check` ships only as `scripts/dist/identity-replication-check.js`; `guard-lineage-check` and `deletion-closure-check` ship in no form at all.

**Residue for a human (not something this task can discharge by running longer):**
1. AC1's premise — that `architecture_review` *should* run against a non-quay root — is a scoping question; the fix task now owns it (its AC3 requires the detectors to return a real report on a root with no `plugin/scripts`).
2. AC3 additionally needs someone to authorise swapping another project's **live** anchor (ClaudeCodeUI pid 675243, still on the PRE-fix kernel), which this round again did **not** do: that build does not deliver the capability it would be deployed under, and the swap is outward-facing.

## AC1 — FAILS (positive control, FIXED build)

```
architecture-review     => not-evaluated | unparseable identity-replication output (exit 1): (empty output)
arch-discovery          => verified      | scan ran: 4 finding_fp (4 new, 0 repeated, 0 gone), 0 transition(s), wall 1023ms, peak RSS 109568kB; appended 4 finding + 1 scan-round line to .quay/arch-discovery-findings.jsonl
discovery-method        => failed        | ingest refused — EVIDENCE_STORE_MISSING:.quay/architecture-evidence-store.jsonl-not-present-under-<clean-host> (nothing appended, last-run not advanced)
open-semantic-discovery => verified      | round ran (invoked_by:resident-driver, interval 60m): investigator read the pin with Read,Grep,Glob, 0 cluster(s) from 1 run(s), 0 verified, 0 CONFIRMED after independent refutation, 1 model call(s) costing $0.00687, wall 9095ms
```

`architecture_review`'s record IS a spawn/root-resolution error attributable to packaging, so AC1's parenthetical is unmet. Three independent blockers, each sufficient, all reproduced against the shipped tree:

```
# blocker 1 — what kernelDetectorArgv asks for is a raw .ts the artifact never ships
$ node --experimental-strip-types <kernel>/scripts/dist/identity-replication-check.ts --root <host> --json
MODULE_NOT_FOUND                                                        exit=1
# blocker 2 — and the bundle it DOES ship is still stopped, by the detector's own root gate
$ node <kernel>/scripts/dist/identity-replication-check.js --root <host> --json
ERROR: plugin/scripts not found under <host> — is --root correct?       exit=2
# blocker 3 — two of the three detectors ship in no form at all (no .ts, no scripts/dist/*.js)
$ find <kernel> -name '*guard-lineage*' -o -name '*deletion-closure*'
(no output)
```

With a SOURCE-form kernel (raw `.ts` present, so all three ARE locatable) the same clean host still fails, at the detectors' own gate: `identity-replication-check.ts:1306`, `guard-lineage-check.ts:416`, `deletion-closure-check.ts:476` each exit 2 with `plugin/scripts not found under <root> — is --root correct?`. So architecture-review is not deployable to a non-quay host in any install form — the two landed prerequisites do not make it so. (The sibling A-domain checker `kernel-sibling-resolution-check.ts` returns `status: pass` on this code, which is why the class was invisible to it.)

## AC2 — negative control ran; it REFUTES attribution rather than proving it

Same host content, PRE-fix build, side-by-side with AC1:

| routine | PRE-fix build | FIXED build |
|---|---|---|
| architecture-review | `not-evaluated: unparseable identity-replication output (exit 1)` | identical |
| arch-discovery | `verified` (4 findings, wall 1353ms) | `verified` (wall 1023ms) |
| open-semantic-discovery | `verified` (1 model call, $0.008544, wall 10.6s) | `verified` (1 model call, $0.00687, wall 9.1s) |
| discovery-method | `failed: EVIDENCE_STORE_MISSING` | identical |

`architecture_review` does fail on the pre-fix build "as predicted": its pre-fix `defaultIdentityReplicationArgv` is `path.join(root, "plugin", "scripts", "identity-replication-check.ts")` (`git show 8bfe8df5d:plugin/scripts/quality-gate-driver.ts`, with `root` = the TARGET workspace), and that file does not exist under the clean host. The other three routines are unaffected. **But the two builds are indistinguishable on every routine**, so the negative control cannot show that the fixes are what makes anything pass — nothing passes. The unplanned fourth row (`open_semantic_discovery` verified on BOTH builds) is the direct evidence that the two prerequisite fixes changed nothing observable on the shipped artifact. AC2 is therefore left UNCHECKED: its evidential function (isolating the fix as cause) is exactly what the observation refutes.

## AC3 — NOT DONE

The fixed official build was **not** deployed to ClaudeCodeUI. Its live anchor (pid 675243, `__anchor --root /data/home/yale/work/claudecodeui --takeover 2943131`) still runs the PRE-fix kernel `/data/home/yale/work/quay-scratch/official-dist-020-dev/scripts/dist/driver-anchor.js` (`grep -c readArchitectureReviewConfig` = 0 on that tree). I did not perform an anchor takeover: given AC1, that build does not deliver the architecture_review capability it would be deployed under, and swapping the kernel of another project's live production driver is an outward-facing, hard-to-reverse action that should carry a human's explicit go-ahead rather than being done to satisfy a sub-clause of an acceptance whose core already fails. What that host does produce is pasted under AC5.

## AC4 — PASS

```
$ diff cui-config-before.yml  cui-config-after.yml   ->  (identical)   ClaudeCodeUI .quay/config.yml  md5 47b29e76a3b0c9022aeb408955a90670
$ diff quay-config-before.yml quay-config-after.yml  ->  (identical)   this repo's .quay/config.yml   md5 f09b4272a88377906cb366f2f6b77db0
```

The clean hosts' `loop.<name>:` blocks are exactly those whose round records are pasted under AC1/AC2. No budget ceiling was raised or bypassed on any host; the observation window is reported as it closed.

## AC5 — four-state classification, per routine, per host

| routine | code exists | enabled | autonomously invoked | closed-loop-confirmed |
|---|---|---|---|---|
| open_semantic_discovery | yes (engines staged by Task D) | yes on both hosts | **yes** — 1 real resident-driver round on the clean host (1 model call, $0.00687); **5** real rounds on ClaudeCodeUI, 2026-10-13T10:06Z…14:17Z | **NO** — 0 clusters reached CONFIRMED on either host; report-only, nothing landed |
| arch_discovery | yes | yes on the clean host; **no** on ClaudeCodeUI (no config block; off by default) | **yes** on the clean host (scan ran, 4 findings appended) | **NO** — report-only; findings appended, none filed or landed |
| discovery_method | yes | yes on the clean host; **no** on ClaudeCodeUI | **NO** — round refused at ingest: `EVIDENCE_STORE_MISSING` (a fresh host has no `.quay/architecture-evidence-store.jsonl`) | **NO** |
| architecture_review | present in source, **not runnable from the artifact** | yes (clean-host config block; default-on on ClaudeCodeUI) | **NO** on both — clean host: 0 usable rounds; ClaudeCodeUI: **164 attempts, 164 failures**, every one `unparseable identity-replication output (exit 1)` | **NO** |

No routine reached `closed-loop-confirmed` on either host within this window; none is glossed over above.

## AC6 — full suite

`bash scripts/test.sh` in this worktree. This task changes no component code, so the scoped `--for-task` gate does not apply — stated rather than skipped; the scoped run was nonetheless executed green with `--allow-thin` (thin: the task resolves tests for 1/3 Touches entries). Full suite, second run: **899 server files, 996 node:test groups all `ℹ fail 0`, zero `__PERFILE__ … passed=false`, both static `RESULT: PASS` lines**, `tmux-leak-scan: clean`, exit 0. The first run had exactly one red — `plugin/test/tmux-isolated.test.mjs` (`AC2 negative control … another server survives`, `actual: 'server exited unexpectedly'`) — which then PASSED 5/5 re-run alone under the same worktree, i.e. a load flake induced by a concurrent peer suite (the host was running another worktree's `test.sh --buckets …` for 1h28m).

## Scope kept

`cross_project_dogfood` config/code/tasks untouched. No global user-scope plugin installation was modified on any host (`~/.claude/plugins/cache/quay/quay/` unchanged; highest entry still 0.19.0). No budget ceiling changed anywhere. Side effect disclosed: one NEW local branch `dist-plugin-acceptance-fixed` (the FIXED artifact) plus its detached worktree `/data/home/yale/work/quay-scratch/official-dist-acceptance-fixed`; the shared `dist-plugin` branch was NOT moved and the main checkout was not dirtied by the build.

## Touches
- tasks/gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance.md
- tasks/gap-architecture-review-detectors-not-runnable-off-quay-repo.md
- .quay/config.yml
- plugin/scripts/publish-dist-branch.sh
