---
id: gap-release-cut-preflight-records-ci-reading-not-blocking
title: release-cut preflight 记录 develop 最后一次 decisive CI 读数（记录⛔不阻塞）：给 SPEC §4.2
  一个可区分产物，不新增发版禁令
status: ready
labels:
  - gap
  - release
parent: null
children: []
extra: {}
---
## Proposal

`SPEC-release-and-hotfix-branching-2026-09-15.md` §4.2「切点前置：develop 的上一次 decisive CI 必须是绿」**没有任何机械载体**：通读 `scripts/release-cut.mjs` 的 preflight，它只查 tag 不存在 / 版本一致 / 树干净 / develop 不落后 remote / `release.yml` 无漂移，**完全不读 CI**；`release-master-advance-needs-check.ts` 是 `needs:` 断言、`release-freshness-check.sh` 是新鲜度/漂移 —— 都不读 CI 绿。该条款原文的豁免是「**在 AC-265 达成之前**，本条只能记为『规程已定义、尚不可执行』」，而 `goals/AC-265-goal.md` 现为 `status: achieved` ⇒ **豁免已失效、前置在字面上是活的**，但它仍然只靠意志执行（硬规则 9：产物不可区分 ⇒ 守与不守同形）。

**本任务把它变成「记录，⛔ 不阻塞」——这是一条设计约束，不是措辞偏好：**
- 反例就在眼前：develop 的 CI 自 2026-10-10 起因**纯环境原因**红了 5 天（最后一次 decisive 绿 2026-10-10T03:04:40Z）。若把该前置做成**硬闸**，等于用一行代码把「环境抖一下 ⇒ 永不发版」制度化 —— 正是 §4.2 自己正文点名要避免的那种僵局（硬规则 12：每个前置单看都成立、合起来永远差最后一步）。§4.2 当初为 AC-265 开的那扇门，说明作者知道这条会死锁。
- 所以载体只做**可见性**：preflight 读一次 develop 的最后一次 decisive run，把读数写进**这次 cut 自己的**痕迹并打印出来 ⇒ 任何一次 cut 都带着它当时的 CI 读数、可事后查。
- 读数口径：carrier = `.quay/ci-runs.jsonl`；`branch=develop` ∧ `workflow ∈ {ci.yml, CI}` ∧ `conclusion ∈ {success, failure}`（`cancelled` 按设计排除，⛔ 不得把 cancelled 读成绿或红）。
- ⛔ 新记录**另起一个载体**（放在 `.quay/release-branch-finish.jsonl` 旁边），⛔ **不复用**它的 `form=` 词表（硬规则 8：不借用别的载体的词汇表来表达新语义）。

## Plan

1. 在 `scripts/release-cut.mjs` 的 preflight 里读 develop 的最后一次 decisive run（上面的口径），解析出 `{runId, conclusion, ts, url}`。
2. 把「本次 cut 时刻 develop 的 CI 读数」写进一个新载体（自己命名、自成词汇表），并在 preflight 的**输出里打印**该读数（人能看到）。
3. 三值读数：无记录 / 全是 cancelled / 读不出 ⇒ 显式记 `not-evaluated`（⛔ 不伪装成绿或红，硬规则 3b/6）。
4. ⛔ **不加闸**：CI 读数是红时 preflight 与 cut **照常继续**（本任务只增加可见性，不新增阻塞）。
5. 负控与 A/B：构造「最近一次是 failure」的形状确认记录与打印如实；构造「无 CI 行 / 全 cancelled」的形状确认记 not-evaluated；确认两种形状下 cut 都**不被阻塞**。

**落实说明（与 Proposal 的一处偏差，如实记）**：Proposal 写的路径 `scripts/release-cut.mjs` 不存在 —— 真实路径是 `plugin/scripts/release-cut.mjs`（`scripts/release-cut.sh` 是薄壳，逻辑全在 renderer 里；`.sh` ⛔ 未改，因 sh-census 是零余量棘轮）。`## Touches` 已按真实路径改正。另新增 `.gitignore` 一条：新载体必须被忽略，理由与它上面两个兄弟条目完全相同（ff 的 clean-tree 通道只放行 `??`，而被 `git add -A` 扫进提交的记录会被下一次 `git checkout` 静默删掉）。

## AC

