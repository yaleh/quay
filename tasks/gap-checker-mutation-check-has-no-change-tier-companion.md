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

- [ ] AC1（正控制·核心，可取假）：造一个「只改一本 checker，且**故意使其 mutation case 失效**」的 delta，跑该任务的 scoped 门。判据：scoped 门**退出码非零** ∧ 输出**点名该 checker**；命令与输出尾部贴进读数段。⛔ 取假形态：scoped 门绿、而同一 delta 在 fan-in 的 full-tier 才红 ⇒ 未达成（那就是本条要消除的现状）。
- [ ] AC2（负控制·不误伤，可取假）：一个**完全不碰任何 checker 载体**的 delta，其 scoped 选中集合**不含**该伴生检查。判据：`select-static-checks-for-touches.ts --names` 的输出不含伴生名（把实际输出贴进读数段）。⛔ 取假形态：任何 delta 都选中它 ⇒ 它事实上成了 `always` tier，等于把 55.6s 加到每个任务头上，未达成。
- [ ] AC3（成本按 delta 收窄，可取假）：实测两个 wall 并落盘 `.quay/mutation-check-companion-evidence.jsonl`——①「只改 1 本 checker」时伴生检查的 wall；②同机同时段 full-tier 全量 `checker-mutation-check` 的 wall。判据：两条读数存在 ∧ ① **显著小于** ②。⛔ 取假形态：① 与 ② 相当 ⇒ 伴生检查没有真正按 delta 收窄，等于把 full-tier 搬进 scoped，未达成。
- [ ] AC4（⛔ 不削弱 full-tier 兜底，逐字）：判据：`git diff` 中原 `checker-mutation-check` 的 `@static-tier full` 注释与其执行体**逐字未变**（该区段 diff 为空，只允许新增伴生块）。⛔ 取假形态：把 full-tier 那本删除或降级为 change ⇒ 未达成（延迟发现 ≠ 丢弃，同祖先任务 `gap-scoped-runs-pay-full-static-check-overhead` 明确的设计）。
- [ ] AC5（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后，`.quay/verification-round.jsonl` 中 `checker-mutation-check` 的 **fan-in 侧静态闸失败**应停止增长。判据：读数段给出四个量——实现落地时刻、落地前该失败的末次时刻（现为 2026-09-13T04:41:32Z）、落地后窗口长度、落地后该失败数。⚠️ **若落地后窗口内没有任何任务改动过 checker 载体 ⇒ 该 AC 记 `not-evaluated` 并写明**，⛔ 不得记为通过——没有输入不等于生效（硬规则 4 推论三：一个只能被注入满足的判据不是测量；⊢ 反例判据：把 seam 关掉后仍能通过才是测量）。
- [ ] AC6（硬规则 5b：修一个 ≠ 只有一个，⛔ 非布尔·本条的第二交付物）：对 full-tier **全 10 本**逐本给出「是否已有 change-tier 伴生」：`it0-split-or-commit-check` / `checker-mechanical-spine-check` / `task-ac-carryover-check` / `checker-mutation-check` / `outer-retirement-precondition-check` / `registry-bare-filename-scan` / `quay-init-closure-ratchet` / `kernel-sibling-resolution-check` / `config-key-consumer-check` / `host-repo-surface-ratchet`。判据：**10 行**表，每行三列（checker / 有无伴生 / 若无则「该不该有 + 理由」），每行三列均有取值。该表决定还有几本需要同样处理；标为「该有而无」的**须实际立案**并附任务 id，⛔ 不接受「建议后续」。

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
