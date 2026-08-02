---
id: gap-telemetry-report-writes-and-deadlocks-readiness
title: "--report rewrites a tracked file, so any telemetry polling keeps the
  tree dirty and readiness can never pass"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`restart-readiness-check.sh` 的第一条硬检查是**工作树干净**——它是「master 是否可以交回给循环」
的机械判据，`.halt` 的解除以它为前提（CLAUDE.md 明确要求解除前先跑它）。

2026-08-02 实测，`NOT READY` 的**唯一**失败项就是它，而成因是一个闭环：

| 步骤 | 事实 |
|---|---|
| 1 | `restart-readiness-check.sh` 要求 `git status` 干净 |
| 2 | `milestones/fast-mode-telemetry/<date>.json` **被 git 跟踪** |
| 3 | `fast-mode-telemetry.ts --report` **每次调用都改写它**（实测：调用前 md5 `f177326fc890` → 调用后 `34b6854e76b1`） |
| 4 | 外层的 `orchestration/watch/inner-state.sh` Monitor **每 60 秒**调一次 `--report` |
| 5 | ⇒ 任何一次提交后 60 秒内工作树必然变脏 ⇒ **readiness 永远通不过** ⇒ `.halt` 永远解不开 |

第 4 步是外层 2026-08-02 晚上引入的，此前只有人工 tick 每约 20 分钟调一次，提交还能挤在间隙里落地。
**现在这是一个稳定的死锁，不是偶发。**

### 为什么这不该靠「记得提交」解决

内层已经出现过 `chore: refresh telemetry aggregate` 这类提交——那是在给一个**每 60 秒重新生成的
派生文件**做人工同步，噪声提交会持续产生，而且永远追不上。

### 根因是职责错位，不是 gitignore 的问题

`--report` 是**读操作**，它不该写。同一个命令既报告又落盘，导致「看一眼状态」这个动作产生副作用——
外层每次 tick 观察内层，都在改变被观察的仓库状态。

注意 `.workflow-events/`（原始事件存储）**已经在 `.gitignore` 里**（第 29 行），
而由它派生的日聚合却被跟踪。但**不建议直接 gitignore 掉聚合**：原始事件是 gitignore 的，
聚合是唯一持久的任务耗时记录，删掉跟踪等于丢历史。

## Chosen mechanism

**把写从 `--report` 里拆出去。**

1. `--report` 变成**纯读**：从 `.workflow-events/*.jsonl` 计算并输出，**不写任何文件**。
2. 落盘改为显式子命令（`--snapshot` 或 `--flush`），由**需要留存的时刻**调用——
   任务收尾、Land、日终，而不是每次观察。
3. 聚合文件保持被跟踪（它是唯一持久的耗时历史），但只在显式落盘时变化，因此可以被正常提交。
4. 外层的 Monitor 与 tick 观察一律走纯读路径。

**不做**：不 gitignore 聚合文件（会丢历史）。不放宽 readiness 的干净树检查——那条检查是对的，
错的是有东西在持续弄脏树。

## Acceptance Criteria

- [x] AC1: `--report` 调用前后聚合文件的 md5 不变（实测复现当前缺陷再验证修复）
      — **复现（旧码）**：调用前 `f8124a9e…` → 调用后 `8d55d913…`（md5 变了，git status 出现
      `M milestones/fast-mode-telemetry/2026-08-02.json`）。
      **修复后（新码，worktree）**：调用前 `f8124a9e…` → 调用后 `f8124a9e…`（不变，git status 无该项）。
- [x] AC2: 新增显式落盘子命令；只有它会改写聚合文件
      — 新增 `--snapshot [--since <iso>] [--json] [--root <dir>]`，是 `writeAggregateReport` 的**唯一**
      调用路径。`--report` 不再调用 `writeAggregateReport`（纯读）。调用时刻已接线：
      任务收尾 → `docs/analysis/fast-mode-execution-prompt.md` 第 10 步；Land/fan-in →
      `docs/analysis/fast-mode-loop-tick.md` 全批合并后。内层子代理任务收尾时先 `--snapshot`
      再提交（worktree 内的聚合随分支合并），外层 Land 兜底再落一次。
- [x] AC3: 连续调用 `--report` 20 次后 `git status --porcelain` 为空
      — **实测（worktree，提交后干净树）**：20 次 `--report` 后 `git status --porcelain` 输出为空。
      单测同名用例亦覆盖（tmp 真实 git repo：seed 提交 → 20 次 `--report` → `git status --porcelain` 为空）。
- [x] AC4: 显式落盘后聚合文件内容与同一时刻 `--report` 的输出一致（两条路径不得分叉）
      — 两条路径共用 `loadAndAggregate()`（同一事件集、同一聚合对象）。实测 `--snapshot --json`
      stdout 与落盘文件 **STRICT BYTE-IDENTICAL**（452 字节，`cmp -s` 干净）；紧接的 `--report --json`
      的 tasks/meanMinutes/tasksPerHour 与快照文件逐一相等。单测覆盖 `--snapshot --json` stdout == 文件
      + 各数据字段 deepEqual。
