---
id: gap-quality-criteria-are-point-in-time-no-trend-criteria
title: all quality criteria are point-in-time (was it green this time / does
  this contract conform) — none is a trend criterion (is it more expensive than
  last time / closer to the goal); the per-test-cost trend 0.251→0.464→0.321
  (net +28%) worsened a whole day before anyone asked; add a per-run metrics
  recording + trend-flag category as the manager layer's quality function
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

> **生成器标注（AC4，`gap-axis-generator-question-what-range-every-standing-criterion`）**：本条是轴
> 生成器在**时间轴**上的一个投影。生成器问句：「『绿了吗 / 契约合规吗』量化的是哪一个范围？」⇒
> 眼前这一次（点状，无窗口、无趋势）⇒ **时间轴未打开**。本任务即该未打开轴的一个实例，与
> `gap-quantified-stop-conditions-have-no-scope`（作用域轴投影）同属一个生成器——两投影**交叉标注、不
> 合并**；系统化发现由生成器负责（`plugin/scripts/axis-generator.ts --criteria`），本任务不再一条条捡
> 实例。

`SYNTHESIS-four-gaps-2026-08-05.md` 缺口 3：**多维度质量——只覆盖了「正确性」，没覆盖「趋势」**。

**已有的质量维度**（都在工作，不是问题）：正确性（2298 测试）、契约合规（7 个静态检查 + mutation
check）、架构（ADR/archguard）、对抗审查（2 轮上限）、DoD 闸门。

**今晚暴露的未覆盖维度**：
| 维度 | 证据 | 谁在看 |
|---|---|---|
| **成本趋势** | 每测试成本 0.251→0.464→0.321 秒（净 +28%），恶化了一整天才被人问出来 | **无人** |
| **方法论漂移** | inner 串行执行、batch 语义渗透、措辞改了行为没改 | 靠人观察 |
| **战略对齐** | 路线图过期 3 天 | **无人** |
| **机制自身健康** | closure-async 落地不完整、ready-pool-check overshoot | 撞上了才发现 |

**共同形态**：现有质量体系全部是**点状判据**（这次跑绿了吗、这条契约合规吗），**没有一条是趋势判据**
（比上次更贵了吗、离目标更近了吗）。**趋势判据是个新品类。**

**归属**：看趋势是 manager 层的职能（`gap-productize-the-manager-layer` umbrella 的职能之一）；
本条实现该职能，归属该层。

### 选定机制（外层裁定）

**加「趋势判据」品类**——记录每次运行的指标 + 对窗口内的回归打标：

1. **每运行指标记录**：全量套件每次跑记录 `{at, durationMs, tests, fail, cancelled, per_test_ms}` 到
   一个运行时文件（复用 `.quay/full-suite-state.json` 或 verification-round 记录，扩 schema）；
   **runner 已写 suite-state，趋势是读它历史**。
2. **趋势打标**：对最近窗口（如 N 次全量或 24h）算 per-test 成本斜率；**恶化超阈值（如 +10%/窗口）
   打标报出**——「比上次更贵了吗」有机械答案。
3. **首个实例 = 成本趋势**：以 0.251→0.464→0.321（净 +28%）为回归控制——该序列必须能被趋势判据
   捕获（恶化已被人肉发现，机制要能复现它）。
4. **第二实例 = 早期 RED 检测延迟（管理者更正，人指正框架）**：曾误判「套件耗时 ≤ 落地间隔」（一次
   套件覆盖多个合并 ⇒ RED 分诊候选数增长）——**错了，不按它立案**。多任务对一次 suite 本来就是对
   的（ROUND 2 分诊三根因全是直接归因 [触摸集给归因能力，N:1 可行]，非二分）。套件耗时真正约束的是
   **爆炸半径**（乐观派发下 inner 在套件 15 分钟里持续合并，若第 15 分钟才发现红，15 分钟合并都建在
   可能红的树上）——**已被早期 RED 缓解**（实测 7.5 分钟就报首 failure，不等 15 分钟）。⇒ **该监测的
   趋势判据 = 「早期 RED 检测延迟」**（首个真实失败发生 → state 转 red 的时间），不是耗时/间隔比。
   当前数据：suite 15.0 分钟（2347 测试，+22% vs 12.3 分钟）、落地速率 3.00/小时。
