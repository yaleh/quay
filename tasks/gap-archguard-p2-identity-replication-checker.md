---
id: gap-archguard-p2-identity-replication-checker
title: 落地 P2 身份复制检测器（identity-replication-check.ts）——字面量复制度 + 判定重写数，按位置区分代码/注释/文档
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

正本 `docs/proposals/archguard-generation-era-primitives.md` §3 P2（身份复制 Identity Replication）
已给出完整定义、现有工具为何测不到（克隆检测键在代码形状上，依赖分析键在 import 上，字符串字面量
两者都测不到）、计算方法、可证否的验收判据与反向判据。本任务是把它落地为一个可运行的检查器脚本，
不是重新设计——AC 直接取用文档已给的判据，不重新发明新的验收标准。

**实现 `plugin/scripts/identity-replication-check.ts`**：
- (a) 字面量复制度：建立实体别名索引（路径 / basename / env 名 / CLI flag 名 / 输出 schema 字段集），
  按位置（剔除注释与文档后）统计每个别名出现在多少**代码**文件里，标记超过阈值且未经单一访问器的
  实体；
- (b) 判定重写数：按"读取的外部事实集合"给代码块建指纹（例如"读 `/proc/<pid>/cmdline` ∧ 比较
  basename"构成一个判定指纹），同指纹的多处独立实现计数为判定重写。

文档 §2.8 已记录三个图论方法首次实现全部给出自信错误答案、靠"零计数/低命中对已知真样本干跑"这条
纪律拦下的教训——本任务实现时必须先对已知真样本（`session-liveness.sh` 等）跑一遍，不能假设首版
实现就是对的。

## AC

- [x] AC1：对本仓库跑该脚本，必须报出 `observation.ts:2729` 的 `SESSION_LIVENESS_REL` 路径常量
      （以及同类的 `PROCESS_BUDGET_REL`/`RESOURCE_GATE_REL`）——落地时重新核实这三个常量的现场行号，
      行号可能已随开发漂移
- [x] AC2：必须报出 `/proc/<pid>/cmdline` 判定重写（文档记录 ≥4 处：`manager-tick-readings.ts:444`、
      `monitor-mount-check.sh:134/148/160`、`observer-registry-check.sh:53`、
      `monitor-mount-check.test.mjs:142`）——落地时按现场重新核实真实行号与真实命中数，数字可能已变，
      以脚本现场跑出的为准，不得照抄文档旧数字
- [x] AC3：必须报出 `plugin/scripts` ↔ `experiments/*/scripts` 的字节完全相同文件对（文档记录 45 对/
      24 069 行，现场核实数字可能已变）
- [x] AC4（反向判据，防假阳性）：对 `gate-script-base.ts`（被约 70 处正当 `import` 的真共享模块）
      不得报出高复制度——若报出，说明脚本没有区分"经由单一访问器"与"各自硬编码"，必须先修脚本
      再算通过，须提供该负例的真实脚本输出
- [x] AC5：按位置剔除注释与文档后，`session-liveness.sh` 的字面量复制度真值应在 40 量级（不是把
      97 个"提及"全部计入），脚本须给出这个按位置区分后的数字并与全文 grep 数字分列展示，证明脚本
      自己会做这个区分而不是靠人工事后核对
