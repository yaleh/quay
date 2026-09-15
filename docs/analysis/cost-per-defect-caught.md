# 每拦下一个缺陷的验证成本——给 ADR-005「验证是绑定约束」的一个数

> 2026-09-14。本任务：`tasks/gap-cost-per-defect-caught-verification-marginal-return`。
> ADR-005（`adr/ADR-005-verification-is-the-binding-constraint.md`）主张「稀缺资源是廉价可信的
> **检查**，不是生成能力」——至今**只有定性论证，从未有过一个数**。本文把「每个闸/checker
> 拦下多少次真实坏状态」与「它累计花了多少成本」对起来，给出第一个数。
>
> **结论先行**：① 全仓 226.0 h 的 checker 成本里，**一个机制占 97.9%**（`ready-pool-check`，
> 221.3 h），它的每拦截成本 **3.35 h/缺陷**；② 拦截缺陷**最多**的闸（`goal`，去重后 109–184 个）
> **没有任何成本仪器** ⇒ 「验证总成本」是一个**下界**；③ 在 >1 h 阈值上**没有纯税检查器**
> （清单为空，且谓词已自证）；④ 对 ADR-005 **方向支持、量级不足以判定**（理由见 §7）。

## 0. 可复跑锚点

```
# 2026-09-14T15:10Z，develop tip = 65f93cdc98a252511b3739e0728c3cbb46149c71
node --no-warnings --experimental-strip-types plugin/scripts/verification-marginal-return.ts --root /home/yale/work/quay
# 机器可读：  ... --json
# 换阈值看纯税清单： ... --min-hours 0.1
```

⚠️ **读数是活的**：载体是被生产循环持续 append 的（同一小时内 `checker-cost.jsonl`
从 96,583 涨到 96,624 行）。本文所有数字都绑定上面的时刻；复跑会得到略有不同、但结构相同的读数。
**结构性结论（97.9% 集中、goal 闸无成本仪器、>1 h 无纯税）不随 append 漂移。**

## 1. 数据面：**成本与拦截在两个不同的键空间里**

这是本任务真正的难点——不是去重，是**先搞清楚哪些量对得起来**。

| 通道 | 生产载体 | 键 | 窗口 | 谁有这个通道 |
|---|---|---|---|---|
| **成本** | `.quay/checker-cost.jsonl` | `name`（每行 `{name,ms,n,load,at,verdict?}`） | 2026-08-11→ | 146 个名字 |
| `gate` | `.quay/gate-events.jsonl` | `gate` + `pipeline_id` | 2026-08-12→ | 7 个闸 |
| `promotion-refuse` | `.quay/promotion-outcome.jsonl` | `task_id` | 2026-08-22→ | `ready-pool-check` |
| `static-check` | `.quay/verification-round.jsonl` | `failures[].line` 里的 `STATIC_CHECK_FAILED: <name>` | 2026-08-12→ | 注册表里的 checker |
| **注册表** | `plugin/scripts/runner-static-gate.ts` (+`scripts/test.sh`) | `run_checker "<name>"` 行 | 当前 | 78 个名字 |

**两个关键设计决定，都是为了不让读数把「未查」印成「没有」（硬规则 6 / 3b）**：

1. **成本载体里 `gate:<闸>:<item>` 形的行折回闸名**（`packages/quay/src/gate/engine.ts:35`
   的 `recordGateCost`），否则同一个闸会被拆成几十行。
2. **「没有拦截通道」记 `null`，绝不记 `0`**。一个 checker 有成本、但没有任何载体记录它拦过什么
   ⇒ 它的每缺陷成本是**未查**，不是 0。把两者混同，就是把「我们没测」读成「它没拦下任何东西」
   —— 而那正是拿一个错口径去砍闸的路径（本任务 DoD 明令避免）。

**静态检查通道为什么要读注册表**：只看「有没有红过」，一个**从不红**的检查器与一个**没有拦截
通道**的检查器在读数上同形。读注册表后，「注册了但窗口内 0 次红」是一个**真读数**
（`MEASURED_ZERO`），AC4 的纯税谓词才有对象；没有注册表，AC4 的清单结构上恒空。
注册表不是新造的：`select-static-checks-for-touches.ts` 与 `checker-mutation-check.sh` 已经在
解析同一批 `run_checker` 行，各自的 `@checker-count` 也是机器核的。

