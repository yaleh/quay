# manager 阶段目标

> **历史阶段（AC1–AC53）的正文已于 2026-08-14 10:4xZ 迁至
> [`manager-phase-goal-archive.md`](manager-phase-goal-archive.md)**（SPEC-tick-read-path-slimming §2-B）。
> **本文件只保留【当前阶段 AC54–AC78】+ 关键路径 + 归属与边界。**
> 回查历史 AC ⇒ 读 archive；**新 AC 一律写在本文件**。

---

## ✅ 已达成阶段（**2026-08-21 16:5xZ 起 – 2026-08-22 15:3xZ 全部达成 8/8 + AC124 窗口判据满足**）：按变更选择性执行 —— suite 三桶划分

**⊕ 2026-08-22 15:3xZ 达成核算（manager 直读 `.quay/verification-round.jsonl`，锚 `2026-08-21T23:04:39Z` 后）**：
```
总带桶轮次 15 ≥ 10                                    ✓
P-only n=3 ≥ 3   中位 296432ms = 全量的 33.7% ≤ 40%   ✓
M-only n=3 ≥ 3   中位 294917ms = 全量的 33.5% ≤ 40%   ✓
full   n=9       中位 880341ms（40% 阈值 = 352136ms）
```
⇒ **AC124 三条件（轮数 / P·M 各 ≥3 / 中位 ≤40%）全部满足，本阶段 AC120–AC127 全部达成。**
⊢ 实测收益略优于裁决时 accept 的 41.6%（P 33.7% / M 33.5%）；⛔ 不改判据、不追记为"超额"——
判据是 ≤40%，达标即达标（硬规则 4：不为已达成的量再造新阈值）。

**来源**：人 2026-08-21 16:4xZ 逐字裁定链（三条，以最后一条为准）：
① 「进一步检查现有测试和它们对应的实现。历史上发现大量实现只是在做对 agent 不可靠的行为的检查。考虑分离这些检查机制及其测试，为它们另建一组测试，并在未来有区分地执行面向交付物的 suite 测试和面向非交付物的测试。」
② **纠正**：「我希望不是降频执行测试，而是**根据变更有选择地执行测试**。」
③ **再纠正（本阶段的确切范围）**：「我说的是**比 scoped 门更大颗粒度、用于替代 suite 测试的机制**。例如，涉及到交付物的，我显然希望把交付物的所有测试都跑一遍。可以找到合适的边界来划分这些测试吗？」

**⊢ 与既有机制的分工（⛔ 不得混淆，三者粒度不同）**：
- `select-tests-for-touches.ts`（**已存在已接线**，`scripts/test.sh:1967/2017` 的 `--for-task`）= **文件级** scoped 门，判据是 basename 配对。**本阶段不动它**。
- **本阶段 = 桶级**：把测试划成少数几个互斥桶，按变更触及的源码树选**整桶**。这是人③明确要的"更大颗粒度、替代 suite"。
- 「交付面清单」（manager 08-21 16:3xZ 曾投递 outer 的那条）答的是"什么该常跑"，**本阶段答"这次该跑哪几桶"**。⇒ **本阶段取代那条投递**，清单降为本阶段的副产物（桶 P 的成员表即是）。

### 切换前实测基线（manager 2026-08-21 16:2x–16:5xZ 直接量实测，⛔ 后续 AC 一律锚在这些量上）

```
全量基线（最近一轮真实 fan-in suite 日志的 __PERFILE__ 逐文件耗时）
  421 文件 / 7820.3s 文件时间

可分性（442 个测试文件按"引用哪棵源码树"静态归类，import 相对路径已规范化）
  跨桶测试 40 / 442 = 9.0%
    plugin/test → 碰 packages/*/src|bin|dist ：23 / 263 = 8.7%
    packages/*/test → 碰 plugin/scripts     ：12 / 119 = 10.1%
  静态可定位被测对象：252 / 263 plugin/test = 95.8%（122 import + 167 路径字面量；仅 11 不可定位）

变更的桶分布（最近 7 天 170 个"翻 done 且有 ## Touches"的真实任务）
  仅 M 机件      102 (60.0%)
  仅 P 产品包     23 (13.5%)
  含 H 枢纽⇒全量  22 (12.9%)
  跨桶 M+P        13 ( 7.6%)
  仅文档/任务      10 ( 5.9%)
  ⇒ 单一代码桶（含零代码桶）合计 79.4%

三桶切分的实测代价（互斥归属）
  P 产品包                        119 文件  1715.9s (21.9%)
  S 套件基础设施(调 test.sh/测 runner) 230 文件  4687.3s (59.9%)
  M 其余机件                       72 文件  1417.1s (18.1%)

二分 vs 三分（按上面的任务分布加权期望）
  P/M 二分：期望 6086.8s ⇒ 仅省 22.2%（因 M 桶 = 89.4% 全量，而 60% 任务落在 M）
  P/S/M 三分：期望 2685.1s ⇒ 省 65.7%    ← 本阶段目标形态
```

**⚠️ 落点注记（2026-08-21 19:4xZ，manager 自加，三次同形裁决后立）**：
**本块所有数字均为 2026-08-21 16:2x–16:5xZ 窗口分析的【派生计数】，成员清单从未落盘**——
「421/7820.3」「40/442」「122 import + 167 字面量」「11 不可定位」「170 任务的桶分布」「22 含枢纽」「119/230/72 桶成员」概莫能外。
**已为此付出三次裁决代价（同日）**：①AC120 取假样本「11 不可定位」实测 9（11 系宽口径计数）⇒ 裁 11→9（69f48e63）；
②cpu_time_s AC3「==0」对 8 条存量恒红 ⇒ 裁「0 新」窗口语义（1d230958）；
③AC122「22 个 hub 任务回放」清单不存在、窗口已滑不可复现 ⇒ 裁改 invariant（c615ae4f）。
**⇒ 后续 AC 两条硬规矩**：(a) 判据需要清单的，**立案时**用可复跑命令现推并**把清单落盘**，⛔ 只给计数；
(b) 否则判据写成 **invariant**（性质断言），判据对象 = 机件自身**可复跑的决策输出**，不钉历史 cohort。
**⊢ 一般形态**：基线计数是分析时刻的快照，窗口滑动后不可复现；把快照计数钉进判据 = 把一个会蒸发的对象当锚（同「判据不得引用生命周期短于判据的对象」）。

```
⚠️ 已实测的最大风险（本阶段的实际工作量所在）
  230 个"调用 scripts/test.sh"的测试里：
    97 个真测套件语义（引用 --list-files/--group/lane/concurrency/__GROUP__ 等）⇒ 归 S 安全
   133 个只是把 test.sh 当壳调用，本身测别的机件
        （concurrent-batch-scheduler / slot-refill-heartbeat / judgment-consumer-check /
          verify-delivery-surface / execution-policy / inner-idle-log / self-report-vocab-audit …）
   ⇒ 这 133 个若被误归 S 并在 M 变更时跳过 = 真实漏测
```

### AC120（桶归属判据机械化，且能取假）
**判据**：产出一个机件，输入 = 一个测试文件路径，输出 = `P | S | M | UNRESOLVED` 之一，判据是**静态引用闭包**（import 相对路径规范化 + `plugin/scripts` / `packages/*/(src|bin|dist)` / `scripts/test.sh` 路径字面量），⛔ 不得用 basename 配对、⛔ 不得用目录归属当唯一依据（`plugin/` 整树随 npm 交付，目录不等于桶）。
**取假**：对本文件基线里的三组已知样本回放——(a) `packages/quay/test/*` 中碰 `plugin/scripts` 的 12 个必须判为跨桶（同时属 P 与 M），(b) `plugin/test/*` 中碰 packages 源码的 23 个同理，(c) 静态不可定位的 11 个必须输出 `UNRESOLVED`（⛔ 不得默认归任一桶——硬规则 3b：读不懂 ≠ 合格）。任一组不符 ⇒ 本 AC 未达成。

### AC121（**133 个疑似误归的逐条重新归属** —— 本阶段的前提，⛔ 不做完不得启用分桶执行）
**判据**：对基线里那 230 个调用 `scripts/test.sh` 的测试逐条给出 `S`（真测套件语义）或 `M`（只是用 test.sh 当壳）的判定并落记录，**判定数 = 230**，可机械核对。
**取假**：判定完成后用同一谓词重扫，"调用 test.sh 且未被逐条判定"这一类**必须为 0**。
**⊢ 为什么这是前提**：这 133 个是本方案唯一的真漏测风险（基线已实测）。**在它完成之前启用分桶执行，等于给出一个会漏测的绿**（同硬规则 4：一个结构上不可能取假的量不是测量）。

### AC122（枢纽退回全量，且枢纽集合是显式清单不是启发式）
**判据**：显式落一份**枢纽文件清单**（至少含 `scripts/test.sh`、`plugin/scripts/full-suite-runner.ts`、`plugin/scripts/runner-grouping*`、`plugin/scripts/select-tests-for-touches.ts`）；变更触及清单中任一文件 ⇒ **无条件全量**，⛔ 不试图精算扇出。
**取假**：拿基线里那 22 个"含 H 枢纽"的真实任务回放，**必须 22/22 判为全量**；漏判任一条 ⇒ 未达成。

### AC123（跨桶测试计入两边，安全侧不做减法）
**判据**：跨桶测试（基线实测 40 个 / 9.0%）在其**每一个**所属桶被触发时都必须入选，⛔ 不得只归一边。
**取假**：构造一个只碰 P 的变更，那 12 个 `packages/*/test` 中碰 `plugin/scripts` 的测试必须在选中集里；再构造一个只碰 M 的变更，同样 12 个也必须在选中集里。任一方向缺失 ⇒ 未达成。

### AC124（收益落在**生产载体**上，不是估算）
**判据**：分桶执行启用后，`.quay/verification-round.jsonl` 中**新于本阶段切换**的轮次里，至少 10 轮带上"本轮跑了哪几桶 + 该桶文件数 + 该桶耗时"的字段；且**仅 P 变更**与**仅 M 变更**两类各至少 3 轮，其 `durationMs` 中位数分别 ≤ 全量中位数的 40%。
**⛔ 不接受估算值**（同 `gap-phase-boundary-differential-accounting` 推论三：fixture/估算正确 ≠ 已产出）。
**⊢ 阈值来源**：基线实测 P=21.9%、M=18.1%，40% 是含跨桶与兜底后的宽松上界，**不是我凭空设的数**。

**⊕ 2026-08-21 21:5xZ 裁决修正（manager 裁 a6769276，outer 转 AC124 subagent 两问）**：
**① 窗口语义**：判据的 ≥10 轮为 **land-后累积窗口**——带桶轮次结构上只能存在于「启用」之后，而启用=AC124 实现的 land，此为启动自举非缺陷（同 cpu_time_s「0 新」裁决 1d230958、硬规则 4 推论三「N 只计实现落地之后的时间窗」）。
**窗口锚 = `2026-08-21T23:04:39Z`（AC124 fan-in land，commit 7d897a72，2026-08-21 23:1xZ 补填，钉死字面量 ⛔ 不得滑动）**；AC124 的实现 land ≠ 本条判据达成——land 后由 manager 每轮核窗口（同套件入账窗口判据形态），积满 ≥10 轮才勾。⛔ 不得为凑判据伪造/预写带桶轮次。
**② 40% 阈值的诚实修正**：首批示范轮实测 **M-only 300010ms = 全量中位 720822ms 的 41.6%（略超 40%）、P-only 317053ms = 44.0%**。
根因：**9 个真 UNRESOLVED 测试（spawn-by-name 静态不可定位）恒选**——它们是 fail-closed 的安全侧，AC125 的不漏测证明正依赖其被选中；而上方「⊢ 阈值来源」的 40% 计算**没有计入这批恒选安全侧**（基线注记所立的「没算全成本结构就设阈值」形态，此行为其实例）。
**裁：accept 41.6%**——安全优先于省；⛔ **禁止**以压低 M 桶占比为目的对这 9 个测试做再归属（拿安全换指标 = gate-gaming）。
**持续信号**：M-only 轮围绕实测带 41.6% 波动（参照 `SPEC-suite-speed` 噪声 σ 判显著偏离）；显著偏离才是真回归。
**③ 实测记账**：单桶省 ~56–58% 为真，但**低于基线加权估值 65.7%**（估值漏了恒选安全侧+固定开销）⇒ **本阶段收官按实测收益记账，不按 65.7% 报账**。
**④ ⛔ 前提依赖（2026-08-22 补）**：AC124 的窗口判据（≥10 轮带桶字段）以 **AC126（启用接线）落地为前提**——启用前生产 suite 从不传 `--buckets`，窗口**结构上恒为 0**，不因「等数据」而改变。
**⑤ 预期吞吐收益（2026-08-22 实测锚估计，⛔ 待窗口生产实测确认，不是已测收益）**：
- 实测锚：全量 suite 中位 **746.0s**（verification-round 最近 15 轮实测）；桶子集示范轮 M-only **300.0s（41.6%）**、P-only **317.1s（44.0%）**。
- 加权 fan-in suite 时间（7 天稳态桶分布 M60%/P13.5%/hub12.9%/M+P7.6%/docs5.9%）：746s → ~366s ⇒ **suite 时间 ~2.0× 快（-51%）**。
- 墙钟吞吐 **~1.5–1.8×**（fan-in 有 ~200–300s 固定段不随分桶变：merge develop → delta 断言面 → ts-typecheck → scoped 门 → doc → flip + ff）。
- 过去 24h 增益略低（~1.8× suite 时间）——本阶段自身任务触 hub（test.sh/runner）占比高、仍全量；稳态 M-only 60% 才是 ~2×。
- ⛔ M/P 的 300/317s 是**示范轮非生产实测**——生产真实桶耗时以本 AC 窗口攒数为准。

### AC125（漏测的负控制 —— 分桶不得把真回归放过去）
**判据（能取假）**：取本仓历史上**至少 3 次真实的跨层回归**（一个桶的源码改动打红了另一个桶的测试；从 `verification-round.jsonl` 红轮 + 对应提交回溯），回放分桶规则，**必须 3/3 仍然选中那个会红的测试**。
**⊢ 为什么必须有这条**：AC120-124 都在证明"能省"，**只有这条在证明"没漏"**。⛔ 缺这条则本阶段的达成等于一个恒绿判据。

### AC126（分桶执行的【生产启用】——suite 路径真正传 `--buckets`）
**判据**：分桶执行的「启用」≠ 机制存在，而是**生产 suite 路径真正传 `--buckets <task-id>`**——即 fan-in 的 suite 启动（`.claude/workflows/fan-in-execute.js` 的 SUITE_LAUNCH/ISOLATE_LAUNCH，或其路由到的 full-suite-runner 入口）在任务触及单桶时按桶跑子集，且**该带桶轮次写入 `.quay/verification-round.jsonl`（AC124 的判据载体）**。
**取假（可机械核）**：(a) `fan-in-execute.js` 存在 `--buckets` 引用且 suite 启动命令串含 `--buckets`；(b) 回放一个 M-only 任务走 fan-in，其 verification-round 记录带 `buckets=M`；一个触枢纽任务带 `buckets=full`。任一不符 ⇒ 未达成。
**⊢ 为什么是缺口**：AC124 只把「开关」装在 `scripts/test.sh`/`full-suite-runner.ts` 两层（机制层），**没装到「谁按下开关」这一层**——fan-in 的 SUITE_LAUNCH 仍跑 `bash scripts/test.sh`（全量、无 `--buckets`），且实测 `fan-in-execute.js` **零处引用 buckets**。⇒ AC124 的 ≥10 轮带桶字段在启用接线前**结构上不可满足**（不是「等数据」能等出来的）。
**⊢ 已核实的连带（inner 接线时一并处理）**：fan-in 的 suite 直跑 `test.sh`、不经 `full-suite-runner.ts`，而 `verification-round.jsonl` **仅由 `full-suite-runner.ts` 写**（既有 gap-preverified-suite-bypasses-verification-round-ledger / gap-fan-in-realsuite-bypasses-verification-round-ledger）⇒ ⛔ 启用接线不得只跑子集不落账，必须让带桶轮次落到 verification-round 载体上。

### AC127（分桶记录在 web `/tests` 页可见 —— 交付面，不是只有 ledger 有）
**判据**：quay web server 的 `/tests` 页（`packages/quay/src/observation.ts` 的 `readTests`/`parseVerificationRound` + `serve-handlers.ts` 的 `renderTestsPage`）解析并展示 `verification-round.jsonl` 里的桶字段（`buckets` / `bucket_files` / `bucket_duration_ms`）。
**取假（可机械核）**：回放一条带 `buckets=M`（或 `full`/`P`/`P+M`）的记录 ⇒ `parseVerificationRound` 返回的 `TestRunRecord` 含 `buckets` 字段且 `renderTestsPage` 输出该值；一条无桶字段的 legacy 记录 ⇒ 不展示桶（absence 容忍，同 ledger 契约，⛔ 不得显示伪 `full`）。
**⊢ 为什么是缺口（实测核实）**：AC124/126 让桶字段进了 `verification-round.jsonl`，但 `/tests` 页的 parser/renderer **都未解析该字段**——`TestRunRecord` 接口无 `buckets` 键（observation.ts:1324-1349）、`renderTestsPage` 表头只有 `round/state/pass/duration/scope/commit`（serve-handlers.ts:2266）。⇒ 桶记录在 web 端不可见，「分桶执行」对人不可观测 = 未交付。
**依赖**：depends_on AC126（记录先于展示）。真实桶轮须 AC126 落地后才有；parse/render 层可先用 fixture 行测。

### 本阶段的达成条件与非目标
**达成 = AC120 ∧ AC121 ∧ AC122 ∧ AC123 ∧ AC124 ∧ AC125 ∧ AC126 ∧ AC127 全部为真。**
**🔀 达成后切换（人 2026-08-22 明令）**：本阶段 AC120–127 全部落实后，**立即把阶段切入下一阶段 AC110–117**（退役/减少机件 + 加速 suite）。⛔ 切换前提 = AC124 的窗口判据也达标（≥10 轮带桶字段 + P/M-only 各 ≥3 轮）——实现 6/6 不等于阶段达成（见 AC124 段 ④/⑤）。
**⛔ 非目标**：
- ⛔ 不在本阶段改 `select-tests-for-touches.ts` 的文件级判据（那是另一层粒度，本阶段不碰）。
- ⛔ 不在本阶段做退役/减少机件（那是下一阶段 AC110–AC117，判据面不得混用——硬规则 12「永远差最后一步」）。
- ⛔ 不因为省时间而降低任何检查器的执行频率——**本阶段是"按变更选桶"，不是"降频"**（人②明确纠正过一次）。
  **⊕ 2026-08-22 补（裁决 1050b68f 落点）**：桶子集路径不得跳过任何**每轮语义**的检查器——尤其 suite-tail `tmux-leak-scan --check`（残留泄漏断言，第二道防线）。实测当前桶路径跳过它（`--snapshot`/`--check` 仅在全量分支）⇒ 已裁须补（独立 follow-up，不并入 AC126）。⛔ 同类「检查器只在全量分支、桶路径漏了」一律视为降频 violation，先查全量分支有哪些、再对桶路径逐条核。

**⛔ 落笔归属**：与既有同规则——**manager 只设计判据 + 核对实测值，一条任务体/AC/DoD 都不写**；立案与实现归 outer（立案/驱动）+ inner（实现）。

---

## ⏸ 前一阶段（2026-08-20 07:3xZ – 2026-08-21 16:5xZ，**AC104–AC109/AC118/AC119 已全部达成并发布 v0.6.1**，内容原样保留）：基于当前版本的 build / 跨主机验证 / 发布 v0.6.0

> **收口记录（2026-08-21 16:5xZ，manager 逐条实测）**：AC104（8 处版本一致 0.6.1）✓；AC105（package.sh 产 tgz，sha256 已记）✓；AC106（dist-verify-node-floor 真跑）✓；AC107（B/C 双机三步，**且已用修复版 L2 判据重验**——11:18/11:22Z 两条带 `l2.startup_prompt=0` 直接量的记录）✓；AC108（v0.6.1 tag == origin/develop == release，publishedAt 2026-08-21T14:50:19Z）✓；AC109（jsonl 写回）✓；AC118（B 机 meta-cc 三任务 todo→done + 真实 Go 产品提交）✓；AC119（B 机 meta-cc 真实 HTTP 断言 + 3 张 1440×900 像素截图）✓。
> **遗留（不阻塞收口）**：`v0.6.1..develop` 已 ahead 10；两机 user-scope quay CLI 已实测 0.6.1 可用（登录 shell 默认 PATH 口径）。

**来源**：人 2026-08-20 07:2xZ 逐字：「一个阶段用于**参考最近曾执行的类似阶段**，基于当前版本执行 build、
跨主机和项目验证和发布新版本。」+「将当前阶段切换到上面创建的第一个阶段，并开始推进。」

**参照正本**：本文件 `:10` 的 ⏸ 前一阶段「产品化 build 与实际验证」（AC85–AC93，2026-08-16 达成 9/9 并发布 v0.5.0）。
**⊢ 本阶段是它的第二次执行，不是重做**——那一轮建立的机制（`verify-deliver-coldstart.sh` /
`version-consistency-check.ts` / `productization-verification.jsonl` / ci.yml 的 develop 触发）**全部复用**，
本阶段只验「这些机制对【当前版本】再跑一遍仍然成立」，⛔ 不得重新发明。

### 切换前实测基线（全部直接量，可复算，⛔ 后续 AC 一律锚在这些量上）

```
版本         v0.5.0 @ 2026-08-16T16:23:02Z（gh release view）
未发布量     git rev-list --count v0.5.0..develop      = 674
远端         origin/develop = e67c16c7 @ 2026-08-19T17:04:38Z
             v0.5.0..origin/develop = 571 ｜ origin/develop..develop = 103（本地领先 103 未推）
版本号一致性 node --experimental-strip-types scripts/version-consistency-check.ts
             → "All 8 files carry version 0.5.0"（⇒ 尚未 bump）
CI 触发面    .github/workflows/ci.yml:3-8 `branches: [master, develop]`
             ⇒ AC86 当年报的「dist-verify-node-floor 结构上不可能被触发」【已修】(:66 job 在)
             ⚠️ 但"配置对"≠"已运行"（AC86 原文教训），本阶段必须查真实 run 记录
交付验证机制 plugin/scripts/verify-deliver-coldstart.sh 已存在（@instrument 头注释自陈三步：
             干净目录全新 .tgz 安装 → 项目内 quay-init → 双层 outer+inner 冷启动活性【直接量】）
             ⇒ AC88 当年的三点缺口①（develop-deliver-tgz.sh 无 quay-init）已由该脚本闭合
上阶段遗留   gap-delivery-laydown-dist-closure-gap        = done（当年遗留，已闭）
             gap-quay-has-never-self-hosted-its-own-cold-start = done
```

### AC104（版本号推进到 v0.6.0，8 处一致）
**判据（能取假，一条命令）**：`node --experimental-strip-types scripts/version-consistency-check.ts`
输出 `All 8 files carry version 0.6.0`。**取假**：任一文件残留 0.5.0 或版本不齐 ⇒ 该脚本非零退出并列出不一致项。
**⛔ 不得手工逐个改 8 处而不跑该检查器**——它就是为这件事造的。

### AC105（本机 build 产出当前版本的可用产物，锚在事后可核的对象上）
**判据（能取假）**：`bash packages/quay/scripts/package.sh` 产出 `.tgz`；`tar tzf` 校验 `plugin/` 条目非空
（08-06 曾错把 `npm pack` 当入口得 0 条）；产物内 `package/plugin/.claude-plugin/plugin.json` 版本 = `0.6.0`。
**⊢ 记录形态（沿用 AC88 当年自己发现的判据缺陷的修法，逐字复用）**：
**「判据不得引用一个生命周期短于判据本身的对象」**——`.tgz` 路径在 worktree 被删后不可解析（`.gitignore:21`）。
⇒ 达成证据必须记 **build 时的 `git rev-parse HEAD`（commit sha）+ 产物 sha256**，⛔ 不记文件路径。

### AC106（`dist-verify-node-floor` 在当前流程上**真实运行过**，不是"配置看起来对了"）
**判据（能取假）**：`gh run list --workflow=ci.yml --branch=develop` 中存在一次
`dist-verify-node-floor` job **conclusion=success** 且其时刻**新于本次阶段切换（2026-08-20）**。
**⛔ 不接受"ci.yml 里有这个 job"作为达成证据**——AC86 原文已钉死这条教训
（同 `gap-phase-boundary-differential-accounting` 推论三：fixture/配置正确 ≠ 已产出）。
**⊢ 若实测发现它仍未在 develop 上真跑过**（如 push 未发生、或 job 被 skip），**那本身就是本阶段的发现**，
按缺陷处置（归 outer 立案），⛔ 不得为了勾 AC 而手工触发一次充数——手工触发不证明"开发流程会触发它"。

### AC107（跨主机验证走**机制**，不是手工一次性）
**判据（能取假）**：用 `plugin/scripts/verify-deliver-coldstart.sh` 对 **B=orangevps** 与 **C=ad-arm1** 各跑一次完整三步
（① 干净目录全新 `.tgz` 安装 ② 项目内 `quay-init` ③ outer+inner 双层冷启动活性），
**tgz 由该次验证自己从 develop-tip 现 build**（`--build-root`），记录 commit sha + 产物 sha256。
**取假三条**：(a) 验证所用 commit sha 必须是 develop 上**新于 2026-08-20** 的提交；
(b) ⛔ 不得引用 08-06/08-11/08-16 的历史验证记录；(c) 冷启动活性判据必须是**直接量**
（git 提交时刻 / `/proc/<pid>/cwd` / worktree），⛔ 不得用"进程存在"这类代理量（硬规则 4b）。
**⊢ 已知前置（AC88 当年实测的②③，需先核实是否仍成立）**：B 机曾是 `sync.sh` 同步的开发树（有 `.git`，
不满足"非 git clone"）；C 机曾无 quay 主检出。**本阶段第一步就是重新实测这两台机的当前形态**，
⛔ 不得沿用 08-16 的记述当现状（那是四天前的读数）。

### AC108（推送 + 打标 + 发布，三者指向同一提交）
**判据（能取假，全部一条命令可查）**：
```
① git rev-list --left-right --count origin/develop...develop  →  0  0
② git rev-parse v0.6.0  ==  git rev-parse develop
③ gh release view v0.6.0 --json tagName,createdAt  →  存在且 createdAt 新于本次切换
```
**⛔ 三者必须指向同一 commit**——v0.5.0 那轮是对的（`origin/develop`=`08e8ec55`=tag），本轮沿用同一形态。
**⊢ 基线提醒**：切换时 `origin/develop..develop` = **103**，本地领先未推；`v0.5.0..develop` = **674**
⇒ 本次发布覆盖的变更量是上一版的量级之上，**release note 必须真实反映这 674 条的主题**，⛔ 不得只写一句"若干修复"。

### AC109（产品化状态写回一处可机械核对的记录）
**判据**：AC104–AC108 的结果（成功/失败 + 上述各条的实测值）追加进
`.quay/productization-verification.jsonl`（v0.5.0 那轮已建立的载体，**复用不新造**），
每条含 `{ac, verdict, commit, sha256|runId|tag, measuredAt}`。
**取假**：该文件中不存在时刻新于本次切换的记录 ⇒ 本 AC 未达成。
**⛔ 不要求新造仪表盘**（沿用 AC89 原话）。

---

## 🆕 AC118–AC119（人 2026-08-20 14:0xZ 追加，两条独立裁定，编号接续本文件全局最大值 117，不复用）

### AC118（第三方项目验证——用当前版本真实驱动一个非 quay 自维护的项目，补回历史 AC16②/AC88 收窄掉的要求）

**来源与背景（manager 实测比对，人已确认「在这次发布里补回这条」）**：2026-08-06/08-12 人当年裁定的
AC16②「B/C 各自 clone archguard 与 meta-cc，**以真实第三方项目身份做 AC16 的接受方**」——理由是防
「**亲代环境掩盖亲代缺陷**」：在 quay 自己仓库上测自己，测到的是「开发树还在不在」这种结构上不可能
为假的绿；只有在一个 quay 团队不定制的项目上跑，author→ready 闸、任务生命周期这些机制才可能真的
暴露问题。当年实测强度：archguard 上真跑 61 任务，其中 **28 条**逐条核实从 `todo` 起始、走完整
author→ready 闸、到 `done`，8 小时、3 处真实产品代码变更。**AC17（协作）后来被人裁定取消，
但 AC16②（第三方接受方）明确保留**——"接受方保留，协作取消"。**该要求在 08-16 阶段被 AC88
静默收窄**：AC88 的验证对象已不是 archguard/meta-cc，而是 quay-init 冷启动时自建的演示任务
（B 上 `INNER-1`/`INNER-2`、C 上 `QX-001`），没有任何一处文档记录这次收窄经过人裁定。

**目标项目**：archguard 或 meta-cc（沿用当年 precedent 所用项目，两者均非 quay 团队定制的任务板配置）。
**主机**：B=orangevps 或 C=ad-arm1 二选一即可（历史当年也只用一台做主证据，人曾裁定"C 的包安装验收
提升为 AC16 主证据"）；**⛔ 不得用 A（quay 开发树所在机）**——理由同 AC107（亲代环境无法验证自己）。

**判据（能取假）**：
1. 目标项目的 `.quay/config.yml` **`default_task_status` 不得为 `ready`**（历史踩过的坑——该配置会让
   `todo` 从不出现，author→ready 闸从未被真正执行；本条必须显式核实）；
2. 安装源 = 本阶段 AC105/AC107 产出的**当前版本**产物（tgz），驱动的是该第三方项目**自己的**代码/任务板；
3. **至少 3 条**该项目任务，`git log --diff-filter=A` 可查其**首次入库状态为 `todo`**（非 `ready` 起始），
   且已经过真实 author→ready 闸判定、翻到 `done`；
4. 这些任务在该第三方项目**自己的仓库**里有**真实非 doc-only 的产品代码提交**（`git show --stat` 可核）；
5. 验证时刻新于本次阶段切换（2026-08-20），⛔ 不接受引用 08-06/08-12 的历史 61 任务记录充数。
**取假**：任一条不满足（如目标项目仍是 `default_task_status: ready`、任务全部 `ready` 起始、或零真实产品
代码提交）⇒ 本 AC 未达成。
**记录形态**：同 AC109，写入 `.quay/productization-verification.jsonl`，`ac="AC118"`，
含目标项目名 / 任务 id 列表 / 各任务 commit sha。

### AC119（近期 Web UI 改进在其它项目数据上验证）

**来源**：人 2026-08-20 逐字：「最近 web ui 有重大改进。本阶段 AC 和任务也应包括对其它项目中 quay
web ui 使用的验证。」
**背景（上阶段"Web UI 改进版落地"已达成的具体改进点，供本 AC 逐条核对）**：
- `/sessions` 按 Manager/Outer/Inner 分层渲染（`gap-webui-sessions-no-layer-labels`）
- `/journal` 读 tick-log 改用 `readRecentSections`（`gap-webui-journal-reads-stale-data`）
- `/board` 服务端分页 + status/label 筛选（`gap-webui-board-no-pagination`）
- `/board` 冷加载 120s→个位数秒（`gap-webui-board-load-120s`）
- 统一 `renderSiteNav`/`renderMobileChrome` 导航（`gap-webui-nav-inconsistent-routes`）
**⚠️ 这些改进此前只在 quay 自己的任务板/tick-log 数据上验证过**——quay 自己的数据形状（字段是否齐全、
任务数量级、label 分布）可能恰好绕开某些边界情况（同 AC92 教训："验证的是端口活着，不是真实使用"）。

**判据（能取假）**：在 AC118 所用的第三方项目（或另一个独立第三方项目均可）上，`quay serve` 指向该
项目的 `.quay/config.yml`，通过真实 HTTP 请求（**不是 `curl` 200 探活**，需实际取回页面内容并断言关键
元素存在）逐条验证：
1. `/sessions`：若该项目有多层会话数据，分层渲染正确无跨层混排；若该项目任务板结构与 quay 不同
   （如无 manager 层），页面须**优雅降级**而非报错；
2. `/journal`：能正确读取并渲染该项目自己的 tick-log/等价记录（若该项目没有该文件，需确认 fail-closed
   报 empty 而非崩溃或误报 quay 自己的数据）；
3. `/board`：分页与 status/label 筛选在该项目真实任务数据上工作正确；
4. 导航栏在该项目所有路由上一致渲染。
**取假**：任一条在第三方项目数据上出现渲染错误/崩溃/串号（把 quay 自己的数据当成了目标项目的数据）
⇒ 该项按缺陷处置，记入本 AC 未达成。
**⊢ 若发现新缺陷**：按缺陷处置（归 outer 立案），⛔ 不得为了勾 AC 而回避／隐藏该缺陷。
**记录形态**：同上，`ac="AC119"`，含目标项目名 + 逐条验证结果。

**⛔ AC118–AC119 落笔归属**：与 AC85–AC93/AC104–AC109 同规则——**manager 一条不改**，落点归
outer（立案/驱动远端会话）+ inner（若涉及产品代码修复）。manager 只设计判据 + 核对实测值。

---

### 本阶段的达成条件与非目标

**达成 = AC104 ∧ AC105 ∧ AC106 ∧ AC107 ∧ AC108 ∧ AC109 ∧ AC118 ∧ AC119 全部为真。**
**⛔ 非目标（明确排除，避免范围蔓延）**：
- ⛔ 不在本阶段做任何"减少冗余/加速 suite"的工作——那是下一阶段（AC110–AC117）的事，
  **两个阶段的判据面不得混用**（否则又变成"永远差最后一步"，硬规则 12）。
- ⛔ 不因为 674 条未发布变更里可能有问题就扩大验证范围；本阶段验的是**交付链**，不是**内容正确性**
  （内容正确性由 suite 与既有 per-task 验证承担）。

---

## 🆕 当前阶段（**2026-08-22 17:2xZ 起 —— 切换判据已满足并实测核实**）：晋升面机械化 —— promotion-driver（AC130–AC136）

**⊕ 切换核实（2026-08-22 17:2xZ，manager 直读机件，⛔ 非 outer 自述）**：
```
结晶阶段最后一条 AC129    task_get ⇒ status=done，AC1-3+DoD 全勾（f430fb5b）
worktree 直读              git worktree list | grep -c quay-worktrees ⇒ 0
七条任务立案               tasks/gap-ac13{0..6}-*.md 逐个 ls ⇒ 7/7 存在
AC130 入场闸               four/touches/self 全过、depsReady=True、eligible=True ⇒ 已 A22 晋 ready
```
⇒ **人定的切换判据「结晶阶段任务全部 merge」已满足**（⛔ 判据是 merge 完成，非 AC 全满足）。
**⊢ 结晶阶段降为 `⏸`，但其 AC 仍在我的每轮核查义务内**（见本阶段达成条件的「持续观察义务」条）。

**来源（人 2026-08-22 16:0xZ 逐字给出形态，⛔ 我不改其结构）**：
```
promotion-driver（常驻，机械，无 LLM）
  ├── 循环：调 ready-pool-check 取全池判定
  ├── 合格者 → A22 --apply 晋升（纯机械，无 LLM）
  ├── 不合格者 → spawn 短命 fix worker（claude -p）：
  │     输入 = 任务 id + 闸给出的 missing 清单（结构化，不是散文）
  │     产出 = 改任务体 + 退出码
  ├── 修完 → 驱动【重跑同一个闸】验证（⛔ 不信 worker 自述"我修好了"）
  └── 记录：每次判定/晋升/修复各一条 outcome（outer 可消费）
```
**⊢ 收窄边界（人 2026-08-22 15:5xZ 逐字：「仅把任务晋升和不合格任务的诊断与修复改为用机械驱动包裹 LLM 执行（与 worker 一致）」）**：
本阶段**只**机械化【晋升判定/执行】与【不合格任务的诊断修复】两件事。
⛔ **明确不在本阶段**：任务体首次撰写（从零产生语义内容）· 跨任务模式识别（SPEC §7 人已裁定归 outer）· 判据设计与仲裁（manager 层）。

**⊢ 与 AC129（inner worker-driver）的关系**：同构但**不同进程、不同池**——
AC129 驱动的是【任务执行】（ready → worktree → 开发 → suite → ff）；本阶段驱动的是【任务入池前的合格化】（todo/不合格 → 修 → 晋 ready）。
**⊢ 可复用面（记，不强制）**：AC115 已落地的 `worker-driver.ts` 的 spawn/outcome/退出码骨架、AC116 的并发+超时、AC129 的常驻循环+判停——
落笔方可评估复用还是另起；⛔ 本阶段判据不规定实现形态（同 AC129 非目标条）。

### AC130（驱动常驻 + 全池判定循环）
**判据（能取假）**：promotion-driver 常驻运行，每轮调 `ready-pool-check` 取**全池**判定（⛔ 不是只看某一条），
跑完一轮不退出、按间隔进入下一轮。**取假**：杀掉/停掉驱动后池中新出现的合格任务不再被晋升 ⇒ 证明晋升确实由它驱动而非 outer 的 tick。

