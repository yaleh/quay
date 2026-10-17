---
id: gap-arch-coverage-report-report-only-not-run-in-production
title: arch-coverage-report 是 report-only、生产从不跑——「哪些目录没有任何分析器到达」仍不可查
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/arch-coverage-report.ts:26` 自证「REPORT ONLY, NEVER A GATE」，且只有其自身测试引用它、无生产调用。它存在的理由正是回答「哪些语言/目录没有任何 scope 到达」——这个量在生产上仍然不可查。ClaudeCodeUI 侧的教训（`.mjs`/`.sh`/`.jsx` 不可见、整仓 scope 冒充覆盖）说明「未评估≠干净」在覆盖面维度需要生产读数。⚠️ 本任务不做 ratchet——保留 report-only 语义，只补生产触发 + 基线。

## Plan

1. 把 arch-coverage-report 作为例程或 suite 报表跑起来（挂进 quality-gate-driver 的例程轨或 test.sh 报表位，report-only、不 ratchet）。
2. 存基线：每次跑把 per-language/per-directory 覆盖读数 append 进一个可查载体（如 `.quay/arch-coverage-history.jsonl`）。
3. 报表顶部显式输出 NOT-EVALUATED 目录/语言数（已有三态：analyzed / NOT-EVALUATED / evaluated:false），作为「覆盖未完成」的可见读数。

## Acceptance Criteria

- [x] AC1（能取假·生产产出）落地后一条 post-landing 例程轮在覆盖率载体里产生新记录（真跑，非仅实现）；无新记录即假。（待外部）
- [x] AC2（未评估可见）载体记录含 NOT-EVALUATED 计数，且对无分析器的语言（mjs/js/sh/py）非零。
- [x] AC3（非 ratchet）report-only：NOT-EVALUATED 非零不使例程轮 failed（区别于「红了」）。

## Definition of Done

arch-coverage-report 在例程/报表位真跑并留可查基线；NOT-EVALUATED 计数在生产可读；AC1–AC3 勾。

## Touches

- plugin/scripts/quality-gate-driver.ts（例程轨接线，或 scripts/test.sh 报表位）
- plugin/scripts/arch-coverage-report.ts（追加基线载体写入）
- plugin/test/arch-coverage-report.test.mjs（基线载体写入断言）
- plugin/test/quality-gate-driver.test.mjs（例程轨接线断言）
- .gitignore（新基线载体的 gitignore 声明）
- docs/carrier-registry.json（新基线载体的 carrier 登记）
- tasks/gap-arch-coverage-report-report-only-not-run-in-production.md

## Evidence

- **AC2（载体含 NOT-EVALUATED 计数；无分析器语言非零）** —— 对**主检出** `/data/home/yale/work/quay` 真跑一次 `runArchCoverageRound`，追加到载体的行（节选）：
  `"notEvaluatedLanguages":["mjs","js","sh","py"],"noAnalyzerLanguages":["mjs","js","sh","py"],"notEvaluatedLanguageCount":4,"noAnalyzerLanguageCount":4,"totals":{"trackedFiles":7719,"countedFiles":814,"analyzedFiles":523,"notEvaluatedFiles":291},"uncoveredTsDirs":["experiments/quay-perpetual-stream/fixtures/preparation","scripts"],"uncoveredTsDirsEvaluated":true`
  四个无分析器语言各自 `trackedFiles > 0`（mjs 126 / js 14 / sh 145 / py 6）且 status=`NOT-EVALUATED`、reason=`no-analyzer`（同一行的 `languages` 数组）。测试：`plugin/test/arch-coverage-report.test.mjs` 的 `history record — … (AC2)`、`appendHistoryRecord — … (AC2)`、`--record-history writes exactly one baseline line …`。
- **AC3（report-only：NOT-EVALUATED 非零 ≠ failed）** —— 同一次真跑返回 `state:"verified"`、`reason:null`，而 `value.notEvaluatedLanguageCount:4`；⛔ 不是 `failed`。测试 `runArchCoverageRound — enabled ⇒ VERIFIED while NOT-EVALUATED is non-zero … (AC2/AC3)`。负控制（failed 仍可达，证明这不是「永不 failed」）：`runArchCoverageRound — bad config and an unwritable carrier ARE failed`（坏配置与不可写载体 ⇒ failed）。
- **例程接线** —— 声明式注入（`loop.arch_coverage_report:`）：段缺席 ⇒ 例程表逐条不变（`archCoverageRoutineFromConfig — an UNDECLARED workspace keeps EXACTLY the four built-in routines`，AC144 的「恰好四条」仍成立）；`enabled:false` ⇒ `not-evaluated:disabled` 且零写入；段写坏 ⇒ `failed` 且零写入；三种启动装配行互不相同。`bash scripts/test.sh --for-task gap-arch-coverage-report-report-only-not-run-in-production --allow-thin` ⇒ exit 0（静态检查全 PASS + 87 tests pass / 0 fail）。
- **AC1（待外部）** —— 生产调度轮需要两步外部动作（本 worker 不代做）：① 落地后 quality driver 重启并加载新代码；② 在主检出 `.quay/config.yml` 的 `loop:` 下声明：
  `arch_coverage_report:` / `enabled: true` / `interval: interval:360m`
  （该文件 gitignored、不进任何分支；例程是该族的 **off by default**，未声明 ⇒ 例程表不变且零写入——这正是 AC144「恰好四条」得以保持的原因）。取假判据：落地后 `.quay/arch-coverage-history.jsonl` 中出现 `ts` 晚于落地的记录；无新记录即假。本 worker ⛔ 不代判该生产时间窗。
- **AC1（待外部 → 已满足）** —— 生产例程轮在落地后真跑：`.quay/arch-coverage-history.jsonl` 记录 `ts=2026-10-17T07:02:50.500Z` > 落地时刻 `2026-10-17T05:49:20.592Z`，`runner:"arch-coverage-report.ts"`、`evaluated:true`、`notEvaluatedLanguageCount:4`（mjs/js/sh/py, no-analyzer）、ts 覆盖 515/523=98.5%、`globalScopeKind:"whole-repo"`（不计入覆盖）。触发 = `loop.arch_coverage_report: enabled:true, interval:360m` 声明 + `quay driver restart --kind quality`。
