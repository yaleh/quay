---
id: gap-ac76-tick-core-retirement-cleanup
title: AC76 判据5 + C7 收指针 + AC48 残留清理——fast-mode-tick-core 退役文本清理（tick core 不留已退役文本以减少上下文污染）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（人 2026-08-15 裁定：AC76 推进——「tick core 中不应留有已退役的文本，以减少对 tick 处理时上下文的污染；检查退役文本衍生的相关操作和文本并清理。对 AC48 也应做同样的检查和调整。」归 inner 面（fast-mode-tick-core.md + 相关代码）。）**

**三件事**：
1. **C7 收指针（`fast-mode-tick-core.md:69`）**：现状长注解「（前提已死，AC48/AC61 退役；不计入覆盖率分母）活指令指向已 RETIRED 的 integration-branch-model.ts —— 正身已归档 → archive#R25」→ 目标「~~**C7 正身已迁出**~~ → archive#R25」（删长注解，只留指针）。
2. **AC48 残留（$FORK_BASELINE 两线语义已死）**：`fork-baseline.ts` 在 per-task-suite-verification 模型下建立基线 = develop（单线）；integration 线退役（`--force-integration` 已退役，默认路径仅单线下游用）。核内 A9/A15④/A17/C3 引用 $FORK_BASELINE——其中 A17（:39 `--branch "$FORK_BASELINE"`）+ C3（:65 `$FORK_BASELINE 只由外层批量合推进`）的「外层批量合推进 integration→develop」语义已死（AC48 退役），按单线（develop = merge target）处理。
3. **AC76 判据5 代码标注（不删，写显式退役标注——同 AC48 判据2）**：
   - slot-refill.ts 的 in_flight_count→slots_free 在飞输入
   - fast-mode-telemetry.ts 的 realInFlight/reconcileInFlight/detectClosedButLive/analyzeSlotStatus
   - .quay/inner-wakeup-heartbeat.json 的 slots_free/should_refill/dispatchable_disjoint 在飞输入
   - /live 与 observation 面的 realInFlight 消费端
   - A16/A16b 的 --task-start 遥测【在飞用途】（派发留痕用途另议，不退役）
   - **⛔ 代码文件写显式退役标注（不删）；tick core 里的条款才迁出正文——两者形态不同。**

**⊢ tick core 旧读法改新读法**：核内 A12/A13/A16（:33/:34/:37）引用旧读法（slot-refill --in-flight / telemetry --slots / --task-start 在飞用途），退役后改新读法（查 subagent）。

**⚠️ AC8 断言**：manager 已立 gap-ac8-migration-semantic-test-update。迁完 C7 后，`tick-core-static-check.test.mjs`「inner C7 deducts」类断言按新语义改（已迁出不在核内），不是改数。

**判据1**：tick core 无已退役文本（C7 指针 + $FORK_BASELINE 单线 + 旧读法清除）。
**判据2（能取假）**：AC76 判据5 代码文件有显式退役标注（不删）；`tick-core-static-check` AC8「inner C7」按新语义（迁出不计数）；既有测试绿。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fast-mode-tick-core.md（C7/A9/A15④/A17/C3/A12/A13/A16）+ fork-baseline.ts + slot-refill.ts + fast-mode-telemetry.ts + tick-core-static-check.test.mjs。
2. C7 收指针；$FORK_BASELINE 引用按单线处理（A17/C3 改指向 develop/merge-target）；A12/A13/A16 旧读法改新读法。
3. AC76 判据5：代码文件（slot-refill/telemetry/heartbeat/live/A16 在飞用途）写显式退役标注（不删）。
4. AC8 断言按新语义改（inner C7 迁出不计数）。
5. 既有测试全绿 + `--for-task` scoped 门绿。
6. item ⑦ c3 审计条目跟随退役条款：`red-on-omission-audit.ts` c3_resource_gate invariant 接受 direct 或 migrated 形态（核 C3 指针 ∧ 档案 R32 短语）；`red-on-omission-audit.test.mjs` 加 migrated-form 正/负控制（absent-everywhere red）。
7. item ⑧ catalog 分类补齐：`capability-catalog.sh` 六表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）加 send-to-session.ts；unclassified 1→0；五个连带检查器绿；derivatives 核验。
8. item ⑧-follow-on 落地索引全枚举 + delivery-inventory 快照修复：枚举全部 plugin/scripts 索引面（catalog 六表 / delivery-inventory 快照 / verify-delivery-surface manifest / test-impl-census / mechanism-vitality / runtime-usage-inventory / referenced-not-landed），唯一漏项 = outline §6 快照（scripts 253→254 重生成）；AC4 承诺改为「补快照后 verify-delivery-surface 绿」。

