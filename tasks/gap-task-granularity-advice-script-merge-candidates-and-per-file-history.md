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

全部读数在本任务 worktree 内、以 `--root /data/home/yale/work/quay`（生产主检出：真实 `tasks/`、git 落地历史与 `.quay/worker-outcome.jsonl`）对真实载体运行。

### AC1 —— 字面命令
`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches plugin/scripts/worker-driver.ts --json`
⇒ 退出码 0；顶层键含 `peers` 与 `perFile`；`perFile[0].path = plugin/scripts/worker-driver.ts`；
`peers = ["gap-fan-in-execute-semantic-fallback-telemetry-blind"]`（该文件被 136 个已落地任务触及，中位体量 281 行、中位执行 2 轮）。

### AC2 —— 负控制 + 已知为真对照
* 负控制：`--touches plugin/scripts/__no_such_file_anywhere__.ts --json` ⇒ 退出 0、`peers: []`、`perFile[0].nLanded: 0`。
  （同一次输出里 `mentions: [本任务]`——因为本任务的 AC2 正文写了这个路径字面量；这正是 `peers` 与 `mentions` 分开报的意义。）
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
`--report --json` 含 10 个体量档，每档 `n`/`firstTryRate`/`failedRoundsPerTask`/`meanTotalWallMin`/`workerHoursPer1000Lines`（后者附 95% 区间）；顶层 `model` 六键 `a/b/c/d/f0/f1` 各带区间；n<10 的档 `insufficient: true` 且不给任何统计量。

六根合计（= SKILL.md `## Granularity` 数字的来源 = 分析正本 §2 的表）：

| 体量档（变更行） | n | 首次成功率 | 每任务失败轮 | 单任务总 wall（min） | worker 小时/1000 行（95% 区间） |
|---|---|---|---|---|---|
| <100 | 144 | 54.2% | 1.08 | 28.7 | 12.73 [10.14, 16.07] |
| 100–150 | 52 | 44.2% | 1.00 | 85.7 | 11.71 [3.43, 27.01] |
| 150–250 | 108 | 53.7% | 1.01 | 53.7 | 4.49 [2.12, 9.11] |
| 250–400 | 127 | 48.8% | 1.08 | 31.1 | 1.63 [1.33, 2.02] |
| 400–600 | 124 | 50.8% | 0.99 | 39.4 | 1.30 [1.12, 1.52] |
| 600–1000 | 151 | 53.0% | 0.79 | 37.1 | 0.79 [0.68, 0.93] |
| 1000–1500 | 117 | 58.1% | 0.84 | 39.5 | 0.55 [0.49, 0.62] |
| 1500–2000 | 59 | 32.2% | 1.07 | 50.5 | 0.49 [0.40, 0.61] |
| 2000–3000 | 33 | 36.4% | 1.30 | 55.2 | 0.40 [0.32, 0.49] |
| 3000+ | 28 | 10.7% | 1.75 | 66.1 | 0.16 [0.11, 0.24] |

成本模型（分析正本 §3）：`a`=18.49 min · `b`=0.069 min/100 行 · `c`=22.20 min · `d`=0.249 min/100 行 · `f0`=0.94 · `f1`=0.165（区间见分析正本 §3 表）。
复跑命令（写在分析正本顶部）：`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --report --since 2026-09-16 --root <六根>`。

**单根对拍（AC6 的字面命令，两侧都贴出）**——`--report --root /data/home/yale/work/quay --since 2026-09-16 --json` 的输出，与分析正本 §4 的 quay 段是**同一张表**（该段由同一条命令产出）：

