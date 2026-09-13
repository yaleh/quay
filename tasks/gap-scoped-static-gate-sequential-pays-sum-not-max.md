---
id: gap-scoped-static-gate-sequential-pays-sum-not-max
title: scoped 静态门逐次执行付出「和」而全量路径付出「最大值」——先证明 scoped 不属于 run_doc_checks 明文规避的
  fail-open 形态，再并行化并前后实测
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：2026-09-13 本会话对「worker 退出时未落地率 62%」（`.quay/worker-outcome.jsonl` 1801 条：exited-not-landed 1062 / completed 637 / failed 99）的实证调查。本条是其中**成本侧**的发现，与失败归因无关。

**读数（机制）**：
- 全量路径 `run_static_checks` 设 `RUN_CHECKER_PARALLEL=1`，以 `STATIC_CHECK_CONCURRENCY`（缺省 `nproc`）为界（`plugin/scripts/runner-static-gate.ts:89`、`plugin/scripts/checker-cost-lib.sh:128-147`）⇒ wall ≈ **最长的那一本**。
- scoped 路径 `run_scoped_static_checks_sel`（`scripts/test.sh:375-403`）是 `while IFS= read -r cmd; do … eval "${cmd}"; done`，**无 `&`/`wait`/`xargs -P`、不设该标志** ⇒ `run_checker` 走同步分支（`checker-cost-lib.sh:148-158`）⇒ wall ≈ 被选中各本**之和**。

**⚠️ 这是一个【有意的当前状态】，不是遗漏 —— 本任务必须论证为什么该翻，⛔ 不得当 bug 报。**
`runner-static-gate.ts:89` 明文写着 **"The scoped tier leaves this unset."**；把并行装进全量路径的 `gap-run-static-checks-zero-concurrency-can-parallelize`（**done**）是**刻意把 scoped 侧排除在范围外**的。本条是它的 scoped 侧延伸。

**⚠️⚠️ 并行化有一个【已被本仓库实测过的 fail-open 危险】，这是本任务的真实风险，不是走过场**：
`run_doc_checks`（`scripts/test.sh:291-297`）**主动强制 `RUN_CHECKER_PARALLEL=0`**，理由逐字写明：
`backgrounded checkers would return 0 immediately and mask a doc-check failure`
⇒ **后台化的 checker 立刻返回 0，把失败伪装成通过** —— 与「合格」同形的静默假绿（硬规则 3b）。
**⇒ 本任务若不能证明 scoped 路径不属于该形态，就不该做。**
可引为负控制的既有证据：`gap-scoped-static-check-red-no-fail-machine-line`（**done**）的 AC4 已钉住「同步分支与并行分支互斥、无重复发射」，且它修完后**同步路径也会发射 `STATIC_CHECK_FAILED` 机器行** ⇒ 并行化后不会丢失失败可见性。**但"不会丢可见性"≠"不会 fail-open"，后者必须由本任务的 AC2 当场干跑证明。**

**读数（量级，⚠️ 带方法学留保）**：真实任务 `gap-ac203-record-schema-has-no-kind-dimension`（8 条 Touches）scoped 选中 **22/50** 本；这 22 本在 `.quay/checker-cost.jsonl` 中各自末 7 次中位值**之和 ≈ 110s**。scoped 集合内最贵的是 `ac56-recommended-deordered-check` 26.4s（最贵两本 `checker-mutation-check` 55.6s、`outer-retirement-precondition-check` 34.9s 都是 `@static-tier full`，**不进 scoped**）⇒ 若并行，wall 上界 ≈ 26s 量级。
**⚠️ 该 110s 是在 16 路并行的 suite 内采样的 per-checker 中位值之和，结构上高估逐次执行的真实成本。因此本任务交付的是【前后实测】，⛔ 不是「省下 84s」这个断言**（硬规则 4：成本结构未知前不设数值阈值）。「付和 vs 付最大」这个**序关系**是结构性的，量级不是。

