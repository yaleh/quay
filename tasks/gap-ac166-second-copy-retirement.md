---
id: gap-ac166-second-copy-retirement
title: AC166 判据仍红——.claude 双副本退役（skills 5 + workflows 5 双副本 archive）+
  manager-tick-core.js 迁入 plugin/workflows/
status: done
needs_human_cause: human-adjudication
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-166
---
**type:** execution

## Proposal

**问题（立案当轮实测）**：`goals/AC-166-second-copy-retirement.md`（status=active、goal=GOAL-003）判据现为 fail——`.claude/workflows/manager-tick-core.js` 仍存在、`plugin/workflows/manager-tick-core.js` 缺失、`.claude/skills/` 5 个仍在。AC-166 的 expect 是「`.claude/workflows/manager-tick-core.js` 已不存在 ∧ `plugin/workflows/manager-tick-core.js` 存在 ∧ `.claude/skills` 已空」。

**工作（人 2026-09-02 裁定②「自用与交付同一功能」+ 裁定④「manager 是产品一部分」落地；SPEC §7 #2/#3/#6/#8）**：`.claude/skills/` 5 个（quay-core-bootstrap-methodology / quay-directive / quay-native-methodology / quay-task-to-plan / quay-webui-bootstrap-methodology）与 `.claude/workflows/` 5 个双副本（drain-directives / execute-suite-fix / fan-in-execute / pool-quality-judge / run-routines）是「第二副本」——与 `plugin/` 版重复、会漂移，按 §12 archive（git mv + INDEX 同提交），**不是 rm**。`.claude/workflows/manager-tick-core.js` 是唯一活 workflow（608 次/3 天），**迁入** `plugin/workflows/`（裁定 4），换路径后调用不能断（§11a-② 风险最集中一步）。`plugin/scripts/workflows-dual-copy-drift-check.ts`（§7 #6）随双副本消失失去对象，与其测试、checker-mutation-case 同批 archive。

