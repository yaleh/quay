---
id: gap-b1-mechanical-spine-doc-checker
title: B1·层 1 机械脊柱写成文档+检查器（exit 0/1/2 语义 + --json 输出契约，不符者 N→0）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

checker 的层 1「机械脊柱」目前是 CODIFY-EXISTING（几乎免费）：SPEC §2.3 实测 exit 0/1/2 语义 12/14 已符合、`--json` 输出 13/14 已支持（56/77）。但该契约没写下来、没检查器守着，所以不符者会静默漂移。写一份「checker 机械脊柱契约」文档（exit 码语义 + `--json` 输出形状）+ 一个检查器，把不符者计出来（棘轮：只减不增）。

## Plan

写 `orchestration/SPEC-checker-mechanical-spine-contract-2026-08-28.md` 契约文档（正本）+ `plugin/scripts/checker-mechanical-spine-check.ts` 检查器 + `plugin/test/checker-mechanical-spine-check.test.mjs` 负控制测试：对 77 个 `.ts` checker（+ 32 `.sh`）逐个跑/静态判 exit 码语义与 `--json` 支持，输出不符者清单；配套 exemption list 棘轮（历史不符者豁免、新增不符者红，名单放 `plugin/scripts/checker-mechanical-spine-exemptions.json`）。⛔ 层 2 判定契约（复用 driver-result）归 B4，层 3 输入形状归 B5，不并入本任务。新建文件按上述命名落地，⛔ 不另取名。

## Acceptance Criteria

- [x] AC1（能取假，契约文档）：机械脊柱契约文档存在（exit 0/1/2 语义 + --json 形状，逐条可 grep）；（⛔ 无文档 ⇒ 假）。
- [x] AC2（能取假，棘轮计数）：不符者数 N 从当前值（~1-2 个 exit 码不符 + ~1 个 --json 不符）降到 0，且检查器守新增违例；（⛔ 不符者不降或新增违例不红 ⇒ 假）。
- [x] AC3（能取假，负控制）：造一个用 exit 3 的 checker（不符契约），检查器必须红；（⛔ 不红 ⇒ 假）。

## Definition of Done

机械脊柱契约文档 + 检查器落地；AC1/AC2/AC3 全勾；不符者清零 + 棘轮挡回潮。

## Evidence

- **AC1**：契约文档 `orchestration/SPEC-checker-mechanical-spine-contract-2026-08-28.md` 存在——§2 exit 码词表 {0,1,2,3} 逐条（`0`/`1`/`2`/`3` 各一条语义 + 「违例定义（grep 可判）」），§3 `--json` 形状（`--json` + JSON 原语逐条）。已声明到 2 个 SPEC 声明点（manager/init SKILL.md），`spec-declaration-point-check --root .` PASS（36 SPECs declared at 2 points）。
- **AC2**：`checker-mechanical-spine-check.ts --root .` 实测 `110 checker(s), 0 violation(s)`、exit 0（78 `.ts` + 32 `.sh` 逐个静态扫；exemptions 清单 `exit:[]` `json:[]` 从空起步）。检查器已注册进 `runner-static-gate.ts` run_static_checks（`@static-tier full`）+ mutation case，新增违例（不在名单）⇒ exit 1 红、名单新增条目（vs git HEAD baseline）⇒ ratchetAdded 红——棘轮只减不增。
- **AC3**：负控制 = `plugin/test/checker-mechanical-spine-check.test.mjs`（14 断言全绿）+ `checker-mutation-cases/checker-mechanical-spine-check.sh`（GREEN→注入 exit 4→RED→恢复→GREEN，exit 0）。⛔ **exit 3 vs 4 的澄清**：契约把 exit 3 定为【已认可的 NOT-EVALUATED 扩展】（`gap-not-evaluated-harness-third-state` done，`checker-cost-lib.sh` `RUN_CHECKER_EXIT_NOT_EVALUATED=3`），**不是**脊柱违例；故「exit 3」在第三态统一之后的等价负控制形态是 exit **4**（{0,1,2,3} 之外的最小码）。测试同时钉死两侧：`process.exit(3)` 不判违例、`process.exit(4)` 判违例（unexempted "exit" violation，detail "exit code 4"）。

## Touches

- plugin/scripts/checker-mechanical-spine-check.ts (new)（检查器：静态扫 78 .ts + 32 .sh 判 exit 码词表 {0,1,2,3} + --json 兑现）
- plugin/scripts/checker-mechanical-spine-exemptions.json (new)（exemption list 棘轮，exit[]/json[] 从空起步）
- orchestration/SPEC-checker-mechanical-spine-contract-2026-08-28.md (new)（契约文档正本）
- plugin/test/checker-mechanical-spine-check.test.mjs (new)（负控制测试，14 断言）
- plugin/scripts/checker-mutation-cases/checker-mechanical-spine-check.sh (new)（mutation case：exit 4 注入必红）
- plugin/scripts/capability-catalog.sh（注册：QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 五表 + matching=position）
- plugin/scripts/runner-static-gate.ts（注册进 run_static_checks，@static-tier full）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照 scripts=299，`verify-delivery-surface --write-inventory` 机械重算）
- plugin/skills/manager/SKILL.md（SPEC 声明点：机械脊柱契约入索引）
- plugin/skills/init/SKILL.md（SPEC 声明点：reference-doc 块）
- tasks/gap-b1-mechanical-spine-doc-checker.md（自身）

## Needs-Human

**执行 2026-08-28T18:06:33.724Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
