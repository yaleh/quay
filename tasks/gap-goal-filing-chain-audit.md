---
id: gap-goal-filing-chain-audit
title: goal-filing 整链审计：filed 行的 taskId 与任务落地状态交叉核对
status: todo
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-driver-filing-ledger
goal_ac: AC-937
---
## Proposal

AC-937 的判据只做两次**互不相干**的存在性检查：`.quay/goal-filing.jsonl` 里有一条 `state:"filed"` 且 `ac:"AC-937"` 的行，以及 `tasks/*.md` 里**任意**一份带 `goal_ac: AC-937` 且 `status: done` 的任务。它从不把两者绑在一起——`filed` 行的 `taskId` 字段没有任何读者。两个后果都与「合格」同形（硬规则 3b）：

（a）**预置认领**：一份事先写好的、带 `goal_ac: AC-937` 的 done 任务就能让判据通过，而 driver 的立案路径从未发生——正是 GOAL-914 范围里「该任务不是预置」要排除的那一种。
（b）**挂空**：`filed` 行指向的 `taskId` 还停在 `todo`（或该任务文件已改名/删除）；只要另有任一份 done 任务认领同一 AC，判据照样通过，而台账回答不了「这次立案后来怎么样了」。

同族的 `gap-goal-driver-filing-ledger` 已经把 `filed` / `not-filed` 与 `taskId` 落盘，但它的测试止步于台账自身的写入与核对，没有任何读者把 `taskId` 拿回任务文件核一遍。于是 GOAL-914 对 AC-937 写的「整链在真实账本中可回查」没有可运行的读面：今天的唯一办法是手写 `node -e` 一次性脚本（本 AC 的判据本身就是这么写成的），而它区分不了上面两种形态。

本任务补这个读面：一个只读审计器，把每条 `filed` 行的 `taskId` 与任务文件的 `goal_ac` / `status` 交叉核对，并把「有 done 任务认领该 AC、却没有任何 `filed` 行指向它」单独报成 `unfiled-claim`（预置探针）。它不写任何东西，不改任务状态，也不进入任何门的判据链。

<!-- dedup-ref -->与 `gap-goal-driver-filing-ledger` 的关系是机制相邻而非重复：那条任务产出台账的写入与 `filed` / `not-filed` 判定，本任务只消费它落下的 `filed` 行做交叉核对；两者 Touches 无重叠，故独立立案。

## Plan

1. 读 sibling 任务落地的台账 API（`readGoalFilingLedger` 由 `plugin/scripts/goal-driver.ts` 导出）并 **import 复用**，⛔ 不复制第二份解析器；若落地后的导出名或行形态不同，以 develop 上的实现为准，差异写进证据文档。
2. 新增 `plugin/scripts/goal-filing-chain-audit.ts`：`--root <ws>`（缺省 cwd）、`--ac <AC>`（可重复，缺省审全部）、`--json`。对每条终态 `filed` 行解析 `tasks/<taskId>.md` 的顶层 `goal_ac` 与 `status`，落枚举 verdict：`landed` / `task-missing` / `goal-ac-mismatch` / `not-done`；再用「带该 `goal_ac` 的 done 任务」减去「被 filed 行指向的 taskId」，剩下的报 `unfiled-claim`。
3. 三态退出（硬规则 3b）：`0` = 至少一条 filed 行 `landed` 且零 `unfiled-claim`；`1` = 链断（任一非 `landed`，或存在 `unfiled-claim`）；`2` = **未评估**（台账读不动 / 无匹配的终态 filed 行 / 参数非法）——⛔ 不得与 `0` 同形，`--json` 带 `evaluated:false` 与 `cause`。
4. 新增测试 `plugin/test/goal-filing-chain-audit.test.mjs`：正控（spawned→filed→done 全链 ⇒ 0）与四条负控（`task-missing` / `goal-ac-mismatch` / `not-done` / `unfiled-claim` 各自 ⇒ 1），以及空台账 ⇒ 2。
5. 按 `plugin/scripts/capability-catalog-declarations.json` 的既有条目形态登记（`QUESTION` 必填，`CONSUMER` / `CADENCE` / `INVALIDATION` 按实填写），`bash plugin/scripts/capability-catalog.sh --json` 的 unclassified 计数不增加。
6. live 证据：对真实工作区跑一次审计，把命令与逐字输出（含 verdict / `evaluated` / `cause`）写进 `docs/evidence/2026-11-06-goal-filing-chain-audit.md`。

## AC

- [ ] `node --test plugin/test/goal-filing-chain-audit.test.mjs` 退出码 0，用例覆盖 `landed` / `task-missing` / `goal-ac-mismatch` / `not-done` / `unfiled-claim` 五种取值。
- [ ] 负控可在测试中逐条读到：`filed` 行指向 todo 任务 ⇒ 退出 1 且 verdict 是 `not-done`；存在 done 任务认领该 AC 但无 filed 行指向它 ⇒ 退出 1 且报 `unfiled-claim`（⛔ 不得因「另有 done 任务」被判 0）。
- [ ] 未评估是独立取值：空台账、只有 `spawned` 行、`--ac` 指向从未立案的 AC，三种输入都退出 2（不是 0），且 `--json` 中 `evaluated:false` 并给出 `cause`。
- [ ] `bash plugin/scripts/capability-catalog.sh --json` 退出码 0，新脚本的 `question` 非空（unclassified 计数不增加）。
- [ ] live 证据：对真实工作区运行审计，`docs/evidence/2026-11-06-goal-filing-chain-audit.md` 逐字记录命令与输出，并解释取得的 verdict（不是只用 fixture）。

## DoD

真实交付物是 `plugin/scripts/goal-filing-chain-audit.ts` 这个只读审计器、它的测试、目录登记，以及一份**真实工作区**的读数。落地判据：审计器在 develop 上能对真实的 `.quay/goal-filing.jsonl` 跑出可解释的 verdict——若此刻还没有 `filed` 行，读数就是 `evaluated:false`，必须逐字记录并写出下一轮复核点，⛔ 不得拿 fixture 输出冒充生产读数；负控必须证明「有 done 任务认领 AC 而台账无 filed 行」不会返回 0。全量 `bash scripts/test.sh` 绿。

## ADR-007 dark axis

- 该轴仍暗,理由:本任务只新增一个只读审计脚本与其测试，不改动既有模块的依赖边，未产生 L_D/L_G 数值读数。

## Touches

- plugin/scripts/goal-filing-chain-audit.ts (new)
- plugin/test/goal-filing-chain-audit.test.mjs (new)
- plugin/scripts/capability-catalog-declarations.json
- docs/evidence/2026-11-06-goal-filing-chain-audit.md (new)
- tasks/gap-goal-filing-chain-audit.md