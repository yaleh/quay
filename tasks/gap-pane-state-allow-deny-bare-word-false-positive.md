---
id: gap-pane-state-allow-deny-bare-word-false-positive
title: 'pane-state-classify.ts PERMISSION_PROMPT_RE 的裸 Allow/Deny 假阳性——agent 任务标题里的 --allow-thin 命中 Allow（/i 大小写不敏感）→ permission-prompt 误判 busy；与 :57-58 已排除 permissions 是同一类坑,裸词换带上下文的形状（by POSITION, never by keyword）'
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`plugin/scripts/pane-state-classify.ts:59-60` 的 `PERMISSION_PROMPT_RE` 含裸 `Allow|Deny`（且 `/i` 大小写不敏感）——agent 任务标题里的 `--allow-thin` 命中 `Allow` ⇒ 判 permission-prompt。inner 是 `bypass permissions on`，结构上根本不会弹权限框，这个信号对它 100% 是噪声。**

### 实证（manager 2026-08-10 17:2x 抓到字面证据 + outer 复核）

- **inner 今日两次触发 monitor 事件「成因：权限确认框出现」，两次都是假的**。第二次抓到触发词就在屏幕上：
  ```
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent · ↓ to manage
  ◯ general-purpose  Re-running scoped test with **--allow-thin**   11m 15s · ↓193.4k tokens
  ◯ general-purpose  Updating orchestrator-tick-core.md C16 discip…  11m  9s · ↓200.0k tokens
  ```
- **根因（按位置引实现）**：`pane-state-classify.ts:59-60`
  ```ts
  const PERMISSION_PROMPT_RE =
    /Do you want to proceed|Quick safety check|trust this folder|Enter to confirm|Grant access|Allow|Deny|Y\/n\b/i;
  ```
  裸 `Allow`（`/i` 大小写不敏感）命中 `--allow-thin`；同族 `Deny` 命中任何含 `deny`/`denied` 的任务标题。
- **该文件自己的注释踩过同坑并写下了教训（`:57-58`）**：
  「Deliberately does NOT match the word "permissions" (the "bypass permissions on" mode indicator
  appears in every status line of this fleet — a real capture tripped on exactly that)」
  ⇒ 当时对 `permissions` 做了排除，但 `Allow`/`Deny` 这两个更短更常见的裸词留下了。

### 为什么值得修（不是忍）

1. **同类先例已在测试里**：`plugin/test/pane-state-classify.test.mjs:140,161` 已钉住「`bypass permissions on` 不算 permission-prompt」——正是对裸词排除的既有回归。`Allow`/`Deny` 是同一条教训的未完部分。
2. **inner 是 `bypass permissions on`**：结构上不会弹权限框 ⇒ 对它而言这个信号 100% 是噪声。
3. **代价不是「多一条通知」：它教上层去处置一个不存在的阻塞**。manager 两次都实查了 pane 才没误判；若照事件成因去动作（去点确认 / 判 inner 卡死而重启），两次都会做错事。

### 修法（裁定归 outer，实现归 inner）

把裸词换成**带上下文的形状**，与该正则其余分支保持同一风格（by POSITION, never by keyword——`drive-contract-check.ts` / `test-framework-policy-check.ts` 已解决两次的同一形态）：

- `Allow` → `^\s*[❯>]?\s*(?:1\.\s*)?Allow\b` 或 `Allow\b.*\n.*\bDeny\b`（真对话框里两者成对出现且各占一行）
- `Deny` → 同上

**回归用例现成**：把 manager 抓到的真实 pane 文本（含 `--allow-thin` 与 `bypass permissions on`）钉成 fixture，要求分类为 busy 而非 permission-prompt。

**验证锚**：修后 (a) `--allow-thin` 任务标题 pane → busy（非 permission-prompt）；(b) 真权限对话框（`Do you want to proceed` / trust-check / Allow+Deny 成对行）仍判 permission-prompt；(c) `bypass permissions on` 既有回归不退化。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 inner 两次假 permission-prompt monitor 事件 + 屏幕字面证据（`--allow-thin` 命中裸 `Allow`）+ :57-58 同坑注释（本任务 Proposal 已含）
- [ ] AC2: **裸词换形状**——`Allow`/`Deny` 改为带上下文的形状（成对行 / 行首位置），不再单命中标题里的 `--allow-thin`/`deny`
- [ ] AC3: **回归钉住**——真实 pane 文本（含 `--allow-thin` + `bypass permissions on`）fixture → busy 非 permission-prompt；真对话框样本仍判 permission-prompt
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿（含既有 pane-state-classify 测试：permissions 排除、dismissable questionnaire 等）

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：含 `--allow-thin` 的真实 pane fixture 分类 = busy（贴输出）；真对话框样本仍 permission-prompt
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/pane-state-classify.ts（PERMISSION_PROMPT_RE 裸 Allow/Deny → 上下文形状）
- plugin/test/pane-state-classify.test.mjs（新增 fixture：--allow-thin 任务标题 → busy；真对话框成对 Allow/Deny → permission-prompt）
- plugin/scripts/capability-catalog.sh（AC1c gate：改动声明问题——若无需改则不改）
- tasks/gap-pane-state-allow-deny-bare-word-false-positive.md（自身：勾 AC + 贴证据）

## Contract

measure   allow_thin_false_busy = `node --no-warnings --experimental-strip-types plugin/scripts/pane-state-classify.ts --input <pane-with--allow-thin>` 的 stdout 分类
band      allow_thin_false_busy = busy（非 permission-prompt）
invariant real_dialog_still_prompt = 1（真权限对话框仍判 permission-prompt）
invariant permissions_exclusion_kept = 1（bypass permissions on 既有回归不退化）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/pane-state-classify.ts --input '<真实 pane 文本>'`（贴分类输出）
control   裸词换形状；--allow-thin → busy；真对话框仍 prompt；既有不回归
resume    形状替换 / fixture 钉住 / scoped 门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 17:2x 抓到字面证据（inner 两次假 permission-prompt monitor 事件，触发词=`--allow-thin` 命中裸 Allow，`/i` 不敏感）。:57-58 已有 permissions 排除先例注释，Allow/Deny 是同坑未完。裁定：裸词换上下文形状（by POSITION）。实现归 inner，判定归 outer