## 2. 去重口径（口径不写清楚的排序没有意义）

一次真实缺陷会被同一个闸重复判定很多次——`goal` 闸 23,239 条 `fail` 显然不是 23,239 个不同缺陷。
本机件同时算三种，脚本运行时**逐字打印**这三条：

- **D1 `streak`**——同一 `(item, gate)` 的**连续 fail 段**算一次：把该键的全部判定按 timestamp
  升序排列，一段极大的连续 `fail` 序列（中间没有出现过一次 `pass`）计为 1 个缺陷。
  理由是「坏状态没被修好、被重复判了 N 次」是**一个**缺陷而不是 N 个。
- **D2 `reason`**——同一 `(item, gate, 规范化失败原因)` 算一次。原因文本先规范化（数字与 ID 折叠
  为 N：`AC-143 has no criterion` → `AC-N has no criterion`），同一键的多次判定计为 1 个。
  理由是「换了理由 = 换了缺陷」。
- **D3 `item`**——同一 `(item, gate)` 只要曾 fail 过就算一次。最粗口径，给出缺陷数**下界**。

⚠️ 数字折叠是**有意**的：`round 17 red` 与 `round 21 red` 折叠成同一个键——同一类坏状态的不同编号
不该被算成两个缺陷。代价是「只差数字的两个**不同**缺陷」也会被折叠（低估方向）。

## 3. 主读数

```
name                          cost_h    judg    fail     D1     D2     D3    h/D1    h/D2    h/D3  channel
ready-pool-check              221.28   77478    5208     66     73     66   3.353   3.031   3.353  promotion-refuse
checker-mutation-check          1.02     161       8      8      8      8   0.127   0.127   0.127  static-check
ts-typecheck                    0.35     n/a     n/a    n/a    n/a    n/a     n/a     n/a     n/a  （无通道）
strategic-doc-staleness-check   0.33    1949       0      0      0      0       ∞       ∞       ∞  static-check
instrument-failure-check        0.33    1941       0      0      0      0       ∞       ∞       ∞  static-check
threshold-scope-check           0.24    1940       0      0      0      0       ∞       ∞       ∞  static-check
adr016-screen-use-check         0.21     200       0      0      0      0       ∞       ∞       ∞  static-check
test-isolation-check            0.20     215       0      0      0      0       ∞       ∞       ∞  static-check
tick-core-static-check          0.19    1997       0      0      0      0       ∞       ∞       ∞  static-check
dead-code-after-return-check    0.18     192       0      0      0      0       ∞       ∞       ∞  static-check
outer-tick-log-check            0.15      19       0      0      0      0       ∞       ∞       ∞  static-check
ac56-recommended-deordered-check 0.14     21       0      0      0      0       ∞       ∞       ∞  static-check
superseded-capability-check     0.13     235       0      0      0      0       ∞       ∞       ∞  static-check
red-on-omission-audit           0.10    1936       0      0      0      0       ∞       ∞       ∞  static-check
...
goal                             n/a  102860   23239    184    152    109     n/a     n/a     n/a  gate
complete                         n/a     419       0      0      0      0       ∞       ∞       ∞  gate
promote                          n/a      74       0      0      0      0       ∞       ∞       ∞  gate
retreat                          n/a     113       0      0      0      0       ∞       ∞       ∞  gate
acceptance                      0.01       8       5      5      5      5   0.003   0.003   0.003  gate
dod                             0.00      77       3      3      3      3  <0.001  <0.001  <0.001  gate
dark-axis                       0.00       1       1      1      1      1  <0.001  <0.001  <0.001  gate
```

**读法**：`judg` = 该对象的**判定次数**（闸 = gate-events 记录数，检查器 = 成本载体调用条数）。
`h/D*` = 累计成本 ÷ 该口径下的去重缺陷数；`∞` = 分母 0（**测到了 0，不是没测**）；
`n/a` = 分子或分母**未查**（缺成本行或没有拦截通道）。**`∞` 与 `n/a` 是两个不同的东西。**

