---
id: gap-ac201-productization-verification-build-sha-tgz-sha256-record
title: verify-deliver-coldstart --ac89 追加面不写 GOAL-009-AC-201 记录 → 产物可溯源判据恒 exit
  1（AC-201）
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-201
---
## Proposal

正本判据 `goals/AC-201-现-build-产物完整且可溯源-产物记录锚在-develop-祖先-commit-tgz-sha256.md`（goal=GOAL-009）：exit 0 = 载体 `.quay/productization-verification.jsonl` 存在 `ac="GOAL-009-AC-201"` 记录，其 top-level `build_sha` 是 develop 祖先且 top-level `tgz_sha256` 非空；exit 1 = 无此记录；exit 3 = 载体缺失。

**现状（实测，位置判定）**：载体存在（21KB，`grep -o '"ac":"[^"]*"'` 得 AC85×1 / AC86×1 / AC88×4 / AC168-marketplace×2 共 7 行），`grep -c '"ac":"GOAL-009-AC-201"'` = 0 ⇒ 判据 exit 1。

**根因（读代码，非猜测）**：`plugin/scripts/verify-deliver-coldstart.sh` 的 `--ac89` 追加面（:1076-1098）只写 `ac="AC88"`（npm-global）与 `ac="AC168-marketplace"` 两种 tag，且 `build_sha` / `sha256_quay` 只塞在 `detail` 字符串里、非 top-level 字段。AC-201 criterion 读 top-level `ac` / `build_sha` / `tgz_sha256` ⇒ 无记录命中。

**修法**：在 `--ac89` 追加面（:1098 之后）新增一条 `ac="GOAL-009-AC-201"` 记录，字段 `{ts, ac, build_sha, tgz_sha256}`：`build_sha=${BUILD_SHA}`、`tgz_sha256=${SHA256_QUAY}`。⛔ 仅当 `${BUILD_SHA}` 非空且 `${SHA256_QUAY}` 非空才 append（缺输入不写、不冒充合格——硬规则 3b）。`BUILD_SHA` 来自 `build_from_develop_tip` 的 `git rev-parse refs/heads/develop`（:326）⇒ 天然是 develop 祖先，满足 criterion 的 `--is-ancestor`。⛔ 不引用已归档零调用的 `productization-verification-record.ts` / `-check.ts`（AC-201 origin 明令）。随后一次性生产跑 `--build-root <repo>` 落一条真实记录使判据 exit 0。

## Acceptance Criteria

- [x] AC1 机制：`--build-root`（或 `--build-sha` + 真实 `--tgz`）路径下，`--ac89` 载体追加一条 `ac="GOAL-009-AC-201"` 且 top-level `build_sha`（40-hex）/ `tgz_sha256`（64-hex）非空的记录（字段在顶层，非 detail 字符串）。
- [x] AC2 干跑：生产载体 `.quay/productization-verification.jsonl` 出现 `ac="GOAL-009-AC-201"` 记录，`git merge-base --is-ancestor <build_sha> develop` 退出 0 且 `tgz_sha256` 非空 ⇒ AC-201 criterion exit 0（当前 exit 1）。
- [x] AC3 负控制：在载体上追加一条 `ac="GOAL-009-AC-201"` 但 `build_sha=40×0` 的记录 ⇒ criterion 仍 exit 1（判据能取假，非恒绿）；验证后移除该记录、不污染生产载体。
- [x] AC4 缺输入不写：`BUILD_SHA` 或 `SHA256_QUAY` 为空时不写该记录——实测 `--verify-only`（无 build）路径不追加（硬规则 3b，缺值≠合格）。
- [x] AC5 自检钉：把新记录追加抽成函数（如 `append_ac201_record()`），`--selfcheck` 加正/负控制——正：注入 40-hex BUILD_SHA + 64-hex SHA256_QUAY ⇒ 写出 ac=GOAL-009-AC-201 记录且两字段非空；负：BUILD_SHA 空 ⇒ 不写（`--selfcheck` exit 0）。`plugin/test/verify-deliver-coldstart.test.mjs` 同步断言字段形态。

## Definition of Done

- [x] AC1–AC5 全绿；`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` exit 0；`scripts/test.sh`（含 verify-deliver-coldstart.test.mjs）全绿。
- [x] AC-201 criterion 从 exit 1 → exit 0（贴出干跑输出）。⛔ 本任务只到「产物记录可溯源」这一层；driver 真活（AC-203）与端到端（AC-207）是下游，各自另有 task。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac201-productization-verification-build-sha-tgz-sha256-record.md
