---
id: gap-driver-anchor-runs-without-host-derived-memory-envelope
title: driver anchor 组无内存包络——spawnAnchor 直接 detached 起 anchor，driver 群与全部 worker
  在用户 cgroup 里无 MemoryMax；quay 只给全量套件套了 systemd-run，运维被迫手搓无上限 scope（2026-09-25
  一次 OOM 事故 36 次 kill）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
**type:** execution

## Proposal

**现象与证据（一次事故，来自另一项目 claudecodeui 的会话 + 本机 journal 复核，2026-09-25）**：10:11 起，`quay-drivers-claudecodeui-1790302318.scope` 内的 driver 群与其 worker 在 10:15–10:37 期间被内核 OOM killer 击杀 36 次，机器 load 冲到 4309，操作员手动杀进程。该 scope **不是 quay 创建的**：quay 源码与已装 0.11.0 缓存里都没有 `quay-drivers-` 字符串，`start-drivers.ts` 直接调 `quay driver start`；journal 显示它是有人用 `systemd-run --user --scope … -p OOMPolicy=continue` 临时包了一层 `start-drivers.js`，**没有 `MemoryMax`，也没开内存记账**，所以事后没有峰值读数。

**根因（机制，非症状）**：`driver-runtime.ts` 的 `spawnAnchor`（约 :1304）用 `spawn(node, [driver-anchor …], {detached:true})` 直接起 anchor，六个 kind 的循环与 worker-driver 派出的全部 worker 子进程都继承调用者所在的 cgroup。`systemd-run --scope` 只出现在 `full-suite-runner.ts`（`MemoryMax=16G`，人 2026-09-24 裁定），所以「套件有包络、driver 群没有」。quay 没提供受支持的受限启动方式，运维就自己手搓一个（且手搓得不带上限）。`/quay:drivers` skill 也没提资源包络。

**提案**：在 anchor 的**唯一起点** `spawnAnchor` 处，可用时用 `systemd-run --user --scope --collect --unit=quay-anchor-<root-slug>-<ts> -p MemoryAccounting=yes -p MemoryMax=<宿主推导> -p OOMPolicy=continue` 包住 anchor 启动命令。已实测（2026-09-25）`systemd-run --scope` 会原地 exec，被 spawn 的 pid 与内层 `$$` 相同（210035 == 210035），所以 `.quay/anchor.pid` / `*-driver.pid` 的语义不变；子进程（含全部 worker）都在该 scope 内。**MemoryMax 必须宿主推导**（CLAUDE.md 硬规则 4 推论二：写死的 `16G` 类字面量换机就变真限制）：默认取 `floor(os.totalmem() × 0.25)`，可用环境变量 `QUAY_DRIVER_SYSTEMD_RUN_LIMITS` 覆盖（复用 `full-suite-runner.ts` 的 `parseSystemdRunLimits` 语法；显式空串 = 明确不设上限）。⚠️ **0.25 是未经测量的起始值**（本机 246G ⇒ ≈61G；同机全量套件无上限时实测峰值 8–10.5G），不是目标；本任务同时落 `MemoryPeak` 读数，之后按实测调，而不是凭空定阈值。systemd-run 不可用（无 systemd / 无 user bus / 探测失败）时**回退为当前行为**，但必须如实报出独立取值 `envelope: "none"` + 原因，不得伪装成有包络（硬规则 3b）。

<!-- dedup-ref -->相关但机制不同：`gap-systemd-run-limits-for-suite-and-heavy-ops`（done，只包全量套件）、`gap-systemd-run-cancel-cpuquota-keep-memory-guardrail`（done，取消 CPU 配额）。本任务包的是 driver anchor 组，不动套件自己的 scope；套件 scope 是 app.slice 下的兄弟 scope，不计入 anchor 的上限，这是有意的。

**范围外（观察项，按硬规则 12 不设为前置——目前只有本机这一次事故的读数）**：①派发环加内存项（`MemAvailable` 低时延后派发）；②给 acceptance 命令 / worker 内重活各套 per-job scope；③CPU 上限（人已裁定取消 CPU 配额，本任务不设）。

## Plan