## Acceptance Criteria

- [x] AC1 判据1：tick core 无已退役文本——C7 收指针、$FORK_BASELINE 单线（A17/C3 改 develop）、A12/A13/A16 旧读法清除。
- [x] AC2 判据2 能取假：AC76 判据5 代码文件显式退役标注（不删）；tick-core-static-check AC8「inner C7」新语义（迁出不计数）；c3 审计条目跟随退役条款（red-on-omission-audit migrated 形态 covered、absent-everywhere red）；既有测试绿。
- [x] AC3 判据3：`--for-task` scoped 门绿。
- [x] AC4 判据4（item ⑧ + follow-on）：catalog 分类补齐——send-to-session.ts 在 capability-catalog.sh 六表声明，unclassified 1→0（250/250 declared）；**落地索引全枚举 + 补快照后 verify-delivery-surface 绿**（快照漂移 = send-to-session.ts 落地的既有衍生，非本任务 delta——把前提写进承诺，不是放松；index-table 全表面核验见 Evidence：唯一漏项 = outline §6 DELIVERY-INVENTORY 快照，已重生成 253→254）+ 五个连带检查器绿。

## Definition of Done

- [x] tick core 退役文本清理（C7/$FORK_BASELINE/旧读法）+ AC76 判据5 代码标注 + AC8 断言新语义——人裁定落地。

## Touches

- orchestration/fast-mode-tick-core.md（C7 收指针 + $FORK_BASELINE 单线 + 旧读法改新）
- plugin/loop/fast-mode-tick-core.md（副本语义同步：C7 指针 + $FORK_BASELINE 单线 + A12/A13/A16 旧读法改新——不逐字拷贝，保持模板框架 + docs/analysis 引用）
- plugin/scripts/fork-baseline.ts（如需，退役标注——已自带 RETIRED 标注，本次未改）
- plugin/scripts/slot-refill.ts（AC76 判据5 退役标注）
- plugin/scripts/fast-mode-telemetry.ts（AC76 判据5 退役标注——已自带 RETIRED 标注，本次未改）
- plugin/test/tick-core-static-check.test.mjs（AC8 inner C7 新语义）
- plugin/scripts/red-on-omission-audit.ts（item ⑦：c3_resource_gate invariant 跟随 C3→R32 退役条款迁移——direct/migrated 两形态）
- plugin/test/red-on-omission-audit.test.mjs（item ⑦：migrated 形态负控制测试）
- plugin/scripts/capability-catalog.sh（item ⑧：send-to-session.ts 分类补齐——六表声明（含 CONSUMER） + unclassified 1→0 + 五个连带检查器绿）
- docs/proposals/quay-product-outline.md（item ⑧-follow-on：delivery-inventory 快照 253→254 重生成）
- tasks/gap-ac76-tick-core-retirement-cleanup.md（自身）

## Evidence

**实现范围**：只改 Touches 内文件（fast-mode-tick-core.md / slot-refill.ts / tick-core-static-check.test.mjs / 本任务）。fork-baseline.ts 与 fast-mode-telemetry.ts 已自带完整 RETIRED 标注（见下），本次未改。

**① C7 收指针（fast-mode-tick-core.md:69）** —— R25 锚点已核验存在（`orchestration/archive/AC58-retired-clauses.md` `## R25 — inner 核 C7（integration-branch-model.ts --overlaps-unverified 活指令→退役模块）`），指针可写。before/after：

