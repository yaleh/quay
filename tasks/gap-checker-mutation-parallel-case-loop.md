---
id: gap-checker-mutation-parallel-case-loop
title: checker-mutation-check.sh 的 82 用例循环真正并行化——父 shell 累加器会在子 shell
  里丢，朴素加后台符即恒绿（AC-280）
status: ready
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-280
---
**type:** execution

## Proposal

**缺口（AC-280 判据，立案当轮直接量，2026-09-17，cwd = 主检出 `/home/yale/work/quay`）**：
`goals/AC-280-*.md` 的 criterion 是**位置判定**——在 `plugin/scripts/checker-mutation-check.sh` 里
grep 到字面 `run_one_case "$name" "$workdir"` 的那一行必须带 `&`，且其后 40 行内出现 `wait`。
逐字重跑判据，**exit 1**：

```
call_line_no=328
call_line_text=    run_one_case "$name" "$workdir"
backgrounded=0 wait_found_within_40=0
```

该调用点在 `run_cases()` 的 `for name in "${case_list[@]}"; do … done`（`:325-342`）里逐例串行。

**成本读数（同一轮实测）**：`bash plugin/scripts/checker-mutation-check.sh --check`
在 boheidc（`nproc=16`）上 `duration_ms: 94306` / `WALL=94.48s`；
`checkers_total: 80`、`checkers_with_mutation: 80`、`uncovered: []` ⇒ **一次跑 82 个用例
（80 个注册检查器 + 2 个 AC5 regression）**。GOAL-022 背景：这段在 128 核 self-hosted runner 上
单独占静态检查阶段 18 秒，而同期整机 CPU 空闲率 93.9%（中位数 99%）。

### ⛔ 为什么这不是「加一个后台符」——本任务真正的对象

`run_cases()` 把结果累加在**父 shell 的变量**里：`_stayed_green` / `_always_red` / `_errors` /
`_regression_green` / `_stayed_names` / `_always_names` / `_error_names` / `_results_json` /
`_executed_names`。**后台作业运行在子 shell 中，对上述变量的每一次写入都被丢弃。**

于是 AC-280 字面要求的最小改动（`run_one_case "$name" "$workdir" &` 后接原有的 `exit_code=$?`）
会同时造成三件事：

1. `$?` 变成 `&` 自身的状态（恒 0）⇒ **每个用例都被记成 `pass`**；
2. 所有计数器与 `_results_json` 的写入全部丢失 ⇒ `mutations_that_stayed_green: 0`、`errors: 0`；
3. ⇒ 闸门**无条件**打印 `RESULT: PASS`。

**这正是这个脚本自己存在的原因**（其头注释 `:8-11`：一个在它声称能抓的缺陷下从不报红的检查器，
与一个恒返回 pass 的检查器不可区分）。⇒ **AC-280 的机器判据严格弱于它的 SPEC 意图**，所以本任务
必须自带有分辨力的 AC，⛔ 不能以「判据 exit 0」收口。

**同形先例（本仓库已付过一次账）**：`scripts/test.sh:291-297` 的 `run_doc_checks` **主动强制
`RUN_CHECKER_PARALLEL=0`**，理由逐字写着 `backgrounded checkers would return 0 immediately and
mask a doc-check failure`——「后台化 ⇒ 立即返回 0 ⇒ 掩盖失败」这一 fail-open 已被本仓库实测命中过。

### ✅ 现成机件（硬规则 1：用机件，不手搓）——⛔ 不要另造一套

`plugin/scripts/checker-cost-lib.sh` 的 `run_checker` 并行分支（`:110-158`）**已经解决过同一个形状**，
应当照搬而不是重写：

- `_run_par_wait_slot()`（`:121-125`）——池容量节流：
  `while [ "$((_run_par_launched - $(_run_par_done_count)))" -ge "$_run_par_max" ]; do wait -n 2>/dev/null || true; done`
- 结果通道（`:138-145`）——后台子 shell `printf '%s|%s\n' "$_name" "$_rc" >> "$_run_par_results_file"`，
  **退出码用文件回传，归因在 wait 之后做**；
- 上限推导（`:132-134`）——`_run_par_max="${STATIC_CHECK_CONCURRENCY:-}"`，空则
  `"$(nproc 2>/dev/null || echo 4)"`，**宿主推导，无字面量**。

`checker-mutation-check.sh` 目前 **不 source 任何库**（实测 `grep -n '^\. \|^source '` 零命中），
所以实现者要么 source `checker-cost-lib.sh`、要么照搬该形状（后者更稳：该库的 `_run_par_*` 全局量
是为 `run_checker` 定制的）。

### ⚠️ 位置判据的两条物理约束（写错则判据恒假）

AC-280 的 `grep -n` 是**逐物理行**的，`case "$CALL_LINE_TEXT" in *"&"*)` 只看那一行的文本：

1. `run_one_case "$name" "$workdir"` 字面与 `&` **必须在同一物理行**。照搬 `checker-cost-lib.sh`
   `:138-145` 的**多行**子 shell 写法（`(` / `run_one_case …` / `) &` 各占一行）会让 `&` 落在另一行
   ⇒ 判据恒假。⇒ 单行形：
   `( _rc=0; run_one_case "$name" "$workdir" || _rc=$?; printf '%s|%s\n' "$name" "$_rc" >> "$_res" ) &`
