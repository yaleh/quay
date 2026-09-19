---
id: gap-arch-coverage-self-report
title: 分析仪器覆盖面自报：按语言列出谁分析了它，未分析者标 NOT-EVALUATED（含 archguard 默认 global scope
  只覆盖部分 TS 的显式读数）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**建分析仪器覆盖面自报 `plugin/scripts/arch-coverage-report.ts`：对仓库每种语言输出「谁分析了它、分析了多少」，未分析者一律标 `NOT-EVALUATED`，让「archguard 报 0 环」不再能冒充「无环」。**

来源：`orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md`（下称 SPEC；⚠️ 此刻位于分支 `worktree-spec-architecture-refactor`，可能尚未在 develop 上——**本任务体自足**）§1.1 / §2 P6 / §5 Phase 0c。

**为什么需要它（2026-09-19 实测）**：
- archguard 的默认「global scope」（`.archguard/query/manifest.json` 的 `globalScopeKey`）只指向 `packages/quay/src`（446 实体）；`plugin/scripts`（254 个 .ts、2879 实体）与 `experiments/…/scripts`（649 实体）是**独立 scope**，直接调 `archguard_summary` 不会看到它们。
- `plugin/scripts` 在 archguard 里被当成单个 `(root)` 包，`detect_cycles` 返回 `[]`，而同批文件的 import 图有 3 个 SCC ⇒ **该工具的输出词表里没有「未评估」一态**。
- 约 300 个手写非测试 `.mjs`/`.js` 与 144 个真 `.sh` 完全不被解析。
- 既有任务 `gap-archguard-scope-expand-provider-packages-experiments`（done）扩的是 archguard **扫描范围**；本任务不重复它，做的是**覆盖面的自报**（哪些语言/目录没被任何 scope 覆盖）。

**输出契约**：`node --experimental-strip-types plugin/scripts/arch-coverage-report.ts [<root>] [--json] [--selftest] [--archguard-manifest <path>]`；`--json` 至少含：
- `languages:[{language, trackedFiles, analyzedBy: string|null, status: "analyzed"|"NOT-EVALUATED", reason?}]`，语言取 ts / mjs / js / sh / py（按扩展名，数据源 `git ls-files`，排除 `*.test.*`、`/test/`、`node_modules`、`dist`、`vendor`、`archive/`；**禁用 `find`**——一次 `find` 曾扫进 `.claude/worktrees/*` 把 `.sh` 数污染成 5213）。
- `archguard:{manifestFound, globalScopeKey, globalScopeSources, globalScopeCoversTsFraction, scopes:[{key,sources,entityCount}]}`；`uncoveredTsDirs:[…]`（tracked 的非测试 .ts 所在目录中，不在任何 scope 的 sources 之内者）。
- `evaluated:true|false`（读不懂 manifest/git 不可用 ⇒ `evaluated:false`，exit 2）。

**判定规则（硬规则 3b：必须有独立的「未评估」取值）**：
- ts：仅当 archguard manifest 存在**且**该 ts 文件所在目录落在某个 scope 的 sources 内，才 `analyzed`（`analyzedBy` = 该 scope key）；manifest 缺失 ⇒ 整个 ts 行 `NOT-EVALUATED`，`reason:"manifest-missing"`；部分覆盖 ⇒ 行 `status:"analyzed"` 但 `uncoveredTsDirs` 非空，并在 `reason` 里写明覆盖比例。
- mjs/js/sh/py：当前无任何分析器 ⇒ `analyzedBy:null`、`NOT-EVALUATED`、`reason:"no-analyzer"`。
- 本检查器**只报告，不做门**（exit 0 表示「报告已产出」，不表示「全部已评估」）。它不接入 `runner-static-gate.ts`。若将来要做成棘轮，是另一个任务。

**新增脚本的义务**：`plugin/scripts/capability-catalog.sh` 六张表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）各补一行（键=basename）；新测试文件用 `node:test` 并声明 `// @test-group <name>`。因为它不进 `run_static_checks`，不需要 `checker-mutation-cases` 与 `@checker-count`（若 `checker-mutation-check.sh --check` 或 `checker-count-drift-check.ts` 仍报缺失，以它们的判定为准并在 notes 说明）。

