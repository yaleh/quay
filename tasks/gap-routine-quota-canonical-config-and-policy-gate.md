---
id: gap-routine-quota-canonical-config-and-policy-gate
title: routine 限流①：K/窗口/全局天花板收口进 drivers.yml/driver-config.ts 声明式配置面 + 独立纯
  Policy 函数（人已裁定方向，本任务落地，不接真实调用点）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
**type:** execution

## Proposal

人已裁定三点方向（详见本任务 Finding 的证据链接），本任务落地其中**①配置面 + ②独立 Policy/Gate + ③全局天花板**，**不**改真实调用点（`probe-routine.ts`/`meta-driver.ts` 仍走旧参数形状）——该范围留给另一个任务（`gap-routine-quota-consumer-convergence`）处理，理由同本任务体系一贯的"一次 slice 只解决一个能独立验收的问题"（`docs/references/ownership-first-refactoring-methodology.md` §4）。

**⛔ 明确排除（本任务边界,不是遗忘）**：
- 不碰"历史立案计数 vs 当前板压力"的混淆（`gap-routine-rate-gate-board-pressure-and-quota-ownership` 已用测试钉死该缺口,其修复是独立且更难的问题,需要单独设计+验证,不在本任务内；本任务的"全局天花板"**沿用现有"历史立案计数"语义**做全局汇总,⛔ 不重新定义成"板压力",两者不得混同）。
- 不改 `probe-routine.ts`/`meta-driver.ts` 的真实调用点（另一个任务覆盖）。
- 不重启任何生产 driver 进程（本任务只落代码，不触发任何运行时重新加载）。

## Finding（现状证据）

- `plugin/scripts/routine-file-gate.ts:18` `export const DEFAULT_RATE = 3;`、`:513` `export const FILING_WINDOW_MS = 24*60*60*1000;` —— 孤儿字面量，`grep -n "drivers.yml\|loadDriverConfig" plugin/scripts/routine-file-gate.ts` 0 命中（已在 `gap-routine-rate-gate-board-pressure-and-quota-ownership`，commit `4b218606d`，用特征化测试钉死）。
- `plugin/scripts/driver-config.ts` 已是全仓库声明式配置的**单一加载入口**（头注释：「⛔ 全仓库唯一一个并发数值字面量——其余并发值都从 `drivers.yml` 经 `loadDriverConfig`/`driverCap` 派生」），六个 driver kind 的 `cap`/`interval_ms`/`reconcile_interval_secs` 已统一于此——**人核实这是正确的 canonical source，本任务延伸它，不新开第二个配置面**。
- 当前 `gateFinding`（`routine-file-gate.ts:254`）只接受单一 `{recentCount, K}`，没有"全局"维度——`countRecentFilings(carrier, now, window, routine)` 的 `routine=null` 调用形态已经能读出全局汇总（`gap-routine-filing-rate-global-window-starves-freshness-refresh`，commit `30858fef1`，已验证），但目前**没有任何调用点把全局读数与 per-routine 读数一起喂给一次判定**——即"K×R 可无上限增长"的结构性原因：per-routine 分账之后，没有同时存在的全局上限。
- 实测历史数据（`.quay/routine-findings.jsonl`，只读）：迄今只有 2 个 routine 真正走过该限流闸立案过（`freshness-refresh` 累计 24、`semantic-dedup-scan` 累计 41），`quality-gate-driver.ts` 注册的其余 RoutineSpec（B15/B17/架构复核/packaging-hygiene）均不经此通道立案（`gap-quality-driver-architecture-review-routine` AC4 已验证架构复核例程"零 `task_write` 调用"）。**全局天花板没有事故发生率数据可依**（硬规则 12：新前置无发生率需降为观察项，但本任务的"设上限"是人直接裁定的结构要求，不是我方推导的新前置）——因此下方缺省值是**结构性保守选择**，不是从事故阈值反推,本任务体与 AC 必须诚实标注这一点,不得伪装成"已测得的阈值"。

## Plan

### 1. `plugin/scripts/drivers.yml` 新增顶层段（与现有 `kinds:` 平级，⛔ 不塞进某个 kind 里——quota 是按 routine 名维度,不是按 driver kind 维度）