**与既有已落地任务的关系（⛔ 均非重复，各自是不同轴）**：
- `gap-run-static-checks-zero-concurrency-can-parallelize`（done）= 同机制的**全量侧**，明文把 scoped 排除在外 ⇒ 本条是其 scoped 侧延伸。
- `gap-scoped-runs-pay-full-static-check-overhead`（done）= 同一成本轴的**宽度**半边（用 tier 分层减少 checker 数量）；本条是**执行模式**半边（同时跑剩下的）。两条正交可叠加。并且同一个量已再生长：该任务当时读数「完整 `run_static_checks` ≈16s，其中 `checker-mutation-check` 13s」，**今天 `checker-mutation-check` 已是 55.6s（约 4 倍）**，登记本数已达 49（+1 虚拟）⇒ **祖先在宽度轴压下去的开销，在执行模式轴重新长了回来。**
- `gap-fan-in-gate-chain-parallel-after-merge`（done）= 并行的是 fan-in **leg 之间**（`typecheck ∥ doc-check`），不是 scoped 静态门**内部**。

**为什么值得做（收益面）**：这条成本**每次 dispatch 都付**（语料内 1801 次），⛔ 不只失败轮付；且 worker 退出前自验的 wall 直接决定它愿不愿意自验——它是「把更多检查前移到 worker 侧」一切方案的成本基数。

## Plan

1. **先取基线，后改代码**（⛔ 不得改完再回头补基线）：选 2–3 个 Touches 规模不同的真实任务，各跑 ≥2 次现状 scoped 门，落盘 wall + 选中本数 + 逐本耗时。
2. **先做 fail-open 判别，再决定要不要改**：核对 scoped 路径的失败传播形态——被 `eval` 的命令行在后台化之后，其退出码是否仍被收集并导致整体非零。若属 `run_doc_checks` 那种形态（后台化即 return 0）⇒ **本任务应结案为「不采用」**，⛔ 不得为了拿到 wall 收益而放过它。
3. 若判别通过：在 `run_scoped_static_checks_sel` 开启并行，并发上界**沿用读宿主的表达式**（`STATIC_CHECK_CONCURRENCY` / `nproc`），⛔ 不写字面量（硬规则 4 推论二：恰好等于当前机器容量的数字换台机器就变成真限制，且静默）。
4. 同样任务、同样 develop sha 再各跑 ≥2 次，前后对照。
5. 逐本核对**写入面**：scoped 集合里若有 checker 写同名临时文件/共享载体（`.quay/` 下缓存、cost 台账等），并行会互相踩。

## Acceptance Criteria

- [x] AC1（前后实测·核心，可取假）：同一任务、同一 develop sha，改前/改后各跑 ≥2 次 scoped 门，落盘 `.quay/scoped-static-parallel-evidence.jsonl`，每条带 `taskId` `developSha` `checkerCount` `wallMs` `parallel:true|false`。判据：文件存在 ∧ before/after 各 ≥2 条。⛔ 取假形态：after 的中位 wall **≥** before 的中位 wall ⇒ 本任务前提（付和 vs 付最大）在真实负载下不成立，必须如实写进读数段；⛔ 不得为让数字好看而更换样本或只保留有利的几次。
- [x] AC2（fail-open 负控制，可取假·**本任务最关键的一条**）：在**并行模式下**把一个**必然失败**的 checker 注入 scoped 集合（或令某本以非零退出），干跑一次。判据：scoped 门整体**退出码非零** ∧ 输出含该本的 `STATIC_CHECK_FAILED` 机器行；命令与输出尾部贴进读数段。⛔ 取假形态：并行模式下该注入**仍然绿**（或退出码 0）⇒ 命中了 `run_doc_checks` 明文规避的那个 fail-open 形态（后台化 checker 立刻返回 0，掩盖失败）⇒ **本任务必须结案为「不采用」**，⛔ 不得以「实际上很少失败」为由放行。
- [x] AC3（正确性一致性，可取假）：并行化后对**同一 worktree 状态**跑 scoped 门 ≥3 次，三次的**选中集合**与**逐本退出码**必须完全一致；并与改前逐次执行的逐本退出码比对。判据：差异数 = 0，该数字与比对清单落进读数段。⛔ 取假形态：任一本在并行下退出码与逐次不同 ⇒ 存在共享状态竞争，必须定位到**具体 checker 名**并列出；⛔ 不得以「重跑就绿了」结案——那正是 flaky 的定义。
- [x] AC4（并发上界读宿主，⛔ 非字面量）：判据：`grep -n 'RUN_CHECKER_PARALLEL\|STATIC_CHECK_CONCURRENCY' scripts/test.sh` 的命中行中，scoped 路径**不出现写死的并发数字**，并把该 grep 的**实际命中前 3 条**贴进读数段（硬规则 2 的产物：引用计数前先打印命中内容）。
- [x] AC5（写入面枚举，⛔ 非布尔）：产出 N 行表，N = 改后并行执行的 scoped checker 本数（须与 AC1 的 `checkerCount` 一致），每行给出「是否写 `.quay/` 或临时文件」与「并行安全的理由」。判据：表行数 == `checkerCount`；填不出取值 ⇒ 记 `未评估`，⛔ 不得留空、⛔ 不得写「应该没问题」。
- [x] AC6（⛔ 不得顺手削弱闸门）：改动**只动执行模式**。判据：`select-static-checks-for-touches.ts` 的选择公式（`{always} ∪ {change ∩ touches} − {full}`）逐字未变，且改前/改后对同一任务的**选中集合完全相同**（`--names` 输出比对，差异数 = 0）。⛔ 取假形态：选中集合发生任何变化 ⇒ 越界（那是宽度轴，属 `gap-scoped-runs-pay-full-static-check-overhead` 的范围）。

