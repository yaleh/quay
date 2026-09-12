---
id: gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit
title: AC-241 台账回归：失败归因棘轮对「行末 computed 非零」的 exit 结构上盲 ⇒ AC-245 以裸失败进入在域集（同类共 10 条）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-241
---
## Finding

**回归（生产台账，逐字读数）** —— GOAL-009 的常设不变式 AC-241（`long-term: true`，2026-09-11T13:55:25Z 已 achieved）在 **2026-09-12T01:07:56Z 转红**：

```
2026-09-12T01:06:38.356Z  item_id=AC-245  verdict=fail
  reason="acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
2026-09-12T01:07:56.693Z  item_id=AC-241  verdict=fail
  reason="acceptance failed (exit 1) — unattributable failing goal AC(s): AC-245: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
```

AC-241 的判据读 `.quay/gate-events.jsonl`：**每条 AC 的最近一次 goal-gate fail，其 reason 不得是空因模板**。此刻它点名的 **AC-245**（GOAL-014 名下唯一判据，2026-09-12T01:05:11Z 由 goal-cli 创建、status=active ⇒ 立即进入 I5 复验域）的失败出口是
`sys.exit(0 if log and str(log[-1].get("reason") or "").strip() else 1)` —— 一条命令管道，失败时对 stderr/stdout **零输出**。

**为什么早先的修复没有守住（是机制形态，不是「没做」）** —— 同形态任务 `gap-goal-criteria-bare-failing-exit-unattributable`（done）确实造了检测器 `plugin/scripts/criterion-failure-attribution-check.ts` 与只许降不许升的棘轮（baseline `count=32`，`2026-09-11T12:02:01.417Z` 捕获）。但它的 `FAILURE_EXIT_RE` 对**行末 computed 非零**这一形态**结构上不匹配**，且该限制被写进脚本注释当作「已记录的限制」：

```
plugin/scripts/criterion-failure-attribution-check.ts:67-68
  ⛔ A *trailing* computed 1 (`sys.exit(0 if ok else 1)`) is NOT matched — documented limitation,
     not a silent pass.
```

**它不是「已记录的」，它就是静默通过** —— 对棘轮而言「我读不懂这个形态」与「这条判据干净」**共用同一份输出**（`bareAcs` 不变、`status=pass`、exit 0）。这正是硬规则 3b 的形态：读不懂 ⇒ 伪装成检查通过。本立案轮的双向对照（**同一条夹具，注入 `goals/` 副本**）：

| 注入的夹具 | 当前 develop 版检测器 | 修复后应得 |
|---|---|---|
| `AC-990`：criterion 逐字同 AC-245 形态（`… else 1)`） | `bareAcs=32`（**不变**）、`delta=0`、`status=pass`、`AC-990` 不在 `ids` | `bareAcs=33 > 32`、`delta=+1`、`added=["AC-990"]`、`exit=1` |
| `AC-991`：`sys.exit(1)` 语句形态（对照） | `bareAcs=33`、`added=["AC-991"]`、`exit=1` | 不变 |

⇒ 时序闭合：基线 2026-09-11T12:02 锚定 32 → 2026-09-12T01:05 AC-245 以该形态进入在域集 → 01:06:38 它把一个不可归因的 fail 写进生产台账 → 01:07:56 AC-241 转红。**棘轮从 32 到 32，一步没动。**

**5b 同类枚举（机械，⛔ 非抽样）** —— 把「`exit(...)` 调用内行末 `else <非零>`」规则跑在 `goals/` 全量在域判据上，与当前 `--json` 的 `ids` 取差集，立案轮实测新增 **10 条**：

```
AC-210, AC-212, AC-216, AC-222, AC-223, AC-224, AC-226, AC-235, AC-236, AC-245
```

其中 5 条（AC-210/212/216/222/245）失败时**真的零输出**（同 AC-245）；另 5 条（AC-223/224/226/235/236）失败时 `print("registered:", ok)` / `print("driver-activations:", n)` 打到 **stdout** —— `acceptance-runner.ts:139` 的 `withFailureOutput` 是**先 stderr、后 stdout 兜底**，故它们**实际可归因**，棘轮命中的是脚本注释自陈的已知过报（「7 of the 33 baselined ACs are bare ONLY via this class」，`criterion-failure-attribution-check.ts:74-77`）。

