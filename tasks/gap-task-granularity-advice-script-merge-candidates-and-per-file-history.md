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

- [ ] `node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches plugin/scripts/worker-driver.ts --json` 退出码 0，输出 JSON 同时含 `peers`、`perFile` 两个数组字段，`perFile[0].path` 等于传入路径。
- [ ] 负控制：`--touches plugin/scripts/__no_such_file_anywhere__.ts --json` 退出码 0 且 `peers` 为 `[]`、`perFile[0].nLanded` 为 0。已知为真的对照：对一个当前 todo 任务自己的某个实质 Touches 文件执行，`peers` 必须包含该任务（测试里用临时 workspace 构造，不依赖生产数据）。
- [ ] 通用登记文件过滤：测试构造两个 todo 任务，只在 `plugin/scripts/capability-catalog-declarations.json` 上重叠 ⇒ `peers` 为 `[]`；在同一个实质源码文件上重叠 ⇒ `peers` 含对方。
- [ ] 读不懂输入时不得伪装成「无同伴」：缺失/不可读的 `.quay/worker-outcome.jsonl` 或 tasks 目录 ⇒ 输出含 `evaluated: false` 与原因，`perFile` 各项标 `evaluated: false`，不得输出 `nLanded: 0`（硬规则 3b，测试覆盖）。
- [ ] 位置判定：`grep -nE "from ['\"]\./rework-predictors" plugin/scripts/task-granularity-advice.ts` 至少 1 条命中，且该文件中不存在第二份对 `final_state` 的字面量比较（`grep -nE "final_state\s*[=!]==" plugin/scripts/task-granularity-advice.ts` 为 0 条）；Touches 解析经由 `touches-parser.ts`（`grep -n "touches-parser" plugin/scripts/task-granularity-advice.ts` ≥1 条）。
- [ ] `--report --json` 退出码 0，含 10 个体量档，每档含 `n`、`firstTryRate`、`failedRoundsPerTask`、`meanTotalWallMin` 与 `workerHoursPer1000Lines`（后者附 95% 区间）；顶层含 `model` 对象，键为 `a`、`b`、`c`、`d`、`f0`、`f1`，各带区间；样本数 <10 的档标 `insufficient` 而不给统计量。以 `--root /data/home/yale/work/quay --since 2026-09-16` 读生产载体所得的表与分析正本中的表一致（贴出两者）。
- [ ] `bash plugin/scripts/capability-catalog.sh | tail -1` 显示 `0 unclassified`（六张声明表齐全，且 `plugin/scripts/capability-catalog-declarations.json` 在本任务 `## Touches` 内）。
- [ ] `docs/analysis/task-granularity-and-throughput-2026-10-07.md` 存在，含复跑命令、读数表与「已知限制」小节；`grep -c "task-granularity-advice.ts --report" docs/analysis/task-granularity-and-throughput-2026-10-07.md` ≥1。
- [ ] `plugin/skills/quay-file-task/SKILL.md` 的第 2b 步改为优先调用该脚本（保留 grep 食谱作回退），`## Granularity` 的数字旁加注「来源与复跑见 docs/analysis/task-granularity-and-throughput-2026-10-07.md」；`## Granularity` 的规则（按吞吐优化、低于约 300 行优先合并、不设规模上限）不改，除非复跑读数推翻它们——推翻时须在分析正本中写明并贴出新读数。
- [ ] 读生产载体（硬规则 4 推论三）：在任务 worktree 中以 `--root /data/home/yale/work/quay`（主检出，即生产 `tasks/` 与 `.quay/`）对最近立案的 3 个任务运行 `--task <id> --json`，把输出贴入任务体；其中 `peers` 与手工 `grep -lF -- "<path>" tasks/*.md | xargs grep -lE '^status: (todo|ready)$'` 的结果逐个一致（贴出两边的 id 列表）。
- [ ] `scripts/test.sh --for-task gap-task-granularity-advice-script-merge-candidates-and-per-file-history` 退出码 0。

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