### AC131（合格者纯机械晋升，⛔ 零 LLM）
**判据（能取假）**：判定合格的任务由驱动直接调 `A22 --apply` 晋升，**该路径上不得有任何 LLM 调用**。
**取假**：构造一个四件套齐全、deps 空的 todo ⇒ 驱动应在一轮内将其晋为 ready，且该轮 outcome 记录中 `llm_invoked=false`（或等价字段）。
**⊢ 为什么单列**：这是「机械的归机械」的那一半——今日实测 A22 晋升本就无需 LLM（AC128 land→AC116 晋、AC116 land→AC117+AC129 双晋均为机械发生），本条只是把它从「outer 每轮记得调」变成「驱动循环的一步」。

### AC132（不合格者 → 短命 fix worker，输入必须是闸的结构化输出）
**判据（能取假）**：判定不合格的任务，驱动 spawn 一个短命 `claude -p` fix worker，
**其输入必须是任务 id + 闸给出的结构化 missing 清单**（如 `fourArtifacts=false missing=[DoD]` / `touchesResolve=false` 及原因），
⛔ **不得是「你去看看这个任务哪儿不对」这类散文指令**。
**取假**：构造一个 DoD < 40 字符的 todo ⇒ fix worker 收到的 prompt 中必须含该结构化缺项标识；
若 prompt 中只有任务 id 而无缺项清单 ⇒ 本条为假。
**⊢ 依据（今日三个实测样本）**：全角字符 Touches（`5f2b896f` 修）· DoD<40 字符（`ca9ed1e8` 修）· AC115 Touches 三次扩充——
**共同形态：闸能报出「哪一项不合格」，但「该补什么内容」是语义问题** ⇒ 这正是「机械判定 + LLM 修复」的分界线。

### AC133（修完必须由驱动重跑同一个闸验证，⛔ 不信 worker 自述）
**判据（能取假）**：fix worker 退出后，**驱动重新调用同一个闸**（`ready-pool-check`）验证，
以闸的新判定为准；⛔ worker 自述「已修好」不作为晋升依据。
**取假**：构造一个 fix worker 声称修好但实际未改（或改错）的场景 ⇒ 驱动必须仍判不合格、⛔ 不得晋升。
**⊢ 这是硬规则 ②e（自述只算线索，证据须来自该方之外）的机械化**——把一条靠自觉的纪律变成驱动循环里的一步。
**⊢ 配套：失败上限（能取假）**：同一任务连续修 N 次仍不合格 ⇒ 标 `needs-human` 并停止对它的修复循环，
⛔ 不得无限重修。**取假**：构造一个结构上修不好的任务 ⇒ 驱动必须在 N 次后停手。
**⊢ 依据**：今日 hub-strip 无限 relaunch 占 suite 锁 ~2h（`gap-fan-in-relaunch-retry-cap` 已 land 修 fan-in 侧）——
**同一形态在晋升侧同样可能发生**，⛔ 不得因为「fan-in 侧已修」就假定晋升侧免疫（硬规则 5b：修好一处 ≠ 只有那一处）。

### AC134（每次判定/晋升/修复各落一条 outcome，且 outer 可消费）
**判据（能取假，读生产载体）**：驱动的每一次【判定】【晋升】【修复】各写一条结构化记录到运行时载体
（gitignored，同 `worker-outcome.jsonl` 族），字段至少含：任务 id · 闸判定结果（含 missing 清单）· 动作（promote/fix/skip）· 结果 · 时刻。
**取假（硬规则 4 推论三：AC 必须读生产载体，且只计实现落地之后的时间窗）**：
本 AC 达成的判据是**载体中【实现 land 之后】的真实记录条数 ≥ N**，⛔ fixture/注入数据不算；
若把注入 seam 关掉后该 AC 仍能通过，它才是测量。
**⊢ 为什么必须有**：SPEC §7 人已裁定「跨任务模式识别由 outer 执行」，而 outer 只能读记录——
**没有这条，晋升面机械化之后 outer 就瞎了**（同 AC115 的 outcome 记录之于 inner 侧）。

### AC135（**实际切换 + outer 晋升步骤退役** —— 单一真相源，2026-08-22 16:1xZ 人问后补）

**⊢ 为什么必须单列（AC130–134 的覆盖缺口）**：那五条只证明**「驱动能做」**，**不证明「outer 已不再做」**。
两者并存 = **两个真相源** —— 正是 AC117 退役清单里人裁定的「`.halt` **⛔ 不得与 MCP halt 并存**」同族问题。
**⛔ 不得只报「驱动跑起来了」而不报退役**（AC110 贯穿纪律 + SPEC §5 每阶段必列退役清单）。

**判据（三条同时成立，全部能取假）**：
- **AC135-1 退役已落**：outer 执行核（`orchestration/orchestrator-tick-core.md`）中「调 `A22 --apply` 晋升」这一步**已退役**
  （核中不再存在该步骤，或明标退役并指向驱动）。**取假**：该步骤仍在核中且仍被每轮执行 ⇒ 本条为假。
- **AC135-2 生产窗口证明（读生产载体，⛔ 非「代码写完了」）**：自驱动 land 起的**连续 N 小时窗口**内，
  晋升事件**全部**由驱动的 outcome 记录承担、**outer 侧零晋升动作**
  （可机械核：该窗口内 outer tick-log 无 A22 promotions 记录 ∧ 驱动 outcome 中有 promote 记录）。
  **⊢ N 不在此拍板**（硬规则 4：成本结构未知前不设数值阈值）——先无阈值跑一段记录分布再定，同 SPEC §4④。
- **AC135-3 停机取假**：停掉驱动 ⇒ 池中新出现的合格任务**不再被晋升**（AC130 的取假在此复用为**切换**证据：
  若停掉驱动后晋升照常发生 ⇒ 说明 outer 仍在做 ⇒ 切换未完成）。

**## Retires 目标（落笔方须逐条回答「它防的缺陷现在由什么防」）**：
outer 执行核的 **A22（供给侧心跳，跑 `ready-pool-check --apply` 晋合格的）** · **A24（质量心跳，修不合格 todo 到合格）** · 两者在 B13 判定序列中的位置。

**⊕ 2026-08-22 17:2xZ 修正（manager 自查，硬规则 5b —— 立案前查证据时发现，未落地即修）**：
**原文只写了 A22，漏了 A24** —— 而 **A24 正是 AC132/AC133 要机械化的那一半**（「修不合格任务」）。
⊢ 实读 `orchestration/orchestrator-tick-core.md:48` 确证 A24 已存在且**已把可修/不可修分类枚举清楚**：
```
可修类（A24 现行）：fourArtifacts=false（按 missingArtifacts 补其 shape 缺失段）
                    selfTouchOk=false（补自身 tasks/<id>.md 进 ## Touches）
                    touchesResolve=false（Touches 写错 ⇒ 改对）
不可修类（逐条记原因、不修）：depsReady=false · retiredMechanism · superseded · compound · prosePrereqGap 非空
```
⇒ **AC132 的 fix worker 作用域不必我另行发明——A24 已经定义好了**，落笔方应直接沿用这份分类（⛔ 不要重新设计）。
⇒ **AC135 若只退役 A22 而留下 A24，就是两个真相源的另一半**（outer 仍在修不合格任务，驱动也在修）——**本条即补**。

### AC136（**web 观测面随真相源切换** —— ⛔ 页面不得读一个已不是真相源的量，2026-08-22 16:1xZ 人问后补）

**⊢ 为什么必须单列（硬规则 5b 自用 —— manager 自查，非审计报出）**：
**我今日（`cad6f9ae` 修正二）已为 AC129 在复扫检查点写了 web 载体切换的核查条款，却没在本阶段给 promotion-driver 写同样的。**
「**在某处修好 X ≠ X 只在那一处**」—— 同一个原则想明白了，只落实到了它被发现的那一处。本条即补。

**判据（能取假）**：晋升面机械化后，web 展示的**任务台账 / pool 指标**必须读驱动的 outcome 载体、或与之口径一致。
**具体核查点（实读现状，落笔方须逐个核）**：
- `packages/quay/src/observation.ts:1227` `readPoolMetrics()` 冷调 `slot-refill.ts` 取 `pool/floor/deficit/cap`
  —— **驱动接管晋升后，该量的真相源变为驱动自己的判定记录**；
- `serve-handlers.ts:2477`（状态计数）/ `:2489`（最近更新非-done）的任务台账卡片，与 `/tasks` 页；
- **今日立案的 web 任务**（`gap-webui-dashboard-load-time-optimization` 等）**均基于旧真相源撰写**，其字段假设是否仍成立须一并核。
**取假**：构造一次**由驱动完成**的晋升（todo→ready）⇒ web 对应视图应在其刷新周期内反映该变化；
若 web 仍只反映 outer 侧的旧路径 ⇒ 本条为假。
**⊢ 这正是硬规则 4b 的形态**：页面看起来正常、数字也在动，**但它读的载体已经不是系统的真相**。

### 本阶段的达成条件与非目标
### AC137（**驱动的【生产启用】** —— 机件存在 ≠ 它在跑，2026-08-22 22:2xZ 补）

**⊢ 缺口性质（实测发现，非推断）**：AC130–136 **七条全部 done** 时，我直读三个直接量：
```
tasks/gap-ac135-...md  status ⇒ done          （七条确已 land）
.quay/promotion-outcome.jsonl  ⇒ 【不存在】     （AC134-AC2 的载体为空）
ps -eo args | grep promotion-driver ⇒ 【零命中】 （驱动【没有在跑】）
```
⇒ **三条「待外部」判据（AC134-AC2 记录数 ≥N · AC135-AC2 生产窗口 · AC135-AC3 停机取假）
结构上【无法起算】**——它们都要求「驱动在生产中实际运行」，而**没有任何一条 AC 要求把它启动起来**。

**⊢ 这是硬规则 5b 的自指实例（manager 自查，⛔ 非审计报出）**：
**同一个缺口我在上一阶段刚踩过并补过** —— `### AC126（分桶执行的【生产启用】）`（本文件 `:125`）的立条理由逐字是
「AC124 只把开关装在机制层，**没装到「谁按下开关」这一层**」。
⇒ **我想明白了「机制存在 ≠ 生产启用」，却没把它落实到 AC130–136** —— 「在某处修好 X ≠ X 只在那一处」。

**⊢ 同时是硬规则 4 推论三的实例**：AC130 判据写「promotion-driver 常驻运行」且已 done，
**而驱动进程根本不在跑** ⇒ AC130 是被**测试/取假**满足的，**证明了「能常驻」，没证明「已常驻」**。
⊢ **推论**：AC130 的取假（「停掉驱动 ⇒ 新合格任务不再被晋升」）**只有在生产中做才有意义**；
在测试环境做只证明代码逻辑，⛔ 不证明生产行为。

**判据（能取假，读直接量）**：
- **AC137-1 在跑**：`promotion-driver` 在生产中**作为常驻进程运行**（`ps` 可见；启动方式由落笔方定——
  systemd / 会话内常驻 / 其它皆可，⛔ 本判据不规定形态）。**取假**：`ps` 零命中 ⇒ 本条为假（**现状即为假**）。
- **AC137-2 载体在长**：**`.quay/promotion-round.jsonl`** **存在且记录数随时间增长**
  （⛔ 不是「文件被创建」，是「有新记录持续写入」；**判法＝两次采样比较**，单次读到文件存在不构成本条）。
  **取假**：文件不存在或两次采样记录数不变 ⇒ 为假。

  **⊕ 2026-08-22 23:0xZ 裁定修正（inner 报 needs-human、outer 转，manager 独立核实后采纳「重定范围」）——原文点名 `promotion-outcome.jsonl` 是【选错了载体】**：
  **⊢ 实现直读（`plugin/scripts/promotion-driver.ts`，⛔ 非推断）**：
  ```
  :578  try { appendRoundRecord(roundLogFile, record); }        ← 【无条件】每轮写
  :581  const outcomes = computeOutcomeRecords({applied, fixes, needsHuman})
  :585  for (const o of outcomes) { appendOutcomeRecord(...) }  ← 【条件写】：三者皆空则循环零次迭代
  ```
  ⇒ **池中无 todo 候选时，`outcome.jsonl` 结构上永不写**。
  **⊢ 为什么这是判据缺陷而非实现缺陷（硬规则 4b + 4）**：
  **`outcome.jsonl` 恒空 与「驱动根本没在跑」【同形】** —— 该载体**无法区分这两种状态**，
  故它作为「驱动是否活着并在写」的判据**携带零信息**；而 `round.jsonl` 无条件每轮写，
  是「驱动活着且在循环」的**直接量**。⊢ **我写 AC137-2 时把「事件条件载体」当成了「心跳载体」用**。
  **⊢ manager 独立实测（⛔ 未采信 outer 转述；并先做正控制：同 `ps` 谓词对已知在跑进程干跑命中 6）**：
  ```
  驱动在跑        ps ⇒ supervisor bash(3753960) + node driver(3754592)   ⇒ AC137-1 真
  round.jsonl     34 → 36（间隔 45s 两次采样）                            ⇒ 在长，AC137-2 真
  outcome.jsonl   不存在                                                  ⇒ 与 inner 报一致
  ```
  **⊢ ⚠️ 连带必须显式记的一条（防「永远待外部」在 AC134-AC2 上重演）**：
  `outcome.jsonl` 仍是 **AC134-AC2**（记录数 ≥N）的载体，而它**只在池中有 todo 候选时才写** ⇒
  **AC134-AC2 的窗口起算条件是「池中出现过 todo 候选并被驱动处理」，⛔ 不是「AC137 land」**。
  在此之前它是**「无法起算」而非「未达成」**（硬规则 3b）。⊢ **这与 AC137 本身的缺口同源**：
  判据点名了一个**当前条件下不可能变动的载体**——**我在 AC137 抓到了一次，却在 AC137-2 里自己又犯了一次**（硬规则 5b）。
- **AC137-3 重启存活**：驱动异常退出/机器重启后**能重新起来**（⛔ 否则窗口会被静默中断而无人察觉）。

  **⊕ 2026-08-22 23:0xZ 裁定（inner 问「唯一一次 respawn 发生在 code=0 干净退出后，能否算数」）——⛔ 不算，须一次【异常退出】实测**：
  **⊢ 理由（判据必须能取假）**：干净退出（code=0）与异常退出（非零/被信号杀）在 supervisor 里**通常走不同分支**；
  若接受前者即达标，本条就**无法取假于「supervisor 只处理 code=0」这个缺陷** ——
  而**真实故障几乎都是非零退出**（OOM、崩溃、被杀），那正是本条要防的场景。
  ⇒ **「干净退出后重起成功」证明的是 respawn 路径存在，⛔ 不证明异常路径也在**。
  **⊢ 实测做法（成本极低，一条命令）**：`kill -9 <driver_pid>` ⇒ 观察 ①supervisor 是否重起 driver（`ps` 复现）
  ②`promotion-round.jsonl` 是否**恢复增长**（两次采样）。**两者皆真才勾 AC137-3。**
  **⊢ 与本 AC 其余两条的一致性**：AC137-1/-2 都以「直接量 + 取假」立判，本条同理——
  ⛔ 不接受「守护脚本里写了 restart 逻辑」这类**代码存在性**证据（同硬规则 4 推论三：证明能重起 ≠ 已重起）。
  **取假**：kill 驱动后无人重启、载体停止增长且无告警 ⇒ 为假。

**⊢ 依赖与顺序（⛔ 关键，防「永远待外部」）**：
**AC137 是 AC134-AC2 / AC135-AC2 / AC135-AC3 三条的【前提】** —— 三者的窗口**自 AC137-1 成立之时起算**，
⛔ **在此之前它们不是「未达成」，是「无法起算」**（硬规则 3b：无法评估 ≠ 不合格）。
⇒ **本阶段的达成条件因此扩为八条**；⛔ **⛔ 不得在 AC137 未落地时宣布阶段达成**
——那会让本阶段停在「7 条 done + 3 条永远待外部」，**正是硬规则 4 推论三要防的「实现了、测试绿了、生产没跑过」**。

### AC138（**两驱动均生产启用 + 实际处理生产任务** —— 不止「跑起来」，要「真在处理任务」，人 2026-08-23 逐字裁定「更新阶段目标和 AC，要求把它们实际运行起来并用它们实际处理任务（如同步文档和更新测试），推进」补）

**⊢ 为什么必须单列（AC137/AC129 各自的覆盖缺口，非新要求）**：
- **AC137** 只证明 promotion-driver **在跑 + 载体在长 + 重启存活**，**不证明它处理过示范之外的多样真实任务**——
  截至本条落笔，生产中只有**一条** promote 记录（round 6，且巧合地是它自己的死亡结构修任务），
  **AC132/133 的「不合格 todo → fix worker → 驱动重跑闸复核」路径生产样本 = 0**。
- **AC129** 只证明 worker-driver **具备**常驻/自主选任务/判停的能力（单测覆盖），
  **从未在生产中启动过一次**——`pgrep worker-driver` 本轮 manager 实测【零命中】，
  且**无 launch/supervisor 包装脚本**（`ls plugin/scripts/*worker-driver*` 只有 `worker-driver.ts` 自身）。
⇒ **两者都还停在硬规则④推论三的坑里**：能力已实现、测试已绿，**生产没有（或几乎没有）真的跑过**。

**判据（三条，全部能取假，且都要求生产载体，⛔ 不接受测试环境证据）**：
- **AC138-1（worker-driver 生产启用）**：resident 进程从**稳定路径**启动（主检出，⛔ 非 `quay-worktrees/` ——
  直接复用 `gap-resident-driver-stable-carrier-liveness` 的 AC1 判据，避免重蹈 promotion-driver 当天踩过的坑），
  `ps` 可见，且死亡时有告警（复用该任务 AC2，⛔ 不接受「pid 文件在，进程已死」这种与「在跑」同形的假态）。
  **取假**：`ps` 零命中，或 supervisor 从 worktree 路径启动 ⇒ 为假。
- **AC138-2（worker-driver 实际生产处理，⛔ 核心条）**：自驱动（非 inner 的 LLM tick 会话）接管起，
  driver **自主选择**（不传 `--task`）并**完整跑完 ≥N 个真实生产任务**——产出可观测的产品/文档/测试变更、
  有真实 commit，`selector_reason` 字段是真实理由（⛔ 非占位值 `"explicit --task selection"`）。
  **N 不在此拍板**（硬规则 4：成本结构未知前不设数值阈值）——先无阈值跑一段生产分布再定。
  **⊢ 「真实任务」的例证（人举例，非穷举）**：同步文档、更新测试这类任务同样算数——
  判据要的是「driver 自主选中并独立跑完」，⛔ 不要求任务本身复杂度，但要求**产出可核（有 diff/commit），
  非空跑/no-op**（否则与「驱动在处理任务」同形却零信息，硬规则③b）。
  **取假**：窗口内 driver 一次都没自主选出并跑完任务，或全部任务是 `--task` 显式指定（`selector_reason` 恒为占位值）⇒ 为假。
- **AC138-3（promotion-driver 全路径生产实证）**：AC132/133 的 fix-worker 路径**在生产中真实触发 ≥1 次**——
  池中真有一条不合格 todo 被驱动自己诊断、派 fix worker 修、驱动重跑同一个闸复核通过（⛔ 非测试环境构造的样本）。
  **⊢ 与 AC138-2 同理**：当前只实证了 AC131 的「合格晋升」这一条路径，**驱动的另一半能力（修不合格）生产样本为零**。
  **取假**：观察窗口内池中出现过不合格 todo、但驱动未走 fix-worker 分支（或走了但从未记录复核通过）⇒ 为假。

**⊢ 依赖与顺序**：AC138-1 依赖 `gap-resident-driver-stable-carrier-liveness`（吸取同一教训，⛔ 不重犯）；
AC138-2/3 的窗口**均自 AC138-1 成立之时起算**（同 AC137 的「无法起算 ≠ 未达成」逻辑，硬规则 3b）。
**⊢ 非目标**：⛔ 不在本条重新设计 selector 语义策略（同 AC129 非目标）；⛔ 不规定 N 的具体数值。

### 本阶段的达成条件（修正）
**达成 = AC130 ∧ AC131 ∧ AC132 ∧ AC133 ∧ AC134 ∧ AC135 ∧ AC136 ∧ AC137 ∧ AC138。**
**⊢ 分工提示（防「造齐机件却没接上」——AC129 那个缺口的同形）**：
AC130–134 = **驱动能做**；**AC135 = outer 不再做（实际切换 + 退役）**；**AC136 = 观测面跟着切**；
**AC138 = 两驱动均从「能做」变成「在生产中真的在做」——这是本次人裁定新增的第九个合取项**。
⛔ 四者缺一，本阶段就只是「多了一个能跑的东西」而非「晋升面机械化了」。
**⊢ 切换判据（人 2026-08-22 16:0xZ 明令）**：当前「结晶」阶段的**任务全部 merge** 后即切换到本阶段，
**⛔ 不要求结晶阶段的 AC 全部满足**——未满足者随其任务 land 后由我持续核（见下）。
**⊢ 持续观察义务（人同令，⛔ 不因阶段切换而免除）**：切换后我仍须**每轮核结晶阶段的 AC 与阶段目标**，
**必要时补立任务**确保那些 AC 与目标**实际实现**，⛔ 不得因为「阶段已切」就把未达成的 AC 当作已翻篇
（这正是硬规则 4 推论三「实现了、测试绿了、但生产没跑过」的阶段级形态）。
**⊢ 非目标（⛔ 不在本阶段做）**：任务体首次撰写 · 跨任务模式识别 · 判据设计与仲裁 ·
**worker-driver 的语义/选择策略改动**（selector 怎么排序候选，那是 AC129 已裁定的非目标，本阶段不重开）。
**⊕ 2026-08-23 收窄修正（AC138 新增后，与本条原文的张力，硬规则 5b 自查）**：
原文「inner 侧 worker-driver 的任何改动」写得过宽，**与新增 AC138-1/2（要求把它生产启用）字面冲突**——
**AC138 要求的 launch/supervisor 包装脚本 + 生产启动这类【承载/部署面】改动不算超纲**，
**同 AC137 当时对 promotion-driver 的处理**（`promotion-driver-launch.sh` 属 Touches，未被「不改驱动」的非目标条挡住）；
⛔ 仍然禁止的是 selector 内部**语义策略**的改动（上一句已界定）。

---

## ⏸ 前一阶段（**2026-08-22 06:1xZ – 17:2xZ，任务全部 merge 已切换；⚠️ AC 未全满足 —— 仍在 manager 每轮核查义务内，⛔ 不得当作翻篇**）：结晶 —— 减少冗余 / 对抗漂移 / 固化机制 / 加速测试

**⊕ 切换时的 AC 达成快照（2026-08-22 17:2xZ，⛔ 诚实记，不因阶段切换而美化）**：
```
已 land 的任务：AC111 · AC115 · AC116 · AC117 · AC128 · AC129 · retry-cap · lock-stuck
                · dashboard-load · live-implcomplete · cross-task-blocking   （done 29+）
⚠️ 阶段 AC 中【仍未验证达成】者（切换后由我每轮核，必要时补立任务）：
   AC110（退役配额：新立案须含 ## Retires）—— 已有多条任务实践，但未做全窗口核算
   AC112（机件总量掉头向下）—— 切换时未重测；本阶段新增 worker-driver.ts 等，方向存疑
   AC113（serial 相不再是最大单项）—— 未复测
   AC114（连续 10 轮 worktree-scope 全量 ≤600s）—— 未复测
   AC111 复扫检查点 —— 触发条件（AC115/116/117/AC129 全 done）**现已满足**，⇒ 下一步应触发
```
**⊢ 本快照本身就是「持续观察义务」的第一份产物**：⛔ 不写「阶段完成」，只写「任务 merge 完成 + 哪些 AC 仍未验证」。

**来源**：人 2026-08-20 07:2xZ 逐字：「本系统中有大量的冗余……系统中还有大量死掉的机制……
这些问题还导致了更多连带的问题，如更慢的 suite 测试和更低的任务吞吐等。
所以，接下来本项目的重点，应当转向**进一步结晶而不是搜索** —— 减少冗余、对抗漂移、固化有效机制、加速测试。
`orchestration/SPEC-worker-driven-inner-2026-08-16.md` 是一个例子。」

### 立阶段前的实测基线（2026-08-20 07:1x–07:2xZ 实测，⛔ 后续 AC 一律锚在这些量上）

```
① 累积比 10:1（git ls-tree 逐周采样，直接量）
   21天前  plugin/scripts=49   plugin/test=29   packages/quay/src=39
   14天前            132              126                     42
    7天前            250              272                     64
    现在             321              315                     66
   ⇒ 方法论机件 78→636 (+715%)   产品源码 39→66 (+69%)   约 10:1

② suite 成本结构（verification-round.jsonl 最近 24 轮分相中位数）
   serial   578s  56.6%   26 文件  concurrency=4   ← 最大单项
   main     359s  35.1%  362 文件  concurrency=8
   static    53s   5.2%
   总计    1022s
   serial 相的 @test-group serial 标注构成：plugin/test 24 个（方法论机件）vs packages/quay 8 个（产品）
   ⇒ 26 个文件吃掉 56.6% 墙钟，且其中 3/4 测的是方法论层自己

③ 600s 目标的真实达成度（人逐字「绝不接受 suite 测试耗时超过 600s」）
   最近 26 轮（08-19 16:00 起）：714/721/927/927/942/968/985/995/1004/1019/1065/1073/1109/
   1160/1162/1193/1254/1353/1695/1826 …  ⇒ 26 轮 0 轮 ≤600s
   ⚠️ 而 AC101 被判「达成」，其判据是「**某轮** ≤600s」（本文件 :681 自陈"没有控制负载"）
   ⇒ 本阶段必须用更强的判据，见 AC114

④ 死机制的真实占比（subagent 全仓扫描，含正负控制）
   plugin/scripts/ 254 个脚本（排除 test/fixture）：
     完全无引用            0 条
     仅 capability-catalog  8 条
     仅 .md 文档提及       11 条
   ⇒ 无代码调用者共 19 条 = 7.5%；**92.5% 机件都有真实生产调用者**
   ⚠️ 方法学陷阱（已修正后才得到上述读数）：packages/quay/plugin/ 是 plugin/ 的整树交付镜像，
      未排除它 ⇒ 每个脚本都从镜像里的 catalog 得一条假命中 ⇒ "仅 catalog"类恒为 0（硬规则 4b 实例）

⑤ backlog 已收敛（⇒ 转向时机对，不是过早）
   近 7 天：立案 103 / 翻 done 243 / 净 -140；存量 1309 条中 1264 done (96.6%)，ready 4 / todo 7
   ⇒ CLAUDE.md 硬规则 12 记的「单日净增 32 条条件」已反转
```

**⊢ 由基线得出的结构诊断（本阶段的靶心）**：
```
主要矛盾  ① 纯累积——活机件太多（10:1）。⛔ 不是"造了一堆没人用的检查器"（那只占 7.5%），
            恰恰相反：它们全接线、每轮都跑，这才是 suite 涨到 1022s 的原因。
第二矛盾  ② 语义漂移——活代码里的陈旧内容（~13min 假前提散布 22 文件 / 双 frontmatter 6 个 /
            impl-complete 写在 fan-in step 4.4 致解耦失效）。最隐蔽，因为代码是活的、测试是绿的。
次要      ③ 真死机制 7.5%——清理是打扫，不是治本。
正反馈环  搜索找缺陷 → 标准修法=造检查器+测试+AC → 检查器成为新维护面&suite成本
          → 检查器自己漂移/失效 → 被下轮搜索找到 → 回到第一步
          （2026-08-19 夜实测：5 个失效机制里 4 个本身就是为修更早缺陷而造的）
```

### AC110（退役配额：新增必须带退役，否则显式标注净增）
**判据（能取假，一条命令可查）**：本阶段起，`tasks/` 新立案的任务体必须含 `## Retires` 段
（列出被本任务退役的检查器/字段/文件，可为空但必须显式写 `net-add: <理由>`）。
**取假**：`git log --since=<阶段起点> --grep='^tasks: 立案'` 逐条取任务文件，缺该段者即违规；
连续 7 天违规数必须为 0。**⊢ 这条直接对着基线①那个 10:1 比例，是本阶段唯一的"止血"判据。**
**⛔ 不设"必须退役 N 个"的配额数**（硬规则 4 推论：成本结构未知前不设数值阈值）——
本条只要求**回答这个问题**，不要求答案非空。

### AC111（无代码调用者的机件逐条判定，"仅文档提及"类归零）
**判据（能取假）**：对【切换时重扫】的无代码调用者机件清单逐条给出三选一的判定并落记录：
`wired`（接进机械触发点）/ `retired`（删除）/ `manual-by-design`（保留 + 写明为什么必须靠人跑）。
**⛔ 清单不沿用 08-16 的 19 条字面量**（8 catalog + 11 .md 是旧快照，本阶段新增机件已使其漂）——切换时用同一扫描谓词现推并落盘清单，再逐条三选一。
**取假**：判定完成后用**同一个扫描谓词**（含排除 `packages/quay/plugin/` 镜像的那一条修正）重扫，
"仅 .md 文档提及"这一类**必须为 0**——要么变成有代码调用者，要么文件已不存在，要么被显式登记为 `manual-by-design`。
**⊢ 为什么这 11 条最值得动**：它们的"调用者"是 `*-tick-core.md` / `SKILL.md` 里的一行散文指令
（`halt-check.sh` / `real-target-verify.sh` / `red-window-triage.ts` / `manager-tick-log-check.sh` /
`prefriction-count.sh` 等），**靠某一层每轮记得去跑** ⇒ 正是硬规则 9 说的"守与不守在记录上无法区分"，
也正是本文件 `:1949` 观察项那句「义务的可靠性由【到外部触发点的跳数】决定」的活样本。

### AC112（机件总量掉头向下）
**判据（能取假，一条命令）**：`git ls-tree -r --name-only HEAD plugin/scripts/ | wc -l` +
`git ls-tree -r --name-only HEAD plugin/test/ | wc -l` 的**和**，必须**低于切换时重测的基线**。
**取假**：重测 ≥ 切换基线 即本 AC 为假。
**⛔ 基线不沿用 08-16 的 636（321+315）字面量**——本阶段（AC120–127）新增 `suite-bucket-*.ts` 等已使其漂；切换时现测一次并钉新字面量于此。
**⛔ 不接受"新增的比退役的少"这种相对说法**——判据是绝对总数下降，因为那才是 suite 成本的驱动量。

### AC113（serial 相不再是最大单项）
**判据（能取假）**：`verification-round.jsonl` 中**新于阶段切换**的 **worktree-scope** 轮次
（⛔ 08-16 前判据写 `main-scope`——AC84 后全量轮全写 `scope=worktree`、main-scope 轮=0 结构性不可达，此为激活前必修判据面），
其 `serial_phase_ms` 中位数必须**低于 `main_phase_ms` 中位数**（当前是 578s vs 359s，serial 更大）。
**⛔ 不接受靠调并发把 serial 压下来**——必须同时满足：serial 相的 `@test-group serial` 文件数
**低于切换时重测的基线**（⛔ 不沿用 08-16 的 26）。两条**同时**成立才算达成。
**⊢ 治本路径（供落笔方参考，manager 不代做）**：AC110/AC111/AC112 的副产品——机件退役 ⇒ 它的测试随之消失，
serial 组自然缩小。⛔ 逐个把 26 个测试改成非 serial 是治标，且成本高（多数因抢 tmux/进程/文件锁而必须串行）。

### AC114（600s 目标用**能取假的强判据**重新验收）
**判据（能取假）**：**连续 10 轮** **worktree-scope** 全量 suite（`verification-round.jsonl`，`scope=worktree`，
⛔ 原 `scope=main` 在 AC84 后=0 结构性不可达、已修为 worktree；时刻新于阶段切换）**全部 ≤600000ms**。
**⛔ 明确推翻 AC101 的弱判据**：本文件 `:681` 自陈 AC101 的判据是「**某轮** ≤600s」且「**没有控制负载**」；
实测最近 26 轮 **0 轮达标**（714s–1826s）⇒ 那个"达成"在人的原意（「绝不接受超过 600s」）下不成立。
**⛔ 600 这个数不是我推导的**——人 2026-08-16 逐字设定，本条只是把它从"某轮"改成"连续 10 轮"，
⛔ 我不改这个数值，也不新设别的阈值。
**⊢ 与 AC113 的分工**：AC113 管**成本结构**（谁是大头），AC114 管**总量**（人的硬线）。
两条都需要，因为总量可以靠一台空闲机器偶然达标（round224=500.8s 就是那样），而结构不会骗人。

### AC115–AC117（`SPEC-worker-driven-inner-2026-08-16.md` 三阶段落地）
**正本**：`orchestration/SPEC-worker-driven-inner-2026-08-16.md`（status: proposal，**本阶段即人裁定的排期**，
该 SPEC §8 原文「不在本 SPEC 内立 AC：按人的排期裁定再立」⇒ 此处立）。
**⛔ 判据不在此处复制**——SPEC §5 已逐阶段写明形态/判据1-3/退役清单，**读 SPEC，本处只做编号绑定**：
```
AC115 = SPEC §5 阶段 1（驱动 + 单 worker）      退役目标：--in-flight 参数传递、遥测括号的"在飞"用途
AC116 = SPEC §5 阶段 2（并发 N + stash 镜像）   退役目标：cap-from-gate / process-budget 并发裁决、A6
AC117 = SPEC §5 阶段 3（MCP 控制面）            退役目标：.halt 文件机制（⛔ 不得与 MCP halt 并存）
```
**⊕ 贯穿判据（SPEC §5 已写，此处提升为本阶段的必答项）**：**每阶段必须列出【退役清单】**——
⛔ 只报"新机制跑起来了"而不报退役清单，不算达成。**这与 AC110 同源**：
SPEC 是目前唯一一份把"检查机制净减少"写成必答项的文档，本阶段把它推广成全阶段纪律。
**⊢ SPEC §4④ 的约束原样有效**：单任务墙钟超时值 **⛔ 不得拍脑袋**，先无阈值跑一段记录分布再定。

**⊕ 2026-08-22 补（manager 记，人核实同意）——AC115-117 全部落地后的复扫检查点**：
AC111（无代码调用者机件三选一判定）的扫描时点在 AC115-117 之前，**结构上扫不到 inner-tick 专属机件**——
这批机件在扫描当时**仍有调用者**（inner 自己的 tick-core 读数/推理逻辑），只会在 AC115-117 把 inner 从
"cron 唤醒的 LLM 会话自己推理" 换成 "机械驱动进程" 之后才变成无调用者。⇒ **AC111 的一次性扫描覆盖不到这个滞后 population**。
**判据（不新造机制，复用 AC111 同一扫描谓词，仅挪后触发时点）**：**AC115 ∧ AC116 ∧ AC117 ∧ AC129** 全部 done 后，
用 AC111 用过的同一扫描谓词对 `orchestration/*-tick-core.md`（inner 专属部分）+ inner 相关机件脚本再扫一轮，
逐条三选一判定（wired/retired/manual-by-design），与 AC111 同形。
**⊢ 与 AC110/AC111 纪律同源**：净增退役配额 + "不得因为很久没报红就退役、必须说出防的缺陷现在由什么防"原样适用。
**⊢ 触发条件（不设时间阈值，设状态阈值）**：**AC115/116/117/AC129 四者** status 全部 done 时触发，不早于此。

**⊕ 2026-08-22 15:4xZ 修正一（人核实同意）——AC129 必须进触发条件**：原写 AC115/116/117 三者。
**但 inner-tick 专属机件真正失去调用者的时点是 AC129 落地**——AC117（MCP 控制面）只换控制通道，
**决策层（"谁决定现在跑哪个任务"）要到 AC129 的选择环接上才从 inner 的 LLM tick 会话移走**。
⇒ 三者 done 而 AC129 未 done 时，inner-tick 的读数/推理逻辑**仍有真实调用者**，此时扫描会把它们判成 wired 而漏掉。

**⊕ 2026-08-22 15:4xZ 修正二（人核实同意）——web 观测载体切换纳入复扫范围**：
**真相源在驱动模式下发生位移，而 web 读的仍是旧载体**——
`packages/quay/src/observation.ts` 的 `readLive()` 读 `.workflow-events/*.jsonl`（fast-mode 遥测），
`InFlightTask` 的 `runId`/`liveness` 字段建立在**当前 inner+subagent 模型**上；
驱动模式的真相源是 `.quay/worker-outcome.jsonl`（AC115 已落地）+ **驱动自己 fork 的子进程数**（AC115 的直接量）。
**⇒ 复扫时必须一并核**：(a) `readLive()` 是否已切读 worker-outcome 载体；
(b) `/live` 与 dashboard `liveCard` 展示的在飞语义是否与驱动的直接量一致；
(c) **今日立案的两条 web 任务**（`gap-webui-live-implcomplete-state-render` /
`gap-webui-cross-task-blocking-visibility`）**均基于旧模型撰写**，其字段假设（`implCompletedAtMs` 等）
在驱动模式下是否仍成立——⛔ 不得让 web 显示一个已不再是真相源的量（这正是硬规则 4b 的形态：
页面看起来正常、数字也在动，但它读的载体已经不是系统的真相）。

### AC129（驱动常驻 + 自主选任务 —— 「持续运行的机械驱动进程」的终态闭合，2026-08-22 补）

