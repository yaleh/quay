---
id: gap-ac81-registry-receipt-and-four-criteria
title: 三层各有注册表收据 + 每轮四判据核实（AC81，人 14:2xZ 裁定）——当前 outer/inner 无此机制
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

**（三层各有注册表收据 + 每轮四判据核实——人 2026-08-14 14:2xZ 裁定「把三层统一应用 CronCreate 加入本阶段目标和 AC，包括配套工作」）**。

**现状（manager 14:2xZ meta-cc 实测）**：
```
manager  ✅ 注册表收据 + 每轮四判据核实（连续 17 轮全真）
outer    ❌ 无此机制   ← 本任务 outer 侧
inner    ❌ 无此机制   ← 本任务 inner 侧
```

**四判据（manager 形态，判据全部能取假）**：
```
① CronList 恰一条
② id == 注册表（registry 里的 cron id）
③ --verify（锚点校验）
④ 锚点校验（sha256）
```

**⊢ 能取假实证（manager 09:1xZ）**：多传 `--home` 覆盖默认值 ⇒ 读成 registry-missing ⇒ 差点误报「88 轮断了」——判据可被输入形态污染，必须每轮核实。

**判据1**：outer + inner 各有注册表收据（cron id + prompt sha256 进 registry）。
**判据2**：每轮四判据核实（CronList 恰一条 ∧ id==注册表 ∧ --verify ∧ 锚点校验）。
**判据3**：⛔ 不因「窗口/暂停」跳过核实——每轮必跑。
**判据4**：与 AC79（inner CronCreate 锚）/ AC80（prompt 正本）配套。
**判据5（7 天硬上限剩余寿命——manager 14:2xZ 报）**：CronCreate 文档写明「**Recurring tasks auto-expire after 7 days**——fires one final time, then deleted. This bounds session lifetime.」⇒ **三层锚都会 7 天后静默消失**，注册表收据能查出「CronList 空」但无提前预警。**⊢ 核实步骤须报锚的剩余寿命**（`CronCreate 时刻 + 7 天 − now`），**< 24h 即报**。能取假：现在剩余 ≈7 天判据为 false，到第 6 天翻 true。

**不覆盖**：不改唤醒机制本体；不在窗口内改。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 manager 的注册表收据形态（registry + CronList 四判据）。
2. 判据1：outer + inner 各有注册表收据。
3. 判据2：每轮四判据核实。
4. 判据3：不因窗口/暂停跳过。
5. 判据4：与 AC79/AC80 配套。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：outer + inner 各有注册表收据。
- [ ] AC2 判据2：每轮四判据核实。
- [ ] AC3 判据3：不因窗口/暂停跳过。
- [ ] AC4 判据4：与 AC79/AC80 配套。
- [ ] AC5 判据5：核实步骤报锚剩余寿命（CronCreate 时刻+7 天−now），<24h 即报。
- [ ] AC6 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 三层各有注册表收据 + 每轮四判据核实（CronList 恰一条 ∧ id==注册表 ∧ --verify ∧ 锚点校验）+ 7 天剩余寿命判据（<24h 报）。

## Touches

- plugin/scripts/outer-cron-registry.ts (new，注册表收据检查器——outer+inner 双层四判据核实 + 判据5 剩余寿命)
- plugin/scripts/outer-cron-registry.json (new，git 跟踪注册表收据——inner 025f4132 / outer 4e88cb1b)
- plugin/scripts/capability-catalog.sh（新 script 声明注册——AC1c 闸 0 unclassified）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照——新 plugin/scripts 文件触发的注册同步，`--write-inventory` 重生成）
- plugin/test/outer-cron-registry.test.mjs (new，检查器测试——四判据能取假 + real-data)
- plugin/loop/fast-mode-loop-tick.md（inner 侧注册表收据位置——C17 建议，outer 落地）
- tasks/gap-ac81-registry-receipt-and-four-criteria.md（自身）

## C17 建议（outer-landable —— 落地到 outer 独占的 `plugin/loop/fast-mode-loop-tick.md`，inner 不得直接编辑）

**落点**：`### 6. 重新排程`（src 行 ≈1162-1205，主落点；与 AC79 的 C17 建议同域）+ 冷启动 `/loop` 讨论节（src 行 66-78）。

**建议文案（三步）**：

