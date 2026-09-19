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
goal_ac: AC-306
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

- [x] AC1（自检能取假）`node --experimental-strip-types plugin/scripts/arch-coverage-report.ts --selftest` exit 0，输出逐行枚举 ≥6 个具名注入用例：manifest 缺失 ⇒ ts 行 `NOT-EVALUATED` 且 `reason:"manifest-missing"`（**不是** analyzed）；manifest 的 scope 只含 `packages/quay/src` 而仓库另有 `plugin/scripts/*.ts` ⇒ `uncoveredTsDirs` 含 `plugin/scripts`；无任何 `.sh` 的 fixture ⇒ sh 行 `trackedFiles:0` 而不是缺行；`.mjs` 存在 ⇒ `NOT-EVALUATED`；manifest 是坏 JSON ⇒ `evaluated:false` 且 exit 2（**不是 0**）；非 git 目录 ⇒ exit 2。
- [x] AC2（真样本，零计数的配套）真实仓库根 `--json`：`evaluated===true`；`sh` 行与 `mjs` 行均 `NOT-EVALUATED` 且 `trackedFiles>0`——**「未评估集为空」视为检查器失效**；`sh` 行 `trackedFiles` 等于独立命令 `git ls-files '*.sh' | grep -v 'checker-mutation-cases/' | grep -v '^archive/' | wc -l` 的输出（口径一致才算数）。
- [x] AC3（默认 scope 陷阱被显式报出）在存在 `.archguard/query/manifest.json` 的环境里，`--json` 的 `archguard.globalScopeSources` 反映 manifest 里 `globalScopeKey` 对应的 sources（本仓库当前应为 `packages/quay/src`），且 `globalScopeCoversTsFraction` < 1（该值 = 落在 global scope 内的 tracked 非测试 .ts 数 / 全部 tracked 非测试 .ts 数）。若该环境无 `.archguard`（它是生成物、可能不在 worktree 内），此条改验：`--archguard-manifest <真实 manifest 路径>` 得到同样结论，路径与命令写进 notes。
- [x] AC4（口径不被污染）`--json` 里所有语言的 `trackedFiles` 合计不含 `.claude/worktrees/` 下任何文件：用独立命令 `git ls-files | grep -c '^\.claude/worktrees/'` 得 0，且报告的 ts 行 `trackedFiles` 等于 `git ls-files '*.ts'` 经同样排除规则的独立计数。
- [x] AC5（登记）`bash plugin/scripts/capability-catalog.sh --entry-surface` exit 0；`bash plugin/scripts/capability-catalog.sh --summary` 的脚本数自报值比落地前 +1 且 UNCLASSIFIED=0。
- [x] AC6（生产载体，非 fixture）在真实仓库根（非 fixture 目录）运行一次 `--json` 并把完整输出保存为 `.quay/arch-coverage-report.latest.json`（该路径必须被 `.gitignore` 覆盖——新记录载体须同轮带 ignore 规则，否则会被 `git add -A` + checkout 抹掉）；AC2–AC4 的结论在该载体文件上成立，而不是只在 selftest 里成立。

## DoD

真实落地标准：报告已在**真实仓库**上产出，并显式列出未评估集（至少 `sh`、`mjs`、`js`），且 `archguard.globalScopeCoversTsFraction` 给出 global scope 只覆盖了部分 TS 这一事实（今天的读数就是「不是全部」）。**负控制已实做并留证**：临时把 manifest 改名/损坏后重跑，ts 行变 `NOT-EVALUATED`（或 exit 2），恢复后回到 `analyzed`，两次输出贴进 notes——证明「检查通过」不是恒真的。本任务**只报告，不改 archguard 配置、不改 `packages/**`、不接入套件门**。

## Notes

### 落地读数（AC2/AC3/AC6）

命令（根 = 本任务 worktree；manifest 取主检出的生成物，worktree 内 `/.archguard` 不存在）：

```
node --experimental-strip-types plugin/scripts/arch-coverage-report.ts \
  /home/yale/work/quay-worktrees/gap-arch-coverage-self-report \
  --archguard-manifest /home/yale/work/quay/.archguard/query/manifest.json --json \
  > .quay/arch-coverage-report.latest.json     # exit 0
```