```yaml
routine_quota:
  window_ms: 86400000      # = 24h，与现有 FILING_WINDOW_MS 缺省值逐字一致（迁移兼容）
  default_k: 3             # 单 routine 缺省上限，与现有 DEFAULT_RATE 缺省值逐字一致（迁移兼容）
  global_ceiling: 12       # 新增：全部 routine 合计的硬上限（结构性保守选择 = default_k(3) × 实测
                            # 迄今真实使用过该通道的 routine 数(2) × 安全余量，⛔ 不是从事故阈值反推——
                            # 本仓库迄今没有「K×R 失控」的事故读数，人直接裁定要有上限,这是满足该裁定
                            # 的结构性起点，不是精调出来的最优值；发生率为 0 不等于不需要，这条由人裁定
                            # 直接要求，不走硬规则 12 的「新前置需发生率」路径）
  per_routine: {}          # 可选：具名 routine 的 K 覆盖（缺省 = default_k）。空 map = 全部用缺省。
```

### 2. `plugin/scripts/driver-config.ts` 新增（与现有 `DriverConfig`/`loadDriverConfig`/`driverCap` 同一文件,同一风格,⛔ 不新开第二个配置加载入口）

```ts
export interface RoutineQuotaConfig {
  windowMs: number;
  defaultK: number;
  globalCeiling: number;
  perRoutine: Readonly<Record<string, number>>;
}

export function defaultRoutineQuotaConfig(): RoutineQuotaConfig { /* windowMs=86400000, defaultK=3, globalCeiling=12, perRoutine={} */ }

/** 读 drivers.yml 的 routine_quota 段；读失败/不可解析/字段类型不对 ⇒ 缺省（fail-open 到保守缺省，
 *  同 loadDriverConfig 既有风格）。⚠️ 但【取值的危险方向】必须 fail-closed——若某字段解析出一个会
 *  让限流变得更松的坏值（如 global_ceiling 为负数/0/非数字，或 per_routine 某项大于 global_ceiling
 *  导致单 routine 就能撑爆全局上限），该字段必须回退到缺省值，⛔ 不得采用「读到了但荒谬」的值。
 *  两种失败（读不到 vs 读到但荒谬）都归一到「用缺省」，但必须留痕（下方 AC 要求区分日志/返回值可核）。*/
export function loadRoutineQuotaConfig(root: string): RoutineQuotaConfig { /* ... */ }

/** 单一入口：给定 routine 名，解析其有效 K（per_routine 覆盖 > default_k）。*/
export function routineK(root: string, routine: string | null): number { /* ... */ }

/** 单一入口：全局天花板。*/
export function routineGlobalCeiling(root: string): number { /* ... */ }
```

### 3. `plugin/scripts/routine-file-gate.ts` 新增一个**独立纯函数**（人裁定②：准入决策由独立纯 Policy/Gate 执行），`gateFinding` 内部调用它，但**暂不改 `gateFinding` 现有参数签名**（向后兼容，真实调用点迁移留给另一个任务）：

```ts
/** 独立纯 Policy 函数（人裁定②）：给定「本 routine 窗口内计数」与「全局窗口内计数」与配置，产出
 *  三态可区分的拒绝理由（⛔ 两种拒绝原因不得同形——per-routine 拒绝与 global 拒绝必须读得出是哪一个）。
 *  纯函数：不读文件、不读环境、不做任何 I/O——config 由调用方解析好传入。*/
export function routineQuotaDecision(
  counts: { perRoutine: number; global: number },
  config: { k: number; globalCeiling: number },
): { accept: boolean; reason: string } {
  if (counts.global >= config.globalCeiling) {
    return { accept: false, reason: `global-rate: ${counts.global} total routine-filed tasks this window ≥ global ceiling ${config.globalCeiling}` };
  }
  if (counts.perRoutine >= config.k) {
    return { accept: false, reason: `rate: ${counts.perRoutine} routine-filed tasks this window ≥ cap ${config.k}` };
  }
  return { accept: true, reason: "accepted: within per-routine and global rate" };
}
```

`gateFinding` 现有的 `if (recentCount >= K) return {...}` 一行改为调用 `routineQuotaDecision({perRoutine: recentCount, global: recentCount}, {k: K, globalCeiling: Infinity})`（⛔ 过渡期全局天花板设 `Infinity`，保证 `gateFinding` 的**现有调用方行为逐字不变**——这是迁移兼容的关键取假点，见 AC）。真正把 `global` 读数与有限的 `globalCeiling` 一起喂给它，留给另一个任务。