```
- | C7 | （前提已死，AC48/AC61 退役；不计入覆盖率分母）活指令指向已 RETIRED 的 integration-branch-model.ts —— 正身已归档 → `orchestration/archive/AC58-retired-clauses.md#R25` (src:898) |
+ | C7 | ~~**C7 正身已迁出**（已退役，2026-08-15 迁出）~~ → `orchestration/archive/AC58-retired-clauses.md#R25` (src:898) |
```

指针风格对齐 manager A7-migrated（`~~**正身已迁出**（已退役，2026-08-15 迁出）~~ → archive#锚`）；保留 `(src:898)` 维持 AC3 src:N 覆盖率 100%；`已退役` 命中 STALE_ANNOT_RE 使 AC4 跳过该 archive 指针。

**② $FORK_BASELINE 两线语义退役（AC48 残留）** —— 单线 = develop；不删机制（fork-baseline.ts 仍服务单线下游）：

```
A9: `暂缓 $MERGE_TARGET→$FORK_BASELINE 批量合` → `暂缓 $MERGE_TARGET 合入(fan-in;AC48 退役注:$FORK_BASELINE 两线批量合已退役——单线,合回目标即 develop)`
A17: `--branch "$FORK_BASELINE"` → `--branch develop` + `**AC48 退役注:$FORK_BASELINE 两线语义已退役(integration 已删),单线 = develop**`
C3: `$FORK_BASELINE 只由外层批量合推进` → `合回 $MERGE_TARGET(单线 = develop)。**AC48 退役注:$FORK_BASELINE 两线语义已退役(integration 已删)——无外层批量合,合回目标即 develop**`
```

**③ 旧读法改新读法（A12/A13/A16）** —— 退役后查 subagent：

```
A12: `--in-flight <本会话在飞集合> --closed-but-live …` 在飞集合由本会话自己维护,不读遥测括号
  → `--in-flight <在飞 subagent 任务 id 集合>` 在飞集合查 inner 任务 subagent(cap-counts-subagents-check.ts 判据2 / meta-cc 查 <session>/subagents/agent-*.jsonl 近 N 分钟写入数;遥测括号推导已退役——AC76 判据5 C24-2)
A13: `fast-mode-telemetry.ts --slots` 空槽必须机械可见:realConcurrency/stale_brackets/closedButLive/slots_free
  → 在飞 subagent 数查 cap-counts-subagents-check.ts 判据2;`fast-mode-telemetry.ts --slots` 在飞维度已退役(C24-1——telemetry 括号分不清 done/ready),仅 --reconcile 清理与 C17 合规产物保留
A16: 追加 `**AC76 退役注(C24-5→C24-1):--task-start 括号的【在飞】用途已退役——括号不再作在飞读法(在飞读法 = 查 subagent,见 A12/A13);--task-start/--task-end 派发留痕与 defer 闭合用途保留**`
```

**④ AC76 判据5 code 标注（不删）** —— `cap-counts-subagents-check.ts 判据5` 机械核验 **PASS**（`c24-in-flight-derivations-retired (3/3 annotated)` + `c24-landing-coverage-complete (7/7)`）：
- C24-1 fast-mode-telemetry.ts `RETIRED (AC76 C24-1 …)`（realInFlight/reconcileInFlight/detectClosedButLive/analyzeSlotStatus）——先前任务已标，本次未改。
- C24-2 slot-refill.ts `RETIRED (AC76 C24-2 …)`——先前已标；**本次在 `computeSlotsFree`（in_flight_count→slots_free 在飞输入定义点）补内联 `RETIRED-BY-AC76` 标注**，明确 telemetry/括号推导读法退役、调用方显式 `--in-flight`（subagent 源）路径保留。
- C24-3 inner-wakeup-heartbeat-check.ts `RETIRED (AC76 C24-3 …)`（heartbeat slots_free/should_refill/dispatchable_disjoint 在飞输入）——先前已标，未改。
- C24-4 /live+observation 消费端 → 已并入本检查器判据6 + C24-1 producer 标注（merged disposition）；C24-5 A16/A16b --task-start 在飞用途 → 并入 C24-1；C24-6 outer-owned；C24-7 并入 C24-6。plugin 观测面 `--slots` 消费端（slot-free-trigger.ts）由 C24-4 merged 覆盖；字面 /live Web 页（packages/quay/src/serve-handlers.ts + observation.ts 读 `--report` inProgress）为产品面、不在本任务 plugin-scoped Touches，未改。