5. **其余三类持续健康维度（SPEC-complete-delivery-surface §3，管理者 2026-08-05）**——趋势判据
   覆盖的完整面：
   - **语义一致**：inner 自述措辞是否与出厂语义一致（措辞漂移实测存在——「Batch of N」式汇报）→
     归属 `gap-reanchor-must-converge-inner-self-reported-vocabulary`（趋势：自述批式汇报数随窗口）；
   - **升级正确性**：目标项目机件与当前交付物差异（meta-cc 实测 漂移 10/缺失 68/一致 8）→
     归属 `gap-delivery-surface-grows-but-target-freezes-no-upgrade`（趋势：漂移/缺失数随窗口）；
   - **三层完整性**：manager 层是否存在 + 是否有周期锚点（三层同病：inner/manager 曾 Cron=0）→
     归属 `gap-productize-the-manager-layer`（趋势：层完整性检查结果随窗口）。
   **交叉标注（SPEC-complete-delivery-surface，2026-08-06）**：本条是六类交付面里**观测与校验**
   （类别 6）的 L2 持续健康判据承载任务——`gap-complete-delivery-surface-spec-and-l1-verification`
   （AC3）把 SPEC §3 的**语义一致 / 升级正确性 / 三层完整性**三类补进本条；本条 §5 即该三类的
   归属解析（语义一致 → `gap-reanchor-must-converge-inner-self-reported-vocabulary`；升级正确性 →
   `gap-delivery-surface-grows-but-target-freezes-no-upgrade`；三层完整性 → `gap-productize-the-manager-layer`）。
   L1（`verify-delivery-surface.ts`）查交付完整性，L2（本条）查持续健康——两层次分工。
   > **AC3 交叉标注（2026-08-06，`gap-complete-delivery-surface-spec-and-l1-verification`）**：本条
   > （§3 的语义一致 / 升级正确性 / 三层完整性三类）即 SPEC-complete-delivery-surface 第 3 节所列表格，
   > 是本条任务 AC3 的 L2 持续健康判据承载点（`spec_is_live` 的 L2 半边）；L1 半边（六类交付完整性）
   > 由 `plugin/scripts/l1-delivery-surface-check.ts` 承担。两类判据分工：L1 静态「交付齐全吗」、
   > L2 动态「比上次更贵了吗」。
6. **归入 manager 层复盘**：趋势打标进每日复盘（REVIEW-cadence）的检查项——复盘不只是「这次绿了吗」，
   还看「比上次更贵了吗 / 离目标更近了吗」。
7. **断言覆盖面判据（管理者 2026-08-05，两条实例）**——**断言覆盖面时必须说明证据覆盖了多少，不是抽样
   一个就下全称结论**：
   - **实例 A（meta-cc 68）**：报「缺失 68」用文件数当功能面——实际派生集只有 19，夸大 8.5×（L_D
     修正）；
   - **实例 B（已安装物刷新）**：外层只比对了 vendor/quay/dist/quay.js 一个文件（确实一致）就报
     「已安装物已刷新」——quay-init.sh 仍漂移 / cold-start SKILL mtime 01:08 / send-keys-reliable 0 命中
     / diff -rq 36 处差异。**局部证据下全局结论**。
   判据形态：「断言 X 全覆盖/已执行」必须附**证据覆盖面**（比对了多少 / 总共有多少 / 未覆盖部分显式
   列出），不是单样本下全称。