三件一眼可见的事：

1. **成本高度集中**：全仓 checker 成本 **226.0 h**，`ready-pool-check` 一个人 **221.28 h = 97.9%**；
   其余 145 个合计约 4.7 h。其中 `gate:` 形的成本行总共只有 **0.41 h**。
2. **拦截次数与成本完全不成比例**：`goal` 闸判定 102,860 次、拦下 23,239 次（去重后 **109–184** 个
   缺陷）——**它一条成本行都没有**。
3. **静态检查器在窗口内几乎没红过**：有拦截通道的 68 个 checker 里，窗口内红过的只有 **15** 个
   （共 123 条 `STATIC_CHECK_FAILED` 行）；其余 **53** 个 0 次（见 §6 的读法）。

## 4. 敏感性分析（AC2）

三种口径下的**每缺陷成本排序**（只列同时有成本与拦截通道的 18 行）：

```
D1: ready-pool-check > checker-mutation-check > concurrency-literal-check > fan-in-workflow-check > touches-one-entry-one-path-check > direct-to-develop-bypass-check > it0-split-or-commit-check > acceptance > registry-bare-filename-scan > ...
D2: （与 D1 逐字相同）
D3: （与 D1 逐字相同）
top-k 集合交叠: D1∩D2 = 1.00  D2∩D3 = 1.00  D1∩D3 = 1.00
逐行三口径分歧（max/min > 1.2）:  goal: D1=184 D2=152 D3=109  ratio = 1.69×
```

**⇒ 排序稳定：三个口径下每缺陷成本 top-5 的集合完全一致。**

**只有一行对口径敏感——`goal` 闸**（109 vs 184，1.69×）。这是**结构性的、可解释的**：
它只有一个 item 维度上反复换理由的失败族（同一个 AC 反复出现不同的失败原因），
所以「换一次理由算不算一个新缺陷」在这里才真的改结论；对 `ready-pool-check`
（66 vs 73，1.11×）和其余行，三口径分歧 ≤1.2×，**口径选择不改结论**。

⚠️ **但这个排序不是全序**：全表 **82 行**里只有 **18 行**同时有成本与拦截通道。`goal` 闸
（拦截最多）因无成本而不在其中，`ts-typecheck` / `adr-001` / `doc-quay-directive-skill` 等
因无拦截通道也不在其中。它回答的是「**在这 18 行之间**，谁更贵」，不是「全仓谁最贵」。

## 5. `ready-pool-check` 专项（AC3）

| 量 | 读数 |
|---|---|
| 累计成本 | **221.28 h**（77,478 次记录，Σn = 551,132） |
| 拦截通道 | `promotion-refuse`（`.quay/promotion-outcome.jsonl`，2026-08-22→） |
| 通道内记录数 | 43,345（该载体的全部记录，含被跳过与被晋升的） |
| 未去重的「真实缺陷」拦截 | **5,208** |
| 去重后不同缺陷数 | D1 = **66** · D2 = **73** · D3 = **66** |
| **每拦截成本** | D1 = **3.353 h** · D2 = **3.031 h** · D3 = **3.353 h** |

**分母口径（必须说清楚，否则这个数会虚高 8 倍）**：`promotion-outcome.jsonl` 共 43,345 条，
其中 `action` 为 `skip` 的 41,068 条里 **38,002 条（92.5%）的 `missing` 只有 `depsReady=false`**
——那是**依赖排序**（前置任务还没落地，正确地不晋升），**不是任务本身坏了**。
把它算成「拦下了一个缺陷」会让未去重拦截数从 5,208 虚高到 41,068。
本文的分母只含 `missing` 里出现非 `depsReady` 项的拒绝（`selfTouchOk` / `fourArtifacts` /
`touchesResolve` / `touchesNarrow` / `prosePrereqGap`），即**任务自身确实坏了的那些**。

