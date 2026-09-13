---
id: gap-driver-cli-help-hides-four-of-six-kinds
title: driver CLI 的帮助文本只暴露 2 个 kind 而实际支持 6 个 —— 三处说法互不一致，四个 kind 在产品表层等于不存在
status: done
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

- [x] AC1 单一真源能取假：临时往 `KINDS` 加一个假 kind ⇒ `quay driver --help` 的输出**必须**出现它；移除后消失。两态输出贴出。
  - 实测手段：`driver-vocab.ts` 的 KINDS 末尾临时插入 `"fakekind"`，⛔ 未触碰任何帮助文本。
  - 态 A（KINDS 6 值）：`quay driver --help` → `--kind <promotion|worker|outer|quality|meta|goal>`；`quay --help` → `quay driver <start|stop|drain|resume|status|restart> --kind <promotion|worker|outer|quality|meta|goal> [--root <path>]`
  - 态 B（KINDS 7 值）：两处同步变为 `…|goal|fakekind`（用法行与 `--kind` 旗标说明各一处）
  - 还原：写入前 sha256 `f72612f0a39d8152acb04399739fce1c53fcfdb77180e17419bc955e896065d5`，还原后同一 sha（逐字节复原，两态可切换、非单向）
- [x] AC2 三处一致：`driver.ts` 与 `help.ts` 中不再存在独立手写的 kind 列表——打印 grep 命中数**并贴出命中内容**（⛔ 计数不贴内容不算）。
  - 谓词 `--kind <([a-z-]+\|[a-z|-]+)>`：driver.ts **3 → 0**，help.ts **3 → 0**
  - 谓词 `quay driver <([a-z|]+)>`：driver.ts **2 → 0**，help.ts **2 → 0**
  - 零计数的对照半边（硬规则 2：零计数要把谓词对**已知为真**的样本干跑一次）：同一谓词对 HEAD 的同名文件命中 5 条/文件，内容为
    `driver.ts:1 … --kind <promotion|worker>`、`driver.ts:71 … --kind <promotion|worker|outer|quality>`、`driver.ts:86 … --kind <promotion|worker|outer|quality>`、`help.ts:53/324/339 … --kind <promotion|worker>`；verb 侧 `driver.ts:1`、`help.ts:53` 另漏 `resume`
  - ⛔ 不是"把 6 个抄进去"：词表移入**零依赖叶模块** `packages/quay/src/cli/driver-vocab.ts`（单一来源），driver.ts import + 再导出，两处帮助文本全部改为 `${…join("|")}` 插值
  - 附带落地：`enum-surface-parity-check.ts` 的 4 个面（`cli-driver-kinds` / `cli-driver-help-kind` / `cli-help-kind` / `cli-help-driver-usage-verbs` / `cli-driver-usage-verbs`）随之改判为 `[derived]`，台账 14 条 → 6 条
- [x] AC3 实跑一致：`quay driver --help` 的实际输出所列 kind 集合 == `KINDS`（贴出两者与差集）。
  - help kind set：`["promotion","worker","outer","quality","meta","goal"]`；`KINDS` 同；kind diff `{"extra(help-only)":[],"missing(KINDS-only)":[]}`
  - help verb set：`["start","stop","drain","resume","status","restart"]`；`VERBS` 同；verb diff 两向皆空；逐值同序相等 = true
  - 常驻回归（⛔ 一次性手工读数不算）：`packages/quay/test/cli.test.mjs` 新增 block29 —— 对 `quay --help` / `quay driver --help` / `quay driver -h` 三个入口断言「driver 用法行的 verb/kind 槽位逐值同序 == driver-vocab 的 VERBS/KINDS」（driver 块内每一处 `--kind <…>` 都断言），另断言两文件 0 处手抄副本；18 断言全绿
- [x] AC4 outer 处置有据：给出 outer 去留的决定与理由；若保留，说明用户该在什么场景用它。
  - **决定：保留**（⛔ 任务前提「本机实测 outer 进程数 = 0」已被实测证否）。
  - 理由：①直测（2026-09-13，主检出）`outer-driver`: supervisor pid=966808 / driver pid=966885 **alive=1**、载体 `.quay/outer-round.jsonl` **2294** 条、末条 `2026-09-13T04:43:07Z`（测量当刻仍在写）；②kernel `DRIVER_KINDS.outer` 注册完整（driver `outer-driver.ts`、prefix `outer-driver`、carriers `outer-round.jsonl`、controlFile `outer-control.json`、6 个 verb）；③`plugin/scripts/drivers.yml` 声明 `outer`（interval_ms），`start-drivers.ts` 拉起的 4 个 kind 里也有它；④CLAUDE.md 2026-09-04 退役的是 **outer【独立会话角色】**（`gap-retire-outer-tmux-window-logic`，职能并入 manager 直接 subagent 派发），而 `outer` **driver kind**（AC143）恰是把 outer 执行核的纯机械 A/B 段（A1/A6/A9/A10/A18/A21 读数、B1/B2/B6 收尾、B12/B17 自查）结晶成的常驻进程——起因正是「靠会话每轮记得调」会随换会话/换模型丢失 ⇒ 二者是**取代关系，⛔ 不是同一个东西**。
  - 用户何时用它：任何跑 quay loop 的工作区，若要把上述机械例程读数常驻写入 `.quay/outer-round.jsonl` 供 manager/语义层消费 ⇒ `quay driver start|status --kind outer`。
  - 若将来要移除的一致性维持：`KINDS` 是 kernel `DRIVER_KINDS` 的**镜像**、⛔ 不是新事实来源——一致性由 ①`enum-surface-parity-check` 的 `cli-driver-kinds` 面（policy exact，逐值比对 kernel）②`goal-driver.test.mjs` AC6（两集合相等）机械守着 ⇒ 一个 kind 只能随 kernel 表（及 drivers.yml）一起进出 KINDS，⛔ 不能只改 KINDS。
  - 附带发现（⛔ 不在本任务范围，留作独立立案）：`start-drivers.ts` 只拉起 4 个 kind（promotion/worker/outer/goal），缺 quality/meta——检查器台账里已登记的独立漂移。

## Definition of Done

- 四条 AC 满足，AC1 的两态输出有实际留档。
- ⛔ 不得通过「把 6 个 kind 手抄进 help.ts」来满足 AC3——那会让 AC1/AC2 红。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- packages/quay/src/cli/driver.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/cli/driver-vocab.ts
- packages/quay/test/cli.test.mjs
- plugin/scripts/enum-surface-parity-check.ts
- plugin/test/enum-surface-parity-check.test.mjs
- tasks/gap-driver-cli-help-hides-four-of-six-kinds.md