## Definition of Done

- `scripts/test.sh` 的 `run_scoped_static_checks_sel` 落地改动；`plugin/test/scoped-static-checks.test.mjs` 补两条可失败控制：①scoped 路径以并行模式调用（注入非并行即红）；②**并行模式下失败仍传播**（对应 AC2，注入必失败 checker 即红）。
- `.quay/scoped-static-parallel-evidence.jsonl` 含**实现落地之后**产生的真实前后读数（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。
- AC2 的 fail-open 干跑读数、AC3 的一致性读数、AC5 的写入面表落进任务体读数段。
- ⛔ **若 AC2 判定 scoped 属于 fail-open 形态，或 AC1 显示无净收益 ⇒ 如实结案为「不采用」并保留全部读数，同样算完成。** 本任务交付的是一个**有依据的决定**，不是这一行改动本身。

## Touches

- tasks/gap-scoped-static-gate-sequential-pays-sum-not-max.md
- scripts/test.sh
- plugin/test/scoped-static-checks.test.mjs

## Readings（实现落地后实测，2026-09-13；分支 `task/gap-scoped-static-gate-sequential-pays-sum-not-max`，提交 `be5e05b06`）

**改动面**：`scripts/test.sh` 的 `run_scoped_static_checks_sel` 开启 `RUN_CHECKER_PARALLEL=1`（并发上界沿用 `run_checker` 的 `STATIC_CHECK_CONCURRENCY`，缺省 `nproc`），循环后由 `run_checker_parallel_wait` 收集逐本退出码并 fail-closed 返回；`plugin/test/scoped-static-checks.test.mjs` 补两条控制。`git diff develop...HEAD --name-only` = `plugin/test/scoped-static-checks.test.mjs`、`scripts/test.sh`（2 文件 227 行）。

### AC1 — 前后实测

样本 = 三个真实任务（Touches 条数 1 / 2 / 5），scoped 选中 5 / 19 / 24 本；改前（逐次执行）与改后（并行）各 3 次，逐次 append 到 `.quay/scoped-static-parallel-evidence.jsonl`（该文件 20 行 = before 9 + after 11；每行带 `taskId` `developSha` `checkerCount` `wallMs` `parallel`，另附 `load`）。

| 任务 | checker 本数 | before wallMs（3 次） | before 中位 | after wallMs（3 次采集） | after 中位 | 倍数 |
|---|---|---|---|---|---|---|
| `gap-ac125-suite-bucket-no-miss-negative-control` | 5 | 4191, 4485, 3965 | 4191 | 1366, 1459, 1376 | 1376 | 3.0× |
| `gap-scoped-static-gate-sequential-pays-sum-not-max` | 19 | 34600, 33149, 33077 | 33149 | 8647, 7066, 7166 | 7166 | 4.6× |
| `gap-a15-ruling5-counter-missing` | 24 | 36660, 36034, 35095 | 36034 | 7426, 7316, 8751 | 7426 | 4.9× |

