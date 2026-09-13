---
id: gap-checker-mutation-check-has-no-change-tier-companion
title: checker-mutation-check 是 full-tier 且末次静态闸失败就在今天——按本仓库既定解法（change-tier
  伴生检查）让改 checker 的那个任务在自己的 scoped 门被抓到
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：2026-09-13 本会话对「worker 退出时未落地率 62%」的实证调查（`.quay/worker-outcome.jsonl` 1801 条：exited-not-landed 1062 / completed 637 / failed 99）。

**读数一（失败构成，窗口 2026-09-04…09-13，`.quay/verification-round.jsonl` 内 205 条 red）**：
fan-in 的 `step=suite` 红分两类——**(A) 静态检查/全仓枚举不变量 52 轮（25.4%）**、(B) 行为测试 145 轮（70.7%）。
判别是**结构性的而非关键词匹配**：A 类为 `reason:"gate-failed"` + `gate:"static-check"` + `failures[].staticCheck:true`；负控制：56 个 A 轮中 **53 个 `tests==0 ∧ fail==0`（一个测试都没跑过）**，而 146 个 B 轮全部 `tests>0`。

**读数二（A 类按 tier 分解）**：**40/56 个 A 轮（71.4%）只因 `@static-tier full` 的 checker 而红** ⇒ 该本结构上永不在 worker 侧执行（scoped 公式 `{always} ∪ {change ∩ touches} − {full}`，`plugin/scripts/select-static-checks-for-touches.ts:17-27`）⇒ **改动它的那个任务不付账，撞上它的是一个无关任务的 fan-in。**

**⚠️ 读数三（前提负控制：我原本的旗舰证据已被落地提交作废，本条据此改写）**：
调查最初点名的是 `quay-init-closure-ratchet`（窗口内 35 次命中 / 13 个不同任务）。**它已经被解决了，而且是用【另一种机制】解决的**：
`gap-quay-init-closure-ratchet-manual-reanchor-recurs`（**done**，2026-09-06 `84236de34`）除了再锚，还落了一个 **change-tier 伴生检查** `quay-init-closure-ratchet-stale`（`plugin/scripts/runner-static-gate.ts:571-573`，`@static-tier change` + `@static-object plugin/scripts/ plugin/workflows/ plugin/agents/ plugin/probes/ plugin/loop/ plugin/.claude/ orchestration/`），其注释逐字写明目的：
`detects … at the CHANGER's own scoped gate, instead of at an unrelated task's full-suite fan-in (the 8th-recurrence defect this task closes)`
台账吻合：`verification-round.jsonl` 中 `quay-init*` 的静态闸失败**末次 2026-09-06T17:48:12Z，之后 0 条**。
**⇒ 这条既是前提作废，也是本任务的解法来源：本仓库对该类的【既定解法】是「补一个 change-tier 伴生检查」，⛔ 不是「把 full-tier 搬到 worker 侧去跑」。** 同解法另有两条 done 先例：`gap-capability-catalog-declarations-not-enforced-at-script-creation`（其问题陈述与本条同形：`the scoped static-tier defers it to full-suite, so a task ships green and the catalog turns red only at the outer's verification round`）、`gap-crosscut-checks-zero-coverage-of-plugin-scripts`。

**读数四（仍在犯的那一本 —— 本条的真实对象）**：
`checker-mutation-check`，`@static-tier full`（`plugin/scripts/runner-static-gate.ts:377` 注释原文：`the ~13s meta-check on the checkers THEMSELVES — deferred to the full-suite gate`）：
- 窗口内命中 **6 次**；
- **末次静态闸失败 = 2026-09-13T04:41:32Z（今天）** ⇒ 仍在挡着地，⛔ 不是历史问题；
- 实测耗时 **55.6s**（`.quay/checker-cost.jsonl` 末 7 次中位），是整个并行静态相的**临界路**。
  ⚠️ 注意它已增长：`gap-scoped-runs-pay-full-static-check-overhead`（done）当时测得 13s ⇒ **约 4 倍**。它**没有** change-tier 伴生检查。

**为什么走「伴生检查」而不是「把 full-tier 前移进 `preMergeNote()`」（三条理由，缺一不可）**：
1. **既定解法已存在且已验证三次** ⇒ 硬规则 1：动作前先查有没有同类工具，用机件不手搓。
2. **成本**：mutation-check **全部** checker 是 55.6s；mutation-check **只有本次改动的那一本** 的成本 ∝ 改动本数（通常 1）。把 full-tier 原样前移等于把 55.6s 加到每个 worker 头上。
3. **归属（这条最重要）**：full-tier 被推迟的原本理由就是**它的红不保证由本 delta 造成**（whole-store / 元检查）。一个 `@static-object` 收窄到 checker 文件的 change-tier 伴生检查，**只在 delta 真的碰了 checker 时才触发** ⇒ 它的红**按构造归属于本 delta**，正好绕开了那个归属问题，而不是无视它。