| 语言 | tracked | status | analyzedBy | reason |
|---|---|---|---|---|
| ts | **449** | `analyzed` | `77856690` | `partial-coverage: 439/449 (97.8%) 落在某个 scope 内；GLOBAL scope 77856690 只覆盖 98/449 (21.8%)；5 个目录未覆盖` |
| mjs | **80** | `NOT-EVALUATED` | null | `no-analyzer` |
| js | **15** | `NOT-EVALUATED` | null | `no-analyzer` |
| sh | **144** | `NOT-EVALUATED` | null | `no-analyzer` |
| py | **6** | `NOT-EVALUATED` | null | `no-analyzer` |

- AC3：`globalScopeKey = 77856690`，`globalScopeSources = ["packages/quay/src"]`，`globalScopeCoversTsFraction = 0.2182628062360802`（< 1）。
- `uncoveredTsDirs`（5）：`experiments/quay-perpetual-stream/fixtures/preparation`、`plugin/gate-scripts`、`plugin/test/fixtures/criterion-fidelity`、`plugin/test/fixtures/task-file-bypass/plugin/scripts`、`scripts`。
- 7 个 scope（entityCount / 归到它的 ts 文件数）：`37cd62ff`(4/3) `3f438d8b`(14/3) `48429582`(8/6) `6e556e41`(786/4) `77856690`(446/98) `c045940f`(2879/254) `d74f9c1e`(649/70) —— 合计 439，与 449−10 一致。
- AC6 载体：`.quay/arch-coverage-report.latest.json`；`git check-ignore -v` 命中 `.gitignore:143`；`git status --porcelain <该路径>` 为空（不是「未跟踪但未忽略」）。AC2–AC4 的结论已在该**载体文件**上逐条复验通过（不是只在 selftest 里）。

**⚠️ 本报告自指导致的读数位移（留档，因为它正是本任务要报的那类漂移）**：实现落地前 ts = **448**，`globalScopeCoversTsFraction = 0.21875`；`arch-coverage-report.ts` 一旦被 `git add` 成为 **tracked** `.ts`，读数即变 **449 / 0.21826**（`git ls-files` 只列 tracked 文件；被它排除的测试文件 `arch-coverage-report.test.mjs` 是 `.mjs` 且 basename 含 `.test.`，故 mjs 行 80、sh 行 144 不变）。**测试文件因此按【动态独立计数】断言而不是按字面量**（`caliber — the .ts row equals an independent count` 每次都重新跑 `git ls-files`）——若当初写死 448，套件会在实现提交那一刻转红，而在未提交状态下是绿的：一个「提交前绿、提交后红」的判据，正是硬规则 4b 说的代理量。notes 里的 448 已按最终落盘状态订正为 449。

### 口径（AC2/AC4 的独立计数）

| 命令 | 输出 | 报告值 |
|---|---|---|
| `git ls-files '*.sh' \| grep -v 'checker-mutation-cases/' \| grep -v '^archive/' \| wc -l` | 144 | sh 144 ✓（AC2 逐字命令） |
| `git ls-files '*.ts'` 经同样排除规则 | 449 | ts 449 ✓（AC4） |
| `git ls-files \| grep -c '^\.claude/worktrees/'` | 0 | ✓（AC4 前提） |

**⚠️ 一处与 Proposal 散文的显式偏离（记录为决定，不是静默差异）**：Proposal 的排除清单写了 `/test/`，但 AC2 把 `sh.trackedFiles` 钉在它自己的命令上，而那条命令**保留** `test/`、`plugin/test/`、`packages/quay/test/`。两者同时套用会差 4 个文件（139 vs 144）。**实现取 AC2 的可执行口径**（AC 胜散文），并把该偏离写进 `EXCLUSION_RULES.noteTestDirs`，由 `plugin/test/arch-coverage-report.test.mjs` 的 `caliber — segment-equality exclusion` 用例双向钉住（`plugin/test/delivery.sh`、`test/e2e.sh` 不排除）。

第二个仅凭直觉会踩的坑：`vendor` 若按**子串**匹配会误杀 `plugin/scripts/sync-vendor.sh`（真生产脚本），正是这 1 个文件让朴素口径读出 139。故排除规则一律按**路径段相等**判定；该点也有专项用例。

### DoD 负控制（实做，四态）

把真 manifest **复制**到临时目录，用 `--archguard-manifest <副本>` 连跑四次（⛔ 全程不碰主检出的 `.archguard/`）：