1. **Step 6 加「注册表收据」小节**（判据1/判据2/判据3）：内层 cron 锚的注册表收据正本 =
   `plugin/scripts/outer-cron-registry.json`（git 跟踪、双层收据：inner 记录 cron id `025f4132`、
   cron 表达式 `7,27,47 * * * *`、prompt sha256 `9a044b01…`、创建时刻 `2026-08-14T15:17:16Z`；
   outer 记录 `4e88cb1b` / `0,20,40 * * * *` / `d520ef85…`）。**每轮 tick 先核实**（判据3：不因窗口/暂停跳过）：
   `bash plugin/scripts/outer-cron-registry.ts --verify --layer inner --cron-list '<CronList json>'`。
   四判据 = ① CronList 恰一条 ∧ ② id==注册表 ∧ ③ registry-verified（收据未过期）∧ ④ prompt sha256==正本。
   四条全真则不动；任一为假才清扫重建（绝不靠记住的 ID）。核实输出还报锚剩余寿命（createdAt+7天−now，<24h 即报）。
2. **`AC80-INNER-ANCHOR` 段同步落地**（判据4 配套）：AC80 建议的 inner 正本段（`AC80-INNER-ANCHOR-BEGIN/END`）
   落进本文件后，判据④ 的「正本」即有真实来源；未落地前 `outer-cron-registry.ts --verify --layer inner`
   报 NOT-EVALUATED（独立取值，非通过——硬规则 3b）。
3. **冷启动 `/loop` 节表述**：注册表收据 + 四判据核实是 cron 锚的机械核验面（同 manager 形态），
   与 AC79 的「cron 锚是主驱动」表述并置。

**判据对应**：判据1（outer+inner 各有注册表收据）由 `outer-cron-registry.json` 覆盖；判据2（每轮四判据核实）
由第 1 步覆盖；判据4（与 AC79/AC80 配套）由第 2 步覆盖。

## Evidence

（2026-08-14 回填——注册表收据 + 四判据核实器 + 测试已落地）

- **注册表收据** `plugin/scripts/outer-cron-registry.json`（git 跟踪、可查——判据1）：
  - inner：cron id `025f4132` / cron 表达式 `7,27,47 * * * *` / prompt sha256
    `9a044b019e52054834e6b9a3b67cc471467d981670d73ecd28b9d851dfd6bab5`（815B 指针 prompt）/ createdAt
    `2026-08-14T15:17:16Z`（AC79 Evidence 回填提交 46d1b4c7，git 可见锚确认时刻）。
  - outer：cron id `4e88cb1b` / cron 表达式 `0,20,40 * * * *` / prompt sha256
    `d520ef85537a4a32bdf5c93688e945da091bff846388d80da12a6780b8036ac9`（166B 指针 prompt）/ createdAt
    `2026-08-14T15:21:19Z`（outer-tick-prompt.txt 正本提交 72b99cda）。
- **四判据核实器** `plugin/scripts/outer-cron-registry.ts`：`--verify --layer <inner|outer> --cron-list '<json>'`
  逐条判据能取假（① CronList 恰一条 / ② id==注册表 / ③ verifiedAt 未过期 registry-verified / ④ 注册表
  promptSha256==当前正本 sha256），判据5 报锚剩余寿命（createdAt+7天−now，<24h 即报，exit 1）。退出码
  0=OK / 1=VIOLATED / 2=NOT-EVALUATED（正本缺失或未提供 --cron-list —— 硬规则 3b 独立取值，非通过）。
  CronList 活视图经 `--cron-list` 传入（会话内工具，脚本无法直接调用；镜像 AC80 的 --cron-prompt 接缝）。
- **real-data 判据测试**（`plugin/test/outer-cron-registry.test.mjs`，20 条全绿）：真实 inner prompt（025f4132）
  与真实 outer prompt（4e88cb1b）作正本 + 注册表 sha256 对照，四判据全真 exit 0、剩余寿命 ≈7 天（判据5 不触发）；
  负控四判据能取假（id 不匹配 / 正本一字符漂移 / CronList 0 条、2 条 / verifiedAt 过期）+ 判据5 <24h 触发。
- **注册联动**（新 plugin/scripts 文件的两处机械同步，AC1c 闸 0 unclassified）：
  `plugin/scripts/capability-catalog.sh` 已声明 outer-cron-registry.ts 的 question + cadence(每轮) + invalidation
  + last-reaffirmed(2026-08-14) + matching + CONSUMER；`docs/proposals/quay-product-outline.md` §6
  DELIVERY-INVENTORY 已 `--write-inventory` 重生成（scripts disk=250=snapshot）。
- **`--for-task` scoped 门**：`scripts/test.sh --for-task gap-ac81-registry-receipt-and-four-criteria --allow-thin`
  在任务 worktree 内 **exit 0**；**fan-in-ts-typecheck-gate** `--merge-target develop` **admitted（exit 0）**。
- 提交：见本任务 worktree 分支 `task/gap-ac81-registry-receipt-and-four-criteria` 的 git log。
