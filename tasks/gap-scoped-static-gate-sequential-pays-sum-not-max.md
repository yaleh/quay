---
id: gap-scoped-static-gate-sequential-pays-sum-not-max
title: scoped 静态门逐次执行付出「和」而全量路径付出「最大值」——先证明 scoped 不属于 run_doc_checks 明文规避的
  fail-open 形态，再并行化并前后实测
status: todo
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

- [ ] AC1（前后实测·核心，可取假）：同一任务、同一 develop sha，改前/改后各跑 ≥2 次 scoped 门，落盘 `.quay/scoped-static-parallel-evidence.jsonl`，每条带 `taskId` `developSha` `checkerCount` `wallMs` `parallel:true|false`。判据：文件存在 ∧ before/after 各 ≥2 条。⛔ 取假形态：after 的中位 wall **≥** before 的中位 wall ⇒ 本任务前提（付和 vs 付最大）在真实负载下不成立，必须如实写进读数段；⛔ 不得为让数字好看而更换样本或只保留有利的几次。
- [ ] AC2（fail-open 负控制，可取假·**本任务最关键的一条**）：在**并行模式下**把一个**必然失败**的 checker 注入 scoped 集合（或令某本以非零退出），干跑一次。判据：scoped 门整体**退出码非零** ∧ 输出含该本的 `STATIC_CHECK_FAILED` 机器行；命令与输出尾部贴进读数段。⛔ 取假形态：并行模式下该注入**仍然绿**（或退出码 0）⇒ 命中了 `run_doc_checks` 明文规避的那个 fail-open 形态（后台化 checker 立刻返回 0，掩盖失败）⇒ **本任务必须结案为「不采用」**，⛔ 不得以「实际上很少失败」为由放行。
- [ ] AC3（正确性一致性，可取假）：并行化后对**同一 worktree 状态**跑 scoped 门 ≥3 次，三次的**选中集合**与**逐本退出码**必须完全一致；并与改前逐次执行的逐本退出码比对。判据：差异数 = 0，该数字与比对清单落进读数段。⛔ 取假形态：任一本在并行下退出码与逐次不同 ⇒ 存在共享状态竞争，必须定位到**具体 checker 名**并列出；⛔ 不得以「重跑就绿了」结案——那正是 flaky 的定义。
- [ ] AC4（并发上界读宿主，⛔ 非字面量）：判据：`grep -n 'RUN_CHECKER_PARALLEL\|STATIC_CHECK_CONCURRENCY' scripts/test.sh` 的命中行中，scoped 路径**不出现写死的并发数字**，并把该 grep 的**实际命中前 3 条**贴进读数段（硬规则 2 的产物：引用计数前先打印命中内容）。
- [ ] AC5（写入面枚举，⛔ 非布尔）：产出 N 行表，N = 改后并行执行的 scoped checker 本数（须与 AC1 的 `checkerCount` 一致），每行给出「是否写 `.quay/` 或临时文件」与「并行安全的理由」。判据：表行数 == `checkerCount`；填不出取值 ⇒ 记 `未评估`，⛔ 不得留空、⛔ 不得写「应该没问题」。
- [ ] AC6（⛔ 不得顺手削弱闸门）：改动**只动执行模式**。判据：`select-static-checks-for-touches.ts` 的选择公式（`{always} ∪ {change ∩ touches} − {full}`）逐字未变，且改前/改后对同一任务的**选中集合完全相同**（`--names` 输出比对，差异数 = 0）。⛔ 取假形态：选中集合发生任何变化 ⇒ 越界（那是宽度轴，属 `gap-scoped-runs-pay-full-static-check-overhead` 的范围）。

## Definition of Done

- `scripts/test.sh` 的 `run_scoped_static_checks_sel` 落地改动；`plugin/test/scoped-static-checks.test.mjs` 补两条可失败控制：①scoped 路径以并行模式调用（注入非并行即红）；②**并行模式下失败仍传播**（对应 AC2，注入必失败 checker 即红）。
- `.quay/scoped-static-parallel-evidence.jsonl` 含**实现落地之后**产生的真实前后读数（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。
- AC2 的 fail-open 干跑读数、AC3 的一致性读数、AC5 的写入面表落进任务体读数段。
- ⛔ **若 AC2 判定 scoped 属于 fail-open 形态，或 AC1 显示无净收益 ⇒ 如实结案为「不采用」并保留全部读数，同样算完成。** 本任务交付的是一个**有依据的决定**，不是这一行改动本身。

## Touches

- tasks/gap-scoped-static-gate-sequential-pays-sum-not-max.md
- scripts/test.sh
- plugin/test/scoped-static-checks.test.mjs
