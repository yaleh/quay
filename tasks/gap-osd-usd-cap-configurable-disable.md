---
id: gap-osd-usd-cap-configurable-disable
title: open-semantic-discovery 的 USD 限额没有「关闭」表达——max_usd_per_24h 只接受 >0， 0 被拒绝，且
  0 在次数限额里意为「全禁」不能复用；加 usd_cap_enabled 布尔并在配置里关掉
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事实一（现状，代码）**：`plugin/scripts/open-semantic-discovery-routine.ts` 的 `parseOpenSemanticDiscoverySection`
对 `max_usd_per_24h` 的校验是 `usd <= 0` 即拒绝（`:795`），所以**没有合法的「关闭」取值**。

**事实二（0 不能复用，语义冲突）**：次数限额 `max_model_calls_per_24h` 的 `0` 在 `openModelBudget`
（`discovery-method-routine.ts:872`）里的语义是「**全禁**」——`reserve()` 在 `used >= cap` 时拒绝，cap=0
⇒ 永远拒绝。若把美元限额的 `0` 改成「关闭」，同一个配置键族里 `0` 就有两个相反含义，是硬规则 8
（编号不得复用 / 缺席伪装成在场）的翻版。

**事实三（为什么不能设成天文数字）**：把 `max_usd_per_24h` 设成 1e9 之类的字面值来「等效关闭」，
正是硬规则 4 推论二的禁区——「在本机等价于无限制」的字面值不是无限制，它是依赖宿主的常量。要表达
「不限制」，就在机制上不设那个限制，而不是用一个看起来够大的数。

**事实四（为什么现在要关）**：`PER_CALL_USD_CEILING = 1.0` 是真实每次调用价（$0.24，268 次定价调用的
实测均值）的约 4 倍，未定价调用被按 $1.0 计入后，把 $30/24h 上限在真实花费 ~$11 时就触发 ⇒ 63% 的
due 轮被拒，例程只花到预算约 1/3。人 2026-10-22 决定先关掉这一限额机制（真实日花费估 ~$10–14，硬顶
由次数限额 120 次/24h 封在 ~$29/天）。

## Plan

1. **加一个显式布尔开关**：`loop.open_semantic_discovery.usd_cap_enabled`，缺省 `true`（向后兼容，
   现有配置语义不变）。`false` 时**整个 USD 预检跳过**（不读 `usdBudgetUsage`、不写
   `budget_usd_24h` 阻断分支，但在 Fact 里仍记 `usd_cap_enabled:false` 以便事后能看出它被关过——
   硬规则 3b 的镜像：关了也要留痕，不能和「没这项」同形）。
2. **校验**：`usd_cap_enabled` 缺省 true；显式给出时必须是 boolean；`false` 时 `max_usd_per_24h`
   仍必须存在且 >0（保持既有键的校验不变，只让它在开关关闭时不参与判定），这样「关掉」与「配错」
   可区分。
3. **跳过点的精确位置**：只在 `:3883` 的 `if (usdUsage.usd >= config.maxUsdPer24h)` 之前短路；
   `budget_usd_24h` 的读数块保留（读它不花模型调用，留着供 Fact 报告真实用量）。
4. **测试**：fixture 覆盖 `usd_cap_enabled` 缺省/true/false/非布尔四态，断言 false 时即使
   `usdUsage.usd` 远超 cap 也**不**返回 `budget-usd-24h`，且 Fact 里 `usd_cap_enabled:false` 可见；
   非布尔返回配置错（fail-closed）。
5. **落配置**：任务落地后由 manager/本会话把 `.quay/config.yml` 的 `open_semantic_discovery` 段加
   `usd_cap_enabled: false`（备份先行，见 Touches 外说明）。**本任务只改代码，不动 live 配置**
   ——配置改动等代码合入 develop 后再做，避免「配置写了但代码不认」的在场≠在跑。
6. **不碰**：`PER_CALL_USD_CEILING` 的估价失真（另一条成本任务的范围，本条只解决「关掉」这一动作）、
   次数限额 120 的语义、其它例程的同款限额。

## Acceptance Criteria

- [x] AC1 开关存在且可解析：`grep -n 'usd_cap_enabled\|usdCapEnabled' plugin/scripts/open-semantic-discovery-routine.ts` 命中解析与消费两处；`parseOpenSemanticDiscoverySection` 对 `usd_cap_enabled:false` 返回 `config.usdCapEnabled === false`、对缺省返回 `true`；贴三份 fixture 输出。
- [x] AC2 关闭后跳过 USD 预检：fixture 令 `usdUsage.usd` 远超 cap、`usd_cap_enabled:false`，断言例程**不**产出 `budget-usd-24h` 事实、照常派发；同一 fixture 把开关改 true，断言**产出** `budget-usd-24h`。贴两段输出。
- [x] AC3 关掉也留痕：`usd_cap_enabled:false` 的 Fact 里可见 `usd_cap_enabled:false`（不是没有这个键）；贴该 Fact 的 JSON 片段。
- [x] AC4 非布尔拒绝：`usd_cap_enabled: "no"` 返回配置错、section 不可用（fail-closed）；贴错误信息。
- [x] AC5 向后兼容：不带 `usd_cap_enabled` 的既有配置解析后 `usdCapEnabled === true`，且 USD 预检行为与改动前逐字一致；贴 `node --test` 里 open-semantic-discovery 相关测试全绿输出尾部。
- [x] AC6 登记：新增键进该例程的声明键集（若有 capability-catalog 或 config schema 声明则同步），`bash plugin/scripts/capability-catalog.sh --summary` 显示 `0 unclassified`；贴原文。

## Evidence

### AC1 — 解析处 + 消费处，三份 fixture 输出