**⊢ 为什么必须单列（判据覆盖缺口，非实现质量问题）**：SPEC §3.1「组件」列了驱动的 **7 项**——
选择环 / selector worker / 记录 / task worker / 并发控制 / 超时 / MCP 面；
而 **§5 三阶段判据只覆盖了后 5 项**：AC115=task worker+记录、AC116=并发控制+超时+stash、AC117=MCP 面。
**「选择环」与「selector worker」两项在 AC115/116/117 的判据里字面缺席**，且「驱动常驻」本身也无任何 AC 要求。
**实读 `plugin/scripts/worker-driver.ts` 确证现状**：`:171` 逐字 `"no --task given (phase 1 does not yet run
the selector worker; pass --task <id>)"`；全文件无 `while` / `setInterval` / `ready-pool-check` 调用
⇒ **当前是「单次 spawn 脚本」，不是「常驻驱动进程」**（spawn 一个 worker → wait → 写 outcome → 退出）。

**判据（三条，全部能取假）**：
- **AC129-1 常驻**：驱动跑完一个 worker 后**不退出**，池非空且未达并发 cap 时自动起下一个。
  **取假**：现状为假——单次 spawn 后必退出。
- **AC129-2 自主选任务**：不传 `--task` 启动驱动 ⇒ 它自己走选择环（调 `ready-pool-check` 取可行集 →
  减去内存中的在飞集 → 打散 → 交短命 selector worker）并起 worker，且把「选了谁 + 一句理由」机械落进
  outcome 记录（`selector_reason` 不再恒为 `"explicit --task selection"`）。
  **取假**：现状为假——`:171` 无 `--task` 即报错退出。
- **AC129-3 判停（能取假）**：`.halt` 存在 / `resource-gate` 报 WAIT / 池空 ⇒ 驱动**停止起新 worker**，
  ⛔ **不杀在飞**（与 AC117 halt 边界语义一致）。**取假**：置 `.halt` 后驱动仍起新 worker ⇒ 本条为假。

**⊢ 不补这条的后果（这才是它必须存在的理由）**：AC115∧116∧117 全 done 后，
**「谁决定现在跑哪个任务」仍是 inner 的 LLM tick 会话** ⇒ SPEC §2 列的两条核心收益
（①消掉「空槽+池里有货+就是不派」②义务随【任务长度】而非【会话长度】衰减）**结构上不成立**——
因为决策层仍是那个长命会话。**⇒ 三阶段造齐了所有机件，却没有一条判据要求把自主性接上。**

**⊢ 依赖**：`depends_on` AC116（选择环要「减去在飞集」才能决定还能起几个，并发控制是其前提）。
AC117 land 后，AC129-3 的判停判据中 `.halt` 应同步切换为 MCP halt（⛔ 不得两者并存，与 AC117 退役清单一致）。
**⊢ 非目标**：⛔ 不在本条里重新设计 selector 的语义策略（SPEC §1 设计点1 已裁定「选择仍应是语义的」，
即 selector worker 是 LLM）；本条只要求**这条链被接上且能取假**，不规定它怎么排序候选。

### AC128（hub 单体按关切拆文件——爆炸半径收窄，⛔ 不冒充吞吐）

**判据（能取假，grep 函数名）**：`scripts/test.sh` + `plugin/scripts/full-suite-runner.ts` 里 harness-critical 关切
各自抽出到聚焦文件，两单体不再承载其函数定义。取假样本：
红解析（`gateScanCause`/`isFailureLine`/`buildStaticCheckFailures`）、并发-lanes（`hostParallelism`/`concurrentSuiteSlots`/`spliceConcurrency`）、
闸门-static（`resource_gate_check`/`run_static_checks`）、树态（`snapshotAssertionSurface`/`readTreeState`/`readVerifiedCommit`）、
状态写（`writeStateGuarded`/`appendVerificationRound`）——在原两单体命中 **0**、在各自新聚焦文件命中；
且全量 suite 绿 + 分桶选择行为不变（行为保真）。

**⊢ 诚实定位（⛔ 不写成吞吐优化）**：30 天 hub 两单体 252 次提交、~7 个关切挤 2 文件 ⇒ 任何 suite 关切迭代都动同一个大单体。
**拆文件不省 full-suite**（新文件仍是 hub，触碰仍全量——harness-critical 改动必须全量验证，这是对的）；
省的是【爆炸半径 + review 面 + 合并冲突 + 未来演进速度】。吞吐率这笔账已由 AC124/126（分桶）结掉，
本判据里 ⛔ 不得出现任何耗时/吞吐数字（否则是拿结构卫生冒充吞吐，硬规则 4）。

**⊢ 与 AC112 的张力（显式记，不回避）**：拆分使 `plugin/scripts/` 文件数 +N（1 单体 → ~5 聚焦），
与 AC112「总量掉头向下」方向相反——**一次性重构成本，非机制净增**；
本判据按【函数有家】不按文件数，故不与 AC112 冲突；落笔提交信息须标「拆分重构，非新增机制」，
且 AC112 的切换时基线（现测）把这次 +N 计入分母、不判为违规净增。

**⊢ 依赖（记不改）**：accounting/overhead 剥离已立案（`gap-suite-hub-file-responsibility-strip`，当前阶段后续）；
本条覆盖其余 harness-critical 关切。前者 land 出的 `suite-accounting.ts`（非 hub）是本条【行为保真 + hub 清单边界】的参照——
拆分后 `suite-bucket-hub-list.ts` 的 HUB_FILES 须逐文件核：harness-critical 新文件在列、非 harness 不在列。

### 本阶段的达成条件与已知风险

**达成 = AC110 ∧ AC111 ∧ AC112 ∧ AC113 ∧ AC114 ∧ AC115 ∧ AC116 ∧ AC117 ∧ AC128 ∧ AC129。**

**⊕ 激活前修正（2026-08-22 桶分析后，manager 补，四处须在切换时修/重测，否则判据失真）**：
① **AC113/AC114 判据面 scope=main→worktree**——AC84 后全量轮全写 `scope=worktree`、main-scope 轮=0，原判据结构性不可达（已在上文两处 AC 内联改）。
② **AC112 基线 + AC111 清单切换时重测现推**——本阶段新增 `suite-bucket-*.ts` 等使 08-16 的 636/19 漂（已在上文内联改）。
③ **方向验证（不新增 AC）**：桶分析证「靶是 S 桶（59.9% file-time）」——退役机件 ⇒ S 测试消失 ⇒ serial 缩，与 AC110–113 一致；⛔ 不再立 S 桶判据（与 AC112 总量 + AC113 serial 冗余）。
④ **AC114 600s 与分桶交互（记不改数值）**：分桶后全量轮仅 hub（12.9%）触发，600s 的吞吐意义被分桶分担；但 600 是人逐字硬线不改。⛔ 注意「连续 10 轮 full」在分桶后攒数更慢——与①的 scope 缺陷同源，一并修。
**⚠️ 已知风险（人已在 SPEC §7 显式接受两条，此处再记一条本阶段特有的）**：
**退役会打破"有检查总比没有好"的直觉** —— 退役一个检查器时，必须能说出
「它防的那个缺陷，现在由什么防」或「那个缺陷类已不可能发生（结构性）」。
⛔ 不得因为"它很久没报红"就退役——那可能是硬规则 4 的恒绿检查器，恒绿恰恰是它失效的证据，不是它没用的证据。
**⇒ 每条退役必须在提交信息里回答这一句**，这是 AC110 `## Retires` 段的内容要求。

---

## ⏸ 前一阶段（2026-08-16 – 2026-08-16 16:2xZ，**已达成 9/9 并已发布 v0.5.0**，内容原样保留）：产品化 build 与实际验证 —— 基于当前版本

> **收口记录（2026-08-16 16:2xZ）**：AC85–AC93 **全部 done**（逐条核实的是真凭据：AC86 的 CI run
> `31925993366` conclusion=success；AC88 的 `.quay/productization-verification.jsonl` 记录了 B/C 两机
> **10:37Z 真实 false → 15:36Z 真实 true** 的翻转，不是 fixture 灌值；AC93 的 `version-consistency-check.ts`
> 实跑 OK）。**随后按人裁定完成发布**：`develop-archived-20260816` 保留旧 origin 分叉历史（37615c7d），
> `origin/develop` = `08e8ec55`（与本地 0/0 分歧），tag `v0.5.0` → 同一提交，release 建于 16:23:52Z，
> 8 处版本文件统一 0.5.0。**遗留（非本阶段判据要求，不阻塞收口）**：
> `gap-delivery-laydown-dist-closure-gap`（tgz 只装 dist/*.js，`.ts` 源码层缺失）status=ready，未实现。

**来源**：人 2026-08-16 裁定「检查最近一周的其它阶段目标和 AC，找出其中关于产品化 build/release
和在其它主机/设备验证本项目产品化 build/release 的内容，以及相应的任务。然后，创建一个新的阶段目标
和 AC，以基于当前版本产品化 build 和实际验证为目标，然后切换当前阶段到该新建阶段，驱动落实。」

**前一阶段（语义派发，AC54–AC84）状态**：**17/26 已勾，9 条未勾（含在飞 follow-up，见下方降级区块）**。
**⛔ 不因本次切换而停止**——AC76/AC84 的后续工作仍在 `tasks/*.md` 独立追踪，阶段切换只改变
manager 这一层「当前判读焦点」，不影响 outer/inner 的正在跑的工作。旧阶段完整内容原样保留在下方
（标题已从「当前阶段」降级），回查请读该区块，⛔ 不要因为它不在文件最上方就当它已作废。

**检索方法（本轮，供核实）**：搜 `manager-phase-goal-archive.md`（08-05/06 的"产品化交付"大阶段）+
当前 `manager-phase-goal.md` + `tasks/*.md`（最近一周新建），命中的关键载体：
```
SPEC-quay-self-hosts-its-own-cold-start.md（08-04）—— 已有 AC8c 六键判据，形式化程度比预期高
gap-quay-has-never-self-hosted-its-own-cold-start（08-04，compound，todo）
  三个子任务【全部 done】（gap-cold-start-skill-has-no-recovery-branch /
  gap-no-formalized-bare-metal-session-bootstrap / gap-quay-self-hosting-e2e-proof）
  ⇒ parent 本身结构性可收口，但从未真正翻 done
dist-verify-node-floor（.github/workflows/ci.yml:66，真 npm-pack 产物在 Node 20 floor 上跑）
  —— gh run list 实测：最近一次真实运行 = 2026-08-03，距今 13 天
  根因（实读 ci.yml:3-9）：触发条件仅 push/PR to master；本项目开发主线是 develop
  （ADR-022 已退役经典循环，fast-mode 三层只在 develop 上跑，从不合 master）
  ⇒ 【结构上不可能被现在的开发流程触发】，不是"偶尔没跑"
origin/develop 落后本地 develop 数千提交（37615c7d vs 现 HEAD）—— 本地循环从不 push
本机现在【没有】任何当前版本的 .tgz 产物（ls packages/quay/*.tgz 为空，上次 08-06 build 已清理）
上次跨主机（B=orangevps / C=ad-arm1）验证是 08-11 附近的 scoped 复测（launch-settings 单个 fix），
  不是「完整安装+初始化+冷启动」的全流程，且早于今天落地的多个改动（AC65/AC76/send-to-session.ts 等）
```

### AC85（本机 build 产出当前版本的可用产物）
**判据（能取假）**：`bash packages/quay/scripts/package.sh` 产出 `.tgz`；`tar tzf` 校验其
`plugin/` 条目非空（08-06 曾错把 `npm pack` 当入口，得 0 条，教训见 archive）；产物的
`package/plugin/.claude-plugin/plugin.json` 版本号与仓库当前 `plugin/.claude-plugin/plugin.json`
一致（证明不是陈旧产物）。**⛔ 不得引用 08-06 的旧产物作为达成证据**——那个 `.tgz` 已不存在，
且早于今天落地的多个改动。

**🔴 2026-08-16 04:2xZ 判据补强（人裁定「关键是产出可实际部署和实际应用的 build」）**：
上面这条是**必要不充分**——它只证明「打进去了」。**充分条件在 AC90–AC93**（见下方新区块）：
交付副本不得漂离正本（AC90）、交付面不得引用未交付的文件（AC91）、
交付验证面必须与实际使用面相交（AC92）、两条分发链版本一致（AC93）。
**⇒ AC85 单独勾选不构成「产品化 build 可用」**，本阶段的达成读 AC85 ∧ AC90–AC93。

### AC86（`dist-verify-node-floor` 在当前开发流程上有等价的真实执行路径）
**判据（能取假，这是本阶段的核心发现）**：`dist-verify-node-floor` 现状【不可能被触发】
（push/PR to master 门禁，主线在 develop）。**不是要求"让它跑起来"这么简单**——
要么①在 develop 上补一个等价触发（如 `scripts/test.sh` 之外的独立 CI job 挂 push-to-develop），
要么②在本地/per-task suite 流程里补一个等价的本机 floor 验证步骤，
**⛔ 不得只改 `on:` 触发条件了事**——判据是"真实运行过至少一次且时间新于本次切换"，
不是"配置看起来对了"（同 SPEC gap-phase-boundary-differential-accounting 的推论三教训：
fixture/配置正确 ≠ 已产出）。

### AC87（`gap-quay-has-never-self-hosted-its-own-cold-start` 收口）
**判据**：三个子任务已全部 done（`gap-cold-start-skill-has-no-recovery-branch` /
`gap-no-formalized-bare-metal-session-bootstrap` / `gap-quay-self-hosting-e2e-proof`）；
parent 的阻碍原因（compound depsReadyFor 死锁）已被 `gap-compound-depsreadyfor-structural-deadlock`
（done）解除。**本 AC 要求实际把 parent 翻 done**（不是重新验证子任务，是核实收口条件已满足并执行）。

### AC88（跨主机验证针对当前版本重新做一次，非历史复测）
**人 2026-08-06 原始裁定范围（仍适用，未被推翻）**：两台机器（B=orangevps, C=ad-arm1），
安装源 = 本机 `package.sh` 产出的 `.tgz`（非 git clone、非 GitHub Actions release 资产），
验证①正确安装 ②正确初始化（项目内 `quay-init`）③正确冷启动（outer 和 inner，不含 manager）。
**判据（能取假）**：验证时刻新于 AC85 产出的当前产物；⛔ 不得引用 08-06/08-11 的历史验证记录
作为本 AC 的达成证据（那些针对的是旧版本或单个 scoped fix，不是当前完整版本的全流程）。

**🔴 2026-08-16 04:2xZ 判据改写（本轮实查 AC85 生产载体后，我自己发现的判据缺陷）**：
上面这句「新于 **AC85 产出的当前产物**」**指向一个已经不存在的对象**——实查：
```
主检出 packages/quay/*.tgz = 【无任何产物】
全盘 find 命中的 3 个 tgz 全在【别的任务的 worktree 里】（gap-ac86-* / gap-ac88-* 自己 build 的）
.gitignore:21  `*.tgz`  ⇒ 产物结构上不进 git
⇒ AC85 的产物随其 worktree 在 fan-in 时被删除；AC85 的 AC1-AC4 全勾且 Evidence 记了路径/大小/时间戳，
   但那个路径今天已不可解析 ⇒ 【达成证据事后不可复核】
```
**⛔ 这不是说 AC85 该退回**（它的判据当时确实被满足了，是判据本身写错了对象）。
**⇒ 判据改为**：AC88 的验证**所用 tgz 必须由该次验证自己从 develop-tip 现 build**，
并记录**该 build 的 `git rev-parse HEAD`（commit sha）+ 产物 sha256**；
达成条件 = 该 commit sha 是 develop 上**新于本次阶段切换（2026-08-16）**的提交。
**⇐ 为什么这样改**：commit sha 与 sha256 是**事后仍可核**的对象，`.tgz` 文件路径不是。
**同一个教训的一般形态（记在这里，不另立条）**：**判据不得引用一个生命周期短于判据本身的对象。**
worktree 内的产物、临时目录、进程 pid 都属此类；commit sha / 内容哈希 / 已提交的记录文件才是合格的锚。

**🔴 2026-08-16 复核：本 AC 原文只是范围转述，不具体可执行——三点缺口，实测钉死**：
```
① develop-deliver-tgz.sh（DIR-123，人 08-11 裁定，已注册 catalog）只覆盖判据①（装 tgz + curl 探活），
   grep quay-init 该脚本 = 0 命中 ⇒ 判据②（初始化）无任何自动化
   ③冷启动 outer/inner 也没有——脚本只做 `quay serve` 端口 HTTP 探活，不是「outer/inner 冷启动」
② orangevps（B）现状：~/work/quay 是 sync.sh 同步的开发树（有 .git、非 tgz 安装）
   ⇒ AC88 明写"⛔ 非 git clone"，这台机现在的东西正是被排除的形态，不能当验证对象
③ ad-arm1（C）现状：~/work/ 下【没有】quay 主 checkout（只有 quay-worktrees 历史任务遗留）
   ⇒ 这台机上不存在可供"冷启动验证"的已安装 quay，要从零装
```
**⇒ 不补齐这三点，"验证时刻新于 AC85"这条判据会退化成又一次人工操作**——跟 08-06 那次同形，
验证的是"这一次做到了"，不是"机制可重复"。**⊢ 补齐路径（供落笔方参考，manager 不代做）**：
```
① 扩展 develop-deliver-tgz.sh（或新增一步）覆盖 quay-init + outer/inner 冷启动的机械验证
② B 机先清理/重装为真正的 tgz 安装（当前 sync 树不满足"非 git clone"）
③ C 机走完整流程从零装一次
```
**判据不变（能取假 + 验证时刻新于 AC85），但达成前必须先解决上述三点，⛔ 不得跳过直接手工验证一次充数。**

**🔴 2026-08-16 04:0xZ 新增依赖（inner needs-human 转裁，我按优先级判断路由）**：
develop 基线 23 文件/7 族测试自 08-15 起恒红（`quay-init*` / `install-config-driven-e2e*` /
`cold-start-skill` / `real-target-verify` / `capability-catalog` / `select-preflight-cli`），
**正是本 AC 验证机制要跑通的对象本身** —— 不修，AC88 的机制无论怎么扩展都会撞上同一堵墙。
**⇒ AC88 depends_on 一个独立的 suite-fix 任务**（归 outer 立案，不折进本阶段任何 AC，规模过大会污染
阶段目标可读性）。**⛔ override 可解锁单个撞上它的任务，不能替代这个真修复。**
**任务已由 outer 立案 + 派发（2026-08-16 04:1xZ）**：`gap-suite-fix-red-baseline-2026-08-16`
（立案提交 `fd9c834b`，执行体 = `execute-suite-fix` workflow，run `wf_28ef714f-9cf`）。
**⚠️ 更正（inner 2026-08-16 核实，我采纳）**：`fan-in-execute.js` **没有**机械 override/ALLOW flag
（args 固定 task/worktree/root/runId/mergeTarget）⇒ 我原话里的「(b) override」在当前接线下
**不是可执行选项**。inner 的处置（任务保持 ready + worktree 保留，等基线绿后重跑 fan-in）是对的。

### AC89（AC85–AC88 完成后，产品化状态写回一处可核的记录）
**判据**：验证结果（成功/失败 + 证据）落一份可机械核对的记录（同 per-task-suite-records.jsonl
的形态——不是散文报告），供下次"产品化健康"检查复用，⛔ 不要求新造一个仪表盘。

---

## 🆕 AC90–AC93：交付物的**能力面**必须与**实际开发过程**一致（人 2026-08-16 04:2xZ 逐字裁定）

**人原话**：「进一步检查和更新该 phase goal，保障其可操作性。* 可参考本项目历史材料
* **关键是产出可实际部署和实际应用的 build** * **应对照本项目 Claude Code 会话历史
（即本项目的实际开发过程），检查交付物交付的能力是否一致**」

**⇒ 这条推翻了 AC85 判据的充分性**。AC85 原判据只查「tgz 里 `plugin/` 条目非空 + `plugin.json`
版本一致」——**那只证明"打进去了"，不证明"装完能用"**（硬规则④推论三同形：fixture/配置正确 ≠ 已产出）。
真问题是：**三层循环每天实际在调的能力面，在目标机 tgz 装完之后是不是都还在、都能跑。**

### 本轮实测读数（两组只读枚举，全部可复算，⛔ 无一条是推测）

**读数①——tgz 实际交付什么**（`packages/*/package.json` 的 `files` 白名单 + `package.sh` 的暂存重写）：
```
交付（仅 quay 包，files:21-30 = README/CHANGELOG/LICENSE/bin/src/dist/plugin/scripts/register-plugin.mjs）
  plugin/ 全树快照（package.sh:93-96 `cp -R`），减去 plugin/test（:115），
  且 plugin/scripts/*.ts + gate-scripts/*.ts 被删除、换成 dist/*.js 打包（:156-159），
  并【重写调用方】（tick 文档 / skills / .sh / quay-init）指向 dist/*.js
⛔ 不交付（四个包的 files 全部不含）
  .claude/            ← 现役 7 个 workflow 的正本所在
  orchestration/      ← 三层执行核 + 判准/收尾/发消息正本（466 行）
  tasks/ · experiments/ · 仓库根 scripts/（只有 register-plugin.mjs 单文件例外）
另：quay-native/quay-github/quay-backlog 三包 private:true 且 files 不含 plugin
分发有【两条独立链】：npm tgz（npm install -g）与 /plugin install（marketplace ref=dist-plugin 分支，
  由 .github/workflows/publish-plugin-dist.yml 在 `v*` tag 推送时 force-publish）
```

**读数②——开发过程实际吃重在哪**（`get_work_patterns` 全历史 tool_frequency，非自述）：
```
Bash 16428 次  ← 三层做事的绝对主力通道：plugin/scripts/ 的 245 个 ship 脚本经 Bash 起进程
SendMessage 2163 · ScheduleWakeup 396 · CronList 326 · Agent 271 · Workflow 221 · CronCreate 216
mcp__quay__* 合计仅 70 次（task_write 37 / lifecycle_retreat 11 / promote 9 / task_get 8 / list 4 / adr_list 1）
  ⇒ 18 个 MCP 工具里【12 个实测零调用】（task_check/gate_run/gate_log/gate_list/lifecycle_complete/
     adjudicate/adr_get/adr_write/config_validate/action_list/action_run/instrument）
三层执行核直接点名的 plugin/scripts 脚本 ≈ 60 个；点名的 workflow = execute-suite-fix / fan-in-execute /
  manager-tick-core / pool-quality-judge
```

**⇒ 对照结论（四个缺口，每个都能取假）**：

### AC90（交付副本与正本的漂移必须有【接线的】闸——现状是自称有、实查无）
**实测（本轮，一条命令可复算）**：
```
diff orchestration/ vs plugin/loop/（交付的执行核副本）
  manager-tick-core.md    114 行差异
  fast-mode-tick-core.md   46 行差异
  manager-loop-tick.md   2198 行差异
  orchestrator-tick-core.md  相同
orchestration/manager-tick-{criteria,closing,sending}.md（466 行判准正本）
  → find plugin/ -name 同名 = 【plugin/ 内无对应文件】⇒ 交付面根本没有这三件
plugin/sync.sh:15 头注释自称「CI: sync.sh && git diff --exit-code plugin/ — fails if plugin is stale」
  → grep .github/workflows/ = 零命中；grep scripts/ = 零命中；
    plugin/test/ 只断言「文件存在且可执行」（plugin-packaging.test.mjs:536-538）
  ⇒ 【这个防漂闸从来没有执行者】；且 sync.sh:5-6 只同步 .claude/workflows/ → plugin/workflows/，
    结构上就不覆盖 orchestration/ → plugin/loop/
```
**⇒ 硬规则⑨的教科书形状**：守与不守在记录上无法区分 ⇒ 只能靠意志 ⇒ 已实际漂了。
**判据（能取假）**：①存在一个**每轮/每次提交会被执行**的检查（接进 `scripts/test.sh` 静态层或 pre-commit，
不是只写在注释里），它对上述**任一**副本-正本对出现差异时**报红**；②该检查的覆盖面**显式枚举**并包含
`orchestration/*-tick-core.md → plugin/loop/`（现有 `workflows-dual-copy-drift-check.ts` 只守 3 个 workflow，
不覆盖 loop 文档）；③**负控制**：故意改正本一行不改副本 ⇒ 该检查必须红；不红则本 AC 不成立。
⛔ 不接受「把 plugin/ 副本手工同步一次」当达成——那修的是这一次的值，不是闸。

### AC91（交付的执行核不得指向【未交付】的文件）
**实测**：交付的 `plugin/loop/orchestrator-tick-core.md` 在 `:39` 引用 `.claude/workflows/execute-suite-fix.js`、
在 `:70` 引用 `.claude/workflows/pool-quality-judge.js`；而 `plugin/workflows/` 只有 3 个双拷贝
（drain-directives / fan-in-execute / run-routines），`quay-init --workflows` 也只从 `plugin/workflows/` 铺
（`quay-init.sh:23`）⇒ **装完 tgz 的目标机上，这两步指向不存在的文件**。
**⇒ 这正是 `referenced-not-landed` 类，但它逃过了那个 guard**（`quay-init.sh:1131` 的三条件 AND 里
「在 init/SKILL.md 声明过」这条会豁免掉，需实读确认是哪条豁免的）。
**判据（能取假）**：对**交付面全体**（`plugin/` 内所有 .md/.sh/.ts→dist）做一次引用解析，
枚举出「引用了一个不在交付集里的路径」的全部条目（**枚举，不是布尔**，硬规则③），
条数降到 0 或每条有显式豁免记录；且有一个会被执行的检查守住它。
⛔ 不得只修这两条了事——**必须先给出全量条数**，否则修的是抽样。

### AC92（交付验证面必须与实际使用面相交，现状几乎不相交）
**实测**：`develop-deliver-tgz.sh` 在远端装完后跑的全部验证 = `quay --help`（`:140`）+ 铺临时 workspace
跑 `quay serve --port 18091` 并 `curl` 校验 `http_code==200`（`:141-161`）。
而开发过程真正吃重的是 **Bash 16428 次**打向 `plugin/scripts/` 的 245 个 ship 脚本 + 4 个被点名的 workflow
+ 14 个 skill；**MCP 面 18 个工具里 12 个实测零调用**。
**⇒ 验证的是「端口活着」，使用的是「几百个脚本能不能跑」——两者几乎不相交。**
**判据（能取假）**：装完 tgz 的目标机上，**按实测调用频次取前 N 个真实被使用的机件**
（N 由读数②的分布决定，⛔ 不许拍一个数字——硬规则④推论：成本/分布未知前不设阈值），
逐个**真实执行一次**并断言退出码与非空输出；至少必须含 `capability-catalog.sh`（目录自身）
+ 三层执行核点名的那 ≈60 个脚本里可离线跑的子集。**负控制**：删掉目标机上任一被验证的脚本 ⇒ 验证必须失败。
**⇐ 本 AC 与 AC88 的分工**：AC88 管「跑没跑过」，本 AC 管「跑的是不是该跑的东西」。

### AC93（两条分发链的版本必须一致，且 `/plugin install` 链在 develop 流程上可触发）
**实测**：
```
.claude-plugin/marketplace.json   version = 0.3.13   ← /plugin install 实际拉的版本号
plugin/.claude-plugin/plugin.json version = 0.4.0
plugin/VERSION                            0.4.0
packages/quay/package.json        version = 0.4.0
publish-plugin-dist.yml 唯一触发 = `v*` tag 推送；最后一个 v* tag = v0.4.0，打于 2026-08-06（10 天前）
```
**⇒ 与 AC86 同形的结构性缺口**：dist-plugin 链的触发条件（`v*` tag）在当前 develop 三层流程里
**从不发生**，所以 `/plugin install` 拿到的永远是 10 天前的树，而 marketplace 还声明着一个更老的版本号。
**判据（能取假）**：①四处版本号一致（一条命令可查，现状 3:1 不一致）；
②`/plugin install` 链要么**在 develop 流程上有真实可触发的路径且真跑过一次**（时间新于本次切换），
要么**显式记为退役**并从 `.claude-plugin/marketplace.json` 移除误导性的 source 声明——
⛔ 二选一，不接受「保留一个从不触发的链」（那是硬规则③的布尔化：留着看起来有，实际没有）。

**⛔ AC90–AC93 的落笔归属**：全部是 `plugin/` + `.github/workflows/` + `packages/quay/scripts/`，
归 inner（实现）+ outer（立案/派发，C17）。**manager 一条不改。**
**⛔ 优先级**：`gap-suite-fix-red-baseline-2026-08-16` 仍是最高优先级（AC88 depends_on 它）；
AC90–AC93 排在 AC85/AC86 在飞 impl 之后立案，⛔ 不许因为条数多就并行开四个任务把 pool 冲垮。

---

**⛔ 本阶段落笔归属**：AC85（本机 build）/AC86（CI 等价路径）/AC87（compound 收口）是
`plugin/scripts/` + `tasks/*.md` + `.github/workflows/`，落点归 inner（实现）+ outer（跨主机驱动，
C17 写所有权）。AC88（跨主机验证）需要人工触发或 outer 驱动远端会话（B/C 两台机器的 tmux 会话）。
**manager 一条不改，本阶段的落实动作 = 投递 + 跟踪。**

---

## ⏸ 前一阶段（2026-08-16 16:2xZ – 2026-08-20 07:3xZ，**AC94/AC95 已达成；人 2026-08-20 明令切换到新阶段**，内容原样保留）：Web UI 改进版落地

**来源（两条裁定，后者扩大了范围，以后者为准）**：
① 2026-08-16 16:0xZ「下载和保存上述设计相关材料；创建一个新的阶段目标和 AC，以实现上述设计；
   提交这些变更；暂不切换阶段，先保障当前阶段的目标和 AC 的实现。」
② 2026-08-16 16:2xZ **逐字**：「在发布完成后，将当前阶段切换为 `Web UI 改进版落地 阶段`，并实际推进。
   * 修改该阶段目标和 AC，要求：**实现设计中的所有页面**；**应用一致的风格，改进设计中没有但当前实现已有的页面**
   * 实际持续推进，实现该阶段目标和 AC
   * 同步持续优化 suite 测试，使其在 main 相 lane=8 的设置下总耗时不超过 600s」

**切换前置已核（直接量，非转述）**：`origin/develop`=`08e8ec55`=本地 develop（0/0 分歧）；
旧 origin 分叉保留为 `develop-archived-20260816`（37615c7d）；tag `v0.5.0`→同一提交；
`gh release` v0.5.0 建于 2026-08-16T16:23:52Z；`version-consistency-check.ts` → OK，8 文件全 0.5.0。
**⇒ "发布完成"这个前置为真，切换成立。**

**⚠️ 裁定②推翻了原 AC95 的"只做首批三屏"**——那是设计原型自己的交付切法，
**人明令改为"实现设计中的所有页面"**，已按此重写（见下）。旧措辞不再有效，⛔ 不要按它派发。

**设计正本（已下载落盘，本次提交内）**：`docs/design/quay-webui-improved-2026-08-16/`
```
Quay改进版WebUI.dc.html    112655 B / 1309 行  ← 唯一交付目标（dc 模板 + React 运行时原型）
support.js                  69134 B            ← dc-runtime（原型渲染用，非产品代码）
_ds/modernist-…/styles.css  10225 B            ← Modernist 设计系统 token 表（唯一样式正本）
_ds/modernist-…/readme.md    7289 B            ← 设计系统用法（token/组件类/Do & Don't）
_ds/modernist-…/_ds_manifest.json  7234 B
_ds/modernist-…/_ds_bundle.js       303 B
uploads/quaywebuiauditandproposal.md 20850 B   ← 该设计所依据的现状审计 + 方案（实测锚在这里）
```
**落盘方式已核**：六个文件逐个与 claude.ai 设计项目原始返回**逐字节比对**（`orig == mine`），
readme/bundle/audit 三个手抄件均验出并修正过差异（audit 曾差 1 个字符：全角`，`vs 半角`,`）。
**⇒ 这份正本是可信副本，不是转述。**

### 现状基线（实读 develop tip，AC 判据全部锚在这些可复算的量上）

```
packages/quay/src/serve-handlers.ts  1734 行   ← 全部路由 + 渲染 + 样式，服务端拼字符串
独立 .html / .css 文件               0 个       （find 实测）
JSON API 端点                        0 个       （grep -c 'application/json' = 0）
@media 断点                          1 处       （:154 `@media (max-width: 600px)`，只对任务表生效）
现有路由                             9 条       `/ /live /journal /git-history /board /adr /goal /doc`（+ /task/:id 等）
已有 web 测试                        13 个文件  含 web-ui-browser.test.mjs(718) / serve.test.mjs(1809) / serve-browser-render.test.mjs(166)
```

### 设计要求的目标态（从 `.dc.html` 实读，非转述）

```
导航信息架构（navGroupDefs 原文）：
  核心 = Dashboard, Tasks
  观测 = Live, Board, System, Manager
  记录 = Journal, Git History, Tests, Sessions
  知识 = ADRs, Goals, Docs, Architecture
⇒ 15 个视图（现有 9 + 新增 6：Dashboard/System/Manager/Tests/Sessions/Architecture）
原型自述的交付分层：「首批交付：Dashboard / Tasks / Task Detail — 其余页面为路线图占位」
桌面/移动双形态：sc-if isDesktop / isMobile + mobileMenuOpen（汉堡菜单）
```

### AC94（设计正本落盘且可复核）
**判据（能取假）**：`docs/design/quay-webui-improved-2026-08-16/` 下**恰 7 个文件**（实测 `find -type f | wc -l` = 7）；
`Quay改进版WebUI.dc.html` 的 sha256 = `bc339e50162b547aedde56ff803614282bf6d03008bd7ab45caf576e9fef1338`
（**本次落盘时实算，是事后仍可核的锚**——同 AC88 的教训：判据不得引用一个生命周期短于判据本身的对象）；
`grep -c 'navGroupDefs' <该文件>` = 3（命中 `:1067` 定义 + `:1195`/`:1196` 两处消费）。
**⊢ 取假方式**：删掉任一文件或改一个字节 ⇒ sha256 不符 ⇒ 该 AC 立即变假。
**状态**：本次提交即达成（manager 自己做的，属"保存材料"不属"实现设计"）。

### AC95（**实现设计中的所有页面** —— 15 个视图全部真上线，人 16:2xZ 明令，⛔ 不再是"首批三屏"）

**目标态清单（从 `.dc.html` 的 `navGroupDefs` 实读，不是转述）**：
```
核心  dashboard · tasks
观测  live · board · system · manager
记录  journal · git · tests · sessions
知识  adr · goal · doc · architecture
＋ 任务详情（isDetail）      ⇒ 合计 15 个视图
```
**与现状的差集（实读 `serve-handlers.ts` 路由表，可复算）**：
```
已实现 8 条 pathname === 精确路由：/  /adr  /board  /doc  /git-history  /goal  /journal  /live
   ＋ 前缀详情路由：/task/:id  /adr/:id  /goal/:id  /doc/:id
⇒ 设计有而【尚未实现】的 6 个：dashboard · system · manager · tests · sessions · architecture
⇒ 已实现且设计已覆盖的 9 个：tasks(/) · detail · live · board · journal · git · adr · goal · doc
```
**判据（能取假，逐项可查）**：
① **15 个视图各有一条真实返回 200 的路由**——一条命令可查（对每个路由 `curl -o /dev/null -w '%{http_code}'`）；
   ⛔ 6 个新页面不得以"路线图占位"形态交付（原型里那种"未实现。"占位页**不算实现**）。
② **数字必须取自产生它的机件本身**：`observation.ts readLive` / `client.taskList` / `git log` /
   `resource-gate.sh` / `process-budget.sh` / `loop-driver-check.sh` / `session-liveness.sh` 等；
   ⛔ **不得解析 `manager-tick-log.md` / `manager-phase-goal.md` 这类叙事文档取数**
   （审计 §2.4.2 已列为反模式，与 CLAUDE.md 硬规则①同源）。
   **取假方式**：`grep -rn 'manager-tick-log\|manager-phase-goal' packages/quay/src/` 命中 >0 即判假。
③ **空态诚实**：任一页面/卡片数据源为空或不可用时渲染「未接入/无数据」，⛔ 不得留白、⛔ 不得显示 `0`
   —— 复用 `observation.ts` 已有三态（`ok`/`empty`/`error`），⛔ 不得发明新的空值语义。
   **取假方式**：把 `.workflow-events/` 改名后请求 dashboard/live ⇒ 必须出现「未接入」字样，出现 `0` 即判假。
④ `packages/quay/test/` 下 **13 个既有 web 测试全绿**（天然能取假锚：改坏就红）。
**⊢ 允许分批交付，但 AC95 只在 15 个视图【全部】满足 ①-④ 时才算达成**——
⛔ 不得因为"首批三屏做完了"就勾选本条。

### AC100（**风格一致性必须覆盖到设计里没画的既有页面** —— 人 16:2xZ 明令的第二条）
**差集实读（这正是"设计中没有但当前实现已有"的那部分）**：
```
设计的 sc-if 视图里【没有】ADR 详情 / Goal 详情 / Doc 详情——它只画了这三者的列表页；
而当前实现里这三个详情路由都存在且在用：/adr/:id（含 supersedes/supersededBy 双向渲染）
                                        /goal/:id（含 kind/status 过滤、evidence 最近 verdict）
                                        /doc/:id
```
**判据（能取假）**：
① 这三个详情页与 15 个设计视图**共用同一套样式来源**——即 Modernist 的 token
   （`docs/design/.../_ds/modernist-*/styles.css` 里的 `--color-*` / `--font-*` / `--space-*` / `--radius-*`）；
   **取假方式**：`grep -cE '#[0-9a-fA-F]{6}' <渲染这三个详情页的代码段>` 若命中写死十六进制色值 >0 ⇒ 判假
   （现状全站颜色写死十六进制，见审计 §1.1，这是本条要消灭的东西）。
② 三个详情页在 375×812 视口下**可读**（与 AC96 同一套截图流程，同一判据形态）。
**⇒ 本条与 AC95 的分工**：AC95 管"设计画了的都要有"，**AC100 管"设计没画但已经在跑的不能被落下"**
——否则改版结果是一个风格分裂的 UI：15 个新页面一套样式、3 个详情页停在旧样式。

### AC96（响应式从 1 个断点到真·双形态，且判据是截图不是 CSS 行数）
**判据（能取假）**：桌面 1440×900 与移动 375×812 两个视口各截一次图（chrome-devtools MCP，
审计文件 §2.1 已建立该流程），**移动端首屏必须能看到第一条任务**
——现状实测：187 个标签的导航在 375px 下换行成约 12 行文字墙，把任务列表挤出首屏。
**⊢ 这是本 AC 唯一的达成判据**：不是"加了几个 `@media`"（那是硬规则④的不可取假量——CSS 加了不等于好用）。
**附带的一行 bug 必须同批修掉**：`serve-handlers.ts:860` 的内联 `style="white-space:normal"`
覆盖了 `.label-nav-wrap` 的 `white-space:nowrap`，**设计意图和实现自相矛盾**（审计 §1.4-3 实证）。

### AC97（三条零成本的既有缺口先修——它们不依赖任何设计改版）
审计文件把这三条列为 P0，**共同点是不需要写新功能**：
```
① /board 没有任何页面链接到它（grep 实测：全文件只有路由自身，0 个 <a href="/board">）⇒ 加进导航
② /git-history 源码已完整实现，只是当前 demo 进程启动早于该功能落地 ⇒ 重启 quay serve 即可见
③ AC96 里那条 white-space 内联覆盖（与 AC96 同一处，此处只作交叉引用，不重复计数）
```
**判据（能取假）**：`curl` 该 demo 实例的 `/git-history` 返回 200（现为 404）；
任务列表页 HTML 中 `href="/board"` 命中 ≥1（现为 0）。
**⇒ 这两条是本阶段最高性价比项，且与 AC95/AC96 无依赖，可最先做。**

### AC98（`/goal` 空态必须指向正本，而不是显示 "No goals."）
**现状（审计 §1.6 + §2.4.4 实证）**：`/goal` 路由/渲染完整，但 `goals/` 目录 0 条记录；
真正的阶段目标仍在 `orchestration/manager-phase-goal.md`（本文件）与 `orchestration/outer-phase-goal.md` 里。
**判据（能取假）**：`goals/` 为空时，`/goal` 页面 HTML 必须含指向这两个 prose 正本的路径字符串；
grep 不到 ⇒ 判假。**⛔ 本 AC 不要求推进 goal-store 迁移**——那是一个独立的、需要人裁定的方向，
**⛔ 不得把它塞进本阶段当前置**（硬规则⑫：不许凭空设前置）。

### AC99（**Manager/System 两屏的前置是机读接口，不是 UI** —— 顺序约束保留，"排在最后"取消）
**⚠️ 裁定②的影响**：人明令"实现设计中的所有页面"，所以 Manager/System **必须做**，
**"排在最后"这个措辞作废**；但**前置约束不变且更要紧**。
**为什么前置不能省**：审计 §2.4.2 已实测——`pool`/`floor`/`deficit` 这类字段**目前没有稳定的 `--json` 输出接口**，
**这块工作的大头在后端补机读输出，不在 Web UI**。若先做 UI，唯一能拿到数的办法就是去解析 manager 的叙事日志
——那正是 AC95②明令禁止的反模式。**⇒ 顺序不是偏好，是"不这么做就必然违反 AC95②"。**
**判据（能取假）**：Manager/System 两屏所消费的每一个字段，都能追到一个**产出稳定 JSON 的机件**
（`resource-gate.sh` / `process-budget.sh` / `slot-refill` / `loop-driver-check.sh` / `session-liveness.sh`），
且至少有一条 AC 级判据读它的**生产载体**而非 fixture（硬规则④推论三）。
**⊢ 取假方式**：把 fixture/注入 seam 关掉后该判据仍能通过，才算测量；否则是回声。
**⊢ 附加（审计 §2.4.2 的具体警示，落成判据）**：`loadavg` 阈值必须读 `nproc` 计算，
⛔ 不得写死一个在本机算出来的数字（硬规则④推论二：依赖宿主容量的字面值不是常量）。

### AC101（**suite 在 main 相 lane=8 下总耗时 ≤ 600s** —— 人 16:2xZ 明令，与 UI 工作同步持续推进）

> **🔴 未闭合项（2026-08-16 18:3xZ 挂账，⛔ 每轮阶段盘点必须复查这一条）**
> `tasks/gap-ac101-suite-under-600s.md` 已 **status: done**，AC1/AC2/AC3/DoD 全勾，
> **唯一未勾 = AC1b（该文件 :59），未勾数 = 1** —— 即「跑一轮 develop 基线轮」**从未执行**
> （实读 `verification-round.jsonl`：218/219/220/221 全部 `scope=worktree`，fan-in 后零轮）。
> **⚠️ 风险不是"没做"，是"没有机制持有它"**：`status: done` 的任务不再被派发、不进 ready 池、
> 不被 A18 空槽逻辑选中 ⇒ **那个未勾的框记录了义务，却不驱动任何东西**；
> 唯一持有它的是 outer/inner 的队列记忆，而记忆随 compact / 会话轮换丢失。
> **⊢ 故挂在此处**：把"它有没有被做"变成**我每轮盘点可查的一栏**，不依赖谁记得（硬规则⑨：让缺席可见）。
> **⊢ 闭合条件（二选一，任一为真即可划掉本块）**：
> ① `verification-round.jsonl` 出现一条 `scope != worktree`（develop 基线）∧ `laneCount==8`
>    **∧ `startedAt > 2026-08-16T17:53:00Z`（AC101 fan-in 时刻）** 的轮，记录其 **精确 durationMs**；
>    **🔴 2026-08-16 18:3xZ 立本块时我【漏了那个时间窗】，18:4xZ 自纠**：不加窗口时该谓词命中 **207**
>    （全是历史轮，最新一条 `round=216` 16:45Z、再往前是 08-15 的 `scope=main lane=16`）
>    ⇒ **一读就会把这条挂账错误地判为已闭合**；加上窗口后命中 **0** ⇒ 真值是"未闭合"。
>    **⇐ 这与我给 AC1 写的"`startedAt` 晚于立条时刻"是同一个限定，我在 AC1 写了、在这里漏了**
>    ——**同一份文件里，相邻两条判据，一条带窗口一条不带。** 记账：我的错，且是同日第二次
>    （17:4xZ 那次是把判据锚在 commit SHA 上）。**⊢ 一般形态：任何"载体里出现一条 X 即闭合"的判据，
>    必须同时限定【时间窗】——载体是累积的，历史记录会替未来的义务把它签收掉。**
>    ② outer/inner 回报该轮结果（green+精确 ms 或 >600s+精确 ms）。
> **⛔ 若该轮 >600s，必须如实记录，不得因任务已 done 而略过**——那说明 600s 在产品线上尚未稳住
> （round221 仅剩 409ms 余量，且 develop 基线与任务分支代码不同）。

**🆕 2026-08-17 12:55Z 人明令收紧目标（逐字）**：「检查过去 2 天的数据，完整的 suite 测试最快
（无多 suite 并发）可到 400 秒以内，且此时 CPU 负载并未全满。所以考虑到最多 2 suite 并发，那么
即使在此并发情况下，suite 测试不超过 600 秒应当是可行的目标。所以，本项目应当积极优化 suite
测试。即使在最坏情况下，我可以接受不并发多 suite，但绝不接受 suite 测试耗时超过 600s。」
**⊢ manager 核实（`verification-round.jsonl` 实读，72h 窗）**：72h 内最快的一条绿轮是 `418s`
（`2026-08-14T20:42:43Z`，`scope=main lane=16 concurrentSuitesRunning=1 load=8.04`，`nproc=16`
⇒ 负载约 50% 满）——**比人原话"400s 以内"略高（418s vs <400s），但同一量级，不推翻其论断**：
样本证实【无并发时、负载未满的情况下，明显低于 600s 是已经实测发生过的事】。72h 内也有
`concurrentSuitesRunning=2` 且仍 ≤600s 的样本（485s/556s/600s），但同为 2 并发时也出现过
812s/1059s 的超标样本——**⇒ 2 并发不是稳定安全的，人的"最坏情况下宁可不并发"是对当前数据的
正确回应，不是过度保守**。
**⇒ 目标收紧为（不推翻原 600s 数值，是加了一条不可退让的优先级）**：**600s 上限本身不可谈判**；
若"600s 达成"与"2-suite 并发"冲突，**优先保 600s、放弃并发**——这与本 AC 原有的"先优化 serial+
lowconc、再看 main 相"的成本分解方向不冲突，是给这条优化路径加了一个明确的止损底线。
**已同步通知 outer**（`d9148b0a`）。

**目标值来源**：**人逐字设定 600s**。⛔ 我不改这个数、也不把它当我自己推导的阈值
（硬规则④："成本结构未知前不设阈值"约束的是**我**凭空设阈值；人设定的目标是输入，不是我的推断）。
**但硬规则④要求的成本分解仍然必须做**，否则无法知道该优化哪里——分解已有实测基线：

**基线（round215，`.quay/verification-round.jsonl` 实读，lane=8，`nproc=16`）**：
```
static   83s (lanes=1)   serial 304s (lanes=8)   lowconc 276s (lanes=8)   main 349s (lanes=8)
总计 1015s   ⇒ 距 600s 目标需砍 ≈415s（41%）
```
**关键结构事实（同一份 jsonl，历史 14 轮绿样本对照）**：
```
serial / lowconc 两相【历史上一直是 lane=8】——它们的耗时与 laneCount 16→8 无关
   历史典型：serial 110–170s、lowconc 107–181s
   round215：serial 304s、lowconc 276s  ⇒ 【翻了约一倍，原因未定】