**⑤ AC8 断言新语义（tick-core-static-check.test.mjs）** —— inner C7 迁出后核内 `dead=0 / excluded=0`，旧 `excluded >= 1` 断言改为：① `dead===0`（核内无在核死条目）② inner C7 迁出指针检查（核内含 `#R25` 指针 + 档案含 `## R25` + C7 行无 DEAD_ANNOT_RE 标记，均可取假）。标题同步改「inner C7 迁出」。

**⑥ 副本语义同步（plugin/loop/fast-mode-tick-core.md）** —— outer 层要求按 SKILL.md「正本改动后由 inner 按正本语义落地副本」同步 quay-init --loop 模板副本。**不逐字拷贝**（副本 src:N 引用指向 laid-down 的 `docs/analysis/fast-mode-loop-tick.md`，正本指向 `plugin/loop/fast-mode-loop-tick.md`；byte-copy 会破坏 quay-init referenced⊆landed，见 232e4171），只更新对应条款语义：
- C7 (:81) → 与正本同形的 `~~**C7 正身已迁出**（已退役，2026-08-15 迁出）~~ → archive#R25` 指针
- A9 (:44) `$MERGE_TARGET`→`$FORK_BASELINE` 批量合 → 单线合回 develop + AC48 退役注
- A12 (:47) `--in-flight <本会话在飞集合>` 遥测推导 → 查 subagent（cap-counts 判据2）
- A13 (:48) `fast-mode-telemetry.ts --slots` 在飞维度退役（C24-1），仅 `--reconcile` 清理保留（副本保留其较短帧，未引入正本 C17 合规产物子句——pre-existing 差异）
- A16 (:51) `--task-start` 括号【在飞】用途退役（C24-5→C24-1），派发留痕保留（副本保留「inner 只写 --task-start」帧）
- A17 (:52) `--branch "$FORK_BASELINE"` → `--branch develop` + AC48 退役注
- C3 (:77) `$FORK_BASELINE 只由外层批量合推进` → 单线 develop + AC48 退役注
对比核验：A9/A12/A17/C3/C7 五条与正本逐字一致；A13/A16 语义同（副本帧更短）。
- **头注「逐字落地」陈旧声明修正**（判据1「tick core 不留已退役文本」）：正本 :14 与副本 :28 均曾写「正本改动后由 inner 按正本**逐字落地**」——与 SKILL.md:71 已落地事实矛盾（两副本非 byte-identical）。两处改为「按正本**语义**落地副本（副本为 quay-init --loop 铺出模板、引用目标 `docs/analysis/fast-mode-loop-tick.md` 源，非 byte-identical）」，对齐 gap-init-skill-md-byte-identical-claim-fix（50725186）表述。

**⑦ c3 审计条目跟随退役条款（red-on-omission-audit.ts + test，item 7，outer AC76 迁移阻塞）** —— outer 把 orchestrator C3 正文迁出到 archive#R32（核内只剩 `~~**C3 正身已迁出**~~` 指针；`resource-gate.sh --for full-suite` 短语只在档案）。原 c3_resource_gate invariant（`has(t, "resource-gate.sh --for full-suite") && script`）只认 direct 形态 ⇒ 迁移后 uncov=1 ⇒ pre-commit doc 门挡全部提交。修法（red-on-omission-audit.ts c3 verify）：
```
const direct = has(t, "resource-gate.sh --for full-suite");
const migrated = has(t, "C3 正身已迁出") && has(archive, "resource-gate.sh --for full-suite");
const ok = script && (direct || migrated);
```
`detail` 区分 direct/migrated 形态。可取假：短语同时从核与档案消失 ⇒ ok=false ⇒ uncov ⇒ 红。测试加 migrated-form 正控制（核指针+档案短语 ⇒ GREEN）与负控制（核无 direct 短语/无指针 + 档案无短语 ⇒ c3 uncov 红）；既有 ruling5 负控制保留。