**正本**：`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §7、§11a-②、§12。**前置已就绪**：archive 机制由 AC157（`gap-archive-mechanism-and-exclusion-wiring` done）建好，`archive/INDEX.tsv` 七字段表头已存在；`archive/**` 排除面已接线（`scripts/test.sh:872`）。

## Plan

1. **先迁 manager-tick-core.js（先接后撤）**：`git mv .claude/workflows/manager-tick-core.js plugin/workflows/manager-tick-core.js`；把 `orchestration/manager-tick-core.md:38` B1 的 `Workflow({scriptPath:'.claude/workflows/manager-tick-core.js', …})` 改到新路径（`plugin/workflows/manager-tick-core.js`，或 `quay:manager-tick-core` 命名空间），并同步 `:78`/`:111` 豁免面清单里的旧路径引用。
2. **archive `.claude/skills/` 5 个**：`git mv .claude/skills/<name>` → `archive/2026-09-07-second-copy-retirement/.claude/skills/<name>`（整目录，保持原始相对路径；`plugin/skills/` 唯一份不动）。
3. **archive `.claude/workflows/` 5 双副本**：`git mv .claude/workflows/<name>.js` → 同批次目录；`plugin/workflows/<name>.js` 版保留不动。
4. **archive drift checker（§7 #6）**：`git mv plugin/scripts/workflows-dual-copy-drift-check.ts` + `plugin/test/workflows-dual-copy-drift-check.test.mjs` + `plugin/scripts/checker-mutation-cases/workflows-dual-copy-drift-check.sh` → 同批次目录（§12b：脚本与自身测试同批，避免孤儿测试或红套件）。
5. **写 `archive/INDEX.tsv`**：每个 archive 对象一行七字段（original_path · archive_path · date · reason_code · evidence · restore_cmd · commit）；reason_code=`second-copy`，evidence 用可复核读数；`git mv` 与 INDEX 行**同一提交**（硬规则 7）。
6. **验证**：AC-166 判据 exit 0（下方 AC1）；全量 `scripts/test.sh` 绿（archive 排除面已接线，若红先查排除面/checker-mutation 悬挂引用）；迁后首个窗口 `quay:manager-tick-core` 调用数 > 0。
7. **收尾三条断言（2026-09-07 needs-human 复核补入；全量 suite 恰好 3 红，全部是本次退役自身的后果）**：
   ① `plugin/scripts/concurrency-literal-check.ts:257` 的 `SCAN_ROOTS` 去掉 `{ dir: ".claude/workflows", … }` 条目，扫描面收敛到 `plugin/workflows/` 唯一份（`:34`/`:249-250`/`:367` 注释同步）；
   ② `plugin/test/concurrency-literal-check.test.mjs:231`（scanSurface covers…）与 `:241`（AC1 显式枚举）两条断言改成 single-source——不再要求 `.claude/workflows/execute-suite-fix.js` 在扫描面里，改断言 `plugin/workflows/…`，并把 `SCAN_ROOTS must name the .claude/workflows root explicitly` 改为断言 `"plugin/workflows"`；AC2 负控制 fixture `plugin/test/fixtures/concurrency-literal/.claude/workflows/bad.js` 同批 `git mv` 到 `plugin/test/fixtures/concurrency-literal/plugin/workflows/bad.js`（负控制必须仍能取假——迁后重跑该条须仍红）；
   ③ `.quay/suite-bucket-reattribution.jsonl:203` 删掉指向被归档的 `plugin/test/workflows-dual-copy-drift-check.test.mjs` 的那一行（`suite-bucket-reattr-ratchet-check` ③-AC8 僵尸条目判据），与归档同提交。

## AC

- [x] AC1（AC-166 判据逐字 exit 0）：`[ -e .claude/workflows/manager-tick-core.js ] && exit 1; [ -f plugin/workflows/manager-tick-core.js ] || exit 1; [ "$(ls -A .claude/skills 2>/dev/null | wc -l)" = 0 ] || exit 1; exit 0`
- [x] AC2（5 双副本退役）：`for f in drain-directives execute-suite-fix fan-in-execute pool-quality-judge run-routines; do [ ! -e .claude/workflows/$f.js ] || exit 1; [ -f plugin/workflows/$f.js ] || exit 1; done; exit 0`
- [x] AC3（旧 scriptPath 引用清零）：`grep -c "scriptPath: *['\"]\.claude/workflows/manager-tick-core\.js" orchestration/manager-tick-core.md` == 0
- [x] AC4（drift checker archive）：`[ ! -e plugin/scripts/workflows-dual-copy-drift-check.ts ] && [ ! -e plugin/test/workflows-dual-copy-drift-check.test.mjs ] && [ ! -e plugin/scripts/checker-mutation-cases/workflows-dual-copy-drift-check.sh ]` exit 0
- [x] AC5（archive 对象落地 + 同一提交）：13 个 archive 对象（5 skills 目录 + 5 workflow 文件 + drift-checker 3 文件）的 original_path 均不存在、archive_path 均存在（AC158 同形判据）；`git mv` 与 INDEX 写入同一提交（`git log -1 --name-only` 同时含被移路径与 `archive/INDEX.tsv`）
- [x] AC6（全量 suite 绿）：`scripts/test.sh` exit 0（archive/** 排除生效、无悬空引用）
- [x] AC7（迁后调用 > 0）：迁后首个窗口 `quay:manager-tick-core` 调用数 > 0（读生产载体 transcript，非 fixture；608 次/3 天路径换文件后必须仍在跑）
- [x] AC8：`node plugin/scripts/task-schema-check.ts tasks/gap-ac166-second-copy-retirement.md` exit 0

## DoD

`goals/AC-166-second-copy-retirement.md` 的 criterion 命令 exit 0（`.claude/workflows/manager-tick-core.js` 已不存在 ∧ `plugin/workflows/manager-tick-core.js` 存在 ∧ `.claude/skills` 已空），goal-driver 下一轮 verdict 由 fail 转 pass（读 `.quay/goal-round.jsonl` 中 AC-166 的 verdict）；迁后首个窗口 `quay:manager-tick-core` 实测调用数 > 0（读生产载体，非 fixture）；全量 suite 绿。⛔ 只 rm 不 archive、或 move 与 INDEX 分两次提交、或迁后 manager-tick-core 调用恒 0 ⇒ 不算达成。

## Touches

- plugin/workflows/manager-tick-core.js（迁入，新路径）
- plugin/workflows/fan-in-execute.js（自举 WARN 块 .claude/workflows → plugin/workflows 自引用）
- .claude/workflows/manager-tick-core.js（迁出）
- orchestration/manager-tick-core.md（B1 scriptPath + 豁免面引用改新路径）
- .claude/skills/quay-core-bootstrap-methodology/SKILL.md（整目录 git mv，含 inventory/、reference/ 全部文件）
- .claude/skills/quay-directive（symlink → ../../plugin/skills/quay-directive，整目录 git mv）
- .claude/skills/quay-native-methodology/SKILL.md（整目录 git mv，含 examples/ inventory/ reference/ scripts/ templates/ 全部文件）
- .claude/skills/quay-task-to-plan/SKILL.md（整目录 git mv，含 prompts/ 全部文件）
- .claude/skills/quay-webui-bootstrap-methodology/SKILL.md（整目录 git mv，含 reference/ 全部文件）
- .claude/workflows/drain-directives.js
- .claude/workflows/execute-suite-fix.js
- .claude/workflows/fan-in-execute.js
- .claude/workflows/pool-quality-judge.js
- .claude/workflows/run-routines.js
- plugin/scripts/workflows-dual-copy-drift-check.ts
- plugin/test/workflows-dual-copy-drift-check.test.mjs
- plugin/scripts/checker-mutation-cases/workflows-dual-copy-drift-check.sh
- archive/INDEX.tsv（新增行）
- archive/2026-09-07-second-copy-retirement/.claude/skills/**（迁入）
- archive/2026-09-07-second-copy-retirement/.claude/workflows/**（迁入）
- archive/2026-09-07-second-copy-retirement/plugin/scripts/**（迁入）
- archive/2026-09-07-second-copy-retirement/plugin/test/**（迁入）
- plugin/scripts/runner-static-gate.ts（移除 drift-check 块 + @static-object 改 plugin 路径）
- plugin/scripts/capability-catalog.sh（移除 workflows-dual-copy-drift-check 5 条目）
- plugin/test/plugin-packaging.test.mjs（M143 双副本断言改 single-source）
- plugin/skills/init/SKILL.md（声明 manager-tick-{criteria,sending,closing}.md reference-doc）
- orchestration/manager-tick-prompt.txt（B1 scriptPath 改新路径）
- orchestration/manager-tick-closing.md（豁免面清单路径同步）
- plugin/scripts/red-on-omission-audit.ts（execute-suite-fix.js 引用改 plugin 路径）
- plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh（execute-suite-fix.js fixture 路径 .claude/workflows → plugin/workflows）
- plugin/scripts/config-wiring-check.ts（run-routines/drain-directives 引用改 plugin 路径）
- plugin/scripts/fan-in-materialize-check.ts（DEFAULT_WORKFLOW_REL 改 plugin 路径）
- plugin/scripts/checker-mutation-cases/fan-in-materialize-check.sh（fan-in-execute.js fixture 路径 .claude/workflows → plugin/workflows）
- plugin/scripts/select-static-checks-for-touches.ts（FAN_IN_ORCHESTRATION_FILES 移除 .claude 双副本条目）
- plugin/scripts/task-file-bypass-check.ts（移除 .claude/workflows/fan-in-execute.js 双副本条目）
- docs/analysis/quay-init-closure-ratchet.baseline.json（re-anchor，manager-tick-core 迁入 plugin/workflows）
- plugin/test/select-tests-for-touches.test.mjs（spawnTestSh 加 QUAY_TEST_SKIP_QUAY_REFRESH，nested 选择 spawn 免 ~35s refresh）
- scripts/test.sh（QUAY_TEST_SKIP_QUAY_REFRESH 跳过 worktree .quay refresh——nested 选择/冒烟 spawn 不付全量 refresh 成本）
- scripts/test-coverage-check.ts（EXCLUDE_DIR_NAMES 加 archive——归档测试文件不再判为孤儿）
- plugin/scripts/select-tests-for-touches.ts（SKIP_DIRS 加 archive，归档测试不再入 scoped 选测集）
- plugin/test/fan-in-materialize-check.test.mjs（.claude/workflows → plugin/workflows fixture 路径）
- plugin/test/pool-quality-judge.test.mjs（workflow 路径 .claude/workflows → plugin/workflows）
- docs/analysis/test-file-baseline.txt（重算，归档测试文件移除出 baseline）
- plugin/test/codex-stage1-adapter.test.mjs（A3 指令面改 .agents 唯一份 + .claude/skills 退役断言）
- scripts/agents-claude-drift-check.ts（移除 .claude/skills/quay-directive 退役副本检查）
- plugin/test/execute-suite-fix-scope-gate.test.mjs（COPIES 去 .claude 双副本，AC1 改 single-source）
- plugin/test/execute-suite-fix-relaunch-snapshot.test.mjs（COPIES 去 .claude 双副本，AC3 改 single-source）
- plugin/test/fan-in-execute-paths.test.mjs（.claude/workflows → plugin/workflows fixture 路径）
- plugin/scripts/workflow-metadata-conformance.mjs（默认文件列表去 .claude 双副本）
- experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs（镜像同步，与 plugin 版 byte-identical）
- plugin/test/workflow-metadata-conformance.test.mjs（REAL_* 改 plugin 路径 + AC9 镜像判据退役）
- plugin/scripts/concurrency-literal-check.ts（SCAN_ROOTS 去 .claude/workflows，扫描面收敛到 plugin/workflows 唯一份）
- plugin/test/concurrency-literal-check.test.mjs（scanSurface / AC1 两条断言改 single-source）
- plugin/test/fixtures/concurrency-literal/.claude/workflows/bad.js（AC2 负控制 fixture 迁出）
- plugin/test/fixtures/concurrency-literal/plugin/workflows/bad.js（AC2 负控制 fixture 迁入）
- .quay/suite-bucket-reattribution.jsonl（删被归档测试的僵尸条目，③-AC8）
- tasks/gap-ac166-second-copy-retirement.md（自身）
## Needs-Human

**执行 2026-09-07T21:48:48.584Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 成因类：human-adjudication
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
- run_id：wk-prod-1788779505
- session_id：8107b479-64e8-4624-84f3-22a33432ccff
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-ac166-second-copy-retirement~wk-prod-1788779505~1788817345879-821503.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-ac166-second-copy-retirement-wk-prod-1788779505.log

## Needs-Human 复核（manager 2026-09-07，人裁定「派发」）

**结论：假 needs-human，退回 ready 续做。** 逐条读 suite 日志尾部计数 `# pass 7034 / # fail 3`，三条红全部点名如下、且**全部是本次退役自身的直接后果**：

- `scanSurface covers the executable layer …`（`plugin/test/concurrency-literal-check.test.mjs:231`）
- `AC1: the scan surface EXPLICITLY enumerates .claude/workflows/ + plugin/workflows/`（同文件 `:241`，判词 `the seam file must be in the surface`）
- `③-AC8 — the real reattribution file has NO zombie entries`（判词逐字 `got ["plugin/test/workflows-dual-copy-drift-check.test.mjs"]`）

**为什么修不动**：这三个文件当时**都不在本任务 `## Touches` 里** ⇒ fan-in 的 fix-scope gate 判 `other-task` defer ⇒ 3 轮 anti-livelock ⇒ needs-human。已按 Plan 第 7 步补进 Touches，⛔ 不是放宽判据。

**worktree 侧已完成的部分（复核实测，非自述）**：`.claude/workflows/manager-tick-core.js` 已移出、`plugin/workflows/manager-tick-core.js` 已在、`.claude/skills` 已空、`archive/INDEX.tsv` 13 行 —— AC1/AC2/AC5 的对象面已就位，只差这 3 条断言与随后的全量绿。