### 修法（用现成机制，⛔ 不新建并行机制）

1. **修判据**：给上述 10 条的失败出口补成因 —— 5 条真零输出的补**互不相同**的 `sys.stderr.write` 成因；5 条 stdout 打印的改成 `file=sys.stderr`（成因进 runner 的首选通道）。⛔ 只改诊断输出，**逐条给出同载体改前/改后退出码相同的读数**（沿用 AC-239 那一轮的既有做法）。
2. **补棘轮盲区**：`FAILURE_EXIT_RE` 增加「`exit(...)` 调用内出现行末 `else <非零>`」形态（须容忍内部括号，如 `str(log[-1].get("reason") or "").strip() else 1`）。**只动 `FAILURE_EXIT_RE`，⛔ 不动 `ATTRIBUTION_RE`** —— 把它放宽到 `print`/`echo` 会制造假阴性（脚本注释 :78-80 已论证）。
3. **计数修回基线，⛔ 不抬基线**：收紧检测器必然让 live 计数由 32 升到 42；唯一合法出路是把那 10 条**修掉**（计数回落 ≤32），⛔ **不是** `--capture` 把 baseline 写高 —— 那恰是 DoD 禁止的「放宽检测器」。
4. **同步既有读者**：`plugin/test/criterion-failure-attribution-check.test.mjs` 增正/负控制；mutation case 四态仍互异；`plugin/scripts/runner-static-gate.ts` 的接线一字不动。

<!-- dedup-ref --> **与既有任务的关系（仅追溯）**：`gap-goal-criteria-bare-failing-exit-unattributable`（done，`goal_ac: AC-241`）造了检测器与棘轮并修了当轮在红项，本条补的是它**自陈未覆盖**的那一形态；`gap-meta-withfailureoutput`（done）修的是 AC-241 判据自身的自引用假阳性（子串测试 vs 整条正文），与本条的检测器盲区是两个机制。本条**不改** AC-241 判据文件本身。

## AC

- [ ] **AC1 止血：AC-245 的失败出口写成因，语义逐字不变** —— `goals/AC-245-*.md` 的 criterion 两条可区分失败形态（statusLog 无 `to=active` 条目 / 该条目 reason 为空）各写一句**互不相同**的 stderr 成因。读数：同一载体（`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts get GOAL-014` 的输出）改前/改后退出码相同（实测 1→1）；用真 runner 干跑改后 criterion **原文**（`m.runAcceptance({command:<原文>, cwd:".", timeoutMs:60000})`）⇒ `reason` 逐字含该成因、**不再是** `criterion wrote no output to stderr/stdout`。

- [ ] **AC2 台账翻绿（真 goal-driver 跑出的 GateEvent，⛔ 不是分支状态）** —— 在 worktree 上跑 `node --experimental-strip-types plugin/scripts/goal-driver.ts --root <worktree> --once --spawn-cap 0` 一轮（criterion 经 `goal-store gate` 真跑、真写 GateEvent），贴两行原文：AC-245 的尾事件 reason 携带其成因；对该轮台账跑 AC-241 判据原文 ⇒ `exit 0`。⚠️ worktree 的 `.quay/` 会被 `scripts/test.sh` 的 refresh 覆盖，故须当场逐字留档。

- [ ] **AC3 棘轮盲区关闭 + 双向对照（能取假）** ——
  · 修复前（`git show develop:plugin/scripts/criterion-failure-attribution-check.ts` 落一份）：注入 AC-245 同形夹具 ⇒ `bareAcs` 不变、`status=pass`、夹具 id 不在 `ids`（**盲区实测**）；
  · 修复后：同一次注入 ⇒ `bareAcs = baseline+1`、`delta=+1`、`added=[夹具id]`、`exit=1`；移除 ⇒ 回落、`exit=0`；
  · 负控制同批给：`sys.exit(0 if ok else 0)`（恒 0）、同一行含 `stderr`/`>&2` 的、值位引号串（`command:"… else 1"`）三类**都不新增命中**；`--goals-dir` 不可读仍 `exit=3`（三态互异）；
  · AC-241 判据里的空因常量 `T` 与 runner 对零输出失败实际产出的文本仍逐字一致（AC-243 仍 `exit 0`）。

