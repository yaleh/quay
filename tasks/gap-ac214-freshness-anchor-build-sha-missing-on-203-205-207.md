---
id: gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207
title: AC-214 新鲜度元判据读 build_sha，而 AC-203/205/207 落账记录不写它（207 只有异仓库 commit_sha）→
  三条载体 AC 达成后仍恒 exit 1
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-214
---
## Proposal

正本判据 `goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md`（goal=GOAL-009）：exit 0 = 载体 `.quay/productization-verification.jsonl` 中 AC-201/203/205/207 四条各自最新证据记录的 `build_sha` 到 develop-tip 的【交付面提交距离】均 ≤ K（默认 200，`QUAY_GOAL009_FRESHNESS_K` 可配）；exit 1 = 任一条无证据或陈旧；exit 3 = 载体缺失 / rev-list 读不出（NOT-EVALUATED）。

**现状（实测，位置判定）**：criterion 逐字 `sha = r.get("build_sha") or r.get("commit")`（只认这两个字段名），而四条载体记录的落账字段契约（各 sibling task 的 Plan「载体落账」步骤）只有 AC-201 带 `build_sha`：
- AC-201（已 achieved，载体已 1 条、top-level `build_sha` ✓）：`{ts, ac, build_sha, tgz_sha256}`。
- AC-203（`gap-driver-runtime-driver-path-anchored-at-project-root-not-dist`）：`{ts, ac, host, project_root, has_plugin_dir, driver_alive, carrier_records}` —— **无 build_sha/commit**。
- AC-205（`gap-ac205-session-delivery-channel-transcript-confirmed`）：`{ts, ac, host, shipped_from_installed_artifact, transcript_confirmed}` —— **无 build_sha/commit**。
- AC-207（`gap-ac207-e2e-target-driver-driven-real-commit-task-done`）：`{…, commit_sha, task_id, task_status, gate_events, produced_by_driver}` —— 只有 `commit_sha`，且它是**第三方项目 git 的提交 sha（异仓库）**；AC-214 读的 `commit` ≠ `commit_sha`，且即便读了，`git rev-list --count <异仓库 sha>..develop` 会 fatal ⇒ NOT-EVALUATED。

**结构缺口**：即便 AC-203/205/207 全部达成并各自落账，AC-214 对这三条 `sha` 恒取不到值 ⇒ 三条永远在 `missing` ⇒ **恒 exit 1**。这恰是 AC-214 要防的形态的反面同形——它防「载体里存在过一条记录就永久算数」，而它自己的字段契约让它**永远读不到那三条记录**。

**修法**：把新鲜度锚统一为 top-level `build_sha`（= 本仓库 `BUILD_SHA`，build 时刻 develop-tip，`verify-deliver-coldstart.sh` 已计算、天然是 develop 祖先），四条记录一律带它；落点 = `verify-deliver-coldstart.sh` 的 `--ac89` 追加面（唯一 choke point）。⛔ `commit_sha`（AC-207）是异仓库 sha，**不得**当新鲜度锚；⛔ 不引用已归档零调用的 `productization-verification-record.ts`/`-check.ts`。

## Plan

1. **共享锚写入 helper**：`plugin/scripts/verify-deliver-coldstart.sh` 新增 `ac89_append_goal009()` —— 入参 = 该条记录除 `build_sha`/`ts` 外的 JSON 片段，函数统一补 top-level `"build_sha":"${BUILD_SHA}"` + `"ts":"${TS}"` 后 `printf >> "$AC89"`；`BUILD_SHA` 非 40-hex 时**不写且 exit 非 0**（fail-closed，硬规则 3b）。把已落地的 AC-201 追加面改造成走该 helper。
2. **兄弟任务落账契约对齐**：AC-203/205/207 三个 sibling task 的 Plan「载体落账」步骤改为经 `ac89_append_goal009()` 落账——各自保留 AC 专属字段（`host`/`driver_alive`/`commit_sha` 等），`build_sha` 由 helper 统一补；每个任务体各改一行。
3. **三向控制 + 测试钉**：合成载体跑 AC-214 criterion 验证 exit 0 / exit 1 / exit 3 三向；`plugin/test/verify-deliver-coldstart.test.mjs` 断言 helper 补 `build_sha`（正/负）。

## Acceptance Criteria

