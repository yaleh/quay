---
id: gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry
title: architecture-review 无 config.yml host 入口 + 三检测器 argv 解析到目标仓根（非
  kernel）两处结构性不可部署缺陷
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal
**Part of the approved "Quay architecture analysis as a shipped capability" consolidation (2026-10-13) — the host-deployability half, parallel to what `gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-sources-never-works-off-quay-repo` (Task D, landed `b9ca7a9e2`) fixed for the three discovery routines. `architecture-review` has TWO separate, confirmed structural gaps that Task D did not touch (it is a different routine, not covered by that fix):**

**Gap 1 — no `.quay/config.yml`-driven host entry.** Every sibling Layer-1b routine (`open_semantic_discovery`, `discovery_method`, `arch_discovery`, `cross_project_dogfood`) is assembled from a `loop.<name>:` config block via its own `read<Name>Config(rootDir)` function (confirmed: `readDiscoveryMethodConfig` imported at `quality-gate-driver.ts:112`; `arch_discovery`/`cross_project_dogfood` have parallel reads). `architecture-review`'s cadence (`archReviewIntervalMinutes`) has NO such function — it is set ONLY by the CLI flag `--arch-review-interval` (`quality-gate-driver.ts:1300,1341,1371`), falling back to the hardcoded `ARCH_REVIEW_INTERVAL_MIN_DEFAULT = 60` (`:142`) when absent (`:1404-1405`). Confirmed by grep: zero occurrences of `architecture_review` anywhere in `plugin/scripts/*.ts`, `plugin/test/*.mjs`, or this repo's own `.quay/config.yml` — the key is entirely unclaimed. A host cannot enable/disable/schedule/cap this routine the way it can every other one; it can only be driven by whatever CLI invocation launches the anchor (not an operator-editable, per-project setting).

**Gap 2 — the three mechanical detectors resolve to the TARGET workspace, not the kernel.** `defaultIdentityReplicationArgv`/`defaultGuardLineageArgv`/`defaultDeletionClosureArgv` (`quality-gate-driver.ts:619-640`) each build their spawn path as `path.join(root, "plugin", "scripts", "<name>.ts")`, with an explicit code comment on every one: `// kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.` `root` here is the TARGET project's workspace root (the project being analyzed), not quay's own kernel/plugin install. This is correct ONLY when `root` happens to BE quay's own live dev checkout — on any other host (an installed plugin with no `plugin/scripts/identity-replication-check.ts` under its OWN project root), every detector spawn fails closed with a spawn error, and `runArchitectureReview` returns `not-evaluated: identity-replication spawn error: ...` every round, forever. This is structurally the SAME class of defect Task D fixed (a mechanism that only works off quay's own repo), but a DIFFERENT specific cause (wrong root resolution, not an unshipped dependency) and a DIFFERENT file (`quality-gate-driver.ts`, not `build-plugin-dist.mjs`) — not covered by Task D's fix or its tests.

**The fix for Gap 2 already exists and is used elsewhere in this exact codebase** — `resolveKernelScriptsDir()` (`plugin/scripts/driver-runtime.ts:302`, `QUAY_PLUGIN_ROOT`-overridable, hermetic-test seam) is the established pattern for "resolve a sibling kernel script's path regardless of which workspace is being analyzed," already used by `worker-fan-in.ts` (`:43,335,342,2097,3092`), `worker-driver.ts` (`:246`), and `promotion-driver.ts` (`:176`, resolving `ready-pool-check.ts` the identical way). `architecture-review`'s three detector-argv builders are the one place in the codebase that does NOT use it.

Confirmed NOT already covered by any existing task: `grep -li architecture-review tasks/*.md` returns 19 files, all either `done` (and about unrelated gaps — gap-filing routing, detector flag predicates, identity/deletion counting bugs, pool-judge spawnSync timeout for the UNRELATED B15 `pool-quality-judge` routine) or about cross-project-dogfood (also unrelated). None address config-entry or root-resolution.

