---
id: ADR-036
title: 枚举事实的单一真源与表层派生 —— 实现/帮助/Web/文档不得各存一份手抄副本
status: accepted
---
**状态**: Accepted（2026-09-13 落地；机械强制 = `plugin/scripts/enum-surface-parity-check.ts`）
**日期**: 2026-09-13
**触发**: 人 2026-09-13 裁定「所有 driver 都应当作为产品化的一部分分发，并在目标项目开发过程中实际运行」后，执行该裁定当场撞见实现/帮助/Web/文档四面不一致，人追问「当前交付物中还有多少类似的不一致？如何统一？」

<!-- enforcement: plugin/scripts/enum-surface-parity-check.ts -->

---

## 实施记录（2026-09-13 落地，implementation carrier = `gap-enum-surfaces-hand-copied-across-cli-web-docs`）

**规范 4/5 已机械化**：`plugin/scripts/enum-surface-parity-check.ts` 持显式登记表（7 个权威枚举、
25 个表层副本）做两向差集，挂在 `run_static_checks`（每轮全量 gate）上。三态：0 PASS / 1 RED /
3 NOT-EVALUATED（读不出权威或表层时**独立取值**，不与「一致」共用输出）。

**对本文上文的修正（实测）**：

1. driver kind 的**真源不是** `cli/driver.ts:33 KINDS`（上文如此记），而是 kernel 的数据表
   `plugin/scripts/driver-runtime.ts:DRIVER_KINDS` —— respawn 循环、pid/控制态、carrier、per-kind
   动词全部由它驱动（新增一个 kind 的第一处永远是它）。`cli/driver.ts:KINDS`、`driver-config.ts`
   的 kind 联合类型、以及本文上文列的 6 处帮助/文档副本都是它的**表层**。⇒ 真源已按此改判。
2. 两处活漂移已消除：`GOAL_STATUSES`（ABI 少一个 `needs-human`，而 store 接受它且它是最高频 reopen
   来源）补齐并成为**唯一真源**（`goal-store.ts:VALID_GOAL_STATUSES` 改为派生）；`WEB_DRIVER_KINDS` /
   `WEB_DRIVER_VERBS` 保持子集但补上**带理由的代码处豁免**（规范 5）。
3. **规范 2 的「派生化」被检查器识别**（`import` 权威符号 ⇒ 按构造一致），这是比「逐一相等的字面量
   副本」更强的形态：新增一个值只需改权威一处。
4. **本文未涵盖的存量**（范围边界，另行处理）：`CLAUDE.md` / `plugin/skills/drivers/SKILL.md` 的
   driver kind 清单、`cli/driver.ts` 与 `cli/help.ts` 的帮助文本（归 `gap-driver-cli-help-hides-four-of-six-kinds`）、
   `start-drivers.ts` 的 4-kind 列表、quay-native 的 goal_write 描述、`serve-goal.ts` 的排序/筛选项。
   它们**每轮原样报出**在 `KNOWN_DRIFT` 台账里（shrink-only：差集【增长】即 RED，收窄容忍）。

**已知覆盖边界（⛔ 说清没查什么）**：面来自显式登记表而非全仓发现（未登记的候选子集字面量由
`--discover` 段列出，仅供参考、不参与退出码）；生成的打包副本（`plugin/vendor/**`、`*/dist/**`）不登记
（`sync-vendor.sh --check` / plugin-packaging 守 src→vendor 一致性）；测试夹具不是交付面。

## 上下文

quay 的同一个事实（一个枚举集合）常常同时出现在**多个表层**：实现常量、CLI 帮助文本、Web UI 控制面、项目文档（CLAUDE.md / SKILL.md / ADR）。这些副本目前**全部靠手抄维持一致**，没有任何机械强制。

**2026-09-13 实测的漂移现状（枚举，非抽样）**：

driver kind 这一个事实，在交付面有 **7 处副本、4 种取值**：

```
packages/quay/src/cli/driver.ts:33        KINDS = [promotion,worker,outer,quality,meta,goal]   6 个 ← 权威
packages/quay/src/cli/driver.ts:71        --kind <promotion|worker|outer|quality>              4 个
packages/quay/src/cli/help.ts:53          --kind <promotion|worker>                            2 个
packages/quay/src/cli/help.ts:324         --kind <promotion|worker>                            2 个
packages/quay/src/serve-sessions.ts:449   WEB_DRIVER_KINDS = [promotion,worker]                2 个
CLAUDE.md:240                             --kind <promotion|worker>                            2 个
plugin/skills/drivers/SKILL.md:3          "Start the promotion + worker drivers"               2 个
```

**其代价已经兑现，⛔ 不是理论风险**：ad-arm1 的 archguard 自 2026-09-12 被接管起只跑 promotion + worker，其余四个 kind **从未被启动过**——尽管六个实现早已全部在交付物里（实测安装包内 `dist/` 六个 driver 齐全）。**分发做到了，暴露没做到**，而用户与 agent 只看得到帮助文本那一份。

**同类漂移在其它枚举上也已发生**（实测）：

