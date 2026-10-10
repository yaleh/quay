---
id: gap-routine-semantic-dedup-scan-runcli-twostill-handrolled
title: "semantic-dedup-scan: Two members delegate to shared parseArgs; two still
  hand-roll the same --root/--json/--help loop."
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Two members delegate to shared parseArgs; two still hand-roll the same --root/--json/--help loop.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791631645924` · ts `2026-10-10T11:27:25.924Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`runCli`
- 涉及文件：
- `plugin/scripts/task-ac-carryover-check.ts:333`
- `plugin/scripts/task-contract-check.ts:533`
- `plugin/scripts/threshold-scope-check.ts:409`
- `plugin/scripts/tmux-test-isolation-check.ts:100`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
unify

## 处置
**修掉**——`runCli` 家族里最后两个私有 flag 循环已删除，四个成员现在全部走
`plugin/scripts/gate-script-base.ts` 的 `parseArgs`（本仓库唯一 spec-driven 参数解析器）。

- `threshold-scope-check.ts` / `tmux-test-isolation-check.ts` 的 `runCli` 不再手写
  `--root/--json/--judge`（前者另有 `--write-ratchet/--reset-baseline`）的 if/else 循环；改用
  `parseArgs(argv, { minArgs: 0, strict: true, flags: {…} })`。`strict:true` 保留原循环的未知
  `--flag` 守卫（exit 2）。两文件的入口按已折叠成员（`task-ac-carryover-check.ts` /
  `task-contract-check.ts`）的同一约定改传 `process.argv` 原值（`parseArgs` 自己拥有 `slice(2)`
  约定），不再各自 `slice(2)` 后再被解析器二次切片。
- **共享解析器不自动携带、故在本调用点显式补回的两条输入语言**（⛔ 不是"顺手加严"，是原循环本来
  就有、不补即为行为回退）：
  ① **多余 positional 仍是用法错误**——`threshold-scope-check.ts` 原本就 `unexpected positional`
  → exit 2；`tmux-test-isolation-check.ts` 原本让它**静默落空**，随后扫 `process.cwd()` 并对一个
  从未读到的输入报 PASS（硬规则 3b 的形状）。共享解析器把 positional 收进 `args` 而非拒绝，故两处
  各补一条显式守卫，家族在**同一处**停下，而不是继承弱的那条臂。
  ② **无值的 `--judge` 是用法错误**——原循环在此产出 `undefined`，随后 `path.isAbsolute(undefined)`
  抛异常；共享解析器的末位形状是 `""`。把 `""` 读成"没给"会**什么都不判却照样打印裁决**（同 3b），
  故显式 exit 2。
- 控制（按位置判定，硬规则 2）：两文件的测试各新增
  `disposition: runCli uses the SHARED parseArgs and carries no private flag loop`（断言**实际 import
  绑定** + 私循环字面头缺席）与 `disposition: an unknown --flag exits 2`；
  `threshold-scope-check.test.mjs` 另有 `disposition: a valueless --judge is a usage error…`，
  `tmux-test-isolation-check.test.mjs` 另有 `disposition: a stray positional exits 2 instead of
  silently scanning the default root`。
- **判据能取假（负控制，硬规则 4）**：把两条谓词对着**改前**的源文件（`git show HEAD~1:<f>`）干跑——
  两文件均 `parseArgs` import 不命中 + 私循环字面命中；改后两者皆反。
- 证据：`grep -c "for (let i = 0; i < args.length; i++)"` 在 `threshold-scope-check.ts` 与
  `tmux-test-isolation-check.ts` 各为 **0**；`plugin/test/threshold-scope-check.test.mjs`
  **13 tests / 13 pass / 0 fail**，`plugin/test/tmux-test-isolation-check.test.mjs`
  **12 tests / 12 pass / 0 fail**。
