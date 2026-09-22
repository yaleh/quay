---
id: gap-identity-rewrite-count-includes-carve-outs
title: P2 判定重写计数把 4 类非可合并站点（test / .sh / 已 import leaf / 随包 .mjs）计成缺陷 —— 已 done
  的 proc-identity 迁移机制因此每轮重报
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现场读数（2026-09-22 本轮实测，非照抄判词）**：`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --root . --json` 的 `judgmentRewrites` 为 **8 条**，全部 8 条被本轮 judge 判为 coincidental。逐处 `sed` 核实后的分类：

| 站点 | 类别 | 不能合并到 kernel leaf 的结构性理由 |
|---|---|---|
| `packages/quay/test/mcp-server-deadlock-repro.test.mjs:148` | test | 判据与被判对象必须独立实现（G3：judge 不得共享被判实现） |
| `packages/quay/test/server-status-web-control-same-pid.test.mjs:507` | test | 同上 |
| `plugin/test/driver-runtime-s04.test.mjs:43` | test | 同上（载体 argv fixture） |
| `plugin/test/quay-init-tmux-detection.test.mjs:135` | test | 同上（载体 argv fixture） |
| `plugin/scripts/os-anchor-watchdog.sh:130` | .sh | 文档化 carve-out：shell 不能 import TS kernel leaf |
| `plugin/scripts/supervisor-observe.sh:214` | .sh | 同上 |
| `plugin/scripts/worktree-process-reaper.ts:141` | 已 import leaf | `:95` 已 `import { readProcCmdline, isQuayServe } from "../../packages/quay/src/kernel/proc-identity.ts"` 并在 `:96` re-export；残余的 `readProcArgv0`（`:139`）是 argv0-only 的第三个谓词，不是被迁移判定的独立重写 |
| `plugin/scripts/run-namespace-sweep.mjs:85` | 随包 .mjs | 该载体刻意不 import 仓内 TS 内部件：它被 `plugin/scripts/full-suite-runner.ts:151` import、以 `node --experimental-strip-types plugin/scripts/run-namespace-sweep-kill.mjs` 调用（`scripts/test.sh:1219` 等 4 处），且进 npm-pack 包体；done 任务 `gap-judgment-rewrites-route-through-proc-identity-leaf` 的 Evidence 明写这处是它**刻意划出**的 |

这 8 条经 `architecture-review-cluster.ts:129` 原样变成 `P2-judgment-rewrites` 簇（标签 `process-identification judgment independently re-implemented 8×`），每轮被 judge 消费一次 ⇒ 已 done 机制 `gap-judgment-rewrites-route-through-proc-identity-leaf` **每轮重报**，把 judge 的一个名额长期占在一条已关闭的机制上。

**⚠️ 同轮矛盾判词（读了 `.quay/architecture-review-round.jsonl` 里 round 2024 的全部行）**：同一 clusterId 在本轮被判 3 次 —— 05:07 `uncertain`(actionable:false)、10:09 `abstract`(actionable:true，建议把 8 处全迁 leaf)、13:13 `coincidental`(actionable:true，建议收窄检测器——即本任务)。只有最后一条到达立案面。10:09 那条的读数与树不符：它引的 `worktree-process-reaper.ts` 11 hits / `run-namespace-sweep.mjs` 26 hits 是**字面量复制度表**的数、不是判定重写数，且 `worktree-process-reaper.ts:95` 已 import leaf。⇒ 本任务以**当场核实过的站点分类**为准，⛔ 不以任何一条判词里的 headline 数字作为验收依据。

**修法（唯一一处判定，⛔ 不新增副本 —— 硬规则 5b）**：把「哪些站点算判定重写」的分类判定收进 `identity-replication-check.ts`（与 `isFlagged` 同一先例：判定老家在检测器，消费者 import；`architecture-review-cluster.ts:51` 就是这么用的），`architecture-review-cluster.ts` 只消费结果、⛔ 不自己再过滤一遍。

1. 计数语义收窄为「**可合并到 kernel leaf 的**判定重写」——即该站点所在载体能把 `packages/quay/src/kernel/proc-identity.ts` 当作单一实现使用。据此按**类**排除（⛔ 不按文件名白名单，按文件名硬编码等于把下一条同类站点漏掉，硬规则 5b）：(a) test 文件；(b) `.sh`；(c) 已 import `kernel/proc-identity.ts` 的文件；(d) 随包发布的 import-free `.mjs` 运行时助手。

   **⚠️ 诚实标注一处对判词的超出**：13:13 的建议动作只点了 (a)(b)(c) 三类，但**它自己的分类覆盖了全部 8 处**（明写 `run-namespace-sweep.mjs` "is the site the done task deliberately scoped out … merging them is not warranted"）。只排 (a)(b)(c) 会剩 1 处 ⇒ 簇仍以 `independently re-implemented 1×` 重报，判词想要的「停止重报」达不到。故 (d) 是**让计数到达判词自己的分类所必需的一类**，不是新增发现。

2. **排除不得静默**（硬规则 3b + 硬规则 3 枚举）：被排除的站点与理由必须以**独立取值**出现在输出里（`--json` 新增字段 + 人类可读面新增一段），使「作为 carve-out 排除」与「没扫到」可区分。⛔ 不得把它们从读数里删掉——删读数不是收窄判据。