- [x] AC1: 读数口径的代码原文（`plugin/scripts/release-cut.mjs`，preflight ⑥，函数 `readLastDecisiveCi`）：
  ```js
  if (r.branch !== branch) continue;                              // branch = --base，即 develop（其默认值，也是 §4.2 的主体）
  if (r.workflow !== "ci.yml" && r.workflow !== "CI") continue;   // 两个拼写：Actions 的 run.name 在本仓是 "CI"
  onBranch++;
  if (r.conclusion === "cancelled") { cancelled++; continue; }    // ⛔ cancelled 不是判决
  if (r.conclusion !== "success" && r.conclusion !== "failure") continue;
  if (typeof r.ts !== "string" || r.ts === "") { undated++; continue; }
  if (last === null || r.ts > last.ts) last = r;                  // 取 ts 最大者，⛔ 不是最后一行
  ```
  **`cancelled` 为何被排除**：cancelled 的 run 是被后续 push 顶替掉的，它**不表态** develop 是否绿（SPEC §4.2 自报：其量测窗口里 develop 的 run 有 40/92 = 43% 是 cancelled）。把它读成绿或读成红都是**把一个不表态的读数塞进两种判决之一**（硬规则 3b）⇒ 它只被计数，用来把「全是 cancelled」与「一行都没有」区分成两个不同的 not-evaluated 取值。
  **取 ts 最大而不是最后一行**：实测 2026-10-15，`.quay/ci-runs.jsonl` 首行 ts 是 2026-09-14、末行是 2026-10-15（采集器会回填），两者不是同一行。
- [x] AC2: 新载体路径 = `.quay/release-cut-preflight.jsonl`（落在 `--root`，即生产上的主检出；与 finish 台账同一个 `.quay/`）。一行**真实**记录（夹具里放的是从主检出只读拷进去的**真实生产载体** `.quay/ci-runs.jsonl`，2024 行）：
  ```json
  {"ts":"2026-10-15T08:38:30Z","stage":"preflight","tag":"v9.9.5","branch":"develop","ciReading":"failure","run":{"runId":38705262851,"conclusion":"failure","ts":"2026-10-15T08:23:03Z","url":"https://github.com/yaleh/quay/actions/runs/38705262851"},"carrier":".quay/ci-runs.jsonl"}
  ```
  四个 run 字段（`runId` / `conclusion` / `ts` / `url`）嵌在 `run` 下，因为**它们是那个 run 自己的字段**；`ts` 是记录自己的时刻 = **「tag 时刻」**（tag 在同一个 cut 里几分钟后打在同一个 `base` 上）。
  **为何不复用 `release-branch-finish.jsonl` 的 `form=` 词表**（硬规则 8）：`form` ∈ {tagged, merged, cut, deleted-local…} 回答的是「release 分支的**下场**是什么」，本载体回答的是「切点时刻 **CI 的读数**是什么」—— 两问不同。借词表会让一个读者以为 `ciReading` 与 `form` 同域，且两个载体的演化会互相锁死。新载体的词表是它自己的：`ciReading` ∈ {success, failure, not-evaluated} + `ciNotEvaluatedReason`。测试里 `assert.doesNotMatch(line, /"form"/)` 把这一条钉住。
- [x] AC3: preflight 输出里打印该读数的原文（人造/真实「最近一次 decisive = failure」的 ci-runs 形状各跑过一次，下面是真实那次的完整三行）：
  ```
  preflight: 'develop's last decisive CI run: failure — run 38705262851 at 2026-10-15T08:23:03Z https://github.com/yaleh/quay/actions/runs/38705262851 (source: .quay/ci-runs.jsonl; decisive = conclusion ∈ {success,failure}, ⛔ 'cancelled' is not a verdict)
  preflight: ⛔ RECORDED, NOT A GATE — a red reading does NOT block this cut (SPEC §4.2 made visible, not enforced; see the header).
  preflight: CI reading recorded to /tmp/rci-real-bPf77f/repo/.quay/release-cut-preflight.jsonl
  ```
  人造形状（开发期合成载体，用来看「更新但不是判决的行不会被选中」）读出的也是 `failure`：
  ```
  preflight: 'develop's last decisive CI run: failure — run 38703673544 at 2026-10-15T08:09:29Z https://github.com/yaleh/quay/actions/runs/38703673544 (source: …)
  ```
  该形状里刻意放了三条**更晚**的干扰行（develop 上一条 `cancelled`、develop 上一条 `Release` workflow 的 failure、master 上一条 CI failure），读数没有被它们带走。