```
abi.ts:80         GOAL_STATUSES       = [draft,active,achieved,superseded,retired]              5 个
goal-store.ts:77  VALID_GOAL_STATUSES = [draft,active,achieved,superseded,retired,needs-human]  6 个
  ⇒ ABI 声明面少一个 needs-human：按 ABI 枚举做校验的消费者会判它非法，而 store 接受它。

abi.ts:97         META_STATUSES       = [proposed,answered]
meta-store.ts:39  VALID_META_STATUSES = [proposed,answered]
  ⇒ 取值暂时相同，但是两份独立定义——今天一致，任一处改了就漂，且无人会发现。
```

`help.ts` 对 `KINDS` / `VERBS` / `STATUSES` 的引用次数均为 **0** ⇒ 至少 11 处权威枚举在帮助面全是手抄。

---

## 决策驱动因素

- 一个事实有 N 份副本，其一致性就需要 N-1 次人工同步；本仓库已实测到 N=7 的情形。
- **漂移的失败形态是静默的**：帮助少列四个 kind，既不报错也不影响功能，只是让能力在产品表层消失——与「该能力不存在」完全同形（硬规则 3b 的形态）。
- 本仓库已接受「机械守卫」这一手法（`config-key-consumer-check.ts` / `judgment-consumer-check.ts` / `rhythm-consumer-check.ts` 三次实例化），但那三个守的是**「声明有没有消费者」**，⛔ 不守**「同一事实的多处副本是否一致」**——后者目前无人守。
- 兄弟项目 archguard 已有直接对应的先例：其 **ADR-007**（CLI↔MCP 接口一致性）用 `scripts/check-adr.ts` 机械强制并挂 Stop hook，2026-09-13 经本仓库独立验证有效。

---

## 决策

**同一事实的枚举只允许有一处定义；其余所有表层必须从它派生，⛔ 不得手抄。由机械检查强制。**

### 规范 1：唯一真源

每个枚举事实（driver kinds、task/goal/meta/adr statuses、CLI verbs 等）在代码中**只有一处**权威定义，并 `export`。

### 规范 2：表层派生，不手抄

CLI 帮助文本、Web UI 的可选值、以及任何需要列出该枚举的产品表层，**必须 import 那个常量并由它生成**。

⛔ **反模式**：把 6 个 kind 手抄进 `help.ts`。那只是把今天的不一致变成明天的不一致——手抄的副本与真源同样会漂，只是漂得晚一点。

### 规范 3：文档面用「指针 + 自报」，不复制清单

项目文档（CLAUDE.md / SKILL.md / ADR）**不得复制枚举内容**，只写指针（"清单见 `<权威位置>`"）或引导读者去跑自报命令。

这与 CLAUDE.md 自身已确立的纪律同源——其开篇逐字规定「只放两类东西：① 指向正本的指针；② 不随代码演化过期的纪律」，并对 capability-catalog 明写「**声明数看它自报，不要硬记数字，会随脚本增删漂移**」。**本规范把这条既有纪律从「机件清单」推广到「所有枚举事实」。**

### 规范 4：机械强制，且失败形态可区分

一个检查器枚举全部权威枚举定义，并断言各表层与之一致。**读不出某个表层时必须输出独立取值（`NOT-EVALUATED`），⛔ 不得与「一致」共用输出**（硬规则 3b）。

### 规范 5：豁免须显式且带理由

某个表层确有理由只暴露子集（例如 Web UI 暂不支持例程型 kind），必须在**代码处**写显式豁免注释并说明理由，由检查器识别。⛔ 不接受「沉默地少列几个」。

豁免的形态参照 archguard ADR-007 的 `// adr-ok: ADR-NNN — <理由>` —— **但须注意它已被实测出的坑**：该注释若写在被检测构造的**内部**（而非之前），提取正则会整个匹配失败、该项目**彻底隐形**于检查（archguard TASK-88 实证：三个工具因此漏检，候选集 32 vs 实际 35）。⇒ 本仓库实现时，豁免识别**不得依赖注释与被检测构造的相对位置**。

---

## 后果

**正面**：枚举新增/删除只需改一处；产品表层不会再静默落后于实现能力；文档不会再因复制清单而过期。

**负面**：帮助文本从"手写的自然语言"变成"部分由常量生成"，措辞灵活度下降；需要为每个枚举事实明确"谁是真源"，存量枚举要做一次归位。

---

## 实施

落地任务：`gap-enum-surfaces-hand-copied-across-cli-web-docs`（本 ADR 的实现载体）。

⛔ **不在本 ADR 范围**：`driver.ts` ↔ `help.ts` 那一处的具体修复已由 `gap-driver-cli-help-hides-four-of-six-kinds` 承接；本 ADR 提供的是它所属的**那一类**问题的统一规范，两者是「规范」与「该规范的第一个实例」的关系。

---

## 相关决策

- archguard `ADR-007`（CLI 与 MCP 接口一致性规范）—— 同一问题在兄弟项目的先例，含机械检查器与豁免机制的完整设计，以及豁免注释位置这个已实测的坑。
- 本仓库 `config-key-consumer-check.ts` / `judgment-consumer-check.ts` / `rhythm-consumer-check.ts` —— 「声明必须有消费者」的三次实例化；本 ADR 管的是正交的另一维度（「副本必须一致」）。