main 相历史 lane=16 时 154–239s；round215 lane=8 时 349s ⇒ 这一相的增长可由 lane 减半解释
```
**⇒ 优化的首要对象是 serial + lowconc 那多出来的 ≈290s，不是 main 相**——
若这两相回到历史典型（各约 140s），总计 ≈ 83+140+140+349 = **712s**，仍超 600s，
**⇒ main 相还需再砍 ≈112s**。**这两步是本 AC 的两个可独立验证的子目标。**

**⚠️ 未证实项（标注为假说，⛔ 不得当成因去改）**：我 15:4xZ 查到 round215 起止**紧邻**两段
高频 systemd-run scope 突发（08:10–08:13Z 约 112 次、08:28–08:31Z 约 114 次，特征串定位到
`full-suite-runner.test.mjs` / `trend-check.test.mjs` / `checker-cost.test.mjs` 的资源闸自测 fixture），
时间上高度吻合 serial/lowconc 的翻倍，**但没有反事实对照轮，因果未证**（硬规则④推论四）。
**⊢ 本 AC 的第一步动作就是给它造对照**：在无并发 scope churn 的窗口跑一轮同提交的 lane=8 全量，
两轮 phase 级耗时对比 ⇒ 才能判定该假说真假。⛔ 不得跳过对照直接按假说去优化。

**🔴 2026-08-16 17:1xZ 自我更正（round218 实测，方向不利于我上面那条假说，故据实写下）**：
```
round215  08:14Z  green  1015s  tests=4951  load=6.83   cpu_time=6253s  commit=acdd0517
          static 83 / serial 304 / lowconc 276 / main 349
round218  16:51Z  red    747s   tests=5003  load=12.49  cpu_time=4454s  commit=968cc1a8
          static 44 / serial 232 / lowconc 183 / main 286      ← 四相【全部】下降
两轮之间 develop 落了 120 个提交
```
**⇒ round218 的宿主负载【更高】（12.49 vs 6.83）、并发在飞任务【更多】（5 条），耗时却【少 268s】。**
**⊢ 这是一个能区分的观察，且它削弱我自己的假说**——若"并发 churn 拖慢 serial/lowconc"成立，
round218 该更慢而非更快。**⇒ 该假说降级：并发/负载不是主因，或至少不是唯一主因。**
**⊢ 仍未证的替代候选（并列，⛔ 不选边）**：①两轮之间 120 个提交里有真实的性能改动；
②round215 那一轮本身是个离群值（它的 `cpu_time` 6253s vs round218 的 4454s，差 1799s CPU 时间
——**这是"真的多干了活"而不是"被饿着了"的形状**，与"被 CPU 饥饿拖慢"的预期方向相反）。
**⊢ 对照轮的价值不变但目标改了**：不再是"证明 churn 是成因"，而是**先在无并发窗口测出一个干净基线**，
再判 120 个提交里哪些改动了耗时。

**🔴 目标距离随之更新（⛔ 不要再引用"需砍 415s"那个数）**：现基线 **747s**（round218）⇒ 距 600s
**仅差 ≈147s（20%）**，不是我 16:2xZ 写的 415s（41%）。**⇒ 本 AC 的难度显著低于立条时的估计。**
**⚠️ 但 round218 是 `state=red`（fail=1）⇒ ⛔ 它不满足判据①的 `state=="green"`，不计入那 3 轮。**
它只是**起点读数**，⛔ 不得被当成"已经接近达成"的证据。

**判据（能取假，三条全真才算达成）**：
① `.quay/verification-round.jsonl` 中存在 **≥3 轮**记录，满足 `laneCount==8` ∧ `state=="green"`
   ∧ `durationMs <= 600000`，且这 3 轮的 `startedAt` **晚于本 AC 立条时刻（2026-08-16T16:2xZ）**；
   **⇒ 读的是生产载体、不是 fixture，且只计立条之后的窗口（硬规则④推论三的标准形态）。**
   **🔴 2026-08-16 21:1xZ 补（判据级）——那 3 轮（含 AC1b 的 develop 基线轮）必须由
   `full-suite-runner` 产出，与 219/220/221 【同仪器】。**
   **⇐ 为什么**：实测 AC1b 的 round6/round7 走的是 plain `bash scripts/test.sh`，
   而 `verification-round.jsonl` 的写入方是 `full-suite-runner.ts`；
   **`scripts/test.sh` 不调用 runner**（`grep -c` 得 15 全是注释行，**非注释命中 = 0**）
   ⇒ **plain test.sh 路径结构上写不进该载体 ⇒ 判据① 永远无法被那种轮满足。**
   **⊢ 但"要落载体"只是表层理由；硬理由是【可比】**：
   **本判据是【跨轮比较 `durationMs ≤ 600000`】，而 219/220/221 由 runner 产出。
   plain test.sh 的 288.7s 与它们【不是同一把尺子】**——不同编排、不同分相记账、可能不同 lane 默认值。
   **⇒ 混用仪器会让"≤600s"这个比较失去意义。⇒ 走 runner 是为了可比，不只是为了有记录。**
   **⊢ 推论（已投 outer）**：非 runner 形态的轮，其 `duration` **⛔ 不得用于本判据**；
   它只能作为「fails 是否复现」的证据（pass/fail 同尺可答，时长不可）。
   **⊢ 同轮纠正一个数**：round6 的 tests 真值 = **4224**（pass 4111 / fail 0 / cancelled 0，
   我读 `/tmp/ac101-develop-baseline-round6.log` 实测；outer 一度报 4847，已请其撤回）。
   **⇒ 无论 4224 还是 4847 都 < 4951 ⇒ AC2 结论不变；但判据引用的数必须是真值。**
② 这 3 轮**不得**通过缩减测试覆盖达成——`tests` 字段（round215 基线 = **4951**）不得低于基线；
   **取假方式**：某轮 `tests < 4951` ⇒ **该轮不计入**。
   **🔴 2026-08-16 21:0xZ 更正——原文写「⇒ 该轮不计入，**且判为"用砍覆盖换速度"**」，后半句删除。**
   **⇐ 为什么删**：round6（20:52 起）实测 `288.7s / tests=4847 / 3 fails`，而合格轮 round221 是
   `599.6s / tests=5003 / fail=0` ⇒ **时长几乎减半而用例少 156 ⇒ 那是 abort/skip 的签名，不是"跑得更快"**。
   **而原措辞给它贴了一个含【意图】的标签**（"换速度" = 有人为了快而砍覆盖），**在本例中是误判**。
   **⊢ 一般形态（本阶段已多次同形）：一条判据可以正确地【排除】一个样本，同时错误地【解释】它。**
   **⇒ 排除规则只说排除，成因另判**——砍覆盖 / abort / skip / 环境负载是不同的东西，
   **⛔ 不该由一条排除规则替它们下结论。**
③ 优化手段落成**代码/配置**（可 `git log` 追溯的提交），⛔ 不接受"挑一个负载低的时段跑一轮"充数
   ——那是环境波动，不是优化。
④ **🔴 2026-08-16 17:4xZ 补（判据级，不是提醒）：优化必须【已在 develop 上生效】，⛔ 不得只活在任务分支。**
   **🔴 2026-08-16 18:2xZ 自我更正——原取假命令【是错的】，已作废，换成读内容的那条：**
   ```
   ⛔ 作废：git merge-base --is-ancestor <该优化的提交> develop
   ✅ 正本：在 develop 上 grep -n 'PHASE_OVERLAP="\${QUAY_PHASE_OVERLAP' scripts/test.sh 必须显示 :-1
   ```
   **⇐ 为什么作废**：fan-in 实测是 **rebase/squash 形态——内容进了 develop，而原 SHA 不是 develop 的祖先**。
   实证：`17e91e38` 用 `--is-ancestor` 判为「不在」，而 `scripts/test.sh:1024` 在 develop 上已是 `:-1`，
   `git log -S` 定位到内容由 **`56921738`（17:53:05Z）** 带进 develop。⇒ **SHA 判法给出【假阴性】。**
   **⊢ 这犯的正是我自己写进 AC88 的那条教训**：「**判据不得引用一个生命周期短于判据本身的对象**」——
   **commit SHA 在 rebase/squash 下就是这类对象，而我转头把 AC1b 锚在了 SHA 上。记账：我的错。**
   **⊢ 一般形态**：判「某改动是否已生效」要读**内容**（grep 目标文件 / 行为取假），
   **⛔ 不要读提交身份**（SHA / `--contains` / `--is-ancestor`）——后者只在"从不改写历史"的前提下等价，
   而 fan-in 恰恰会改写。
   **⊢ ⚠️ 前置满足 ≠ 判据满足**：本条要求的是「**AC1 的 3 轮里至少 1 轮跑在开关已生效的 develop 基线上**」。
   开关进了 develop 只是**前置**；**若 3 轮全是 `scope=worktree`，本条仍不满足**（实证见下方 18:2xZ 记录）。
   **⇐ 为什么补**：实读 develop 工作树 `scripts/test.sh:1023` = `${QUAY_PHASE_OVERLAP:-0}`（默认**关**），
   而让 556s 成立的 `17e91e38` **只在 `task/gap-ac101-suite-under-600s` 上**（`--contains` 实测）。
   **⇒ 若 3 轮都在任务分支跑出来就判达成，develop 上的 suite 仍是旧形态**——
   **这正是硬规则④推论三的原形：「实现了、测试绿了、但生产没跑过」与「没实现」同形。**

**🔴 2026-08-16 17:4xZ 裁定：round219 【计入】AC1。**
```
round219  17:11:46Z  green  556s  lane=8  tests=5003 pass=5003 fail=0
          concurrentSuitesRunning=2  load=9.26  commit=17e91e38
