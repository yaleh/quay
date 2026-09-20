---
id: gap-manager-tick-log-check-mutation-case
title: manager-tick-log-check.sh 无 mutation case ⇒ P4 谱系归入
  suspicious（与坏守卫不可区分）；两个注入方向（陈旧/缩水）都要补且必须被自动 manifest 执行
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

`plugin/scripts/manager-tick-log-check.sh` 在 P4 守卫谱系里是一个**已声明**守卫：`capability-catalog.sh` 的 `GUARD_OBJECT` 块逐字声明 `manager-tick-log-check.sh → file:orchestration/manager-tick-log.md`（对象 `present: true`），且在 `orchestration/orchestrator-loop-tick.md:660` 被真实调用（`bash plugin/scripts/manager-tick-log-check.sh --json`，每轮）。但：

- 在 `guard-lineage-check.ts` 的判定窗口（2026-09-04..09-20）内它**从未变红**（`fired` = 空集）；
- 且**没有 mutation case**——`isMutationVerified()`（`guard-lineage-check.ts:227`）的实现就是"`plugin/scripts/checker-mutation-cases/<stem>.sh` 是否存在"，该文件不存在。

现场实跑（立案时 `node --experimental-strip-types plugin/scripts/guard-lineage-check.ts --json`）逐字：

```
fired 0
preventive 6   (checker-mechanical-spine-check.ts / checker-mutation-check.sh / instrument-decay-check.ts /
                outer-tick-log-check.sh / release-master-advance-needs-check.ts ×2)
suspicious 1
    manager-tick-log-check.sh | never-fired and not mutation-verified — indistinguishable from a broken guard (P4 定义)
```

**姊妹对照（唯一差别就是那个 case 文件）**：`outer-tick-log-check.sh` 同样从未变红，但它**有** case（`plugin/scripts/checker-mutation-cases/outer-tick-log-check.sh`，逐字含 "INJECT 1 … MUST go RED / RESTORE … GREEN again" 的注入→恢复契约）⇒ 归 `preventive`。⇒ `manager-tick-log-check.sh` 目前与"坏守卫"**不可区分**。

该守卫**自带可用的测试接缝**（脚本头 :35-42 逐字声明）：`--log <path>`（指向临时 fixture）、`--stale-hours <n>`（缩小以做负控制）、`--baseline <path>`（指向临时基线以做缩水棘轮负控制）。⇒ 两个方向都能变异注入：①**陈旧分支**（`--stale-hours 1` 或构造旧 mtime 的 fixture log）；②**缩水棘轮**（写一个高 `--baseline` + 一个小 log）。两条都要覆盖，因为它们是该守卫的两条独立判据（只覆盖一条 = 另一条仍是"从未被证明能红"）。

**判定**：这是**预防性守卫缺口**（不是"检测器报错了"）。修法就是把该守卫的变异验证补上，使其从 `suspicious` 移到 `preventive`。⛔ **不得**靠改 `guard-lineage-check.ts` 的判定（放宽 suspicious 阈值、或把"未验证"也算 preventive）来消掉这条——那正是 P4 反向判据（AC4）禁止的方向。

**登记面的一个真实约束**：`checker-mutation-check.sh` 的 manifest 是**从不手写**的（其头注释逐字："THE MANIFEST IS NEVER HAND-WRITTEN … parsed out of scripts/test.sh's run_static_checks / run_doc_checks functions, runner-static-gate.ts's run_operational_checks, and the CI workflows"），当前 82 个 checker 的 `uncovered` 为空——即 `manager-tick-log-check.sh` **根本不在 manifest 里**（它由 orchestration 文档每轮调用，不被这些面解析）。⇒ 只放一个 case 文件在 `checker-mutation-cases/` 下**不会被任何东西执行**（那是 hard rule 4 推论三的"回声"形态）。因此本任务的完成面包含"让它进 manifest 并被执行"。⛔ 同时：注册面**必须用临时 fixture log/baseline 调用它**——该守卫在 `LINES > BASELINE` 时会**写** `<LOG>.baseline` sidecar，不得让一个静态门在跑检查时写仓内文件。