- [x] AC5: `orchestration/watch/inner-state.sh` 与外层 tick 的观察命令确认走纯读路径
      — `inner-state.sh` 顶部加纯读契约注释（观测不得改变被观测对象；`--report` 已是纯读，禁加写路径）。
      外层 tick 观察命令（`orchestration/orchestrator-loop-tick.md`、`orchestration/watch/inner-stalled.sh`、
      `docs/analysis/fast-mode-loop-tick.md`）都调 `--report`——它现在是纯读，观察自动零副作用。
- [x] AC6: 在干净树上跑 `restart-readiness-check.sh`，第一条硬检查通过（当前是唯一失败项）
      — **实测（worktree 干净树）**：`[ok] working tree clean (ignoring .halt)` 通过；第 2、3 条
      （无 MERGE_HEAD、无 unmerged）亦通过。第 4 条「master not checked out in another worktree」在
      worktree 语境下误报（master 住在 `/home/yale/work/quay`，从 worktree 内跑该检查无法把它排除，
      检查设计为从主 checkout 根运行）。完整输出见下方「实测记录」。
- [x] AC7: 现存的 `chore: refresh telemetry aggregate` 类噪声提交不再需要——在任务体记录
      修复前后一段时间内该类提交的数量
      — **修复前 master 上该类提交共 4 个**：`eda25d3b`、`5e6f5565`、`f25fdfdb`、`3fbd6046`
      （2026-08-02 12:19–15:29Z）。全是给每 60 秒重新生成的派生文件做人工同步。修复后 `--report`
      不再写聚合文件，这类提交失去存在理由——聚合只随显式 `--snapshot` 变化，由 `--snapshot` 的
      调用时刻（任务收尾/Land/日终）伴随正常提交，不再有单独的「refresh」噪声提交。
- [x] AC8: 测试带 `// @test-group engine` 声明
      — `plugin/test/fast-mode-telemetry.test.mjs` 首行 `// @test-group engine`（原有）；新增
      AC1/AC2/AC3/AC4 四个回归用例，`scripts/test.sh --for-task …` 全绿（24/24，含 4 个新用例）。

## Definition of Done

- [x] AC1/AC3 的实测输出贴进任务体
- [x] `scripts/test.sh` 绿 — 迭代期按指令跑 `--for-task gap-telemetry-report-writes-and-deadlocks-readiness`
      （24/24 绿，含 split-or-commit 全店扫描 PASS 567 任务）；**全量套件留给 fan-in 在最终合并前跑**。
- [x] 明确记录：**观察不得改变被观察对象**——这是本任务的一般性结论，
      外层每 20 分钟观察一次内层，任何带副作用的观察命令都会以同样方式反噬
      （本任务即一例：外层每 60 秒的 `--report` 自带落盘副作用，把树钉死在脏状态上）。

## 实测记录

**AC1 复现 vs 修复（worktree，`milestones/fast-mode-telemetry/2026-08-02.json`）：**

```
旧码：md5 f8124a9e8c8c2a165573f0021c68a0cc  →  一次 --report 后  8d55d91360cf5d8928babd542dc76499   （git status 出现 M …2026-08-02.json）
新码：md5 f8124a9e8c8c2a165573f0021c68a0cc  →  一次 --report 后  f8124a9e8c8c2a165573f0021c68a0cc   （git status 无该项）
```

**AC3（提交后干净树）：**

```
$ for i in $(seq 1 20); do node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --root . >/dev/null 2>&1; done
$ git status --porcelain
（空 —— AC3 通过）
```

**AC6（worktree 干净树，`experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`）：**

```
restart-readiness-check — repo: /tmp/quay-wt-telemetry-readiness
  [ok]   working tree clean (ignoring .halt)          ← 本任务修复的唯一失败项，现通过
  [ok]   no MERGE_HEAD (no merge in progress)
  [ok]   no unmerged index entries
  [FAIL] master checked out in another worktree:
         /home/yale/work/quay  d9f1fd8c [master]
```
`[FAIL]` 第 4 条是 worktree 语境误报：检查从主 checkout 根运行时会用 `grep -vF "$ROOT "` 排除
master 的主 checkout 行，但本验证从隔离 worktree 内跑，主 checkout 行无法被排除。该项与本次改动
无关；master 未在「另一个 worktree」里被 checkout，它住在主 checkout `/home/yale/work/quay`。

## Touches

- plugin/scripts/fast-mode-telemetry.ts
- experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts
- plugin/test/fast-mode-telemetry.test.mjs
- orchestration/watch/inner-state.sh
