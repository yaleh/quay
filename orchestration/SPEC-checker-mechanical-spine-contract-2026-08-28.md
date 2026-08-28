# SPEC：checker 机械脊柱契约 —— exit 码语义 + `--json` 输出形状

**来源**：`tasks/gap-b1-mechanical-spine-doc-checker`（层 1 · 机械脊柱，B1）。
**上游**：`orchestration/SPEC-methodology-layer-architecture-2026-08-25.md` §2.3 层 1（
「CODIFY-EXISTING（几乎免费）：exit 0/1/2 语义 12/14 已符合、`--json` 输出 13/14 已支持（56/77）
⇒ 写下来即可，不需要改文件」）。

## 0. 一句话

checker 的「机械脊柱」= 两个每个 checker 都该守、且可**逐条 grep** 的表面契约：
**① exit 码词表 ∈ {0,1,2,3}**（各自语义固定）；**② 声称支持 `--json` 就必须真产出 JSON**。
本 SPEC 把它写成正本，`checker-mechanical-spine-check.ts` 机械守着（棘轮：不符者只减不增）。

## 1. 适用范围

- 对象 = `plugin/scripts/*-check.ts`（78 个，含本 checker 自身）+ `plugin/scripts/*-check.sh`（32 个），
  即 SPEC-methodology-layer-architecture §1.7 的「checker 109 个」+ 本 checker = 110 个。检查器**按文件系统 glob 派生**
  （`ls plugin/scripts/*-check.{ts,sh}`），不硬编码 77/32——新增 checker 自动进审查面。
- 层 2（判定契约，复用 `driver-result.ts` 的 `DriverResult<T>`）归 **B4**；
  层 3（输入形状 path→content）归 **B5**。二者**不并入本契约**。

## 2. exit 码语义（机械脊柱 + 已认可扩展）

检查器用 exit 码词表 **{0,1,2,3}**，每个码含义**固定**：

| exit 码 | 含义 | 备注 |
|---|---|---|
| `0` | **PASS** —— 全部检查通过 | 缺值/未查不得与 PASS 同形（硬规则 6/3b） |
| `1` | **FAIL/RED** —— 发现 ≥1 违例 | 违例是**枚举出来的清单**，不是布尔（硬规则 3） |
| `2` | **usage/environment error** —— 用法错 / 环境不满足（坏参数、缺文件、不可用的 git 环境等） | 检查器「没能跑」，不是「跑了且判红」 |
| `3` | **NOT-EVALUATED** —— 输入读不懂/不可得（硬规则 3b 第三态） | **脊柱之外的【已认可】扩展**，由 `gap-not-evaluated-harness-third-state`（done）统一；`checker-cost-lib.sh` 的 `RUN_CHECKER_EXIT_NOT_EVALUATED=3` 认它 |

**违例定义（grep 可判）**：checker 源码里出现 **{0,1,2,3} 之外的 exit 码字面量** ⇒ 不符。
（例：`process.exit(4)`、`exit 5`、`exitCode = -1`。）机械脊柱只认 0/1/2/3 这四个码。

> **与第三态的分工**：exit 3 是「已认可的扩展」，**不是脊柱违例**。B1 不拥有第三态
> （那是 `gap-not-evaluated-harness-third-state` / B4 的地盘）；B1 只守「不在 {0,1,2,3} 里的
> 码字面量」这一条，使它不会静默漂移成「exit 4 表示某语义」之类无人可见的新编码。

## 3. `--json` 输出形状

- 检查器**传入 `--json`** 时，stdout 必须产出**单个机器可读 JSON 值**（对象或数组），
  不是裸 `PASS`/`FAIL` 行。典型形状 `{ "ok": <boolean>, …, "failures": [...] }`。
- **违例定义（grep 可判）**：源码里**出现了 `--json` 标志**（声称支持），但**没有 JSON 产出原语** ⇒ 不符：
  - `.ts`：无 `JSON.stringify`（实测 56 个带 `--json` 的 checker 全有）；
  - `.sh`：无 `jq` / `python` / `node` / `printf`（直接产 JSON 或委托 node backend，如
    `gate_delegate_ts` 把 `--json` 透传给 node checker）。
- **不带 `--json` 的 checker**（human-output-only）**不判违例**——它是存量形态，`--json` 采纳率
  （56/77）只作信息记录，不作硬闸。硬闸只守「**声称了就必须兑现**」这一条。

## 4. 执行（棘轮，只减不增）

- `plugin/scripts/checker-mechanical-spine-check.ts` 机械枚举 110 个 checker（含本 checker 自身），对每个静态判
  上述两条（exit 码词表 + `--json` 兑现），输出**不符者清单**（枚举，不布尔）。
- 配套 `plugin/scripts/checker-mechanical-spine-exemptions.json` **exemption list 棘轮**：
  - **历史不符者豁免**（在名单里 ⇒ 报告但不红）；
  - **新增不符者红**（不在名单里 ⇒ exit 1）；
  - **名单只减不增**（对 git HEAD baseline 作 shrink-only 校验——新增名单条目即红）。
- 检查器自身同样守本契约：exit 0/1/2（+ `--json`），0 = 无不符、1 = ≥1 新增不符、2 = 用法/环境错。

## 5. 证据等级（诚实标注）

| 主张 | 等级 |
|---|---|
| 当前不符者数 = 0（exit 码 + `--json` 均已清零） | **实跑检查器**（110 个 checker 逐个静态扫），非印象 |
| 12/14 / 13/14（14 抽样） | 上游 SPEC 的**当时**测量；本 SPEC 以【当前实跑】为准 |
| `.sh` 的 `--json` 兑现原语集（jq/python/node/printf） | **启发式**——委托型 `.sh`（`gate_delegate_ts`）会透传 `--json` 到 node，静态 grep 看不穿；若出现假阳性/假阴性需再修（不因「结构上不可能取假」而误当测量，硬规则 4） |