**⇒ 本条的形态**：full-tier 那本**原样留着**当 whole-store 兜底（延迟发现 ≠ 丢弃，同祖先任务的设计），另加一个按 delta 收窄的 change-tier 伴生检查，让**改 checker 的那个任务在自己的 scoped 门就被抓到**。

## Plan

1. **先判可行性**：读 `checker-mutation-check` 的实现，确认它能否按「只检某几本 checker」收窄（是否已有 `--only`/名单参数，或能否新增）。若结构上只能全量做 ⇒ 本任务改为交付「为什么不可收窄」的结论 + AC6 的那张表，⛔ 不得硬塞一个跑全量的 change-tier 检查（那会把 55.6s 加到每个碰 `plugin/scripts/` 的任务头上）。
2. 在 `plugin/scripts/runner-static-gate.ts` 登记伴生检查，形状对齐 `quay-init-closure-ratchet-stale`（`:571-573`）：`@static-tier change` + `@static-object` 收窄到 checker 载体（checker 脚本本身与 mutation case 目录）。⛔ 不新建第二份登记表——单一正本就是该文件，`select-static-checks-for-touches.ts` 与 `checker-mutation-check` 都解析它。
3. 伴生检查的判定域 = **本次 delta 里的 checker**，⛔ 不是全仓 checker。
4. full-tier 那本**逐字不动**。

## Acceptance Criteria

- [x] AC1（正控制·核心，可取假）：造一个「只改一本 checker，且**故意使其 mutation case 失效**」的 delta，跑该任务的 scoped 门。判据：scoped 门**退出码非零** ∧ 输出**点名该 checker**；命令与输出尾部贴进读数段。⛔ 取假形态：scoped 门绿、而同一 delta 在 fan-in 的 full-tier 才红 ⇒ 未达成（那就是本条要消除的现状）。
- [x] AC2（负控制·不误伤，可取假）：一个**完全不碰任何 checker 载体**的 delta，其 scoped 选中集合**不含**该伴生检查。判据：`select-static-checks-for-touches.ts --names` 的输出不含伴生名（把实际输出贴进读数段）。⛔ 取假形态：任何 delta 都选中它 ⇒ 它事实上成了 `always` tier，等于把 55.6s 加到每个任务头上，未达成。
- [x] AC3（成本按 delta 收窄，可取假）：实测两个 wall 并落盘 `.quay/mutation-check-companion-evidence.jsonl`——①「只改 1 本 checker」时伴生检查的 wall；②同机同时段 full-tier 全量 `checker-mutation-check` 的 wall。判据：两条读数存在 ∧ ① **显著小于** ②。⛔ 取假形态：① 与 ② 相当 ⇒ 伴生检查没有真正按 delta 收窄，等于把 full-tier 搬进 scoped，未达成。
- [x] AC4（⛔ 不削弱 full-tier 兜底，逐字）：判据：`git diff` 中原 `checker-mutation-check` 的 `@static-tier full` 注释与其执行体**逐字未变**（该区段 diff 为空，只允许新增伴生块）。⛔ 取假形态：把 full-tier 那本删除或降级为 change ⇒ 未达成（延迟发现 ≠ 丢弃，同祖先任务 `gap-scoped-runs-pay-full-static-check-overhead` 明确的设计）。
- [ ] AC5（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后，`.quay/verification-round.jsonl` 中 `checker-mutation-check` 的 **fan-in 侧静态闸失败**应停止增长。判据：读数段给出四个量——实现落地时刻、落地前该失败的末次时刻（现为 2026-09-13T04:41:32Z）、落地后窗口长度、落地后该失败数。⚠️ **若落地后窗口内没有任何任务改动过 checker 载体 ⇒ 该 AC 记 `not-evaluated` 并写明**，⛔ 不得记为通过——没有输入不等于生效（硬规则 4 推论三：一个只能被注入满足的判据不是测量；⊢ 反例判据：把 seam 关掉后仍能通过才是测量）。——外层 verification-round 验证
- [x] AC6（硬规则 5b：修一个 ≠ 只有一个，⛔ 非布尔·本条的第二交付物）：对 full-tier **全 10 本**逐本给出「是否已有 change-tier 伴生」：`it0-split-or-commit-check` / `checker-mechanical-spine-check` / `task-ac-carryover-check` / `checker-mutation-check` / `outer-retirement-precondition-check` / `registry-bare-filename-scan` / `quay-init-closure-ratchet` / `kernel-sibling-resolution-check` / `config-key-consumer-check` / `host-repo-surface-ratchet`。判据：**10 行**表，每行三列（checker / 有无伴生 / 若无则「该不该有 + 理由」），每行三列均有取值。该表决定还有几本需要同样处理；标为「该有而无」的**须实际立案**并附任务 id，⛔ 不接受「建议后续」。