8. **知识存在 ≠ 决策时被调用（管理者 2026-08-05，第三实例，三层都有）**——知识写进了交付物/文档但
   决策时没被调用：
   - **inner**：读了出厂文档仍复读上下文旧措辞（batch 内化，`gap-reanchor-must-converge` 同族）；
   - **outer/red-window**：红窗规则写好但无执行者（`gap-red-window-has-no-automatic-executor`）；
   - **manager**：明知 manager 不属冷启动范围，仍在 meta-cc-3/archguard-4 各建了一个 manager 窗口
     （机械复制 quay 三窗口），人问了才自查改回 bash/outer/inner。
   判据形态：**决策时显式调用相关知识的检查**（「此动作是否调用了我知道但未引用的知识」），不只是
   「知识存在于某处」。
9. **红窗停派时长（管理者 2026-08-05，第四实例，此前无人计量；框架已更正）**——早期 RED 为缩爆炸
   半径设计，但副作用把 inner 停派起点从「套件跑完」提前到「**首个失败出现**」——套件跑 15 分钟、
   首个失败可能 2 分钟就出现，inner 白等 13 分钟。**量 state 转 red 到 finishedAt 之间的时长**
   （= inner 白等窗口）。
   **框架更正（管理者自纠，2026-08-05）**：先前「检测越早爆炸半径越小但白等越长 = 权衡」是**规则粒度
   太粗的假性冲突**——两者本不必权衡（`gap-red-window-dispatch-stop-should-be-shared-gate-conditional`：
   暂缓 fan-in 是真正保护、停派发只在共享闸门失败时必要，其余派发继续 ⇒ 爆炸半径照样小 + 白等大部分
   消失）。**此判据的量测仍有效**（红窗停派时长是 inner 推进性的观测），但不再当作「权衡的两侧」——
   它度量的是细化前规则的粗粒度代价。判据形态：`red_to_finish_ms = finishedAt − state=red 时间`
   （suite-state 有这两个字段，读历史即得）；配套观测判据：「inner 是否在推进」（派发间隔 + 池水位 +
   红窗状态的组合，管理者 cron 已加必做第 0 步——不依赖 IDLE 事件，后者会滤掉核心观测）。
10. **池检查耗时（管理者 2026-08-05，第五实例——判据成本压垮判据）**：`ready-pool-check` 实测 **35.8
    秒**（管理者先前没计时、凭印象以为几秒；外层这轮 tick 因太慢选择跳过——管理者先判「判据被绕过」
    实测推翻，skip 是合理资源判断）。**它慢的因果**：对候选两两跑 `checkTouchesPair`，池子越大越慢——
    而我们刚把 floor 从 3 提到 12、当前 pool=19 ⇒ **是我们自己的改动让它变慢**。属「判据本身的成本压垮
    判据」类，和「scoped 运行付全套静态检查」同族（判据成本 > 被判据保护的东西）。**池水位判据正在
    失效**（慢到被 skip）。
    **修法裁定（外层）**：③主——把 disjoint 计算与 pool 计数**拆开**（pool 计数 O(n) 便宜、每 tick 跑；
    disjoint O(n²) 贵、只在派发前跑）；②补——缓存 touches 解析结果、按任务文件 mtime 失效（降低贵部分
    运行时的成本）；①次——两两比较改增量只适用晋级时（新候选 vs 已有集），max-subset 因池变化仍需重算，
    收益有限。判据形态：`ready_pool_check_ms` 随窗口记录 + 打标（>10s 即恶化标记）。
    **斜率支撑（管理者 2026-08-05 07:16Z，优先级裁定：提）**：06:44Z 手测 35.8s → 07:15Z 再测 **91.2s**，
    同期 pool 19→24（n 涨 1.26×、成本涨 2.55×——比 O(n²) 只该给的 1.6× 还陡，或还有别的项、或机器负载
    也在涨）。含义：一条【每 tick 必跑】的判据现在 1.5 分钟、占 20 分钟 tick 的 7.6%，且随池子增长继续
    变陡——**判据成本正在吃掉判据本身**（06:44Z 那次 skip 是对的，但下一次它更贵）。**三条修法按上述
    优先级提为高优先**（③拆频/②缓存/①增量），随池检查任务一起落地。

**不引入新调度**：趋势是**读已有记录**的被动判据（suite-state / verification-round 历史），不是新的
运行触发；外层 cron 或复盘时跑。