- **同族其余实例（硬规则 5b）**：`grep -rln "for (let i = 0; i < args.length; i++)" plugin/scripts/*.ts`
  仍命中 **46** 个文件（前 3：`ac56-recommended-deordered-check.ts:121` /
  `concurrent-batch-scheduler.ts:455` / `cap-from-gate.ts:451`）。它们**不在本 finding 的符号簇内**
  （本 finding 由 `semantic-dedup-scan` 按符号 `runCli` 聚类，只含上述 4 个文件），且已被同轮立案的
  开放任务 `gap-routine-semantic-dedup-scan-parseargs-handrolled-residuals`（status: ready）覆盖 ——
  本任务不重复处置。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `runcli-twostill-handrolled`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791631645924`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**2026-10-10 本轮：fan-in 阻塞的【外来红】已修（上一轮 `exited-not-landed` 的真因，不在本任务的 delta 里）**

- **先查主检出、再判 mine vs develop-wide**：在**干净主检出** `/data/home/yale/work/quay`（无未提交改动、`develop..HEAD` 与 `HEAD..develop` 的代码面即 develop）单跑
  `node --test plugin/test/task-granularity-advice.test.mjs` ⇒ **确定性红**（`tests 16 / pass 15 / fail 1`），
  报文 `peers ∪ mentions must equal the grep oracle for plugin/scripts/worker-driver.ts`，
  `expected` 含 `goal-035-merge-and-postmerge-verify`、`actual` 不含 ⇒ **develop-wide、确定性、可从主检出复现**（不是本分支引入，也不是本机偶发）。
  本任务的 delta 只有 4 个文件（`git diff --stat develop...HEAD`：`threshold-scope-check.ts` / `tmux-test-isolation-check.ts` 及各自测试），与该断言无交集。
- **真因（口径缺陷，不是工具错）**：该 oracle 的第二段是**全文行锚定** `grep -lE '^status: (todo|ready)$'`，
  把**正文里带一行 `status: ready`** 的任务读成「开放」。`tasks/goal-035-merge-and-postmerge-verify.md`
  正文第 16-30 行有一份**重复的 frontmatter 块**（第 19 行 `status: ready`），而其真正的 frontmatter 是
  `status: done`（第 4 行，`e2283b157` 于 19:37 翻的）⇒ oracle 多列一个 id，`union` 正确地不含它。
  工具 `readOpenTasks` 读 **frontmatter**，这是**正确**的一侧（建这个比对的父任务自己量到同一结论：
  `gap-task-granularity-advice-script-merge-candidates-and-per-file-history`——「把 grep 的 status 判据限制在 frontmatter 段内后，两侧 0 处不符」）。
  全仓实测只有 `goal-035-merge-and-postmerge-verify` 同时命中「提本测试的样本路径」与「正文有精确 `status: todo|ready` 行」。
- **修法（self-fix，协议：外来确定性红必须就地修 + 扩 Touches）**：把 oracle 的第二段收敛进 **frontmatter**——
  stage 1（step 2b 的 mention grep `grep -lF -- "$p" tasks/*.md`）**逐字不变**；stage 2 改跑
  `awk 'FNR==1{fm=($0=="---");next} fm&&$0=="---"{fm=0;next} fm&&/^status: (todo|ready)$/{print FILENAME;fm=0}'`，
  且**两段的退出码分别断言**（stage 1：grep 0=命中/1=无匹配；stage 2：awk 0）⇒ 任一真实工具故障都不会被读成「空 oracle」（硬规则 3b）。空 oracle 仍是合法读数（2026-10-07 的注释保留）。
- **本轮读到的实际读数**：`node --test plugin/test/task-granularity-advice.test.mjs` ⇒ **`tests 16 / pass 16 / fail 0`**，
  含 `✔ production: for real declared paths, peers ∪ mentions equals the step-2b grep oracle (444ms)`。
- **与兄弟任务的同一处修（避免两者分叉）**：本修改**逐字节等同**于 `task/gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable` 上已提交的 `c3da2ae63`
  （blob `5639579b6`；其父 blob `fc643f024` 与本分支/develop 的该文件 blob 逐字节相同）⇒ 两条分支的该文件收敛到同一内容，无论谁先落地，另一条 `git merge develop` 都是无冲突的同值合并。那份修改是**先落地者**做的同一件事，不是两处不同实现。
- **未做（范围边界）**：⛔ 没有改 `tasks/goal-035-merge-and-postmerge-verify.md` 里那份重复 frontmatter 块——
  那是它自己 `task_write` 落下的载体，属**另一个**任务的范畴；本任务只修判据（判据把有效棋盘态读红，才是缺陷所在）。

## Touches
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/scripts/task-contract-check.ts`
- `plugin/scripts/threshold-scope-check.ts`
- `plugin/scripts/tmux-test-isolation-check.ts`
- `plugin/test/threshold-scope-check.test.mjs`
- `plugin/test/tmux-test-isolation-check.test.mjs`
- `plugin/test/task-granularity-advice.test.mjs`（fan-in 外来红：oracle 的 status 判据收敛进 frontmatter，stage 1 逐字不变）
- `tasks/gap-routine-semantic-dedup-scan-runcli-twostill-handrolled.md`

## Blocker

**2026-10-10T12:07:24.755Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: peers ∪ mentions must equal the grep oracle for plugin/scripts/worker-driver.ts
- run_id：wk-prod-anchor
- session_id：916dadd7-35a9-4d58-893d-6d2ab235f6df
- 后续：真因与修法见 `## Evidence`（外来红，已在本轮修掉，`plugin/test/task-granularity-advice.test.mjs` 16/16）。