## Acceptance Criteria

- [x] `drivers.yml` 新增 `routine_quota` 段，`driver-config.test.mjs` 新增用例核实 `loadRoutineQuotaConfig` 读出的 `windowMs`/`defaultK` 与现有 `FILING_WINDOW_MS`/`DEFAULT_RATE` 的值逐字相等（迁移兼容，取假点：改 `drivers.yml` 任一字段，读数必须跟着变）
- [x] 配置错误 fail-closed 有单态判据（正反对照）：构造一个 `global_ceiling: -1`（或 0、非数字、字符串）的 `drivers.yml` fixture，`loadRoutineQuotaConfig` 必须返回缺省的 `globalCeiling`（不得返回 -1/0/NaN）；同一 fixture 把该字段改成合法正整数 ⇒ 读出该值——同一输入、只变字段取值、结论翻转
- [x] `per_routine` 某项 > `global_ceiling` 的荒谬配置（如 `per_routine: {x: 100}, global_ceiling: 12`）必须被拒（fail-closed 到缺省 `per_routine`，或至少不允许该 routine 单独突破全局上限——具体取哪种处理方式由实现者定，但必须有一条断言证明"任何单 routine 的有效 K 不会大于 globalCeiling"这个不变式，无论配置怎么写）
- [x] `routineQuotaDecision` 是独立纯函数单测（不经 `gateFinding`，直接调用）：三组对照——全局未满/per-routine 未满 ⇒ accept；全局未满/per-routine 满 ⇒ `rate:` 拒绝；全局满（即使 per-routine 未满）⇒ `global-rate:` 拒绝（**两种拒绝理由前缀不同，可用 regex 区分，⛔ 不同形**）
- [x] 负对照（取假）：把 `routineQuotaDecision` 里 `global` 分支暂时注掉重跑用例 ⇒ "全局满但 per-routine 未满"那组断言必须转红；改回原样重跑全绿——执行命令与两次结果进 `## Evidence`
- [x] 迁移兼容性取假（硬约束）：实现完成后在本任务自己的 worktree 内重跑，`plugin/test/routine-file-gate.test.mjs` 既有全部 19 条用例（含上一任务刚加的 ⑯⑰）**一字不改、全部仍绿**——`gateFinding` 对现有调用方（`probe-routine.ts`/`meta-driver.ts`）的外部行为逐字不变（因为过渡期 `globalCeiling` 传 `Infinity`）
- [x] `plugin/test/probe-routine.test.mjs`/`plugin/test/meta-driver.test.mjs`/`plugin/test/quality-gate-driver.test.mjs` 三个消费方测试全绿（本任务不改调用点，理论上必然不回归，但须实跑验证而非假设）
- [x] ⛔ 本任务不重启任何生产 driver 进程，不触发任何 `.quay/*-control.json` 写入；`git diff` 范围严格限于 Touches 列出的文件

## Evidence

实现提交（worktree `/data/home/yale/work/quay-worktrees/gap-routine-quota-canonical-config-and-policy-gate`，分支 `task/gap-routine-quota-canonical-config-and-policy-gate`）：`e1ac06dd4`（实现）+ `0d897b76e`（concurrency-literal-check 例外声明）。

**AC1/AC2/AC3 配置面（`plugin/test/driver-config.test.mjs` 新增 4 条）**
- `node --no-warnings --test --experimental-strip-types plugin/test/driver-config.test.mjs` ⇒ `tests 9 / pass 9 / fail 0`
  - AC1：真实 `drivers.yml` 读出的 `windowMs===FILING_WINDOW_MS`、`defaultK===DEFAULT_RATE`（收口后 `FILING_WINDOW_MS`/`DEFAULT_RATE` 由 driver-config 缺省常量派生）；改 fixture 字段读数跟着变。
  - AC2：`global_ceiling` ∈ {-1, 0, 1.5, "12", abc} ⇒ 全部回退缺省 12 且留痕；改成合法 `7` ⇒ 读出 7（同输入、只变字段取值、结论翻转）。
  - AC3：`per_routine:{x:100}` 且 `global_ceiling:12` ⇒ `x` 被丢弃（fail-closed）+ 留痕；不变式 `routineK(dir,r) ≤ routineGlobalCeiling(dir)` 对 `r ∈ {null,x,y,未配置}` 全部成立；`default_k:9`/`global_ceiling:2` ⇒ 有效 K 钳到 2。