<!-- dedup-ref -->
相关联但不同机制：[[gap-archguard-p4-guard-lineage-declaration-and-registry]]（已 done）落地的是**谱系检测器 + 声明块**，其 AC4 反向判据恰好**故意**拿本守卫当"未验证"的负样本（当时是特性、不是待修缺陷，它证明判别力真实存在）；[[gap-manager-tick-log-check-row-criterion-and-shrink-ratchet]]（已 done）修的是**判据本身**（行格式识别 + 缩水棘轮），与本条要补的"变异验证"是两件事。

## AC

- [x] AC1（复现固化）：贴出立案读数逐字（`fired 0 / preventive 6 / suspicious 1`，含 `manager-tick-log-check.sh` 的 reason 行），以及 `ls plugin/scripts/checker-mutation-cases/ | grep -c manager-tick` = 0 与 `ls plugin/scripts/checker-mutation-cases/outer-tick-log-check.sh`（存在）的对照输出。【读数见 Evidence①；⚠️ 裸 `grep -c manager-tick` 实测 = 1（不是 0）—— 它命中的是**另一个** checker 的 case `no-manager-tick-doc-check.sh`（子串碰撞）；按位置判定（硬规则 2）锚定后 `grep -cE '^manager-tick'` = 0，与该 AC 的**本意**一致。两条读数都贴出。】
- [x] AC2（case 存在、含两向注入、且**可执行**）：新增 `plugin/scripts/checker-mutation-cases/manager-tick-log-check.sh`，`bash` 直跑 exit 0，输出含"注入被逮住 + 恢复后转绿"两类断言，且覆盖**两个方向各至少一条**：①陈旧分支（`--stale-hours 1` 或旧 mtime fixture）②缩水棘轮（高 `--baseline` + 小 log）。按 `checker-mutation-cases/` 既有契约实现（参照 `outer-tick-log-check.sh`：未逮住 ⇒ exit 1；恢复后仍红 ⇒ exit 4）。贴出完整运行输出。【读数见 Evidence②；另附三条**负控制**：依次阉掉守卫的 stale / shrink / no-tick-row 判定后，case 各自在对应注入点 exit 1 ⇒ 三条注入都是承重的。】
- [x] AC3（不是回声·case 必须被仓内机制实际执行）：`bash plugin/scripts/checker-mutation-check.sh --list --json` 的 `checkers[]` 里出现 `{"name":"manager-tick-log-check", "covered": true}`（即它已进入由 test.sh / runner-static-gate.ts / CI **解析**出的 manifest，⛔ 不是手工在名单里加一行），且 `bash plugin/scripts/checker-mutation-check.sh --check --only manager-tick-log-check` exit 0。贴出两条命令的真实输出。【读数见 Evidence③；`source` = `run_static_checks`（parse 出来的，非手写）。生产载体旁证：`.quay/checker-cost.jsonl` 落下一行 `{"name":"manager-tick-log-check",…,"verdict":"pass"}`（硬规则 4 推论三要求读**生产载体**，不是 fixture 回显）。】
- [x] AC4（不误伤主线·含写副作用约束）：①注册面/检查器在**新鲜检出、无 tick log** 的场景下不得把套件判红——守卫本体在 log 缺失时是 `{"ok":false,"reason":"no-log"}` + exit 1，注册面必须为它提供 fixture 或走显式 `NOT-EVALUATED` 路径（硬规则 3b：**未评估 ≠ 红 ≠ 绿**，三者取值必须可区分）②注册面跑检查时**不得写仓内 `.baseline` sidecar**（贴出该路径的 `--log`/`--baseline` 指向临时目录的证据，以及执行前后 `git status --porcelain` 未因该检查而新增改动的输出）。【读数见 Evidence④；注册面喂**固定 fixture**（守卫本体语义不变），本 worktree 正是「无 live tick log」场景（`present:false`）而静态闸 exit 0；`bash -x` 轨迹逐字显示 `--log /tmp/mgr-tick-check-bAhFWo/… --baseline /tmp/mgr-tick-check-bAhFWo/…`，前后 `git status --porcelain` 逐字相同。】
- [x] AC5（P4 判定翻转·**生产读数 = 落地判据**）：修后重跑 `node --experimental-strip-types plugin/scripts/guard-lineage-check.ts --json`，`suspicious` 里**不再含** `manager-tick-log-check.sh`，且它出现在 `preventive`。贴出修后 `preventive`/`suspicious` 两段逐字。⛔ 不以"case 文件存在"代替这条读数。【读数见 Evidence⑤：preventive 6 → 7（含 `manager-tick-log-check.sh`），suspicious 1 → **0**。⛔ 判定阈值与 `guard-lineage-check.ts` 本体一字未改。】
- [x] AC6（回归）：`node --experimental-strip-types plugin/test/guard-lineage-check.test.mjs` exit 0；`bash scripts/test.sh --for-task gap-manager-tick-log-check-mutation-case` 绿（或等价 scoped 静态门）。【读数见 Evidence⑥：9 pass / exit 0；scoped 门 30 pass / exit 0。】

