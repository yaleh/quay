---
id: gap-ownership-active-investigator-holdout-deny-list
title: "ownership-active investigator can read holdout answers:
  DENY_PATH_PATTERNS omits goals/, docs/architecture/, docs/references/,
  docs/plans/, tasks/ and docs/analysis/architecture-evidence-store-* (GOAL-034
  body and the ranked candidate list are readable via read_file/grep)"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

用户要求(2026-10-11 联合回归后续):"保留 GOAL-034 历史为 holdout,不能泄露答案给 investigator"。按位置核实,当前这条保证**没有结构性产物**:`docs/analysis/ownership-active-contract.mjs` 的 `DENY_PATH_PATTERNS`(约第 51-64 行)只拒 `reference.json`/`outcome.json`、`plugin/fixtures/meta-driver-replay/`、`docs/analysis/ownership-*`、`docs/analysis/dossier-evidence/`、两个 corpus spec、`.quay/`、`.git`、`.archguard/`、`.claude/`、`node_modules/`。**未覆盖**的、实测含 holdout 答案或候选排序的路径:

- `goals/GOAL-034-*.md`——GOAL-034 正文,含"把 `loader.ts` 5 个导出整体搬出 `gate/config` ⇒ 4 环缩到 3,但 ownership 错误"的手工推导(正是 2026-10-11 盲测在未发布构建上算出的那条 4→3 切法的人工裁定);
- `docs/architecture/quay-domain-model-2026-10-11.md`——排序候选清单与已拒绝清单;
- `docs/analysis/architecture-evidence-store-replay.md` / `architecture-evidence-store-limited-proposal-report.md`——Holdout B 盲测结果(GOAL-034/035/036 fork-point);
- `docs/references/quay-as-self-improving-engineering-system.md`——GOAL-030~035 案例索引;`docs/plans/`、`tasks/`——历史人类决策与任务正文。

`read_file` 只经 `normalizeRepoPath` 判 deny;`grep` 的输出行经同一个 `denyFilter`——所以上述路径既可被直接读,也会作为 grep 命中行原样返回给 judge。

**发生率(硬规则 12,查历史)**:生产 carrier `.quay/ownership-shadow-proposals.jsonl` 91 条记录的全部 evidence 请求,**0 次**触及上述路径(grep 作用域全部是 `packages/*/src`、`plugin/scripts`、`scripts`、`plugin/test`、`packages/quay/test`)。即:**目前无泄露发生的证据,只是没有任何东西阻止它**(硬规则 9:守与不守在记录上不可区分)。也正因为历史上投研从不需要这些路径,收紧它们对投研能力的成本在已有读数上为 0。

<!-- dedup-ref -->
去重:open 任务对 `holdout`/`DENY_PATH`/`ownership-active` 零命中;`task-granularity-advice` 对本 Touches 无 peer。与 `gap-architecture-evidence-store-and-decision-memory`(done,建立 Holdout A/B 隔离纪律,但只隔离了**决策记忆种子**,未隔离 investigator 的可读路径)互补。

## AC

- [x] AC1 `DENY_PATH_PATTERNS` 新增覆盖:`^goals\/`、`^tasks\/`、`^docs\/architecture\/`、`^docs\/references\/`、`^docs\/plans\/`、`^docs\/analysis\/architecture-evidence-store`(其余既有条目不删不改)。
- [x] AC2 `read_file` 负对照:对 `goals/` 下一个真实存在的 GOAL-034 文件路径、`docs/architecture/quay-domain-model-2026-10-11.md`、`tasks/` 下任一真实任务文件各发一次请求,均被 gate 以 `PATH_DENIED` 拒绝(真实路径,不是编造路径——证明不是"文件不存在"造成的拒绝)。
- [x] AC3 `grep` 输出过滤负对照:用一个在 `goals/GOAL-034-*.md` 与 `packages/quay/src` 下**都**会命中的 pattern(如 `loadWorkspaceGates`),对作用域 `.` 发 grep,断言返回行中**没有**任何以上述被拒前缀开头的行、`denied_rows_dropped > 0`,且 `packages/quay/src` 下的命中行仍然保留(证明不是把 grep 整体关掉)。
- [x] AC4 正对照:对 `packages/quay/src/gate/config/loader.ts` 的 `read_file` 与对 `packages/quay/src` 的 grep 仍然 `ok`——投研的源码证据能力不退化。
- [x] AC5 既有回归全绿:`plugin/test/ownership-active-loop.test.mjs`、`plugin/test/ownership-active-proposal-repair.test.mjs`、`plugin/test/ownership-active-limited-proposal.test.mjs`;`bash scripts/test.sh --for-task gap-ownership-active-investigator-holdout-deny-list` exit 0。

## DoD

`DENY_PATH_PATTERNS` 覆盖全部 holdout 答案面,read_file 与 grep 两条读取路径均有针对**真实** GOAL-034 文件的负对照,源码证据能力有正对照证明未退化。⛔ 不改任何准入门限/streak/fail-closed 行为,不改决策记忆种子,不创建/激活任何 Goal。

## Touches

- docs/analysis/ownership-active-contract.mjs
- docs/analysis/ownership-active-executor.mjs
- plugin/test/ownership-active-loop.test.mjs
- tasks/gap-ownership-active-investigator-holdout-deny-list.md
