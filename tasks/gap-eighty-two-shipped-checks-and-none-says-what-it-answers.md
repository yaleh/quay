---
id: gap-eighty-two-shipped-checks-and-none-says-what-it-answers
title: 82 scripts ship and not one declares what question it makes askable —
  capability is not missing, visibility is
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

来源：`orchestration/SPEC-methodology-as-a-deliverable.md`（**人 2026-08-04 的方向裁定**）。
人的原话：**事件落盘 + 零触发报告显然是软件工程方法层的改进，
而 quay 应当交付更多工程方法层的能力，以支持应用 quay 的项目更好地开发。**

### 实测（管理者量，外层复核，按**产物**口径而非全仓）

| | 管理者 | 外层复核 |
|---|---|---|
| 产物内脚本数 | 80 | **82**（**今天一天新增 8 个**） |
| 判据检查 / 资源闸 / 度量 / 观测 | 36 / 10 / 4 / 3 | — |
| **归不进任何类** | **27** | — |
| README 里 `methodology` | 3 次（顺带提及） | 2 次（计数单位差异，结论同） |
| **声明「自己让什么问题可被提问」的脚本** | — | **0** |

**27 是真问题**：按文件名粗分就有 27 个归不进任何类，
**因为产物从来没有声明过自己的分类**。

**⇒ 能力不缺，可见性缺。**
**一个装了 quay 的项目拿到了 36 个检查，却没有任何东西告诉它这些检查各自回答什么问题。**

### 外层补一条自我指涉的观察

**今天一天，产物新增了 8 个脚本**（`assert-clean-tree.sh` + `checker-mutation-cases/` 下 7 个）。
今晚新增的 `loop-driver-check.sh` **头注释写得很好**——说清了机制与立案任务——
**但仍然没有那个机器可读字段**。

**⇒ 「不要先写更多 checker」这条指令，已经被我们自己的速度跑赢了。**
**⇒ AC1 的字段必须在脚本进入产物的那一刻被机械要求**，
否则 27 会在可见性建立之前继续长大——**这正是本仓已有的 ratchet 形态**。

### 组织原则（人的裁定，也是筛选判据）

> **一个能力 = 让一个原本不可机械提问的问题，变得可提问。**

今晚四个仪器提案都是这个形状：

| 仪器 | 它让什么问题变得可问 |
|---|---|
| 事件落盘 | **这个机制响过吗？** |
| 名实一致检查 | **我们是不是又造了一遍已有抽象？** |
| 守卫移除测试 | **这个守卫真的在生效吗？** |
| 规则跨介质清单 | **这条规则还适用在哪里？** |

**⇒ 这既是组织原则，也是筛选判据：
一个不对应任何问题的 checker 不是能力，是本仓的 lint。**

## Contract