## DoD

两个注入方向都在**真实脚本**上执行过一次并走完"转红 → 恢复 → 转绿"（贴完整输出），case 被 `checker-mutation-check.sh` 的自动 manifest 拾取并执行（`covered: true` + `--check --only` exit 0），且 `guard-lineage-check.ts` 的**生产读数**把该守卫从 `suspicious` 移到 `preventive`。⛔ 仅新增一个 case 文件而无人执行它，不算完成（那是 hard rule 4 推论三的"回声"形态）；⛔ 靠改判定阈值消掉这条也不算完成。

## Touches

- plugin/scripts/checker-mutation-cases/manager-tick-log-check.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/manager-tick-log-check.sh
- plugin/scripts/checker-mutation-check.sh
- plugin/test/guard-lineage-check.test.mjs
- tasks/gap-manager-tick-log-check-mutation-case.md

## Evidence

### ① AC1 — 立案读数逐字 + case 文件对照

```
$ node --experimental-strip-types plugin/scripts/guard-lineage-check.ts \
    --root <worktree> --cost-file <main>/.quay/checker-cost.jsonl --json
totalGuards 192  declared 7
verdict.evaluable true  firedCount 0   window {"minAt":"2026-09-04T13:04:58Z","maxAt":"2026-09-20T15:38:58Z"}
--- preventive (6) ---
  checker-mechanical-spine-check.ts | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  checker-mutation-check.sh        | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  instrument-decay-check.ts        | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  outer-tick-log-check.sh          | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  release-master-advance-needs-check.ts | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  release-master-advance-needs-check.ts | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
--- suspicious (1) ---
  manager-tick-log-check.sh | never-fired and not mutation-verified — indistinguishable from a broken guard (P4 定义)
```

对照输出（`--root` 指向主检出时对象 `present: true`；指向本 worktree 时 `present: false`，因为
manager tick log 是 untrack 运行时载体）：

```
$ ls plugin/scripts/checker-mutation-cases/ | grep -c manager-tick
1                      # ⚠️ 裸子串计数：命中的是 no-manager-tick-doc-check.sh（另一个 checker 的 case）
$ ls plugin/scripts/checker-mutation-cases/ | grep -cE '^manager-tick'
0                      # ✅ 按位置锚定（硬规则 2）：本 checker 的 case 当时确实不存在
$ ls plugin/scripts/checker-mutation-cases/ | grep -E 'manager-tick|outer-tick'
manager-tick-log-check.sh.bak 不存在；实际命中：no-manager-tick-doc-check.sh
$ ls -l plugin/scripts/checker-mutation-cases/outer-tick-log-check.sh
-rw-rw-r-- 1 yale yale 4349 … plugin/scripts/checker-mutation-cases/outer-tick-log-check.sh   # 姊妹档 case 存在
```

> 裸 `grep -c manager-tick` = 1 而非 0，原因是**子串碰撞**（`no-manager-tick-doc-check` 含
> `manager-tick`），不是「case 已存在」。硬规则 2（按位置判定）要求把它锚定后重读：`^manager-tick` = 0。

### ② AC2 — case 直跑 + 三条负控制

```
$ W="$(mktemp -d)"; bash plugin/scripts/checker-mutation-cases/manager-tick-log-check.sh "$W"; echo "EXIT=$?"
manager-tick-log-check mutation case: PASS (stale caught + shrink-ratchet caught + no-tick-row caught; all three restored to GREEN)
EXIT=0
```

