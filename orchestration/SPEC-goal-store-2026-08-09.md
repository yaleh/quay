# 规格:阶段目标与 AC 是第三个 sibling kind(goal-store)

**日期**:2026-08-09(管理者)
**触发**:人「阶段性目标和 AC 另建机制…不过这些信息我希望在 web 也可见」;
随后否掉了我把它塞进 document-store 的提议——「METHOD ARTIFACT 显然和阶段目标/AC 是不一样的」。
**定义者**:管理者。**实现者**:quay 外层 + 内层。**AC/DoD 与立案由外层判断。**

---

## 0. 先说清楚这不是发明,是既定模式的第三次应用

`packages/quay/src/frontmatter-store-base.ts` 头部原文:

> Factored out of adr-store.js so a **NEW sibling kind** (document-store.js) can reuse the same
> parse/serialize/lockfile/filename-resolution mechanics **WITHOUT coupling the two kinds' schemas**
> together — each store still owns its own frontmatter keys, valid-status set, and view-model shape.
> … **shared MECHANICS, independent SCHEMAS.**

已有两次应用:

```
adr-store.ts        VALID_ADR_STATUSES      = proposed / accepted / superseded / …
document-store.ts   VALID_DOCUMENT_STATUSES = draft / active / retired
```

**本规格要的是第三次。**

## 1. 为什么现有三种都不对(逐条,不是品味)

| 候选载体 | 为什么不对 |
|---|---|
| **task store** | 人的原话:「task 内部也有 AC。再给 task 增加个 AC tag,显然是混乱的」——`## Acceptance Criteria` 已经是 task 的既有语义,**同一个词在同一个 store 里指两件事**。附带问题:16 条记录污染派发池与 `dispatchable_disjoint`,而现有排除形态(`label:fixture` / `**PARKED`)都语义错位 |
| **ADR store** | ADR 是**决策**(proposed→accepted→superseded);阶段 AC 不是决策,它会**达成**。且 frontmatter 无可跑判据字段,`gate-events.jsonl` 里 `ADR-` 只出现 1 次 |
| **document store** | 头部明写是 **METHOD ARTIFACT**(skill / 方法文档 / 模板)。**skill 不会"达成",AC 会。** 且 `contracts` 是 grep/not-grep **对文档自身正文、in-process、不 shell-out**(`gate/factories/document-contract.ts` 注释),表达不了 `git rev-list --count integration..develop` 这类判据 |

**⇒ 三种都要说谎才装得下。我自己先犯过一次:否掉 `label:fixture` 的语义谎之后,转头提议 `kind: methodology`——同一个谎换了个盒子,已撤回。**

## 2. Schema(本 kind 独有的部分)

```yaml
id: GOAL-001            # 或 AC-028；编号方案由实现者定，需与 ADR-/DOC- 同族可辨
title: 经验能在层间流动
kind: goal | criterion  # 目标 / 判据；一个 goal 可有多条 criterion
phase: 2026-08-09-three-layer-unification
status: active | achieved | superseded | retired
criterion: |            # ★ 可跑的 shell 命令；未设 ⇒ gate fail-closed
  git rev-list --count integration..develop
expect: "=0"            # 通过条件
origin: |               # ★ 立条依据——哪次实测造出了它
  2026-08-09 02:15 立案落 develop 当场破坏两线不变式
evidence:               # 最近一次评估
  at: 2026-08-09T07:40:08Z
  verdict: pass
  reading: "0"
```

**四个字段是本 kind 的存在理由,少任何一个就退化成前三种之一**:

1. **`criterion` 是 shell 命令** —— ADR 的 `enforcement`、DOC 的 `contracts` 都表达不了。
   **实测依据**:AC28-35 的 12 条子判据里 7 条已有可跑命令(`wc -l` / `git rev-list` /
   `closure-lag-check.sh --json` / `grep -c`),**而它们今天活在我每轮敲的 bash 里**——
   在 AC 定义文件出现 1 次、在执行核出现 1 次。**判据在跑、跑得对、载体是上下文**,
   与 workflow 静默 21.5 小时同形。
2. **`status` 含 `achieved`** —— 决策不会达成,制品不会达成,**AC 会**。
3. **`phase`** —— 活跃集必须**可推导**。今天 AC1-19 是历史、AC20-35 是活跃,
   而这个划分只存在于散文和我的记忆里。