**AC4（`plugin/test/routine-file-gate.test.mjs` 新增 1 条，直接调 `routineQuotaDecision`，不经 `gateFinding`）**
- `node --no-warnings --test --experimental-strip-types plugin/test/routine-file-gate.test.mjs` ⇒ `tests 20 / pass 20 / fail 0`
  - 三组对照：`{0,0}` ⇒ accept；`{perRoutine:3,global:5}` ⇒ `rate:` 拒绝；`{perRoutine:0,global:12}` ⇒ `global-rate:` 拒绝；前缀可 regex 区分（`rate` ≠ `global-rate`）；两者都满 ⇒ 报更外层 `global-rate:`。

**AC5 负对照（取假）——`routineQuotaDecision` 的 global 分支注掉 ⇒ 「全局满但 per-routine 未满」断言转红；改回 ⇒ 全绿。**
- 命令（注掉状态下）：`node --no-warnings --test --experimental-strip-types --test-name-pattern='routineQuotaDecision' plugin/test/routine-file-gate.test.mjs`
  - 结果：`✖ routineQuotaDecision (AC4) … tests 1 / pass 0 / fail 1`；`AssertionError [ERR_ASSERTION]: 全局满、per-routine 未满 ⇒ 仍拒`（精确命中 global 分支那条断言，不是别的红）。
- 命令（恢复后）：同上
  - 结果：`✔ routineQuotaDecision (AC4) … tests 1 / pass 1 / fail 0`。

**AC6 迁移兼容**
- `node --no-warnings --test --experimental-strip-types plugin/test/routine-file-gate.test.mjs` ⇒ `tests 19 / pass 19 / fail 0`（既有 19 条一字不改全绿）；加 AC4 用例后同一文件 `tests 20 / pass 20 / fail 0`。

**AC7 消费方**
- `probe-routine.test.mjs` 23/23、`meta-driver.test.mjs` 131/131、`quality-gate-driver.test.mjs` 32/32 全绿。

**静态门 + scoped 门**
- `bash /data/home/yale/work/quay-worktrees/gap-routine-quota-canonical-config-and-policy-gate/scripts/test.sh --for-task gap-routine-quota-canonical-config-and-policy-gate --allow-thin` ⇒ `exit=0`；含 `PASS — every concurrency literal is at a QUAY_MAX_* definition point or a declared fallback (0 violations)`、`PASS — valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0`。
- 首轮该门红于 `concurrency-literal-check exit=1`：新增常量名含 `quota` 撞 P1 关键词（非并发数）⇒ 按 checker『非并发但撞关键词须显式声明』条款加 `concurrency-default-fallback` 例外（同 RED_BACKLOG_CAP_DEFAULT 先例），`0d897b76e` 修复后 0 violations。

**AC8 边界**
- `git diff --stat` 仅 5 个 Touches 文件（`drivers.yml`/`driver-config.ts`/`routine-file-gate.ts`/`driver-config.test.mjs`/`routine-file-gate.test.mjs`）；未重启任何生产 driver 进程，未写任何 `.quay/*-control.json`（唯一 `.quay` 写入是任务要求的 `scoped-gate-cache.json`）。

## Definition of Done

`drivers.yml`/`driver-config.ts` 成为 routine 配额的 canonical source（含全局天花板，配置错误 fail-closed，迁移兼容）；`routineQuotaDecision` 作为独立纯 Policy 函数落地并有完整正反对照；`gateFinding` 内部已切换到调用它，但因过渡期 `globalCeiling=Infinity`，**对外行为逐字不变**（真正把全局读数接上有限天花板留给另一个任务）。全部 AC 勾选、既有测试一字不改全绿、无生产重启。

## Touches

- plugin/scripts/drivers.yml
- plugin/scripts/driver-config.ts
- plugin/scripts/routine-file-gate.ts
- plugin/test/driver-config.test.mjs
- plugin/test/routine-file-gate.test.mjs
- tasks/gap-routine-quota-canonical-config-and-policy-gate.md