```
(1) BASELINE  manifest 在且合法                       exit=0  evaluated=true   ts.status=analyzed
                                                                              ts.analyzedBy=77856690
                                                                              ts.reason="partial-coverage: 439/449 … 98/449 (21.8%)"  uncovered=5
(2) RENAMED   mv manifest.json manifest.json.renamed   exit=0  evaluated=true   ts.status=NOT-EVALUATED
                                                                              ts.reason="manifest-missing"  ts.analyzedBy=null  uncovered=0
(3) RESTORED  mv 回来                                  exit=0  evaluated=true   ts.status=analyzed（与 (1) 逐字相同）
(4) CORRUPTED printf '{ broken' > manifest.json        exit=2  evaluated=false  ts.status=NOT-EVALUATED
                                                                              ts.reason="manifest-unreadable"
```

⇒ 「检查通过」不是恒真的：(2) 证明 manifest 缺席时**不会**仍报 `analyzed`；(4) 证明读不懂的输入**不返回 0**（且与「缺席」是两个不同取值）；(3) 证明它没有卡在某个状态上。这正是本任务要修的那类缺陷（「读不懂 ⇒ 伪装成检查通过」）的对照。

同一个四态在 `--selftest` 里也各有具名用例（AC1），另有 `plugin/test/arch-coverage-report.test.mjs` 13 个用例做同样断言——**fixture 与生产载体两条路都有**。

### AC1 自检用例（`--selftest` exit 0，逐行枚举，10 个具名用例 / 16 条断言，含上面 ≥6 项全部）

```
SELFTEST PASS: manifest-missing-ts-is-not-evaluated
SELFTEST PASS: manifest-missing-still-evaluated-and-exit-0
SELFTEST PASS: scope-covers-only-quay-src-leaves-plugin-scripts-uncovered      → uncoveredTsDirs=["plugin/scripts"]
SELFTEST PASS: partial-coverage-ts-row-analyzed-with-reason
SELFTEST PASS: partial-coverage-drops-out-of-uncovered-when-scope-widened
SELFTEST PASS: no-sh-files-yields-a-zero-row-not-a-missing-row                 → sh trackedFiles=0 而行在场
SELFTEST PASS: mjs-present-is-not-evaluated-no-analyzer
SELFTEST PASS: bad-json-manifest-is-not-evaluated-with-exit-2                  → exit=2（不是 0）
SELFTEST PASS: bad-json-manifest-does-not-look-like-an-empty-scope-list
SELFTEST PASS: non-git-directory-is-not-evaluated-with-exit-2
SELFTEST PASS: non-git-directory-rows-are-null-not-zero                        → 行 trackedFiles=null
SELFTEST PASS: exclusion-caliber-is-segment-based-not-substring
SELFTEST PASS: absolute-foreign-root-source-is-relativized
SELFTEST PASS: relativized-source-is-a-repo-relative-path
SELFTEST PASS: global-scope-fraction-is-less-than-one-and-null-when-unresolvable
SELFTEST PASS: report-only-unevaluated-language-still-exits-0
SELFTEST: all fixture cases PASS
```

**自检当场抓到的一个真缺陷（留档）**：初版在 git 不可用时把每行的 `trackedFiles` 写成 `0`——那正是本任务要杀的 3b 形态（「该语言没有文件」是读数，「数不出来」不是）。改成 `trackedFiles: null`（`number|null`），并加 `non-git-directory-rows-are-null-not-zero` 用例钉住。**若只跑一遍没写这条断言，它会静默通过。**

### AC5 登记

- `bash plugin/scripts/capability-catalog.sh --entry-surface` → exit 0。
- `--summary`：落地前 `340 scripts | 340 declared | 0 unclassified | 335 ship`；落地后 **`341 scripts | 341 declared | 0 unclassified | 336 ship`**（+1，UNCLASSIFIED=0）。
- 六张表各补一行（键 `arch-coverage-report.ts`）；QUESTION 值内**无 backtick、无 `$(`**（AC5 的命令替换闸；该值会含 backtick 是同类脚本的高频踩点，故此处显式记一笔）。
- `checker-mutation-cases` / `@checker-count` 均未要求：本机件刻意不接入 `run_static_checks`，`checker-count-drift-check.ts` 只判注册表函数体（本任务不新增 `run_checker` 条目）。

### 门 / 套件

`bash scripts/test.sh --for-task gap-arch-coverage-self-report --allow-thin` → **exit 0**（29 tests / 29 pass：本任务 13 + capability-catalog 16）。scoped-gate cache 已写（`--develop-sha cf224bffc`）。