**判据**：after 中位（1376 / 7166 / 7426 ms）全部 **<** before 中位（4191 / 33149 / 36034 ms）⇒ 本任务前提在真实负载下成立。
（after 的 11 行中 9 行是上表三轮采集；另 2 行：06:30Z 的并行化后首次 smoke（B，7970ms）与 06:34Z 的 AC2 干跑（B，7796ms，load 27.98）——都在文件里，未删。）

**结构性读数（「付和 vs 付最大」的直接量）：把**同一次运行**的 wall 与该次逐本 ms 的 Σ / max 对照，不依赖跨轮负载差异。**

| 模式 | 任务 | wallMs | Σ(ms) | max(ms) | wall/Σ | wall/max | 最慢一本 |
|---|---|---|---|---|---|---|---|
| 逐次 | ac125（5 本） | 4191 / 4485 / 3965 | 4047 / 4346 / 3865 | 1309 / 1726 / 1475 | 1.04 / 1.03 / 1.03 | 3.20 / 2.60 / 2.69 | superseded-capability-check |
| 逐次 | 本任务（19 本） | 34600 / 33149 / 33077 | 34175 / 32728 / 32648 | 6341 / 6453 / 6269 | 1.01 / 1.01 / 1.01 | 5.46 / 5.14 / 5.28 | concurrency-literal-check |
| 逐次 | a15（24 本） | 36660 / 36034 / 35095 | 36058 / 35452 / 34557 | 6523 / 6245 / 6133 | 1.02 / 1.02 / 1.02 | 5.62 / 5.77 / 5.72 | concurrency-literal-check |
| 并行 | ac125（5 本） | 1366 / 1459 / 1376 | 3863 / 4076 / 3915 | 1308 / 1397 / 1304 | 0.35 / 0.36 / 0.35 | 1.04 / 1.04 / 1.06 | superseded-capability-check |
| 并行 | 本任务（19 本） | 7970 / 7796 / 8647 / 7066 / 7166 | 47480 / 45003 / 50786 / 39462 / 41546 | 7834 / 7677 / 8492 / 6936 / 7044 | 0.17 / 0.17 / 0.17 / 0.18 / 0.17 | 1.02 / 1.02 / 1.02 / 1.02 / 1.02 | concurrency-literal-check |
| 并行 | a15（24 本） | 7426 / 7316 / 8751 | 50424 / 49983 / 50833 | 7318 / 7167 / 8631 | 0.15 / 0.15 / 0.17 | 1.01 / 1.02 / 1.01 | concurrency-literal-check |

⇒ 逐次执行 wall ≈ Σ（比值 1.01–1.04，9/9 次）；并行执行 wall ≈ max（比值 1.01–1.06，9/9 次），Σ 变成 0.15–0.36。**序关系是结构性的、逐次可复现；上面的「倍数」不是断言，它随负载变（本机同时跑着 5+ 个 worker 会话）。**

⚠️ **develop sha 在采集窗口内前进了 4 次**（`fcd988727` → `497dbd0c` → `cbb40a9d` → `0137c533`，24 个提交），**但这 24 个提交没有一个触及 `scripts/test.sh` 或 `plugin/scripts/checker-cost-lib.sh`**（`git log --oneline fcd988727..0137c533 -- scripts/test.sh plugin/scripts/checker-cost-lib.sh` 输出为空）⇒ 前后两相之间变动的只有本任务的 2 文件 delta，**执行模式是唯一变量**。每行的 `load`（1 分钟 loadavg）同时落盘（实测 5.59–27.98），供读者判断某次读数是否处在争用窗口。

### AC2 — fail-open 负控制（真路径干跑）