- [x] AC4: **负控一 —— 缺 / 全 cancelled 必须是显式 not-evaluated**（`--dry-run` 下打印，两种形状各一次）：
  ```
  # (a) 载体不存在
  preflight: 'develop's last decisive CI run: not-evaluated (carrier-absent — ENOENT: no such file or directory, open '/tmp/…/repo/.quay/ci-runs.jsonl') (source: .quay/ci-runs.jsonl; …)
  # (b) 载体存在，但 develop 的 CI 行全是 cancelled
  preflight: 'develop's last decisive CI run: not-evaluated (all-runs-cancelled) (source: .quay/ci-runs.jsonl; …)
  # (c) 有行，但没有一行属于 develop（第三种成因，与 (b) 可区分）
  preflight: 'develop's last decisive CI run: not-evaluated (no-run-for-branch) (source: .quay/ci-runs.jsonl; …)
  # (d) 正控（硬规则 4）：真的绿读数必须被读成 success —— 否则上面三条「not-evaluated」由一个对任何输入都答「not-evaluated」的读者也能满足
  preflight: 'develop's last decisive CI run: success — run 42 at 2026-10-15T08:09:29Z https://example.invalid/42 (source: …)
  ```
  (b) 那一行**既不出现 success 也不出现 failure**（测试对该行断言 `doesNotMatch(/\b(success|failure)\b/)`，断言前先按 `(source:` 切掉脚注，否则断言读到的是脚注里的词表说明）。
  **记录侧同样是 not-evaluated**：四次 dry-run 之后 `wc -l .quay/release-cut-preflight.jsonl` = **1**（只有前面那次真 cut 写的那一行，dry-run 未追加、未写绿也未写红），并且 dry-run 自己打印 `preflight: CI reading NOT recorded (--dry-run writes nothing)`。
- [x] AC5: **负控二（本任务的核心约束）—— CI 读数为 failure 时 cut 照常推进**。真实切割（`--no-push --no-dispatch`，夹具的 develop/author 形状与生产一致）：
  ```
  $ bash <worktree>/plugin/scripts/release-cut.sh 9.9.5 --root <fixture> --no-push --no-dispatch
  preflight: 'develop's last decisive CI run: failure — run 38705262851 at 2026-10-15T08:23:03Z https://github.com/yaleh/quay/actions/runs/38705262851 (source: .quay/ci-runs.jsonl; …)
  preflight: ⛔ RECORDED, NOT A GATE — a red reading does NOT block this cut (SPEC §4.2 made visible, not enforced; see the header).
  preflight: CI reading recorded to /tmp/rci-real-bPf77f/repo/.quay/release-cut-preflight.jsonl
  cut-merged: 'release/v9.9.5' -> 'develop' at 9c63dc659a7f060b52ca63ecb05e7715149289c5
  cut-tagged: 'v9.9.5' at 9c63dc659a7f060b52ca63ecb05e7715149289c5
  deleted-local: release/v9.9.5 (license: cut via tag v9.9.5)
  finished: release/v9.9.5
  cut: v9.9.5 landed on 'develop' (merge point tagged, 'release/v9.9.5' deleted), released via release.yml, and 'develop' now carries 9.10.0
  exit=0
  $ git -C <fixture> rev-parse --verify --quiet refs/tags/v9.9.5
  99e2caa595e334560fa631446f4e2ac318b1ab33        # TAG-OK —— CI 红，tag 照常落地
  $ cat <fixture>/out.txt | grep CAUSE      → 空；stderr 里也没有任何 release-cut-ci 的 CAUSE=
  ```
  代码注释里写明「为何是记录而不是闸」，就在 `plugin/scripts/release-cut.mjs` 的 preflight ⑥ 块头：指向 ① §4.2 自己的豁免原文（「⛔ 在 AC-265 达成之前 … **不得**用它去阻塞任何现有流程」）；② 该豁免所针对的死锁并未消失（develop 的 CI 自 2026-10-10 起因纯环境原因红了 5 天）；③ 硬规则 12（每个前置单看都成立、合起来永远差最后一步）。块尾另有一条同样带 ⛔ 的约束：**记录本身也不能阻塞** —— 载体写不进去时打印独立的 `NOT RECORDED` 行并继续（硬规则 3b：「没记成」不得与「记了」同形）。
