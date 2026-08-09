---
id: gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools
title: "plugin/scripts/ has 57 .sh files (107 total incl. .ts) with ZERO uniform CLI convention —
  --help behaves differently in every one tested tonight: dead-loop-check.sh silently ignores it
  and runs normal logic, prefriction-count.sh treats it as a --since git-revision value, axis-
  generator.ts requires node --experimental-strip-types (bare bash execution fails on the first
  comment line), supervisor-deliver.sh treats it as the payload text to deliver, session-bootstrap.sh
  falls through to printing its own shebang line — this is not a cosmetic gap: it directly produced
  tonight's real mistakes (the manager guessed wrong invocation forms multiple times before finding
  correct usage in each script's own header comments, because there is no queryable, uniform
  interface); orchestration/SPEC-manager-productization-2026-08-05.md and SPEC-state-crystallization
  -2026-08-05.md already establish the right framework (名词进代码/动词留文本 — facts crystallize
  into structured single-writer state, rules stay as prose, per §2 of state-crystallization; manager
  must consume via capability-catalog.sh not hand-roll, per §5 of manager-productization) but neither
  addresses INTERFACE consistency across the 57+ existing crystallized tools themselves; manager
  2026-08-06, filed per human direction ('即使是这些 .sh 也依然太散，应进一步结晶')"
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**已经结晶的 57 个 `.sh` 工具，彼此之间的调用界面完全不统一——"结晶"解决了"能力存不存在"，
没解决"界面一不一致"。**

### 实测（5 个工具，5 种 `--help` 行为，全部真跑）

```
$ bash plugin/scripts/dead-loop-check.sh --help
dead-loop-check.sh — L2 持续健康判据：循环【在转】，不只是【装了】   ← 忽略 --help，正常跑
$ bash plugin/scripts/prefriction-count.sh --help
prefriction-count.sh: --help is not a git working ...              ← 当成 --since 的值来解析，报错
$ bash plugin/scripts/axis-generator.ts --help
axis-generator.ts: line 2: //: Is a directory                       ← 需要 node，裸 bash 直接跑就崩
$ bash plugin/scripts/supervisor-deliver.sh --help
supervisor-deliver: 文本为空                                          ← 把 --help 当成 payload 参数
$ bash plugin/scripts/session-bootstrap.sh --help
!/usr/bin/env bash                                                   ← 落到打印自己的 shebang 行
```

**五个工具，五种完全不同的行为，没有一个是"打印用法说明"。**

### 这不是美观问题——今晚的真实代价

管理者今晚**至少 4 次**猜错某个工具的调用形式，最终靠翻脚本自己的头注（不是 `--help`）才拼对：
`supervisor-deliver.sh` 的 `--root` 参数、`session-bootstrap.sh` 的 layout token 顺序、
`prefriction-count.sh --json` 的字段结构、`send-keys-reliable.sh` 的三参数位置。
**每一次都要先读一遍源码注释，因为没有一个统一的"问它自己怎么用"的方式。**

### 已有的框架能覆盖多少，缺口在哪

`SPEC-state-crystallization-2026-08-05.md` §2 的"名词进代码，动词留文本"，回答的是
**"这个东西该不该被结晶成机器可读的状态"**——已经解决。
`SPEC-manager-productization-2026-08-05.md` §5 的"manager 不造轮子"，回答的是
**"manager 该不该自己写新脚本"**——也已经解决（今晚的另一条任务在跟进）。

**两份规格都没回答**："57 个已经结晶好的工具，彼此的调用方式该不该一致"。
这是下一层缺口：**结晶解决了"有没有"，没解决"好不好用/好不好记"。**

### 选定机制（方向，接法留执行时）

不预设"重写全部 57 个脚本"——那个代价可能远大于收益，且违反本仓"不预设具体实现"的一贯纪律。
两条更克制的候选，接法留执行时判断：

1. **最小公分母**：所有工具至少统一支持 `--help`（哪怕只是打印一行用法），
   `capability-catalog.sh` 已经有"这个工具回答什么问题"的描述，`--help` 至少不应该比
   胡乱猜参数更差；
2. **共享一个入口壳**：类似 `git <subcommand>` 的形态，一个 `quay-tool <name> [args]` 分发器，
   统一处理 `--help`/参数解析框架，各工具的业务逻辑不变，只是接入点统一。