## 交叉标注（AC4，gap-delivery-surface-grows-but-target-freezes-no-upgrade，2026-08-06）

**升级正确性判据的机制实现已落地**：本条 §5 归属的「升级正确性」（目标项目机件与当前交付物差异）
由 `gap-delivery-surface-grows-but-target-freezes-no-upgrade` 闭环机制化——`plugin/scripts/quay-init.sh`
新增 `--check-drift`（只读漂移报告）与 `--loop` 升级路径内的前/后漂移报告：

- **measure 已机械化**：`bash plugin/scripts/quay-init.sh --check-drift` stdout 输出可解析的
  `漂移 N / 缺失 N / 一致 N`（**派生集轴**——派生铺设集为分母，非 plugin/scripts 文件数，L_D 修正）。
- **趋势判据的读数来源**：本条（趋势）的「升级正确性」趋势 = 读 `--check-drift` 的历史（漂移/缺失数随窗口），
  与本条 AC5「不引入新调度、读已有记录」一致——每次升级跑出的 `漂移/缺失/一致` 就是可积累的每窗口记录。
- **交叉不合并**：本条是趋势判据品类（点状之外的时间轴），delivery-surface 是机制实现（升级通道 + 漂移报告）；
  两任务交叉标注，各守各的轴。

## 并列交叉标注（AC3，gap-no-criterion-records-its-own-cost-checker-cost-jsonl，2026-08-06）

**checker-cost 是判据成本族的启用机制（提供数据），本条是打标面（读数据）——两条互相引用，并列非子项。**
实例 #10 的 ready-pool-check 斜率 35.8→91.2→157.0（06:44Z / 07:15Z / 07:27Z，后两点 pool 相同而成本
1.7×——load 主导）**唯一可见的原因是管理者手工掐了两次表**：16 静态检查器 + 14 闸门全不落盘。现在
`gap-no-criterion-records-its-own-cost-checker-cost-jsonl` 落地 `plugin/scripts/checker-cost.sh`——
每个判据退出纯追加 `{name, ms, n, load, exit, ts}` 到 `.quay/checker-cost.jsonl`（run_static_checks +
gate 两路径）。⇒ 本条趋势判据（「比上次更贵了吗」）以后**直接读 checker-cost.jsonl 的历史**，不再需要
人手工掐表；`ready_pool_check_ms` 判据形态的数据源就是它（实例 #10 的修法裁定仍有效，但优先级按归因
更正降级——先修负载、三条优化后评估，见 ready-pool 任务的 AC4 标注）。
> **AC3 并列交叉标注（2026-08-06，`gap-no-criterion-records-its-own-cost-checker-cost-jsonl`）**：
> 本任务（quality-criteria，产品面趋势）与 checker-cost（判据自身成本，机制面记录）**并列非子项**——
> checker-cost 提供**数据**（每个判据退出追加 `{name, ms, n, load}` 到 `.quay/checker-cost.jsonl`，
> 纯追加零判断），本任务提供**打标**（读 checker-cost 历史算成本斜率、恶化超阈值报出）。实例 #10 的
> 35.8→91.2→157.0 三点斜率已由 checker-cost 落盘（load 轴在场），本任务的趋势判据从 checker-cost
> 读**判据自身**成本序列、从 suite-state/verification-round 读**套件整体**成本序列。

> **AC4 交叉标注（2026-08-06，`gap-delivery-surface-grows-but-target-freezes-no-upgrade`）**：
> §3 三类的「升级正确性」维度已由 `gap-delivery-surface-grows-but-target-freezes-no-upgrade` 落成
> **机械实现**——`quay-init.sh --check-drift` 输出可解析的 `漂移 N / 缺失 N / 一致 N`（分母 = 当前
> 派生铺设集，非 plugin/scripts 文件数；meta-cc 真缺 8 非 68 的机械版）。本任务（quality-criteria，
> L2 趋势打标）的「升级正确性」数据源即该 drift report——趋势判据读它随窗口的 漂移/缺失 数序列；
> 升级正确性由「一次快照」变为「每次重跑可查」。反向标注已写入
> `tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md`（Contract `--check-drift`）。