## Touches

- plugin/scripts/arch-coverage-report.ts
- plugin/test/arch-coverage-report.test.mjs
- plugin/scripts/capability-catalog.sh
- .gitignore
- tasks/gap-arch-coverage-self-report.md

## AC

- [ ] AC1（自检能取假）`node --experimental-strip-types plugin/scripts/arch-coverage-report.ts --selftest` exit 0，输出逐行枚举 ≥6 个具名注入用例：manifest 缺失 ⇒ ts 行 `NOT-EVALUATED` 且 `reason:"manifest-missing"`（**不是** analyzed）；manifest 的 scope 只含 `packages/quay/src` 而仓库另有 `plugin/scripts/*.ts` ⇒ `uncoveredTsDirs` 含 `plugin/scripts`；无任何 `.sh` 的 fixture ⇒ sh 行 `trackedFiles:0` 而不是缺行；`.mjs` 存在 ⇒ `NOT-EVALUATED`；manifest 是坏 JSON ⇒ `evaluated:false` 且 exit 2（**不是 0**）；非 git 目录 ⇒ exit 2。
- [ ] AC2（真样本，零计数的配套）真实仓库根 `--json`：`evaluated===true`；`sh` 行与 `mjs` 行均 `NOT-EVALUATED` 且 `trackedFiles>0`——**「未评估集为空」视为检查器失效**；`sh` 行 `trackedFiles` 等于独立命令 `git ls-files '*.sh' | grep -v 'checker-mutation-cases/' | grep -v '^archive/' | wc -l` 的输出（口径一致才算数）。
- [ ] AC3（默认 scope 陷阱被显式报出）在存在 `.archguard/query/manifest.json` 的环境里，`--json` 的 `archguard.globalScopeSources` 反映 manifest 里 `globalScopeKey` 对应的 sources（本仓库当前应为 `packages/quay/src`），且 `globalScopeCoversTsFraction` < 1（该值 = 落在 global scope 内的 tracked 非测试 .ts 数 / 全部 tracked 非测试 .ts 数）。若该环境无 `.archguard`（它是生成物、可能不在 worktree 内），此条改验：`--archguard-manifest <真实 manifest 路径>` 得到同样结论，路径与命令写进 notes。
- [ ] AC4（口径不被污染）`--json` 里所有语言的 `trackedFiles` 合计不含 `.claude/worktrees/` 下任何文件：用独立命令 `git ls-files | grep -c '^\.claude/worktrees/'` 得 0，且报告的 ts 行 `trackedFiles` 等于 `git ls-files '*.ts'` 经同样排除规则的独立计数。
- [ ] AC5（登记）`bash plugin/scripts/capability-catalog.sh --entry-surface` exit 0；`bash plugin/scripts/capability-catalog.sh --summary` 的脚本数自报值比落地前 +1 且 UNCLASSIFIED=0。
- [ ] AC6（生产载体，非 fixture）在真实仓库根（非 fixture 目录）运行一次 `--json` 并把完整输出保存为 `.quay/arch-coverage-report.latest.json`（该路径必须被 `.gitignore` 覆盖——新记录载体须同轮带 ignore 规则，否则会被 `git add -A` + checkout 抹掉）；AC2–AC4 的结论在该载体文件上成立，而不是只在 selftest 里成立。

## DoD

真实落地标准：报告已在**真实仓库**上产出，并显式列出未评估集（至少 `sh`、`mjs`、`js`），且 `archguard.globalScopeCoversTsFraction` 给出 global scope 只覆盖了部分 TS 这一事实（今天的读数就是「不是全部」）。**负控制已实做并留证**：临时把 manifest 改名/损坏后重跑，ts 行变 `NOT-EVALUATED`（或 exit 2），恢复后回到 `analyzed`，两次输出贴进 notes——证明「检查通过」不是恒真的。本任务**只报告，不改 archguard 配置、不改 `packages/**`、不接入套件门**。