## Definition of Done

- `plugin/scripts/runner-static-gate.ts` 登记伴生检查落地；`plugin/test/select-static-checks-for-touches.test.mjs` 补可失败控制（伴生检查的 tier/object 解析与 `--list` 一致；注入不一致即红）。
- `.quay/mutation-check-companion-evidence.jsonl` 含 AC1 / AC3 的真实读数。
- AC6 的 10 行表落进任务体读数段，需另立案的已实际立案（附 id）。
- ⛔ **若 Plan 1 判定 `checker-mutation-check` 结构上无法按 delta 收窄 ⇒ 如实交付该结论 + AC6 的表，结案同样算完成**，⛔ 不得硬塞一个跑全量的 change-tier 检查。
- ⛔ 本条**不动** scoped 选择公式本身（那是 `gap-scoped-runs-pay-full-static-check-overhead` 的宽度轴）；⛔ 不处理「`tier=change` 的 glob 没够到 delta」那 10 轮（另一个缺陷形态，需要时另立案）。
- ⚠️ **Touches 补充义务**：Plan 1 定位出的 `checker-mutation-check` 实现文件（及其 mutation case 目录）若超出下列清单，worker 必须先把它追加进本任务 `## Touches` 再提交——fan-in 的 anti-drift 是 HARD-FAIL 步，提交了未声明的文件即红。

## Touches

- tasks/gap-checker-mutation-check-has-no-change-tier-companion.md
- plugin/scripts/runner-static-gate.ts
- plugin/test/select-static-checks-for-touches.test.mjs
- plugin/scripts/checker-mutation-check.sh

## 读数段

（AC1–AC6 的实际读数；机件读数另存 `.quay/mutation-check-companion-evidence.jsonl`（6 行 JSON，含命令、原始输出尾部与可失败方向）。）

### AC1 正控制（可取假）+ 反向控制
**delta**：`plugin/scripts/provider-binding-resolvability-check.ts` 被判失效——`row.state = "bare-path-name"` → `row.state = "path-resolved"`（1 行；该 checker 不再红在它自己的 mutation case 注入的 bare-PATH 缺陷上）；同一 delta 里另有本任务自己的 `checker-mutation-check.sh`。
命令：`bash scripts/test.sh --for-task gap-checker-mutation-check-has-no-change-tier-companion --allow-thin`
读数：**退出码 = 1**，输出尾部：
```
checker-mutation-check [--check-changed]: delta base develop; 2 checker carrier(s) in THIS delta (⛔ not the whole 71-checker manifest): checker-mutation-check provider-binding-resolvability-check
STAYED-GREEN — a bare-PATH binding (quay-native, no separator) did not redden the checker
MUTATION provider-binding-resolvability-check: stayed-green
mutations_that_stayed_green: 1
stayed-green (defect present, checker still green) — THE FINDINGS:
  - provider-binding-resolvability-check
RESULT: FAIL — a checker stayed green under a defect it should catch, or the manifest is incomplete/broken.
STATIC_CHECK_FAILED: checker-mutation-check-changed exit=1
```
⇒ scoped 门非零 ∧ 点名该 checker。
**反向控制**：`git checkout -- plugin/scripts/provider-binding-resolvability-check.ts` 还原后，**同一条命令、同一 worktree** ⇒ **退出码 = 0**（唯一载体是本任务自己的 `checker-mutation-check`，pass）⇒ 红可归因于被改的那个文件，而不是 delta 整体（硬规则 4 推论四：附一个「若 Y 为假则结果会不同」的对照）。

### AC2 负控制（不误伤）
真实 CLI `select-static-checks-for-touches.ts --touches <path> --names` 输出中 `^checker-mutation-check$` 的行数：
| delta 路径 | 伴生被选中 |
|---|---|
| `plugin/scripts/repo-root.ts` | 0 |
| `docs/proposals/foo.md` | 0 |
| `plugin/test/some.test.mjs` | 0 |
| `packages/quay/src/serve.ts` | 0 |
| `plugin/scripts/checker-mutation-cases/provider-binding-resolvability-check.sh` | 1 |
| `plugin/scripts/runner-static-gate.ts` | 1 |
| `scripts/test.sh` | 1 |
⇒ 四个「0」各自对齐**真实路径**逐一列出；同一次运行里的 3 个「1」即正样本（硬规则 2：零计数配一个已知为真的样本干跑）。伴生没有变成 `always` tier。