**⑧ catalog 分类补齐（capability-catalog.sh，item 8）** —— item 8 = send-to-session.ts 补 capability-catalog 分类（人 2026-08-16 裁定 a，因 main 闸死锁折进本任务）。

send-to-session.ts（基于 Claude Code 跨会话 socket 协议、从非 Claude 进程给会话发消息）此前未入 catalog 索引 ⇒ capability-catalog AC1c 门报「1 unclassified / exit 1」，连带 npm-pack-e2e / mechanism-vitality-check / slot-free-trigger / verify-delivery-surface 五个检查器红。补六表条目（catalog entry-gate 要求 declared 脚本必须有 cadence/invalidation/last-reaffirmed/matching；rhythm-consumer-check 判据2 另要求按需脚本有 CONSUMER）：
- QUESTION：`Can a non-Claude process deliver a message to a Claude Code session via the cross-session socket protocol — auth frame (peerToken/childToken) + user frame, fire-and-forget, peer-token hold vs childToken (own-child) direct delivery, from-mode self-assertion boundary (owner's own sessions only, not a SendMessage replacement; landed 62853261)?`
- CADENCE=按需；INVALIDATION=失效前提（socket 协议废除则退休）；LAST_REAFFIRMED=2026-08-16；MATCHING=n/a（投递工具，非 pass/fail 检查）

**核验**：`bash capability-catalog.sh` → `250 scripts | 250 declared | 0 unclassified | 245 ship` exit 0；`mechanism-vitality-check --check` → invalidation_gate.ok=true exit 0；`slot-free-trigger.test.mjs` → 15/15（catalog-entry 闸绿）；`verify-delivery-surface` → PASS exit 0；`scripts/test.sh --static-checks-doc` → exit 0（npm-pack-e2e 依赖面解除）。

**derivatives 核验**：PUBLIC_ENTRYPOINTS 只约束 .sh（send-to-session.ts 非 .sh，无需）；NOT_SHIPPED/SUPERSEDED 不适用（在飞、非退役）；**CONSUMER 由 rhythm-consumer-check 判据2 要求**——首跑 scoped 门报「send-to-session.ts: 按需 without a CONSUMER row」（按需=无人按），故补 `谁按：owner/外层在需要从非 Claude 进程给目标会话投递消息时按`（五表之外第六表）。referenced-not-landed：全仓 grep 无 skills/loop/orchestration/docs/CLAUDE.md 引用 send-to-session.ts（文件本身已落地，无 dangling「应存在」引用）。

**⑧-follow-on 落地索引全枚举 + delivery-inventory 快照修复（item 8-follow-on，manager 批准 option (a) + 加枚举全部索引）** —— 3rd「落地漏索引」（catalog → referenced-not-landed → delivery-inventory 快照）。manager 指令：**不只修这一个快照，枚举所有 landed plugin/scripts 文件必须注册的索引面**。全表面核验表：

| 索引面 | send-to-session.ts 状态 | 证据 |
|---|---|---|
| capability-catalog.sh QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER | ✅ item 8 已入六表 | `[send-to-session.ts]` 六行（QUESTION 提问 / 按需 / 失效前提 / 2026-08-16 / n/a / 谁按） |
| **delivery-inventory 快照（quay-product-outline.md §6）** | ❌ 漏 → **本次补** | `--inventory` 首报 `scripts: disk=254 snapshot=253` drift=1 → `--write-inventory` 重生成 → `scripts=254 · ... · vendor=2` drift=0 |
| verify-delivery-surface SOURCE manifest（deliverables 六类） | ✅ 无需 | `--surface` PASS（send-to-session.ts 非六类交付物成员，.ts 非 .sh 面） |
| test-impl-census-check | ✅ 无需 | 只数测试文件（404），非机制脚本索引 |
| mechanism-vitality-check | ✅ 覆盖 | 读 catalog cadence/invalidation（六表已入） |
| npm-pack-e2e / package.sh | ✅ 经快照修复 | `--static-checks-doc` exit 0 |
| runtime-usage-inventory.md | ✅ 无需 | 2026-08-03 历史生成分析文档，非活索引（其 test 断言工具行为非固定计数） |
| referenced-not-landed | ✅ 零引用 | skills/loop/orchestration/docs/CLAUDE.md grep 无 send-to-session.ts |