```
逐条：green ✓ / lane8 ✓ / 556000≤600000 ✓ / 晚于立条 ✓ / tests 5003≥4951 ✓ / 优化可追溯 ✓
（`ef5e21c7` 机制 → `ab689582` fan-in → `17e91e38` 默认开）。
**⊢ 关于"它在并发下跑、算不算数"——方向反了**：判据③ 禁的是「**挑一个负载低的时段**充数」，
**我防的是【挑有利环境】**。round219 是在 `concurrentSuitesRunning=2`、load 9.26 的**更不利**环境下达标，
**比干净窗口更难，不是更易** ⇒ 不但计入，**证据强度高于一轮干净窗口**。
**⇒ 干净对照轮的定位随之改变**：从"追 415s"改为"验证非并发下也稳"，且**它本身同样可计入那 3 轮**。

**⊢ 一条代价记录（非判据，⛔ 不阻塞）**：round219 的 phases 只有 `static/serial/end`，
而 round218 是 `static/serial/gap/lowconc/main/end`；两轮 `tests` 同为 5003 ⇒ **用例没少跑，是相被合并了**。
⇒ **overlap 开启后分相成本归因失效**（`serial` 一相 487s 里同时装着原 serial+lowconc+main）。
将来若还要按相定位耗时，需要 overlap 下的分相记账——**现在不必做，只记下这个代价。**

**⊢ 与 UI 工作的关系**：人明令"同步持续优化"，**⇒ 本 AC 与 AC95–AC100 并行，不互为前置**；
但两者共用 suite 这一个瓶颈资源，⛔ 不得为了跑 UI 的验证而暂停本 AC 的对照测量。

### AC102（**AC95 的 15 个视图必须真的应用设计稿视觉规范，不只是路由存在** —— 2026-08-17 00:5xZ 补，人明令"保障应用设计稿（包括视觉）"）

**为什么补这条（判据缺口，2026-08-17 00:5xZ 实测发现）**：AC95 现有四条判据——
路由 200 / 数据来源真实 / 空态诚实 / 既有测试绿——**没有一条检查视觉/样式**。
`docs/design/quay-webui-improved-2026-08-16/` 在 AC95 的 Touches 里只标了"设计正本，只读参考"，
**没有任何机制核对结果**。AC100 判据①（byte-identical CSS + 零硬编码 hex）已证明这类判据可行、
可取假，**但它目前只接在 3 个详情页**：`grep -n 'modernistStyles()' packages/quay/src/serve-handlers.ts`
实测**全文件仅 3 处调用**（`/adr/:id` `/goal/:id` `/doc/:id`）；其余 34 处 `grep -cE '#[0-9a-fA-F]{6}'`
命中的硬编码色值分布在页面基础样式（62-220 行）、任务列表 UI（904-925 行）、git 图表配色
（1532-1537 行）——**从未迁移到 Modernist token，也没有任何测试要求迁移**。
**⇒ 若不补，AC95 完全可能"15 个视图全部 200、其余三条也过"，同时视觉上与设计稿毫无关系——现有判据不会拦。**

**判据（能取假，是 AC100① 机制的推广到全部 15 个设计视图，非新发明）**：
① **对 15 个视图逐一 `curl` 对应路由**，响应体 HTML 必须含 Modernist token 样式表的可识别特征
   （如 `--color-bg` 字符串）——即该页面确实引用了与 3 个详情页【同一份】token 样式表，
   不是各自另起一套颜色。**取假**：15 条路由里任一条响应体 `grep`不到该特征串 ⇒ 判假。
② 15 个视图各自的渲染代码段（不含共享 head/nav 部分）`grep -cE '#[0-9a-fA-F]{6}'` 命中 = 0
   （颜色只能来自 token，与 AC100① 判据同形）。
③ **抽样至少 3 个新页面**（design 里有对应 mock 的）在桌面 1440×900 视口截图（同 AC96/AC100② 流程），
   连同设计稿同视图的截图一并存入 Evidence——**不要求像素级 diff，但要求截图证据存在，
   ⛔ 不能只有文字断言"已对齐"**（硬规则④：一个只能靠自述判定的量不是测量）。

**⊢ 分工更正**：AC100 段落原写"AC95 管『设计画了的都要有』"——**这句只覆盖【存在性】，
没有覆盖【视觉】**。**本条补上视觉这一半，⛔ 与 AC100① 不重复计数**
（AC100① 管 3 个详情页 = 设计没画的部分；本条管 15 个设计视图本身 = 设计画了的部分）。
**⇒ 至此"设计画了的都要有"与"都要真的长得像设计"两件事，才各自有可取假的判据托底。**

**⛔ 我不给实现方案**（哪个函数怎么改、样式怎么复用是 inner 的事）；本条只定义"达成"是什么。

### AC103（**逐页 MCP 浏览器视觉核验 + 未达标即迭代重修，不是一次性截图存证** —— 2026-08-17 09:2xZ 人明令补，两条原话：①「检查当前阶段的 AC 和任务有没有明确要求使用 MCP 浏览器逐页执行验证和视觉检查，并要求持续迭代至符合设计；如果没有，应调整和补充」②「对于设计稿中一些过于简化的页面（如 git history），如果实际实现提供了更好的体验和更丰富的信息，可以接受」）

**核查结论（本条存在的理由）**：AC95/96/100/102 现有判据里，`chrome-devtools MCP` 只在 AC96
（:368，1 个页面 2 视口）、AC100②（:363，3 个详情页）、AC102③（:568，抽样 3 个新页面）三处
出现——**都是"截了图、存进 Evidence 就算过"的一次性判据，没有一条覆盖【全部 15 个视图】，
也没有一条要求"看了截图发现不达标就得回去改、改完重截，直到达标"**。⇒ 缺口属实，本条补。

**判据（能取假，是既有截图流程的推广，非新发明）**：
① **15 个视图逐一**用 MCP 浏览器（`chrome-devtools` 或 `playwright` 二选一即可，不要求两者都跑）
   实际 `navigate` + `screenshot`（渲染后的真实截图，**不是** AC102①②那种 `curl` 取 HTML 特征串——
   那两条判据管的是"引用了 token 表"，本条管"渲染出来到底长什么样，人/后续核验者能看见"）。
   桌面 1440×900 一张即可（移动端双形态仍按 AC96 单独判据，不在本条重复）。
   **取假**：15 个视图里任一个找不到对应截图文件 ⇒ 判假。
② **判据允许且要求"迭代"**：任一视图的截图经审视后发现明显不达标——断行/遮挡/关键信息挤出首屏/
   颜色与 Modernist token 明显不符（同 AC96"移动端首屏必须看到第一条任务"同一种可肉眼判断的失败
   形态）——记为该视图未通过，改完**重新截图**再核验，直至通过。**⇒ "截图文件存在"不是终点，
   "截图显示确实达标"才是**；判据文字必须写清楚这一步不能省，⛔ 不得只满足①就勾选本条。
③ **豁免（人 09:2xZ 直接示例：git history）**：设计稿是简化原型，若实际实现在某视图上提供的
   信息密度/交互比设计稿的简化 mock **更丰富、体验更好**，允许保留/采纳实现版本，
   **不因"与设计稿逐字节/逐元素不同"判为缺陷**。**⊢ 判据改写**：本条与 AC102①②（token/零硬编码
   hex）合起来才是完整判据——"视觉语言（token/配色/间距/字体）与设计稿一致 且 体验不劣于设计稿"，
   不是"长得和设计稿一模一样"。**⛔ 这条豁免不免除 AC102①②**：颜色/token 仍必须来自 Modernist
   样式表，豁免的只是"信息量/布局细节可以比设计稿更丰富"这一半。

**⊢ 与既有 AC 的分工**：AC96/AC100②/AC102③ 定义了"截图证据要有"（存在性，抽样/单页面）；
**本条把它扩到全部 15 个视图，并把"看了截图之后要不要改"这一步从"隐含在人工审查里"
变成显式判据**（同 AC102 补视觉判据的理由——判据不写清楚，执行者不会自己想到要做）。

**归属不变**：改产品代码仍归 inner + outer；manager 今日 09:1xZ 那轮已用 chrome-devtools +
playwright MCP 对 `/`、`/manager` 做过一次示范性逐页核验（见 tick-log 该轮记录），
可作为 outer/inner 落地本条判据时的参照方法，**不代表 manager 接管这项工作**。

---

**⛔ 本阶段落笔归属**：AC95–AC102、AC103 全部落在 `packages/quay/src/`（产品代码）+ `packages/quay/test/`
+ `plugin/scripts/`（AC99 的机读接口、AC101 的 suite 优化），**归 inner（实现）+ outer（立案/派发）**。
**manager 一条不改产品代码**；AC94 是唯一由 manager 自己完成的（保存设计材料，人明令）。
**⛔ 本阶段已是当前阶段（人 16:2xZ 切换并明令"实际持续推进"）** —— 可以且应当派发。
**⊢ 建议的开工顺序（不是硬前置，除 AC99 那条外）**：
```
AC97（三条零成本缺口，改一行/加一个链接/重启进程）  ← 最先，风险最低
AC101 的对照测量（造反事实轮，判定 serial/lowconc 翻倍的真因）  ← 与 UI 并行，越早越好
AC95 的 9 个已实现视图改版 + AC96 响应式 + AC100 三个详情页  ← 主体工作量
AC99 前置的机读 JSON 接口 → 然后 system/manager 两屏
AC95 剩余新页面（dashboard/tests/sessions/architecture）
AC98 /goal 空态（小，可随手做）
AC103 逐页 MCP 浏览器视觉核验（依赖 AC95/96/100/102 的页面先落地，天然排最后）
```


### AC 状态台账（2026-08-16 21:4xZ 立 —— **补一个结构性缺陷：本阶段 8 条 AC 里此前只有 AC94 带 `**状态**` 行**）

**⇐ 为什么立这个台账**：本轮枚举（⛔ 不布尔）发现 8 条 AC 中 **7 条没有任何完成态记录** ⇒
按硬规则⑥ 那是**未查**，而它在读者眼里与**未达成**同形。我在多轮 tick 里报的「阶段内 2/8」
**数是对的（AC94+AC97），但来源不是本文件——是我自己的记忆**。按 ②h（跨轮复用的读数必须回头验），
本轮验了，并把它落到正本上，**使这个数此后可从文件本身复算，⛔ 不再依赖我记得。**

| AC | 状态 | 依据（可复核，⛔ 非自述） |
|---|---|---|
| AC94 设计正本落盘 | **达成** | `docs/design/…/` 7 文件 + sha256 锚，见该 AC 判据 |
| AC97 三条零成本缺口 | **达成（⚠️ 未经全量轮验证）** | 任务 status=**done**，落地提交 `0b1049dc`。**⚠️ 21:5xZ 补核**：其 per-task suite 记录**仅 1 条**且 `fullSuiteRan=false` / `skipReason="doc-only-delta"` / `dur=7ms`，而实现提交 `fae3322f` 改的是 `packages/quay/src/serve-handlers.ts`（生产代码）；合并点 `21a09091`@21:31:06Z **晚于**唯一近期全量轮 round222（21:11:29Z 起）⇒ **全量轮从未覆盖该改动**。已投 outer 立案（两个候选根因未替它选）。 |
| AC100 三详情页 token 化 | **达成（2026-08-17 00:31Z）** | 落地提交 `66e1e039`；worktree 已清。**独立核实两轮真·全量**（00:09:47 起 562.8s、00:20:57 起 512.4s，均 fullSuiteRan=true/green）覆盖了核心代码改动，末次 doc-only 跳过（6ms）经追溯确认无代码泄漏——两段 post-merge diff 均纯 `tasks/*.md`，非 delta-scope 缺陷复发。 |
| AC95 15 视图全上线 | **在飞（impl 中，2026-08-17 00:4xZ 起）** | worktree 存在；`serve-handlers.ts` 锁随 AC100 落地释放后即被派发（`recommended` 首位） |
| AC96 响应式双形态 | **未开工** | 同上，同 peer |
| AC98 `/goal` 空态 | **未开工** | 同上，同 peer |
| AC99 机读 JSON 接口 | **未开工** | 同上，同 peer（⚠️ 我 21:3xZ 曾误判它 disjoint，已撤回——它第 6 条 Touches 也是 `serve-handlers.ts`） |
| AC101 suite ≤600s | **达成（2026-08-16 23:2xZ）** | round222：`durationMs=642288` > 600000，`tests=4970` `scope=main` `laneCount=8` `state=green`；AC1b 不勾 |
| AC102 15 视图真应用设计视觉 | **未开工（2026-08-17 00:5xZ 新立）** | `modernistStyles()` 全文件仅 3 处调用（3 个详情页）；34 处硬编码 hex 分布在其余页面，从未迁移；已投 outer |
| AC103 逐页 MCP 浏览器视觉核验+迭代 | **未开工（2026-08-17 09:2xZ 新立，人明令）** | 依赖 AC95/96/100/102 页面先落地；manager 09:1xZ 已示范方法（chrome-devtools/playwright navigate+screenshot 核实 `/` 与 `/manager`），未替 inner/outer 做正式核验 |

**⇒ 计数：达成 2 / 8。未开工 4 条【全部】卡在同一个 peer 上。**

**🟢 2026-08-16 23:2xZ 更新——AC101 达成，计数改为【达成 3 / 8】**
```
round224  startedAt=23:12:12.138Z  durationMs=500803  tests=4977  fail=0
          scope=main  laneCount=8  state=green  treeDirty=false  verifiedCommit=fe0d951a
六条判据首次全中：≤600000 ∧ tests≥4951 ∧ laneCount==8 ∧ scope!=worktree ∧ runner 形态 ∧ startedAt>17:53Z
⇒ 人的第二条明令达成；发布禁令同轮解除（d1f4e6a8/fe0d951a 均为 verifiedCommit 祖先，
  且内容判据 quay-init.sh 引用该 checker = 3，下禁令时为 0）
```
**⚠️ 一条必须随它一起记的度量限制（⛔ 不许它悄悄消失）**：
```
round222  642.3s  跑时 load1=21.79，8 个 worktree 在飞且真在跑
round224  500.8s  跑时 load1≈1.66–12.38，3 个在飞【全是停摆的】，机器基本空闲
⇒ 两轮负载差约一个数量级，时长差 141.5s
```
**⇒ 本判据【没有控制负载】——它写的是"某轮 ≤600s"，round224 满足它，所以达成成立。**
**⛔ 不事后加前置**（硬规则⑫ 禁"凭空设前置"，且会让一个已达成的目标退回去）。
**⊢ 但如实记**：500.8s 是【空闲机器上】的读数。**下一次满负载轮若回到 600s 以上，那不是回归，
是同一系统在不同负载下的表现** ⇒ ⛔ 别到时候当成"AC101 白做了"再开一轮排查。
**⇒ 建议（非要求）**：等下一个【自然发生】的满负载 main 轮，把时长记进本条 Evidence 作第二个数据点；
⛔ 不要为此专门造一轮。

**🔴 2026-08-17 03:1xZ —— 第二个数据点自然到来，它【证否了上面那句预留解释】。⛔ 上文原样保留。**
```
round 224   500.8s   susp=1   load1 ≈ 1.66–12.38（空闲）
round 226   621.6s   susp=1   load  = 8.43        ← 同量级负载，⛔ 不是满负载
tests 4977 → 5004（+27），lanes 均为 8，均 green，差 120.8s
```
**⇒ 我预留的解释是「满负载才会超 600s」，而 round226 在同量级负载下就超了 ⇒ 该解释不成立。**
**⊢ 认账（硬规则 4 推论四，我在别处引用过而这里自己犯）**：那句话是一个**能解释现象**的说法，
不是一个**被检验**的结论——我写它时没有附任何「若它为假则结果会不同」的对照。
**⊢ 且它的方向对我有利**（保住一条刚达成的 AC），**这正是它没被检验就落盘的原因**；
同一天我两次因"还有别的变量"拒绝下结论，唯独这一条放行了 ⇒ 严格是选择性的。
**⊢ AC101 状态不变 = 达成**：判据是「**某轮** ≤600s」，round224 满足即成立；
**⛔ 不因 round226 退回**（那会是事后加前置，硬规则⑫）。
**⊢ 真正的剩余**：500.8 / 621.6 之间 **120.8s 无已知成因**。
**⛔ 现在不要去查它**——`phases[]` 自 round 219 起把 serial+lowconc+main 合成一个桶
（`full-suite-runner.ts:2875-2880`，overlap 窗口直到 `__OVERHEAD__` 才关，期间 main 的 `__GROUP__` 被丢），
round226 的 566.8s 桶同形 ⇒ **这 120.8s 结构上无法归因到任何一相**，此时查必得一个自洽的错答案。
**⇒ 前置是修仪器，不是查时长**（已投 outer：msg 6abf528f / 6571d798）。
**⊢ 我为什么坚持记这条**：今天已两次因"两轮之间还有别的变量"拒绝下结论（42.7s、scope）。
**这次结论对我有利（目标达成）——若这次不提负载，前两次的严格就只是选择性的。**

**🟢 2026-08-17 00:3xZ 更新——AC100 达成，计数改为【达成 4 / 8】；AC95 已派发在飞**
```
落地提交 66e1e039；两轮真·全量已核（562.8s / 512.4s，均 fullSuiteRan=true/green，无 fail）
末次 doc-only 跳过经追溯确认干净（两段 post-merge diff 均纯 tasks/*.md，无代码泄漏）
⇒ 与 quay-init fix 那次「吞代码」明确不同；serve-handlers.ts 锁随之释放
⇒ AC95 已被派发（recommended 首位，00:4xZ 起 impl 中）——人的第一条明令从「1/5 且唯一入口停摆」
  走到「1/5 已达成 + 1/5 在飞」
```
**⊢ 下方"⛔ 结构性阻塞"段落所述的锁本身仍是真实缺陷**（已立案 `gap-directory-level-tasks-touch-global-lock`），
**但它描述的是【当时】那个瞬间——AC100 land 后 serve-handlers.ts 已解锁，⛔ 不要因为下文仍在而误读为"现在还锁着"。**

**🟢 2026-08-17 00:5xZ 更新——新立 AC102（人明令"保障应用设计稿（包括视觉）"），本阶段 AC 数 8→9，计数仍 4/9**
```
用户直接指示：修改 AC 保障应用设计稿（含视觉），并告知 outer
⇒ AC102 已写入本文件（见上方独立小节），判据是 AC100①机制（byte-identical CSS + 零硬编码 hex）
  向全部 15 个设计视图的推广，非新发明
⇒ 已同步告知 outer：AC95（及其后继 AC96/98/99）落地前必须同时满足 AC102，
  ⛔ 不得先让 AC95 的四条判据过、事后再补视觉——那会导致返工
```

**🟢 2026-08-17 09:2xZ 更新——新立 AC103（人明令：①检查是否要求逐页 MCP 浏览器视觉核验+持续迭代，
若无则补；②过于简化的设计页面若实现更丰富/体验更好可接受，点名 git history），本阶段 AC 数 9→10，
计数仍 4/10**
```
核查结论：AC96/AC100②/AC102③ 只覆盖抽样页面的一次性截图存证，无一条覆盖全部 15 视图，
  也无一条要求"截图看出不达标就得改完重截"——缺口属实，已补 AC103（见上方独立小节）
⇒ AC103 同时把"设计稿是简化原型、实现可以更丰富"写成显式豁免（不豁免 AC102①②的 token/
  零硬编码色值判据，只豁免"信息量/布局细节可以比设计稿丰富"这一半）
⇒ manager 一条不代管这项核验工作——AC103 仍归 inner 实现 + outer 立案派发，
  manager 09:1xZ 那轮的 chrome-devtools/playwright 示范只是方法参照，不是正式交付
```
**⊢ 记一句**：这是本阶段第一条【由人直接指出判据缺口】而非我自己实测发现的 AC——
我实测发现的是"缺口存在"（modernistStyles() 仅 3 处调用 + 34 处硬编码 hex 未迁移），
**但"要不要为此新增一条 AC、以及它该多严格"是人的裁定，不是我该自己拍板的范围**（§0 边界：
manager 可以指出问题、不擅自决定产品要不要为此改判据——这次是人明确要求了，我才写）。

**⊢ 本阶段当前的唯一结构性阻塞（21:3xZ 实测，`slot-refill` 自己给的判词）**：
```
pool=11  deferred=11  —— 全部 touches-overlap-in-flight
AC95 / AC96 / AC98 / AC99 / AC100 —— 五项 UI 【全部】touches packages/quay/src/serve-handlers.ts
能区分的对照（同一在飞集合、仅抬 cap，只读推荐未派发）：
  cap=8 → slots_free=2 → recommended=[]      cap=12 → slots_free=6 → recommended=[]
⇒ 空槽不是原因；priority / 排序也不是原因（priority 无派发侧读者，且 disjointness 排它之前）
```
**⇒ 人的明令「实现设计中的所有页面」在当前 Touches 粒度下 = 一次一个、串到底。**
**⇒ 必答题（实现方案属 inner，⛔ manager 不给）：收窄 `serve-handlers.ts` 的 Touches 粒度到路由/函数级，
还是接受 UI 串行交付。在这题答之前，本阶段 4 条未开工 AC 的交付速率结构上等于 AC100 的完成速率。**

---

## ⏸ 前一阶段（2026-08-14 00:5xZ – 2026-08-16，已被上方新阶段取代，内容原样保留）：语义派发 —— 实现 `SPEC-dispatch-ordering-semantic-2026-08-13.md`

**来源**：人 2026-08-14 裁定「创建新阶段，目标即实现 `SPEC-dispatch-ordering-semantic-2026-08-13.md`，
创建相应 AC，然后将此设为当前阶段，推进」。
**前一阶段（AC42–AC53）状态**：**交付型 9/9 全部落地**、`[~]` 取消 2（AC43/AC45）、
**仅余 AC49（过程纪律型，判定权已交给下一位读 tick-log 的人，按本文件既有规则不参与"全落"计数）**。

**阶段目标（一句话）**：**把「先派谁」的决定权，从退化的 `1/cost` 机制排序移交给 inner 的语义选择，
并使这次移交【可核】** —— 即：**机制只答「能不能派」，inner 答「先派谁」，而"inner 按什么在选"任何人都能查。**

**为什么现在做（SPEC §1 的实测，不重复举证）**：value 三轴 `strategic/blocking/suite-blocking`
在 21 条活跃任务上只有 1 条取 Y ⇒ **对 20/21 的候选，有效排序 = `1/cost`**，
而 **"小任务优先"从来没有被任何人选择过，它只是三轴全 N 之后剩下来的那一项**。

**硬前提（已满足，不构成阻塞）**：SPEC §3 的 AC46 判据1（提升闸扩容）**已于前一阶段达成**。

---

- [x] **AC54（正本）**：**倾向文件存在，且三段结构齐全**（2026-08-14 02:0xZ 达成，独立复核不采信自述：
      `orchestration/dispatch-preference.md` 存在、`git ls-files` 跟踪、`git check-ignore` rc=1（未被忽略）；
      三段齐全 `## 默认段`/`## 覆盖段`/`## 维护者字段`；`dispatch-preference-check.ts` 现读 PASS；
      负控制 `checker-mutation-cases/dispatch-preference-check.sh` 现跑 exit=0）
      **判据1**：单一文件、**git 可见**（不得放在 gitignored 的 `.quay/` 下——抗 compact、跨会话重启存活是它的立身理由），
      且同时含 **默认段 / 覆盖段 / 维护者字段** 三者。
      **判据2（能取假，负控制由落地方产出——manager 不构造，沿用 AC49 判据1 的 D2 归属限定）**：
      **删掉任一段 ⇒ 检查必须变红**；一个从未在缺段样本上红过的检查不算判据。
      **为什么三段都必要（SPEC §4.4 逐字）**：**没有默认段与维护者字段，manager 消失后它会变成孤儿**
      ——内容还在、没人更新、而 inner 仍按它选；那正是本仓库反复出现的「写着的东西比它的前提活得久」。
      **⚠️ 不规定路径与格式**（SPEC §7）——那是实现面。

- [x] **AC55（产物·本阶段的承重条款）**：**inner 的派发记录必须带【内容指纹】+【一句为什么选它】**（2026-08-14 03:3xZ 达成，独立复核不采信自述：**判据1/2** `orchestration/dispatch-record.jsonl` 现有 **3 条真实派发记录**，逐条打印后**`preferenceFingerprint` 与 `git hash-object orchestration/dispatch-preference.md` 的 `e4881984…` 三条全部匹配**，`reason` 长度 69/59/67 且内容是真实语义理由（如「覆盖段本阶段优先：AC54→55→56 序列…AC55 已 done 解 dep」）⇒ **"用的是哪一版"与"按倾向选还是随便选"两问皆可核**；**判据3** 负控制 `checker-mutation-cases/dispatch-record-fingerprint-reason-check.sh` 现跑 **exit=0**。**⚠️ 复核过程中我自己触发过一次假警报，值得记**：我先用 `r.get('fingerprint')` 取值得 `None`，**几乎判定"检查器 PASS 而字段缺失＝又一个 fail-open"**；**按 A0b① 先打印键名才发现真键是 `preferenceFingerprint`**——**是我的谓词错，不是它的缺陷**。**A0b①「读任何 JSON 产物前先打印键名再取值」当场挡下了一次会发出去的错误指控。**）
      **判据1**：每条派发记录含 ①倾向文件的**内容指纹**（git blob hash 或等价，回答"用的是哪一版"）
      ②**一句「为什么选它」**（回答"按倾向选还是随便选"）。
      **判据2（承重理由，C17）**：**没有它，"读了没读"在记录上不可区分 ⇒ 只能靠意志 ⇒ 必然失守**
      ——SPEC §4.2 已实证同一形态（我自己的 `A0b⑤(b)` 因"产物之后没人再用"而连续 4 轮被跳过）。
      **判据3（能取假）**：拿一条**真实的**派发记录回放，**缺指纹或缺理由时必须报红**。
      **⚠️ 不要求解释每一次「不选」**（SPEC §7 逐字）——只解释**选了什么**，
      **避免产物变成负担而被跳过**（这正是 §4.2 那条教训的直接应用）。

- [x] **AC56（去锚）**：**机制输出不再携带有意义的序**
      **判据1**：`recommended` 改为**无序可行集**，或按**明显无意义的稳定序**（字典序）并**明确标注"序无意义"**。
      **判据2（能取假）**：**若输出仍按 `1/cost` 排 ⇒ 检查必须变红。**
      **判据3（防"只改文案"）**：**判据必须读【输出本身】，不得只读文档标注**
      ——仅在注释里写"序无意义"而实际仍有序 ⇒ **不算达成**。
      **理由（SPEC §5）**：**inner 拿到有序列表会被锚定**，即使它有语义倾向也很难无视"机制推荐的第一个"
      ⇒ **不去序，新划分就只是名义上的**。

- [x] **AC57（通知面）**：**SendMessage 只通知不承载内容**
      **判据**：倾向变更的通知**不得包含倾向内容本身**，只说「倾向变了，去重读」+ 指纹。
      **理由（SPEC §4.1）**：消息**compact 后不可重读**、**无单一正本**、**无法验证用的是哪一版**
      ——三条失败模式已在当日实证（最有价值的 A19 规格幸存是因为 outer 抄进了任务体，不是因为消息还在）。
      **⚠️ 2026-08-14 00:5xZ 自检补——本条是四条里【唯一没有"能取假"判据】的，而那是我 40 分钟前写下的缺陷**：
      按本仓库既有标准（AC49 判据1 逐字「一个从未在真实历史样本上亮过红的判据不算判据」），
      原文只写了"不得包含内容"这个**义务**，**没有写它怎么被证伪** ⇒ 与我今天在别处反复挑的毛病同形。
      **补判据（能取假）**：**拿一条真实的倾向变更通知回放——若它携带了倾向内容本身（而非仅"变了+去重读+指纹"）⇒ 必须报红。**
      **⚠️ 但本条比另外三条难核，如实写明而不假装**：通知是消息不是文件，**它需要一个可核载体**
      （发送侧留痕 / 接收侧记录 / 或复用 AC55 的派发记录字段）。**载体形态归落地方设计，我不规定**
      ——同 SPEC §7「不规定倾向文件的具体路径与格式」的理由：那是实现面。
      **若落地方证明【任何载体都不可得】，本条应降为观察项并明说，而不是留一条无法证伪的判据挂着**
      （那正是今天 A14/戊 那一族：一个不可能红的判据与"一切正常"同形）。

- [x] **AC58（通则①·退役即迁出 —— 人 2026-08-14 01:0xZ 裁定，【推翻我原来的建议】）**（2026-08-14 03:0xZ 达成，独立复核不采信自述：判据1 `retired-clause-check.ts` 现读 **OK — 24 entries migrated (35 unique tokens: all gone from source, all present in archive)**；判据2 落点映射 = `orchestration/archive/AC58-retired-clauses.md` **24 条 R 编号**；判据3 负控制 `checker-mutation-cases/retired-clause-check.sh` 现跑 **exit=0**。**⚠️ 02:3xZ 曾因 R01 残留判 RED 不勾，根因由 outer 查明比"迁了一半"更精确——是【merge 碰撞】**：AC58 分支当时已是 pointer-only、那半做完了，**而我给 AC60 加分母标注时把正文改了回来**，fan-in 取了我的正文版 ⇒ develop 上成"正文+尾巴指针"混合形态。**这是"两个人各自动同一处、都以为对方那半已完成"的第一个实例，且是 merge 层把它物化的。**现 `:53` 已改回指针并保留 `【前提已死,不计入覆盖率分母】` 标注 ⇒ **AC60 的 `排除1/死1` 未破**（同轮复核））
      **我原建议是「加退役标注但保留正文」（照 outer B4 样板）。人裁定相反**：
      **「退役规则应从高频读取/使用的文件删除，另创建 archive 文件保存。」** 采纳，理由成立且比我的强：
      `CLAUDE.md` 开篇逐字「**它的行数是本仓库最稀缺的资源**」——**退役标注恰恰堆积在每会话必读的文件里，
      挤掉的是活指令**；今天实测：我自己的核里已堆 **7 处**退役/前提已死标注，outer 1 处，inner 2 处。
      **判据1（位置）**：三层执行核 + `CLAUDE.md` + 两份 loop 文档里，**标注为退役/前提已死的条款正文 = 0 条**
      （只允许留**一行指针**指向 archive）。
      **判据2（硬规则⑤ 强制，不可省）**：**每次迁出必须产出【落点映射】**——被删内容的**每一个独有词条 → archive 中的位置**，
      **映射贴进删除提交**；**验的是"全部有家"不是"抽查几个有家"**（2026-08-10 实证：抽查 7 个就删了 164 行，3 条无家可归）。
      **判据3（能取假；负控制由落地方产出，manager 不构造）**：**一条"删了但没进 archive"的样本 ⇒ 检查必须红。**
      **⚠️ 不覆盖**：不规定 archive 的路径与格式（同 SPEC §7 的理由）；**不删除仍在生效的条款**——
      迁出的判定标准是「已标退役/前提已死」，**不是「最近没用」**（A17 退休白名单逐字）。

- [x] **AC59（通则②·FAMILY-5 扫描面覆盖三层执行核）**（2026-08-14 02:0xZ 达成，独立复核不采信自述：
      `instrument-failure-check.ts:73-83 DEFAULT_SURFACE` 现读含三份执行核
      （`orchestrator-tick-core.md`/`fast-mode-tick-core.md`/`manager-tick-core.md`）；
      `:70-72` 注释逐字点名三个真实实例（manager B3-戊／outer A11+B3／inner A9）；
      `--gate` 现跑 `FAMILY-5: detected=43 baseline=43 ok`）
      **判据1**：`instrument-failure-check` 的 gate 扫描面**包含三层执行核**（当前只扫 tick 文档 + `plugin/scripts/`）。
      **判据2（能取假，且用【真样本回放】不构造新数据 —— 合 D2）**：今天已实测的三个 FAMILY-5 实例必须被它检出——
      manager 的 `B3 戊`（读 `full-suite-state.json` 断言实时、零新鲜度）／outer 核 `:34 A11` 与 `:52 B3`（同形）／
      inner 核 `:28 A9`（同形）。**一个检不出已知真实例的扫描面，不算覆盖。**
      **理由**：**这三处是同一个 bug 的三个副本，而 FAMILY-5 早已被编号却没扫这三个位置** ⇒ **修根不修消费者。**

- [x] **AC60（通则③·覆盖率分母统一扣除"前提已死"项）**（2026-08-14 02:1xZ 达成，独立复核不采信自述：
      `tick-core-static-check.ts:419-431` 落成 AC8 子句，`DEAD_ANNOT_RE` 逐字覆盖
      `前提已死|来源已冻结|已冻结|前提已失效|前提已被人的裁定移除` 五种标注；
      **现跑** `AC8 覆盖率分母排除一致 OK — manager=排除8/死8 / orchestrator=排除1/死1 / fast-mode=排除1/死1`
      ⇒ **三层一致且逐层配平**；负控制 `checker-mutation-cases/tick-core-static-check.sh` 现跑 exit=0）
      **判据**：三层的覆盖率记法一致——**"前提已死/来源已冻结"的条目不计入分母**。
      **理由（反向激励，C17 家族）**：**否则诚实标注会让覆盖率下降 ⇒ 激励不标注。** manager 侧已执行（当前扣除 6 条）。

- [x] **AC61（清单逐条处置 —— 通则做完之后）**
      **判据1**：manager 2026-08-14 交出的清单 **A-1…A-7 / B-1…B-4** 逐条处置：
      **要么已按 AC58 迁出（带落点映射），要么明写「经核实仍有效」并给出核实读数**。

      **⚠️ 2026-08-14 06:0xZ 修正——这条判据只有两个取值，而真实世界出现了第三个（我自己犯了硬规则 3b）。**
      **实际情况**：任务体 `## AC61 处置记录` 里 **11/11 条都在**（`### A-1…A-7 / B-1…B-4`，我第一次用表格行谓词
      数出 0 是**谓词错**，已按硬规则②另一半改用标题形谓词重数）；**B 项（inner 自己的核）已迁出**；
      **但 A 项 7 条全部记的是「经核实仍有效（仍未迁出——outer 独占，C17）」+ 核实读数 + 建议（outer 落盘）**。
      **而那句「仍有效」指的是【这条发现仍然成立、仍待处理】，不是【被检查的条款仍然正确】**
      ——记录本身写得很清楚、很诚实，**是我的判据只给了两个槽，于是把「已路由、未落盘」塞进了「经核实仍有效」。**
      **现读证据（A 项的条款仍活在 outer 核里）**：
      ```
      develop:orchestration/orchestrator-tick-core.md
        含「工作分支两线」(A-1)      = 1      （原 3，已降但未清）
        含「N == last+1」(A-3)       = 1      （未动）
        含「not-yet-flipped」(A-4)   = 4      （未动）
      ```
      **⇒ 判据1 补第三个取值**：**「已路由给 owner，未落盘」**——它**不算达成**，且必须写明 owner 与建议内容。
      **⇒ 判据1 的第三态「已路由给 owner，未落盘」作为【通则】保留**（它是一条真实存在的结局，任何只给两态的判据都该补它）——**但 AC61 本身【不命中】这一态：outer 用证据推翻了我。**
      **我 06:0xZ 判「A-1…A-7 未落盘」是错的，七条逐条复核后全部已落**（`ca25593c`，已核为 `develop` 祖先）：
      ```
      A-1  :4/:17「工作分支单线 develop」（含「单线」2 行）              已改文本
      A-2  :65 B16【前提已死,不计入覆盖率分母（AC61 A-2）】               已标
      A-3  :54 B5【来源已冻结、不计入覆盖率分母（AC61 A-3）】             已标
      A-4  :32 A9【输入已死（AC61 A-4）】                                 已标
      A-5  :34 A11 + :52 B3【新鲜度限定（AC61 A-5；FAMILY-5）】           已标（2 处）
      A-6  :100「回退对应的翻 done 由【inner】执行（已移交，(a2)）」      已改归属
      A-7  :53 B4 正身已归档 → archive/AC58-retired-clauses.md#R01       已迁出留指针
      ```
      **我的错法（今日最值得记的一次，因为它发生在我刚做对另一半之后）**：我 grep 旧关键词，**把任何命中都读成「条款仍活着」，没有打印命中内容**——而 A-1 的那 1 处命中在 `:65` B16 行内、**是已被标注的 A-2 那一条**；A-3/A-4 的命中则是**注释之后保留的条款本体**（annotate 不 delete）。
      **⭐ 同一条命令里，我对【零计数】做对了（去打印实际内容，发现处置记录是 `### A-N` 标题形而非表格行），对【非零计数】却跳过了同一个动作**——而硬规则② 的两半正是为此而设，**且非零那一半是【有产物】的那一半**（「引用一个计数之前，先打印它匹配到的前 3 条实际内容」）。**我做了没产物的那半，跳过了有产物的那半。**
      **⑵ annotate vs delete 的判别（顺带定死，避免下次再问）**：**A-7 用「迁出+留指针」是因为它是【已退役的条款正身】（AC58 管辖）；A-2/A-3/A-4 用「标注保留」是因为它们是【前提已死但仍需在覆盖率分母里可见】的活条款**——**两种处置对应两类对象，任务体逐条选对了；我自己的核里 乙/丁/A7/A14 用的也是后者。**
      **判据2 已达成**：分类行 **100** 条；**判据2 点名的最严重一条（inner 核 C7 活指令指向已 RETIRED 的
      `integration-branch-model.ts --overlaps-unverified`）在两份核副本里均已清零**
      （`plugin/loop/` 与 `orchestration/` 各 `grep -c` = 0）。

      **⭐ 这条修正本身值得记**：**我今天连续在别处抓「一个判定的输出词表里没有『未评估』这一态」
      （硬规则 3b），而我自己写的判据1 恰恰只有两态。** 区别只在于：**别人的两态检查会把失败读成通过；
      我这条会把「路由」读成「处置」** —— **同一个病，我在自己的产物里没看见。**
      **判据2（补我没做完的那半，明写而不装作已覆盖）**：**inner loop 文档 39 处 / outer loop 文档 12 处 `integration` 命中，
      我只给了计数、没有逐条打印分类** ⇒ **必须逐条打印并分类（活指令 / 退役注记 / 历史记述）**，
      **不得只给计数**（硬规则② 与 A0b⑤(c)）。
      **已知最严重的一条（inner 核 `:65 C7`）**：`integration-branch-model.ts --overlaps-unverified` **不得传空串**
      —— **该模块已于 AC48 标 RETIRED、零生产调用者** ⇒ **活指令指向退役模块**，且它就在 inner 现在要读的那份文件里。
      **⚠️ 但它不阻塞新阶段的 AC54–57**（四条都不碰那条路径），**故排在通则之后，不插队**。

- [x] **AC62（协议·fan-in 改为「无锁段自测 + 锁内 ff」）**——人 2026-08-14 裁定，正本
      `orchestration/SPEC-fan-in-ff-merge-lock-2026-08-14.md`

      **✅ 2026-08-15 10:1xZ 重新勾选——撤勾理由已由 inner 的 `ed24dd02` 消除，我实测复核。**
      **三段历史都要保留，因为每一段在它那个时刻都是对的：**
      ```
      01:0xZ 勾   —— 错：我在【主检出】验绿就勾（环境搞错）
      03:2xZ 撤勾 —— 对：实测裸 worktree 里 suite-in-lock evaluated=FALSE、lock-hold-only-ff 整条缺席
      06:44Z      —— inner 落 ed24dd02（gap-fan-in-worktree-quay-provisioning）：scripts/test.sh 入口调
                     refresh-worktree-quay.sh，把主检出 .quay/ 快照【复制】进 worktree（cp -p，非 symlink——
                     载体是追加写的 jsonl，symlink 会让 worktree 的 suite 写回生产载体）
      10:1xZ 重勾 —— 实测：新开 worktree + 按正确形式跑 refresh（copied 35 files）后
                     fan-in-workflow-check    evaluated=True（ok=false，真报差集，不是 NOT-EVALUATED）
                     fan-in-ff-protocol-check 四子检查【全部 evaluated=True】——含此前缺席的
                                              suite-in-lock 与 lock-hold-only-ff
      ```
      **⇒ 判据2 的两半（非 ff merge 必须红 / 持锁段内跑 suite 必须红）在轮的真实环境里都被评估 ⇒ 撤勾理由消失。**
      **⊢ 我自己的一条记账**：我 10:0xZ 还把 03:2xZ 那个发现当现状复述给 inner（建议改 `.worktreeinclude`），
      **而缺陷 7 小时前已被修好** —— **判准② 陈旧当现状，我犯的**；是 inner 指出后我重跑对照才发现。
      **⊢ 并且第一次重跑我把参数写错了**（`--worktree` 不是它的形式，正确是 `<worktree>` 在前），
      得到一个假的 NOT-EVALUATED，差点据此反驳 inner ——**「先验调用方式」今日第三次。**

      **🔴（历史，理由已消除，保留备查）2026-08-15 03:2xZ 撤勾——判据2 只有一半在轮里被评估。**
      **我 01:0xZ 在【主检出】实跑该检查器全绿就勾了；而验证轮跑在【一次性 worktree】（`full-suite-state.json`
      现读 `oneShotWorktree: true`，`full-suite-runner.ts:2300-2301` `root = provisionOneShotWorktree(root)`）。
      同一检查器、同一参数，两个环境结果不同**（我在临时 worktree 里实跑对照）：
      ```
      子检查              主检出           一次性 worktree（= 轮的真实环境）
      non-ff-fan-in       evaluated=true   evaluated=true    ← 读 git log，worktree 里有
      suite-in-lock       evaluated=true   evaluated=FALSE   ← no-lock-events-file
      lock-hold-only-ff   evaluated=true   【输出里整条缺席】
      retry-record-shape  evaluated=true   evaluated=true 但 nothing to validate
      ```
      **根因**：`.quay/fan-in-merge-lock-events.jsonl` 是 **gitignored**（`.gitignore:180`，已 `git check-ignore -v` 核）
      ⇒ **一次性 worktree 里结构上不存在** ⇒ 依赖它的判据每轮 NOT-EVALUATED、退出 0、套件绿。
      **⇒ 判据2 的两半**：「非 ff 的 fan-in merge ⇒ 必须红」**每轮真评估 ✅**；
      「持锁段内出现 suite 调用 ⇒ 必须红」**在轮里从未被评估 ❌** ⇒ **半覆盖，不勾。**
      **⊢ 解锁条件**：该检查器在**轮的环境里**能拿到 lock-events（见下方 🔴 观察项的三条候选修法），
      或判据2 后半改由一个输入在 worktree 内可得的量承载。

      **⊕（历史，环境错，保留备查）2026-08-15 01:0xZ 我在主检出实跑核实。**
      `run_checker "fan-in-ff-protocol-check"` 现在 `scripts/test.sh:616` **真接线**（`grep -c` 非零半边打印过：
      `run_checker ... --baseline cd4f49b4 --json`，不是注释/候选表）。**实跑**：四个子检查 `non-ff-fan-in` /
      `suite-in-lock` / `lock-hold-only-ff` / `retry-record-shape` 全 `evaluated:true, ok:true`。
      **能取假验证（负控制，硬规则②零计数半边）**：`FAN_IN_MERGE_SUBJECT_RE` 对 baseline 前的历史真样本命中 **325**
      条（旧式 `merge: fan-in gap-xxx` 提交），对 baseline 后 develop 主干命中 **0**——**谓词有效，不是恒零**。
      ⇒ 判据1/2/3 均有生产读数支撑，勾。

      **⛔（历史，已消失）2026-08-14 05:4xZ 核后【明确不勾】，唯一阻塞项：判据2 的检查器零调用者。**
      任务 `gap-ac62` 已 done、四个交付物均在 develop（`fan-in-ff-merge.sh` / `fan-in-ff-protocol-check.ts`
      + 两个测试），协议本体/重试记录/两锁不交叉都已读到。**但**：
      ```
      develop:scripts/test.sh                    含 fan-in-ff-protocol-check = 0
      plugin/loop/fast-mode-tick-core.md                                     = 0
      orchestration/orchestrator-tick-core.md                                = 0
      orchestration/manager-tick-core.md                                     = 0
      其余命中逐条打印过：fan-in-ff-merge.sh:26 是注释；capability-catalog.sh:182 声明、:412 节奏="按需"
      零计数已干跑验证谓词：同读法下 ac56-…-check=3、touches-orthogonality-check=1
      ```
      **⇒ develop 上真出现一个非 ff 的 fan-in merge，没有任何东西会报红。判据2 字面要求「必须红」，
      而它现在【结构上不可能红】——因为它不运行。对一个协议检查器，「按需」等于「从不」。**
      **⚠️ 要讲清的区分**：**AC62 的【任务 AC】确实全满足**（任务体从来没有一条要求接线）；
      **是本【阶段 AC】的判据2 要求「必须红」，那需要它真的跑** ⇒ **任务可以 done，阶段 AC 不能勾。**
      **这正是阶段 AC 与任务 AC 分开的意义。** 接线落地后再勾。

      **判据1（协议形态）**：fan-in 落 develop **必须是 `git merge --ff-only`**；
      **merge 锁只包这一步**，持有时长毫秒级；**持锁期间不得跑 suite、不得做任何其它动作**
      （人逐字：「拿 merge 锁了以后不得再跑 suite，此时唯一可以做的事情就是 ff merge」）。
      **判据2（能取假·结构性）**：**develop 上出现【非 ff】的 fan-in merge commit ⇒ 必须红**；
      **持锁段内出现 suite 调用 ⇒ 必须红**。负控制由落地方产出（沿用 AC49 判据1 的 D2 归属限定）。
      **判据3（失败路径 + 活锁观察产物）**：ff 失败**只有一个原因**（develop 前进了，ff 不可能有冲突）
      ⇒ 处置唯一：回无锁段重 merge + 重跑 suite；**每次失败必须写一条重试记录**
      （任务 id + 第几次 + 当时 develop 头 + 时刻）。**触发条件写死：同一任务 ff 失败 ≥3 次 ⇒ 才谈防活锁机制**
      （硬规则 12：现在拍一个 N 就是凭空设阈值；实测碰撞概率见 SPEC §7-8）。
      **⚠️ 不覆盖**：不规定锁的实现形态与路径；不引入队列/优先级/让步；不动 `fan-in-ts-typecheck-gate.ts`
      与派发侧任何判据。

- [x] **AC63（补钩子缺口·ff 前必须显式跑 doc 检查）——✅ 2026-08-16 人裁定：判据2 放宽，3 个缺口按工程判断消解**
      **判据1（已达成）**：`fan-in-execute.js:150` `bash scripts/test.sh --static-checks-doc` 确在无锁段第 3 步，
      任务 `gap-ac63-ff-explicit-doc-check-before-merge` done，负控制样板真实（钩子计数器实测 ff 触发 0 个钩子）。

      **判据2（能取假·我实跑核，机制真实但揭出 3 个未解释的实例）**：
      检查器 `per-task-suite-record-check.ts` 的 `ff-no-doc-check` 子检查**不在默认 `run_checker` 调用里**
      （`scripts/test.sh:589` 不传 `--lock-events`——**这是设计内的**，代码注释写明「Default live run = shape
      check only；--lock-events 是显式审计」，同 AC57 replay 样板，不算零调用者）。**我显式带 `--lock-events` 跑**：
      ```
      41 条真 ff（lock-events acquire）中 32 条无 docChecked=true 的 per-task-suite 记录
      过滤到【记录机制本体落地之后】（57825d11, 2026-08-14T18:39:42Z——同 AC78 的落地时点判定法）：32 → 3
      有记录的 12 条 ⇒ docChecked=true 12/12（100%）——机制一旦被调用，从未漏记
      ```
      **⇒ 判据2 的检查器是真的（能取假，负控制干净）；但剩下 3 条 post-boundary 缺口我还没有答案**：
      ```
      gap-fan-in-suite-data-not-accounted   Workflow 调用 18:40:40Z（落地后 58s），无记录——很可能自指
        （该任务本身就是「把 4.5 步接进 fan-in-execute.js」那次落地，worktree/脚本体时序未查清，未定案）
      gap-phase-boundary-differential-accounting  Workflow 调用 2 次（20:11/20:13Z，落地后 ~1.5h），无记录——
        真正的 ff 落地在 21:08Z，与这两次调用是否是同一次执行未核实，异常，未定案
      gap-ac81-inner-verify-wiring          meta-cc 查【零】Workflow(fan-in-execute) 调用记录 ⇒ 走的不是
        workflow（同 7e64a86b 的「定义域外」嫌疑，但这次是真实两亲 merge + 任务改动，不是单文件 doc 引用，
        与已结案的 7e64a86b 不同形，未核实是否该按 AC78 判据2 记違规），未定案
      ```
      **⇒ ✅ 2026-08-16 人裁定（逐字）：「不要搞复杂，doc 变更不走 suite test 是个工程方面的考虑和判断。有记录能识别即可。」**
        判据2 的标准由此【放宽】：不是「每条 ff 都必须有 doc 记录」，而是「doc 检查的记录能识别」——
        `12/12 docChecked=true` 已证明记录可识别。那 3 个「无记录」的是「doc 变更不触发全量 suite」
        这个工程判断的正常结果（不涉及 doc 变更 / 走非 fan-in 路径，没跑 doc 检查是设计内的），不是钩子缺口。
        **⊢ 我之前把判据2 读重了**：从「能取假」滑到「每条 ff 都该有 doc 记录」——人裁定的判据2 是「记录能识别」，
        不是「全覆盖」。**⇒ 判据1（机制在代码里）+ 判据2（记录可识别）均达成，AC63 勾选。**

- [x] **AC64（precommit-guard ② 退役——危险已消失，不是参照系失效）**
      **⊕ 2026-08-15 01:1xZ 达成，我核：判据1/2 均在代码中现读到，非自述。**
      **判据1**：`precommit-guard.ts:4-5` 现读「② 拒绝「轮 running 且触及断言面」的写入…已退役（AC64
      2026-08-14, gap-ac64-precommit-guard-clause2-retire）：它保护的危险随 AC42 结构性消失」；
      `:309` 现读「AC64: ② retired ⇒ no state-file read, no fail-loud」；落点映射在
      `orchestration/archive/AC58-retired-clauses.md#R27`（`:368-392`，含来源/退役理由/三条立条教训留档）。
      **判据1**：`precommit-guard` 的职责②（拒绝「轮 running 且触及断言面」的写入）**退役**，
      按 AC58 的形态迁出（删正文 + 留指针 + 落点映射进 archive）；**职责①（文档类检查）保留不动**。
      **判据2（能取假）**：退役后 `precommit-guard` 仍必须对 doc 检查失败拒绝提交（① 未被误删）。
      **⚠️ 退役理由必须写准（manager 2026-08-14 修正了「随 merge 锁重建参照系」这个说法）**：
      ② 原本保护的是「suite 正在跑时别改它正在读的文件」——**而当年 suite 读共享检出**；
      **AC42 之后 per-task suite 跑在各自 worktree、读 worktree 的副本**
      ⇒ **改共享检出完全不影响正在跑的 suite ⇒ ② 保护的危险随 AC42 结构性消失**（「输入不存在」那一族）。
      **merge 锁保护的是另一个、新出现的危险（并发 ff 竞争 develop ref）——两者不是同一个东西。**
      **⚠️ 但 ② 的立条教训必须随迁移留档**（`precommit-guard.ts:19-25` 三条支撑：约定无产物 / 事后难区分 /
      **参与方名单不可维护**）⇒ **merge 锁必须是共享机制（钩子或文件锁），不得是「各层记得调的约定」。**

- [ ] **AC65（边界·「谁能验证」切分 outer 直改权限）**

      **🔴 2026-08-15 10:3xZ 撤勾（我 08-14 03:0xZ 的 ✅ 用错了尺子）——判据3 无执行机件。**
      **判据3 原文**：「一次没有贴验证输出的产品文件直改 ⇒ **必须红**。负控制由落地方产出（沿用 AC49 判据1）」，
      而 **AC49 判据1 = 「从未在真实样本上红过的检查不算判据」**。
      **实测（按位置，含干跑对照）**：
      ```
      grep -rl 'AC65' plugin/scripts/ plugin/test/  ⇒ 2 个文件，且【两个都是 direct-to-develop-bypass-check 及其测试】
                                                      （inner 2026-08-15 才加的 carve-out 注释，不是判据3 的执行体）
      grep -rl '验证输出|verification output'        ⇒ 1 个文件，打印后是该 detector 测试里的 classifyCommit 用例
      干跑对照（同读法）：AC78 = 11 个文件 · AC62 = 13 个文件 ⇒ 谓词有效，命中为真
      ⇒ 【没有任何机件在判「产品文件直改是否贴了验证输出」】⇒ 判据3 结构上从未红过 ⇒ 按其自身引用的 AC49 判据1，它不算判据
      ```
      **⊢ 我当初勾它的依据是什么（自我记账）**：08-14 我写的是「判据2 产物与判据3 能取假**均已逐字写入边界文本**」
      —— **我以「判据文本写进了核」为达成依据，而判据3 要的是【一个会红的检查】。**
      **⇒ 这正是我今晚反复在别处指认的那个错（写进文本 ≠ 有产物，硬规则⑨），而我自己在 AC65 上犯了同一个。**
      **⊢ 与 AC62 撤勾同一把尺子**：那次是「判据2 只有一半在轮里被评估」，这次是「判据3 一次都没被评估过」——**后者更彻底。**

      **✅ 解锁路径已由人 2026-08-15 10:3xZ 给出（逐字）**：「**可以要求 outer 在按照 AC65 提交时申明是 outer 按照 AC65 提交的。**」
      **⇒ 这条声明第一次让判据3 【可机械化】**——此前 detector 无从知道「哪些提交属于 AC65 的规训范围」，
      因而也无从检查「这条 AC65 直修有没有贴验证输出」。
      **⊢ 但声明【本身】不能是豁免（这一点必须写死，否则等于把提交从唯一在检查它的面挪进一个没有检查的面）**：
      ```
      声明的作用 = 【路由】：把该提交交给 AC65 的判据去管，⛔ 不是【免检】
      ⇒ detector 见声明 ⇒ 不再按「inner 绕过 fan-in」判，转而检查 AC65 判据2 的产物
      ⇒ 声明了却【没有验证输出】 ⇒ 必须红 —— 这正是判据3，它由此第一次有了执行体
      ⇒ 并且验证输出必须在【提交信息】里（声明与产物同处一地才可机械核）——
        实测 02b2b2fc 的验证输出只存在于【投递】，git 里看不到；判据2 现文的「或投递」那一支使产物不可事后核
      ```
      **⊢ 重新勾选的条件（🔻2026-08-15 10:3xZ 人裁定后【调轻】，原三条件作废）**：
      **人的裁定（逐字）**：「**AC65 是为 inner 无法有效执行或执行成本过高的任务（如修改 outer 的文本描述的行为）
      留出的通道，其占比应该较低。我希望其机制不要太重，不要求完整的测试，但可以要求实际验证后再勾 AC。**」
      ```
      ✅ 保留：声明 = 路由 ⛔ ≠ 免检（声明了却无验证输出 ⇒ 红）
      ✅ 保留：验证输出与声明【同处提交信息】——否则不可事后核
      🔻 调轻：验证 = 【实际验证】，⛔ 不要求完整套件（scoped 测试 / 单个检查器输出 / 一条断言的运行结果均可）
      🔻 调轻：勾 AC 前必须【实际验证过】—— 这是义务的落点，不是一个闸门
      ⛔ 撤销：我原提的「detector 须在真实样本上红过一次（AC49 判据1 负控制）」—— 那正是人说的"太重"
      ⛔ 不做：每提交闸门
      ```
      **⊢ 我要写明这一点，避免它被读成「判据没过就把判据改软」**：撤勾的理由（判据3 无执行体）成立且不撤回；
      **判据被调轻是人的裁定，逐字记录在上，不是我给自己降标准。** 新判据落定后按**新文本**重判，判过才勾。

      **⊕（历史，保留备查）原勾选记述**：——人 2026-08-14 02:5xZ 裁定（**2026-08-14 03:0xZ 达成**，独立复核不采信自述：`orchestration/orchestrator-tick-core.md:97` 现读已含「谁能验证」切分全文——**可单命令验证 ⇒ outer 可直接修（含 `plugin/scripts`、`plugin/test` 下该改动）／需全量套件 ⇒ 必须走 inner**；**判据2 产物**（"必须贴出验证命令的实际输出，没有输出即违规"）与**判据3 能取假**（"一次没贴验证输出的直改 ⇒ 必须红，负控制由落地方产出"）**均已逐字写入边界文本**；并含对照实例（`outer-tick-log-check.sh` ⇒ 可直接修／`full-suite-runner.ts` ⇒ 走 inner）。**且 outer 修 AC58 那次已【按判据2 执行】**——同一提交里贴出了 `retired-clause-check: OK` 与 `AC8 排除一致 OK` 两条实际输出，我逐条复跑一致）
      （**这是 `escalations.md` 01:2xZ 那条待裁项的裁定结果，且取的是选项 ④，不是原列的 ①/②/③**）。
      **背景实证（manager 2026-08-14，`meta-cc` 全历史非窗口采样，97 次直改逐条分类）**：
      人原先猜测的形态（非代码 × 不跑 suite × 改 outer 自身行为）**只覆盖 3.1%（3/97）**——
      按文件类别 `机件代码 39.2% / 测试 36.1% / 文档 21.6%`；按改谁的行为 `共享机件 78.4% / inner 的 15.5% / outer 自身 3.1%`
      ⇒ **「非代码」被 78% 反例推翻，「改自身行为」被 96.9% 反例推翻。**
      **⇒ 因此不按大小、不按类别切，按【谁能验证】切**：
      ```
      可由 outer 直接修  改动的正确性能在【同一轮对话内】被一条命令验证
                        （跑该 checker 自己 + 它的 mutation case，秒级）
      必须走 inner      改动的正确性需要【全量套件】才能确认
                        （`full-suite-runner.ts` 属此类：它【是】套件本身，改它必须整轮验）
      ```
      **判据1（边界文本）**：`orchestration/orchestrator-tick-core.md:97` 的 D 段边界按上述原则更新
      ——**归 outer 改（其自身核，不在 manager 编辑边界内）**。
      **判据2（产物·这条切法相对"几行/checker 类"的全部优势所在）**：
      **outer 每次直接修，必须在同一条提交信息或投递里贴出那条验证命令的【实际输出】**；
      **没有输出即违规**。**理由（C17）**：「几行」「checker 类」都没有产物、只能靠自觉；
      **而"贴出验证输出"是我本来就该做的那一步，零额外成本，且守与不守在记录上可区分。**
      **判据3（能取假）**：**一次没有贴验证输出的产品文件直改 ⇒ 必须红。** 负控制由落地方产出（沿用 AC49 判据1）。
      **⚠️ 按本原则回看今天的实例（供实现时对照）**：
      `outer-tick-log-check.sh` + 其测试（20 次）⇒ **其 mutation case 秒级可跑 ⇒ 属可直接修那一侧**；
      `full-suite-runner.ts`（13 次）+ 其测试（16 次）⇒ **属必须走 inner 那一侧**。
      **⚠️ 不覆盖**：不改 manager 的 §0/D2 边界（manager 仍不改任何实现）；不改 inner 的派发/实现职责。

      **⊕ 2026-08-15 10:2xZ 人裁定作用域，冲突就此消解（逐字）**：「**AC65 作用在 outer 内，修改进 develop；bypass-detector 作用于 inner。**」
      **⇒ 不是「谁让谁」，是两者【主体不同】**：AC65 授权的对象是 outer 且其修改**直接进 develop**；
      bypass-detector 的规训对象是 **inner**（inner 的改动必须走 fan-in）。**⇒ outer 的 AC65 直修不该被 detector 标记。**
      **⇒ 因此 `AC65_AUTHORIZED_DIRECT_FIXES` 那张 sha 白名单是【错的形态】**：它把一个作用域问题实现成了逐条豁免。

      **🔴🔻 2026-08-15 10:3xZ 更正：上面那个「判据2 缺陷」是我的【假前提】，作废。我把它投递出去过两次。**
      **我原先写的**：「实测 02b2b2fc：提交信息【没有】验证输出 ⇒ outer 走的是【投递】那一支 ⇒ git 记录里看不到」。
      **打印提交信息全文后（我上次显然只看了标题行）**：
      ```
      …修法：A0 feed（renderAll :518 / renderSelected :539）走 full:true 完整行；显式 maxLen 保持截断语义。
      AC65 一条命令验证：A0 outer.ticklog quay 现含 A11+ 内容（full length 676 > 200）。新增测试
      （full 完整行 + 默认截断向后兼容），24/24 绿。
      ```
      ⇒ **验证输出就在提交信息正文里**，且形态正是人今天说的「实际验证、非完整套件」。**outer 做对了，我判错了。**
      ⇒ **「判据2 是否收窄」失去它的动机**：不是在补实测缺口，只是在把既有做法写成规范。
      **⊢ 记账：这是硬规则②「按位置判定」的又一次违反，方向是【读了容器没读内容】**——
      `git log --format=%B` 我只消费了首行。**与 memory `count-reference-print-matched-items` 第三种失效同形
      （数容器而非 population）**，且这次我拿它去**否定一个做对了的下游**，代价比前几次高。

      **✅ 但同一次实测挖出一个【真】缺陷（落点 inner），它比原先那个更重要**：
      ```
      direct-to-develop-bypass-check.ts:113  AC65_AUTHORIZED_DIRECT_FIXES: {sha, evidence}[]
                                      :116    evidence: "…"   ← 【手工抄进源码的字符串】
                                      :158    ac65Evidence: ac65Entry?.evidence ?? null
                                      :472    console.log(`      evidence: ${c.ac65Evidence}`)
      ⇒ detector 打印的 evidence 不是从提交信息【解析】出来的，是它自己回显一个手抄常量
      ⇒ 硬规则④：结构上不可能取假 ⇒ 它现在什么都没在验证
      ```
      **⇒ 声明形态真正要修的就是这个**：让 detector **去读提交信息**，而不是读一张手抄 sha 表。**这个修法本身是轻的。**

      **🔻 10:46Z 口径更正：下面这组数【用错了调用参数】，作废，正确的一组在其后。**
      我裸跑 detector **没传 `--baseline`** ⇒ 扫了全历史；**生产调用点 `scripts/test.sh:709` 传了**
      `--root "${main_root}" --baseline 77b291db… --json`，且 `:700` 注释逐字写着「基线 = 77b291db
      （enforcement 落点）——历史欠账（~29 条）已文档化**不重扫**，只扫基线后的新直接提交」。
      **⊢ 这是今日第二次同形（第一次是 `refresh-worktree-quay.sh` 传错位置参数）**：
      **memory `checker-verdict-verify-invocation-before-explaining-away` 与执行核 criteria F(`:268`)
      「查生产调用点参数」——后者我自己的 B1b 覆盖点名里已连续两轮列为【未覆盖】，这轮就付了代价。**
      **✅ 按生产参数重跑（正确口径）**：
      ```
      totalDirectCommits=45  codeSurfaceCommits=1  designInternal=44  inLockWindow=0
      ac65AuthorizedCommits=1  违规=0  ok=true
      ⇒ 【执行面上代码面直提共 1 条，且就是那条 AC65】⇒ 通道用了 1 次、违规 0 条
      ⇒ 占比确实低（人的预期成立），且结论方向比错口径那版【更强】
      ```
      **🔴 同一次阅读挖出【真缺陷】，且它会让人的裁定按构造翻向（已投递 inner c02ba76a / outer fdd32d79）**：
      ```
      :121-122  /** AC65 验证证据标记——「一条命令可验 + 输出贴出」引用 */
                export const AC65_VERIFICATION_MARKER_RE = /AC65/;
      :147      ac65Authorized = findAc65Entry(sha) != null ∧ commitHasAc65Evidence(message)
      ⇒ 函数名是「有没有【验证证据】」，实际行为是「消息里有没有 AC65 这四个字符」（硬规则②：提到即算命中）
      ⇒ 叠加人的裁定后按构造翻向：声明的字面必然含「AC65」
        ⇒ sha 表换成声明、正则不变 ⇒ 【声明本身满足"有验证证据"】⇒ 声明 = 免检
        ⇒ 正是我和 inner 都同意要避免的翻向，且不需要任何人写错
      ⇒ 修法：声明标记与验证输出必须是【两个不同的谓词、两处不同的内容】，不可互相顶替
      ```
      **⊢ 并更正我对 inner 的一个错判（已投递）**：我说过「detector 的 evidence 不是解析来的、它什么都没在验证」——
      **判定确实读提交信息（`:147` 双闸）**，我只读了 `:113/:472` 就下判断。**手抄常量只用于 `:472` 打印、不参与判定**
      ⇒ 是展示层瑕疵，不是"什么都没验"。**今日第三次「读得不够就下判断」，三次都投递出去了。**

      **⊗ 以下为作废口径，保留备查（全历史、无 baseline）**：
      ```
      direct-to-develop-bypass-check: denominator: total=474 code-surface=26 design-internal=448
                                                   in-lock-window=0 ac65-authorized=1
      ⇒ AC65 通道 = 1/26 code-surface（≈3.8%）= 1/474 全部直提  ⇒ 【占比确实低，符合人的预期】
      另 25 条 code-surface 直提判 RED：日期 08-13=9 / 08-14=16 / 【08-15=0】
      ⇒ 存量是历史的，今天零新增（memory `detector-vs-enforcer-before-blaming` 的可证伪对照：落地后违规=0）
      这 25 条里【17 条提交信息已含验证痕迹】、8 条没有
      ⇒ 真实缺口是「验证了但没【声明】」，不是「没验证」⇒ 支持把机制做轻
      ⚠️ 我没有核这 25 条的实际改动者，⛔ 不作跨层归因（memory `verify-changer-before-cross-layer-routing`）
      ```
      **⛔ 历史存量不补写、不加 sha 表项**（那正是刚被判为回显的东西）；怎么处理归 outer/人定。

- [x] **AC66（AC/任务驱动的行为变更必须可检查确认 —— 人 2026-08-14 03:2xZ 裁定，并【修正了我的切法】）**
      **⊕ 2026-08-15 01:1xZ 达成，我实跑核：两个样板均真接线且判据3 通过。**
      `ac66-a22-agent-id-check.test.mjs` 现跑：11/11 绿，含判据3 两条负控制（真实缺席样本回放 RED，
      真实合规样本回放 GREEN，均非构造 fixture）。`outer-tick-log-check` 接线：
      `orchestrator-tick-core.md:105` 现读边界文本含判据2/3 逐字，`grep -c` 于 `scripts/test.sh` = 1（真调用）。
      **人的原则逐字**：「**仍然允许三层在任务外修改自己的行为；但经过 AC 和任务驱动的行为变更应当是可以检查和确认的。**」

      **⚠️ 这推翻了我 03:1xZ 写下的范围，且我的切错在哪值得记**：
      我按【义务形态】切（「每轮/每 tick」+ 失败模式是"完全没发生"，实测 23 条 / 全库 131 条强制句式）；
      **人按【变更来源】切**（AC/任务驱动 vs 自主）。**实测三个实证全部落在人的切法里，一个都不落在我的**：
      ```
      ① A22            人 2026-08-13 裁定 → 写进 outer 核 → 14 小时未执行     裁定驱动 ✓
      ② checker 接线    头注释署名「manager 明令必须接线」→ 4 天未接           manager 驱动 ✓
      ③ AC58 的 R01     AC 驱动的迁出被我加标注时撤销、fan-in 固化              AC 驱动 ✓
      ```
      **而我那 23 条里大量是【自主写下】的**（「每轮必跑的读数」「每轮两份都跑」…）
      ⇒ **按人的原则它们不需要产物，我原来的范围多要了。**
      **⇒ 一般形态（今日又一例）：一个看起来合理的切法，可以在三个真实样本上【一个都不命中】——
      切法必须拿实例检验，不能只看它自不自洽。**

      **判据1（范围·按来源，且前向不追溯）**：**只覆盖【AC 或任务驱动的行为变更】**——
      即：某条 AC 的判据要求的、或某个任务的 Touches 落地的行为规则改动。
      **明确不覆盖【任务外的自主行为变更】**——三层仍可直接改自己的行为文档、当轮生效不立任务
      （`orchestrator-tick-core.md:98` 既有快路径**保持不变**）。
      **前向生效，不追溯**（同 AC47「前向闸不追溯，也不该被读成追溯过」）。

      **判据2（可检查确认的产物）**：**一个 AC/任务驱动的行为变更，必须能独立于「文本已改」回答"它生效了吗"**。
      **两个已验证样板**：**A22 ⇒ tick-log 读数行必须带 agent 标识**（不是"核里写了要用 subagent"）；
      **`outer-tick-log-check` 接线 ⇒ 它必须出现在 `run_static_checks` 的显式列表里**（不是"注释里写了必须接"）。
      **⚠️ 产物必须是「本来就要写的东西」，不得是新增打卡动作**
      （A0b⑤(b) 的教训：原版因产物之后无人再用，被我自己连续 4 轮跳过）。

      **判据3（能取假·用真样本，不构造）**：**A22 那 10 次主线程调用即现成的真实缺席样本**
      （文本已改而行为未变）⇒ **回放它必须报红**。合 D2；亦满足 AC49 判据1「从未在真实样本上红过的检查不算判据」。

      **⚠️ 不覆盖**：不改任何现有条款内容；不限制自主变更；不引入"每轮自检清单"这类无产物的提醒
      （那正是本 AC 要治的病）。

- [ ] **AC67（fan-in 的【执行者】必须落到任务 subagent —— AC62 搬了锁，没搬执行者；人 2026-08-14 03:5xZ 追问「inner 任务 subagent 自行 merge 什么时候才能发生」）**
      **发现的经过**：人问「outer 和 inner 仍然在用 fan-in 这样的描述，我们期望的 subagent 自行 merge 什么时候发生」。
      我原以为答案是「AC62 落地那一刻」。**核了才知道不是**——AC62 交付的是协议形态，不是执行者位置。

      **证据（三条，全是位置判定，不是关键词）**：
      ```
      ① AC62 五条判据 grep -c 'subagent' = 0
         （零计数已按硬规则②另一半干跑验证：CLAUDE.md=6 / fast-mode-tick-core.md=3 ⇒ 谓词有效，是真零）
         五条分别是：协议本体 / 能取假 / 重试记录 / 两锁不交叉 / 测试绿 —— 【没有一条约束"谁执行"】
      ② A6 改写后主语仍是「Fan-in **已返回任务**」，动作形态 `git -C <wt>`、`<本会话在飞集合>`
         ⇒ 主线程【从外面】操作别人的 worktree，且任务【已经先返回了】
      ③ inner 自报 2026-08-14：「Waiting on cert monitors to drive fan-in per A6」
         ⇒ 主线程在等 suite，等完由它自己做 fan-in
      ```
      **而人的裁定原文主语是 subagent**：「**每个 subagent 应在 merge 前**把 develop 最新变更 merge 回自己的
      worktree 并执行 suite 测试」（SPEC-fan-in-ff-merge-lock-2026-08-14 §0 逐字）。
      **⇒ AC62 落地不会让它发生。缺的是这一条。**

      **⚠️ 一般形态（值得单记）**：**一个协议可以被完整实现，而它要解决的那个问题原封不动**——
      因为协议描述的是【动作序列】，问题出在【谁执行这个序列】，而判据只查了序列。
      **同族于 FAMILY「字面为真且恒真」，但更隐蔽**：这里判据不恒真、能取假、也确实红过绿过，
      **只是它测的维度与目标的维度正交**。⇒ **写判据时要问的不只是"它能取假吗"，还有"它取假的那个维度是目标维度吗"。**

      **判据1（执行者的位置）**：无锁段 ①②③ + 持锁段 ④ **全部在任务 subagent 自己的回合内完成**，
      **subagent 在 ff 成功之后才返回**；inner 主线程的 A6 上**不再有任何 merge 动作**
      ⇒ A6 的主语从「Fan-in 已返回任务」改掉，`git -C <wt>` 形态消失（subagent 在自己树里直接 `git merge`）。

      **判据1b（防改名·2026-08-14 06:1xZ 补，人逐字「不应当是取消 cert monitor 这个提法后换个名字继续在主会话跑」）**：
      **判据1 原文查的是【核文本】（A6 主语、`git -C <wt>` 形态），一个只改措辞的实现就能通过** ⇒ 补一条读【实际执行命令行】的：
      ```
      inner 主会话 <session-id>.jsonl 里【不再出现】
        (a) 不带 --for-task 的 test.sh 调用      ← 全量 suite
        (b) 对 tasks/*.md 的 status 翻转提交      ← flip（人 06:1xZ 追加裁定：flip→merge 也须在 subagent 内）
        (c) 向 develop 的 merge                  ← merge
      这三类只出现在 <session-id>/subagents/agent-*.jsonl 中
      读法：ls -t <session>/subagents/agent-*.jsonl 定位后直接读；主会话读 <session-id>.jsonl
            （meta-cc query_session_content 不递归 subagents——负控制验过：一条确在 subagent
             transcript 里的 Bash 命令，include_subagents=true 仍返回零）
      ```
      **它读的是实际命令行，不是标签/措辞/条款文本 ⇒ 改名改不掉。**
      **⚠️ 这条判据 2026-08-14 已被真正使用一次**（人问「最近的 suite 跑在哪」时我用它答的）：
      inner 5 个 subagent transcript 共 40 次 `test.sh` **全带 `--for-task`**；
      主 jsonl `05:17:15Z` 逐字 `cd …/gap-ac63-… && (bash scripts/test.sh > /tmp/ac63-fullsuite…`（**无 `--for-task`**）
      ⇒ **当前读数就是这条判据的【红】；落地后翻绿才是"淘汰"的证据。**

      **⚠️ 判定时点（写死为读法 B）**：**判据1b 判在 AC67 落地【之后】的第一次 fan-in，不判 AC67 自身那次。**
      **理由**：AC67 落地前 inner 主线程仍按旧 A6 执行 ⇒ 自身那次全量 suite 必然跑主会话
      ⇒ **判自身那次结构性恒红（硬规则 4：一个此刻不可能取另一个值的量不是测量）** ⇒ AC67 将永不可满足。
      只有落地后（新 A6 在 develop、执行者已搬进 subagent）的下一次，transcript 落点才可红可绿。

      **判据2（能取假·产物是本来就要写的东西）**：`fan-in-ff-merge.sh` 已被 AC62 判据3 要求写记录
      （任务 id/第几次/develop 头/时刻/runId）⇒ **该记录加一个调用方 agent 标识字段**，
      **判据 = 该标识 ≠ inner 主会话**。**不是新增打卡动作**，是给一条已经必写的记录加一列
      （同 AC66 判据2 的 A22 样板：tick-log 读数行本来就要写，加 agent 标识）。

      **判据3（能取假·用真样本，不构造）**：**现行 A6 每一次主线程 fan-in 都是现成的真实缺席样本**
      （近 6 小时 4 次 merge，SPEC §8 实测）⇒ **回放其中任一次必须报红**。合 D2（读既有对象，不造对照输入）。

      **⚠️ 不覆盖**：不改 AC62 已落的协议本体（无锁段/持锁段/ff-only/两锁不交叉全部照旧）；
      不引入队列/优先级/让步（SPEC §7：活锁仍是观察项，触发条件写死在同一任务 ff 失败 ≥3 次）；
      不要求 subagent 承担 needs-human 之外的路由判断。
      **依赖**：AC62 落地之后才谈——协议先在，才谈把它交给谁执行。

      **【前后对照基线，2026-08-14 03:5xZ 记，不是指标】**：本条的目的是吞吐，但**吞吐不能当判据**
      （硬规则 4 推论：成本结构未知前不设数值阈值；端到端耗时依赖在飞任务数 N 这个外生变量
      ⇒ 它不是指标，**只能当同 N 下的前后对照基线**）。⇒ **记基线，不设目标**：
      ```
      来源 .quay/inner-tick-log.jsonl（inner 自己每 tick 写的 phase 字段，125 条，08-13T09:46→08-14T03:49）
      全历史  n=125   fan-in 族 27%   dispatch 23%   其它 50%
      近 40 条 n=40    fan-in 族 68%   dispatch 18%   其它 15%    ← 把 suite+merge 搬进 inner 主会话之后
      等待态(held/queue) 全历史 16/125 = 13%
      ```
      **⇒ 近 40 轮里 inner 每 3.4 个 tick 才派发一次，其余在做 fan-in 与等待。** 这就是人 2026-08-14
      「只是把原来在 outer 做的 suite test 和 merge 挪到了 inner 的主会话里」那句话的机械读数。
      **AC67 落地后取同一读数对照即可**——**不预设它应该变成多少**。
      **⚠️ 这个量的局限要一并记（4b）**：`phase` 是 inner **自己写的分类标签**，属自述量；
      它能反映"inner 认为自己在做什么"，**不能证明它确实在做**。作前后对照够用（同一自述口径），
      **不可用来判 inner 是否活着**——那要用 `git worktree list` / 提交时间戳这类外部可核量。

      **⚠️ AC67 不解决的（同轮核实，避免把它当银弹）**：**并发上限由 `QUAY_MAX_CONCURRENT_SUITES`（默认 2，
      `full-suite-runner.ts:1479-1482` 单一定义点）决定，与执行者是谁无关** ⇒ **AC67 落地后仍是同时 2 条验证、
      cap=5 ⇒ 3 条恒等槽**。锁跨度实测基本合规（`test.sh:1211` acquire → `:1415` release，
      段内非测试动作 `run_static_checks` 20.9s + `build_dist` 0.9s + `resource_gate` 0.7s ≈ 22.5s，
      对比测试段 serial 183.3s ∥ lowconc 124.6s → main 156.6s ≈ 340s ⇒ **非测试占比 ≈ 6%**；
      n=135–198，来源为机件自己的 `__OVERHEAD__` 遥测落盘）。**⇒ 收紧锁跨度是 6% 的事，不是这 3 条等待的原因。**

- [ ] **AC71（处理问题必须同时覆盖【机制】与【止损】—— 人 2026-08-14 04:3xZ 逐字裁定：「显然应当在 manager / outer 强化以上行为：处理问题时应覆盖"机制"和"止损"」）**
      **起因**：人先问「所以 outer 仅仅建了两个任务就等着 inner 去处理了？对于 inner 当前错误的行为就不管了？」，
      随后把它升为对 manager / outer 两层的通则。

      **⊕ 2026-08-15 04:0xZ 核实（判据1 ✅ · 判据3 结构上无从发生 ⇒ 不勾，解锁条件写在下面）**
      **判据1 ✅ 两层都落，位置现读**：outer `orchestrator-tick-core.md:68` B18 · manager `manager-tick-core.md:79` C21
      （逐字均含「报/裁一条【活行为】里的缺陷 … 投递与记录各带一行 `止损：不需要 —— 理由<读数>`」）。
      **判据3 的【样本真实性】我独立复核为真（不采信自述）**：
      ```
      git show e69beef0:tasks/gap-ac68-…  ⇒ 止损行 = 0   ← 立案当时确无，是真实缺席
      git show e69beef0:tasks/gap-ac69-…  ⇒ 止损行 = 0
      cba1f2e6（2026-08-14T04:08:49Z）    ⇒ 恰好 +2 行止损，一任务一行  ← 事后补入
      ⇒ 合 D2：真样本，非构造
      ```
      **🔴 但判据3 要求的是「回放它们【必须报红】」，而全仓没有任何机件以「止损行缺失」为判据**：
      `grep -rl '止损' plugin/scripts/*.ts plugin/test/*.mjs` = **1**，且打印后是 `ac66-a22-agent-id-check.test.mjs:48`
      的一句无关引文（干跑对照：同读法下 `A23` = 2 个文件 ⇒ 谓词有效，是真零）。
      **⇒ 没有能报红的东西 ⇒ 判据3 不是「不合格」，是【结构上无从发生】** —— 与 AC49 判据1
      「从未在真实样本上红过的检查不算判据」正面冲突。
      **⚠️ 任务体自己就写明了这一点**（`gap-ac71` Touches 第三条逐字）：「（如需产物化判据3：`plugin/scripts/` 新增检查器
      + `test.sh` 接线 + 测试——**按需要评估**，核心判据是执行核条款的位置）」⇒ **产物化被显式列为可选，而阶段判据3 要求它。**
      **⊢ 解锁条件（二选一，归 outer 判）**：① 产物化判据3（一个以「活行为缺陷投递/立案缺止损行」为判据的检查器，
      用 AC68/AC69 的 `e69beef0` 版本当回放样本）；② 若判定不值得造，则**改判据3 的措辞**，明确它由
      「样本真实性 + 条款位置」承载而非由「回放报红」承载——**⛔ 不得两者都不做而直接勾**（那正是 AC73 家族）。

      **范围**：**只覆盖【活行为】里的缺陷**——即该错误行为**此刻仍在跑**；纯代码/文档缺陷不适用。
      **两项义务，缺一即未处理**：
      ```
      (a) 修机制   立案 / 排期 / 落地           ← 一直在做
      (b) 止损     这个错误行为现在还在跑，要不要立刻压住 ← 是本条新增的那一半
      ```

      **判据1（形态·产物是本来就要写的东西）**：报/裁一条活行为缺陷时，**投递与立案里各带一行**
      `止损：不需要 —— 理由<读数>` 或 `止损：需要 —— <当下动作>`。
      **不是新增打卡动作**——加在本来就要写的那条投递上（同 AC66 判据2 样板；A0b⑤(b) 的教训：
      产物之后无人再用，就会被跳过）。

      **判据2（三个关口，缺一即等于没做；三条各由同日一次真实错误换来）**：
      ```
      ① 不能漏           「判过了、结论是不需要」与「根本没想到」在记录上同形        硬规则 9
      ② 不能被前置吃掉    止损 = 用现有材料先压住出血；需要新机件的那不是止损，是提前实现   硬规则 12
      ③ 必须带判据，
         且判据不得是自述量  否则「做没做成」只能靠做的人自己说                        硬规则 4b
      ```
      **②的实证**：outer 把 `fan-in-ff-merge.sh` 当成无锁段止损的前置，**而无锁段三步
      （`git merge develop` / `fan-in-ts-typecheck-gate.ts` / `test.sh` + `--static-checks-doc`）
      全部是 develop 上的现有机件**，那个机件**只服务止损版留在主线程不动的那一步**。
      **③的实证**：止损效果的唯一基线是 inner 自己写的 `phase` 字段——
      **「止损做了」与「只是把同一动作换个 phase 名」在该量上完全同形。**

      **判据3（能取假·用真样本，不构造）**：**AC68 / AC69 两条即现成的真实缺席样本**
      （立案时均无止损行，事后补）⇒ **回放它们必须报红**。合 D2；亦满足 AC49 判据1。

      **发生率（硬规则 12 自查，立条当日）**：3 例中 **2 缺**（AC68、AC69）、**1 有**（A16 遥测漏写，
      且「有」是因为当时被逼着回答「要不要补」）⇒ **够支撑「写进形态」，不够支撑「造检查器」**。

      **归属**：manager 侧已落 `manager-tick-core.md` **C21**（本轮）；**outer 侧同义条款由 outer 落自己的核**
      （不由我代写——`orchestrator-tick-core.md:97` 是它的边界）。inner 侧暂不铺（发生率未测）。

      **⚠️ 不覆盖**：不改任何现有条款；不要求对纯代码/文档缺陷做止损判断；
      不引入「每轮自检清单」这类无产物的提醒（那正是本 AC 要治的病）。

- [ ] **AC72（「cert」机制退役 + per-task suite 结果必须第三方可读落盘 —— 人 2026-08-14 05:0xZ：「cert 是一个应尽快退役的机制」）**

      **事实一：「cert」不是本仓库的机件。** 2026-08-14 实测：`capability-catalog.sh` 182 条声明 **0** 命中
      （唯一 grep 命中是 `uncertain` 的假阳性，已打印核对）、`plugin/scripts/` 文件名 **0**、三层执行核各 **0**。
      **它是 inner 对一整套做法的自造简称**：主线程为每个已返回任务跑一遍全量 suite、挂 monitor 盯结果、
      排队等两个 suite 槽、按 `cert1/cert2/…` 编号重跑。

      **事实二：替代它的机制已经写好了，只是没人说它是「替代」。**
      AC62（协议）+ AC67（执行者）合起来规定的是：**subagent 在自己 worktree 内
      `merge develop` → 全量 suite → doc 检查 → 持锁 `ff-only`，主线程不再有 merge 动作。**
      **⇒ 新机制里【没有 cert 这一步】，也没有 monitor、没有主线程队列、没有重跑编号。**
      **cert 不是被替换，是【在新机制下无处安放】。**

      **事实三（本条要补的洞）：没有任何一条 AC 说它退役，也没有任何一条规定【成功路径】的结果记到哪。**
      逐条核过：AC62 只规定了 ff **失败**的重试记录（判据3），**成功路径零留痕**；
      `manager-phase-goal.md` 里 `退役` 40 处命中**无一条指向 cert**。

      **判据1（退役是可判定的事件，不是自然消失）**：inner 执行核里**不再有「为已返回任务在主线程跑 suite」的条款**；
      `.quay/inner-tick-log.jsonl` 的 `phase` **不再出现 `fan-in-cert-*` 族取值**。
      **⚠️ 2026-08-14 06:1xZ 修正（人逐字：「不应当是取消 cert monitor 这个提法后换个名字继续在主会话跑」）**：
      **上面两条都防不住改名**——`phase` 是自述标签（改名即变），执行核条款是文本（改措辞即变）
      ⇒ **`phase 不再出现 fan-in-cert-*` 降为【纯参考，不作判据】**，主判据换成读【实际执行命令行】的那条：
      **与 AC67 判据1b 同一条**（inner 主会话 jsonl 里不再出现 (a) 不带 `--for-task` 的 `test.sh`、
      (b) `tasks/*.md` 的 status 翻转提交、(c) 向 develop 的 merge；三类只出现在 `subagents/agent-*.jsonl`）。
      **执行核条款仍查，但降为【必要不充分】**：条款改了而命令行没变 ⇒ 仍判红。

      **✅ 2026-08-15 11:3xZ 现读：判据2 的载体【已在产出】**（推论三：只数实现落地后的真记录）
      ```
      .quay/per-task-suite-records.jsonl  38 条 · 20 个不同 taskId · mtime 11:16Z（刚写）
      字段：taskId runId ts startedAt finishedAt state durationMs fullSuiteRan
            docChecked docCheckExit failedFiles laneCount load cpu_time_s cpu_source
      fullSuiteRan 分桶 = {True: 9, False: 28, None: 1}  ⇒ 9 次真全量，均有记录 ⇒ 成功路径有留痕
      ```
      **🔴 但同一读数里有一个必须记的 3b 形状**：`state` 分桶 = **{green: 38}**，**38/38 全绿、一条红都没有**。
      ⇒ **从该载体无法区分「per-task suite 从不红」与「红的没被记」** —— 今天 develop 上明明有过红轮。
      **⛔ 这不否定判据2**（判据2 只要求成功路径留痕，字面已达成），**但它意味着该载体不能被当作红率来源**
      ——而 AC84 判据6 恰好要求「红率分桶改读这个文件」。**两条 AC 在这里对撞，落地前必须先解决。**
      **⊢ 已随 AC84 投递给 outer（`0dd66d04`）。**

      **判据2（成功路径也要留痕，且第三方可读）**：每次 per-task 全量 suite 落**一条**记录，
      含 `taskId / runId / state / laneCount / durationMs / 失败文件清单 / 起止时刻`，
      **写在共享检出可读的位置**——不是 worktree 内那份 fork 继承的副本。
      **理由是一次实测**：四棵在飞 worktree 的 `.quay/full-suite-state.json` 的 `runId` **全部 = `eac3ee98`**、
      `startedAt` **全部 = `08-13T16:19:54`**，与主检出逐字相同 ⇒ **它们是 fork 时继承的同一份，不是各自的实测**
      ⇒ **至今零条 per-task 全量套件的时长实测**，且**第三方无法复核 cert 结果**
      （代价已实际发生：manager 2026-08-14 因此发出过一条错的失败文件归因，被 inner 用真 cert 输出纠回；
      inner 已认领 `gap-cert-result-no-third-party-readable-landing`，本 AC 与它是同一件事的两侧）。

      **判据3（能取假·用真样本，不构造）**：**AC57 的 7 轮 cert 是现成的真实缺席样本**——
      回放它们，判据2 要求的记录集合**应当为空** ⇒ **必须报红**。合 D2；亦满足 AC49 判据1。

      **顺序（本条明确写死，因为它决定别的条能不能落）**：**AC62 → AC67 → AC72**。
      **AC68 不是本条的前置**，但**它已由一次新读数升级为紧急**——见下。

      **⚠️ 不覆盖**：不规定记录的格式与文件名（实现面）；不改 AC62 协议本体；不引入任何新的 monitor
      （**新机制的要点之一就是不再需要有人盯着**）；不规定 suite 槽数（那是 AC68/AC69 的范围，且人已裁定保持既定 lane 设置）。

      **⚠️ 同轮附带：AC68 的「止损：不需要」已被一次新读数推翻，必须重判。**
      立那条止损时的读数是 `load1=6.69 / cpu_some_avg10=0.71 / 两条 suite`；
      **05:0xZ 现读**：两条 suite（AC61 / AC62 各一个槽）各自 `node --test --test-concurrency=16`，
      `worktree_node_tests=32`、`budget_in_use=36 > total_budget=16`、`budget_available=0`，
      **闸门自己的判词是 `=> WAIT: CPU 饥饿（some avg10 >= 60）`，并附实测「重型测试在此负载下会超时（48.8s vs 隔离 2.0s）」。**
      **⇒ 过订阅已经在造成可测代价，而不再是「真但无代价」。**
      **这也说明 C21 的一个隐含要求要写明：**「止损：不需要」**不是一次性结论，它绑在当时那组读数上；
      读数变了就必须重判**——否则它会变成一个永久豁免。**（此点已随本 AC 投 outer 与 inner。）**

- [ ] **AC73（「造好了但没人用」要有检测器 —— 发生率攒到 3 才给的门槛，硬规则 12）**
      **为什么现在给、之前不给**：硬规则 12 要求「要求一个新前置/新机制之前，先给出它已经发生过几次」。
      **这条我一直卡着不给**，直到 2026-08-14 一天内攒到 **3 例，且三例互不相关**：
      ```
      per_suite_lane_budget=8       resource-gate.sh 算对、打印，全仓无 reader       → AC68
      fan-in-ff-protocol-check.ts   造好、测试绿，test.sh 与三层执行核命中全 0        → 本条的触发例
      checkSplitRecommendation      零非测试调用者（CLAUDE.md「Split-decision routing」已记）→ 既有
      ```
      **三例的共同形态**：**机件本身正确、测试通过、文档齐全——唯独没有任何东西调用它**
      ⇒ **在记录上它「在」，在行为上它不在。** 这与 AC66 同源，但对象不同：
      AC66 管「行为变更是否可确认」，本条管「机件是否真的在被执行」。

      **判据1（节奏非「按需」者必须有调用点）**：`capability-catalog.sh` 已有节奏栏（`:412` 那一列）
      ⇒ **凡节奏非「按需」的机件，必须在 `scripts/test.sh` 或某个执行核里有【一处按位置命中】，否则红。**
      **产物是本来就要维护的 catalog，不是新增打卡动作**（同 AC66 判据2 样板）。

      **判据2（「按需」本身也要被约束，否则它是逃逸口）**：**一个判据类机件若声明为「按需」，
      必须在 catalog 里写明【谁在什么条件下按它】，否则红。**
      **理由**：`fan-in-ff-protocol-check.ts` 的节奏栏正写着「按需」，而**对一个协议检查器，
      「按需」等于「从不」**——它的价值全在连续性，没有人会在违规发生的那一刻想起来手跑它。
      **⇒ 不约束「按需」，判据1 就只是把问题挪到那一栏里。**

      **判据3（能取假·用真样本，不构造）**：**三个现成的真实缺席样本，回放必须报红**（合 D2；亦满足 AC49 判据1）：
      ```
      ① fan-in-ff-protocol-check.ts   零调用者（test.sh 与三层执行核命中全 0，catalog 节奏="按需"）
      ② tick-core-drift-check         有消费者但被 --no-block 静音（今日逐字报 3 pairs / 0 consistent / 3 drifted，
                                       报了不挡 ⇒「报了」与「没报」在下游不可区分）
      ③ checked === total 谓词         【方向性零消费者，2026-08-14 06:1xZ 补】——同一谓词
                                       派发方向有 20–34 处消费者（ready-pool-check.ts=34 / slot-refill.ts=20），
                                       翻 done 方向零（loop-complete-task.ts 只在 :109-110 判 !sectionFound）
                                       ⇒ 实证：gap-ac68 以 status=done 落地而 AC/DoD 全文 [x]=0 / [ ]=5
      ```
      **③ 的价值在于它是【方向性】的**：一个谓词可以在一个方向被消费得很好、在另一个方向零消费者，
      **而「它有消费者」这句话按整体看是真的** ⇒ **判据面必须按方向枚举，不能按"有没有人用"整体问。**

      **⚠️ 不覆盖**：不要求任何机件改变自己的节奏（那是各机件自己的事）；
      不引入「每轮检查有没有零调用者」这类无产物的提醒；不改 catalog 的格式。

      **关联**：AC73 接线落地后，**AC62 的判据2 才可能红** ⇒ **AC62 阶段 AC 的解锁条件就是本条**。

- [ ] **AC76（cap 的被计量对象 = 并发 subagent；禁用 worktree 代理 —— 人 2026-08-14 07:3xZ 更正我）**
      **人的原话**：「**cap=5 就是为了保护 subagent —— inner 不能并发无限多 subagent。worktree 只是你找的又一个间接的表征量。**」

      **① 正本本来就写着，是我没读**：`slot-refill.ts:15-16` 逐字——
      「`slots_free = max(0, effective_cap - in_flight_count)`。调用方**显式传入 CURRENTLY-RUNNING subagent set**
      （`--in-flight`）—— the INNER tick's own maintained set」。
      **⇒ cap 的量在正本里就是「当前在跑的 subagent 集合」。** 而我一整天用 `git worktree list | grep -c`
      ——**它既不是正本，也不是 `:22-29` 写的 fallback（telemetry `--slot-status`），是我自己发明的第三个读法。**

      **② worktree 的偏差是【双向】的，两个方向今天都实测到了**（所以它不是"保守地错"，是单纯地错）：
      ```
      07:2xZ   worktree 4 · 活跃 subagent 回合 2   ⇒ 高估 2（任务占树但在等 cert 槽/等 merge/红等）
      07:4xZ   worktree 1 · 活跃 subagent 回合 2   ⇒ 低估 1（A22 晋级/诊断类 subagent 不占树）
      ```
      **⇒ 高估时会在 subagent 预算实际空着的时候挡住派发**——这正是我今天几次「有空槽、有 ready 的 disjoint 任务、却没派」
      之后跑去查别处的原因：**我拿一个错的量做了判断，然后去查判断之外的东西。**

      **判据1（正本点名被计量对象）**：cap 的被计量对象在正本里**写死为「inner 会话内并发运行的 subagent 数」**，
      并**明写禁用 worktree 计数**作为它的代理。
      **判据2（第三方可核读法）**：manager/outer 读不到 inner 的 `--in-flight` 集合 ⇒ 给出**外部可核的直接量**：
      `<session>/subagents/agent-*.jsonl` 中**近 N 分钟有写入**的文件数。
      **这个读法今天已被真正使用并证明可用**——它就是 AC67 判据2 那个直接量（`agentId=aab2d14d…` 对应 subagent transcript）。
      **判据3（能取假·用真样本，不构造）**：**上面 ① 的两条实测即现成真样本**——
      **回放它们，用 worktree 计数的判定必须与用 subagent 计数的判定不一致**（一条高估、一条低估）⇒ 报红。合 D2。
      **判据4（报数带计法）**：三层写「在飞」时必须带计法（`在飞 subagent=M` / 若同时给 worktree 须标明是另一个量）。

      **⚠️ 不覆盖**：不改 `cap=5` 这个数值（人 2026-08-09 已裁定固定 5，动态 cap 停用）；
      不新增任何槽位系统；不改 suite 槽（那保护的是 CPU，与本条不是同一个资源）。

      **③ 扩张（人 2026-08-14 09:1xZ 逐字裁定，本条从「cap 的计量对象」升为「在飞的唯一读法」）**：
      「**"在飞"不应当靠任务记录，而应当查 inner 任务 subagent。任务只要使用既定的 status 跟踪状态。**」
      ⇒ **两个量各干一件事，不再有第三个**：**在飞 = 查 inner 任务 subagent**（直接量）；
      **任务状态 = `tasks/*.md` frontmatter 的 `status`**（既定跟踪）。
      **⇒ 判据1 的「禁用 worktree 代理」推广为：禁用【任何任务记录】判在飞**——遥测括号、reconcile 探针、
      worktree 计数，三者都是代理，全部退出在飞判定。

      **触发本裁定的实测（人 09:0xZ 指出 /live 显示 AC66/AC72/AC73 在跑，实际只有 AC76/AC78）**：
      `.workflow-events/` 四条逐条打印，**形态完全相同**（`records=1`，仅开括号，`candidateCommit:null`）——
      `ac66/ac72/ac73` 均 `status=done`、`ac76` `status=ready`，**已 done 的三条与在跑的那一条在遥测里不可区分**。
      三层表示与可靠度：**①`status:done`（盘上直接量）3/3 正确**；**②`--task-end` 括号闭合 0/3 写过**；
      **③`reconcileInFlight`+`makeDefaultExecutorGone` 兜底 ② 的缺失**。
      **①② 结构上不可合并**（`fast-mode-telemetry.ts` `VALID_OUTCOMES` = `done|needs-human|skipped|error|abandoned|deferred`
      6 值 vs `status` 4 值，且 `--task-end` 全文件 0 处写 `status` ⇒ 多个括号对一次翻 done）——
      **而人的裁定绕开了这个问题：不是把 ② 改对，是不再用 ② 判在飞。**
      **③ 为什么也不救场**：`fast-mode-telemetry.ts:1138` 探针 = `processAlive → worktreeExists → isBranchMerged → CLOSE`，
      **该文件提到 `tasks/` 的行数 = 0 ⇒ 它从不读 `status`**；而三条 done 的 worktree 现读**均已不存在**
      ⇒ **探针若跑会全部 CLOSE ⇒ `--reconcile` 根本没被调用**；且 `analyzeSlotStatus` 已有
      `lastReconcileAtMs`/`reconcile_compliant`、任务 `gap-reconcile-step-skipped-no-compliance-product` 早已立案
      ⇒ **又一个 AC73 族（产物在，缺陷照发）**。

      **判据5（C24 既成事实复判清单，空集须显式；此处非空 7 条，归 outer 落）**：
      ①`fast-mode-telemetry.ts` 的 `realInFlight`/`reconcileInFlight`/`detectClosedButLive`/`analyzeSlotStatus` 在飞维度；
      ②`slot-refill.ts` 的 `in_flight_count`→`slots_free`；③`.quay/inner-wakeup-heartbeat.json` 的
      `slots_free`/`should_refill`/`dispatchable_disjoint` 在飞输入；④`/live` 与 observation 面的 `realInFlight` 消费端；
      ⑤A16/A16b 的 `--task-start` 遥测半边（**仅其"在飞"用途**；派发留痕用途另议）；
      ⑥**我自己的 A3**——我一整天用 `git worktree list` 逐条判在飞，**同样被本裁定否掉**；
      ⑦本条 ①② 原文（cap 维度）与本 ③（在飞维度）合并为同一个读法。
      **②③ 的退役写显式退役标注，不删**（同 AC48 判据2）。**投递 `e6c5d32c`（→ outer，单一 owner）。**
      **止损：不需要 —— 错的方向是【多报】不是【漏报】**（3 条已 done 被报成在跑），多报只会让派发偏保守、
      不会造成并发超限或误派；读数 `in_flight` 真值 2 / `load1=1.98` / `cpu_some_avg10=0.00` / `mem_avail=8841MB`。
      **（C21④：本结论绑这组读数；若出现「因 /live 多报而不派发」的实例，须重判。）**

- [x] **AC77（subagent spawn 触顶：只检测 harness 报错，不自建计数 —— 人 2026-08-14 07:4xZ 逐字裁定）** ✅ **2026-08-15 09:3xZ 达成**

      **⊕ 逐判据实测（2026-08-15 04:0xZ 核完实现与测试，09:3xZ 等到绿轮认证才勾）**
      ```
      判据1 只检测 harness 报错   SPEC_LIMIT_SIGNAL = "Subagent spawn limit reached"（inner-wakeup-heartbeat-check.ts:512）
                                  真接线：:518 spawnLimitDetected / :531 消费；大小写不敏感
      判据2 不自建计数（退役）     旧判据 blocked==[] && agentDispatches>=agentLimit 已退役，
                                  且按 AC58「退役即迁出」留了落点映射 archive/AC58-retired-clauses.md#R29
                                  ⚠️ 全文仍有 agentDispatches 5 处命中，逐条打印后确认全是 schema 字段校验（:105/:116 等），
                                     不是那条判据本身 —— 硬规则② 非零半边：命中的不是我要找的东西
      判据3 只报不动               测试逐字「report-only: the trigger is a pure boolean; it never /clears, lowers cap, or restarts」
      测试                        inner-wakeup-heartbeat-check.test.mjs 79/79 绿，含真样本回放
                                  （"Subagent spawn limit reached (200 of 200 agents spawned)"）+ 判据2 退役负控制
      ```
      **⊢ 勾选的门槛为什么拖了两轮**：我 04:0xZ 就核完了实现与测试，但坚持**等一个绿轮认证**——
      因为同日我刚在 AC62 上栽过「在主检出验绿就勾、而轮里那一半从不评估」。
      **本轮 round199 GREEN**（`verifiedCommit=47e09bab` · 4920 tests · 516.9s · failures=0 · 终态），
      且 `git merge-base --is-ancestor` 逐条核实该 commit **含我阶段1 的全部五条提交**
      （`635ec831`/`135fef12`/`5fe434c6`/`7302a6e2`/`0203c6ca`）⇒ **认证覆盖成立，才勾。**
      **人的原话**：「**agentLimit 的处理仅应包括检测 harness 的报错（报错后的处理暂定由人执行），而不要自己重复计数。**」

      **① 现状（读实现）**：`inner-wakeup-heartbeat-check.ts:347/:353` 的判据是
      `blocked==[] && agentDispatches >= heartbeat.agentLimit`——**一个自建计数判据**；
      而心跳现读 **`agentLimit = undefined`**（`agentDispatches = 15`）⇒ **该判据结构上恒假，从不报。**
      **② 但修法不是"把 agentLimit 写进去"**——那正是人禁止的「自己重复计数」，
      **且它是 4b 的形态：用我们自己维护的计数去判断一个由 harness 掌握的预算。**
      **③ 正确形态：检测 harness 自己的报错。** `CLAUDE.md:21` 已记识别法逐字：
      **目标会话 transcript 里搜 `Subagent spawn limit reached`**。

      **判据1（检测面）**：三层任一会话的 transcript 中出现 `Subagent spawn limit reached` ⇒ **报**（写进 tick-log 升级列）。
      **判据2（退役自建计数）**：`agentDispatches >= agentLimit` 这个判据**退役**，
      **并按 AC58「退役即迁出」把它的理由与历史迁进 archive**——**不是留着不修**
      （留着 = 一个恒假的判据，与「一切正常」同形，硬规则 3b）。
      **判据3（不自动处置）**：**检测到只报不动**——人逐字「报错后的处理暂定由人执行」。
      **⇒ 明确不做**：不自动 `/clear`、不自动降 cap、不自动重启会话。
      **判据4（能取假）**：**回放一条含该串的真实 transcript 必须报红**；
      **若历史中尚无该串，则本判据【记为未验证】而不是勾**（硬规则 3b：「没有真样本」不得与「验证通过」同形）。

      **⚠️ 不覆盖**：不估计上限数值（CLAUDE.md 明写「数值随 Claude Code 版本变，正本在
      `tasks/gap-inner-subagent-budget-invisible.md`」）；不区分两个易混旋钮（会话累计 vs 并发）——
      **本条只管累计触顶的检测，并发那一半是 AC76。**

      **⭐ 与 AC76 的关系（必须写明，否则会被合并处理）**：**这是两个不同的稀缺资源**——
      `AC76 = 并发 subagent 数（cap=5 管它）`；`AC77 = 会话累计 spawn（harness 管它，触顶后静默降级为主线程串行）`。
      **后者触顶的表现与「inner 主线程在跑 fan-in」在现象上一模一样**，正是今天我几次差点误诊的形状
      （CLAUDE.md:21 逐字：「三层 + 人共花数小时反复误诊为『outer 不派发』『inner 自锁』『唤醒链断』，全错」）。

- [ ] **AC78（fan-in 走 workflow；A6 从「步骤清单」改为「检查 workflow 是否被执行」—— 人 2026-08-14 08:3xZ 裁定）**
      **人的两句**：「**应当创建和维护模板**」「**如果用 workflow，A6 就应该改为检查是否执行了 workflow。按这一方案执行。**」

      **① 为什么是这个方案（今天查实的三条事实）**：
      ```
      任务 subagent 的 prompt 无模板   四条特征串（"You are implementing task" / "DO NOT flip status" /
                                       "worktree-isolated background subagent" / "Report back"）仓库【零命中】
                                       谓词已干跑（fan-in-ts-typecheck-gate 同法命中 12 文件）⇒ 真零
      inner 执行核 A15 不规定其内容     只规定「派不派」（Touches 正交/依赖/disjoint/fork 基线/self-touch）
      inner 会话 Workflow 调用 = 0     它从未走过这条路
      ⇒ prompt 靠【复制上一次】生成 ⇒ A6 改了三次（AC62/AC67/AC75），prompt 一次没跟着改
      ⇒ 六次 fan-in 全带 pre-AC67 的「DO NOT flip status. DO NOT merge.」（08:08:00Z 那条逐字可查）
      ```
      **⇒ 根因是【模板在记忆路径上】。人的方案是把它搬到执行路径上。**

      **判据1（步骤迁入 workflow，A6 只留检查）**：fan-in 的四步（`git merge develop` → delta 判定/全量 suite →
      doc 检查 → flip done + `fan-in-ff-merge.sh`）**正身迁入一个 workflow 脚本**；
      **A6 改为「fan-in 必须经该 workflow 执行」+ 本轮判据**。
      **按 AC58「退役即迁出」**：A6 旧正身（步骤清单）**不得直接删**，迁进 `orchestration/archive/` 并给**落点映射**
      （落点 = 该 workflow 脚本的对应段落）。

      **判据2（能取假·两层，缺一不可）**：
      ```
      (a) 每次 fan-in 必须有一次对应的 Workflow 调用记录
          读法：meta-cc query_session_content role=tool tool_name=Workflow（第三方可读，非自述量）
      (b) 每次 fan-in 必须在 fan-in-merge-lock-events.jsonl 留 ≥1 条（带 agentId）
          ⚠️ 必须带时间边界：只统计【该 workflow 落地之后】fan-in 的任务
             —— 否则会把之前的 fan-in 一并算进差集、稳定过计、天天报红
             （我 2026-08-14 算这条时就过计过：13−1=12，真值 6）
      差集非空 ⇒ 红，并列出差集任务名
      ```
      **(a) 管「有没有走 workflow」，(b) 管「走了有没有真的 ff」——只有 (b) 会漏掉"绕过 workflow 但手工 ff"的情形。**

      **⊕ 2026-08-15 00:4xZ 裁定（我提的反例 `7e64a86b` 结案：定义域之外，⛔ 不记入判据2 差集）**

      **来历**：我 2026-08-14 23:1xZ 报「inner 的 AC81 doc-only 落地走的是 `fan-in-ff-merge.sh` 而非本 workflow」，
      挂起不勾不报违规，待读 `fan-in-execute.js` 的适用条件。outer 00:3xZ 核完判 **(c) 违规**，建议记入差集。
      **我核完的结论：三点，其中两点推翻 outer，一点推翻我自己。**

      **① outer 的结论对，但它给的证据是【结构上不可能取假】的（硬规则4）**：
      「`7e64a86b` 不在 `fan-in-merge-lock-events.jsonl`」——**该载体里根本没有 commit sha 字段**。
      对真样本干跑（硬规则② 零计数半边）：`{event,ts,epoch,taskId,pid,runId,agentId}`，**七个键无一为 sha**
      ⇒ 拿任何 commit sha 去 grep 它，**恒为 0，包括真的持过锁的那些**。
      **能取假的读法是【时间窗】不是 sha**：`22:30:18Z → 23:49:07Z` 之间零条锁事件，而该 commit 在 `23:43:28Z`
      ⇒ **确实没持锁**。结论存活，**证据形式必须换掉**——否则下次同法会把一个持过锁的 commit 也判成没持锁。

      **② 分类不是 (c)，是【不在判据2 的定义域内】——因为它根本不是一次 fan-in**：
      ```
      git log -1 --format='%P' 7e64a86b   ⇒ 单亲 4168cf1b（无 merge）
      git show --stat                     ⇒ plugin/skills/init/SKILL.md | 1 +（一个文件一行）
      tasks/gap-ac80-anchor-prompt-consumer-path-fix.md ⇒ status: ready，且 git ls-files 为空（未跟踪）
      ```
      **⇒ 没有任何任务落地。** 而判据2 的差集**按任务算**（原文：「列出差集任务名」）⇒ 它不进差集。
      **结构佐证**：`.claude/workflows/fan-in-execute.js:44` `if (!task || !worktree || !root) return {outcome:'bad-args'}`
      ⇒ **无任务的写入根本走不了这个 workflow**。「该走没走」的前提是它走得了。
      **⇒ 记入 AC78 差集会是硬规则⑧ 的形态**：把另一类违规塞进一个不覆盖它的判据，
      **此后 AC78 的差集就不再是「fan-in 有没有走 workflow」的干净读数**——为了记一次违规，毁掉一个判据的可读性。

      **③ outer 关于例外的那半条【成立】，我照读源码确认**：`doc-only-delta` 分支在 **step 4**，
      位于 step 1（merge+anti-drift）/ step 2（delta 判定）/ step 3（ts-typecheck 闸）**之下游、workflow 之内**
      ⇒ 它只授权「跳过全量 suite」，**从不授权「跳过 workflow」**。**⇒ 可能性 (a)「doc-only 是合法例外」证否。**

      **④ 推翻我自己的那一点**：我原话说它「走的是 `fan-in-ff-merge.sh`」——**同样没有**（该窗口零锁事件）。
      那句是我**照抄 inner 的自述**而未核，判准② 的标准形态（陈旧/自述当现状）。**记账。**

      **⇒ 对 AC78 的净效果**：反例消解，**判据2 未被它证否**；但 AC78 仍不勾——判据1/3/4/5/6 尚无我核过的读数。
      **⇒ 分出一个观察项（⛔ 不加条款，硬规则⑫：我给不出这一类的发生率）**：
      **「直接提交 develop、不经任何 fan-in 机件」的写入，AC78 判据2 结构上看不见它**——
      `7e64a86b` 绕过了 ff-lock / anti-drift-touches / AC 完成闸三道，且不进任何差集。
      **归属不是 AC78，是 11b「盘上状态即生产输入」那条线**（outer 的 C17 / 越权直改面）。

      **判据3（M176 陷阱写进 A6）**：**workflow 一律以 `scriptPath` 调用，禁用 `name:`**。
      `CLAUDE.md` 逐字记着：同一会话内第二次 `name:` 派发**可能取到旧脚本体**，即使文件已改并提交。
      **⇒ 不写死这条，我们会在「模板已更新」与「实际用的是旧模板」之间再造一个同形的洞。**

      **判据4（双副本同改）**：A6 的改动**必须同时落两份**
      （`orchestration/fast-mode-tick-core.md` 与 `plugin/loop/fast-mode-tick-core.md`）——**同 AC73 判据4**。

      **⚠️ 一个必须一并记的位移（不阻塞，但不能不写）**：
      步骤正身迁入 workflow 之后，**协议的设计正本 `SPEC-fan-in-ff-merge-lock-2026-08-14.md` 与 workflow 脚本
      之间又成了一对「规格 vs 实现」**。**但它与今天这个洞【不同级】**：
      ```
      今天的洞   prompt 是 A6 步骤的【副本】，两者都在执行路径上 ⇒ 副本漂移 = 执行漂移（六次实证）
      迁入之后   workflow 脚本是【唯一实现】，没有第二份可漂 ⇒ SPEC 与它的分歧只是文档漂移
      ```
      **⇒ 前者是执行缺陷，后者是文档缺陷。不要用同一条判据管**（同我裁 B15 不并 AC73 的那把尺）。
      **但仍须留一条弱判据**：改 workflow 的提交必须在提交信息里点名它对应 SPEC 的哪一节，**否则下一个人无从对照。**

      **⚠️ 一个必须先定的前置（否则模板绑错一份）**：**A6 现有两份副本，且两份都逐字写着「本文件不接锚」**
      ⇒ **该声明因被复制到两边而失去识别力**（硬规则 4：靠复制而恒真的声明携带零信息）。
      **⇒ 建 workflow 前必须先定「哪一份是正本」，并把另一份的头部改成不对称的表述**
      （一份写「本文件是正本」，另一份写「本文件是 `<路径>` 的落地副本，勿单边编辑」）。
      **不定这一条，下一次单边编辑会把今天这个洞在更深的位置重造一次。**

      **判据5（`/clear` 后行为稳定 —— 人 2026-08-14 08:4xZ 追加的一般原则）**：
      **人的两句逐字**：「**不要担心 spawn limit。人会处理超限后的 `/clear` 操作。关键是保障 `/clear` 操作后的行为稳定性
      （已知 subagent 和 workflow 都可以跨 `/clear` 持续）**」「**subagent / workflow 的独立上下文是优势。应利用这一特性实现更稳定的行为。**」

      **⇒ 这条把 AC78 的理由从「防漂移」升级为「防清空」，且它给出一个可当场检验的判据**：
      ```
      设想 inner 此刻 /clear ——它还能正确派发吗？
        今天的答案：不能。prompt 无模板、无脚本、无执行核条款，只存在于【复制上一次】的惯性里；
                    /clear 之后连"上一次"都没有了。
        AC78 之后：能。prompt 由 workflow 脚本生成，脚本在盘上、由 scriptPath 调用。
      ```
      **⇒ 判据5 = 「本 workflow 所需的一切（模板文本、参数来源、调用方式）必须全部落在盘上的脚本与锚可达的文件里；
      不得有任何一项依赖会话记忆」**，判定法即上面那个设想：**逐项问「/clear 之后这一项还在吗」。**
      **这不是新规则，是既有规则的一次具体应用**——`plugin/loop/fast-mode-loop-tick.md:9` 与
      `orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md:86` 逐字：
      **「凡是必须跨压缩存活的东西，必须落在锚所指向的文件里」（ADR-009 第二次修订）。**
      **⇒ 今天这个洞正是那条规则的一次违反，只是违反的对象是 prompt 而不是执行核本身。**

      **判据6（利用独立上下文，不只是躲开它）**：人「**独立上下文是优势，应利用这一特性实现更稳定的行为**」
      ⇒ **workflow 内 subagent 的 prompt 应当【自足】**：不引用「上一条消息」「协调者说」「见上文」这类
      依赖调用方上下文的措辞。**今日实证两条，都是这类引用出的错**：
      ```
      AC73  brief 逐字嵌了 inner 自己的会话 id ⇒ subagent 照抄 ⇒ --agent-id 填成会话 id
      AC72  subagent 从 AC67 任务体判据4 的【示例串】里取 id ⇒ 示例恰好是真实会话 id ⇒ 同样填错
      ```
      **⇒ 判据：prompt 里凡需要 subagent 的自身标识，一律写成【让它自己去找】的指令
      （定位 `subagents/agent-<自己>.jsonl`），不得由调用方填值、也不得给可被误抄的示例值。**
      **AC67 那次填对了，正因为它是自己找的。**

      **⚠️ 不覆盖**：不规定 workflow 的脚本名与内部结构（实现面，同本仓 SPEC 惯例）；
      不改 fan-in 协议本身（AC62/AC75 已定）；不引入新的 subagent 计数（人 08-10 与 08-14 两次裁定禁止）；
      **不为 spawn limit 做任何自动处置**（人：超限后的 `/clear` 由人执行）。

      **归属**：`plugin/loop/` 与 `.claude/workflows/` 均**不在 manager 编辑边界内** ⇒ **实现归 inner，任务体归 outer**；
      manager 只出本 AC 与判据。

**本阶段【不新建】过程纪律型 AC**：负控制/隔离自证沿用**既有的 AC49**，**不另起编号**
——同一义务两个编号就是硬规则⑧ 的变体（编号复用把缺席伪装成在场），
且人已明确担心「搞出无尽的新任务新条件」。

**⚠️ 不覆盖（SPEC §7 逐字搬入，防止实现时扩面）**：
①**不改 disjointness 的地位**——它是**安全约束**不是偏好，优先级不得越过它；
②**不引入人工打分或新的 `priority` 字段**——当日已证"没有读者的字段等于不存在"；
③**不要求 inner 解释每一次不选**；④**不规定倾向文件的具体路径与格式**。

**归属**：**manager** 定义要什么/怎么判 + 维护倾向文件的覆盖段；**outer** 立案·排序·派发·验收；
**inner** 实现 + 产出派发记录；**人** 方向裁定。
**⇒ 我不写任务体（§0 边界）**：本阶段四条 AC 的立案由 outer 执行。

**当前阶段勾选表（AC54–AC64）**：见各条复选框（AC54/AC59/AC60 已勾）。
**AC62–AC64 于 2026-08-14 02:4xZ 由人裁定加入**（正本 `SPEC-fan-in-ff-merge-lock-2026-08-14.md`）。
**顺序（人裁定「先做通则」）**：**AC58/AC59/AC60（通则）→ AC61（逐条）**；AC54–AC57（语义派发）**并行不受阻**。

---

## ⚡ 关键路径（人 2026-08-14 05:1xZ 逐字：「优先推进」）

**人问的两件事，现读答案都是「没有」**：
```
cert 退役了吗？               没有   AC72 = todo，未派
subagent 在跑 suite+merge？   没有   AC67 = ready，未派
```

**唯一的关键路径，且它是一条【串行】链**：
```
AC63 fan-in 上 develop      ← 当前唯一阻塞点。AC63 subagent 已 done 31/31，分支 head 04:55Z，尚未合
   ↓ 解锁（Touches 重叠解除）
AC64（precommit-guard ② 退役） + AC67（执行者搬进 subagent）   ← 二者可并行
   ↓ AC67 落地
AC72（cert 宣告退役 + 结果第三方可读落盘）
```
**为什么是串行**：outer 现读 `slot-refill` **`should_refill=false`、`recommended=[]`，硬理由「无候选过 step-4」**
——**AC64/AC67 与在飞的 AC63 `Touches` 重叠**；AC73/AC66 与在飞的 AC69 重叠。
**⇒ 不是没人派，是机械判据算出「无可派」，而解除它的唯一动作就是 AC63 的 fan-in。**

**派发优先级（manager 裁定，写死）**：**AC63 fan-in > AC64/AC67 > AC72 > 其余**。
**AC73/AC66 让路**——它们不解锁任何东西；**AC69 已 done（`4df5ce53`，05:16:20Z）**。

**⚠️ 一条必须同时解决、否则 AC67 落地即失效的事**：**`develop` 上两份 fast-mode 执行核的 A6 说相反的事**
（`orchestration/…` = 新协议「无锁段+持锁段」，`plugin/loop/…` = 旧「串行」；两份都逐字写着「本文件不接锚」
⇒ **该声明已因复制而失去识别力**，硬规则 4）。**AC67 的判据1 是「A6 主语改掉、`git -C <wt>` 形态消失」——
若两份不对齐，判据无法判定它改的是哪一份。** 已投两层，止损定为「需要，当下动作 = 两份 A6 对齐」。

**本节的验收就是人那两个问题**：**下次被问「cert 退役了吗 / subagent 在跑 suite+merge 了吗」，
答案必须能用直接量给出**——`AC72 status`、`AC67 status`、两份 A6 的 A6 主语、
以及 AC72 判据2 那条第三方可读的 per-task suite 记录。**不接受用 `phase` 自述量回答。**
**分子只数 `[x]`**；**AC49（过程纪律型，上一阶段遗留）按既有规则单列、不进本阶段计数**。

---


## 归属与边界（不变）

- **manager**：定义要什么、怎么判、提供实测基线与反例；**不写实现代码**（AC5 不变）。
- **outer**：立案、排优先级、派发、验收。
- **inner**：实现。
- **人**：方向裁定（本阶段两条方向即由人 2026-08-13 裁定）。

**manager 本阶段的具体活**：每 tick 采样 AC42-AC48 的可机械读判据、维护 SPEC 的实测基线段、
并在自己的判定里先做到 AC49 那三条。

---

---

## 交叉标注（机械读者读【本文件】，不读 archive —— 2026-08-14 拆分后补回）

**为什么在这里**：`plugin/test/semantic-observer-judge.test.mjs:345` 与 `red-on-omission-audit.test.mjs`
**把本文件当承重面读**（`fs.readFileSync(... "manager-phase-goal.md")` + `assert.match`）。
2026-08-14 10:4xZ 的拆分把正文搬去 archive ⇒ **两条断言从 archive=1 / 现行=0 变红**。
**⇒ 落点映射漏了【机械读者】这一类，见下方教训。**

- **`gap-semantic-observer-judge-stopped-awaiting`**（AC40 / AC41③ 交叉标注）——
  语义观测器的 schema 字段只承载预先想到的需求类型，真实需求溢出到自由文本；
  与本阶段 AC41「红在遗漏上」同源：**没写的东西不产生红**。
- **`gap-ac41-red-on-omission-artifact`**（AC41 产物）——
  遗漏必须有产物才可核；与上一条互为对方的交叉标注。

**⚠️ 本次拆分学到的（硬规则 5 的一个未覆盖面）**：
**落点映射只验了【人类读者】的词条有没有家，没验【机械读者】把哪个文件当输入。**
**⇒ 删/搬任何文档前的必做动作**：`grep -rl "<该文件名>" --include=*.ts --include=*.mjs --include=*.test.mjs plugin/ scripts/`
——**谁 `readFileSync` 它、谁 `assert.match` 它，一条命令就能枚举**；
抽查词条有没有正本**查不出这个**（本次三条红全部来自同一次拆分，而我的映射一条都没提到它们）。

---

## 🆕 AC79–AC82：三层唤醒锚统一为 CronCreate（人 2026-08-14 14:2xZ 逐字裁定「把三层统一应用 CronCreate 加入本阶段的目标和 AC，包括你上面的建议的配套工作。推进。」）

**为什么现在做（三条实测，不是偏好）**：
```
① ScheduleWakeup 没有外部可核证据，CronCreate 有（CronList + 注册表收据，manager 已连续 17 轮核实）
   代价实证：2026-08-14 07:41:46 inner 切驱动模式 ⇒ ScheduleWakeup 链断 ⇒ 自驱死 4.7 小时，三层加人一起误诊整个上午
② ScheduleWakeup 事实上不是 inner 的驱动源：今日 169 次调用 delaySeconds 全为 1500（25min），
   而实际唤醒间隔 0.6–11 分钟 ⇒ 真驱动是 task-notification，ScheduleWakeup 是从未真正触发的兜底
③ CronCreate 也不免费：CronList 文档写明 "scheduled via CronCreate in this session" ⇒ 会话作用域，会话没了它也没了
   ⇒ 光换机制不补配套 = 把一个不可核的机制换成另一个（outer 现状：有 cron，无正本/无注册表/无收据）
```
**当前三层实测（2026-08-14 14:1xZ，meta-cc 动作记录）**：
```
manager  CronCreate */17  + prompt 正本(git) + 注册表收据 + 每轮四判据核实
outer    CronCreate */20  + 无正本、无注册表、无收据
inner    ScheduleWakeup 169 次/天，零 CronCreate
```

- [x] **AC79（inner 加 CronCreate 锚；ScheduleWakeup 降为间隙加速器）** ✅ **2026-08-14 21:5xZ 达成，逐判据实测如下**
      **判据1 ✅**：`query_session_content(session_id=bc1a438b…, tool_name=Cron)` ⇒ `CronCreate {"cron":"7,27,47 * * * *"}` @ `2026-08-14T15:14:11.979Z`
      —— **直接量**（inner 自己的 tool_use 记录），不是注册表自述（后者正是 `gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes` 批评的形态）。
      **立案时真值 0 ⇒ 现 1**，该判据确实能取假。
      **判据3 ✅**：该 prompt 正文开头 =「不要依赖上下文记忆——本 prompt 只是指针，内容现读：(1) 读 `orchestration/fast-mode-tick-core.md`…」⇒ 与 manager 锚同形。
      **判据2 ✅（保留）**：`plugin/loop/fast-mode-loop-tick.md:1164/:1171/:1187` 仍在用 ScheduleWakeup 作兜底心跳（1200–1800s）⇒ 未被删。
      〔**未逐字核**：核里是否有一句明写「不是唯一唤醒源」——保留这一半已实测，措辞那一半归 inner 自查〕
      **判据1（能取假）**：`meta-cc query_session_content role=tool tool_name=CronCreate session_id=<inner>` **返回 ≥1 条**；
      当前真值 **0** ⇒ 该判据此刻为假，不是恒真。
      **判据2**：inner 核里明写「ScheduleWakeup 不是唯一唤醒源」，且**保留**它作事件间隙加速器（⛔ 删除——它对 event-driven 段仍有价值）。
      **判据3（防倒退）**：inner 的 CronCreate prompt **不得**要求「读上下文记忆」，须与 manager 锚同形：**只放指针**。
      **负控制归落地方**（D2：manager 不构造）：删掉 cron 后 `CronList` 应变空 ⇒ 核实步骤须报假。

- [x] **AC80（三层各有 git 跟踪的 prompt 正本 + 不变式检查器）** ✅ **2026-08-14 22:1xZ 达成**（inner 侧 `8e833277` 落地后）
      **判据1 ✅ 三层齐**：manager `orchestration/manager-tick-prompt.txt` · outer `orchestration/outer-tick-prompt.txt` ·
      **inner `plugin/loop/fast-mode-loop-tick.md:1207/1214/1216` 的 `AC80-INNER-ANCHOR-BEGIN/END` 段**
      （**按【段】查，不按文件查**——这正是我 21:5xZ 判错的那一点）。
      **判据3 ✅ 逐字节**：inner 原始记录 `.quay/inner-tick-log.jsonl` `22:03:38Z` ⇒ `byteCompare 815 bytes exact, evaluated=true`，
      sha256 `9a044b01…` 与注册表一致；outer 侧 `orchestration/tick-log.md:1301` A23 首跑通过。
      **⚠️ 证据形态说明（结构性上限，写明以免后人误读）**：活 `CronList` 只有该层自己的会话能产出
      ⇒ manager 的核实止于**读各层自己的 tick-log 载体**（原始记录，非自述——判准②e），⛔ 不是「他们说了」。
      **⊢ 我自己的一条自纠**：我跑 `outer-anchor-check --layer inner` 得 `evaluated=False`，
      **那是我没喂活 prompt**（`canonicalBytes=815` 而 `liveBytes=-1`）⇒ **先验检查器的输入，再解释它的结论**。
      **判据1**：三层各有一个 git 跟踪的 prompt 正本文件；**当前真值 manager ✅（`orchestration/manager-tick-prompt.txt`，571 字符）/ outer ❌ / inner ❌**。
      **判据2**：各有一个检查器，能在正本被改坏时报假（manager 现有 `orchestration/manager-anchor-check.py`，实测负控制：删掉指向核的那行 ⇒ 报「缺指向 manager-tick-core.md」）。
      **⚠️ 判据3（本 AC 的真正难点）**：**正本文件与真正投进 CronCreate 的字符串必须一致**——
      两者是两份副本，**而副本会漂**（今日 14:0xZ 实测：`manager-loop-tick.md` 的豁免面副本在人裁定后立刻过期，且**审计读的正是那份副本**）。
      ⊢ 检查器须比对**正本内容**与 **`CronList` 返回的 prompt**；只查「文件存在」不算。
      **⊢ 2026-08-14 21:5xZ 核实（三判据分开结论，⛔ 不合并成一个「基本完成」）**：
      **判据1 ⚠️ 部分（21:5xZ 我判 ✅ 是错的，22:0xZ 由 inner 的首跑核实推翻，此处更正）**：
      manager ✅（`orchestration/manager-tick-prompt.txt`）· outer ✅（`orchestration/outer-tick-prompt.txt`，已跟踪）·
      **inner ❌**——`outer-anchor-check --layer inner --json` ⇒ `"MISSING-正本（提取标记未找到）"`、`byteCompare.evaluated=false`；
      `grep -nE 'AC80|inner-tick\]|prompt 正本' plugin/loop/fast-mode-loop-tick.md` ⇒ **0 命中**。
      **⊢ 我错的形状（值得单记，因为它绕过了判准③b 的假阳性半边）**：我查的是**文件**存在
      （`git ls-files` ⇒ `fast-mode-loop-tick.md` 1481 行，古老且必然存在），而该落地的是文件**里面的那一段**。
      **⇒ 数容器冒充数内容**——与收件箱那次（目录 64 封 `.md`、工具只认 JSON ⇒ 读成零）同形，硬规则 5。
      **⇒ 判准③b「引用计数前先打印命中」我做了，但打印的是文件行数不是段落内容 ⇒ 打印对象错了，动作等于没做。**
      **⇒ 一般化：当落地物是「某文件内的一段」时，存在性判据必须落在【段】上，⛔ 文件存在不算。**
      **判据2 ✅**：`plugin/scripts/outer-anchor-check.ts`（442 行，含 `--layer inner|outer`，**退出码分三态 OK/VIOLATED/NOT-EVALUATED** ⇒ 硬规则 3b 已被实现方兑现）+ `plugin/test/outer-anchor-check.test.mjs`（378 行）。
      **判据3 = NOT-EVALUATED（不是不合格）**：检查器自述「**脚本无法调用 `CronList`，由调用方传入**」
      ⇒ outer/inner 的活 prompt **只有它们自己的会话能产出** ⇒ **结构上不可能由 manager 从外部核实**。
      **⛔ 因此本 AC 不勾**，且缺的不是实现而是**接线**（见 AC81 同日发现）。

- [x] **AC81（三层各有注册表收据 + 每轮四判据核实）** ✅ **2026-08-14 22:1xZ 达成**（三判据分开结论见下，⛔ 不合并成一句）
      **判据2 ✅（此前唯一落空的一条，22:0xZ–22:1xZ 两层先后接线）**：
      outer `b0e16183` 把两条命令接进 `orchestrator-tick-core.md` 的 A23；inner `8e833277` 接进 `fast-mode-tick-core.md` 的 A26（src:1218）+ loop 文档步骤。
      **⊢ 产物是逐判据输出行，不是「已核实」一句**——inner 原始记录 `.quay/inner-tick-log.jsonl`：
      `21:56:13Z` 首跑 ⇒ ①②③ ok / **④ NOT-EVALUATED（正本缺失）** / `verdict: NOT-EVALUATED (exit 2)`，**三态未压布尔**；
      `22:03:38Z` ⇒ `ALL OK`（④ byteCompare 815 exact）。**首跑就报了一个假**，说明该判据不是恒真读数。
      **⇒ 这条 AC 从「造好了但没人用」（AC73 家族）回到被执行，用时约 20 分钟**，链路是：manager 报零接线 → outer 接 → manager 发现 inner 侧仍零 → C17 裁定 → inner 落。
      **⊢ 遗留（不阻塞本 AC）**：`plugin/loop/manager-*.md` 是我的核的**漂了的副本**（84/331 行，diff 170/2321，停 08-13/08-12，37 个 reader），
      且 `tick-core-static-check.ts:146` 的配对**只列 tick-CORE ⇒ loop-tick 的 2321 行漂移结构上不可见**。
      **已裁定并投 outer**：⛔ 不改 C17 枚举（那是为自洽而藏事实）；正解是**指针化**让被争夺的对象消失，落地方 inner，
      AC 必带**落点映射（37 reader 逐个判读内容/提路径）**与**一个会取假的漂移判据**。**⛔ 我不申请扩大自己的豁免面。**
      **判据（四条全真才算）**：① `CronList` 恰一条 ② 其 id == 注册表记录的 `|cron:<id>|` ③ `--verify` 报 `registry-verified` ④ 锚点正本校验通过。
      **当前真值**：manager 连续 **17 轮**全真；outer/inner **无此机制**。
      **⊢ 能取假的实证**：2026-08-14 09:1xZ 我多传 `--home "$HOME"` 覆盖默认值 ⇒ 读成 `registry-missing` ⇒ 差点误报「88 轮 registry-verified 断了」
      —— **该判据会因为调用方式错误而报假，说明它不是恒真读数**。
      **⛔ 不得只在 tick-log 里写「已核实」**——那是纯自觉；产物是四条判据各自的输出行。
      **⊢ 2026-08-14 21:5xZ 核实——判据1 已达成，判据2 落空，且落空的形态值得单记**：
      **判据1 ✅**：`outer-cron-registry.ts --show` ⇒ `inner: cronId=025f4132 cronExpr=7,27,47 promptSha256=9a044b01… verified` /
      `outer: cronId=4e88cb1b cronExpr=0,20,40 promptSha256=d520ef85… createdAt=2026-08-14T15:21:19Z verified` ⇒ 两层收据齐备。
      **判据5 ✅**：剩余寿命 ≈ 6.8 天（>24h，不报）。
      **🔴 判据2 ✗（每轮四判据核实）**：`grep -c 'outer-cron-registry|outer-anchor-check'` 在
      `orchestration/orchestrator-tick-core.md` = **0**、`plugin/loop/fast-mode-loop-tick.md` = **0**
      ⇒ **两个检查器 442+502 行、两份测试 378+417 行全部落地，却不在任何一层的每轮步骤里被调用。**
      **⇒ 这是 AC73「造好了但没人用」家族的又一实例**（发生率 +1；前例：`checkSplitRecommendation` 零非测试调用者、
      `suite-state-trigger` 设计常驻却 28 小时没被拉起）。
      **⇒ 且它恰好是硬规则 ⑨ 的教科书形态**：judgement 有了、产物有了，**「守」与「不守」在记录上仍无法区分**，
      因为没有任何一轮会去跑它。**修法不是把 AC 写得更醒目，是把这两条命令写进两层执行核的每轮步骤**（归 outer/inner，manager 不改他们的核）。

- [x] **AC82（周期整除 60 且三层相位错开）** ✅ **2026-08-14 21:5xZ 达成，两判据我这里全可查、全真**
      **判据1 ✅**：manager `13,33,53`（`CronList` 活视图）· inner `7,27,47`（inner 自己的 CronCreate tool_use）· outer `0,20,40`（注册表收据）
      ⇒ **三层周期均 20 分钟，整除 60**；立案时的 `*/17`（间隔 17,17,17,9）已消除。
      **判据2 ✅**：minute 集合 {13,33,53} / {7,27,47} / {0,20,40} **两两不交**（模 20 的偏移分别是 13 / 7 / 0，互异）。
      **判据1**：三层 cron 周期均整除 60。**当前真值：manager `*/17` ❌ / outer `*/20` ✅ / inner 无 ❌**。
      **实测代价**：`*/17` ⇒ 0,17,34,51，**间隔 17,17,17,9**（51+17=68>59 折回）；manager 36 次实测 **平均 16.0 / 中位 15.9 / 最短 8.2 / 最长 28.6**。
      **⇒ 这是硬规则 4 推论二的一个实例**：一个看起来「约 17 分钟」的字面量，实际分布跨 8–29 分钟。
      **判据2**：三层相位错开（如 outer 0/20/40、manager 10/30/50），**⊢ 判据 = 三层 cron 的 minute 集合两两不交**。
      **理由**：同刻触发会叠加 develop 提交与 suite 负载 —— 今日实测 `load1` 在三层同时活动时冲到 **18.58**。
      **⚠️ 判据修正（2026-08-14 14:2xZ，读 CronCreate 文档后自我更正——原判据过度归因）**：
      平台自带 **抖动（recurring 最多迟 10% 周期，上限 15min）** 与 **「Jobs only fire while the REPL is idle」**，
      ⇒ 换周期只能修掉离散的**一半**：`⊢ 换周期后最短间隔应 ≥18 分钟`（折回消失，可取假）；
      `⊢ 最长仍可能 >20 分钟（抖动 + REPL 忙），【不】作为失败`。**把 8.2–28.6 整段归给 `*/17` 是我的过度归因。**
      **manager 侧已落地**：`13,33,53 * * * *` → `95354e09`（⛔ 不用 `10,30,50`——CronCreate 文档明示避开 `:00`/`:30`）；
      旧 `*/17`/`4cb71b69` 已删，收据已记，`--verify` 报 `registry-matches-cron`。**判据1 现真；判据2 待 inner 落地。**
      **⚠️ 同时发现的 7 天硬上限已并入 AC81**：`Recurring tasks auto-expire after 7 days` ⇒ 三层锚都会静默消失，
      **无任何提前预警** ⇒ AC81 判据加：核实须报【锚剩余寿命】，<24h 即报。

**⚠️ 归属与顺序（manager 只能改自己那条）**：
```
AC79 · AC80(outer/inner 侧) · AC81(outer/inner 侧)   → 归 outer 立案 / inner 落地
AC82 判据1 的 manager 部分（*/17 → 整除 60）          → 归 manager，但【必须在 quiet 窗口结束后】动
```
**⛔ 窗口内不得改任何唤醒机制**——2026-08-14 14:1xZ 起 quiet 窗口保护 ac63 的 ff，改锚会引入新的不确定性。

---

## 🆕 AC83：仪器的验收判据必须读【生产载体】，不能只读【测试绿】（人 2026-08-14 14:5xZ「也应保障落地可用，拿到真实数据」）

**触发它的实测（本轮查证，全部按位置）**：
```
gap-phase-boundary-differential-accounting  status=done  AC 5/5 全勾
实现 640ad48a  落地 2026-08-13T17:28:26Z
verification-round.jsonl 末轮记录          2026-08-13T16:19:54Z   ← 早于实现 68 分钟
167 轮中含 cpu_usec 的 = 0 ｜ psi 字段 = 一个都没有
⇒ 仪器落地后【一轮都没跑过】⇒ 5/5 全勾为真，而真实数据 = 0
```
**为什么没被发现**：那 5 条 AC 是被 **scoped 测试**（141/0 绿）满足的，
而测试通过 `QUAY_TEST_CGROUP_SCRIPT`（`full-suite-runner.ts:795`）**注入假 cgroup 数据**。
**⇒ 测试证明的是「能产出」，不是「已产出」。**

- [ ] **AC83（仪器类任务的验收补一条生产读数判据）**
      **判据1（能取假）✅ 2026-08-15 03:4xZ 已翻真**：`verification-round.jsonl` 中**含 `cpu_usec` 的轮次 ≥ 1**。
      **立案时 0/167 ⇒ 假；现读 12/179（`psi` 同为 12），最近三轮 `02:31:12Z` / `02:49:11Z` / `03:17:58Z` 全含**
      ⇒ **判据1 真**。**⛔ 不得用「测试绿」代替本判据** —— 这条判据从假翻真本身就是它能取假的证明。
      **✅ 2026-08-15 11:3xZ 现读更正：判据3 点名的那个缺口【已被生产追上】，AC 文本此前是陈旧的（判准②，方向对我有利）。**
      ```
      现读 fan-in-execute.js:115 区段：
        if command -v /usr/bin/time >/dev/null 2>&1; then
          /usr/bin/time -o /tmp/fan-in-suite-${task}.time -f '%U %S' bash scripts/test.sh
        …（不可用分支）suite_cpu_s=null + suite_cpu_source=not-wired   ← AC6「绝不写 0」的降级取值
      ⇒ 不再是裸 bash；:126 那个裸调用是【/usr/bin/time 不可用时的 fallback 分支】，按设计
      ⇒ :97 是 --for-task --allow-thin（scoped）、:150 是 --static-checks-doc，两者非全量，不该计 cpu
      生产载体实读（推论三：只数实现落地后的真读数，⛔ 不数 fixture）：
        .quay/per-task-suite-records.jsonl  38 条 / 20 个不同 taskId / mtime 11:16Z
        cpu_source 分桶 = {gnu-time: 7, not-wired: 28, None: 3}   ⇒ 真 cpu 读数 7 条
        cpu_time_s 非空非零 = 9 条，最早 2026-08-14T19:24:48Z，最晚 2026-08-15T11:16:09Z
      ```
      **⇒ 判据3 的点名缺口已消。** **⚠️ 但 AC83 本轮仍不勾**，剩余未验的是那个 worktree 可见性子问题：
      不经 `full-suite-runner` ⇒ **fan-in 的 suite 仍拿不到分相数据**；AC83 原文写死「两条任务必须一起完成」。
      **⚠️ 另有一条未验**：`verification-round.jsonl` 本身在 🔴 观察项的 gitignored 载体清单里
      ⇒ **它在一次性 worktree 里不存在**，读它的判据在轮内是否同样 NOT-EVALUATED，我尚未验
      （已写进 `gap-gitignored-carriers-absent-in-verify-worktree` 的 AC4，⛔ 不当已确认）。
      **判据2（推广，本 AC 的真正内容）**：**任何以「产出某读数」为目标的任务，其 AC 必须至少有一条读【生产载体】**——
      形如「载体中满足 X 的记录数 ≥ N」，且 **N 必须在【实现落地之后】的时间窗内计**。
      **⊢ 反例判据**：若一条 AC 只能被 fixture/注入数据满足，它就不能作为该任务的完成依据。
      **判据3（覆盖面，与 `gap-fan-in-suite-data-not-accounted` 交叉）**：
      仪器写在 `full-suite-runner.ts` 里，而 **fan-in 走裸 `test.sh` 不经 runner**
      ⇒ 即使 runner 再跑，**fan-in 的 suite 仍然拿不到分相数据**。
      **⇒ 两条任务必须一起完成才算「拿到真实数据」；单独完成任一条都不满足人的要求。**

**⇒ 一般形态（与 C29 同族，但更精确）**：
**C29 说「执行了、报了、但没留痕 ⇒ 与没执行同形」；本条说「实现了、测试绿了、但生产里没跑过 ⇒ 与没实现同形」。**
**两者的共同修法都是【把判据挪到产物上】** —— 前者要求 REFUSE 也写载体行，后者要求 AC 读生产载体行数。

---

## 🔭 观察项（⛔ 不立条、不作阻塞前置）：**义务的可靠性由【到外部触发点的跳数】决定，不由载体是散文还是 workflow 决定**

**立此观察项的裁定**：人 2026-08-15 02:3xZ 提出两条路径（① 同一份清单配两套有差异的检查：查 arm / 查执行；
② 更机械的驱动 + 更短更不易漂移的上下文，如 CronCreate 直接驱动 workflow/subagent）。本节是应其要求记录的分析。
**⛔ 按硬规则⑫ 只记观察项**：发生率有（下表 5 个点），但「因此出了几次错」的代价读数给不出 ⇒ 不够立阻塞条款。

**⚠️ 本节推翻了我 2026-08-15 02:2xZ 自己给出的一句话，更正在先**：我说「workflow 单点不再静默，是因为 A9」。
**查实为假**——A9 的每轮覆盖率 **≤5/33 = 15.2%**（上界，那 5 次 meta-cc 调用未必都是 A9 那条）。
且 `A9` 只写在 `manager-tick-core.md:24`，而该文件窗口内 `Read` **0 次**；`.claude/workflows/manager-tick-core.js` 里
`grep -c 'A9'` = **0**（干跑对照：同脚本 `A1` = 2）⇒ **A9 既不在我读的文件里，也不在 workflow 的返回里。**
**它没被发现没在跑，是因为它的检查对象（B1）一直 100% ⇒ 它从来没有东西要报**
⇒ **一个不运行、且即使运行也只输出 OK 的检查，与一个正常运行的检查，在记录上完全同形**（硬规则 3b 的镜像）。

### 读数（2026-08-14 13:10Z → 2026-08-15 01:43Z，会话动作记录，非自述）

| 义务 | 层 | 到外部触发点的跳数 / 是否绑在必做动作上 | 每轮覆盖率 |
|---|---|---|---:|
| B1 调 workflow | manager | **0 跳**（prompt 到达即触发的第一个动作） | **33/33 = 100%** |
| A1 `manager-anchor-check.py` | manager | 1 跳，绑真钟/哨兵 | **33/33 = 100%** |
| 收尾0 `manager-arm-loop.sh --verify` | manager | 1 跳，绑哨兵核实 | **32/33 = 97%** |
| 步骤 0b 判准主题词 | manager | 1 跳，**物理并进**每轮必跑的 `date -u` 同一条命令 | **4/4 = 100%** |
| A23 `outer-anchor-check.ts` | outer | 1 跳，**独立一条**，无绑定 | **8/13 = 61.5%，末 5 轮连续 0** |
| A9 判 B1 是否执行 | manager | 1 跳，**独立一条**，且不在任何每轮到场的载体里 | **≤5/33 = 15.2%** |

**n=6，方向一致，无反例。**

### 三条结论

**① 递归只终止在【不在这个上下文里】的东西上。**
今天的链是 `B1 → 返回清单（含 A9）→ A9 检查 B1`：**B1 没被调 ⇒ A9 也不在场 ⇒ 没有任何东西发现 B1 没被调。**
这正是 2026-08-14「停调 workflow 19 小时、事后清点出 8 条违规」那次的形状，**且它今天仍然完整存在**。
⇒ **「两套检查」若都在同一份会漂移的清单里，成本翻倍而可靠性不变。**
系统里今天只有两类东西在上下文之外：**(a) cron 每轮重新投递的 prompt 文本**（结构上不可能漂移——它不依赖记忆）；
**(b) 另一层**（outer 查 inner 心跳 A13 = 38/38；manager 查 outer/inner）。**⛔ 注意：没有任何一层查 manager，只有人。**

**② 可靠性随跳数单调衰减，而不是随载体类型变化。**
B1（0 跳）100% 与 A9（1 跳、无绑定）15% **同在 workflow 的保护下**，差 6 倍
⇒ **workflow 保证清单到场，不保证清单被执行**；它的价值是把 N 条义务压成 1 跳，压不掉返回清单里的每一条。
**⊢ 能取假**：若本条成立，「绑在必做动作上的义务」覆盖率应显著高于「独立的一条义务」。
上表 6 点全部一致；**立条需要一个反向样本（并进必做动作却仍衰减的义务），目前没有。**

**③ 可迁移的做法不是「改用 workflow」，是【把义务挪到 0 跳，或物理并进一个必然发生的动作】。**
已有两个成功样本，共同点不是用了 workflow/subagent：
`fan-in-execute`（AC78，四步正身进脚本 + subagent 空上下文执行，A6 退化成检查；人 08:4xZ「subagent/workflow
的独立上下文是优势，应利用这一特性实现更稳定的行为」）· 步骤 0b（物理并进 `date -u` 同一条命令，4/4）。
**反例形态**：outer `71b91799` 用一条散文（「A23 是写 tick-log 的前置」）表达融合 ⇒ 顺序约定要生效得先记得有这条约定
⇒ 未改变跳数，且全仓 0 个机件认识 `A23`（干跑对照 `B13`=4 / `A13`=4）。

### 路径 ② 的三条已知代价（人提的 CronCreate→workflow/subagent 方向）

1. **subagent 预算是会话级累计硬上限且静默降级**（正本 `tasks/gap-inner-subagent-budget-invisible.md`）：
   实测燃烧率 ~60 次/天 ⇒ 默认额度约 3 天。**tick 全面 subagent 化会显著加快燃烧，而触顶后无声退回主线程串行**
   ⇒ **等于把一个已知的漂移换成一个未知的悬崖**，且三层执行核都不写这件事。**上这条路径前必须先算这个预算。**
2. **`name:` 派发取旧脚本体（M176）** ⇒ 必须 `scriptPath`；resume 缓存看不见外部文件改动。散文核没有这两个坑。
3. **args 是漂移的回流口**：manager B1 传的 `prior:<本轮读数差异>` 由长上下文组装
   ⇒ **执行搬走了，输入还在漂**。⇒ args 应尽量是机器可算的（任务 id / worktree 路径 / runId），不是主上下文的总结文字。

### 我据此要做的（manager 自身，均在豁免面内）

- [ ] **把「第一步调 `Workflow({scriptPath: .claude/workflows/manager-tick-core.js})`」写进 `manager-tick-prompt.txt`**
      —— 现读该正本 `grep -c 'Workflow'` = **0**，它只说「读 `manager-tick-core.md` 拿本轮步骤」
      ⇒ **系统里唯一每轮重新投递、不受漂移影响的文本，没有承载那个 0 跳动作**。
      **成本**：一次 `CronDelete`+`CronCreate`（有零-cron 窗口，见 `manager-tick-closing.md` 第 0 步的理由）
      + 正本更新 + `--record-cron`（AC80 判据3 要求正本与活 prompt 逐字节一致）⇒ **挑安静窗口做**。
- [ ] **把 A9 从「独立一条」改成 B1 返回后的第一个动作**（`.claude/workflows/manager-tick-core.js`，我的豁免面）。
- [x] 本观察项记录（本节）。

---

## 🔴 观察项（2026-08-15 03:2xZ，**已达立案门槛**，归 outer 立案 / inner 落）：**接了线、每轮跑、但输入在轮的环境里结构上不存在的检查器**

**这比 AC73「造好了但没人用」更贵**：零调用是**已知的空白**；**本形态每轮都跑、每轮 exit 0、套件绿**
——**记录上看起来它正在守护，而它连输入都没有。**（同 CLAUDE.md 硬规则 3b③ `outer-tick-log-check` 恒绿那条，换了成因。）

**⊢ 根因（读实现 + 实跑对照，非推理）**：
```
验证轮跑在一次性 worktree      full-suite-state.json 现读 oneShotWorktree: true
                              full-suite-runner.ts:2300-2301  root = provisionOneShotWorktree(root)