4. **`origin`** —— **没有立条依据的 AC 是 cargo cult**。今晚每条 AC 都有出处,
   这个属性必须被 schema 强制保留,而不是靠写的人自觉。

## 2b. 「阶段」如何命名 + 两条不变式(人 2026-08-09 08:0xZ 同意后补入)

### 命名:`PHASE-NNN` —— 纯序号,含义在 title,理由是实测的

**目标的文字不稳定**:08-05 人逐字更正(产品化降级为手段)、08-06 换目标、08-09 换目标。
⇒ **任何从目标文字派生的名字都会漂**。我草稿里的 `2026-08-09-three-layer-unification`
两种病都有:日期是"起始日"而边界会被回溯调整,slug 随措辞漂。

**本仓已经答过这个问题三次,答案一致**:`ADR-001..032` / `DOC-001` / `DIR-001..192`
——**全是 `<KIND>-<NNN>`,含义在 `title`,id 永不移动**。今晚我给 ADR-009 加了两次修订、
推翻了它自己的 enforcement 判断,**它的 id 一个字没动**。⇒ `PHASE-NNN` 是第四次沿用。

### 结构:phase 与 goal 合一,不是两种对象

人:「一个阶段应当有一个明确的目标和若干 AC」⇒

```
PHASE-NNN   title = 那一个目标陈述；status；创建它的人裁定原文
AC-NNN      criterion 记录，每条带 phase: PHASE-NNN
```

**PHASE 记录本身【不】有 `criterion` 字段**——它的判据是其 AC 的合取(见不变式 2)。

**最终目的不是阶段目标**:「让这套机制在人不在场时仍能自我演进」跨越阶段而存在,
**不进 store**,留在 `manager-phase-goal.md` 档案里。否则每条 PHASE 都要重复抄一遍。

### 两条不变式(人已同意)

- **I1:同一时刻只能有一条 `status: active` 的 PHASE。**
- **I2:PHASE 达成 ⟺ 其所有活跃 AC 达成 —— 这是【推导】不是【存储】。**

### 历史检验(meta-cc,2026-08-09 08:0xZ):两条都不成立,且根因是结构性的

**物证:`manager-phase-goal.md` 里有【四条】自称"主判据"的 AC**——
`AC10`(08-05「本阶段的主判据」)、`AC12`(08-05「新主判据」)、
`AC20`(08-08「本目标的主判据」)、`AC28`(08-09「本阶段主判据」)。
**四个"本阶段主判据"活在同一个文件里。** 每一条在自己的上下文里都对,
**只是没有任何机制强制前一个阶段关闭。**

**设目标的裁定六次,只加不关**:08-02(12 小时目标)、08-03(促成 AC 清单)、
08-05(目标更正)、**08-06(一次给了【两个】目标:release + 跨机)**、
08-08(outer/inner 驱动机制 ⇒ AC20-27)、08-09(三层统一 ⇒ AC28-35)。
`AC16`(08-06 的目标 1)**至今无任何关闭标记**。

**唯一一次做对的是 08-05**:文件里有一节标题
`## 下阶段（2026-08-05 11:3xZ 立，AC10 降为常设，主判据换成结果量）`
——**显式降级旧主判据 + 明确新主判据**。之后三次全是只加不关。

**I2 历史上从未被评估过**:因为没有阶段被关闭过,「所有活跃 AC 是否全绿」这个判断一次都没发生。

### 落实:根因不是"忘了关",是【开新有触发器、关旧没有】

人的裁定是开新阶段的触发器;关旧阶段没有任何触发器。**只加不关是这个结构的必然结果,
不是纪律问题。** ⇒ 四条设计,第一条是核心:

1. **阶段切换是单次原子写入,fail-closed。** `createPhase` 在已有 active phase 时
   **拒绝创建第二条 active**,除非同一次调用里给出旧 phase 的处置
   (`achieved` 或 `superseded-by: PHASE-NNN`)。**不给处置就写不进去。**
2. **AC 的活跃性【派生自】phase,不单独存储**:`AC.active ⟺ AC.phase.status == active`。
   阶段一关,它的 AC 自动退场。**今天 AC10/AC12/AC16 还在"活跃集"里,
   正是因为活跃性是手工标的。**