### AC3 成本按 delta 收窄
同机同时段（2026-09-13T06:3x–06:4xZ）两次实测：
- **① 伴生**（delta = 恰好 1 本注册 checker、无注册表变更；探针 worktree `/tmp/ac3-probe-wt` = detach 在 develop + 本任务的 `checker-mutation-check.sh`）：
  `bash plugin/scripts/checker-mutation-check.sh --check-changed --repo-root /tmp/ac3-probe-wt`
  三次 wall / 内部 `duration_ms` = **923 / 556**、**740 / 449**、**828 / 505** ms ⇒ wall **0.74–0.92 s**，`checkers_executed: 1`（全场 71）。
- **② full-tier 全量**：`bash plugin/scripts/checker-mutation-check.sh --check --repo-root <本任务 worktree>`
  wall **78859 ms**、内部 `duration_ms` **78668**、`checkers_total: 71`、`checkers_with_mutation: 71`、`mutations_that_stayed_green: 0`、exit 0。
⇒ ①/② ≈ **1/90**，显著小于 ⟹ 伴生确实按 delta 收窄，⛔ 不是把 full-tier 搬进 scoped。
⚠️ 出处：Proposal 引的 55.6 s 是 `.quay/checker-cost.jsonl` 末 7 次中位（历史读数）；本次同机同时段实测 78.9 s。两者都 ≫ ①，AC3 要求的「同机同时段对照」用的即本次这一对。

### AC4 full-tier 兜底逐字未动
`git diff -U3 -- plugin/scripts/runner-static-gate.ts`：该 hunk **只有 `+` 行、无任何 `-` 行**；`# @static-tier full  (the ~13s meta-check on the checkers THEMSELVES — deferred to the full-suite gate)` 与其后 `run_checker "checker-mutation-check" … --check` 两行以**未变化的上下文**出现。
另有测试钉住（`plugin/test/select-static-checks-for-touches.test.mjs`）：断言这两行**逐字连续存在** ∧ 解析出的 full 条目 `commandLine` 与原文**逐字节相等**（删掉或降级 full-tier 块 ⇒ 该测试红）。

### AC5 生产载体验证 —— ⚠️ **not-evaluated**（本 AC 保持未勾 + `外层 verification-round 验证` 标记）
1. **实现落地时刻**：本任务实现提交 `f6912e986880bbf7667f765fc8d4c2571d02370c`，`2026-09-13T05:50:49+00:00`（worktree 内）。ff 到 develop 由 fan-in 完成 ⇒ **本读数写入时尚未落地 develop**。
2. **落地前该失败的末次时刻**：`STATIC_CHECK_FAILED: checker-mutation-check` 末次 = **2026-09-13T04:41:32.189Z**（`.quay/verification-round.jsonl` 全史 1611 轮 / 2026-08-12…2026-09-13，共 8 次）。
3. **落地后窗口长度**：**0**（无任何轮次在本实现落地之后跑过 fan-in）。
4. **落地后该失败数**：**0**，但窗口为 0 ⇒ **不是证据**。
⇒ 硬规则 4 推论三：本 AC 记 **not-evaluated**，⛔ 不记为通过；保持未勾并以 `——外层 verification-round 验证` 结尾（本仓库既有的「只差外层验证」形态，`slot-refill.ts:673` `isOuterVerificationItem`；机械可区分：`fan-in-ac-completion-gate.ts` 判 `pass-external` 而非 `pass`）。

### AC6 硬规则 5b：full-tier 10 本逐本
方法：tier 取自真实注册表（`select-static-checks-for-touches.ts --list`）；「fan-in 静态闸 reds」取自 `.quay/verification-round.jsonl` **全史 1611 轮**（2026-08-12…2026-09-13，⛔ 非窄窗，硬规则 12b）；成本取自 `.quay/checker-cost.jsonl` 全史中位。
⚠️ 读数可信度控制：单条记录内 `STATIC_CHECK_FAILED` 最多 2 条（8 条记录），故需排查「0 次」是否为屏蔽伪影——已核对：并列 2 条真的会发生（如 2026-09-04 的 `it0-split-or-commit-check` + `spec-declaration-point-check` 同轮），且位置靠后的 checker 确有非零读数（`spec-declaration-point-check` 15、`criterion-failure-attribution-check` 2）⇒ 报告面覆盖到注册表尾部，下表「0 次」不是屏蔽伪影。

