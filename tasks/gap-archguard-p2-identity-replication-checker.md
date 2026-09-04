---
id: gap-archguard-p2-identity-replication-checker
title: 落地 P2 身份复制检测器（identity-replication-check.ts）——字面量复制度 + 判定重写数，按位置区分代码/注释/文档
status: ready
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

- [ ] AC1：对本仓库跑该脚本，必须报出 `observation.ts:2729` 的 `SESSION_LIVENESS_REL` 路径常量
      （以及同类的 `PROCESS_BUDGET_REL`/`RESOURCE_GATE_REL`）——落地时重新核实这三个常量的现场行号，
      行号可能已随开发漂移
- [ ] AC2：必须报出 `/proc/<pid>/cmdline` 判定重写（文档记录 ≥4 处：`manager-tick-readings.ts:444`、
      `monitor-mount-check.sh:134/148/160`、`observer-registry-check.sh:53`、
      `monitor-mount-check.test.mjs:142`）——落地时按现场重新核实真实行号与真实命中数，数字可能已变，
      以脚本现场跑出的为准，不得照抄文档旧数字
- [ ] AC3：必须报出 `plugin/scripts` ↔ `experiments/*/scripts` 的字节完全相同文件对（文档记录 45 对/
      24 069 行，现场核实数字可能已变）
- [ ] AC4（反向判据，防假阳性）：对 `gate-script-base.ts`（被约 70 处正当 `import` 的真共享模块）
      不得报出高复制度——若报出，说明脚本没有区分"经由单一访问器"与"各自硬编码"，必须先修脚本
      再算通过，须提供该负例的真实脚本输出
- [ ] AC5：按位置剔除注释与文档后，`session-liveness.sh` 的字面量复制度真值应在 40 量级（不是把
      97 个"提及"全部计入），脚本须给出这个按位置区分后的数字并与全文 grep 数字分列展示，证明脚本
      自己会做这个区分而不是靠人工事后核对
- [ ] AC6：新增单测 `plugin/test/identity-replication-check.test.mjs`，
      `node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0

## DoD

脚本对本仓库真实执行一次，AC1-AC5 的每一条都贴出脚本的真实输出（不是把文档里的旧数字复制粘贴进
任务体），证明脚本自己独立测出了文档已知的真样本，而不是把文档结论硬编码进脚本。脚本接入
`plugin/scripts/capability-catalog.sh` 登记（新增 `plugin/scripts/*` 文件须走三面注册：outline +
capability-catalog + laydown）。

## Touches

- plugin/scripts/identity-replication-check.ts（新增）
- plugin/test/identity-replication-check.test.mjs（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本）
- tasks/gap-archguard-p2-identity-replication-checker.md