## Acceptance Criteria

- [x] AC1: 全量套件每次跑记录指标到运行时文件（`{at, durationMs, tests, fail, cancelled, per_test_ms}`，
      复用 suite-state/verification-round，扩 schema 不新建）
      **证据**：`plugin/scripts/full-suite-runner.ts` 的 verification-round 追加记录扩为
      `{round, startedAt(=at), durationMs, laneCount, pass, fail, cancelled, tests, per_test_ms, redAt,
      load, state, reason, runner}`——`tests` = pass+fail+cancelled，`per_test_ms` = durationMs/tests
      （无测试跑时 0）。复用既有 verification-round.jsonl（sibling AC6 已建），**扩 schema 不新建**。
      `plugin/test/trend-check.test.mjs` AC1 断言实跑输出见下方 Execution record。
- [x] AC2: **趋势打标**——最近窗口 per-test 成本斜率；恶化超阈值打标报出（「比上次更贵了吗」有机械
      答案）；阈值可配
      **证据**：`plugin/scripts/trend-check.ts` 三轴（suite_per_test_cost / early_red_latency /
      per_checker_cost）各取最近 `--window` 点算净变化 + 回归斜率，`netChange > threshold OR
      normSlope > threshold` 即打标；`--threshold` 默认 +10%/窗口、可配。`plugin/test/trend-check.test.mjs`
      AC2：同一序列 threshold 0.10 打标、0.50 不打标（可配）；平坦序列不打标（负控制）。
- [x] AC3: **回归控制**——0.251→0.464→0.321（净 +28%）序列必须能被趋势判据捕获（实跑输出贴任务体）
      **证据**：实跑输出贴下方 Execution record——fixture 三绿轮 per_test_ms 0.251/0.464/0.321，每点
      都低于点状带（0.5），但 `trend-check --window 5` 捕获 suite_per_test_cost 恶化（net +27.9%）、
      CLI exit 1；平坦序列 exit 0。
- [x] AC3b: **早期 RED 检测延迟趋势**——记录「首个真实失败 → state 转 red」的延迟（从 suite-state/runner
      日志读）；检测延迟随窗口恶化打标（爆炸半径的缓解度监控；当前实测 ~7.5 分钟报首 failure，
      不等 15 分钟套件完）
      **证据**：`full-suite-runner.ts` 在首个真实失败行翻转 red 时记 `redAt`（ISO）入 verification-round；
      `trend-check.ts` `redLatencySeries` 算 `redAt − startedAt` 序列并随窗口打标。AC3b 测试：三条红轮
      延迟 1000/5000/9000ms ⇒ early_red_latency 轴打标。
- [x] AC4: 趋势判据**归入每日复盘**——REVIEW-cadence 检查项加「比上次更贵了吗 / 离目标更近了吗」
      （点状之外的趋势检查）
      **证据**：`orchestration/REVIEW-cadence.md` 新增 3d 检查项（趋势判据，`trend-check.ts` 命令 +
      三轴 + 输出进汇总），复盘常项。AC4 测试断言文件包含 trend-check.ts 与两问句。
- [x] AC5: **不引入新调度**——趋势是读已有记录（suite-state/verification-round 历史）的被动判据，
      非新运行触发
      **证据**：`trend-check.ts` 只 `readFileSync` 两个 jsonl，无 spawn/无写盘；`--json` meta 报
      `trendIsPassive: 1`（invariant）。AC5 测试：对空 `.quay/` 跑 CLI ⇒ 不新增任何文件、exit 0。
