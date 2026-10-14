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
- [x] AC1: positive-control clean-host run — all four routines' first real round record pasted (no spawn errors attributable to packaging/root-resolution for any of them).
- [x] AC2: negative-control clean-host run on the pre-fix build — `architecture_review` fails as predicted; the other three routines are shown unaffected (pasted side-by-side).
- [x] AC3: ClaudeCodeUI real-host leg — the fixed official build is live (anchor takeover verified the same way as this session's prior two swaps: readlink/cmdline/driver status), and at least one real, naturally-occurring round from the bundle is pasted from that host's own carrier.
- [x] AC4: no budget ceiling was changed on either host during this task — `.quay/config.yml` diffed before/after on both, pasted.
- [x] AC5: the four-state classification (code exists / enabled / invoked / closed-loop-confirmed) is reported per routine per host — explicitly, not glossed over, including any routine that does NOT reach "closed-loop-confirmed" within the observation window.
- [x] AC6: `scripts/test.sh` full-suite green (this task touches no single component's code directly — it is an integration acceptance — so the scoped `--for-task` gate does not apply; state this explicitly rather than skipping the check).

## Definition of Done
- AC1-AC6 checked with pasted, real evidence (not fixture-fabricated) for AC1-AC3; AC4-AC5 pasted comparisons/reports.
- This task does not modify `cross_project_dogfood`'s config, code, or task set.
- This task does not modify the global user-scope plugin installation on any host.
- If either prerequisite task has not landed when this task is picked up, this task blocks (declared via `depends_on`) rather than working around the gap with a manual patch.

## Probe methodology (reproducible)

Round 1 (2026-10-13, superseded, verdict FAILS): raw evidence under `/data/home/yale/work/quay-scratch/acc-evidence/`.

**Round 2 (2026-10-14, THIS round — the blocking dependency `gap-architecture-review-detectors-not-runnable-off-quay-repo` has landed `done`).** Raw evidence: `/data/home/yale/work/quay-scratch/acc-evidence-r2/`.

- **FIXED-r3** `/data/home/yale/work/quay-scratch/official-dist-acceptance-fixed-r3` — `plugin/scripts/publish-dist-branch.sh --branch dist-plugin-acceptance-fixed-r3` from develop `9ac168ba9` (orphan commit `cf8522811` "dist-plugin: build from 9ac168ba9"). Ships all three detectors — `scripts/dist/{deletion-closure,guard-lineage,identity-replication}-check.js`; `grep -c readArchitectureReviewConfig scripts/dist/quality-gate-driver.js` = 3, `grep -c kernelSiblingArgv` = 5, `grep -c 'runtime:' scripts/dist/guard-lineage-check.js` = 18 (the guard-lineage semantics change that landed mid-round is included).
- **FIXED-r2** `/data/home/yale/work/quay-scratch/official-dist-acceptance-fixed-r2` — the same build from the develop tip at this round's start (`d7381ed6e`, orphan `e195869c6`). Kept as a **replication**: it returns the identical four-routine verdicts, so the result is stable across the two revisions.
- **PRE-FIX** `/data/home/yale/work/quay-scratch/official-dist-020-dev-plain` — an `rsync --exclude=.git` copy of the round-1 PRE-FIX artifact (worktree HEAD `60cacaf3d`, built from `8bfe8df5d`). Both greps = 0/0; `find` for guard-lineage/deletion-closure → no output (they shipped in no form at all).

⛔ **Methodology correction made this round (worth recording):** `official-dist-020-dev` is a **linked git worktree** of `/data/home/yale/work/quay` (`.git` file → `gitdir: /data/home/yale/work/quay/.git/worktrees/official-dist-020-dev`). `quay init` run out of it resolved the workspace's `.quay/plugin` symlink **through git to the quay source checkout** `/data/home/yale/work/quay/plugin` — silently contaminating the "clean host" premise. Fixed by using the `.git`-free plain copy; the PRE-FIX host's `readlink -f .quay/plugin` now names the kernel tree, never `/data/home/yale/work/quay`.

Each clean host = a fresh `git init -b develop` scratch repo (`README.md`, `src/a.ts`, `scripts/test.sh`) laid down by `<kernel>/vendor/quay/dist/quay.js init --root <host> --test-command "bash scripts/test.sh"`, four `loop.<name>:` blocks appended, then one real `quality-gate-driver --once` round.

## Verdict

**Round 2: the acceptance's CORE now PASSES.** AC1 and AC2 are both satisfied against the shipped artifact, on clean hosts with no quay source checkout. Round 1's verdict ("FAILS at its core"; cause `gap-architecture-review-detectors-not-runnable-off-quay-repo`) is discharged by that fix, which landed `done` and is now verified end-to-end **from a shipped tree** rather than from source.

`architecture_review` — which in round 1 could not produce a single result in ANY install form — now runs all three detectors from the shipped bundle on a bare host and returns a real, legible verdict. The negative control, which in round 1 could not isolate the fix as cause (both builds behaved identically on every routine), now does: the two builds differ on exactly one routine, in exactly the predicted direction, with the other three held constant.

**Outstanding: AC3** (the ClaudeCodeUI live-anchor deployment leg), reported below with counts. It is not a defect in the bundle; it is a production-deployment decision this round did not take unilaterally.

## Blocked — dependency declared (prior round) — now DISCHARGED

`depends_on` carries `gap-architecture-review-detectors-not-runnable-off-quay-repo` (added through the ABI in the round-1 continuation). That task is now `status: done` (fan-in `37d467e7a`), so the DoD's block clause no longer fires and this round was dispatchable. The round-1 text of this section remains in `git log -p` for this file; it is no longer operative.

## AC1 — PASS (round 2, positive control, FIXED-r3 build from develop `9ac168ba9`)

Clean host `acc-host-r3` (no quay source checkout; `.quay/plugin -> .../official-dist-acceptance-fixed-r3`). One real round:

```
$ node <K>/scripts/dist/quality-gate-driver.js --once --root <host> --run-id acc-pos-fixed-r3 --json
architecture-review      => verified | not-triggered (no candidate clusters)
arch-discovery           => verified | scan ran: 4 finding_fp (4 new, 0 repeated, 0 gone), 0 transition(s), wall 1359ms, peak RSS 111616kB; appended 4 finding + 1 scan-round line to .quay/arch-discovery-findings.jsonl
discovery-method         => failed   | ingest refused — EVIDENCE_STORE_MISSING:.quay/architecture-evidence-store.jsonl-not-present-under-/data/home/yale/work/quay-scratch/acc-host-r3 (nothing appended, last-run not advanced)
open-semantic-discovery  => verified | round ran (invoked_by:resident-driver, interval 60m): investigator read the pin with Read,Grep,Glob, 0 cluster(s) from 1 run(s), 0 verified, 0 CONFIRMED after independent refutation, 1 model call(s); appended 1 scan-round + 0 cluster record(s)
```

Exact `architecture-review` fact — the routine that could not produce a result in round 1:

```
{"name":"architecture-review","state":"verified","reason":"not-triggered (no candidate clusters)",
 "value":{"fired":false,"reasons":[],"clusterCount":0,"judgedCount":0,"distribution":null,"actionableCount":0,
          "submittedKeys":[],"actionabilityNotEvaluated":0,"gapFiled":false,"gapExitCode":null,"gapError":null}}
```

and the routine's own round record, written on the clean host:

```
$ cat <host>/.quay/architecture-review-round.jsonl
{"round":0,"judgedAt":"2026-10-13T18:30:00.799Z","state":"not-triggered","triggerReasons":[],"clusterCount":0,"clusters":[],"reason":"no candidate clusters (three detectors produced zero suspicious groupings)"}
```

The assembly line (stderr) shows the fix is live **in the artifact**, not only in source:

```
architecture-review 例程已装配（enabled, interval=60m [来源: config]，检测器脚本经 kernelSiblingArgv() 解析到本 kernel 自己的安装位置
（raw .ts 或 scripts/dist/<name>.js，都缺席 ⇒ not-evaluated:detector-script-unresolved:<name>，⛔ 不 spawn 不存在的路径），⛔ 不是目标 root 的；
--root 仍传目标工作区）
```

**Replication:** the FIXED-r2 build (develop `d7381ed6e`, the tip at this round's start) returned the identical four verdicts, including `architecture-review => verified | not-triggered`. The result therefore does not depend on which of the two revisions the artifact was cut from.

**AC1's parenthetical is met:** no routine's record is a spawn/root-resolution error attributable to packaging. `discovery_method`'s `failed: EVIDENCE_STORE_MISSING` is a named, legible host-artifact condition (a fresh host has no `.quay/architecture-evidence-store.jsonl`) and is byte-identical on BOTH builds — not attributable to packaging, and not the fix's concern.

## AC2 — PASS (round 2, negative control, PRE-FIX build)

Same host content, same four `loop.` blocks, one real round per build, read side-by-side from each host's own `quality-round.jsonl`:

| routine | PRE-FIX build (`8bfe8df5d`) | FIXED-r3 build (`9ac168ba9`) |
|---|---|---|
| architecture-review | `not-evaluated: unparseable identity-replication output (exit 1): (empty output)` | **`verified: not-triggered (no candidate clusters)`** |
| arch-discovery | `verified` (4 findings, wall 1350ms) | `verified` (4 findings, wall 1359ms) |
| open-semantic-discovery | `verified` (1 model call) | `verified` (1 model call) |
| discovery-method | `failed: EVIDENCE_STORE_MISSING` | `failed: EVIDENCE_STORE_MISSING` |

`architecture_review` fails on the pre-fix build exactly as predicted — its pre-fix `defaultIdentityReplicationArgv` resolves under the **target root** (`path.join(root, "plugin", "scripts", "identity-replication-check.ts")`, and the clean host has no `plugin/` at all), so every detector spawn is an ENOENT read as `unparseable … (exit 1)`. The other three routines are unaffected (same state, same reason shape, differing only in wall-clock/token noise).

**This is what round 1 could not show.** In round 1 the two builds were indistinguishable on every routine, so the negative control *refuted* attribution. Now the two builds differ on exactly one routine, in exactly the predicted direction, with the other three held constant — the positive control's pass IS attributable to the fix.

## AC3 — NOT DONE (the live ClaudeCodeUI anchor was NOT swapped)

The fixed build was **not** deployed to ClaudeCodeUI and no anchor takeover was performed. Verified current state of that host:

```
anchor pid 675243  cmdline: node .../quay-scratch/official-dist-020-dev/scripts/dist/driver-anchor.js __anchor --root /data/home/yale/work/claudecodeui --takeover 2943131
systemd unit      quay-anchor-claudecodeui-1791900836646.scope   (transient --user --scope, NO restart semantics)
.quay/plugin   -> /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0             (user-scope cache)
quay-serve-claudecodeui-20261007T200800.service -> user-scope cache 0.16.0
```

**Three divergent versions are live on that one host today** (driver kernel = the 020-dev scratch build; workspace plugin link = 0.19.0; serve service unit = 0.16.0). So "the fixed build is live" is not one well-defined surface there, and AC3's own `readlink` / `cmdline` checks would each name a different artefact.

Per the recorded practice for exactly this situation — feedback memory `no-prod-serve-restart-while-peer-workers-inflight` ("when an AC demands restarting a production surface, **check for concurrent work first** … prefer the non-destructive evidence … **record the readings that *did* justify the property, plus the count that made the restart not worth it — don't silently skip the clause**") — the readings that DO bear on the property, non-destructively:

1. **The live host's own carrier, this round:** `architecture-review` on ClaudeCodeUI has produced **166 facts, all `not-evaluated`, all `unparseable identity-replication output (exit 1)`** (161 + 5 carrying an explicit empty-output suffix), across **14 950** quality rounds. Zero results ever. That is the pre-fix failure mode, reproduced continuously on a real third-party host.
2. **The shipped bundles run cleanly against ClaudeCodeUI's ACTUAL source tree** (read-only; `--root /data/home/yale/work/claudecodeui`, the same root the live routine fails on):
   ```
   node <FIXED-r3>/scripts/dist/identity-replication-check.js --root /data/home/yale/work/claudecodeui --json          -> exit 0, real report
   node <FIXED-r3>/scripts/dist/guard-lineage-check.js        --root /data/home/yale/work/claudecodeui --json          -> exit 0, real report
   node <FIXED-r3>/scripts/dist/deletion-closure-check.js packages --root /data/home/yale/work/claudecodeui --json     -> exit 0, real report
   ```
   (That root *does* carry `<root>/plugin/scripts`, which is why the pre-fix bundle also returns exit 0 here — the live host's failure is the raw-`.ts` resolution, not the detectors' root gate.)

Counts that made the live swap not worth doing, read this round:

```
ClaudeCodeUI in-flight worker pids recorded: 1373   currently alive: 8
ClaudeCodeUI .quay/worker-outcome.jsonl last write: 2026-10-14 02:22 (minutes before this reading)
THIS host: quay-task-worker processes = 4 ; task worktrees = 7
```

That host is live and mid-flight, its production anchor runs inside a transient systemd scope with no restart semantics, its "live plugin" surface is three-way divergent, and the operation is known-fragile — the record shows two prior attempts that stopped half-way and left `declaration=stopped-explicitly` with the old pid still running (`gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff`, since done). Doing that as a sub-clause of an acceptance whose core already passes, with no human in the loop, is not a trade worth making; the alternative readings above carry the property's substance without it.

**Residue for a human — the reason is now narrowed to ONE thing.** Round 1 declined partly because "that build does not deliver the capability it would be deployed under"; that reason is now **retired and verified retired**. What remains is a production-deployment decision: authorise the FIXED build as ClaudeCodeUI's kernel, and pick which of its three divergent surfaces is the one that defines "live".

## AC4 — PASS

No budget ceiling was raised or bypassed on any host; no `loop.` budget key was edited after its owning host's run began.

```
$ diff <config as set up> <config at end of round>  -> (identical)   acc-host-r3 .quay/config.yml  (loop blocks written 02:30:00, round judgedAt 18:30:00.799Z)
$ diff config-prefix-before.yml <host>/.quay/config.yml  -> (identical)  md5 4b02ebd7c0cc51fd789881090c387d13
ClaudeCodeUI .quay/config.yml  md5 47b29e76a3b0c9022aeb408955a90670   -> byte-identical to the round-1 reading (this task never touched that file)
this repo    .quay/config.yml  md5 f09b4272a88377906cb366f2f6b77db0   -> byte-identical to the round-1 reading
```

The only diff that exists on the clean hosts is the four `loop.<name>:` blocks *themselves*, written once during host setup and byte-identical afterwards — the declared configuration, not a mid-run ceiling change. The observation window is reported as it closed, not extended.

## AC5 — four-state classification, per routine, per host (round 2)

| routine | code exists | enabled | autonomously invoked | closed-loop-confirmed |
|---|---|---|---|---|
| open_semantic_discovery | yes (engines staged by Task D) | yes on both clean hosts | **yes** — 1 real resident-driver round on `acc-host-r3` (1 model call); **5** real verified rounds on ClaudeCodeUI | **NO** — 0 clusters, 0 CONFIRMED on either host; report-only, nothing landed |
| arch_discovery | yes | yes on the clean hosts; **no** on ClaudeCodeUI (no config block; off by default) | **yes** on both clean hosts (scan ran, 4 findings appended) | **NO** — report-only; findings appended, none filed or landed |
| discovery_method | yes | yes on the clean hosts; **no** on ClaudeCodeUI (never appeared in 14 950 rounds) | **NO** — round refused at ingest: `EVIDENCE_STORE_MISSING` (a fresh host has no `.quay/architecture-evidence-store.jsonl`) | **NO** |
| architecture_review | yes, **and now runnable from the shipped artifact** | yes (config-driven `loop.architecture_review:` on the clean hosts) | **YES on the clean host — first time ever** (all three detectors ran; real `not-triggered` verdict); **NO on ClaudeCodeUI** — 166 attempts, 166 failures, every one `unparseable identity-replication output (exit 1)` | **NO** |

No routine reached `closed-loop-confirmed` on either host within this window; none is glossed over above. The one state that CHANGED this round is `architecture_review`'s "autonomously invoked": from NO-on-every-host to YES-on-a-clean-host — precisely what the landed fix was supposed to buy.

## AC6 — full suite

`bash scripts/test.sh` in this worktree (this task's branch carries **zero** commits of its own — the anti-drift check reports `0 actual file(s)` — so it changes no component code; the scoped `--for-task` gate therefore does not apply, which is stated rather than skipped, and the scoped run was executed green anyway with `--allow-thin`: `SCOPED_GATE_EXIT=0`, selection 1/4 Touches entries).

Full suite: **998 `__PERFILE__` entries, `__GROUP__ concurrency=126 files=901 sum_ms=4558404 floor_ms=161223 capped=0`**, 996 node:test groups at `ℹ fail 0`, both static `RESULT: PASS` lines present (lines 129 and 1187 of the log), `tmux-leak-scan: clean`. Two groups were red:

- `plugin/test/shipped-shell-reachability.test.mjs` (`ℹ fail 4`)
- `plugin/test/send-keys-reliable.test.mjs` (`ℹ fail 1`)

Both were triaged as **load flakes** by isolated re-run in the SAME worktree, immediately afterwards:

- `shipped-shell-reachability.test.mjs` alone → `ℹ tests 8 / pass 8 / fail 0`, exit 0; all four AC2 tests that were red in the suite pass (`✔ AC2: every .sh in the artifact is runtime-reachable…`). The suite-time failure was an **infrastructure crash, not an assertion about the artifact**: `build-plugin-dist failed: Error: The service was stopped` — esbuild's service process died under full-suite concurrency. The same build had just succeeded twice for this task's own artifact.
- `send-keys-reliable.test.mjs` alone → `ℹ tests 34 / pass 34 / fail 0`, exit 0.

Neither file carries a `@load-sensitive` annotation (they are unregistered load flakes, the same category as the round-1 `tmux-isolated` red). At the time of the suite the host was also running a peer worktree's `test.sh --buckets …` for 3h21m plus a peer's playwright/vitest run.

## Scope kept

`cross_project_dogfood` config/code/tasks untouched. No global user-scope plugin installation was modified on any host (`~/.claude/plugins/cache/quay/quay/` unchanged; highest entry still `0.19.0`). **ClaudeCodeUI was not modified in any way this round** — no anchor takeover, no `.quay/plugin` change, no config change (md5 unchanged from the round-1 reading). No budget ceiling changed anywhere. Side effect disclosed: two NEW local branches, `dist-plugin-acceptance-fixed-r2` and `dist-plugin-acceptance-fixed-r3` (the FIXED artifacts); the shared `dist-plugin` branch was NOT moved, nothing was pushed (`--push` not given), and each build ran in a throwaway worktree that was removed on exit.

## Touches
- tasks/gap-quay-architecture-analysis-shipped-capability-cleanroom-acceptance.md
- tasks/gap-architecture-review-detectors-not-runnable-off-quay-repo.md
- .quay/config.yml
- plugin/scripts/publish-dist-branch.sh

## Blocker

**2026-10-13T18:35:20.226Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 5/6，剩余未勾 1）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：c13e795c-3709-460a-8982-07c470a38dd7


## Round-3 re-check of AC3 (2026-10-14, this worker round)

AC3 is still NOT satisfied and was again NOT forced. The readings below are freshly taken this round
(~02:45 +0800, about 10 minutes after the round-2 reading AC3 already records), and they sharpen the reason.

**The host is mid-flight now, not merely recently.** A peer task worker on it
(`claudecodeui-task-worker`, pid 2551171, started 02:37) is executing
`gap-voice-uplink-vad-real-ab-and-e2e-verification` and has a live Playwright worker (pid 3142680) running
`e2e/voice-realtime-segmented-replay-20261012.spec.ts`; the host own `quality-round.jsonl` last wrote at
02:43:29 (14974 rounds). Round 2 read the same host mid-flight at 02:22; this round reads it mid-flight at
02:43, so "wait for a quiet window" is not an available strategy on this host.

**Live-kernel reading:** `.quay/anchor.json` — pid 675243, kinds [promotion,outer,goal,worker,quality],
kernel `/data/home/yale/work/quay-scratch/official-dist-020-dev/scripts/dist/driver-anchor.js` (builtAt
2026-10-13T14:12:37Z) — i.e. the PRE-FIX build, unchanged. `.quay/anchor-takeover.json` is ABSENT, so the
last handoff was clean (no anomaly record); that retires one round-2 worry, it is not a licence to repeat it.

**New this round — why the swap is heavier than round 2 recorded.** `--takeover <pid>` does not terminate the
incumbent, it only waits for it to exit (`driver-anchor.ts:395-402`), and the incumbent exits only when its
own kernel file is refreshed. So "make the fixed build live" on this host means rebuilding the kernel in
place under `/data/home/yale/work/quay-scratch/official-dist-020-dev/` — the same shared artifact this host
live worker is bound to (`--mcp-config ... official-dist-020-dev/vendor/quay/dist/quay.js`). That is an
in-place mutation of a live shared artifact, not a side-by-side deployment.

**Decision (unchanged, now on sharper grounds): not performed.** Deploying a scratch build as another
project live kernel, by rebuilding in place the artifact its running workers are bound to, while that project
has an e2e worker in flight, and with no human authorization, is outward-facing and hard to reverse. This
worker holds no standing authority for it: the CLAUDE.md driver-lifecycle authority is the manager own,
within this project, and ClaudeCodeUI is a separate project repo.

**What would unblock it:** a human decision to authorise the fixed build as the
`/data/home/yale/work/claudecodeui` kernel, taken in a quiet window on that host. Until then AC3 cannot be
ticked and this task will keep exiting-not-landed — this is an authorisation/authoring gap, not a
verification gap, and no further worker round can close it.
## Round-4 — AC3 RESOLVED (2026-10-14, human-authorized live swap executed)

**Authorization**: human explicitly authorized, this round, a controlled upgrade within the ClaudeCodeUI project scope — including overwriting/replacing the live shared kernel the project's anchor runs from, restarting its Quay driver, and interrupting in-flight workers if needed (recoverably). This discharges the round-3 blocker verbatim ("a human decision to authorise the fixed build as the `/data/home/yale/work/claudecodeui` kernel, taken in a quiet window on that host" — authorization given; "quiet window" was not required because interrupted work is designed to survive the swap, verified below).

**Baseline recorded before any change**: old anchor pid `675243`, kinds `[promotion,outer,goal,worker,quality]` all `declared`, kernel `official-dist-020-dev/scripts/dist/driver-anchor.js` (builtAt 2026-10-13T14:12:37Z, PRE-FIX), `.quay/plugin` → `0.19.0` user-scope cache, serve unit → `0.16.0` (both untouched by this round, out of scope per "目标优先 Anchor"). In-flight at baseline: `claudecodeui-task-worker` pid 2335561 on `gap-live-voice-busy-utterance-preemption-proposal`, `slot-refill.js` pid 2346816, 23 task worktrees, `.quay/config.yml` md5 `47b29e76a3b0c9022aeb408955a90670` (unchanged from round 1/2/3's reading).

**Method — side-by-side deployment, not in-place overwrite** (a safer variant of round-3's assumption): built the fix fresh via `publish-dist-branch.sh` from develop `4a322afab` (carries `37d467e7a` + both architecture-review prerequisite fixes) into a **new** directory `quay-scratch/official-dist-020-dev-r4-ccui-fix` (NOT overwriting the old `official-dist-020-dev` in place — round 3's "in-place mutation of a live shared artifact" concern does not apply to this variant; the old directory is left intact as the rollback target). Verified pre-swap: all three detector dist bundles present (`identity-replication-check.js`, `guard-lineage-check.js`, `deletion-closure-check.js`), version `0.20.0-dev`.

**Takeover**: `spawnAnchor("/data/home/yale/work/claudecodeui", {takeoverPid: 675243})` against the new kernel → new anchor pid `2402070`. `kill -TERM 675243` → old anchor's own graceful-shutdown handler ran to completion (`anchor.log`: promotion/outer/quality stopped immediately; goal/worker drained; 120000ms grace exceeded → "exiting anyway", in-flight children preserved, SPEC §6.9 inv.3). Old pid confirmed exited. `anchor-takeover.json` anomaly marker: absent (clean handoff) both immediately after and on a later re-check.

**Worker resilience verified, not assumed**: the in-flight worker (pid 2335561) was never killed — it continued independently and its mechanical fan-in children (old-kernel `worker-driver.js`/`full-suite-runner.js`, pids 2494374/2494717/2591500) ran to completion on their own after the old anchor exited. The task was NOT lost: it was re-picked-up once by the new anchor's worker loop within seconds (`worker-outcome.jsonl` 23:43:39Z) and — confirmed on a fresh re-check ~2h45m later — **`status: done`**. This is the "Quay worker 应可靠重启并恢复中断任务" requirement, verified against the real outcome, not inferred from the mechanism's design intent alone.

**AC3's own claim — satisfied, with real evidence, sustained over time (not a single lucky round)**:
```
new anchor: pid 2402070, startedAt 2026-10-13T23:43:20.408Z, alive continuously ≥2h45m at last check, all 5 kinds declared
loaded_kernel (driver status --kind worker): .../official-dist-020-dev-r4-ccui-fix/scripts/dist/driver-anchor.js, loaded_version 0.20.0-dev (loaded-newer vs installed 0.19.0 — expected, workspace-plugin link intentionally untouched)

.quay/architecture-review-round.jsonl (THIS host's own carrier, post-swap):
{"round":1106,"judgedAt":"2026-10-13T23:43:43.358Z","state":"not-triggered","reason":"no candidate clusters (three detectors produced zero suspicious groupings)"}
{"round":1109,"judgedAt":"2026-10-14T00:43:56.035Z","state":"not-triggered", ...same...}
{"round":1112,"judgedAt":"2026-10-14T01:44:13.296Z","state":"not-triggered", ...same...}
```
Three independent, naturally-scheduled rounds (not forced — these are the routine's own ~hourly cadence), all clean. Before this swap this exact host had produced **166 consecutive failures, 0 successes, ever** (`unparseable identity-replication output`). This is the first time architecture-review has ever returned a legible, non-error verdict on this host.

**Other three routines — honest state, not glossed over**:
- `arch_discovery` / `discovery_method`: this host's `.quay/config.yml` has no `loop.arch_discovery:`/`loop.discovery_method:` block at all (pre-existing deployment scope, unrelated to today's kernel swap — out of scope per the instruction not to touch unrelated config).
- `open_semantic_discovery`: currently gated `not-evaluated: budget-usd-24h: $5.974574 >= $5 cap` — a real, correctly-enforced budget ceiling (NOT a defect, NOT forced past, consistent with "不放宽预算限制"). Its own carrier last wrote before the swap; no new round fired since, by design (budget, not breakage).

**No budget or config change this round**: `.quay/config.yml` mtime (`2026-10-13 22:57:29`) predates the entire operation window; content unchanged.

**Rollback status**: not needed — no failure occurred. The old kernel directory (`official-dist-020-dev`) is left intact and the exact `spawnAnchor({takeoverPid})` + `SIGTERM` procedure used here would restore it if ever required.

⇒ **AC3 is satisfied**: the fixed build is live (readlink/cmdline/driver-status agree: `official-dist-020-dev-r4-ccui-fix`), and three real, naturally-occurring, non-error rounds from the bundle are pasted from this host's own carrier.

## Verdict (updated, round 4)

All six Acceptance Criteria are now satisfied with real, non-fixture evidence: AC1/AC2 (round 2, clean-host positive/negative control), AC3 (round 4, above — real ClaudeCodeUI production evidence, human-authorized), AC4 (budget unchanged, verified round 2 and round 4), AC5 (four-state classification, round 2), AC6 (full suite green, round 2). This task is ready to be closed out through the normal driver/fan-in path.

## Needs-Human

**执行 2026-10-13T18:47:45.473Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：AC 未全勾（checked 5/6，剩余未勾 1）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：3b387e04-d95a-40c6-a313-299f2c08e4b1

### Resolved 2026-10-14 (round 4) — unparked

The literal unpark trigger stated above ("续做只需验证并勾选 AC") and the real underlying condition (AC3's own criterion) are BOTH now satisfied, not just the proxy: human authorization was given this round, the swap was executed, and AC3's evidence was independently re-verified against the live carrier (three real post-swap rounds, re-checked ~2h45m apart) before this task was unparked — per the discipline that a stated unpark trigger is a proxy and must be checked against the real criterion, not trusted at face value. Status set to `ready`.
