---
id: gap-dead-set-closure-repo-root-call-form-false-positive
title: 死集闭包漏认 ${repo_root}/plugin/scripts/<name> 执行形式——after.dead 混入 ≥15 个仍被
  runner-static-gate 执行的 checker（AC158 负控制发现）
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal

AC158 执行批次一的负控制（Plan 步骤 1）发现 `docs/analysis/dead-set-recomputed.json` 的 `after.dead`（112）含假阳性：≥15 个脚本仍被 `plugin/scripts/runner-static-gate.ts`（`scripts/test.sh:268` source、全量套件 `run_static_checks` / 运维 `run_operational_checks` 的执行注册表）与 `runner-tree-state.ts` 真实执行。直接 archive 会让全量 suite 红、违反 AC158 的 AC5（suite 绿）与 DoD（无悬空引用），故 AC158 已置 needs-human，本任务修根因后重算死集。

## Finding

§12e 闭包（`registry-bare-filename-scan.ts`）只识别 `node|bash|sh|tsx … plugin/scripts/<name>` 调用行，漏掉 `run_checker "..." bash "${repo_root}/plugin/scripts/<name>"` 的 `${repo_root}/` 插值形式；其「三天零执行」普查也未把每轮全量套件都跑的 checker 计为执行。已确认活体 15 个：CODE 类 `run_static_checks()` 7（`test-framework-policy-check.sh`:108 / `tmp-leak-pairing-check.sh`:135 / `task-ac-carryover-check.ts`:174 / `check-set-after-change-check.ts`:371 / `ac56-recommended-deordered-check.ts`:458 / `preference-notification-check.ts`:469 / `ac69-slot-queue-gap-check.ts`:482）+ OPERATIONAL 类 `run_operational_checks()` 7（`worktree-node-modules-check.sh`:596 / `outer-tick-log-check.sh`:606 / `suite-bucket-drift-check.ts`:616 / `fan-in-workflow-retirement-check.ts`:637 / `dispatch-record-fingerprint-reason-check.ts`:651 / `per-task-suite-record-check.ts`:664 / `fan-in-materialize-check.ts`:703）+ `assert-clean-tree.sh`（`runner-tree-state.ts:50` path.join 执行）。

## AC

- [x] 闭包补认 `${repo_root}/plugin/scripts/<name>` 执行形式：对已知活体样本 `tmp-leak-pairing-check.sh` 干跑必须命中 `runner-static-gate.ts` 的 run_checker 调用者，命中 0 判谓词写错（零计数的配套动作）
- [x] 重算死集：`after.deadCount` 下降（112 → 不含活体），被摘出的活体连同各自载体行号写入 `extractedByBareFilenameScan` 或同形字段，`docs/analysis/dead-set-recomputed.json` 机器可读落盘
- [x] SPEC 同步：`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` 的 `扫描后死集: N` 写回重算后的正确值（与 JSON `after.deadCount` 一致）
- [x] 不引入新假阴性：重算后 `runner-static-gate.ts`/`runner-tree-state.ts` 等执行核真实执行的脚本均不在 `after.dead`；五面排除（archive/**）不回归

## DoD

`registry-bare-filename-scan.ts` 的闭包能识别 `${repo_root}/plugin/scripts/<name>` 执行形式；重算后的 `after.dead` 不含任何被执行核真实执行的脚本；SPEC `扫描后死集` 与 JSON `after.deadCount` 同步；AC158 可据此重新执行批次 archive 而全量 suite 仍绿。

## Touches

- plugin/scripts/registry-bare-filename-scan.ts
- plugin/test/registry-bare-filename-scan.test.mjs
- docs/analysis/dead-set-recomputed.json
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- tasks/gap-dead-set-closure-repo-root-call-form-false-positive.md