- [x] AC6: 既有用例未变红 + 新判据自证其红。
  ```
  $ bash scripts/test.sh plugin/test/release-cut.test.mjs
  ℹ tests 14
  ℹ suites 0
  ℹ pass 14
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ```
  **自证其红（两次读数）—— 变体一：把 not-evaluated 臂写成绿**（`readLastDecisiveCi` 的 not-evaluated 返回改成 `ciReading: "success"`）：
  ```
  基线:  ℹ tests 1 / ℹ pass 1 / ℹ fail 0            （AC4 用例通过）
  变异后: ℹ tests 1 / ℹ pass 0 / ℹ fail 1
    AssertionError: a cancelled-only carrier must read as not-evaluated:
      preflight: 'develop's last decisive CI run: success — run undefined at undefined
  ```
  **变体二：把读数写成闸**（preflight ⑥ 后加 `if (ci.ciReading === "failure") fail("release-cut-ci-red-temporary-mutation", …, 2)`）：
  ```
  基线:  ℹ tests 1 / ℹ pass 1 / ℹ fail 0            （AC5 用例通过）
  变异后: ℹ tests 1 / ℹ pass 0 / ℹ fail 1
    AssertionError: a red CI reading must NOT block the cut (exit=2):
      CAUSE=release-cut-ci-red-temporary-mutation — the reading blocked the cut (MUTATION)
  ```
  两次变异都已还原（`git diff` 只剩实现本身）。
- [x] AC7: 改动只落在本任务 Touches 里的项。
  ```
  $ git diff --name-only develop...HEAD
  .gitignore
  plugin/scripts/release-cut.mjs
  plugin/test/release-cut.test.mjs
  $ node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
      --task gap-release-cut-preflight-records-ci-reading-not-blocking \
      --worktree <worktree> --merge-target develop
  ANTI-DRIFT OK: task gap-release-cut-preflight-records-ci-reading-not-blocking — 3 actual file(s), all within declared Touches (N glob(s))
  ```
  第一次跑时它报了 2 条 out-of-declared（`.gitignore`、`plugin/scripts/release-cut.mjs`）——正是因为原 `## Touches` 写的是不存在的 `scripts/release-cut.mjs`；本任务把声明改正后才归零（那次红是**声明**的缺陷，不是改动的越界）。三个文件全部是 release 相关：renderer、它的测试、新载体的忽略条目。

## DoD

- 落地后 develop 上**下一轮真实 CI run** 不因本改动新增失败项（粘贴 run id + 结论）。
  - **落地前基准读数**：develop 最近一次 decisive CI run = `38705262851`，`conclusion: failure`（`ts 2026-10-15T08:23:03Z`，从真实载体 `.quay/ci-runs.jsonl` 读出）。它**已经**是红的，且红因与本改动无关（本改动此前不在任何 CI 能跑到的树里）。
  - 本改动能移动 CI 失败面的**唯一**入口是它改的那个测试文件：`plugin/test/release-cut.test.mjs` 实测 **14/14 绿**（两次：`node --test` 直跑与 `scripts/test.sh`）。其余两处（renderer 的注释+preflight 代码、`.gitignore` 一条）不被 CI 的测试步执行。
  - ⛔ **如实写明**：workspace 的「下一轮 run」的 run id 在实现席位上**结构上取不到**（它发生在落地之后），所以这里给不出那一个 id —— 给出的是落地前基准 + 本改动唯一可动的面已实测绿。
- 下一次真实 cut（人裁定后）的痕迹里能看到该 CI 读数（粘贴那行；若在落地后的窗口内没有 cut，如实写明「尚无 cut 样本」并给出可查的载体路径）。
  - **尚无 cut 样本**（落地窗口内没有真实 cut）。可查载体路径：**`<主检出>/.quay/release-cut-preflight.jsonl`**，每行一个 cut，`ciReading` 即该次 cut 时刻 develop 的 CI 读数。交付前已在夹具上用**真实生产载体**跑过一次真 cut，落点与格式见 AC2 / AC3 / AC5。
- ⛔ 明确不改：本任务**不得**让 CI 读数阻塞任何现有流程（这正是它的设计约束）。
  - 已证：AC5 的真实切割在读数 `failure` 下照常落地 tag（exit=0）；代码里 preflight ⑥ 全块**没有任何 `fail(...)`**，连「记录写不进去」也只打印一行并继续；变体二把读数改成闸时测试立刻红（AC6）。

## Touches

- plugin/scripts/release-cut.mjs
- plugin/test/release-cut.test.mjs
- .gitignore
- tasks/gap-release-cut-preflight-records-ci-reading-not-blocking.md


ADR-007 逐里程碑暗轴记录（本任务的声明）
该轴仍暗,理由: 本任务只给 release-cut preflight 增加一次 CI 读数的记录与打印（记录⛔不阻塞），是可见性改动，不量架构面（依赖图 / 文档比 / 变异存活都没测），没有可解析的读数可贴。