**怎么读 3.35 h/缺陷**：它衡量的是「晋升准入机制每阻止一个坏状态进入就绪池，花掉 3.35 小时
机器时间」。它**不是**「这个机制不值」——它拦的是「一个 artifact 不全 / 无 self-touch /
Touches 不解析 / 越界 Touches / 前提已失效的任务被派给一个 agent」，那一轮的浪费远大于 3.35 h。
它**是**「这个机制的单价」，以及——**它没有任何判据在盯**（见 §6、§8）。

## 6. 纯税候选（AC4）

**`--min-hours 1`（AC4 指定的阈值）：清单 0 条。**

**零计数的配套动作（硬规则 2）**：谓词 `isPureTax` 在**一个已知有拦截的行**上干跑一次 ——
目标 `ready-pool-check`，谓词返回 `false` ⇒ **谓词有效 ✓**。
（谓词定义：`成本 > 阈值 ∧ 拦截通道在 ∧ 去重缺陷数 = 0`。三个否定面各有一条单测：
拦截>0 / 成本未超阈 / **无通道 ⇒ 不入围**。）

**为什么是 0**：成本 >1 h 的检查器只有两个，**两个都有拦截**——
`ready-pool-check`（221.28 h，66–73 个）与 `checker-mutation-check`（1.02 h，8 个）。
`checker-mutation-check` 的 0.127 h/缺陷是**全表最便宜**的一个。

**降阈值到 `--min-hours 0.1`：清单 11 条**（这是「纯税下界」，不是判决）：

```
strategic-doc-staleness-check   0.33 h  0 拦截   mutation 证明能红: 是
instrument-failure-check        0.33 h  0 拦截   mutation 证明能红: 是
threshold-scope-check           0.24 h  0 拦截   mutation 证明能红: 是
adr016-screen-use-check         0.21 h  0 拦截   mutation 证明能红: 是
test-isolation-check            0.20 h  0 拦截   mutation 证明能红: 是
tick-core-static-check          0.19 h  0 拦截   mutation 证明能红: 是
dead-code-after-return-check    0.18 h  0 拦截   mutation 证明能红: 是
outer-tick-log-check            0.15 h  0 拦截   mutation 证明能红: 是
ac56-recommended-deordered-check 0.14 h 0 拦截   mutation 证明能红: 是
superseded-capability-check     0.13 h  0 拦截   mutation 证明能红: 否  ⚠️
red-on-omission-audit           0.10 h  0 拦截   mutation 证明能红: 是
```

**⚠️ 这一列「mutation 证明能红」是本任务加上的，因为它决定这 11 行该怎么读**：
「拦截数 = 0」有两种成因，**读数本身不能区分**：

1. 被查对象窗口内**确实一直干净**——检查器在正常工作，只是没东西可拦；
2. 检查器**恒绿**——结构上不可能报红（硬规则 3b：「一个恒绿的检查比没有检查更贵」）。

判别靠 `plugin/scripts/checker-mutation-cases/<name>.sh`：有 case ⇒ 已由 `checker-mutation-check`
**证过它能红** ⇒ 排除 ②，这 0 读作「窗口内干净」。
11 行里 **10 行有 case**，**`superseded-capability-check` 没有**（`checker-mutation-cases/` 下
没有它的 case 文件）——那一行两种成因不可区分，**不得据以砍闸**。
（放宽到全表：53 个 0 拦截的 checker 里有 **3 个**没有 case —— 除它之外还有
`tick-core-drift-check`（0.08 h）与 `test-file-snapshot-check`（0.05 h），两者都在 0.1 h 阈值之下。）
（`ready-pool-check` 自己也没有 mutation case，但它是「总是 exit 0 的检测器」而非注册 checker，
本就不在 mutation manifest 的覆盖范围内，这不是缺陷。）

**DoD 明令**：本任务**只报数不删检查器**。删除要另行立案并经人裁定——用一个口径敏感的数去
砍掉一道闸，正是本任务要避免的错误。

## 7. 对 ADR-005 的表态（AC5）

**表态：方向支持；量级不足以判定。**