而多个检查器的输入是 gitignored 运行时载体 ⇒ 该 worktree 里【不存在】
```
**⊢ 逐个查证（`git check-ignore -v`，谓词已双向干跑）——`scripts/test.sh` 里被 @static-object 声明的 `.quay/` 载体**：
```
GITIGNORED（worktree 里不存在）：fan-in-merge-lock-events.jsonl · per-task-suite-records.jsonl ·
                                verification-round.jsonl · task-file-violation-ledger.jsonl · checker-cost.jsonl
tracked：full-suite.lock.0 · full-suite.log.
```
**⊢ 两个实测实例（同一命令、同一参数，只换 --root）**：
```
fan-in-workflow-check（AC78 判据2）  主检出 ⇒ ok=false 差集=[gap-ac81-inner-verify-wiring]
                                    worktree ⇒ ok=true evaluated=false "nothing-to-judge"
fan-in-ff-protocol-check（AC62 判据2）主检出 ⇒ 四子检查全 evaluated=true
                                    worktree ⇒ suite-in-lock evaluated=FALSE；lock-hold-only-ff 整条缺席
```
**⇒ 直接后果**：AC62 已因此撤勾（判据2 半覆盖）；**AC78 判据2 的差集（含今晚那条 `gap-ac81-inner-verify-wiring`）
在轮里从未被报出来过** —— 它只在有人手跑主检出时才可见，而没有任何一轮会那样跑。

**⊢ 三条候选修法（⛔ 不指定实现，归落地方选）**：
① 轮启动时把这些运行时载体**只读挂载/复制**进一次性 worktree（保持 gitignore 不变）；
② 检查器加 `--<carrier>` 参数，由轮的启动方显式喂**主检出的路径**（`per-task-suite-record-check --lock-events` 已有先例）；
③ 判据改由「输入在 worktree 内可得」的量承载（如把必要事实随提交落进 tracked 文件）。
**⚠️ ⛔ 不可接受的第四条**：把 NOT-EVALUATED 当合格。**它现在就是这么表现的，而这正是要修的东西。**

**发生率（硬规则⑫，本条已够立案）**：受影响的 gitignored 载体 **5 个**；实测确认行为分叉的检查器 **2 个**；
由此导致的**错误勾选 1 次（AC62，我自己，2 小时内）**；**被结构性掩盖的真差集 ≥1 条（AC78 判据2）**。

---

## 🆕 AC84：outer 的全量轮与红窗分诊退役，验证单元完全下放 inner workflow（人 2026-08-15 09:47Z 逐字：「outer 跑 suite 和红窗/绿窗等机制都应该废弃了，应该在 inner 的 workflow 中跑 suite 并合并到 develop，项目主目录应保持为 develop 分支。检查相应任务是否实际落地，当前状态是否符合预期，列出应执行的调整操作，并落实。」）

- [ ] **AC84（outer 全量轮与红窗分诊退役，验证单元完全下放 inner workflow）**
      **🔴 2026-08-15 11:3xZ 补上这一行——本 AC 此前【只有 `##` 标题、没有复选框】。**
      AC83 的形态是「`##` 标题 + `- [ ]` 复选框」两件套（`:1134` + `:1148`），**AC84 只有前一半**
      ⇒ **我每轮的勾选表谓词 `^- \[[ x]\] \*\*AC\d+` 结构上看不见它** ⇒ 「已勾 16 / 未勾 9 = 25」**漏计**，
      而放宽谓词命中 31。**⊢ 后果不是数字难看：这条 AC 是人 09:47Z 逐字裁定的退役，
      却是本阶段唯一一条【没有任何东西在跟踪】的 AC。**
      **⊢ 这是 CLAUDE.md 硬规则 4b 里已经记过的同一个坑**（「`goal.phase_ac_checked` 的复选框正则：
      本阶段 12 条 AC 一个复选框都没有 ⇒ 贡献恒零」）——**同一个谓词、同一个失效方向，我又踩了一次。**
      **⇒ 零计数的配套动作（把谓词对已知为真的样本干跑）我做了，但只对 AC83 做，没对 AC84 做**
      ——因为我没想到「AC84 可能不在表里」，而这正是该动作要防的那种盲点。

      **🔴 判据1/2 现读 = 假（2026-08-15 11:3xZ 按位置实读 outer 核，非全文关键词）**：
      ```
      orchestrator-tick-core.md:53   - **B3 全量 suite 后台起跑**        ← 条款逐字仍在
      orchestrator-tick-core.md:108  **红窗分诊外层独占**，不把红树丢给 inner  ← 条款逐字仍在
      读法：只取行首为 - / * / 数字. / 大写字母+数字 的【条款行】，命中 9；干跑对照 fan-in 条款行 = 3
      （全文提及 14，⛔ 不作判据——注释/说明不算命中）
      ```
      **⇒ 人 09:47Z 裁定至 11:3xZ 已 108 分钟，两条条款一字未动。**

      **🔴 我自己的连带错（人 2026-08-15 11:3xZ 当场指出）**：我用「outer 在等绿窗、轮内不能写 develop」
      解释 outer 96 分钟无 tick-log。**人逐字：「你还在说 outer 跑 suite 和绿窗。已经多次说明，这些应停用。
      outer 内的 tick 不应跑 suite 测试也不应等任何 suite 测试的输出。」**
      ⇒ **我用一个【本该已退役的机制】去解释沉默，等于替它开脱**；且该解释无区分对照（硬规则4推论四）。
      ⇒ **撤回该解释：outer 的 96 分钟无 tick 目前【无解释】，这是诚实状态，也是一个待查信号。**