- [x] AC1 机制（choke point）：`grep -n 'ac89_append_goal009\|"build_sha"' plugin/scripts/verify-deliver-coldstart.sh` 命中 ≥1，且 helper 对每条 `GOAL-009-AC-*` 记录统一补 top-level `build_sha`（40-hex）；贴前 3 条命中（硬规则②）。
- [x] AC2 兄弟契约对齐：`grep -c 'ac89_append_goal009' tasks/gap-driver-runtime-driver-path-anchored-at-project-root-not-dist.md tasks/gap-ac205-session-delivery-channel-transcript-confirmed.md tasks/gap-ac207-e2e-target-driver-driven-real-commit-task-done.md` 各 ≥1；贴命中行。
- [x] AC3 正向控制：合成载体含四条 `GOAL-009-AC-20{1,3,5,7}` 记录、各自 top-level `build_sha` = 近 K 内 develop 祖先 ⇒ AC-214 criterion exit 0（贴干跑输出）。
- [x] AC4 负控制（陈旧转红）：把 AC3 中某条 `build_sha` 换成 434 个交付面提交之前的 develop 祖先 ⇒ criterion exit 1 `stale evidence:…`；验证后移除合成记录（不污染生产载体）。
- [x] AC5 负控制（异仓库 sha 不作锚）：合成一条 `ac="GOAL-009-AC-207"` 但只有 `commit_sha`（异仓库 sha）、无 `build_sha` 的记录 ⇒ criterion 仍 exit 1（`no evidence yet:…`），证明新鲜度锚只认 `build_sha`；验证后移除。
- [x] AC6 fail-closed：`BUILD_SHA` 空或非 40-hex 时 `ac89_append_goal009()` 不写该记录且 exit 非 0；实测 `--verify-only`（无 build）路径不追加 `GOAL-009-AC-*` 记录（硬规则 3b）。
- [x] AC7 测试钉：`plugin/test/verify-deliver-coldstart.test.mjs` 断言 helper 补 `build_sha`（正：注入 40-hex `BUILD_SHA` ⇒ 写出含 `build_sha` 记录；负：空 ⇒ 不写）；`scripts/test.sh` 全量绿。

## Definition of Done

AC1–AC7 全绿；`scripts/test.sh` 全量绿（含 `plugin/test/verify-deliver-coldstart.test.mjs`）。合成载体验证 AC-214 criterion 三向（exit 0/1/3）全对。⛔ 本任务只到「新鲜度元判据可读、可转红、锚字段统一为 `build_sha`」这一层；四条载体记录的**各自实际落账**由 sibling tasks（AC-201 已 achieved / AC-203/205/207 ready）在 host B/C 生产复跑时产出，本任务保证它们带 `build_sha` 锚。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-driver-runtime-driver-path-anchored-at-project-root-not-dist.md
- tasks/gap-ac205-session-delivery-channel-transcript-confirmed.md
- tasks/gap-ac207-e2e-target-driver-driven-real-commit-task-done.md
- tasks/gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207.md

## Evidence

AC1 机制：`grep -n 'ac89_append_goal009\|"build_sha"' plugin/scripts/verify-deliver-coldstart.sh` 命中前 3 条——
`399:ac89_append_goal009() {` / `402:…echo "ac89_append_goal009: BUILD_SHA not 40-hex…` / `405:…AC89 path empty…`；helper 对每条 GOAL-009-AC-* 统一补 top-level `build_sha`（40-hex，fail-closed）。
AC2 兄弟契约：`grep -c 'ac89_append_goal009'` 三个 sibling task 各 =1（gap-driver-runtime:28 / gap-ac205:35 / gap-ac207:29）。
AC3 正向：合成载体四条 GOAL-009-AC-20{1,3,5,7} 各带 develop-tip `build_sha` ⇒ AC-214 criterion **exit 0**。
AC4 负向：把 AC-207 的 `build_sha` 换成 441 交付面提交之前的 develop 祖先 ⇒ **exit 1** `stale evidence: GOAL-009-AC-207:441>200`；验证后已移除合成记录。
AC5 负向：AC-207 只有 `commit_sha`（异仓库 sha）无 `build_sha` ⇒ **exit 1** `no evidence yet: GOAL-009-AC-207`（新鲜度锚只认 `build_sha`）；验证后已移除。
exit 3：载体缺失 ⇒ **exit 3** `NOT-EVALUATED: carrier absent`（三向全对）。
AC6 fail-closed：`BUILD_SHA=not-a-sha` 与 39-hex 均 `return 1` 且不写；`--verify-only` 只写 `ac="AC88"`、`grep -c 'GOAL-009-AC-'` = 0。
AC7 测试钉：`node --test plugin/test/verify-deliver-coldstart.test.mjs` 10/10 绿（含 goal009-anchor 正/负断言）。