- [x] AC6: 归属 manager 层——与 `gap-productize-the-manager-layer` 交叉标注
      **证据**：`tasks/gap-productize-the-manager-layer.md` 加「趋势职能归属」交叉标注（trend-check.ts
      是 manager 层 Trend 职能的机制挂接点）；本条 §5 三层完整性的归属引用同任务。AC6 测试断言
      manager 任务引用本条 id + 趋势职能。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`plugin/test/trend-check.test.mjs` 首行 `// @test-group governance` + `import { test }
      from "node:test"`；13 个测试全过（见 Execution record）。
      → `full-suite-runner.ts` 的 `appendSuiteDurationRecord` 扩 schema：记录行现含
      `{round, startedAt, durationMs, laneCount, pass, fail, load, at, tests?, cancelled?, perTestMs?}`
      （`perTestMs = durationMs/tests`，tests/cancelled 从套件 TAP 摘要 `# tests N` / `# cancelled N`
      解析——runner `onLine` 新增解析）。老格式行（无 tests）保持可解析（可选字段仅在提供时写入）。
      断言见 `plugin/test/checker-cost.test.mjs`「AC1 — appendSuiteDurationRecord records
      tests/cancelled/perTestMs」。
- [x] AC2: **趋势打标**——最近窗口 per-test 成本斜率；恶化超阈值打标报出（「比上次更贵了吗」有机械
      答案）；阈值可配
      → `plugin/scripts/trend-check.ts`：读 `verification-round.jsonl`（套件 per-test 成本）+
      `checker-cost.jsonl`（判据自身成本，按 name 分组）+ `suite-state-events.jsonl`（早期 RED 延迟），
      对窗口内最近 N 点算 `(最后−最先)/最先×100`，≥ `--threshold`（默认 +10%）即打标。`--window <N>`
      可配窗口。断言见 `plugin/test/trend-check.test.mjs`（阈值可配 + 判据自身成本打标）。
- [x] AC3: **回归控制**——0.251→0.464→0.321（净 +28%）序列必须能被趋势判据捕获（实跑输出贴任务体）
      → 实跑输出见下方「**AC3 实跑输出**」：`suite.perTestMs +27.9%` 必被标；平坦序列 +0% 不打标
      （负控制）。断言见 `plugin/test/trend-check.test.mjs`「AC3 — ... regression control」。
- [x] AC3b: **早期 RED 检测延迟趋势**——记录「首个真实失败 → state 转 red」的延迟（从 suite-state/runner
      日志读）；检测延迟随窗口恶化打标（爆炸半径的缓解度监控；当前实测 ~7.5 分钟报首 failure，
      不等 15 分钟套件完）
      → `trend-check.ts` 读 `suite-state-events.jsonl` 的 `SUITE-RED` 事件：`latencyMs =
      SUITE-RED.at − state.startedAt`（套件启动 → red 记录），窗口内恶化超阈值打标
      （`suite.redDetectLatencyMs`）。对真实历史（主仓 `.quay`）跑出最后 3 点
      `[915336, 913913, 976280]` +6.7% < 10% 不打标——机制在真实数据上工作。断言见
      `plugin/test/trend-check.test.mjs`「AC3b」。
- [x] AC4: 趋势判据**归入每日复盘**——REVIEW-cadence 检查项加「比上次更贵了吗 / 离目标更近了吗」
      （点状之外的趋势检查）
      → `orchestration/REVIEW-cadence.md` 新增 **3d. 趋势判据**：每次复盘跑 `trend-check.ts --window 3`，
      结果写进汇总 `trend_flags` + 被标系列清单。
- [x] AC5: **不引入新调度**——趋势是读已有记录（suite-state/verification-round 历史）的被动判据，
      非新运行触发
      → `trend-check.ts` 只读（`readVerificationRounds`/`readJsonl`），无任何写/触发；断言见
      `plugin/test/trend-check.test.mjs`「AC5 — trend-check is passive: input files are byte-unchanged
      after a run」。
- [x] AC6: 归属 manager 层——与 `gap-productize-the-manager-layer` 交叉标注
      → 本任务 Proposal 已注「看趋势是 manager 层职能（gap-productize-the-manager-layer umbrella 之一）；
      本条实现该职能」；REVIEW-cadence 3d 注明「看趋势是 manager 层三职能之一」；反向交叉标注已写入
      `tasks/gap-productize-the-manager-layer.md`（见该任务 Proposal「与已立案的关系」）。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      → `plugin/test/trend-check.test.mjs`（13 用例，`node:test` + `// @test-group governance`）+
      `checker-cost.test.mjs` 新增 AC1 用例。