3. **判据能取假**（硬规则 2 的两半都要做）：收窄后仍必须报出真的可合并站点。单测里造一个非 test、非 `.sh`、未 import leaf 的 `*.ts` fixture（读 `/proc/<pid>/cmdline` 且比较绑到这次读上）⇒ 必须在列；同一 fixture 改名成 `*.test.mjs` / 换成 `.sh` / 加一行 import leaf ⇒ 必须出列。

<!-- dedup-ref -->
相关联但不同机制（仅留痕，不作前置）：[[gap-judgment-rewrites-route-through-proc-identity-leaf]]（done）做的是**迁移调用点 + 把指纹从文件级收窄为「比较必须绑到这次读」**；本任务做的是**把非可合并的站点类从计数里排除**，两层修法互不覆盖。[[gap-archguard-p2-identity-replication-checker]]（done）落地检测器本体，其 AC2 只要求「报出」。[[gap-arch-review-cluster-ignores-detector-flag-predicate]]（done）收的是簇侧**阈值谓词**（字面量复制度），不是判定重写计数。

## AC

- [ ] AC1（现场读数与逐条分类，枚举非布尔）：修前贴出 `node --experimental-strip-types plugin/scripts/identity-replication-check.ts --root . --json` 中 `judgmentRewrites` 段的完整输出（本轮为 8 条），并对**每一条**给出 类别 ∈ {test, .sh, 已 import leaf, 随包 .mjs, 真可合并} + 一行结构性理由；贴出的条数须与输出条数一致（不得只贴「8 处」这个数字）。
- [ ] AC2（计数语义收窄·按类不按名）：`identity-replication-check.ts` 导出分类谓词（名字自定，如 `isMergeableRewriteSite`），用 `grep -n` 证明它只在**一处**定义、且 `architecture-review-cluster.ts` **不**另写一份（cluster 侧若再过滤一次即为硬规则 5b 违规）；贴出该谓词对上面 8 个真实路径逐一求值的输出（8 行，全 false），并声明其中无一处在白名单里按文件名硬编码。
- [ ] AC3（不静默·排除与未扫到可区分）：`--json` 输出同时含 ①可合并站点列表 ②被排除站点列表（每条带理由取值），且人类可读面打印后者；贴出修后 `--json` 两个字段的实际内容（被排除侧须为 8 条、理由覆盖 (a)-(d) 四类）。两态可区分：把某一条排除规则关掉时，该条回到①。
- [ ] AC4（能取假·已知真样本干跑，硬规则 2 另一半）：单测新增 fixture 矩阵——同一段「读 cmdline ∧ 绑到这次读的比较」内联到四个临时文件：`genuine.ts`（必须在列）、`genuine.test.mjs`（必须出列）、`genuine.sh`（必须出列）、`genuine-imports-leaf.ts`（含 `import … from "../../packages/quay/src/kernel/proc-identity.ts"` ⇒ 必须出列）。贴出 `node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` 的 pass/fail 计数，并贴出把 `genuine.ts` 那条断言反转后**变红**的一次实跑（红控制非空转）。
- [ ] AC5（簇不再重报·落笔当轮取真实读数 + 反向可区分）：修后在本仓重跑检测器：可合并列表为 **0** 条 ⇒ `clusterIdentityReport` 不再产出 `P2-judgment-rewrites`。贴出修后 `--json` 的判定重写段与 `plugin/test/architecture-review-cluster.test.mjs` 中该簇不产出的用例输出；并给出一条**反向**读数：往假报告里注入一个可合并站点 ⇒ 该簇**必须**重新产出（证明判据不是恒假/空转）。
- [ ] AC6（消费者面回归）：`plugin/test/identity-replication-check.test.mjs`、`plugin/test/architecture-review-cluster.test.mjs`、`plugin/test/quality-gate-driver.test.mjs`、`plugin/test/probe-routine.test.mjs` 四个文件逐个 `node --experimental-strip-types` 运行并 exit 0，各贴 pass/fail 计数（后两者以 fake detector 输出为 fixture，用于证明 `--json` 加字段没有破坏既有消费面）。
- [ ] AC7（scoped 门）：`bash scripts/test.sh --for-task gap-identity-rewrite-count-includes-carve-outs` 绿（或等价 scoped 静态门，贴出退出码）。

## DoD

修后本仓实测：判定重写计数里**可合并站点 0 条**、`P2-judgment-rewrites` 簇不再产出（贴出同一时刻的检测器 `--json` 输出 + 簇构造输出），而被排除的 8 条仍以**带理由的独立列表**可见（不是被删掉）；单测 fixture 矩阵四态双向且红控制实跑变红；四个消费者测试文件分别 exit 0。⛔ 不以「把 8 行从输出里去掉」作为完成判据——那是删读数，不是收窄判据。

## Touches

- plugin/scripts/identity-replication-check.ts
- plugin/scripts/architecture-review-cluster.ts
- plugin/test/identity-replication-check.test.mjs
- plugin/test/architecture-review-cluster.test.mjs
- tasks/gap-identity-rewrite-count-includes-carve-outs.md