- [ ] **AC4 同类归零（5b 枚举的 10 条）** —— widened 检测器下 `--json`：`bareAcs ≤ baseline 32` **且** `ids` 不含 `AC-210/212/216/222/223/224/226/235/236/245`。逐条给「改前/改后同载体退出码相同」的读数（10 条全给，⛔ 抽样不算）；对 AC-223/224/226/235/236 的改动 = 既有 stdout 打印改 `file=sys.stderr`，⛔ 不改任何判定分支。

- [ ] **AC5 三态与接线不退化** —— `node --experimental-strip-types --test plugin/test/criterion-failure-attribution-check.test.mjs` 全绿（含新增 trailing-computed 正/负控制）；`bash plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh` RC=0（A 基线绿 / B 注入必红 / C 恢复绿 / D 不可读 exit 3 四态互异）；`plugin/scripts/runner-static-gate.ts` 对该检查器的 `--root` 调用与 `@static-object` 登记未改；`docs/analysis/criterion-failure-attribution.baseline.json` 的 `count` **仍为 32**（⛔ 未抬高）。

- [ ] **AC6 生产台账翻绿（待外部）** —— 生产 root（主检出）`.quay/gate-events.jsonl` 中 AC-241 的尾事件 `verdict=pass`、`reason="acceptance passed (exit 0)"`（由常驻 goal-driver 在本次落地后的轮次写出）；⛔ 不得以 worktree 读数替代本条的**生产**读数。（待外部）

## DoD

- AC-241 的**生产台账**尾事件 `exit 0`（直接量；⛔ 分支上的代码状态不是本条的判据）；
- 棘轮盲区由**同一条夹具的双向对照**证明关闭（修复前注入仍绿 / 修复后注入必红），⛔ 不是「改完再宣称」；
- 10 条同类判据的失败出口携带成因且**语义逐字不变**（同载体前后退出码相同；⛔ 「加了 stderr 就算」不算）；
- ⛔ 抬基线（32→42）不算达成；⛔ 放宽 `ATTRIBUTION_RE` 制造假阴性不算达成；⛔ 新建并行检测机制（写面新闸 / 复用 fidelity gate）不算达成。

## Touches

- `goals/AC-245-goal-014-激活时选中的选项-①-②-③-必须留痕-今天-statuslog-的-draft-active-条目.md`
- `goals/AC-210-draft-ac-分诊在-生产-上真的判过-每条-draft-ac-都得到五态判决之一并逐条落痕.md`
- `goals/AC-212-充分性闸挡住-ac-全绿即关闭-退出条件未被覆盖时-goal-不得自行关闭.md`
- `goals/AC-216-长期保证-ac-的复验域不随-goal-关闭而消失-达成即停止复验会让-上移一层-变成换层藏同一缺陷.md`
- `goals/AC-222-充分性闸必须能产出-covered-否则-防假达成-就做成了-永不达成-闭环只闭一半.md`
- `goals/AC-223-分诊判出-activate-后-driver-必须执行它-判决零消费等于-分诊-只做了一半-goal-010-退出条件①.md`
- `goals/AC-224-a域检查器被突变机制覆盖-能取假-由清单证明-恒绿检查器不算保证-goal-012-退出条件⑤.md`
- `goals/AC-226-b域身份字面量检查器-存在-枚举归零-被突变覆盖-三者缺一不可-goal-012-退出条件①⑤.md`
- `goals/AC-235-交付的每个配置键都有消费者-零消费者的键已接线或已删-由机械枚举证明-退出条件③.md`
- `goals/AC-236-本仓库自身行为不得因本-goal-的改动而回退-cli-动词集-web-路由集-有消费者的配置键集单调不缩-退出条件④.md`
- `plugin/scripts/criterion-failure-attribution-check.ts`
- `plugin/test/criterion-failure-attribution-check.test.mjs`
- `plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh`
- `docs/analysis/criterion-failure-attribution.baseline.json`
- `tasks/gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit.md`