1. `plugin/scripts/driver-runtime.ts`：新增一个纯函数（如 `anchorLaunchArgv`/`resolveAnchorEnvelope`）算出 `{argv, envelope}`：读 `os.totalmem()`（测试 seam 可注入）、`QUAY_DRIVER_SYSTEMD_RUN_LIMITS`、systemd-run 可用性探测（复用 `full-suite-runner.ts` 已有的探测/argv 拼装思路；**不得引入新的 import 环**，`valueSccs` 基线不许涨——若复用会成环，就把最小共用部分放到已存在的共享模块里，或在 driver-runtime 内自带一份并在注释里点名对应函数）。`spawnAnchor` 改为 spawn 该 argv。
2. anchor 启动后读**内核实际生效值**写进 `.quay/anchor.json` 的新字段 `envelope`：`{unit, memoryMax, source}`，`unit` 取自 `/proc/self/cgroup`，`memoryMax` 读 cgroup 的 `memory.max` 文件（直接量，不回显自己传的参数——硬规则 4b）；无包络时 `envelope: "none"` 并带 `reason`。
3. 接管（takeover / 自刷新交接）路径：替代 anchor 同样经 `spawnAnchor` 起，落在新 scope；旧 scope 随旧 anchor 退出自动回收（`--collect`）。确认 `driver-anchor-takeover` 相关测试仍绿。
4. 新测试 `plugin/test/driver-anchor-memory-envelope.test.mjs`：纯函数断言（64G 与 256G 两个注入宿主得到不同 MemoryMax；覆盖 env 与空串；systemd 不可用回退）+ 一条真 cgroup 负控制（把上限压到极小，子进程超配被 OOM 杀而测试进程存活；systemd-run 不可用时输出独立取值 `not-evaluated`，不算 pass）。
5. `plugin/skills/drivers/SKILL.md`：写明包络行为、覆盖变量、`envelope: "none"` 的含义；再跑 `concurrency-literal-check.ts` 确认没有引入 `\d+G` 字面量默认值。

## Acceptance Criteria

- [ ] `node --test plugin/test/driver-anchor-memory-envelope.test.mjs` 退出码 0，且其中含：注入 64G/256G 两个宿主总内存得到**不同**的 MemoryMax；`QUAY_DRIVER_SYSTEMD_RUN_LIMITS=""` 得到无 `-p MemoryMax=`；systemd-run 探测失败得到 `envelope: "none"` 而非缺字段。
- [ ] `node --experimental-strip-types plugin/scripts/concurrency-literal-check.ts` 退出码 0，且 `grep -nE 'MemoryMax[^\n]*[0-9]+[GM]"' plugin/scripts/driver-runtime.ts` 无命中（宿主推导，无写死大小字面量）。
- [ ] 真载体读数（推论三，N 只计实现落地后的时间窗）：在主检出对本工作区执行 `quay driver restart --kind worker` 后，`readlink`/`cat /proc/$(cat .quay/anchor.pid)/cgroup` 以 `.scope` 结尾，且 `systemctl --user show <该 unit> -p MemoryMax` 不为 `infinity`，且与 `.quay/anchor.json` 的 `envelope.memoryMax` 一致。把这三个读数原文贴进任务备注。
- [ ] 负控制真实跑过：把 `QUAY_DRIVER_SYSTEMD_RUN_LIMITS="MemoryMax=64M"` 下起的 anchor 组内跑一个超配 allocator，`journalctl --user` 出现该 scope 的 OOM kill 记录，且 anchor 之外的进程（本 shell）不受影响；贴 journal 行。
- [ ] `node --experimental-strip-types packages/quay/bin/quay.ts driver status --kind worker --json` 之后 `.quay/anchor.pid` 的 pid 与启动时 spawn 返回的 pid 相同（包络不改变 pid 语义）；`plugin/test/driver-anchor-takeover.test.mjs` 与 `plugin/test/driver-anchor-bundle.test.mjs` 退出码 0。
- [ ] `grep -nE 'QUAY_DRIVER_SYSTEMD_RUN_LIMITS|envelope' plugin/skills/drivers/SKILL.md` 至少 2 处命中。
- [ ] `scripts/test.sh --for-task gap-driver-anchor-runs-without-host-derived-memory-envelope` 退出码 0。

## Definition of Done

真实落地：主检出的常驻 anchor 已在带宿主推导 MemoryMax 的 scope 内运行，且 `.quay/anchor.json` 与 `systemctl --user show` 读到同一个非 infinity 的值；负控制在真 cgroup 上实测被 OOM 杀而宿主与其他用户进程不受影响。仅有 fixture 通过、或仅有单元断言而无生产载体读数，不算完成。同时 `MemoryPeak` 的读取方式写进备注，供之后按实测调 0.25。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/test/driver-anchor-memory-envelope.test.mjs
- plugin/skills/drivers/SKILL.md
- tasks/gap-driver-anchor-runs-without-host-derived-memory-envelope.md