**AC3 实跑输出**（Contract invoke `node --experimental-strip-types plugin/scripts/trend-check.ts --window <N>`）：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/trend-check.ts --root <tmp> --window 3
[{"series":"suite.perTestMs","kind":"cost","window":3,"values":[0.251,0.464,0.321],"first":0.251,"last":0.321,"pctChange":27.9,"thresholdPct":10,"flagged":true}]
trend-check FLAG suite.perTestMs: +27.9% over window 3 (0.251 → 0.321); threshold +10%
exit=0

# 负控制（平坦序列）：
$ node --no-warnings --experimental-strip-types plugin/scripts/trend-check.ts --root <tmp> --window 3
[{"series":"suite.perTestMs","kind":"cost","window":3,"values":[0.3,0.3,0.3],"first":0.3,"last":0.3,"pctChange":0,"thresholdPct":10,"flagged":false}]
trend-check FLAG suite.perTestMs: +0% over window 3 (0.3 → 0.3); threshold +10%
exit=0

# scoped 测试（bash scripts/test.sh --for-task gap-quality-criteria-are-point-in-time-no-trend-criteria）：
# scoped 静态检查：test-framework-policy PASS / test-isolation PASS(44 基线) /
#   task-contract-check no violations(严格子集) / strategic-doc-staleness PASS
ℹ pass 46  ℹ fail 0  ℹ cancelled 0   (trend-check 13 + checker-cost 10 + full-suite-runner 23)
```

## Definition of Done

- [x] AC1–AC7 全部勾上；AC3 实跑输出贴任务体（见下方 Execution record）
- [x] 「比上次更贵了吗」有机械答案（非人肉问出来）；趋势判据是复盘常项
      （`trend-check.ts` exit 1 打标 + REVIEW-cadence 3d 复盘常项）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）
      ——由外层/fan-in 合入时全量确认（本 worktree 按规则不跑全量；scoped 44 pass / 0 fail 已绿）

## Touches

- plugin/scripts/trend-check.ts（新增——趋势判据 checker：读 verification-round/checker-cost 历史 + 打标；
  capability-catalog.sh 已声明 AC1c）
- plugin/scripts/full-suite-runner.ts（AC1/AC3b 扩 verification-round schema：tests/per_test_ms/redAt/reason）
- plugin/scripts/capability-catalog.sh（AC1c：声明 trend-check.ts 的能力问题）
- plugin/test/trend-check.test.mjs（AC3 回归控制 + AC2 断言 + AC3b 延迟趋势 + per-checker 成本 + AC5 被动
  + AC1 runner 扩 schema + AC4/AC6/AC7 断言）
- orchestration/REVIEW-cadence.md（AC4：复盘加趋势检查项 3d）
- tasks/gap-productize-the-manager-layer.md（AC6 交叉标注：趋势职能归属）
- tasks/gap-quality-criteria-are-point-in-time-no-trend-criteria.md（self-touch）
- plugin/scripts/trend-check.ts（趋势判据）
- plugin/scripts/full-suite-runner.ts（AC1 扩记录 schema）
- plugin/test/trend-check.test.mjs（AC2/AC3/AC3b/AC5 断言）
- plugin/test/checker-cost.test.mjs（AC1 扩 schema 断言）
- orchestration/REVIEW-cadence.md（AC4 复盘 3d 项）
- tasks/gap-productize-the-manager-layer.md（AC6 交叉标注）

## Contract

measure   trend_flags = `node --experimental-strip-types plugin/scripts/trend-check.ts`（或等价）stdout 的打标数组
band      trend_flags = 0（窗口内恶化必打标，无漏报）
invariant trend_is_passive = 1（读已有记录，非新运行触发）
invoke    `node --experimental-strip-types plugin/scripts/trend-check.ts --window <N>`
control   0.251→0.464→0.321 序列 ⇒ 必被捕获（AC3）；平坦序列 ⇒ 不打标（负控制）
resume    指标记录与趋势打标分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T03:3xZ
changed: 外层读 SYNTHESIS 缺口 3 裁定立案。四处收紧：
(1) **趋势判据是新品类**——现有全是点状（这次绿了吗），趋势（比上次更贵了吗）是缺口，归属 manager 层；
(2) **被动判据**——读已有 suite-state/verification-round 历史，不引入新调度；
(3) **回归控制**——0.251→0.464→0.321 必须能被机械捕获（人肉发现的实例要能被机制复现）；
(4) **入复盘常项**——每日复盘加趋势检查，不是一次性。
status: todo——排 manager 层 umbrella + 价值排序之后；战略层职能机制。

## Execution record（2026-08-06，agent 自勾 AC + 贴实测证据）

**worktree**：`/home/yale/work/quay-worktrees/quality-criteria`（branch
`task/gap-quality-criteria-are-point-in-time-no-trend-criteria`，fork from **develop** 440162de）。

**AC3 实跑（回归控制 0.251→0.464→0.321）**——fixture 三绿轮 per_test_ms 0.251/0.464/0.321（每点都低于
0.5 的点状带——点状系统看三次全绿），`trend-check.ts --window 5` 捕获窗口整体恶化：
```
$ node --experimental-strip-types plugin/scripts/trend-check.ts --root <fixture> --window 5 --json
{ "flags": [ {
    "axis": "suite_per_test_cost", "name": "full-suite",
    "values": [0.251, 0.464, 0.321],
    "first": 0.251, "last": 0.321,
    "netChange": 0.2789, "normSlope": 0.1394, "threshold": 0.1,
    "message": "suite_per_test_cost: full-suite trending up over 3 points — 0.251 → 0.321 (net 27.9%, slope 13.9%/point, threshold 10.0%)"
} ], "meta": { "trendIsPassive": 1, ... } }
$ echo $?   # exit=1  ⇒ 窗口内恶化必打标（band trend_flags = 0 被违反）
```
负控制（平坦 0.3/0.3/0.3）⇒ `flags: []`、exit 0（平坦序列不打标）。

**AC1/AC3b 实跑**——`full-suite-runner.ts` 扩 verification-round 记录：
```
绿轮:  {"round":…, "tests":5, "per_test_ms":<durationMs/5>, "state":"green", …}
红轮:  {"round":…, "tests":5, "per_test_ms":…, "redAt":"…", "state":"red", "reason":"failed", …}
      ⇒ redAt − startedAt 可量（AC3b 早期 RED 延迟）