**任务体必须记录选了哪条、为什么**，不能悬空。

## Contract

```
measure help_flag_consistent = `for f in plugin/scripts/*.sh; do timeout 5 bash "$f" --help 2>&1 | head -1; done | grep -ci "usage\|用法"` stdout 的数字段（分子/57）
band help_flag_consistent = 不预设固定阈值（基线未知，需先测全量再定目标，参照 gap-suite-cost-model-is-wrong 的教训）；但改动前后必须报出对比数字
invariant 任何被 capability-catalog.sh 收录的工具，其 --help（或等价的用法查询方式）不得产生业务逻辑副作用（不得像 supervisor-deliver.sh 那样把 --help 当成真实 payload 执行）
invoke `for f in plugin/scripts/*.sh; do timeout 5 bash "$f" --help 2>&1 | head -1; done`
control 挑一个当前会把 --help 当业务参数执行的工具（如 supervisor-deliver.sh），改完后 --help 必须不产生任何真实副作用（不发送、不修改状态），且输出用法说明
resume 若中断，先跑 measure 读当前基线，不要假设已经统一
```

## Acceptance Criteria

- [ ] AC1: 全量测出当前 57 个 `.sh` 工具的 `--help` 行为基线，贴出完整实跑输出（不是抽样）
- [ ] AC2: 选定机制并记录理由（最小公分母 vs 共享入口壳），不得留空
- [ ] AC3: **负控制（承重条）**——`supervisor-deliver.sh --help` 修复后不得触发任何真实送达尝试
      （当前行为是尝试把 "--help" 当 payload 发出去，这本身是一个真实的安全隐患：
      误触发 --help 会真的往目标会话发消息）
- [ ] AC4: 至少覆盖本任务实测到的 5 个工具（dead-loop-check / prefriction-count / axis-generator /
      supervisor-deliver / session-bootstrap），改前/改后行为对照
- [ ] AC5: 与 `gap-manager-skill-missing-mandatory-tool-reuse-checklist` 交叉标注——那条解决
      "该不该去查目录"，本任务解决"查到了之后好不好正确调用"，两者互补

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## 交叉标注（AC5 族，2026-08-08 由 gap-shipped-artifact-carries-86-loose-shell-scripts 追加）

> **本条 ≠ gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form（分界）**：
> 本条问「这些 `.sh` 的 `--help`/调用界面一不一致」——**界面一致性**，作用域是仓库内 57 个工具；
> 那条问「86 个散件是不是正确的交付形态」——**交付形态**，作用域是交付产物。两条正交：即使本条把
> 57 个 `--help` 全部统一，消费者仍然收到 86 个独立 shell 入口；反之即使那条把交付面收敛成
> 「少数入口 + 内部件不外露」，本条要修的 `--help` 不一致仍然存在。**不要合并，也不互相替代。**
>
> 协同：本条 AC2 的候选方案 2「共享入口壳 `quay-tool <name>`」与那条选定的「少数入口」收敛方向
> 是同一个机制的两面——那条把真实被调用的工具收进 `quay-tool <name>` 分发器并声明为
> `capability-catalog.sh` 的 `PUBLIC_ENTRYPOINTS`，本条把分发器统一处理 `--help`/参数解析。若本条
> 选该方案，直接消费那条声明的公开入口集作为被分发工具；若选「最小公分母」，则逐工具在源码上补
> `--help`，交付面保持散件但界面一致（那条的 AC3 负控制条仍会把它标记为内部件不该被消费者直调）。

## Touches
- plugin/scripts/*.sh（57 个文件，具体改动范围由 AC2 选定机制决定）
- plugin/scripts/capability-catalog.sh
- tasks/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact.md（AC5 交叉标注：那条管 `.ts`
  的交付形态——bundle 成 42 个可执行入口、删 80 个 raw `.ts`；本条管 `.sh` 的界面一致性。两者都是
  「交付面结晶程度不够」的实例，且本条若选「共享入口壳 `quay-tool <name>`」方案，将直接消费那条
  bundled 出的 `plugin/scripts/dist/*.js` 作为被分发的工具）
- tasks/gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form.md（分界交叉标注，见上）

## Dispatch review

reviewer: none
at: 2026-08-06T16:1xZ
changed: 尚未派发/审阅（人直接裁定立案并转外层，管理者代笔）
