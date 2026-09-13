---
id: gap-it0-split-or-commit-check-needs-change-tier-companion
title: it0-split-or-commit-check 是 full-tier 且 17 次在无关任务的 fan-in
  变红——按本仓库既定解法（change-tier 伴生检查）让改它的那个任务在自己的 scoped 门被抓到
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：`gap-checker-mutation-check-has-no-change-tier-companion`（2026-09-13）AC6 的 10 行表——对 full-tier 全 10 本逐本判「有无 change-tier 伴生」。本条是唯一一本除已修的两本之外**发生率非零**的（⚠️ 不是「建议后续」，是读数表里的下一名）。

**读数（`.quay/verification-round.jsonl` 全 1611 轮，2026-08-12…2026-09-13；不是窄窗）**：
`STATIC_CHECK_FAILED: it0-split-or-commit-check` **17 次**，首次 2026-08-13T14:24:11Z、末次 2026-09-04T08:16:12Z；其中 **17/17 轮的 `tests==0 ∧ fail==0`**（一个测试都没跑过）⇒ 纯静态红，挡的是那些任务的 **fan-in**，而**改动它的那个任务不付账**。

**同族的既定解法（本仓库已用三次、已验证一次）**：`checker-mutation-check` 的 change-tier 伴生（`gap-checker-mutation-check-has-no-change-tier-companion`，2026-09-13）、`quay-init-closure-ratchet-stale`（`gap-quay-init-closure-ratchet-manual-reanchor-recurs`，2026-09-06 `84236de34`）、以及两条更早的 done 先例（`gap-capability-catalog-declarations-not-enforced-at-script-creation`、`gap-crosscut-checks-zero-coverage-of-plugin-scripts`）。其中 `quay-init-closure-ratchet` 的伴生落地后该 checker 的 fan-in 静态闸失败 **35 → 0**（末次 2026-09-06T17:48:12Z，之后窗口内 0 条）——**该解法在本仓库有实测疗效，不是推测**。

**为什么不是「把 full-tier 搬进 scoped」**：`it0-split-or-commit-check` 是 whole-store 判定（跑全库任务树），搬进 scoped 等于把它的全量成本加到每个任务头上；且 full-tier 被推迟的原本理由是**它的红不保证由本 delta 造成**。伴生检查只在 delta 真的碰了本 checker 的载体时才触发 ⇒ 它的红**按构造归属于本 delta**。

**⇒ 本条的形态**：full-tier 那本**逐字不动**当 whole-store 兜底（延迟发现 ≠ 丢弃），另加一个按 delta 收窄的 change-tier 伴生，让**改它的那个任务在自己的 scoped 门被抓到**。

## Plan

1. **先判可行性**（同 `gap-checker-mutation-check-has-no-change-tier-companion` Plan 1）：读 `it0-split-or-commit-check` 的实现，确认它能否按「只判本次 delta 涉及的任务/文档」收窄（是否已有 `--only`/名单参数，或能否新增）。**若结构上只能全量做** ⇒ 本条如实交付「为什么不可收窄」的结论 + 下一步建议，⛔ **不得硬塞一个跑全量的 change-tier 检查**（那会把全量成本加到每个碰 `plugin/scripts/` 的任务头上）；结案同样算完成。
2. 可收窄时，在 `plugin/scripts/runner-static-gate.ts` 登记伴生检查，形状对齐既有的 `quay-init-closure-ratchet-stale`（`:571-573`）与 `checker-mutation-check-changed`（`:379-405`）：`@static-tier change` + `@static-object` **收窄到本 checker 的载体**（checker 脚本本身 + 其 mutation case + 注册表源）。⛔ 不新建第二份登记表——单一正本就是该文件。
3. 伴生检查的判定域 = **本次 delta**，⛔ 不是全仓。
4. full-tier 那本**逐字不动**（AC4 同款判据：该区段 diff 为空、只允许新增伴生块）。
5. ⚠️ **Touches 补充义务**：Plan 1 定位出的实现文件若超出下列清单，worker 必须先把它追加进本任务 `## Touches` 再提交——fan-in 的 anti-drift 是 HARD-FAIL 步。