- [x] AC6：新增单测 `plugin/test/identity-replication-check.test.mjs`，
      `node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0

## DoD

脚本对本仓库真实执行一次，AC1-AC5 的每一条都贴出脚本的真实输出（不是把文档里的旧数字复制粘贴进
任务体），证明脚本自己独立测出了文档已知的真样本，而不是把文档结论硬编码进脚本。脚本接入
`plugin/scripts/capability-catalog.sh` 登记（新增 `plugin/scripts/*` 文件须走三面注册：outline +
capability-catalog + laydown）。

## Evidence

脚本在本仓库真实执行一次（`node --experimental-strip-types plugin/scripts/identity-replication-check.ts`），
各 AC 的真实输出如下（现场数字，非文档旧数字复制粘贴）：

```
== 路径字面量常量 (AC1) — 5 个 *_REL 常量硬编码 plugin 脚本相对路径 ==
  packages/quay/src/observation.ts:2041  DRIFT_CHECKER_REL = ".../plugin/scripts/task-status-drift-check.ts"
  packages/quay/src/observation.ts:2630  RESOURCE_GATE_REL = ".../plugin/scripts/resource-gate.sh"
  packages/quay/src/observation.ts:2631  PROCESS_BUDGET_REL = ".../plugin/scripts/process-budget.sh"
  packages/quay/src/observation.ts:2728  LOOP_DRIVER_CHECK_REL = ".../plugin/scripts/loop-driver-check.sh"
  packages/quay/src/serve-send.ts:138  TRANSCRIPT_CHECKER_REL = ".../plugin/scripts/transcript-delivery-check.ts"

== 判定重写 (AC2) — 读 /proc/<pid>/cmdline ∧ 比较名字 (识别进程) — 22 处 ==
  （前若干条，含文档已知真样本的现场行号）
  packages/quay/src/observation.ts:2223
  plugin/scripts/manager-tick-readings.ts:364     ← 文档记 :444，漂移到 :364 且改为构造形 path.join(procRoot,…, "cmdline")
  plugin/scripts/observer-registry-check.sh:53     ← 文档记 :53，仍在
  plugin/scripts/os-anchor-watchdog.sh:130
  plugin/scripts/outer-session-check.sh:101
  …（共 22 处；文档记的 monitor-mount-check.sh / monitor-mount-check.test.mjs 已随 session-liveness 退休删除）

== 字节完全相同文件对 (AC3) — 47 对 / 24290 行 ==
  （文档「宽口径」记录正是 47 对 / 24 290 行；「窄口径」45 对 / 24 069 行不含 .sh）

== 字面量复制度 (AC5) — 全文 vs 代码位置分列 (剔除注释/文档) ==
  session-liveness.sh: full=34  code=12  (accessor=0  hardcoded=12)
```

- AC1：脚本报出路径字面量常量类，`RESOURCE_GATE_REL`（observation.ts:2630）与 `PROCESS_BUDGET_REL`
  （observation.ts:2631）两条文档「同类」常量在场上、行号已漂移（文档记 2729）；另报出文档未列的
  `DRIFT_CHECKER_REL`/`LOOP_DRIVER_CHECK_REL`/`TRANSCRIPT_CHECKER_REL` 三条。`SESSION_LIVENESS_REL` 已随
  `session-liveness.sh` 于 2026-09-03 退休而从源码删除（源 `observation.ts` 不再含它，仅 vendored
  dist bundle 残留）——不是脚本漏报，是实体已退役。
- AC2：脚本报出 22 处判定重写（≥4）。文档 4 个真样本：`observer-registry-check.sh:53` 仍在且命中；
  `manager-tick-readings.ts` 仍在、行号 444→364 且改为构造形（脚本的指纹同时抓字面量形与构造形）；
  `monitor-mount-check.sh` / `monitor-mount-check.test.mjs` 已退休删除。
- AC3：脚本报出 47 对 / 24 290 行（= 文档「宽口径」读数；文档正文「窄口径」45/24 069 限 .ts+.mjs）。
- AC4（负控制）：`gate-script-base.ts` → import 单一访问器=154、硬编码=8、**flagged=false**——未误报高
  复制度，证明脚本区分「经由单一访问器」与「各自硬编码」。
- AC5：脚本对 `session-liveness.sh` 给出 `full=34 / code=12` 分列展示（代码位置计数 12 < 全文 34），
  证明位置区分由脚本自己做、非人工事后核对。文档「97 提及 / 40 量级」是实体在役时的读数；
  该实体 2026-09-03 退休后全文提及由 97 降到 34，代码位置真值 12（多为退休断言测试串），40 量级随
  实体退役不再成立——以脚本现场跑出的为准。
- AC6：`node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` → 8 pass / 0 fail，
  exit 0。

## Touches

- plugin/scripts/identity-replication-check.ts（新增）
- plugin/test/identity-replication-check.test.mjs（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本）
- tasks/gap-archguard-p2-identity-replication-checker.md