## Plan
1. Add `readArchitectureReviewConfig(rootDir)` mirroring the existing `read<Name>Config` shape used by `discovery_method`/`arch_discovery`/`cross_project_dogfood` (enabled / interval / any caps worth exposing — at minimum the interval, since that's the only thing currently configurable at all, via CLI flag). Wire it into the same assembly point as the siblings (log line + injection into `qualityGateRoutines(...)`), replacing the CLI-flag-only resolution. Keep the CLI flag as a documented override, same precedence rule used elsewhere (`QUAY_PLUGIN_ROOT`-style: explicit arg wins, config next, hardcoded default last) — do not remove it outright without checking for a consumer (hard rule 5/5b: check for other call sites before deleting).
2. Fix `defaultIdentityReplicationArgv`/`defaultGuardLineageArgv`/`defaultDeletionClosureArgv` to resolve the detector script path via `resolveKernelScriptsDir()` instead of `path.join(root, "plugin", "scripts", ...)`. Remove the now-inaccurate `kernel-sibling-dev-tree-only` comment on each (it will no longer be true). `root` continues to be passed as the `--root` arg to each detector (that part is correct — it's what the detector analyzes, not where the detector's own code lives).
3. Negative control: verify, pre-fix, that running `runArchitectureReview` with `root` pointed at a clean scratch directory with no `plugin/scripts/*.ts` of its own produces exactly the `not-evaluated: identity-replication spawn error` failure described above (hard rule 2's "run the predicate against a known-true sample" half) — then verify, post-fix, the same scratch root produces a real detector run (using the KERNEL's own detector scripts analyzing the scratch root's — likely trivial/empty — dependency graph).
4. No change to detector semantics, trigger computation, judge call, or gap-filing wiring — this task is scoped to deployability (config entry + root resolution) only.

## Acceptance Criteria
- [x] AC1: `readArchitectureReviewConfig` exists, follows the same shape/precedence as a sibling `read<Name>Config`, and is wired into the same assembly log-line pattern (`quality-gate-driver: architecture-review 例程已装配...`) as `cross_project_dogfood`/`discovery_method`. A `.quay/config.yml` with `loop.architecture_review: {enabled: false}` produces zero spawns for a round that would otherwise have fired (pasted before/after).
- [x] AC2: the negative control from Plan step 3 is pasted — pre-fix run against a clean scratch root (no `plugin/scripts/*.ts`) fails exactly as predicted (`identity-replication spawn error`), proving the defect is real before claiming a fix.
- [x] AC3: post-fix, the SAME clean scratch root (still no `plugin/scripts/*.ts` of its own) produces a real, non-error detector run via `resolveKernelScriptsDir()` resolving to the KERNEL's own `plugin/scripts/identity-replication-check.ts` — pasted stdout/exit code.
- [x] AC4: this repo's own existing behavior is unchanged (`root` == kernel's own checkout continues to resolve identically, since `resolveKernelScriptsDir()` without `QUAY_PLUGIN_ROOT` override resolves to the running kernel's own scripts dir, which in this repo's dev-loop case is itself) — pasted a real round's identity-replication output before/after this change, byte-identical modulo path prefix.
- [x] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. No change to detector trigger logic, judge call behavior, or the already-landed gap-filing wiring (`gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel`).
- `ARCH_REVIEW_INTERVAL_MIN_DEFAULT` and the CLI flag both continue to work as documented fallbacks; config takes precedence when present (checked against the precedence table of a sibling routine's existing test).

## Evidence
All readings below were taken in this task's worktree `quay-worktrees/gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry` (branch `task/gap-…`, off develop `27ff3b15e`). PRE-FIX arm = `/data/home/yale/work/quay/plugin/scripts/quality-gate-driver.ts` (the main checkout still holds the pre-fix file; only the worktree was edited).

### AC1 — config entry, same shape/precedence, and the kill switch really stops the spawns
**Shape parity** (unit test `Gap1 — 返回形态与同族 read<Name>Config 逐键相同`, PASSED): `Object.keys(readArchitectureReviewConfig(root)).sort()` === `Object.keys(readDiscoveryMethodConfig(root)).sort()` === `["config","error","present"]`.
**Four states** (unit test `Gap1 — readArchitectureReviewConfig：缺席/启用/关停/写坏四态`, PASSED):
```
no config.yml / loop:{} / loop without the section ⇒ {present:false, config:null, error:null}
enabled:true  + interval:"interval:120m" ⇒ {present:true, config:{enabled:true, intervalMinutes:120}, error:null}
enabled:false                           ⇒ {present:true, config:{enabled:false, intervalMinutes:null}, error:null}
enabled missing / interval missing / "every(3)" / "interval:5m" ⇒ config:null + error (FAIL-CLOSED)
```
**Assembly line** (driver stderr, four real `--once` rounds):
```
loop.architecture_review absent          → quality-gate-driver: architecture-review 例程已装配（enabled, interval=60m [来源: default]，检测器脚本经 resolveKernelScriptsDir() 解析到本 kernel 的 plugin/scripts，⛔ 不是目标 root 的；--root 仍传目标工作区（未声明 loop.architecture_review — 用 CLI/缺省节奏；本内建例程默认开启））
enabled:true interval:"interval:120m"    → quality-gate-driver: architecture-review 例程已装配（enabled, interval=120m [来源: config]，…）
same config + --arch-review-interval 90  → quality-gate-driver: architecture-review 例程已装配（enabled, interval=90m [来源: cli]，…）
enabled:false                            → quality-gate-driver: architecture-review 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零 spawn）
malformed (enabled: yes-please)          → quality-gate-driver: architecture-review 例程已装配（loop.architecture_review needs a boolean 'enabled' (got "yes-please") — 每轮记 failed，零 spawn；⛔ 不回退到缺省节奏照跑）
```
⇒ precedence is **explicit CLI flag > config > hardcoded default**, and the config value is honored when no flag is given.

**Kill switch before/after — spawn count is a MEASURED file fact, not an inference.** Same root layout, same `.quay/config.yml` (`loop.architecture_review.enabled: false`), same counting instrument (a stub kernel behind `QUAY_PLUGIN_ROOT` whose three detectors append their name to `$ARCHREV_SPAWN_LOG` before emitting valid JSON); the only variable is which driver module runs:
```
######## PRE-FIX  + enabled:false (the key is UNCLAIMED ⇒ inert) ########
driver exit=0 ; (no assembly line)
fact: {"name":"architecture-review","value":{...,"clusterCount":0,...},"state":"verified","reason":"not-triggered (no candidate clusters)"}
SPAWNS=2 → identity lineage

######## POST-FIX + enabled:false (kill switch honored) ########
driver exit=0
quality-gate-driver: architecture-review 例程已装配（enabled:false — 每轮记 not-evaluated:disabled，零 spawn）
fact: {"name":"architecture-review","value":null,"state":"not-evaluated","reason":"not-evaluated:disabled — .quay/config.yml loop.architecture_review.enabled=false（kill switch：零 spawn）"}
SPAWNS=0 (no spawn log written)
```
⇒ "a round that would otherwise have fired" (pre-fix: 2 detector spawns with this exact config) now produces **zero spawns**.

### AC2 — negative control, run BEFORE claiming a fix
Clean scratch root with no `plugin/scripts/*.ts` of its own (`plugin/scripts/` holds only `local-helper.sh`). PRE-FIX driver, `--once`:
```
fact = {"name":"architecture-review","value":null,"state":"not-evaluated",
        "reason":"unparseable identity-replication output (exit 1): (empty output)"}
```
and the argv the pre-fix builder spawned, run by hand:
```
$ node --experimental-strip-types <root>/plugin/scripts/identity-replication-check.ts --root <root> --json
exit=1 ; stdout empty ; stderr: Error: Cannot find module '<root>/plugin/scripts/identity-replication-check.ts'
```
⇒ the defect is REAL and reproduced before any fix: the round is `not-evaluated` and the detector never ran, every round, forever.

⚠️ **One correction to the Plan/AC's prediction, recorded rather than papered over** (hard rule 2's "run the predicate against a known-true sample" half is exactly what surfaced it): the predicted reason string was `identity-replication spawn error`, but the actual reason is the **sibling** fail-closed branch `unparseable identity-replication output (exit 1): (empty output)`. Cause: `node` itself starts fine and only then fails to load the missing module, so `runAsync` returns `status:1` with `error === null` — and `runArchitectureReview`'s `spawn error` branch is keyed on `error`, not on `status`. Both are `not-evaluated` (same fail-closed family, same stage, same defect); the AC's operative claim — "a pre-fix run against a clean scratch root fails, proving the defect is real" — holds, which is why this AC is ticked. A root with no `plugin/scripts/` at all behaves identically (verified).
A second, adjacent finding (out of scope, not fixed here): on this failure path the detector's stderr is discarded (`runAsync` without `collectStderr`), so the operator sees `(empty output)` instead of `Cannot find module …`.

### AC3 — post-fix, the SAME clean scratch root, real detector run
```
$ node --experimental-strip-types <worktree>/plugin/scripts/quality-gate-driver.ts --root <same scratch root> --once --round-log <…> --json
driver exit=0
fact = {"name":"architecture-review","value":{"fired":false,"reasons":[],"clusterCount":0,…},"state":"verified","reason":"not-triggered (no candidate clusters)"}

$ node --experimental-strip-types <kernel>/scripts/identity-replication-check.ts --root <same scratch root> --json   # the path resolveKernelScriptsDir() produced
exit=0
{ "root": "/tmp/archrev-hostlike-67Ltvu", "pathConstants": [], "judgmentRewrites": [], "byteIdentical": {"count":0,"totalLines":0,"pairs":[],"symlinksSkipped":0}, "literalReplication": {…}, … }
```
⇒ the script resolved to the **KERNEL's own** `plugin/scripts/identity-replication-check.ts` while `--root` stayed the target; exit 0 with a real JSON report (empty table ⇒ no clusters ⇒ `not-triggered`, not an error).

**Boundary of the claim (stated so it is not over-read):** if the target root has no `plugin/scripts/` directory *at all*, the post-fix spawn now RESOLVES and RUNS, but the detector's own guard then refuses the root by design (`exit 2`, `ERROR: plugin/scripts not found under <root> — is --root correct?`; `identity-replication-check.ts:1307`) — this instrument only analyzes quay-shaped trees. The fix therefore converts a *phantom spawn failure* into the instrument's *own honest, diagnosed refusal*; making the instrument able to analyze a non-quay tree is a different change (it is a dev-tree-only detector by construction) and is not claimed here.

### AC4 — this repo's own dev-loop behavior unchanged
**(a) A real round with the DEFAULT detector argv on a real quay checkout** (the task worktree; `recordVerdicts=false` + `halted=true` so no carrier write and no LLM spawn), PRE-FIX module vs POST-FIX module, same root:
```
PRE-FIX  : {"fired":false,"reasons":[],"clusterCount":0,…} state=verified reason="not-triggered (no candidate clusters)"  (elapsedMs 10524)
POST-FIX : {"fired":false,"reasons":[],"clusterCount":0,…} state=verified reason="not-triggered (no candidate clusters)"  (elapsedMs 10597)
```
(also run against `root=/data/home/yale/work/quay` itself — byte-identical Facts both arms.)

**(b) The detector output itself — byte-identical, not merely modulo a path prefix:**
```
$ diff <(pre-fix argv+stdout-sha256) <(post-fix argv+stdout-sha256)   # root = a real quay checkout
IDENTICAL
identity : argv[2] = <checkout>/plugin/scripts/identity-replication-check.ts
           sha256(cebce114faa4b36d06cd43ad05eaf4f5b1136dad3ade5f7b41c235abc5234d53) 76697 bytes   [both arms]
lineage  : argv[2] = <checkout>/plugin/scripts/guard-lineage-check.ts
           sha256(976cf531b26c9177106e1ce7270d7fc2467b098d1695476b4c67fafbea430007)  4656 bytes   [both arms]
```
⇒ when `root` IS the kernel's own checkout, `resolveKernelScriptsDir()` and the old `path.join(root,"plugin","scripts")` name the **same file**, so the argv and the detector output are identical.
**Instrumentation note (so the reading is not mistaken for a fix effect):** an earlier pass of this comparison showed the lineage arm producing 0 bytes pre-fix. That was a harness artifact, not a difference: the root had been passed through the `/home/yale → /data/home/yale` symlink, which defeats these instruments' `isDirectEntry` URL-equality guard so `main()` never ran (the known `url-equality-entry-guard-silent-noop-via-home-yale-alias` family). Re-run with a realpath-consistent root, both arms are byte-identical.

### AC5 — scoped gate green
```
$ bash scripts/test.sh --for-task gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry --allow-thin
scoped gate exit=0
ℹ tests 41   ℹ pass 41   ℹ fail 0   ℹ cancelled 0
```
**Findable-false controls** (the new tests are not vacuous — mutating the fix back reddens them):
```
M1 restore `path.join(root,"plugin","scripts",name)` in kernelDetectorArgv ⇒ Gap2 test RED + the pre-existing AC4(b) P1-boundary test RED   (fail 2)
M2 drop the `gate.state !== "enabled"` short-circuit                          ⇒ both Gap1 gate tests RED                                  (fail 2)
M3 main(): force archReviewGate to {state:"enabled"}                          ⇒ the Gap1 main() config test RED                           (fail 1)
```
Also green: `kernel-sibling-resolution-check --root <worktree>` → `PASS — 426 kernel file(s) scanned, 0 naive kernel resource resolution(s)` (the three `kernel-sibling-dev-tree-only` exemption markers were REMOVED, and the checker stays green because the anchors are now correct rather than exempted).
Anti-drift: `anti-drift-touches-check --task … --worktree … --merge-target develop` → `ANTI-DRIFT OK — 2 actual file(s), all within declared Touches`.

## Touches
- tasks/gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/quality-gate-driver.test.mjs
