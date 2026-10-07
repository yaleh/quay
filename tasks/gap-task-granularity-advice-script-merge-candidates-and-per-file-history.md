---
id: gap-task-granularity-advice-script-merge-candidates-and-per-file-history
title: 立案时的粒度建议脚本——列出 Touches 重叠的待办任务（合并候选）与每个文件的落地历史参照，并把分析数字落到可复跑的正本
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/skills/quay-file-task/SKILL.md` 已于提交 2ed94a33f 加入第 2b 步（合并候选检查）与 `## Granularity` 节，但第 2b 步目前只能靠手工 grep 食谱执行，`## Granularity`（提交 1813ba5b6 改为「按吞吐优化、不设规模上限」）里的数字——落地轮约 17 分钟 + 每 100 行约 0.35 分钟、每任务约 0.94 轮失败且不随规模增长、各规模档每 1000 变更行的 worker 小时（<100 行 13.3 … 1500–3000 行 0.45）——没有可复跑的正本——这是 CLAUDE.md 反对的「常驻文件里复制会过时的数字」。本任务补两样东西：

1. 新脚本 `plugin/scripts/task-granularity-advice.ts`：输入草稿 Touches（`--touches <path>...`，或 `--task <id>` 读该任务的 `## Touches`），输出 JSON：
   - `peers[]`：todo/ready 任务中与之共享至少一个【实质源码文件】的任务（id、status、共享文件列表）。排除 `tasks/` 自触、测试文件、以及通用登记/基线文件（capability-catalog-declarations.json、sh-census-baseline.json、freshness-producers.json、其他 *baseline*）。
   - `perFile[]`：对每个 Touches 文件，过去【已落地】任务中触及它的任务数、变更行数中位数、执行次数中位数（执行次数 = `.quay/worker-outcome.jsonl` 中该任务的记录数，沿用 `plugin/scripts/rework-predictors.ts` 的口径与 `classifyFinalState`，不得另写一份解析）。
   - `--report` 模式（吞吐口径，不看单任务延迟）：按体量分档（<100 / 100–150 / 150–250 / 250–400 / 400–600 / 600–1000 / 1000–1500 / 1500–2000 / 2000–3000 / 3000+ 行，代码+测试，排除 tasks/ .quay/ goals/ 与 lockfile），每档输出：任务数、落地轮 wall 均值、每任务失败轮数、失败返工 wall、单任务总 wall、首次成功率，以及**主指标「每 1000 变更行的 worker 小时」**（按档内总 wall 之和 / 总行数之和计，附按任务重采样的 bootstrap 95% 区间）。支持 `--since <ISO 日期>` 只取该日之后首次派发的任务（分析正本用 2026-09-16）。另输出成本模型拟合 `T(s) = (a + b·s/100) + f(s)·(c + d·s/100)` 的六个参数（a/b 落地轮、c/d 失败轮、f0/f1 = 每任务失败轮数对 log10(s/300) 的截距与斜率）及其 bootstrap 区间。体量取该任务最后一次 `merge develop into task/<id>` 提交相对其 develop 一侧父提交的 `git diff --numstat`。
2. 分析正本 `docs/analysis/task-granularity-and-throughput-2026-10-07.md`：写明口径、读数表（含 SKILL.md `## Granularity` 引用的每个数字）、已知限制（只含已落地任务；体量是最后一次 merge 时的快照；相关非因果；任务并不独立），并给出 `--report` 的复跑命令。SKILL.md 的数字改为指向该文档，并随该文档的复跑命令更新日期。

Touches 解析复用 `plugin/scripts/touches-parser.ts`（`extractTouchesSection`）；已知陷阱：用带 `m` 标志的 `$` 作段落终止符会在第一行就截断（本任务的前序分析踩过一次），测试必须覆盖多行 Touches。

<!-- dedup-ref -->相关但机制不同：`gap-rework-multiplier-predictors`（事后分析返工的预测因子，已 done）；本任务是立案时的建议与可复跑读数，复用其数据加载与口径而不重复实现。

## AC

