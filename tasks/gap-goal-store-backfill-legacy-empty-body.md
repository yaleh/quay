---
id: gap-goal-store-backfill-legacy-empty-body
title: 三条存量 achieved GOAL（GOAL-005/007/008）body 为空、业务目标全挤在 origin：回填可读 body 使
  AC-208 判据归零
status: done
labels:
  - gap
  - goal-store
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-208
---
**type:** execution

## Proposal

**判据现状（实测，非主张）**：AC-208 的判据 = 非 superseded/retired 的 GOAL 中 `body < 40` 非空白字符的条数 == 0。此刻 `goal-store.ts list` 得 **3 条**不满足：

| GOAL | status | body 长度 |
|---|---|---|
| GOAL-005 | achieved | 0 |
| GOAL-007 | achieved | 0 |
| GOAL-008 | achieved | 0 |

（GOAL-004 / GOAL-006 已 superseded，不在 AC-208 判据范围，不回填。）

**根因**：这三条 GOAL 的实质内容（背景 / 范围与非目标 / 退出条件）全文挤在 `origin` 字段，markdown body 为空。`body` 必填（`MIN_GOAL_BODY_CHARS=40`）由 `gap-goal-record-completeness-undefined`（done）落地，但 `goal-store.ts` 的 `if (!existingFile)` 把契约限定为 **create-only**（为放行 driver 的 status-only flip）⇒ 存量三条从未回填——那条任务自己在注释里写明「存量空 body goal 本任务故意不回填」。本任务即其互补半边：回填数据。

**修法**：把三条 GOAL 的 body 从各自 `origin` 已有的实质内容回填为三节（`## 背景` / `## 范围与非目标` / `## 退出条件`）。**素材已全部在 origin，不新编**——对 achieved 的 GOAL，退出条件按「当时要达成什么、现已达成」如实回填（记录历史业务目标，不是再立新目标）。

**写入路径**：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts write <id> --body <markdown> --origin <该条现有 origin 逐字>`——`write` 会整块重写 frontmatter，故 origin 必须逐字回传（`write` CLI 强制 `--origin`）；body 经 `commitGoalFile` 落盘即提交（store-commit）。等价替代：直接改 `goals/GOAL-*.md`，在 frontmatter 闭合 `---` 之后补 body 段落、不动 frontmatter——`list` 读的 body 就是 frontmatter 之后的 markdown，两条路径殊途同归。

**数据-only，无代码改动、无新测试文件**：AC-208 的判据本身就是常驻再评估（goal-driver 每轮对 active AC 跑判据），是本改动的永久守卫；无需另立测试。

## AC

- [x] AC1（AC-208 判据逐字，exit 0）：`test "$(node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts list | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(1 for r in d if str(r.get("id","")).startswith("GOAL-") and str(r.get("status")) not in ("superseded","retired") and len((r.get("body") or "").strip())<40))')" -eq 0`——读真实 `goals/` 载体，非注入 fixture。
- [x] AC2（枚举 + 可读性，防 40 字符占位符）：逐条跑 `for id in GOAL-005 GOAL-007 GOAL-008; do node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts get $id | python3 -c 'import json,sys; d=json.load(sys.stdin); b=(d.get("body") or "").strip(); print(d.get("id"), len(b), all(w in b for w in ("背景","范围","退出条件")))'; done`——三条都打印 `len(b)>=40` 且末列 `True`（业务目标三节都在 body 里可读）。

## DoD

- 三条 GOAL 的 body 已回填并提交（store-commit 或等价 commit），`goal-store.ts list` 的 AC-208 判据为 0 条——在真实 `goals/` 载体上成立，不是 fixture/注入。
- 每条回填 body 含「背景 / 范围与非目标 / 退出条件」三节、各节可读，内容取自各自 origin（不新编、不占位）。

## Touches

- `goals/GOAL-005-develop-doc-21-26-conflict.md`
- `goals/GOAL-007-done-fixture.md`
- `goals/GOAL-008-store-kind.md`
- `tasks/gap-goal-store-backfill-legacy-empty-body.md`