| 体量档（变更行） | n | 首次成功率 | 每任务失败轮 | 单任务总 wall（min） | worker 小时/1000 行（95% 区间） |
|---|---|---|---|---|---|
| <100 | 59 | 42.4% | 1.71 | 42.0 | 19.10 [13.80, 27.25] |
| 100–150 | 29 | 58.6% | 0.72 | 41.4 | 5.59 [3.47, 8.65] |
| 150–250 | 45 | 53.3% | 0.71 | 32.0 | 2.66 [2.26, 3.11] |
| 250–400 | 54 | 46.3% | 1.13 | 43.6 | 2.24 [1.61, 2.99] |
| 400–600 | 67 | 47.8% | 1.01 | 49.2 | 1.64 [1.32, 2.00] |
| 600–1000 | 47 | 44.7% | 1.06 | 54.8 | 1.19 [0.90, 1.54] |
| 1000–1500 | 20 | 65.0% | 0.50 | 47.1 | 0.65 [0.57, 0.73] |
| 1500–2000 | 11 | 18.2% | 1.27 | 78.3 | 0.82 [0.64, 1.07] |
| 2000–3000 | 4 | 样本不足 | — | — | — |
| 3000+ | 7 | 样本不足 | — | — | — |

机检（生成时刻、同一次运行内）：`single-root quay == doc §4 quay section: True | measured: 343`。

⚠️ 漂移（必须知道）：观测窗是活的，两次运行之间新落地的任务会改变 n 与低位小数（本例同一窗内 337→341→343）。表只在**生成那一刻**逐格可复现；量级与排序稳定。引用前先复跑。

### AC7 —— 目录声明
`bash plugin/scripts/capability-catalog.sh | tail -1` ⇒ `summary: 372 scripts | 372 declared | 0 unclassified | 367 ship`。

### AC8 —— 分析正本
`docs/analysis/task-granularity-and-throughput-2026-10-07.md`（179 行）含复跑命令、口径、读数表、成本模型、单项目对拍与「已知限制」；
`grep -c "task-granularity-advice.ts --report" docs/analysis/task-granularity-and-throughput-2026-10-07.md` ⇒ 1。

### AC9 —— SKILL.md
`plugin/skills/quay-file-task/SKILL.md` 第 2b 步改为优先调用本脚本（保留 grep 食谱作回退，并说明 `--root` 要用主检出）；`## Granularity` 的数字已换成复跑读数并加注「来源与复跑见 docs/analysis/task-granularity-and-throughput-2026-10-07.md」，同时标明数字随落地漂移、引用前须复跑。
三条规则（按吞吐优化 / 低于约 300 行优先合并 / 不设规模上限）**未改**。复跑对前版一条**子读数**取假：「失败轮数不随规模上升」在 ≥1500 行处不成立（各档 1.08→0.79→1.07→1.30→1.75，f1=+0.165）。规则本身不受影响——按吞吐口径（每 1000 变更行）成本仍单调下降；该取假已按 AC9 写进分析正本 §5，SKILL.md 的对应句一并更正为「U 形」。

### AC10 —— 生产载体读数（硬规则 4 推论三）
最近立案的 3 个任务（`git log --diff-filter=A --format=%aI --name-only -- tasks/` 前三，2026-10-07T13:53–13:54 立案），以 `--root /data/home/yale/work/quay` 运行 `--task <id> --json`；
每个实质 Touches 路径给出 `grep -lF -- "<path>" tasks/*.md | xargs -r grep -lE '^status: (todo|ready)$'` 与本工具 `peers`／`peers∪mentions` 两侧的 id 列表：