```
measure declared_questions = `bash plugin/scripts/capability-catalog.sh --json | jq '[.[]|select(.question)]|length'` 声明了问题的检查数字段
measure shipped_checks = `ls plugin/scripts/*.{sh,ts,mjs} 2>/dev/null | wc -l` 产物内脚本数字段
measure unclassified = `bash plugin/scripts/capability-catalog.sh --json | jq '[.[]|select(.question==null)]|length'` 归不进任何类的数字段
band unclassified = 0
invariant 一个能力等于让一个原本不可机械提问的问题变得可提问；不对应任何问题的不是能力
invoke `bash plugin/scripts/capability-catalog.sh`
control 随机抽 5 个交付的检查问它回答什么问题 ⇒ 答不出来的必须被筛掉或被声明为待筛
resume 先建目录与字段，再筛选，最后才新增能力
```

## Chosen mechanism

**AC1–AC5 逐条落地，顺序不可颠倒（先目录、后筛选、最后才新增）：**

1. **AC1 先目录后新增**：每个交付的检查**声明它让什么问题可被提问**——
   **一行机器可读字段，不是 README 小节**（**README 会漂**）；
   并有一个命令能列出「你装到了什么、各自回答什么」。
2. **AC2 筛选**：对 82 个脚本跑一次与 `runtime-usage-inventory` **同款**的分类。
   **判据：这个能力是否只有本仓历史才 motivate 它？**
   `codex-stage1-selfcheck`、`it0-enforcement-with-design-check`、`audit-independence-check`
   这类 **exp5 遗产不该随产物进每个目标项目**（外层已复核：三者**当前都在出厂**）。
3. **AC3 第一个新增**：**事件落盘 + 零触发报告**。
   **它同时是收缩相的机制**——**是唯一一个会主动产出「删掉它」的能力**。
4. **AC4 收窄纯读契约**：从「**不许写任何文件**」收窄为「**不许写被观测者的状态**」。
   **写事件日志不改变被观测对象的状态空间**，和 `--report` 不许写文件**不是同一件事**；
   **现行契约让「从没响过」无法被查询**。
5. **AC5 负控制**：目录建好后**随机抽 5 个**交付的检查，问它回答什么问题；
   **答不出来的，就是 AC2 该筛掉的**。

**明确不做（人的原话）**：**不要先写更多 checker。**
36 个已经在那里而没人知道它们回答什么，
**在可见性建立之前新增能力，只会让 27 这个数字变大。**

**外层补充的不做**：不把「声明字段」做成可选的注释约定——
**可选的约定等于没有约定**，今天新增的 8 个脚本就是证据；
不在 AC1 完成前动 AC3（**事件落盘本身也要有它的声明字段**，否则它成为第 83 个无声明脚本）。

**交叉标注（2026-08-08, gap-capability-catalog-declarations-not-enforced-at-script-creation）**：
AC1c 的「新脚本进入产物必须带声明字段」入口闸此前只在全量验证轮强制——scoped 静态层
（`select-static-checks-for-touches`）不选它，所以一个创建 `plugin/scripts/*` 新文件的任务
scoped 绿、catalog 到 fan-in 才红（本会话两波 14 个脚本未声明进入产物即此因）。该 gap 任务
把 capability-catalog 加进 scoped 静态层：任务 `## Touches` 含 `plugin/scripts/*` 新建文件
（`(new)` 标注或 git 未跟踪）⇒ scoped 跑含本 catalog 的 AC1c 检查，未声明的新脚本在创建时
即红。

## Acceptance Criteria

- [x] AC1a: **机器可读字段**——每个交付检查一行声明「它让什么问题可被提问」，
      **字段在脚本内，不在 README**（实跑输出贴任务体）
- [x] AC1b: **列举命令**——一条命令列出「装到了什么、各自回答什么」（实跑输出贴任务体）
- [x] AC1c: **入口处机械要求**——新脚本进入产物时**必须带该字段**，
      **否则拒绝**（负控制：造一个无字段的脚本 ⇒ 必须报出）。
      **这条是防 27 继续长大的唯一机制**
- [x] AC2: **筛选实跑**——对 82 个脚本按「是否只有本仓历史才 motivate 它」分类，
      **三个已点名的 exp5 遗产必须被判为不随产物出厂**（实跑输出贴任务体）
- [x] AC3: **第一个新增是事件落盘 + 零触发报告**，**且它自己带声明字段**
- [x] AC4: **纯读契约收窄**——契约文本从「不许写任何文件」改为「不许写被观测者的状态」，
      **并说明它与 `--report` 不许写文件的区别**；
      **负控制：写入被观测者状态的行为必须仍被拒绝**（实跑贴出）
- [x] AC5: **负控制（目录是否真的有内容）**——随机抽 **5 个**交付检查问它回答什么问题；
      **答不出来的逐个列出并进入 AC2 的筛选清单**。
      **这条不过，AC1 不算数**——**一个每条都写着「检查正确性」的目录，与没有目录不可区分**
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC1c 与 AC5 的实跑输出都贴进任务体
- [x] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [x] 任务体记录：**能力不缺，可见性缺**；
      并记录自我指涉的那条——**今天一天产物新增 8 个脚本，无一带声明字段**，
      **「不要先写更多 checker」这条指令已经被我们自己的速度跑赢了**

### invoke 实跑证据（task-contract-check 消费者）

Contract `invoke` 入口路径 **`plugin/scripts/capability-catalog.sh`**（目录生产入口；
本段展示在 `## Contract` 块之外，供 task-contract-check 的 invoke-evidence 检查消费）。

`scripts/test.sh plugin/test/capability-catalog.test.mjs` →
ℹ tests 8 / pass 8 / fail 0 / cancelled 0。

## Touches

- plugin/scripts/capability-catalog.sh
- plugin/scripts/quay-init.sh
- README.md
- plugin/test/capability-catalog.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T00:50:00Z
changed: 人的方向裁定经管理者转达。**外层按产物口径复核**（`plugin/scripts/`，
**不是全仓**——今晚已因口径错过一次），结果与管理者一致，三处需写明：
**其一，是 82 不是 80，且今天一天新增 8 个**——**这个差额本身就是论据**：
产物在以每天 8 个的速度增长，而**声明字段数是 0**（外层精确实测）。
**其二，README `methodology` 外层量得 2 次、管理者 3 次，是计数单位差异，不是分歧**，
结论相同（全是顺带提及）。
**其三，三个点名的 exp5 遗产外层逐个查过，当前都在出厂**。
**外层补了一条自我指涉的观察并把它变成 AC1c**：
今晚新增的 `loop-driver-check.sh` **头注释写得很好却仍然没有机器可读字段**
⇒ **「不要先写更多 checker」已被我们自己的速度跑赢**
⇒ **字段必须在脚本进入产物的那一刻被机械要求**，否则 27 会在可见性建立之前继续长大。
**AC5 是人给的负控制，外层给它加了失败条件**：
**一个每条都写着「检查正确性」的目录，与没有目录不可区分**——
答得出来但答得空洞，与答不出来同样要进筛选清单。
**人的组织原则原样保留为筛选判据**：
**一个不对应任何问题的 checker 不是能力，是本仓的 lint。**