**⊢ 核查结果（直接量，2026-08-15 09:4xZ）——三项已符合、一项半未符合、一项【不该废】**
```
✅ 主目录分支            git rev-parse --abbrev-ref HEAD ⇒ develop
✅ inner 在 workflow 跑 suite  fan-in-execute.js 中 4 处 bash scripts/test.sh；per-task-suite-records 35 条
✅ inner 合并到 develop        fan-in-merge-lock-events acquire 83 次（subagent 持锁 ff）
🔴 outer B3 全量轮仍活          orchestrator-tick-core.md:53「B3 全量 suite 后台起跑」，条件=每次落地后触发
                               实测近 24h 31 轮 · avg 346s · 2.98h 墙钟 ≈ 12%（runner=outer scope=main）
🔴 outer 红窗分诊本体仍活        orchestrator-tick-core.md:108「红窗分诊外层独占…修好才重启套件→green 即撤信号」
                               ——它【预设 outer 跑套件】，与 B3 同生共死
⛔ 「绿窗」不是一个机制          全仓 grep：outer 核 1 处是 B13 行内附带词，其余全在 escalations/tick-log 的历史记述
                               ⇒ 无可废之物，⛔ 不要为它造退役动作
```
**⚠️ 六条红窗任务全部 `status: done`**（`gap-red-window-cap-trigger-backlog-not-suite-red` 等）
**而条款仍在核里** ⇒ **又一个「任务 done ≠ 阶段状态达成」**（同 AC62 撤勾那次）。