* `--task gap-dispatch-record-coverage-scope-unverified`
  * `peers` = ['gap-dispatch-record-coverage-scope-unverified']
  * `mentions`（仅正文提及、未在 Touches 声明） = []
  * `plugin/scripts/dispatch-record.ts`
    * grep          = ['gap-dispatch-record-coverage-scope-unverified']
    * peers         = ['gap-dispatch-record-coverage-scope-unverified']
    * peers∪mentions= ['gap-dispatch-record-coverage-scope-unverified']  ⇒ 与 grep 一致
  * `plugin/scripts/semantic-face-dispatch-record.ts`
    * grep          = ['gap-dispatch-record-coverage-scope-unverified']
    * peers         = ['gap-dispatch-record-coverage-scope-unverified']
    * peers∪mentions= ['gap-dispatch-record-coverage-scope-unverified']  ⇒ 与 grep 一致
  * `orchestration/dispatch-record.jsonl`
    * grep          = ['gap-dispatch-record-coverage-scope-unverified']
    * peers         = ['gap-dispatch-record-coverage-scope-unverified']
    * peers∪mentions= ['gap-dispatch-record-coverage-scope-unverified']  ⇒ 与 grep 一致
  * `orchestration/semantic-face-dispatch-record.jsonl`
    * grep          = ['gap-dispatch-record-coverage-scope-unverified']
    * peers         = ['gap-dispatch-record-coverage-scope-unverified']
    * peers∪mentions= ['gap-dispatch-record-coverage-scope-unverified']  ⇒ 与 grep 一致
* `--task gap-provider-switch-no-dedicated-entry-point`
  * `peers` = ['gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script', 'gap-provider-switch-no-dedicated-entry-point']
  * `mentions`（仅正文提及、未在 Touches 声明） = ['gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script', 'gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch']
  * `packages/quay/src/init.ts`
    * grep          = ['gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script', 'gap-provider-switch-no-dedicated-entry-point', 'gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch']
    * peers         = ['gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script', 'gap-provider-switch-no-dedicated-entry-point']
    * peers∪mentions= ['gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script', 'gap-provider-switch-no-dedicated-entry-point', 'gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch']  ⇒ 与 grep 一致
  * `packages/quay/bin/quay.ts`
    * grep          = ['gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script', 'gap-provider-switch-no-dedicated-entry-point', 'gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch']
    * peers         = ['gap-provider-switch-no-dedicated-entry-point']
    * peers∪mentions= ['gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script', 'gap-provider-switch-no-dedicated-entry-point', 'gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch']  ⇒ 与 grep 一致
  * `packages/quay/src/cli/provider.ts`
    * grep          = ['gap-provider-switch-no-dedicated-entry-point']
    * peers         = ['gap-provider-switch-no-dedicated-entry-point']
    * peers∪mentions= ['gap-provider-switch-no-dedicated-entry-point']  ⇒ 与 grep 一致
* `--task gap-quay-native-adr-cli-looser-bypass-of-core-validation`
  * `peers` = ['gap-quay-native-adr-cli-looser-bypass-of-core-validation']
  * `mentions`（仅正文提及、未在 Touches 声明） = []
  * `packages/quay-native/bin/quay-native.ts`
    * grep          = ['gap-quay-native-adr-cli-looser-bypass-of-core-validation']
    * peers         = ['gap-quay-native-adr-cli-looser-bypass-of-core-validation']
    * peers∪mentions= ['gap-quay-native-adr-cli-looser-bypass-of-core-validation']  ⇒ 与 grep 一致
  * `packages/quay/src/cli/adr.ts`
    * grep          = ['gap-quay-native-adr-cli-looser-bypass-of-core-validation']
    * peers         = ['gap-quay-native-adr-cli-looser-bypass-of-core-validation']
    * peers∪mentions= ['gap-quay-native-adr-cli-looser-bypass-of-core-validation']  ⇒ 与 grep 一致

说明：`peers` = 在 `## Touches` 里**声明**了该路径的开放任务；`mentions` = 只在正文里**提及**该路径、未声明的开放任务。
两者**按路径**互补，所以 `peers ∪ mentions` 与 grep 的命中集逐路径完全一致（上表每一行都相等）。
这正是第 2b 步 grep 食谱与本脚本的关系：脚本把 grep 的命中集拆成「声明」与「仅提及」两半，声明那一半才是合并候选。

### AC11 —— scoped gate
`bash scripts/test.sh --for-task gap-task-granularity-advice-script-merge-candidates-and-per-file-history --allow-thin` ⇒ 退出码 0（scoped 静态检查 + `plugin/test/task-granularity-advice.test.mjs` 16/16 通过）。