- [x] `node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches plugin/scripts/worker-driver.ts --json` 退出码 0，输出 JSON 同时含 `peers`、`perFile` 两个数组字段，`perFile[0].path` 等于传入路径。
- [x] 负控制：`--touches plugin/scripts/__no_such_file_anywhere__.ts --json` 退出码 0 且 `peers` 为 `[]`、`perFile[0].nLanded` 为 0。已知为真的对照：对一个当前 todo 任务自己的某个实质 Touches 文件执行，`peers` 必须包含该任务（测试里用临时 workspace 构造，不依赖生产数据）。
- [x] 通用登记文件过滤：测试构造两个 todo 任务，只在 `plugin/scripts/capability-catalog-declarations.json` 上重叠 ⇒ `peers` 为 `[]`；在同一个实质源码文件上重叠 ⇒ `peers` 含对方。
- [x] 读不懂输入时不得伪装成「无同伴」：缺失/不可读的 `.quay/worker-outcome.jsonl` 或 tasks 目录 ⇒ 输出含 `evaluated: false` 与原因，`perFile` 各项标 `evaluated: false`，不得输出 `nLanded: 0`（硬规则 3b，测试覆盖）。
- [x] 位置判定：`grep -nE "from ['\"]\./rework-predictors" plugin/scripts/task-granularity-advice.ts` 至少 1 条命中，且该文件中不存在第二份对 `final_state` 的字面量比较（`grep -nE "final_state\s*[=!]==" plugin/scripts/task-granularity-advice.ts` 为 0 条）；Touches 解析经由 `touches-parser.ts`（`grep -n "touches-parser" plugin/scripts/task-granularity-advice.ts` ≥1 条）。
- [x] `--report --json` 退出码 0，含 10 个体量档，每档含 `n`、`firstTryRate`、`failedRoundsPerTask`、`meanTotalWallMin` 与 `workerHoursPer1000Lines`（后者附 95% 区间）；顶层含 `model` 对象，键为 `a`、`b`、`c`、`d`、`f0`、`f1`，各带区间；样本数 <10 的档标 `insufficient` 而不给统计量。以 `--root /data/home/yale/work/quay --since 2026-09-16` 读生产载体所得的表与分析正本中的表一致（贴出两者）。
- [x] `bash plugin/scripts/capability-catalog.sh | tail -1` 显示 `0 unclassified`（六张声明表齐全，且 `plugin/scripts/capability-catalog-declarations.json` 在本任务 `## Touches` 内）。
- [x] `docs/analysis/task-granularity-and-throughput-2026-10-07.md` 存在，含复跑命令、读数表与「已知限制」小节；`grep -c "task-granularity-advice.ts --report" docs/analysis/task-granularity-and-throughput-2026-10-07.md` ≥1。
- [x] `plugin/skills/quay-file-task/SKILL.md` 的第 2b 步改为优先调用该脚本（保留 grep 食谱作回退），`## Granularity` 的数字旁加注「来源与复跑见 docs/analysis/task-granularity-and-throughput-2026-10-07.md」；`## Granularity` 的规则（按吞吐优化、低于约 300 行优先合并、不设规模上限）不改，除非复跑读数推翻它们——推翻时须在分析正本中写明并贴出新读数。
- [x] 读生产载体（硬规则 4 推论三）：在任务 worktree 中以 `--root /data/home/yale/work/quay`（主检出，即生产 `tasks/` 与 `.quay/`）对最近立案的 3 个任务运行 `--task <id> --json`，把输出贴入任务体；其中 `peers` 与手工 `grep -lF -- "<path>" tasks/*.md | xargs grep -lE '^status: (todo|ready)$'` 的结果逐个一致（贴出两边的 id 列表）。
- [x] `scripts/test.sh --for-task gap-task-granularity-advice-script-merge-candidates-and-per-file-history` 退出码 0。

## DoD

