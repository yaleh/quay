---
id: gap-manager-instrument-failures-need-mechanical-detection-not-carefulness
title: "manager instrument failures hit 7 times tonight across 5 families — all
  5 already documented in manager-loop-tick.md §4 failure table, yet prose rules
  provably don't work (7 recurrences); AC8 form: the families get MECHANICALLY
  detected, not that manager is more careful; the manager can't write the
  checker themselves (role boundary) — the inner must build it"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**管理者仪器故障整晚 7 次，全落在五族——五族每一个都已成文在 `manager-loop-tick.md` §4 失效表，
照样重复发生。散文规则被证无效（7 次复发），达成形态必须是机械检出。**

### 五族（每族一个实例，可复算）

| # | 族 | 实例（今晚） | 成文位置 |
|---|---|---|---|
| 1 | **grep/pgrep 自匹配** | `pgrep -f 'quay.ts serve'` 匹配到发起查询的命令自己，kill 杀外层自己的 shell | §4 + CLAUDE.md 0b 多处 |
| 2 | **零命中当「不存在」** | 手写正则 0 命中而同一数据 `timecost` 报 8 次 | §4「零命中当没发生」 |
| 3 | **管道后读 `$?`** | `cmd \| grep x; echo $?` 读的是 grep 的退出码，不是 cmd 的 | §4 |
| 4 | **片段/参数里的文件名当全貌或进程名** | `comm=node` 永不匹配（实际 node-MainThread）；把 `.claude` 路径子串当进程名 | §4 + session-liveness 任务 |
| 5 | **读派生视图断言实时状态** | 读聚合快照断言当前 inProgress；读 full-suite-state 断言"正在跑"而它已陈旧 | §4 + gap-over90-clock 交叉 |

**7 次复发**：五族不是新形态，是同一批已知失效形态的重复。`manager-loop-tick.md` §4 写它们的目的就是
「写在这里因为它们已经发生过」，但**写下来 ≠ 被检出**——管理者下一次照样踩。

### 为什么散文规则无效（管理者的自证）

管理者的 AC8 达成形态原文：**「这些族被机械检出，而不是我更小心」**。7 次证明「更小心」这条路径
本身不可靠——小心是状态不是机制，会在长夜、疲惫、上下文压缩后退化。**散文规则（§4 失效表）只对
"读它的时候"生效，不构成检出。**

### 角色边界：管理者不能自己写检查器

管理者是观测方，写检查器是执行方（inner）的活——本任务就是把它交给执行方。

### 选定机制（方向，接法留执行时）

写一个**静态扫描器**（如 `plugin/scripts/instrument-failure-check.ts`），扫 shell 命令（tick 文档、
skills、scripts 里的命令）检出五族：

1. **自匹配**：`pgrep -f|grep -f` 的目标串出现在扫描面自身的命令行里 ⇒ 报「自匹配风险」（正确形态：
   `comm`/`pgrep -x` 精确匹配，或 `grep -v` 排除自身）；
2. **零命中当不存在**：grep/pgrep 零命中后跟「没发生/不存在/无数据」断言，且该命令无正控制 ⇒ 报；
3. **管道后读 `$?`**：同一命令序列里 `\|` 之后出现 `$?` 而中间无 `PIPESTATUS` ⇒ 报；
4. **片段当全貌/进程名**：进程上下文里用非锚定片段（`grep -f` 裸词、`comm=` 未匹配）⇒ 报；
5. **派生视图断言实时**：读状态/快照文件（`*.json`、`full-suite-state`、聚合快照）断言实时状态而
   无新鲜度检查（mtime/age）⇒ 报。

**负控制**：每个族构造一个「正确写法」必须零命中；构造一个「错误写法」必须报出。

## Contract

```
measure detected_families = `node plugin/scripts/instrument-failure-check.ts --scan orchestration/manager-loop-tick.md orchestration/orchestrator-loop-tick.md plugin/loop/*.md 2>/dev/null | grep -c '^FAMILY-'` stdout 数字段
band detected_families = ≥ 5（五族每族至少一条可检出）
invariant 管理者的仪器失效五族必须有机械检出路径，检出路径不是「管理者更小心」的另一种说法
invoke `node --no-warnings --experimental-strip-types plugin/scripts/instrument-failure-check.ts --scan orchestration/manager-loop-tick.md --json`
control 每族造一正一负两个样本（正确写法 0 命中、错误写法必报）——正负控制逐族贴出
resume 若中断，先跑 measure 读当前可检出族数，再读 manager-loop-tick.md §4 的五族原文
```

## Acceptance Criteria

- [ ] AC1: 扫描器检出**全部五族**（每族至少一个真实命中，来自现有 tick 文档/脚本，非人造样本）
- [ ] AC2: **负控制逐族成立**——每族正确写法 0 命中、错误写法必报（承重条：报不出正确写法的
      检出器是噪音，报不出错误写法的检出器是摆设）
- [ ] AC3: 接入调用点（如 `scripts/test.sh` 静态 tier 或 manager tick 的复核步骤），非一次性脚本
- [ ] AC4: 管理者按检出器复核——7 次复发的五族在未来 N 次 tick 中被机械拦下（而非管理者更小心），
      贴出拦截记录
- [ ] AC5: 与 `manager-loop-tick.md` §4 交叉标注（成文 → 机械检出，散文变可执行）

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 管理者连续 M 个 tick 无仪器失效（或被机械检出并即时纠正），贴出 M 与记录
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- plugin/scripts/instrument-failure-check.ts（新扫描器，或并入既有静态检查器）
- scripts/test.sh（静态 tier 接入）
- orchestration/manager-loop-tick.md（§4 失效表标注"已机械检出"）
- tasks/gap-manager-instrument-failures-need-mechanical-detection-not-carefulness.md（自身文件）
- tasks/gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close.md（交叉标注——同族：
  本任务「散文规则被证无效、需机械检出」的同一缺陷族；那任务把「仪器无法区分相反状态」的
  ended-vs-running 方向交给 `plugin/scripts/inner-panel-stale-check.ts` 机械检出，非散文）

## Dispatch review

reviewer: none
at: 2026-08-07T02:1xZ
changed: 管理者 2026-08-07 转达（第三件：自己整晚记录却从未真正转出的执行缺口）。外层裁定立案：
  7 次复发 + 五族成文仍失效 + AC8 形态已定义 = 散文规则被证无效，需机械检出。管理者不能自写检查器
  （角色边界），交 inner 实现。