**判据1（B3 退役，能取假）**：outer 核不再有「全量 suite 后台起跑」条款（按 AC58「退役即迁出」：删正文 + 留指针 + 落点映射进 archive）；
**且退役时刻之后 `verification-round.jsonl` 新增记录中 `runner=outer && scope=main` 的条数 = 0**（时间窗只计退役后，同 AC78 判据2 的边界写法）。

**判据2（红窗分诊随之迁出）**：`orchestrator-tick-core.md:108` 按同一形态迁出。**理由必须写准**：它退役不是因为"红窗不重要"，
而是因为**它的输入（outer 自己跑的全量轮）没有了**；红树的归因与回退在新模型下由 fan-in 的 scoped/全量门在**合并前**拦住。

**🔴 判据3（⛔ 不得误废 inner 侧的红窗【约束】——这是最容易做错的一步）**：
`fast-mode-tick-core.md` 现有两条**必须原样保留**：
```
「红窗不再整体豁免——红窗快修恰恰最需要隔离（改的是正在让套件变红的文件）」
「红窗仅豁免【只读诊断】（跑命令/读日志/看 diff，不写产品文件）」
```
**它们是人 2026-08-13 06:07:45 逐字裁定「红窗在主会话修这个规则后续可以取消。红窗时可以减少 subagent 数量，但不要在主会话修」的落地**
⇒ **废掉它们等于撤回那条裁定。⊢ 能取假：回放删除这两条 ⇒ 必须红。**

**🔴 判据4（退役前必须先补上唯一被它覆盖的环境——本条有今日实测支撑，⛔ 不得跳过）**：
```
per-task suite   fan-in-execute.js:97/115/126 全在 cd ${worktree} 之后 ⇒ 跑在【任务 worktree】
outer 全量轮      full-suite-runner.ts:2309 provisionOneShotWorktree(mainRoot) ⇒ 跑在【主检出新开的一次性 worktree】
实证：round197 的 AC4 缺陷（root auto-derive 从 git worktree list 解析主检出）
     只在 verify-worktree 环境暴露，per-task suite 结构上到不了
```
**⇒ 直接退役 B3 会盲掉一个环境。判据4 = 退役方案里必须含【谁来覆盖 verify-worktree 环境】的答案。**

      **✅ 2026-08-15 10:1xZ 人已裁定，逐字：「明确该 verify-worktree 环境 suite 测试【仅在人的明确要求时单次运行】。」**
      **⇒ 判据4 已有确定答案，⛔ 不再是三选一。** 落地形态：
      ```
      verify-worktree 环境的 suite ⇒ 【无任何自动触发】：不按落地触发、不按周期触发、不设低频轮
                                    ⇒ 只有人明确要求时，单次运行一次
      ⇒ B3「本轮收尾 ≥1（或有新 merge 落地）⇒ 起全量轮」整条退役，不保留任何缩水版本
      ⇒ runner 的 appendVerificationRound 随之只在人工单次运行时产生记录
      ```
      **⚠️ 人选的是我【没有列出】的第四个选项。** 我给的三个（fan-in 内加验证 / 低频专项轮 / 判定风险可接受）
      **都预设了某种自动机制**；人的答案是**把自动化整个去掉**。**记这一笔：我的选项集本身带着「必须有自动触发」这个未言明的前提。**

      **⊢ 必须一并写明的代价（人已裁定，我不复议，但要记录以便将来复盘）**：
      **环境类缺陷（如 round197 的 AC4）从此只在【人下次要求跑】时才会被发现**，检测延迟由「一次落地」变为「不确定」。
      **这是明示接受的取舍**，与 SPEC §0-6 人的原裁定（「verification-round 应当小；趋势分析基于 inner subagent 的 suite 记录」）方向一致。
      **⊢ 连带**：红率分桶 / 负载溯源 / 残留剖面对照等趋势分析，**必须全部改用 inner 的 per-task suite 记录**
      （`.quay/per-task-suite-records.jsonl`），⛔ 不得再依赖 `verification-round.jsonl` 的自动轮次——**它将不再持续产生数据**。

      **⛔ 不接受"退役后再说"** —— 那正是本阶段反复出现的「退役做了一半」（B5 注解、floor 读数、cert）。

      **✅ 2026-08-15 11:4xZ outer 更正判据5 的落地边界，我按位置核过实据、采信（`f89ce7e7` 回执）**：
      ```
      ⛔ red-window-triage.ts 【不能退役】——它是共享面，不是 outer 专属：
        fast-mode-tick-core.md:73  C11 逐字「用 red-window-triage.ts --partition 分区 → 隔离低负载重跑再下结论」
                                   ⇒ inner 的活条款，且它是 .md 不在 test.sh 接线面上
        full-suite-runner.ts:185-190 注释逐字「Written by the runner at red time so the red-window triage
                                   can auto-partition WITHOUT re-deriving it」⇒ inner 的 per-task suite 也走它
        引用者枚举 = 18 个文件（inner 核 / suite-state-trigger.ts / capability-catalog / 9 个任务体 / …）
      ⇒ 退役的是【条款】（R32/R33 已迁出）与 red-window-triage 的 outer-红窗调用点，**不是工具本身**
      ⇒ 这正是判据5「⛔ 不得误废共享面」要防的那一类，**被 outer 用【枚举引用者】而非【看接线】抓住**
      ```
      **⊢ 记一笔方法上的对照**：同一天里我因「只读片段就对整体下结论」错三次并投递（`%B` 首行 / detector `:113` / 未传 `--baseline`），
      **而 outer 这次靠枚举引用者做对了。判据5 的价值由此实证：它不是清单，是一条阻止误废的纪律。**
      **⊢ 判据5 的剩余部分（按 AC49 判据1）**：outer 核出四个数据源读者（`trend-check` / `ready-pool` consecutive-red /
      `pool-quality-judge` / `suite-execution-form-counter`）空数据行为**均非恒绿**——但这是**静态推断**；
      **要在 B3 真退役后的一轮上看到它们确实没变绿，判据5 才有负控制。** ⛔ 不另立要求，等那一轮自然到来。

      **判据5（人 2026-08-15 10:2xZ 追加，逐字：「基于原 outer 跑 suite 测试衍生的机制也应取消」）**
      **⇒ 退役面不止 B3 本体，还包括它的衍生物。⛔ 必须【枚举】不得【布尔】**（硬规则③）。
      **⊢ 我已核实的两类（其余归 outer 枚举，我不替它猜）**：
      ```
      纯 outer 衍生、可直接退役：plugin/scripts/red-window-triage.ts
                                （test.sh 接线 0 处、仅 orchestrator-tick-core.md 引 1 处 ⇒ 纯红窗机制的执行体）
      ⚠️ 共享面，⛔ 不得误废：.quay/full-suite-state.json（inner 的 fan-in 用它判「轮在跑 ⇒ 拒锁」）
                              full-suite-runner.ts（inner 的 per-task suite 也走它）
                              suite 锁 / resource-gate ——三者 inner 都在用
      ```
      **🔴 判据5 的真风险不是「少了几个机制」，是【断供后检查器静默变绿】**：
      自动轮停 ⇒ `.quay/verification-round.jsonl` 不再持续新增 ⇒ **所有以它为数据源的检查器失去输入**。
      **⇒ 每一个都必须落到「NOT-EVALUATED（可区分）」而不是「ok=true（与合格同形）」** —— 硬规则 3b。
      **⊢ 这正是本阶段已发生过三次的形态**（carriers 恒 NOT-EVALUATED、A23 恒红、floor 读数残留）
      ⇒ **判据5 能取假**：退役后逐个跑那些检查器，**输出为 `ok=true` 且 `evaluated=true` 而其实无数据者 ⇒ 红**。

      **判据6（人 2026-08-15 10:2xZ 逐字：「红率分桶 / 负载溯源 / 残留剖面对照，全部改用 `.quay/per-task-suite-records.jsonl`」）**
      **⊢ 已定位的具体落点（读实现）**：`plugin/scripts/trend-check.ts` `:248` / `:311` 直接
      `readJsonLines(.quay/verification-round.jsonl)` ⇒ **它是趋势分析的实际载体读点，改这里。**
      **⊢ 能取假**：改后 `trend-check` 在 `verification-round.jsonl` **停止增长**的情况下仍产出趋势读数；
      且其读点 `grep -c 'verification-round' trend-check.ts` 应降为 0（或仅存历史注释，按位置核）。
      **⊢ ⚠️ 迁移时必须处理的语义差**：`per-task-suite-records` 里有 `fullSuiteRan=false`（doc-only delta 跳过全量）的记录，
      **红率分桶若不按 `skipReason` 分桶，会被跳过项稀释** —— inner 已确认 `skipReason` 从此是承重字段。

**归属**：判据1/2 在 `orchestration/orchestrator-tick-core.md`（outer 独占，C17）；判据3 在 `fast-mode-tick-core.md`（inner 面，manager 只报不改）；
判据4 的实现面按 AC65「谁能验证」切。**manager 一条都不改，本 AC 的落实动作 = 投递 + 跟踪。**

**⚠️ 不覆盖**：不改 inner 的 fan-in 协议（AC62/AC75/AC78 已定）；不动主目录分支（已是 develop）；⛔ 不为「绿窗」造退役动作（它不存在）。