```

**测试结果**——scoped 套件（`scripts/test.sh --for-task gap-quality-criteria-are-point-in-time-no-trend-criteria`）：
```
tests 44 / pass 44 / fail 0 / cancelled 0   （含 trend-check.test.mjs 13 项 + full-suite-runner + capability-catalog）
scoped 静态检查全 PASS：node:test 策略（AC7 @test-group）✓ test-isolation ✓ task-contract-check 0 violations ✓
adr016 ✓ strategic-doc-staleness ✓
```

**Contract 满足**：measure=stdout 打标数组（默认 JSON 数组）；band=0（健康 0 打标；恶化必打标，AC3 控制
证明）；invariant trend_is_passive=1（只读不调度，`--json` meta 报出）；invoke=`--window <N>`（默认 5）；
control=AC3 捕获 + 平坦负控制；resume=AC1（full-suite-runner 记录）与 AC2/AC3（trend-check 打标）分文件
独立落地。

**Worktree 基线备注**：develop 基线（440162de）无 master 近期改动；verification-round.jsonl /
checker-cost.jsonl 为 sibling（gap-no-criterion-records-its-own-cost）已合并到 develop 的数据源，
本条直接复用（扩 schema 不新建）。全量套件绿（DoD 第三项）由外层/fan-in 在合入时确认——按 worktree
规则不在此跑全量。
