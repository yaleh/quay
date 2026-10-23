---
id: gap-release-model-check-mutation-case-and-manifest-enrollment
title: release-model-check.ts 是唯一 P4-suspicious 守卫（never-fired 且无 mutation
  case、未进任何被解析的注册面）⇒ 补 per-invariant 变异验证并接入 run_static_checks，使其从 suspicious 翻到
  preventive
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

P4 守卫谱系检测器（`plugin/scripts/guard-lineage-check.ts`）在 2026-10-23 的现场读数里**只剩一个 suspicious**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/guard-lineage-check.ts --json
totalGuards 198  declaredCount 8
"suspicious": [
  { "basename": "release-model-check.ts",
    "dir": "plugin/scripts",
    "reason": "never-fired and not mutation-verified — indistinguishable from a broken guard (P4 定义)" }
]
"preventive": [ checker-mechanical-spine-check.ts, checker-mutation-check.sh, instrument-decay-check.ts,
                manager-tick-log-check.sh, outer-tick-log-check.sh,
                release-master-advance-needs-check.ts (plugin/scripts),
                release-master-advance-needs-check.ts (experiments/…/scripts) ]   # 7 条
```

四组独立读数共同证明这不是"预防性守卫"而是**未验证缺口**：

1. **从未运行/从未变红**：`.quay/checker-cost.jsonl` 里 `grep -c '"name":"release-model-check"'` = **0**（同族 `release-master-advance-needs-check` = 260 行）。
2. **没有 mutation case**：`ls plugin/scripts/checker-mutation-cases/ | grep -cE '^release-model-check\.sh$'` = **0**；该目录只有 `release-freshness-check.sh` 与 `release-master-advance-needs-check.sh` 两个 release 前缀 case。
3. **不在任何被解析的注册面**：`grep -c "release-model-check" scripts/test.sh plugin/scripts/runner-static-gate.ts .github/workflows/ci.yml` = **0 / 0 / 0**。
4. **连 manifest 都进不去**：`bash plugin/scripts/checker-mutation-check.sh --list --json` ⇒ `checkers_total: 87`，`checkers[]` 中**没有** `release-model-check`，`uncovered: []`（uncovered 只统计"已注册但无 case"的 checker，未注册的它连报都报不出来）。

**为什么这是缺陷**：suspicious 的定义就是 `never-fired ∧ ¬mutation-verified`——它与"一个完全坏掉、永远不会红的守卫"在输出上不可区分（硬规则 3b 的同形问题）。同家族的 `release-master-advance-needs-check` 同样 never-fired，但它在 `checker-mutation-cases/` 有 case 且在 `run_static_checks` 有注册位 ⇒ 归 preventive。`release-model-check.ts` 两者都缺，且**主检出上它当前是真实 pass**（`line-readable`=pass / `line-parked-on-tag`=pass / `advance-ci-needs`=pass，exit 0）——即"能跑绿"从未被证明，只是从未见红。

**登记的第二个缺口（更致命）**：`checker-mutation-check.sh` 的 manifest **从不手写**，只从 `runner-static-gate.ts` 的 `run_static_checks` / `run_operational_checks`、`scripts/test.sh` 的 `run_doc_checks`、以及 CI workflows 解析（`checker-mutation-check.ts:23-30`）。`release-model-check.ts` 在这些面里 0 命中 ⇒ **只补一个 case 文件会落进 hard rule 4 推论三的"回声"形态：没有任何机件执行它**。本任务必须同时完成 ① 变异验证（case）与 ② 接入被解析的注册面（manifest 自动拾取）。

**登记面的真实约束（不先说明会踩雷）**：`/.quay/config.yml` 被根锚定 gitignore（`.gitignore:601`），fresh checkout / CI（CI 直接跑 `bash scripts/test.sh`，`.github/workflows/ci.yml:346`）里没有 `release:` 节 ⇒ checker 返回 `exit 4 / not-configured`；而 `run_checker` 只把 exit 3 当 NOT-EVALUATED 放行（`checker-cost-lib.sh:158-161`），**exit 4 是 RED**。⛔ 因此不能简单写 `run_checker ... --root "${repo_root}"`：那会把所有没有本地 `.quay/config.yml` 的检出判红。注册面必须喂**确定性 fixture**（同 done 先例 `manager-tick-log-check` 的做法），或只在 config 存在的条件下执行；两种做法都要证明 fresh-checkout 形态仍绿。

**可用接缝（已在当前源码确认）**：CLI `--root <dir> [--json] [--print-globs|--print-model]`；三条不变量 id = `line-readable` / `line-parked-on-tag` / `advance-ci-needs`（`release-model-check.ts:222/239/261` 起）；四态 exit `0 pass / 1 fail / 3 not-evaluated / 4 not-configured`。case 脚本契约（`checker-mutation-check.ts:49-56`）：`bash <case>.sh <workdir>`；**exit 0** = 基线绿→注入红→恢复绿全程成立，**3** = STAYED-GREEN（没逮住），**4** = ALWAYS-RED（恢复后仍红），**2** = 基础设施错误。

<!-- dedup-ref -->
去重与谱系：prior-claim = `gap-release-branch-model-hardcoded-not-configurable`（done）。它落地了 `release-model-check.ts` 与四态单测，但其 AC 从未要求 mutation case 或注册面接入；2026-10-23 按**当前源码**复核，缺陷仍逐字可见（上面四组读数）⇒ 不是"旧任务已修好"（done ≠ absent，硬规则 5b）。本条与它是**不同机制**（创建 meter vs 给 meter 补"被证明能红"的证据），故单独立案，并把旧 id 作为 traceability 携带。另：`gap-manager-tick-log-check-mutation-case`（done）是同形先例，本任务按它落地，但作用于不同的守卫。⛔ 不修改 `guard-lineage-check.ts` 的 suspicious 判定（其 AC4 反向判据明确禁止把"未验证"当 preventive）；⛔ 不放宽阈值、不把未验证算作 preventive。

## AC

- [ ] AC1（复现固化·修复前读数）：在动手前用同一组命令复跑并贴出 BEFORE 读数：①`node --no-warnings --experimental-strip-types plugin/scripts/guard-lineage-check.ts --json` 的 `suspicious` 段逐字只含 `release-model-check.ts`；②`grep -c '"name":"release-model-check"' .quay/checker-cost.jsonl` = 0；③`ls plugin/scripts/checker-mutation-cases/ | grep -cE '^release-model-check\.sh$'` = 0；④`bash plugin/scripts/checker-mutation-check.sh --list --json` 的 `checkers_total` 与 `release-model-check` 缺席；⑤`grep -c "release-model-check" scripts/test.sh plugin/scripts/runner-static-gate.ts .github/workflows/ci.yml` = 0/0/0。
- [ ] AC2（case 存在、可执行、per-invariant 注入+恢复）：新增 `plugin/scripts/checker-mutation-cases/release-model-check.sh`，`bash plugin/scripts/checker-mutation-cases/release-model-check.sh "$(mktemp -d)"` **exit 0**，输出同时证明以下每个相位（全部在临时 fixture git repo 上驱动**真实** checker，用真实 CLI 而非 import）：①基线（`release:` 节 + 发布线 tip 打 tag + advance job 的 `needs:` 覆盖全部其它 job）⇒ exit 0，三条不变量全 pass；②`line-parked-on-tag` 注入（tag 之后提交）⇒ exit 1，且 `--json` 里该不变量 id 的 state 为 `fail`；恢复 ⇒ exit 0；③`line-readable` 注入（删除/改名声明的发布线分支）⇒ exit 1，`--json` 里 `line-readable` state=`fail`；④`advance-ci-needs` 注入（从 advance job 的 `needs:` 删掉一个 job）⇒ exit 1，`--json` 里 `advance-ci-needs` state=`fail`；恢复 ⇒ exit 0；⑤四态区分：无 `release:` 节 ⇒ exit 4 / `not-configured`，节存在但不可读（非法 mapping/空值）⇒ exit 3 / `not-evaluated`，二者都不与 0/1 共用取值。贴出 case 完整运行输出与每个相位的 `--json` 片段。
- [ ] AC3（case 承重·负控制）：把 `line-parked-on-tag` 的判定临时短路为恒 `pass`（只在 scratch 副本或改后立即还原；提交前 `git diff -- plugin/scripts/release-model-check.ts` 必须为空）后，AC2 的②相位必须**不再 exit 0**——case 应报 STAYED-GREEN（exit 3）或其它非零，证明该相位真的在测这条判据，而不是靠别的分支顺带变红。贴出短路前后的 case 退出码对照。
- [ ] AC4（manifest 自动拾取·不是手写名单）：`release-model-check` 出现在 `bash plugin/scripts/checker-mutation-check.sh --list --json` 的 `checkers[]`（`covered: true`，`source` 来自 `run_static_checks`），且 `bash plugin/scripts/checker-mutation-check.sh --check --only release-model-check` **exit 0**。注册位必须在**被解析的函数体**内（`runner-static-gate.ts` 的 `run_static_checks()` 或 `run_operational_checks()`），贴出该行机器可解析的 `run_checker` 调用与其 `# @static-tier` / `# @static-object` 注解；同时按 `checker-count-drift-check.ts` 的规则更新 `# @checker-count` 注解（加一条 `run_checker` 就必须 +1），并贴出 `node --no-warnings --experimental-strip-types plugin/scripts/checker-count-drift-check.ts --root .` exit 0。⛔ 不得在 manifest 里手写名单/绕过解析器。
- [ ] AC5（fresh-checkout 安全·exit 4 不得变成套件红）：证明注册面在**没有 `.quay/config.yml` 的检出**上仍绿。二选一并贴证据：①注册调用把 `--root` 指向本次运行建立的确定性 fixture（贴出 fixture 构建行与 `--root` 实际取值，不含 `${repo_root}` 作为 checker 的被测根）；或②注册行以 `[ -f "${repo_root}/.quay/config.yml" ]` 之类条件守卫并在缺席时输出可区分的 NOT-EVALUATED 行（贴出该分支在临时目录/无 config 检出上的实际输出与 exit 0）。⛔ 不允许把 checker 的 `not-configured` 语义改成 pass（硬规则 3b）。
- [ ] AC6（生产载体·不是 fixture 回显）：跑一次 `bash scripts/test.sh --for-task gap-release-model-check-mutation-case-and-manifest-enrollment`（或等价地真实执行 `run_static_checks`），之后 `.quay/checker-cost.jsonl` 里出现 **≥1** 条 `"name":"release-model-check"` 行；贴出 `grep '"name":"release-model-check"' .quay/checker-cost.jsonl | tail -1` 的真实行（含 `verdict`）。这是硬规则 4 推论三要求的生产载体读数：证明注册面**被执行过**，而不只是 case 在 `--only` 下被人跑过一次。
- [ ] AC7（P4 判定翻转·生产读数 = 判据）：修后重跑 `node --no-warnings --experimental-strip-types plugin/scripts/guard-lineage-check.ts --json`，`suspicious` 里**不再含** `release-model-check.ts`（应为空或只剩与本任务无关的项），且它出现在 `preventive`。贴出修后 `preventive` / `suspicious` 两段逐字。同时 `git diff <base> -- plugin/scripts/guard-lineage-check.ts` 为空（判定阈值与分类逻辑一字未改）。
- [ ] AC8（回归）：`node --no-warnings --experimental-strip-types plugin/test/release-model-check.test.mjs` exit 0；`bash plugin/scripts/checker-mutation-check.sh --check` exit 0 且 `uncovered: []`；`bash scripts/test.sh --for-task gap-release-model-check-mutation-case-and-manifest-enrollment` 绿（若 scoped 门因合法原因不选某项，附上 full-suite 或等价证据）。

## DoD

真实落地：`plugin/scripts/checker-mutation-cases/release-model-check.sh` 在**真实 checker** 上走完"基线绿 → 三条不变量各自的注入红 → 恢复绿"，且该 case 被 `checker-mutation-check.sh` 的**自动解析 manifest**拾取并执行（`--list --json` 中 `covered: true` + `--check --only release-model-check` exit 0）；注册面真实执行后 `.quay/checker-cost.jsonl` 落下 `release-model-check` 行；`guard-lineage-check.ts` 的**生产读数**把该守卫从 `suspicious` 移到 `preventive`，且该检测器本体未改一字。⛔ 只新增一个 case 文件而无人执行 → 回声，不算完成；⛔ 靠改 `guard-lineage-check.ts` 的判定/阈值消掉这条 → 不算完成；⛔ 让无 `.quay/config.yml` 的检出变红 → 不算完成。

## Touches

- plugin/scripts/checker-mutation-cases/release-model-check.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/release-model-check.ts
- plugin/test/release-model-check.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-release-model-check-mutation-case-and-manifest-enrollment.md