3. **「恰好一条 active phase」是一条 checker,进各层 tick 的 A 段。**
   **预演(2026-08-09 08:0xZ):今天一跑必红**——四条自称主判据的 AC 同时存在。
4. **I2 在评估时推导,永不存储** ⇒ 杜绝「阶段标达成而 AC 还红着」。

### 迁移:四个未关闭的阶段,处置归人

机制能**逼出这个问题**,但「AC10/AC12/AC16/AC17/AC20 各自是达成、废止、还是并入当前阶段」
是**目标层面的判断**——人设目标,manager 维护 AC。manager 可按证据给出建议映射,不替人裁。

---

## 3. 机制复用(不新建)

- **读写/锁/文件名**:`frontmatter-store-base.ts`,与 adr-store / document-store 同源。
- **判据执行**:`criterion` 是 shell 命令 ⇒ 复用 **task 的 acceptance-runner 形态**
  (`gate/acceptance-runner`),**不是** document 的 `contracts`(in-process、不 shell-out)。
- **账本**:GateEvent → `.quay/gate-events.jsonl`,与现有 370 条同格式。
  ⇒ **AC 状态第一次有时刻与 verdict 的历史。**
- **fail-closed**:`criterion` 未设 ⇒ 判红。**照抄 `makeDocumentContractGate` 的原则**
  (原注释:*an unenforceable document must never silently PASS*)。
  **这条是本规格的核心价值之一**:AC28(本阶段主判据)当前不可机械判定,
  迁移后会立刻 fail-closed 报红——**那是对的**,它今天被散文盖住了。

## 4. web 可见(人明确要求)

`packages/quay/src/serve-handlers.ts` 现有路由:`/`、`/board`、`/journal`、`/live`、`/adr`。
`grep -c document` = **0** ⇒ **DOC 也还没有路由**。

⇒ 新 kind 的路由与 **`/doc` 路由一并做**,照 `/adr` 的现成形状。
展示要素:目标 / 判据 / status / 最近 verdict 与时刻 / origin。
**「最近 verdict 与时刻」是 web 上最有价值的一列**——它把「这条 AC 现在什么状态」
从"读散文推导"变成"看一眼"。

## 5. 迁移范围与顺序

- **只迁活跃集**(当前 AC20-AC35,16 条);AC1-19 留在 `manager-phase-goal.md` 作历史档案。
- `manager-phase-goal.md` 降级为**理由档案**,由 goal 记录指回它——
  与今晚三份执行核完全同一形状:**执行面短,档案留在原处**。
- **落地前不迁**:在新 kind 与 `/goal` 路由可用之前,AC 继续留在
  `manager-phase-goal.md` 的「活跃 AC 的判据命令」节(已落地,`f69046ae`)。
  **真正的病(命令活在 bash 里)已经治了;剩下的是载体升级,不急于用错的盒子换。**

## 6. 验收判据

| # | 判据 | 怎么核 |
|---|---|---|
| AC1 | 新 kind 复用 `frontmatter-store-base`,不复制其机制 | 读 import |
| AC2 | `criterion` 未设的记录,gate **判红不判绿** | 建一条空 criterion 记录跑 gate |
| AC3 | 一条记录的 gate 执行在 `.quay/gate-events.jsonl` 留下带 `verdict`+`timestamp` 的事件 | 跑一次后 `tail -1` |
| AC4 | 活跃集**可由 `phase` 推导**,不靠手工清单 | 换一个 phase 值,活跃集随之变 |
| AC5 | web 有路由,页面显示最近 verdict 与时刻 | 浏览器/curl |
| AC6 | `origin` 为空的记录**写不进去** | 负控制 |

## 7. 风险

1. **gate 引擎最后一次事件是 2026-08-08T08:22,已空闲 ~24 小时。** 它是能用的
   (370 条带 verdict 的真实事件),但**把 AC 状态挂在一个不跑的机制上,就是今晚第 N 次
   「机制存在 ≠ 机制在跑」**。⇒ **必须同时给 gate 自身加账本检查**
   (最近一次执行时刻 vs 声称周期),否则 AC 会在一个静默的 gate 上集体显绿。
2. **编号方案要一次定死**。AC 编号今天是 `AC20`…`AC35` 的散文序号;
   迁移后若与 `GOAL-001` 双轨,会再造一次「同一件事两个名字」。
3. **本规格的判据来自 n=1 的一晚**,阈值与字段集是待标定值,不是定论。