```
$ cat > plugin/test/zz-injected-fail-control.test.mjs    # 注入：一个未配对 mkdtempSync 的临时 test 文件（跑完即删，未提交）
$ bash scripts/test.sh --for-task gap-scoped-static-gate-sequential-pays-sum-not-max --allow-thin; echo "EXIT CODE = $?"
EXIT CODE = 1
  …
PASS — every concurrency literal is at a QUAY_MAX_* definition point or a declared fallback (0 violations)
STATIC_CHECK_FAILED: test-framework-policy-check exit=1
STATIC_CHECK_FAILED: tmp-leak-pairing-check exit=1
STATIC_CHECK_FAILED: test-isolation-check exit=1
checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): test-framework-policy-check(exit=1) tmp-leak-pairing-check(exit=1) test-isolation-check(exit=1)
```
**判据**：scoped 门整体**退出码 = 1（非零）** ∧ 输出含逐本 `STATIC_CHECK_FAILED` 机器行 ⇒ **scoped 路径不属于 `run_doc_checks` 明文规避的那个 fail-open 形态**（后台化 checker 立刻返回 0、把失败伪装成通过）。
**判别依据是结构而非承诺**：`run_doc_checks` 强制关掉并行，是因为它**立刻读 `$?`**（`_doc_rc=$(( _doc_rc || $? ))` 紧跟在 `run_checker` 之后）——并行下那读到的是「后台化」的 0；scoped 循环**不读任何 per-call 退出码**，所有 rc 走 `run_checker` 自己的 results file，在**一处**（`run_checker_parallel_wait`）收集并 fail-closed 返回，**该返回值就是本函数的返回值**（`scripts/test.sh` 在 `set -e` 下裸调它，实测同一形状）。
**附带观察（方向与 fail-open 相反）**：并行模式下**每一本**失败都被报出（上面 3 条机器行）；逐次执行在第一个失败处就随 `set -e` abort ⇒ 失败可见性变强，不是变弱。

两条单元级控制（`plugin/test/scoped-static-checks.test.mjs`，执行的是**从 `scripts/test.sh` 现场抽出的真函数文本** + 真 `checker-cost-lib.sh`；只有「touch→checker 选择器」与 checker 本体是 fixture——⛔ 不是重写一份循环逻辑，那会变成「测量那个副本」）：
- **①「scoped 以并行模式调用」**：三个 `sleep 1` 的假 checker，按各自 `[start,end)` 纳秒区间的**重叠**直接测并发（不是读回标志位——自报的标志位不是「它真的并行」的证据）。**注入非并行即红**：把 `RUN_CHECKER_PARALLEL=1` 那行删掉重跑 ⇒ ① 红，失败信息里三个区间两两不重叠（`[["alpha",{start:…232,…240}],["beta",{start:…274,…279}],…]`）。
- **②「并行模式下失败仍传播」**：注入一个 `exit 7` 的假 checker ⇒ 宿主 rc = 7 ∧ stderr 含 `STATIC_CHECK_FAILED: fake-boom exit=7` ∧ 三个兄弟 checker 仍跑完（**失败不掩盖兄弟**）。**注入 fail-open 即红**：把 `run_checker_parallel_wait || _scoped_rc=$?` 改成 `|| true` 重跑 ⇒ ② 红，`RC=0` —— 正是 fail-open 的症状。

### AC3 — 一致性（并行运行 ≥3 次 vs 改前逐次）

对比面 = `run_checker` 写进 `.quay/checker-cost-<phase>-<task>-<run>.jsonl` 的 `{name, verdict}`（**实际执行**的投影；`--names` 另有一处命名投影差异，见 AC6）。

- 5 本任务：checker 名集合 before=5 after=5，**对称差 = []**；每次并行运行的 checker 名数 = [5, 5, 5]；逐本 verdict 差异 = **NONE (0)**
- 19 本任务：before=19 after=19，**对称差 = []**；[19, 19, 19, 19, 19]；逐本 verdict 差异 = **NONE (0)**
- 24 本任务：before=24 after=24，**对称差 = []**；[24, 24, 24]；逐本 verdict 差异 = **NONE (0)**

**差异数 = 0**（三类任务、48 个 checker×轮 比对点，全部 `pass`，0 个 `not-evaluated`，0 个 `fail`）⇒ 无共享状态竞争；没有任何一本需要「重跑才绿」。（另：本任务改后跑 scoped 门共 5 次，选择器输出的本数恒为 19。）