2. `wait` 必须在调用行**之后** 40 行内（`awk 'NR>n && NR<=n+40'`）。`_run_par_wait_slot` 里的
   `wait -n` 出现在**调用之前**，不算。

### 风险：共享状态（必须用等价性对照证明，⛔ 不得假定）

82 个用例被设计成各在自己的 `mktemp -d` workdir 里工作——已抽查确认若干：`concurrency-literal-check.sh:15-20`
先 `cd "${workdir}"` 才写 `plugin/scripts/fixture.ts`；`capability-catalog.sh:19-20` /
`delivery-manifest-check.sh:13-14` 等是 `cp "${repo_root}/…" "${workdir}/…"` 的**只读**方向。
但**「已抽查」不等于「全部只读」**：不隔离的用例在串行下无害、在并行下会互相踩。
⇒ Plan 第 5 步要求一次**全量等价性对照**（并行 vs 串行的 `results` 映射逐键比对），而不是假定。

<!-- dedup-ref -->
**去重核对（机制，不是症状关键词）**：本 store 内无任何任务以 `goal_ac: AC-280` 认领该 AC
（逐文件扫 `^goal_ac:` 零命中）。机制相邻但**不同层**、且**已 done** 的三条：
`gap-run-static-checks-zero-concurrency-can-parallelize`（并行化的是 `run_static_checks` 里的
`run_checker` **调用**，即层间；本条是 `checker-mutation-check.sh` **内部**的用例循环）、
`gap-scoped-static-gate-sequential-pays-sum-not-max`（scoped 相位）、
`gap-checker-mutation-check-has-no-change-tier-companion`（`--check-changed` 伴生门，已在脚本里）。
三条都不覆盖本条机制，故不构成重复。

## Plan

1. **结果通道**：父进程 `mktemp -d` 一个结果目录；每例的退出码由后台子 shell 自己追加写入
   `${_res_dir}/results`（`name|rc` 单文件形，照搬 `checker-cost-lib.sh`）。**名字与顺序由父进程的
   数组持有**，不依赖子 shell 写回任何父变量。
2. **派发**：单行
   `( _rc=0; run_one_case "$name" "$workdir" || _rc=$?; printf '%s|%s\n' "$name" "$_rc" >> "$_res" ) &`
   ——满足上文物理约束 ①。原有 `case "$exit_code"` 的分类（pass / stayed-green / always-red / error
   以及 regression 计数）**逐字保留**，只在父进程里跑（回收阶段读回退出码后执行）。
3. **宿主推导的有界并发**：
   `${CHECKER_MUTATION_PARALLEL:-${STATIC_CHECK_CONCURRENCY:-$(nproc 2>/dev/null || echo 4)}}`。
   ⛔ 不写 128 / 16 / 4 这类字面量——`scripts/test.sh:453-455` 已把这条警告逐字写在旁边。
   `STATIC_CHECK_CONCURRENCY` 是既有同族旋钮，**优先复用而不是新增**。无界 82 路会把 16 核开发机
   打爆，并让套件红与宿主争用相关（`suite-red-spawn-heavy-driver-tests-load-correlated`）。
4. **回收**：池节流用 `_run_par_wait_slot` 形；派发循环结束后显式 `wait`（满足物理约束 ②，
   且必须落在调用行之后 40 行内）。回收后在父进程逐个读回退出码并跑原有分类。
5. **等价性对照（本任务的真实验收）**：串行（改前脚本）与并行（改后）各跑一次全量 `--run --json`，
   逐键比对 `results` 映射（键集与每个值都相等）。任何一例不一致 ⇒ 该用例共享了状态，必须隔离
   或串行化，⛔ 不许靠放宽比对通过。
6. **空 `case_list` 必须仍是 no-op**：`--meta-inject` 会把 `case_list=()`；在 `set -u` 下未加保护的
   `${_pids[@]}` / `wait -n` 空集会报错。三种 `--meta-inject` 与 `--selftest` 必须照旧把闸门打红。
7. **逐字不动**：`--only` / `--check-changed` 的收窄语义、JSON 键集、退出码约定（0/1/2/3/4）、
   `_json_mode=1` 时 stdout 只有 JSON（`plugin/test/checker-mutation-check.test.mjs` 直接 `JSON.parse`）。
8. **陈旧散文（见 AC9，范围已收窄）**：`scripts/test.sh:67`、`:363`、`:1522` 三处写着
   `~13s`（那是 128 核 runner 的读数，本机实测 94.3s）。⛔ **`plugin/scripts/runner-static-gate.ts`
   不在本任务范围内**——它的 `:472` 那句 tier 注释被 `plugin/test/select-static-checks-for-touches.test.mjs:563-575`
   **逐字钉死**（`src.includes(block)`，且注释与命令行必须相邻出现），改它会平白打红一个无关测试。

## AC

