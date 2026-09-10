---
id: gap-git-graph-row-key-collides-on-multiclaimed-commits
title: git-history 行号以 hash/laneId 为键而同一提交被多条 lane 重复认领（774 条中 497 条重复）⇒
  后写覆盖先写、61 对文字压在同一 y；前task 的重叠不变式全部由 fixture 满足，生产形状从未进过 fixture
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（2026-09-08 用 Playwright MCP 对生产实例 `/git-history` 实测 DOM，非目测）**：
折叠分支的摘要文字互相压字，肉眼读到的是 `develop · 5̶1̶ commits · 1̶0̶8̶m（点击展开）` 这样两串字叠印的糊团；
图上同时存在成片的空白行。

**取证（对真实页面的 98 个 `<text>` 两两求 bbox 交集）**：

- **61 对**文字元素落在同一 y 且 x 区间相交。样本：`develop · 51 commits · 9h（点击展开）` 与
  `develop · 44 commits · 7h（点击展开）` 与 `develop · 40 commits · 53m…` **三条同在 y=1786**；
  另一簇三条同在 y=1734。

**根因（读数据模型，不是猜）**：`packages/quay/src/serve-git.ts:348` 一行——

    items.forEach(function (it, i) { if (it.hash) { rowOf[it.hash] = i; } else { summaryRow[it.laneId] = i; } });

`items` 里每一项都拿到了**唯一**的行号 `i`，但落库时以 `hash` / `laneId` 为**键**。而同一页真实数据里：

- lane 提交总数 **774**，其中 **497 条（64.2%）被多于一条 lane 重复认领**（唯一 hash 仅 277 个）；
- 28 条 lane 里有 **3 个 laneId 重复**（`fork::merge` 组合相同）。

⇒ 重复键上后写覆盖先写，两个不同的 item 读回**同一个 y** ⇒ 压字；被覆盖掉的那个行号成为**没有任何元素占用
的空行** ⇒ 图上的成片空白。两个症状同一个根。

**为什么 `gap-git-history-lane-identity-and-row-layout-overlap`（done）没有闸住它**：该任务 AC4 逐字是
「把 fixture 中每条分支都设为展开态，断言不存在两个不同的行被分配到同一个 y 坐标」——**它的 10 条 AC 全部
以自造 fixture 为输入，而 fixture 里没有一条提交被两条 lane 同时认领**。在那种形状下 `rowOf[hash]` 天然
不碰撞，判据**结构上不可能取假**（CLAUDE.md 硬规则 4 推论三：只能被 fixture 满足的判据不是测量；
硬规则 4：恒真的读数携带零信息）。所以这不是「同一缺陷复发」，而是**判据的输入形状从未覆盖生产形状**——
本任务必须把判据挪到生产载体上。

**修法方向（两处，缺一不可）**：

1. **让行号成为 item 的属性而不是查表结果**——渲染时直接遍历 `items` 用其下标 `i` 作 y，节点/文字随 item 走；
   若确需按 hash 反查，键必须是 `(laneId, hash)` 复合键或 item 序号，不能是裸 hash。
2. **让 lane 抽取排他**——一条提交只能属于一条 lane（先到先得或按 fork 时间最近者），否则同一提交在多条 lane
   上各画一个节点本身就是错的图，而不只是排版问题。

## Acceptance Criteria

- [x] AC1 生产载体读数（不是 fixture）：对运行中的实例加载 `/git-history`，在页面上下文执行「对全部
      `svg text` 两两求 bbox 交集」的统计，断言**重叠对数 == 0**。取假：改动前同一段脚本实测为 **61**。
- [x] AC2 生产载体读数：对同一页面的 `#git-graph-data` JSON 断言「全部 lane 提交的 hash 去重后条数
      == 总条数」（即无跨 lane 重复认领）。取假：改动前实测 `774 总 / 277 唯一`，重复 497。
- [x] AC3 生产载体读数：断言 `branches` 的 `id` 去重后条数 == `branches.length`。取假：改动前 28 条里
      有 3 个重复 id。
- [x] AC4 判据对生产形状能取假（负控制，回答上文「fixture 恒真」那一条）：新测试构造一个**含跨 lane 重复
      提交**的 fixture（这正是旧 fixture 缺的形状），断言旧式 `rowOf[hash]` 写法在它上面**报红**、新写法报绿。
      两侧都断言。
- [x] AC5 空行不变式：断言渲染出的行号集合是 `[0, items.length)` 的**连续**整数且每个行号恰有 ≥1 个元素占用
      （无被覆盖产生的空行），断言失败时打印空行号清单而非布尔。
- [x] AC6 `bash scripts/test.sh --for-task gap-git-graph-row-key-collides-on-multiclaimed-commits` 退出码 0。

## Definition of Done

在**真实运行的实例**上加载 `/git-history`，AC1/AC2/AC3 三个统计脚本的实测输出（0 / 无重复 / 无重复）
连同改动前的对照读数（61 / 497 / 3）一并贴进提交信息；并附一张改动后的截图，图上不再有叠印文字与成片空行。
**新增 fixture 测试通过不构成达成**——旧任务正是靠 fixture 判绿而生产始终为红。

## Touches

- `packages/quay/src/serve-git.ts`
- `packages/quay/test/gap-git-graph-row-key-collides-on-multiclaimed-commits.test.mjs`
- `tasks/gap-git-graph-row-key-collides-on-multiclaimed-commits.md`