`grep -n 'usd_cap_enabled\|usdCapEnabled' plugin/scripts/open-semantic-discovery-routine.ts`（节选，解析 803-836 / 消费 3950+5141 / 声明面 5476+5494）：

```
629:  usdCapEnabled: boolean;
664:  usdCapEnabled: true,
804:  if (rec.usd_cap_enabled !== undefined && rec.usd_cap_enabled !== null) {
806:      return { config: null, error: cfgBad(`'usd_cap_enabled' must be a boolean …
808:    usdCapEnabled = rec.usd_cap_enabled;
836:      usdCapEnabled,
3950:  const usdBudgetBlock = { usd_cap_enabled: config.usdCapEnabled, cap: config.maxUsdPer24h, …
3962:  if (config.usdCapEnabled && usdUsage.usd >= config.maxUsdPer24h) {
5141:        usd_cap_enabled: config.usdCapEnabled,
5476:  usdCapEnabled: boolean | null;
5494:    usdCapEnabled: cfg ? cfg.usdCapEnabled : null,
```

三份 fixture 输出（同一段脚本，`parseOpenSemanticDiscoverySection` 真返回）：

```
PARSE absent (default): error=null usdCapEnabled=true maxUsdPer24h=1
PARSE explicit true: error=null usdCapEnabled=true maxUsdPer24h=1
PARSE explicit false: error=null usdCapEnabled=false maxUsdPer24h=1
```

### AC2 — 关掉后真的不预检（同一 fixture 的正臂 / 负对照）

fixture：fixture workspace 的 ledger 里已有一笔 grant + 其 $40 实现价，cap 设 $1（`usdUsage.usd` 远超 cap）。

```
OFF  state=verified  reason=round ran (invoked_by:manual, interval 360m): … 0 cluster(s) from 1 run(s) … 1 model call(s) costing $1 … — MANUAL: the production last-run was NOT advanced …
ON   state=not-evaluated  reason=budget-usd-24h: $41 in the trailing 24h >= max_usd_per_24h $1 (1 priced, 1 at the $1 per-call ceiling) — nothing spawned
```

（ON 轮的 `$41` = OFF 轮自己那次预留按 $1 上限计入同一 ledger；两条臂用的是同一 fixture 形状，负对照仍然成立：开关为 true 时同一 cap 触发、零 spawn。）

### AC3 — Fact 里的 JSON 片段

```
budget_usd_24h={"usd_cap_enabled":false,"cap":1,"used":40,"priced":1,"estimated":0,"per_call_ceiling":1,"window_ms":86400000}
reservations.usd_cap=1  reservations.usd_cap_enabled=false
```

即：cap 与真实用量都照常报告，`usd_cap_enabled:false` 是一个**存在且为 false** 的键，不是缺失。

### AC4 — 非布尔 fail-closed

```
error="loop.open_semantic_discovery 'usd_cap_enabled' must be a boolean (got \"no\") — it switches the USD ceiling's REFUSAL on/off; it is not a value of 'max_usd_per_24h'"  config=null
```

同一值的整轮 fixture 走 `state=failed` / `reason` 含 `config invalid` 与 `usd_cap_enabled` / **0 spawns**。

### AC5 — 向后兼容

`node --no-warnings --experimental-strip-types --test plugin/test/open-semantic-discovery-routine.test.mjs` 尾部：

```
ℹ tests 132
ℹ suites 0
ℹ pass 132
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12884.521473
```

既有 `case (e) — the USD cap ⇒ not-evaluated:budget-usd-24h and ZERO spawns` 用例**文本未改**（该测试文件在 `develop...HEAD` 里唯一的删除行是 import 行的扩写），且仍绿 ⇒ 不带开关的既有配置行为与改动前一致；新增的 `usd_cap_enabled — parse` 用例另断言缺省 ⇒ `usdCapEnabled === true`。

### AC6 — 登记

```
capability-catalog: 395 scripts | 395 declared | 0 unclassified | 390 ship
```

新增键登记在该例程自身的声明面：`OpenSemanticDiscoveryConfig.usdCapEnabled`、`parseOpenSemanticDiscoverySection` 的解析、`openSemanticDiscoveryRoutineFromConfig` 的返回、以及 `quality-gate-driver.ts` 装配行（关闭时打印 `DECLARED BUT NOT ENFORCED — usd_cap_enabled:false`，不再谎称 HARD）。没有新增脚本文件 ⇒ capability-catalog 的文件级声明不变（`0 unclassified`）。

### ADR-007 暗轴记录

- 该轴仍暗,理由:本条只新增一个配置布尔与其短路分支（未改模块边界、依赖边、包归属），L_D/L_G 无可归因于本条的增量，本轮未重跑 archguard。

## Definition of Done

- 代码支持 `usd_cap_enabled:false` 且关掉后真实跳过 USD 预检（AC2 的负对照已证伪「关掉无效」）。
- 缺省 `true` 保证所有既有 workspace 行为不变。
- live 配置的「关掉」动作不在本任务内做，但任务落成后有一条明确的后续动作记录（谁在何时关、为何关）。
- 后续动作记录：本任务合入 develop 后，由 manager 把 `.quay/config.yml` 的 `loop.open_semantic_discovery:` 段加 `usd_cap_enabled: false`（备份先行）。依据：人 2026-10-22 决定先关掉该限额机制——`PER_CALL_USD_CEILING=1.0` 把未定价调用按 $1 计入，使 $30/24h 在真实花费 ~$11 时就触发、约 63% 的 due 轮被拒；真实日花费估 ~$10–14，硬顶由次数限额 120 次/24h 封在 ~$29/天。⛔ 本任务只改代码，不动 live 配置。

## Touches

- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
- tasks/gap-osd-usd-cap-configurable-disable.md