case 覆盖的三条注入（每条都是「注入 ⇒ 必红 **且红的 reason 正确** ⇒ 恢复 ⇒ 绿」）：

| 注入 | 形态 | 断言 |
|---|---|---|
| ①陈旧分支 | `touch -d '2 hours ago'` + `--stale-hours 1` | `reason":"stale"` |
| ②缩水棘轮 | baseline sidecar=100 + 3 行 log | `reason":"shrink-detected"` |
| ③no-tick-row（附加） | 只剩表头的 log（baseline 先同步，避免棘轮先逮住） | `reason":"no-tick-row"` |

负控制（**证明三条注入都承重**，不是空转）——依次阉掉守卫的一条判定，case 必须在该注入点 exit 1：

```
$ # NC1: 把 `if [ "$AGE_SECONDS" -gt $(( STALE_HOURS * 3600 )) ]` 改成 `if false`
mutation NOT caught: a 2h-stale tick log stayed GREEN under --stale-hours 1 (a skipped round is invisible) — out={"ok":true,...}
NC1(stale-neutered) EXIT=1

$ # NC2: 把 `elif [ "$LINES" -lt "$BASELINE" ]` 改成 `elif false`
mutation NOT caught: baseline=100 vs a 3-line log stayed GREEN (shrink ratchet dead — 277→5 truncation would be silent) — out={"ok":true,"lines":3,"baseline":100}
NC2(shrink-neutered) EXIT=1

$ # NC3: 把 `if [ "$TICK_ROWS" = "0" ]` 改成 `if false`
mutation NOT caught: a header-only tick log stayed GREEN (no-tick-row judgement dead) — out={"ok":true,"tickRows":0,...}
NC3(no-tick-row-neutered) EXIT=1

$ git status --porcelain plugin/scripts/manager-tick-log-check.sh     # 负控制后守卫已还原
（空）
```

### ③ AC3 — manifest 拾取 + `--check --only`

```
$ bash plugin/scripts/checker-mutation-check.sh --list --json | …
checkers_total 83
checkers_with_mutation 83
uncovered []
[{'name': 'manager-tick-log-check', 'source': 'run_static_checks', 'covered': True}]

$ bash plugin/scripts/checker-mutation-check.sh --check --only manager-tick-log-check; echo "EXIT=$?"
manager-tick-log-check mutation case: PASS (stale caught + shrink-ratchet caught + no-tick-row caught; all three restored to GREEN)
MUTATION manager-tick-log-check: pass

checkers_executed: 1
only (delta-narrowed — ⛔ NOT the whole manifest): manager-tick-log-check
checkers_total: 83
checkers_with_mutation: 83
mutations_that_stayed_green: 0
mutations_that_always_red: 0
uncovered (registered checker with no mutation case): 0
errors: 0
duration_ms: 264
RESULT: PASS — every checker IN THIS DELTA went RED under its injected defect and GREEN on restore (narrowed run; the whole-store set is the full-tier registration's job).
EXIT=0
```

生产载体（硬规则 4 推论三：AC 必须能读**生产载体**，不是 fixture 回显）——注册面真跑后
`.quay/checker-cost.jsonl` 落下的一行：

```
{"name":"manager-tick-log-check","ms":148,"n":1,"load":14.60,"at":"2026-09-20T18:52:21Z","verdict":"pass"}
```

计数一致性（注册面加了一行 ⇒ 自述数必须同步，由机器核）：

```
$ node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts --root .
  [ok] plugin/scripts/runner-static-gate.ts:run_static_checks — declared 65, measured 65 (annotation at line 71)
  [ok] plugin/scripts/runner-static-gate.ts:run_operational_checks — declared 11, measured 11
  [ok] scripts/test.sh:run_doc_checks — declared 8, measured 8
PASS — every declared registry count matches its function body (3/3 evaluated)
```

### ④ AC4 — 不误伤主线 + 写副作用