## Acceptance Criteria

- [ ] AC1（正控制·核心，可取假）：造一个「只改 `it0-split-or-commit-check` 载体，且**故意使其判定在该 delta 上失效**」的 delta，跑该任务的 scoped 门。判据：scoped 门**退出码非零** ∧ 输出**点名该 checker**；命令与输出尾部贴进读数段。⛔ 取假形态：scoped 门绿、而同一 delta 在 fan-in 的 full-tier 才红 ⇒ 未达成。**并附反向控制**：还原该文件后同一命令必须绿（证明红可归因于被改的那个文件，而不是 delta 整体）。
- [ ] AC2（负控制·不误伤，可取假）：一个**完全不碰该 checker 载体**的 delta，其 scoped 选中集合**不含**该伴生检查。判据：`select-static-checks-for-touches.ts --names` 的实际输出（贴进读数段）不含伴生名；且**逐条给出 `0` 的那几行所对的真实路径**（硬规则 2：零计数要拿已知为真的样本干跑一次）。⛔ 取假形态：任何 delta 都选中它 ⇒ 它事实上成了 `always` tier，未达成。
- [ ] AC3（成本按 delta 收窄，可取假）：实测并落盘——①「只改该 checker 一本」时伴生检查的 wall；②同机同时段 full-tier 全量 `it0-split-or-commit-check` 的 wall。判据：两条读数存在 ∧ ① **显著小于** ②。⛔ 取假形态：① 与 ② 相当 ⇒ 没有真正按 delta 收窄。⚠️ ② 的读法：`.quay/checker-cost.jsonl` 里该 checker 的历史行**是参考不是本次读数**，必须当场跑一次并记 wall + `duration_ms`。
- [ ] AC4（⛔ 不削弱 full-tier 兜底，逐字）：判据：`git diff` 中原 `it0-split-or-commit-check` 的 `@static-tier full` 注释与其执行体**逐字未变**（该区段 diff 为空，只允许新增伴生块）。⛔ 取假形态：把 full-tier 那本删除或降级为 change ⇒ 未达成。
- [ ] AC5（生产载体验证·读产物，⚠️ 允许 not-evaluated）：落地后，`.quay/verification-round.jsonl` 中 `it0-split-or-commit-check` 的 **fan-in 侧静态闸失败**应停止增长。判据：读数段给出四个量——实现落地时刻、落地前该失败的末次时刻（**现为 2026-09-04T08:16:12Z**，⛔ 不要抄本条的立案时刻）、落地后窗口长度、落地后该失败数。⚠️ **若落地后窗口内没有任何任务改动过该 checker 载体 ⇒ 记 `not-evaluated` 并写明**，⛔ 不得记为通过（硬规则 4 推论三）。
- [ ] AC6（硬规则 5b）：对 full-tier 剩余 9 本再核一遍「是否已有 change-tier 伴生」（本条的 10 行表以 2026-09-13 的读数为准；`checker-mutation-check` 与 `quay-init-closure-ratchet` 已各自有伴生）。判据：仍有「该有而无」的**须实际立案**并附任务 id，⛔ 不接受「建议后续」。

## Definition of Done

- `plugin/scripts/runner-static-gate.ts` 登记伴生检查落地（或如实交付「结构上不可收窄」的结论）；对应的 `plugin/test/` 可失败控制补上（伴生检查的 tier/object 解析与 `--list` 一致；注入不一致即红）。
- AC1 / AC3 的真实读数落盘（路径随实现定，须在任务体读数段点名）。
- AC6 的核对结果落进任务体读数段，需另立案的已实际立案（附 id）。
- ⛔ 本条**不动** scoped 选择公式本身；⛔ 不处理「`tier=change` 的 glob 没够到 delta」那类形态（另一个缺陷，需要时另立案）。

## Touches

- tasks/gap-it0-split-or-commit-check-needs-change-tier-companion.md
- plugin/scripts/runner-static-gate.ts
