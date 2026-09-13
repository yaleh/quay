---
id: gap-driver-cli-help-hides-four-of-six-kinds
title: driver CLI 的帮助文本只暴露 2 个 kind 而实际支持 6 个 —— 三处说法互不一致，四个 kind 在产品表层等于不存在
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-13 实测，三处读数互不一致）**：

```
packages/quay/src/cli/driver.ts:33   export const KINDS = ["promotion","worker","outer","quality","meta","goal"]   ← 6 个
packages/quay/src/cli/driver.ts:71   --kind <promotion|worker|outer|quality>                                        ← 4 个
packages/quay/src/cli/help.ts:53     --kind <promotion|worker>                                                      ← 2 个
packages/quay/src/cli/help.ts:324    --kind <promotion|worker>                                                      ← 2 个
```

**功能是全的**——实测 `quay driver status --kind goal` 正常返回真实状态：

```
goal-driver: kind=goal · supervisor pid=1796022 alive=1 · driver pid=1147154 alive=1 ·
carrier_path=/home/yale/work/quay/.quay/goal-round.jsonl · carrier_records=5707
```

⇒ **缺的不是能力，是产品表层的可发现性**。而 `help.ts` 那份是**用户与 agent 唯一看得到的**——`quay driver --help` 实跑打印的正是 `<promotion|worker>`。

**代价是可量化的（⛔ 不是洁癖）**：ad-arm1 的 archguard 自 2026-09-12 被接管以来，**只跑 promotion + worker 两个 kind**，其余四个从未被启动过；直到人 2026-09-13 裁定「所有 driver 都应作为产品化的一部分分发，并在目标项目开发过程中实际运行」才被发现。**六个 driver 的实现早就全部在交付物里**（实测 ad-arm1 安装包内 `dist/{promotion,worker,outer,quality,meta}-driver.js` + `quality-gate-driver.js` 六个齐全）——**分发做到了，暴露没做到。**

**期望**：帮助文本与 `KINDS` **同源派生**，⛔ 不是把 6 个 kind 再手抄进两个文件——那只是把今天的三处不一致变成明天的三处不一致。

## Plan

1. **先取直接量**：打印全部出现 driver kind 列表的位置及其实际取值（⛔ 不只报数量）。
2. **定唯一真源**：`KINDS` 作为唯一来源，帮助文本由它派生。
3. **核实 outer 的去留**：`outer` 在 `KINDS` 中，但 CLAUDE.md 记载它已于 2026-09-04 作为独立会话角色退役，本机实测 outer 进程数 = 0。⇒ 决定它是否应留在面向用户的 kind 列表中，并给出理由（⛔ 不要默认照搬）。
4. **负控制**：往 `KINDS` 增删一个 kind ⇒ 帮助输出必须随之变化，⛔ 无需手改帮助文本。

## Acceptance Criteria

- [ ] AC1 单一真源能取假：临时往 `KINDS` 加一个假 kind ⇒ `quay driver --help` 的输出**必须**出现它；移除后消失。两态输出贴出。
- [ ] AC2 三处一致：`driver.ts` 与 `help.ts` 中不再存在独立手写的 kind 列表——打印 grep 命中数**并贴出命中内容**（⛔ 计数不贴内容不算，硬规则 2）。
- [ ] AC3 实跑一致：`quay driver --help` 的实际输出所列 kind 集合 == `KINDS`（贴出两者与差集）。
- [ ] AC4 outer 处置有据：给出 outer 去留的决定与理由；若保留，说明用户该在什么场景用它；若移除，说明 `KINDS` 与 drivers.yml 的一致性如何维持。

## Definition of Done

- 四条 AC 满足，AC1 的两态输出有实际留档。
- ⛔ 不得通过「把 6 个 kind 手抄进 help.ts」来满足 AC3——那会让 AC1/AC2 红。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- packages/quay/src/cli/driver.ts
- packages/quay/src/cli/help.ts
- packages/quay/test/cli.test.mjs
- tasks/gap-driver-cli-help-hides-four-of-six-kinds.md