```
$ git status --porcelain > /tmp/ac4-before.txt          # 只有本任务自己的两处改动
 M plugin/scripts/runner-static-gate.ts
?? plugin/scripts/checker-mutation-cases/manager-tick-log-check.sh

$ bash -x scripts/test.sh --static-checks > /tmp/static-x.log 2>&1; echo "SUITE_EXIT=$?"
SUITE_EXIT=0

$ grep -n 'manager-tick-log-check.sh --log\|_mgr_tick_fixture_dir=' /tmp/static-x.log
3989:+ _mgr_tick_fixture_dir=/tmp/mgr-tick-check-bAhFWo
3993:+ run_checker manager-tick-log-check bash …/manager-tick-log-check.sh --log /tmp/mgr-tick-check-bAhFWo/manager-tick-log.md --baseline /tmp/mgr-tick-check-bAhFWo/manager-tick-log.md.baseline --stale-hours 24
4022:+ bash …/manager-tick-log-check.sh --log /tmp/mgr-tick-check-bAhFWo/manager-tick-log.md --baseline /tmp/mgr-tick-check-bAhFWo/manager-tick-log.md.baseline --stale-hours 24

$ git status --porcelain > /tmp/ac4-after.txt; diff /tmp/ac4-before.txt /tmp/ac4-after.txt
（无差异 —— 注册面没有写任何仓内文件）

$ ls -d /tmp/mgr-tick-check-* 2>&1
ls: cannot access '/tmp/mgr-tick-check-*': No such file or directory      # fixture 目录已被清理
$ grep -c STATIC_CHECK_FAILED /tmp/static-x.log
0
$ git ls-files orchestration/manager-tick-log.md.baseline && cat orchestration/manager-tick-log.md.baseline
orchestration/manager-tick-log.md.baseline
394                                                                      # 仓内 sidecar 一字未动（run 未碰它）
```

①「新鲜检出、无 tick log」的现场就是本 worktree：它**没有** `orchestration/manager-tick-log.md`
（守卫谱系读数里该 file 对象 `present: false`），而 `--static-checks` exit 0 ⇒ 未误伤主线。
歧义在**注册面**消解（喂固定 fixture），守卫本体的 `no-log ⇒ exit 1` 语义**一字未改**（那是 AC5b 要的）。

### ⑤ AC5 — 生产读数翻转

```
$ node --experimental-strip-types plugin/scripts/guard-lineage-check.ts --json
root /home/yale/work/quay-worktrees/gap-manager-tick-log-check-mutation-case
verdict.evaluable true  firedCount 0  rowsWithVerdict 1812
--- preventive (7) ---
  checker-mechanical-spine-check.ts | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  checker-mutation-check.sh         | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  instrument-decay-check.ts         | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  manager-tick-log-check.sh         | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  outer-tick-log-check.sh           | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  release-master-advance-needs-check.ts | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
  release-master-advance-needs-check.ts | never-fired but mutation-verified (proven able to fire) — preventive, not suspicious
--- suspicious (0) ---
suspicious contains manager-tick-log-check?  false
preventive contains manager-tick-log-check?  true
```

同一读数在「窗口取主检出成本账本」的口径下一致（preventive 7 / suspicious 0）。
⛔ `guard-lineage-check.ts` 本体一字未改 —— 翻转来自**证据**（case 存在），不是来自判定放宽。

### ⑥ AC6 — 回归

```
$ node --experimental-strip-types plugin/test/guard-lineage-check.test.mjs
ℹ tests 9   ℹ pass 9   ℹ fail 0        TEST_EXIT=0

$ bash scripts/test.sh --for-task gap-manager-tick-log-check-mutation-case --allow-thin
ℹ tests 30  ℹ pass 30  ℹ fail 0        SCoped_EXIT=0
```

### 残留（明说，不掩盖）

`checker-mutation-check.sh` 只判「**已注册**的 checker 有 case」（`uncovered`），**不判**
「case 文件对应的 checker 是否仍被注册」——若将来有人删掉 `run_static_checks()` 里那一行，
case 会退化成 orphan（现有先例：`no-manager-tick-doc-check.sh`），而 `uncovered` 仍是 0、
P4 谱系仍读「preventive」，**无任何机件会报**。这是本任务**之外**的一个缺口，本任务未修（修它
要先处理既有 orphan，且改动面落在 `checker-mutation-check.sh` 的判定域上，属另一条任务）。
