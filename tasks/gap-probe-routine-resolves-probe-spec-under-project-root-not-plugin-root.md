---
id: gap-probe-routine-resolves-probe-spec-under-project-root-not-plugin-root
title: probe 轨道把 probe spec 解析到项目根而非插件根，第三方宿主声明的 probe 例程被 fail-closed 跳过
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制（2026-10-20 核实，quay dev 工作区自身任务）。** `plugin/scripts/quality-gate-driver.ts:2713-2714`
写死 `probeRoutinesFromConfig(rootDir, { pluginRoot: path.join(rootDir, "plugin"), ... })`——probe 轨道把
probe spec 的解析根钉在**项目根下的 `plugin/probes/`**，而不是插件自身安装根。第三方宿主（没有 vendored
`plugin/probes/`）上，`loop.routines:` 里声明的任何 `probe:`（含 `architecture-analysis`）都会被
`readProbeSpec` 抛 `PROBE-SPEC FAIL-CLOSED: probe spec not found at <root>/plugin/probes/<name>.md`，
例程被 skip、driver 从不跑。这是「kernel 资源按项目根解析」缺陷族
（`gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root`，done）的新 callsite：
`gap-plugin-root-resolution-remaining-callsites-round2`（done）的 grep 用 `path.join(root, "plugin"`
（`root,` 字面）漏掉了这里的 `rootDir,` 变体。canonical 解析已存在：`plugin/scripts/routine-scheduler.ts:22`
用 `${CLAUDE_PLUGIN_ROOT}/probes/<name>.md`。修法方向：probe 轨道解析 spec 时回退到插件根
（`CLAUDE_PLUGIN_ROOT` / 插件缓存根）；`<root>/plugin/probes` 缺失时不得把已声明的例程硬 fail-closed 掉。

## AC

- [x] AC1（位置判定，双向控制）：`grep -n 'pluginRoot: path.join(rootDir, "plugin")' plugin/scripts/quality-gate-driver.ts`
      改后命中 0 处；负控制用同一 grep 对改前 develop 副本命中该 callsite（证明谓词可判，非恒零）。
- [x] AC2（双向负控制）：无 `plugin/probes/` 的第三方项目根 + 独立插件根上，`loop.routines:` 声明的 `probe:`
      （含 `architecture-analysis`）改后按插件根 `probes/<name>.md` 解析成功、例程进入例程表；改前同一夹具
      报 `PROBE-SPEC FAIL-CLOSED: probe spec not found at <root>/plugin/probes/<name>.md`。反向：本仓库
      （有 `plugin/`）场景行为不变（回归）。
- [x] AC3（单一解析根）：probe spec 解析与 `routine-scheduler.ts` 的 canonical 解析同根
      （`CLAUDE_PLUGIN_ROOT` / 插件缓存根），不另造第二套；`scripts/test.sh --for-task <this task>` 绿。

## DoD

在真实第三方宿主（非 fixture）上，`loop.routines:` 声明的 probe 例程在 quality-gate-driver 一轮里被装配并
运行（或如实报 legible not-evaluated，而非 PROBE-SPEC FAIL-CLOSED skip）；本仓库上该轨道行为不变。
AC1-AC3 勾齐并贴证据。

## Evidence

**AC1（位置判定，双向）**
- 改后：`grep -n 'pluginRoot: path.join(rootDir, "plugin")' plugin/scripts/quality-gate-driver.ts` ⇒ 无输出，exit 1（0 处）。
- 负控制：`git show develop:plugin/scripts/quality-gate-driver.ts | grep -n 'pluginRoot: path.join(rootDir, "plugin")'`
  ⇒ `2714:    pluginRoot: path.join(rootDir, "plugin"),`，exit 0（同一谓词可判，不是恒零）。
- 机器判据：`plugin/test/probe-spec-wiring.test.mjs` 的 `AC1 — driver no longer anchors…`（屏蔽注释 ⇒ 位置判定；
  同一谓词对改前 callsite 字面必须命中；注释里复述旧写法不算命中）。

**AC2（第三方宿主 / 反向回归）—— 真实 driver 进程，非单元 fixture**
夹具 `/tmp/qg-tp-evidence/ws-before` 与 `/tmp/qg-tp-evidence/ws`：**没有 `plugin/`** 的项目根 + `.quay/config.yml`
声明 `loop.routines: - name: architecture-analysis / trigger: interval:1440m / probe: architecture-analysis`；
插件根 = 本 worktree 的 `plugin/`（`QUAY_PLUGIN_ROOT`）；`--probe-runner-cmd` = 打印探针输出契约的假探针
（⛔ 不 spawn LLM）。两端都是**真的 quality-gate-driver `--once` 进程**，读的是真实 round log。
- 改前（主检出 pre-fix driver，同夹具）：fact `architecture-analysis` = `not-evaluated`，reason =
  `probe spec unreadable: PROBE-SPEC FAIL-CLOSED: probe spec not found at /tmp/qg-tp-evidence/ws-before/plugin/probes/architecture-analysis.md`。
- 改后（worktree driver，同夹具）：stderr = `probe 轨道已装配 1 条例程（architecture-analysis；规格根 <worktree>/plugin）`；
  fact = `verified`，reason = `deep scan ran: 0 structured finding(s), 0 malformed, 1 shard(s), 1 record(s) appended to .quay/routine-findings.jsonl, 0 filed as task(s) — remedy availability: not-declared …`。
- 反向（源检出回归）：`resolveProbeSpecRoot()` 解析为 `<repo>/plugin`（`AC2 reverse` 测试用 realpath 相等断言），
  同一根继续供给 `readProbeSpec('architecture-analysis', …)` 的正文。
- 宿主来源完备性（硬规则 5）：本机三个真实第三方工作区里，`meta-cc` 无 vendored `plugin/`，但它的
  `loop.routines:` 用的是**已退役的 `every(N)` 触发**（轨道本来就会以 trigger-kind 理由 skip，非本 defect 的场景）；
  `archguard` / `claudecodeui` 有 vendored `plugin/probes/` ⇒ 不构成「无 plugin/probes」场景。故用按 quay-init
  形状构造的宿主 + 真实 driver 进程取证。

**AC3（单一解析根 + scoped gate）**
- `resolveProbeSpecRoot()` = `resolveKernelPluginRoot()`（`driver-runtime.ts` 的既有实现；`QUAY_PLUGIN_ROOT` 是
  hermetic 测试缝），`llmProbeRoutine` 里 `readProbeSpec` 与 `resolveMappingPath` 看**同一个** `pluginRoot`
  （`AC3 — the probe spec root is the kernel plugin root` 测试）。⛔ 没有第二套根解析实现。
- `bash scripts/test.sh --for-task gap-probe-routine-resolves-probe-spec-under-project-root-not-plugin-root --allow-thin`
  ⇒ exit 0，`tests 133 / pass 133 / fail 0`（merge develop 后再跑一次仍 133/133）。

## Touches

- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/probe-routine.ts
- plugin/scripts/read-probe-spec.ts
- plugin/test/probe-spec-wiring.test.mjs
- tasks/gap-probe-routine-resolves-probe-spec-under-project-root-not-plugin-root.md

## Blocker

**2026-10-20T06:33:12.595Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/3，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：e3f211b8-0139-4e9a-a8ca-40ba7db1c3ad