**支持的那一半（有读数）**：
- 验证侧确实是一个**被独占的、无人在看的**成本：226.0 h 里 **97.9% 集中在单一机制**
  （`ready-pool-check` 221.28 h）。它不是「很多廉价检查」，是**一个昂贵的检查**。
- 它每天都在涨，且**没有任何判据在盯它**（姊妹分析
  `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §4：三周涨 5 倍，
  09-11 单日 19.0 h，约 1 核持续占用）。「稀缺的是检查」在这里有一个可测的形态：
  **一道检查的开销与整条流水线的其它开销同量级**（§4 同期整个测试套件约 231 h）。
- 它的**边际回报可测**：3.35 h 机器时间 / 每个被拦下的去重缺陷。

**不支持 / 不足以判定的那一半（同样有读数）**：
- ADR-005 的完整主张包含「**生成能力不是**稀缺的」，而**本任务没有测量生成侧的成本**
  （LLM token、墙钟、返工）。两侧没有同一轴上的可比读数 ⇒ **「验证 vs 生成谁更稀缺」这个
  比较句，本读数不支持也不否定。**
- **「验证总成本」是一个下界，不是全量**：拦下缺陷**最多**的 `goal` 闸
  （102,860 次判定 / 23,239 次 fail / 去重后 109–184 个缺陷）**结构上没有成本仪器**——
  `goal-driver.ts` 里没有任何成本记录钩子，`checker-cost.jsonl` 里 0 条 `gate:goal:*` 行。
  它每次判定都要跑 AC 的 acceptance 命令，那是真实的机器开销，全部落在读数之外。
- 「每缺陷成本」分母本身依赖去重口径；`goal` 闸那 1.69× 的口径分歧说明**这个量在
  理由频繁变化的闸上不稳**。本任务把它标出来了，但**没有**主张一个跨闸可比的绝对阈值。

**⇒ 一句话**：实测把 ADR-005 **从「只有定性论证」推进到「验证侧有一个 3.35 h/缺陷的
可测单价，且 97.9% 集中在一个没人看的机制上」**；但要把「验证是绑定约束」当成**已判定**，
还缺两块：**生成侧的同轴读数**，以及 **`goal` 闸的成本仪器**。

## 8. 本读数**没有**说的（覆盖缺口）

- **`goal` 闸无成本**（上条）。这是全表最大的洞：拦截数第一，成本列 `n/a`。
- **53 个有拦截通道的 checker 在窗口内 0 次红** —— 不等于「没用」，见 §6 的两种成因。
- **`ts-typecheck` / `adr-001` / `doc-quay-directive-skill` 三个「闸」既无 gate-events 也无拦截通道**
  （它们走别的 gate registry；成本共 0.40 h，量级可忽略）。
- **4/72 个 checker 没有拦截通道**（`capability-catalog` / `delivery-inventory` /
  `ac66-a22-agent-id-check` / `workflows-dual-copy-drift-check`）——它们是「谁按」类的
  登记/审计工具，不是判红检查器，本来就没有拦截语义。
- **成本载体的 `verdict` 字段只覆盖 1,133 行**（2026-09-04 起，fail 6），窗口太窄，
  本任务**不**把它当主通道，只在报告里作旁证计数。
- **`h/D*` 用「机器小时」度量，未折算并发**：`ready-pool-check` 是可并发的（§4 姊妹文档），
  所以 221 h 不等于「221 小时里一直在占着一核」。

## 9. 意义与后续（不在本任务范围）

1. **给 `goal` 闸加成本仪器**——它拦下最多、成本未知。这是把 §7 的「不足以判定」变成
   「可判定」的最小动作。
2. **给 `ready-pool-check` 的 3.35 h/缺陷定一个判据**——它已是单一最大成本项，
   而**没有任何机制在盯它**。姊妹任务
   `tasks/gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite` 修的是它的
   O(库大小) 成本结构；本任务给出的是**收益侧**的数，两者合起来才是一个决策。
3. **`superseded-capability-check` 补一个 mutation case**——它有 0.13 h 成本、0 拦截、
   且**没有** case 证明它能红，是 11 行里唯一读数不可解读的。