### AC4 — 并发上界读宿主（⛔ 非字面量）

```
$ grep -n 'RUN_CHECKER_PARALLEL\|STATIC_CHECK_CONCURRENCY' scripts/test.sh
295:  # caller left RUN_CHECKER_PARALLEL=1 set, force it off — backgrounded checkers would return 0
297:  RUN_CHECKER_PARALLEL=0
387:# `parallel` is passed in rather than read back from RUN_CHECKER_PARALLEL at record time because
430:  # full gate (run_static_checks) pays max(selected) via its own RUN_CHECKER_PARALLEL=1. Same
436:  # promise. run_doc_checks forces RUN_CHECKER_PARALLEL=0 because it reads each checker's exit code
449:  # Concurrency bound: run_checker's own STATIC_CHECK_CONCURRENCY (default `nproc`) — the SAME
452:  local _prev_parallel="${RUN_CHECKER_PARALLEL:-0}"
453:  RUN_CHECKER_PARALLEL=1
465:  RUN_CHECKER_PARALLEL="${_prev_parallel}"
```
（硬规则 2 的产物：**实际命中前 3 条 = 295 / 297 / 387**，逐字如上；全部 9 条命中已完整列出，不引用未打印的计数。）
scoped 路径（452 / 453 / 465）只设**布尔标志** `RUN_CHECKER_PARALLEL=1`，**不出现写死的并发数字**；上界由 `run_checker` 内部的 `STATIC_CHECK_CONCURRENCY`（缺省 `nproc`）给出——与全量路径同一表达式（`plugin/scripts/runner-static-gate.ts:89` 的注释即此意）。本文件里 `STATIC_CHECK_CONCURRENCY` 仅作为注释出现，**无赋值**。

### AC5 — 写入面枚举

**N = 19**（= 本任务 AC1 各行 `checkerCount`，也是改后并行实际执行的 checker 本数；名字取自该次运行 `run_checker` 写入的 cost 文件，⛔ 不取选择器的 `--names` 投影，见 AC6）。「写」= 该 checker 在 scoped 门 eval 的那条命令行上会创建/修改文件。