| # | checker | 注册 tier | change-tier 伴生 | fan-in 静态闸 reds（全史 1611 轮） | 成本（全史中位） | 该不该有 + 理由 |
|---|---|---|---|---|---|---|
| 1 | `it0-split-or-commit-check` | full | **无** | **17**（首 2026-08-13T14:24:11Z、末 2026-09-04T08:16:12Z；**17/17 轮 tests==0 ∧ fail==0**） | 715 ms (n=166) | **该有** —— 10 本里除已修的两本外**唯一发生率非零**者，且 17 次全是纯静态红挡在**无关任务** fan-in 上（正是本条要消灭的形态）。**已实际立案：`gap-it0-split-or-commit-check-needs-change-tier-companion`**（status `todo`，含完整四件套 + Plan 1「结构上不可收窄 ⇒ 如实交付结论」退出路径）。 |
| 2 | `checker-mechanical-spine-check` | full | 无 | 0 | 1277 ms (n=2) | **不该有**（现在）—— 发生率 **0**；成本 1.3 s，不在 78.9 s 型关键路径。硬规则 12：给出读数后的「不该有」是有据判断，⛔ 不是「建议后续」。 |
| 3 | `task-ac-carryover-check` | full | 无 | 0 | 783 ms (n=165) | **不该有**（现在）—— 发生率 **0**（n=165 次运行）。 |
| 4 | `checker-mutation-check` | full **+ change** | **有（本条交付）** | 8（末 **2026-09-13T04:41:32Z**） | 18954 ms (n=161)；末 7 中位 55615 ms | **本条已消除** —— 伴生 `checker-mutation-check-changed` 已登记（`runner-static-gate.ts:379-405`），full-tier 逐字保留。 |
| 5 | `outer-retirement-precondition-check` | full | 无 | 0 | 34871 ms (n=3) | **不该有**（现在）—— 发生率 **0**。⚠️ 它是 10 本里第二贵（~35 s），但**贵 ≠ 该有**：伴生治的是「红落在陌生人身上」的归属错位，不是成本；且本条明确不动 full-tier。 |
| 6 | `registry-bare-filename-scan` | full | 无 | 0 | 3851 ms (n=1) | **不该有**（现在）—— 发生率 **0**。 |
| 7 | `quay-init-closure-ratchet` | full **+ change** | **有（前例 `84236de34`）** | 35（末 2026-09-06T17:48:12Z，**之后 0 条**） | 1741 ms (n=1) | **已有，且实证有效** —— 伴生落地后 fan-in 静态闸失败 **35 → 0**。既是本条的解法来源，也是「伴生能治这个病」的实测疗效（⛔ 不是推论）。 |
| 8 | `kernel-sibling-resolution-check` | full | 无 | **1**（2026-09-10T04:02:39Z） | 1225 ms (n=1) | **暂时不该有** —— 发生率 **1**，低于本仓库两次实际动手的门槛（35 与 6–8；本条对象为 8）。硬规则 12：读数已给出 ⇒ **降为观察项**（⛔ 不是「建议后续」）；**若再现 ≥2 次，按本表同法处理**（Plan 1 判可行性 → 收窄后登记伴生）。 |
| 9 | `config-key-consumer-check` | full | 无 | 0 | 780 ms (n=1) | **不该有**（现在）—— 发生率 **0**。 |
| 10 | `host-repo-surface-ratchet` | full | 无 | 0 | 1101 ms (n=1) | **不该有**（现在）—— 发生率 **0**。 |

**10 行三列全部有取值**（#4/#7 第三列为「已有（含本条）」+ 出处）。**标为「该有而无」的只有 #1，已实际立案并附 id**（⛔ 无「建议后续」项）。
⇒ 刻意不越界：本条只交付**本表 + 立案**，⛔ 不顺手给 #1 加伴生——它判定 whole-store 任务树，能否按 delta 收窄是**它的 Plan 1** 要判的（同本条 Plan 1）；塞进本条会让两件事的读数混在一起。

### 附带交付：full-tier 变更时的覆盖度前置
delta 含**注册表源**（`runner-static-gate.ts` / `scripts/test.sh` / `.github/workflows/`）时，伴生额外做一次**全 manifest 覆盖度复验**（uncovered = 0，`--list` 级、不跑 case）——即 `checker-mutation-check.sh` 注释里的 AC1b 维度（「新 checker 无 mutation case 不得静默溜过」）也在**加它的那个任务**的 scoped 门被前置。实测（本次 AC1 运行）：`manifest source changed in this delta — all 71 registered checkers have a mutation case (uncovered = 0).`