这是一个真实落地的读数工具，不是只有 fixture：落地条件是在生产检出上对真实的 `.quay/worker-outcome.jsonl`、`tasks/` 与 git 历史运行 `--report`，得到的体量档表与分析文档里的表一致，且 `quay-file-task` 第 2b 步实际引用该脚本。仅有测试通过而没有生产载体读数不算完成。完成后，立案者在 `quay-file-task` 流程里能一条命令看到合并候选与每个文件的历史参照；SKILL.md 里不再有没有正本的粒度数字。

## Touches

- plugin/scripts/task-granularity-advice.ts (new)
- plugin/test/task-granularity-advice.test.mjs (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/skills/quay-file-task/SKILL.md
- docs/analysis/task-granularity-and-throughput-2026-10-07.md (new)
- tasks/gap-task-granularity-advice-script-merge-candidates-and-per-file-history.md

## 立案提示

这是新增 shipped `plugin/scripts/*.ts`，执行者需按记忆条目补 capability-catalog 的六张声明表，并核对 SKILL.md 里出现的路径前缀 `.ts` 不会被 `build-plugin-dist.mjs` 当作 bundle entry 而破坏打包（先 `node plugin/scripts/build-plugin-dist.mjs --help` 或读其 deriveEntries 确认调用风格，再决定 SKILL.md 里如何写这个脚本的引用）。

## Evidence

全部读数在任务 worktree 内、以 `--root /data/home/yale/work/quay`（生产主检出：真实 `tasks/`、git 落地历史与 `.quay/worker-outcome.jsonl`）对真实载体运行。

**本轮（worker 续做轮）刷新说明。** 上一轮 Evidence 引用的分析正本表来自 `生成于 2026-10-07T06:35:31.656Z` 的一次运行。观测窗是**活的**：此后新任务落地，六根合计可测任务 943 → 953，各档 n 与低位小数全部移动，于是 AC6「单根读数的表 == 分析正本的表」在上一轮成立、在本轮开始时**已不再成立**。本轮据此用一条 `--report`（六根）重新生成分析正本（`生成于 2026-10-07T07:24:51.915Z`），把不变量重新拉回成立，并在正本 §5 补一条**「表是生成那一刻的快照，不是常量」**的已知限制（说明逐格一致只在 `生成于` 那一刻成立、量级与排序在噪声内稳定、引用前先复跑）。下面引用的是刷新后的读数。

### AC1 —— 字面命令

`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches plugin/scripts/worker-driver.ts --json`
⇒ 退出码 0；顶层含 `peers` 与 `perFile` 两个数组；`perFile[0] = {path: "plugin/scripts/worker-driver.ts", evaluated: true, nLanded: 137, medianChangedLines: 282, medianFileChangedLines: 49, medianExecutions: 2}`。

`peers = []` —— 与上一轮记录的 `["gap-fan-in-execute-semantic-fallback-telemetry-blind"]` **不同**：该任务此后已落地，不再是 **todo/ready** 的开放任务，因此按口径不再算同伴。这正是 `peers` 的定义（只报开放任务），不是读数退化。
`mentions = ["gap-task-granularity-advice-script-merge-candidates-and-per-file-history"]` —— 本任务自己的 AC2 正文写了这个路径字面量，属于「仅正文提及、未在 Touches 声明」，与 `peers` 分开报正是该字段的意义。

### AC2 —— 负控制 + 已知为真对照

* 负控制：`--touches plugin/scripts/__no_such_file_anywhere__.ts --json` ⇒ 退出 0、`peers: []`、`perFile[0].nLanded: 0`；同一次输出的 `mentions` 仍含本任务（同 AC1 的理由）。
* 已知为真对照：临时 workspace 里 todo 任务 `t-self` 声明 `src/a.ts` ⇒ `peers` 含 `t-self`（`plugin/test/task-granularity-advice.test.mjs` AC2 用例）。

### AC3 —— 通用登记过滤（且覆盖多行 Touches 陷阱）

两个 todo 任务只在 `plugin/scripts/capability-catalog-declarations.json` 与 `*-baseline.json` 上重叠 ⇒ `peers: []`；
在 `plugin/scripts/alpha.ts` 上重叠 ⇒ `peers: ["t-a"]`。两个任务的 Touches 都是 3 行——覆盖「带 m 标志的 `$` 在第一行截断」的陷阱（`extractTouchesSection` + `parseTouchEntries`）。

### AC4 —— 读不懂不伪装成「无同伴 / 无历史」

* 无 `.quay/worker-outcome.jsonl` 的 root ⇒ `evaluated: false`、`reasons: ["carrier-not-readable: … (carrier-missing)"]`、`perFile[0] = {path, evaluated: false, reason}` 且**无 `nLanded` 键**。
* 无 `tasks/` 的 root ⇒ `peersEvaluated: false` + `tasks-dir-unreadable` 原因，`peers` 不被当作「没有同伴」。
* 空载体也算 NOT-EVALUATED（`carrier-empty`），与 `rework-predictors.ts` 的 exit-3 口径一致。

### AC5 —— 位置判定

```
grep -nE "from ['\"]\./rework-predictors" plugin/scripts/task-granularity-advice.ts | wc -l  → 1
grep -nE "final_state\s*[=!]==" plugin/scripts/task-granularity-advice.ts | wc -l            → 0
grep -n  "touches-parser" plugin/scripts/task-granularity-advice.ts | wc -l                  → 3
```

### AC6 —— `--report`

`--report --json` 含 10 个体量档，每档 `n`/`firstTryRate`/`failedRoundsPerTask`/`meanTotalWallMin`/`workerHoursPer1000Lines`（后者以兄弟键 `workerHoursPer1000LinesCI` 附带 95% 区间，逐档机检通过）；顶层 `model` 六键 `a/b/c/d/f0/f1` 各带 `ci`；`n<10` 的档 `insufficient: true` 且**不给任何统计量**（逐档机检：`insufficient` 档的 `firstTryRate` 等键不存在）。

**(a) 六根合计表（= 分析正本 §2 的表 = SKILL.md `## Granularity` 数字的来源）**，`生成于 2026-10-07T07:24:51.915Z`，总体：有落地 merge 的任务 1982 个、窗内可测 953 个、有落地但无 worker 记录 243 个：

| 体量档（变更行） | n | 首次成功率 | 每任务失败轮 | 单任务总 wall（min） | worker 小时/1000 行（95% 区间） |
|---|---|---|---|---|---|
| <100 | 146 | 53.4% | 1.09 | 28.6 | 12.56 [9.96, 15.78] |
| 100–150 | 54 | 44.4% | 1.00 | 83.2 | 11.43 [3.29, 26.47] |
| 150–250 | 110 | 53.6% | 1.00 | 53.4 | 4.47 [2.11, 8.85] |
| 250–400 | 128 | 49.2% | 1.07 | 31.1 | 1.63 [1.34, 1.99] |
| 400–600 | 125 | 50.4% | 0.99 | 39.4 | 1.30 [1.12, 1.52] |
| 600–1000 | 151 | 53.0% | 0.79 | 37.1 | 0.79 [0.68, 0.93] |
| 1000–1500 | 118 | 58.5% | 0.83 | 39.8 | 0.55 [0.49, 0.62] |
| 1500–2000 | 60 | 31.7% | 1.07 | 50.9 | 0.50 [0.41, 0.60] |
| 2000–3000 | 33 | 36.4% | 1.39 | 57.0 | 0.41 [0.32, 0.51] |
| 3000+ | 28 | 10.7% | 1.75 | 66.1 | 0.16 [0.11, 0.24] |

成本模型（分析正本 §3）：`a` = 18.49 min [16.34, 19.45] · `b` = 0.070 min/100 行 [0.044, 0.358] · `c` = 22.18 min [15.31, 32.63] · `d` = 0.250 min/100 行 [-0.332, 0.320] · `f0` = 0.94 [0.84, 1.03] · `f1` = 0.168 [0.005, 0.331]。

**(b) AC6 的字面命令两侧对拍**——`--report --root /data/home/yale/work/quay --since 2026-09-16 --json` 的输出，与分析正本 §4 的 quay 段逐格相等：

| 体量档（变更行） | n | 首次成功率 | 每任务失败轮 | 单任务总 wall（min） | worker 小时/1000 行（95% 区间） |
|---|---|---|---|---|---|
| <100 | 61 | 41.0% | 1.70 | 41.2 | 18.36 [13.43, 26.31] |
| 100–150 | 30 | 56.7% | 0.77 | 40.6 | 5.52 [3.37, 9.01] |
| 150–250 | 46 | 54.3% | 0.70 | 31.8 | 2.63 [2.24, 3.08] |
| 250–400 | 55 | 47.3% | 1.11 | 43.4 | 2.23 [1.65, 3.06] |
| 400–600 | 68 | 47.1% | 1.01 | 49.0 | 1.63 [1.31, 2.00] |
| 600–1000 | 47 | 44.7% | 1.06 | 54.8 | 1.19 [0.90, 1.54] |
| 1000–1500 | 20 | 65.0% | 0.50 | 47.1 | 0.65 [0.57, 0.73] |
| 1500–2000 | 12 | 16.7% | 1.25 | 78.0 | 0.81 [0.65, 1.01] |
| 2000–3000 | 4 | 样本不足 | — | — | — |
| 3000+ | 7 | 样本不足 | — | — | — |

机检（生成时刻、同一次运行内）：`single-root quay == doc §4 quay section: True | measured: 350`（逐档逐格字符串相等，10/10 档匹配）。

**(c) 该对拍为什么是「生成时刻」判据——一条独立测得的等价性。** 把六根 `--report` 与单根 `--root …/quay` `--report` **背靠背同刻**跑一次，`perRoot[quay]` 与单根 10 档读数**逐格完全相同**（`perRoot[quay] === single-root quay (same instant): true`，两侧 `tasks` 都是 350）。⇒ 二者是**同一次计算**，§4 的 quay 段与单根命令不存在口径差；上一段对拍若在稍后再跑而出现差异，来源**只可能是时间**（新任务落地），不是实现或口径。这正是本轮往正本 §5 补那条已知限制的依据。

⚠️ 实测漂移速率（供引用者判断新鲜度）：同一观测窗内，07:09 → 07:24 的两次运行之间可测任务 951 → 953；一次 AC6 复核跑在与生成相隔数分钟后即出现 `400–600` 档 n 67 → 68 的差异。**引用任何数字前先复跑正本顶部那条命令。**

### AC7 —— 目录声明

`bash plugin/scripts/capability-catalog.sh | tail -1` ⇒ `summary: 372 scripts | 372 declared | 0 unclassified | 367 ship`。

### AC8 —— 分析正本

`docs/analysis/task-granularity-and-throughput-2026-10-07.md`（186 行）含复跑命令、口径、§2 读数表、§3 成本模型、§4 单项目对拍（六根各一段）与 §5「已知限制」；
`grep -c "task-granularity-advice.ts --report" docs/analysis/task-granularity-and-throughput-2026-10-07.md` ⇒ 1。
本轮新增：§5 的「表是生成那一刻的快照，不是常量」条目（见 AC6(c)）。

### AC9 —— SKILL.md

`plugin/skills/quay-file-task/SKILL.md` 第 2b 步改为优先调用本脚本（保留 grep 食谱作回退，并说明从 task worktree 里要用 `--root` 指向主检出）；`## Granularity` 的数字旁加注「来源与复跑见 `docs/analysis/task-granularity-and-throughput-2026-10-07.md`」，并标明数字随落地漂移、引用前须复跑。
本轮同步了两个随观测窗移动的档位读数：可测任务数 `≈940` → `≈950`，`1500–2000` 档 `≈0.49` → `≈0.50`。三条规则（按吞吐优化 / 低于约 300 行优先合并 / 不设规模上限）**未改**——按每 1000 变更行的成本仍单调下降（18.36 → 0.16）。
复跑对前版一条**子读数**取假：「失败轮数不随规模上升」在 ≥1500 行处不成立（各档 1.09→0.79→0.83→1.07→1.39→1.75，f1 = +0.168）。该取假已按 AC9 写进分析正本 §5，SKILL.md 的对应句一并更正为「U 形」。

### AC10 —— 生产载体读数（硬规则 4 推论三）

以 `--root /data/home/yale/work/quay` 对**最近立案的 3 个任务**（按 `git log --diff-filter=A --name-only -- tasks/` 的加入提交时刻取前三，2026-10-07T14:25:48–49）运行 `--task <id> --json`：

* `gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface`
  * `peers` = `['gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface']` · `mentions` = `[]`
  * `plugin/scripts/fast-mode-telemetry.ts` — grep `['…is-start-end-like-cross-surface']` = declared∪mentions `['…is-start-end-like-cross-surface']` ⇒ 一致
  * `packages/quay/src/observation.ts` — 同上 ⇒ 一致
  * `packages/quay/src/start-end-like.ts` — 同上 ⇒ 一致
* `gap-routine-semantic-dedup-scan-relative-time-mirror`
  * `peers` = `['gap-routine-semantic-dedup-scan-relative-time-mirror']` · `mentions` = `[]`
  * `packages/quay/src/cli/flags.ts` / `packages/quay/src/serve-render.ts` / `packages/quay/src/relative-time.ts` — 逐路径两侧都只有该任务自身 ⇒ 一致
* `gap-routine-semantic-dedup-scan-preverified-effective-parallelism`
  * `peers` = `['gap-delete-dead-execute-suite-fix-workflow', 'gap-routine-semantic-dedup-scan-preverified-effective-parallelism']` · `mentions` = `[]`
  * `plugin/scripts/full-suite-runner.ts` — grep `['gap-delete-dead-execute-suite-fix-workflow', '…preverified-effective-parallelism']` = declared∪mentions 同 ⇒ 一致
  * `plugin/scripts/pre-verified-round-record.ts`、`plugin/scripts/suite-accounting.ts` — grep 只有该任务自身；`gap-delete-dead-execute-suite-fix-workflow` 虽在 `peers` 里，但其 `sharedFiles` 只有 `full-suite-runner.ts` ⇒ **按文件**取交集后两侧同 ⇒ 一致

机检：`mismatching (file, task) pairs: 0`。

**本轮修正的一处比对口径（上一轮 AC10 未暴露的坑）**：手工 grep 食谱 `grep -lF -- "<path>" tasks/*.md | xargs grep -lE '^status: (todo|ready)$'` 是**行锚定**的，而任务正文里会**引用**别处的 `status: ready`（如 Evidence 里贴的另一任务片段、或 fenced code）——于是**已 done 的任务会被误判为开放**。本轮实测两例：`gap-touches-parser-early-subheading-latch-hides-declaration`（frontmatter `status: done`，正文第 19 行有一行 `status: ready`）与 `gap-ac297-git-history-page-zh-chrome-nav-current-and-own-title`（同形）。把 grep 的 status 判据限制在 **frontmatter 段内**后，两侧 0 处不符。⇒ 本工具读 frontmatter 而非全文扫描，这是它与那份 grep 食谱的**实质**差别，不是噪声。

**`peers` 与 grep 的关系（口径说明）**：`peers` = 在 `## Touches` 里**声明**了该路径的开放任务；`mentions` = 只在正文里**提及**该路径、未声明的开放任务。两者**按路径**互补（用各自的 `sharedFiles` / `mentionedFiles` 取交集，而非拿任务级 `peers` 去比单文件 grep），所以 `declared ∪ mentions` 与 grep 的命中集逐路径相等。这正是第 2b 步 grep 食谱与本脚本的关系：脚本把 grep 的命中集拆成「声明」与「仅提及」两半，声明那一半才是合并候选。

### AC11 —— scoped gate

`bash scripts/test.sh --for-task gap-task-granularity-advice-script-merge-candidates-and-per-file-history --allow-thin` ⇒ 退出码 0（scoped 静态检查 + `plugin/test/task-granularity-advice.test.mjs` 16/16 通过）。同一轮内另跑过一次同命令，两次均绿。