| # | checker | 写 `.quay/` 或临时文件？ | 并行安全的理由 |
|---|---|---|---|
| 1 | `adr016-screen-use-check` | 否 | 只读扫描 ADR-016 屏幕使用契约，文件内无写路径 |
| 2 | `commit-message-verified-check` | 否 | 只读 git log / 任务文件 |
| 3 | `concurrency-literal-check` | 否 | `--gate` 只读源码并打印，无写路径 |
| 4 | `dead-code-after-return-check` | 否 | 只读 AST/文本扫描 |
| 5 | `landing-target-check` | 否 | 只读扫描任务声明的落点 |
| 6 | `malformed-task-check` | 否（temp：仅 `selfTestMain`） | `:115` 的 `mkdtempSync` 在 `selfTestMain()` 内，scoped 门不走该路径（那是 mutation case 面） |
| 7 | `rhythm-consumer-check` | 否 | `--check` 只读；文中出现的 `.quay/task-file-violation-ledger.jsonl` 是 `--selftest` 断言里的字符串样本 |
| 8 | `suite-bucket-reattr-ratchet-check` | 否 | 对 `.quay/suite-bucket-reattribution.jsonl` **只读**（`:64-65` `existsSync`+`readFileSync`） |
| 9 | `suite-slot-ssot-check` | 是（hermetic 临时） | `:337-341` 建 `mkdtempSync` 锁基座 + `<base>.concurrency`，`:347` `rmSync` 清理；目录名每次唯一，且该探针只与**它自己的**并发获取者在那个基座上争用（文件注释明示 hermetic 隔离） |
| 10 | `superseded-capability-check` | 否 | `capability-catalog.sh --superseded-check` 只读目录字典与脚本头注释；该脚本内无重定向、无 `fs.write*` |
| 11 | `task-contract-check` | **是：`.quay/task-file-violation-ledger.jsonl`** | grow-only 台账，`--no-block`（scoped 命令行带该标志）下 `:513` `fs.appendFileSync` 整体行写入。`:497-509` 对 `seen` 的读-改-写**理论上**可能在同一窗口内追加重复 key。⚠️ **未引入新竞态类**：全量 `run_static_checks` 自 `gap-run-static-checks-zero-concurrency-can-parallelize` 起就一直以 `RUN_CHECKER_PARALLEL=1` 跑同一批 checker，该窗口在生产中已存在；且 scoped 集合里带 `--no-block` 的消费者只有本本（另一个 `task-ac-carryover-check` 是 `@static-tier full`，实测不在本任务 scoped 选择内，grep 命中 0）。⛔ 判定面不受影响：台账是纯记录面，checker 的退出码不来自它 |
| 12 | `task-file-bypass-check` | 否 | 只读扫描；文件里的 `writeFileSync` 字面量在检测器自己的正则/清单字符串内 |
| 13 | `test-file-snapshot-check` | 是（temp，名唯一） | `test-file-snapshot.sh:146-173` 用 `mktemp` ×4 落 `$TMPDIR`，`trap … EXIT` 清理；`mktemp` 生成唯一名 ⇒ 无跨运行碰撞 |
| 14 | `test-framework-policy-check` | 否 | 只读扫描测试文件的声明 |
| 15 | `test-group-downgrade-check` | 否（temp：仅 `--selftest`） | `:321-334` 的 `mkdtempSync`+`writeFileSync` 是 `--selftest` 的集成 fixture（`makeFixture`）；门路径只读 |
| 16 | `test-impl-census-check` | 否（temp：仅 `selfTestMain`） | `:169` 的 `mkdtempSync` 在 `selfTestMain()` 内 |
| 17 | `test-isolation-check` | 否 | 门路径只读（其 shrink-only 数据文件 `plugin/test-isolation-violations.txt` 只被读；`.ts` 里所有 `writeFileSync` 都是 `--selftest` 的样本**字符串**，`:1201+`） |
| 18 | `tmp-leak-pairing-check` | 否 | 只读扫描未配对的 `mkdtemp` 结果 |
| 19 | `touches-one-entry-one-path-check` | 否 | 只读扫描 `## Touches` |

**表行数 = 19 = `checkerCount`**；**`未评估` 行数 = 0**（19/19 都给出了取值）。两类 `是`：#9 / #13（名唯一、自清理的临时文件）与 #11（append-only 台账，竞态如上）。**19 本中的每一本都已在全量门里以并行方式执行**（它们是 `run_static_checks` 注册表的子集）——本任务只改 scoped 侧的**执行模式**，未给任何一本引入未曾在生产中并行执行过的形态。
**表外的共享写者（本任务未改）**：`run_checker` 自身每本 append 一行到 `.quay/checker-cost.jsonl`（`checker-cost-lib.sh` 的 `checker_cost_append`：单条 `printf … >> file`，`O_APPEND`，行长远小于 `PIPE_BUF`），全量门里早已并发写入同一路径。

### AC6 — 只动执行模式

- **选择器逐字未变**：`git diff develop...HEAD --name-only -- plugin/scripts/select-static-checks-for-touches.ts` → **0 行**（本任务 delta 只有 `scripts/test.sh` + `plugin/test/scoped-static-checks.test.mjs`）。
- **公式行逐字**（`plugin/scripts/select-static-checks-for-touches.ts:584`）：`  scoped = { tier=always } ∪ { tier=change whose object ∩ touches } − { tier=full }`
- **选中集合完全相同**：`--names` 行数 = 5 / 19 / 24，与改前**实际执行**的本数逐一相等；checker 名集合 before/after 对称差 = []（AC3 表）。
- ⚠️ **一处观察（非本次引入；选择器逐字未变 ⇒ 前后定义上一致）**：`--names` 打印的是解析出的 `name`（脚本名派生），而对 `capability-catalog.sh --superseded-check`、`test-file-snapshot.sh … check`、`quay-init-closure-ratchet.ts` 三处，`--commands` 里 `run_checker` 用的名字分别是 `superseded-capability-check` / `test-file-snapshot-check` / `quay-init-closure-ratchet-stale`。**比对采用「实际执行名」（cost 文件），两次采集完全一致**（5/19/24，差异 0）。