- [ ] **AC1（goal 判据）**：AC-280 判据逐字重跑 exit 0。把 `goals/AC-280-*.md` 的 `criterion:` 块原样
      放进 `bash <<'CRIT' … CRIT` 跑一次，贴出 `backgrounded=1 wait_found_within_40=1` 与退出码。
- [ ] **AC2（真判据，位置判定 + 可分辨）**：调用行的 `&` 与它之后的 `wait` 搬运的是**用例自己的退出码**，
      不是 `&` 的状态。做法：用 `plugin/test/checker-mutation-check.test.mjs` 里那个现成 fixture
      （零依赖探针 `fake-zerodep-check` ⇒ 必须被报 `stayed-green`），跑
      `bash plugin/scripts/checker-mutation-check.sh --repo-root <tmp> --run --json`，
      断言 `results["fake-zerodep-check"] == "stayed-green"` ∧ `mutations_that_stayed_green >= 1`。
      **贴出实际 JSON 片段。**
- [ ] **AC3（负控制，必须能取假）**：把「朴素后台符、无结果通道」这一形态做成一份脚本副本
      （`sed` 或补丁），对同一 fixture 跑 AC2 的断言 ⇒ **必须失败**（该形态会把 `fake-zerodep-check`
      记成 `pass`）。贴出该失败输出。⛔ 不做这一步，AC2 无法与「恒绿」区分（硬规则 4）。
- [ ] **AC4（等价性，Plan 5）**：并行 `--run --json` 与串行（改前脚本，`git show` 取旧版即可）的
      `results` 映射**逐键相等**——键集相同且每个值相同。贴出两份提取片段与 `diff` 结果。
      任一例不同 ⇒ 定位到该用例的共享状态并处置（隔离或串行化），⛔ 不得靠放宽比对通过。
- [ ] **AC5（并发宿主推导，无字面量）**：贴出推导那一行的原文（含 `nproc` / `STATIC_CHECK_CONCURRENCY`）
      与本机 `nproc` 读数；`grep -n` 证明脚本里没有把并发数写成裸字面量。
- [ ] **AC6（before/after 墙钟）**：贴出改前与改后的 `duration_ms`（或 `/usr/bin/time` 的 WALL）
      **与本机 `nproc`**。⛔ 不设阈值（硬规则 4 推论一：端到端耗时依赖外生变量），只报前后对照。
- [ ] **AC7（回归）**：① `bash scripts/test.sh plugin/test/checker-mutation-check.test.mjs` 全绿；
      ② `bash plugin/scripts/checker-mutation-check.sh --selftest` exit 0；
      ③ `--list --json` 的键与 `checkers_total: 80` / `checkers_with_mutation: 80` / `uncovered: []` 不变；
      ④ 三种 `--meta-inject` 仍非 0 退出。逐条贴退出码。
- [ ] **AC8（本 delta 自己的静态门）**：`bash plugin/scripts/checker-mutation-check.sh --check-changed --repo-root <root>`
      在改后为绿（本 delta 命中的 carrier 就是该脚本自身），且全量 `--check` 为绿。贴输出。
- [ ] **AC9（散文不再漂移，范围已收窄）**：`scripts/test.sh` 的 `:67`、`:363`、`:1522` 三处
      `~13s` 已改成实测值、或已删掉裸数字；`grep -n '13s' scripts/test.sh` 贴出改动后的命中。
      **⛔ 负向断言**：`plugin/scripts/runner-static-gate.ts` 必须**未被改动**——
      跑 `node --test plugin/test/select-static-checks-for-touches.test.mjs` 全绿即证。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「代码改了、测试绿了」，而是**生产载体上跑出来的读数
变了，且这个变化能被一个反例打红**：

1. **落地对象**：并行版真的在 develop 上——用
   `git show develop:plugin/scripts/checker-mutation-check.sh | grep -n 'run_one_case'` 贴出那两行
   （调用行带 `&`、其后 40 行内有 `wait`），⛔ 不是只看工作树。
2. **AC-280 在落地后的内容上 exit 0**：对 `git show develop:…` 取到的内容重跑一次判据并贴退出码
   （⛔ 不是对未提交的工作树跑）。
3. **有分辨力**：AC3 的负控制**实际做过并且打红了**——贴出「朴素后台符」副本的失败输出。
4. **同一份并行脚本在生产路径上跑过**：`bash plugin/scripts/checker-mutation-check.sh --check`
   在真实树上 `RESULT: PASS` 且 `mutations_that_stayed_green: 0` ∧ `errors: 0`
   （证明并行路径没有把 L_S 仪器变成恒绿）。
5. **等价性结论**：AC4 的逐键比对结果贴出（并行 vs 串行），并说明有没有任何用例需要隔离。
6. **before/after**：AC6 的两个数与宿主核数。
7. **证据留痕**：判据输出、负控制失败输出、等价性 diff、前后 duration 落成 `.quay/` 下的证据文件
   或写进任务体，**可被下一轮独立复算**（⛔ 不是只写一句「已绿」）。

## Touches

- plugin/scripts/checker-mutation-check.sh
- plugin/test/checker-mutation-check.test.mjs
- scripts/test.sh
- tasks/gap-checker-mutation-parallel-case-loop.md