**唯一漏项 = delivery-inventory 快照**（`scripts=253` 落后于 disk 254）——send-to-session.ts 落地的既有衍生（先于本任务，非 item 8 delta），manager 方向 = 把前提写进承诺（「补快照后 verify-delivery-surface 绿」），不是放松。修复证据：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --write-inventory --root .   → PASS: outline §6 DELIVERY-INVENTORY snapshot regenerated to match disk; inventory_drift=0
$ git diff docs/proposals/quay-product-outline.md → -scripts=253 +scripts=254（其余 key 不变）
```

**测试输出**：
```
$ node --test plugin/test/tick-core-static-check.test.mjs   → ℹ tests 21 · pass 21 · fail 0
  ✔ AC8: the real repo passes, three-layer exclusion notation (…migrated A7/A12a/B2c/乙/丁 AND inner C7 are archived pointers…; outer B4)
$ node --test plugin/test/direct-to-develop-bypass-check.test.mjs plugin/test/cap-counts-subagents-check.test.mjs plugin/test/retired-clause-check.test.mjs plugin/test/ac61-staleness-disposition-check.test.mjs → ℹ tests 71 · pass 71 · fail 0
$ node --test plugin/test/slot-refill.test.mjs plugin/test/inner-wakeup-heartbeat.test.mjs → ℹ tests 105 · pass 105 · fail 0
$ node --test plugin/test/red-on-omission-audit.test.mjs → ℹ tests 18 · pass 18 · fail 0
  ✔ AC4 (C3 migrated) — migrated form verifies GREEN
  ✔ AC4 (C3 migrated) NEGATIVE CONTROL — neither direct phrase NOR C3 pointer (no archive phrase) ⇒ c3 uncov
$ node --no-warnings --experimental-strip-types plugin/scripts/tick-core-static-check.ts --root . --json → ok=true, ac3/ac4/ac5/ac6/ac8 全绿, fast-mode src:N 47/47
```

**scoped 门（AC3 判据3）** —— `scripts/test.sh --for-task gap-ac76-tick-core-retirement-cleanup --allow-thin`：**EXIT:0**；静态检查全 PASS（test-framework-policy / test-isolation 26 baselined / tmp-leak-pairing / test-impl-census 404 clean / task-contract 0 violations / malformed-task / superseded-capability / concurrency-literal / landing-target / delivery-inventory-drift / ac61-staleness「C7 gone from 2 core copies」/ rhythm-consumer）；选中套件 **98/98 绿**。

**环境注**：① 本 worktree node_modules 为空（`gap-worktree-node-modules-inconsistent-self-verify` 族），首次 scoped 门 `malformed-task-check` 报 `Cannot find package 'yaml'`，symlink 主检出 node_modules 后重跑 EXIT=0（环境设置，非 git 改动）。② `slot-free-trigger.test.mjs` 的 capability-catalog 入口闸在本基线已红（catalog 报「1 script unclassified」，与本次改动无关，stash 验证 pre-existing）。③ `fast-mode-telemetry.test.mjs` 需 `.quay/config.yml`（gitignored，本 worktree 无）而文件级 crash——环境限制，非本次改动。

**跟进注（不在本任务 Touches）**：`tick-core-static-check.ts` 头注 :42 仍写「inner's C7 carries the marker」（已过时）；`plugin/loop/fast-mode-tick-core.md` 落地副本未随正本更新（pre-existing drift，drift gate --no-block）。两处归 owning layer 跟进。
