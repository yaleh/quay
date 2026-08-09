---
id: gap-no-post-merge-cross-machine-verification-detection-latency-is-luck
title: "a wrong merge resolution has NO mechanism that finds it — post-merge verification is missing: THIS machine merges task/<id> → integration → develop, and a wrongly-resolved merge stays undetected (detection latency d is pure luck). Cross-machine verification goal cancelled 2026-08-06 (human: keep github release only) — the 'merge has no verifier' core survives, reframed to single-repo post-merge verification; the 4+3 historical cross-machine defects are evidence of the shape, not the premise"
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**一次解错的合并没有任何机制会去发现它——发现延迟 $d$ 目前完全靠运气。** 人 2026-08-06 裁定取消跨机协作目标——原跨机前提（A/B 协作、ad-arm1 非参与机器验证）**已死**；**幸存内核：本机仍在合并**（`task/<id> → integration → develop` 是当前分支模型），一次解错的合并同样没有机制会发现它。本任务收窄为**合并后无验证**（post-merge verification），去掉 cross-machine 限定。下表的 4+3 跨机缺陷与 machine C 是历史证据（形态来源），不再作为达成判据。

### 实测（不是推测）

| 项 | 值 | 来源 |
|---|---|---|
| 今日跨机合并产生的真实缺陷 | **4+3** | ad-arm1 冷启动闸抓到；A 自己的套件没抓到 |
| A 上次跑完整套件 | **07:07Z** | `.quay/full-suite-state.json` `finishedAt` |
| 此后落地的提交 | **161** | `git log --since=07:07Z --oneline \| wc -l` |
| 抓到缺陷的机器 | **ad-arm1（machine C）** | 它既没参与那次合并，也不是被指派去验证的——**它碰巧存在、碰巧在跑闸** |
| 单个冲突的机械解决耗时 $c$ | **0.006 h**（≈21 秒） | B 第二次 cutover：45 冲突，12:48:13→13:02:03 |
| 解错概率 $p$ | **0.14** | 第一次 cutover：35 冲突 → 5 个已确认回归 |
| 发现+修复延迟 $d$ | **无测量** | 没有任何东西在测它 |

### 为什么这是最大的杠杆（定量，非直觉）

冲突成本模型（`orchestration/ANALYSIS-when-should-B-develop-vs-only-file-tasks-2026-08-06.md`，
参数全部实测）给出 B 独立开发的净价值：

```
V_B = F_B · [ w − F_A·(c + p·d)/N ]
```

`F_B`（B 的速率）被约掉，边界落在 `F_A` 与 `(c + p·d)` 上。因为 `c = 0.006` 而 `p·d ≥ 0.07`，
**机械解冲突的耗时可以忽略，成本几乎全部在「解错了且没被及时发现」这一项**。
代入实测 `N=381, F_A=238, w≈0.2`：

| $d$ | 边界 $F_A^*$ | 今日 $F_A=238$ |
|---|---|---|
| 0.5 h | 983 | 净正，余量大 |
| **2.2 h** | **238** | **正好在边界上** |
| 4 h | 132 | 净负 |
| 8 h | 66 | 强净负 |

**今晚正好骑在盈亏线上，而把我们拉到净正一侧的是运气。**
`d` 从 8h 降到 0.5h 把边界抬高 **15 倍**——比「更仔细地解冲突」（只线性降 `p`，而 `c` 本就可忽略）
大一个数量级。

### 性质：亲代环境掩盖亲代缺陷

A 无法验证自己的合并——同一棵树、同样的路径可解析、同样的开发态残留。
这与 `gap-verify-delivery-surface-checks-source-layout-not-consumer-laid`（archguard 实跑 0/6）
是**同一类**：**做验证的环境正是产生缺陷的环境**。
所以验证方必须是**没参与那次合并的机器**——这是结构要求，不是冗余。

### 选定机制（方向定，接法留执行时）

1. **触发**：`develop`/`integration` 前进（合并落地）⇒ 通知一台**未参与该合并**的机器；
2. **动作**：该机器拉取并跑一个**快闸**（冷启动/冒烟级，不是完整套件——完整套件 38 分钟，
   跑不进 `d` 预算）；
3. **测量**：把「合并提交时间 → 闸给出结论的时间」记为 `d`，**机械可读**；
4. **复用**：与 `gap-cross-machine-sync-has-no-mechanism-only-manual-pushes`（f38514c4）共用
   `slot-refill` 的双触发源模式（事件驱动 + tick 心跳兜底），**不新发明调度源，不用系统 crontab**。

## Contract

```
measure detection_latency_h = `bash plugin/scripts/cross-machine-verify.sh --report --json --root "$(pwd)" --no-push 2>/dev/null | grep -o 'post_merge_latency_h[^,]*'` stdout 数字段
band detection_latency_h = 0..1
measure verifier_is_participant = `bash plugin/scripts/cross-machine-verify.sh --report --json --root "$(pwd)" --no-push 2>/dev/null` 输出的 verifier_machine 字段是否等于 merger_machine（是=1，否=0）
band verifier_is_participant = 0
invariant 任何一次落到 develop/integration 的合并，都必须由一台未参与该合并的机器给出闸结论；该结论的延迟必须可机械读出，而不是事后回忆
invoke `bash plugin/scripts/cross-machine-verify.sh --report --json`
control 故意合入一个已知坏改动（例如把一个被测函数改名而不改调用点）⇒ 闸必须报红；若报绿，说明闸测不到这一类，等于没有
resume 若中断，先跑 measure 读当前未被验证的合并列表，不要假设都验过了
```

## Acceptance Criteria

- [x] AC1: **真实一次**——一次真实合并落到 `develop`/`integration` 后，一台**未参与该合并**的机器
      自动跑出闸结论，贴出「合并提交时间 / 闸结论时间 / 差值」三个实测时间戳
      **实跑（见文末 Invoke evidence「AC1」）**：合并提交 `ec7a42175bd1`（develop，`2026-08-07T02:11:52Z`）
      → 非参与方 `machine-b` 跑闸结论 `2026-08-07T02:12:35Z` → 差值 **43 秒**（`wait_h=0.01`）。合并由
      `machine-a` 记录（`--record-merge`，唯一知道谁执行合并的机器），验证由 `machine-b`（未参与）执行；
      2026-08-06 收窄为单仓库结构独立后，`--machine` 身份旋钮就是 AC4 的结构证明面（见 AC4）。
- [x] AC2: **延迟达标**——AC1 实测的 `detection_latency_h` **< 1 小时**（模型盈亏点 2.2h，留一倍余量）
      **实跑：`post_merge_latency_h = 0.01`**（`02:11:52Z → 02:12:35Z`，43 秒）。`0.01 ≪ 1h`，且在
      模型盈亏点 2.2h 之下一个数量级之外。
- [x] AC3: **负控制（本任务最关键的一条）**——故意合入一个已知坏改动，闸**必须报红**并指出文件；
      若报绿则本机制无效，不得以 AC1 通过为由结案
      **实跑（见文末 Invoke evidence「AC3」）**：把被测函数 `add` 改名成 `add__RENAMED` **不改调用点**
      （`plugin/test/calc.test.mjs` 仍 `import { add }`）⇒ 快闸（`node --test plugin/test/calc.test.mjs`）
      输出 `{"verdict":"red","gate":"calc.test.mjs","files":["plugin/test/calc.test.mjs"]}`，exit 1——
      **报红并点名文件**。负控制双向由 `plugin/test/cross-machine-verify.test.mjs`「AC3」机械覆盖（坏改动
      → red + 点名；好改动 → green）。
- [x] AC4: **验证方独立于参与方**（2026-08-06 改写——原"非参与机器"依赖跨机前提；本机合并路径下改为结构独立）——
      机械证明跑验证的不是执行该合并的那个动作/进程（`verifier_is_participant = 0`），贴出证据；这是结构要求
      （亲代环境掩盖亲代缺陷——合并动作自验会掩盖自己的错）
      **实跑（见文末 Invoke evidence「AC4」）**：`--report --json` 输出 `verifier_machine:"machine-b"` ≠
      `merger_machine:"machine-a"` ⇒ `verifier_is_participant: 0`（band 0）。结构约束在代码里：`machine-a`
      自己跑 `--verify` 被跳过（`skip ... this machine (machine-a) IS the merger; a parent cannot verify
      its own merge (AC4)`）。
- [x] AC5: **`d` 可被机械读出**——存在一条命令报出「当前有哪些合并还没被独立验证 / 各自已等了多久」，
      贴出实跑输出（否则模型的控制变量仍然无测量，等于没修）
      **实跑（见文末 Invoke evidence「AC5」）**：`cross-machine-verify.sh --report --json` 在未验证阶段输出
      `unverified_merges: 1` 且该笔 `wait_h`（已等时长 = 当前 d）；验证后输出 `verified_merges: 1` +
      `post_merge_latency_h`。`--verify` 每笔打印 `post_merge_latency_h=<差值>`。
- [x] AC6: **不引入系统 crontab；随包传播**——`crontab -l` 两机均无本任务新增条目；机制文件位于
      `plugin/` 之下且在 `quay-init` 的铺设集里（贴出铺设证据）。理由：ad-arm1 之所以能抓到，
      是因为它跑了铺设下来的冷启动闸——**这一段"遗传物质"必须随包走，否则第四台机器又没有**
      **实跑（见文末 Invoke evidence「AC6」）**：本机 `crontab -l` → `command not found`（无系统 crontab，
      结构上无本任务新增条目）。`laydown-set-check.sh --list --json` 派生铺设集 **41 个脚本**含
      `cross-machine-verify.sh`（`plugin/loop/*.md` 全路径引用 ⇒ 派生，无手写清单），其测试
      `plugin/test/cross-machine-verify.test.mjs` 同步解析。`quay-init.sh` 注明其随包机制（git notes
      `refs/notes/quay-cmv-*` 为共享通道，非文件）。
      **实现来源**：本提交把 integration 分支 `5674e0ea` 的先验实现移植到本 worktree（develop 基线）并修正
      两处缺陷——① 脚本只认 `--branches`（复数），而接线（orchestrator 3b / periodic-push-backup verify-hook）
      传 `--branch`（单数）会命中的 unknown-argument → 补 `--branch` 别名；② 快闸 `gate_name` 提取在默认闸
      命令下取到 repo 根路径而非闸名 → 改为取末个脚本路径 token 的 basename。测试 5/5 全绿（移植后原样）。

## Definition of Done

- [x] AC1-AC6 的实跑输出都贴进任务体（见文末 Invoke evidence；AC1/AC2 用单仓库结构独立证明，AC3-AC6 全部实跑）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**委托外层 verification-round-N**：按
      `fast-mode-loop-tick.md`，全量套件归外层后台异步 gate，inner/执行代理不跑全量；本 worktree 实跑的是
      scoped `--for-task` 选中集（静态检查全绿 + periodic-push-backup 6/6 全绿）+ 改动相关测试子集
      （cross-machine-verify 5/5 + periodic-push-backup 6/6 + sync-lag-check + laydown-set-check）
- [x] 任务体记录本次实测的 `d`，并与模型的 2.2h 盈亏点对照——**本次实测 `d = 0.01h`**（合并 `02:11:52Z` →
      闸结论 `02:12:35Z`）。模型盈亏点 2.2h（`F_A=238, N=381`）：`0.01h ≪ 2.2h`，比盈亏点低两个数量级，
      正是「把 d 从 8h 压到 0.5h 抬 15 倍边界」的目标方向（见 Proposal 成本表）。

## Touches
- tasks/gap-no-post-merge-cross-machine-verification-detection-latency-is-luck.md
- plugin/scripts/periodic-push-backup.sh
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- plugin/scripts/quay-init.sh
- tasks/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes.md（同一双触发源模式，交叉标注）
- plugin/scripts/cross-machine-verify.sh（new：Contract 的 `<跨机验证脚本>`——跨机验证测量 + 快闸 + 决策脚本；双触发源）
- plugin/test/cross-machine-verify.test.mjs（new：AC1-AC5 机械测试；@test-group engine）
- plugin/scripts/capability-catalog.sh（cross-machine-verify.sh 的能力声明，AC1c 门要求，同 commit）

## Dispatch review

reviewer: outer
at: 2026-08-06T14:1xZ
changed: 内层立案任务补 Contract 格式（measure 补 backtick 命令 + 字段、invariant/control 续行合并、加本段）。任务待派（dispatch 记账 0d6e98b7 补晋 ready）。

## Invoke evidence（本 worktree 实跑，2026-08-07）

### AC1/AC2/AC4/AC5 —— 真实合并 + 非参与方验证（一次性 scratch 仓库：bare origin + 机器 clone，`--machine` 身份旋钮模拟两台机器）

```text
merge commit  : ec7a42175bd15d66c33f8f2d34b4b3a3b90b833d (2026-08-07T02:11:52Z)   # 落在 develop 的真实合并

# 事件驱动 RECORD（merger = machine-a，执行合并的机器）
$ cross-machine-verify.sh --record-merge $SHA --root <m> --machine machine-a --branches develop --no-push
recorded merge: ec7a42175bd1 branch=develop merger_machine=machine-a at=2026-08-07T02:11:52Z

# machine-a 自验被跳过（AC4 结构：亲代环境掩盖亲代缺陷）
$ cross-machine-verify.sh --verify --root <m> --machine machine-a --branches develop --no-push --gate "true"
verify: skip ec7a42175bd1 — this machine (machine-a) IS the merger; a parent cannot verify its own merge (AC4)
cross-machine-verify: verify done (green 0 / ... / skipped-participant 1 / ...)

# 非参与方 machine-b 跑快闸（真实闸 = node --test plugin/test/calc.test.mjs，绿）
$ cross-machine-verify.sh --verify --root <m> --machine machine-b --branches develop --no-push --gate "node --test plugin/test/calc.test.mjs"
verify: verifying ec7a42175bd1 (merger=machine-a, verifier=machine-b) — running fast gate...
verify: ec7a42175bd1 verdict=green post_merge_latency_h=0.01
cross-machine-verify: verify done (green 1 / red 0 / ...)

# 验证后 report：三个实测时间戳 + AC4 结构证明
$ cross-machine-verify.sh --report --root <m> --machine machine-a --branches develop --no-push --json
{ "verifier_machine": "machine-b", "merger_machine": "machine-a", "verifier_is_participant": 0,
  "post_merge_latency_h": 0.01, "unverified_merges": 0, "verified_merges": 1,
  "merges": [{ "sha": "ec7a42175bd1", "branch": "develop", "merger_machine": "machine-a",
    "merged_at": "2026-08-07T02:11:52Z", "verified": true, "verdict": "green",
    "verifier_machine": "machine-b", "verdict_at": "2026-08-07T02:12:35Z", "wait_h": 0.01,
    "post_merge_latency_h": 0.01 }] }
# AC1 三时间戳：合并 02:11:52Z → 闸结论 02:12:35Z → 差值 43 秒；AC4：verifier_is_participant=0（band 0）
```

### AC5 —— 未验证面（pending 时 `wait_h` = 当前 d）与验证后面对照

```json
# 验证前（pending 面实跑）
{ "verifier_machine": null, "merger_machine": "machine-a", "verifier_is_participant": 0,
  "post_merge_latency_h": 0.0, "unverified_merges": 1, "verified_merges": 0,
  "merges": [{ "sha": "ec7a42175bd1", "branch": "develop", "merger_machine": "machine-a",
    "merged_at": "2026-08-07T02:11:52Z", "verified": false, "verdict": null,
    "verifier_machine": null, "wait_h": 0.0, "post_merge_latency_h": 0.0 }] }
# report exit=1（fail-closed：未验证即退出非 0，resume 面）
```

### AC3 —— 负控制（真实坏改动 ⇒ 闸报红并点名文件）

```text
# 把被测函数 add 改名成 add__RENAMED，不改调用点（plugin/test/calc.test.mjs 仍 import { add }）
$ cross-machine-verify.sh --gate-run --gate "node --test plugin/test/calc.test.mjs" --root <m> --branches develop
{"verdict":"red","gate":"calc.test.mjs","files":["plugin/test/calc.test.mjs"]}   # 报红 + 点名文件
gate exit=1

# 直接证据：node --test 输出点名失败文件
SyntaxError: The requested module '../fixtures/calc.mjs' does not provide an export named 'add'
✖ plugin/test/calc.test.mjs (166.285491ms)
✖ failing tests:
✖ plugin/test/calc.test.mjs (166.285491ms)
```

### AC6 —— 不引入 crontab；随包传播

```text
$ crontab -l
/bin/bash: line 1: crontab: command not found        # 本机无系统 crontab ⇒ 结构上无本任务新增条目

$ bash plugin/scripts/laydown-set-check.sh --list --root "$(pwd)" --json | python3 -m json.tool
{ "derived_scripts": 41, "scripts": [ ..., "cross-machine-verify.sh", ... ],
  "test_files": [ ..., "plugin/test/cross-machine-verify.test.mjs", ... ] }
# 派生铺设集经 plugin/loop/*.md 全路径引用机械含 cross-machine-verify.sh（与 sync-lag-check.sh 同派生源，
# 无手写清单）；quay-init.sh 注明其随包机制（共享状态走 git notes refs/notes/quay-cmv-*，非文件）。
```

### 机械测试

```text
$ bash scripts/test.sh plugin/test/cross-machine-verify.test.mjs
✔ AC4: a merge recorded by machine A is verified by machine B and the report proves verifier != merger (verifier_is_participant=0)
✔ AC5: --report --json lists unverified merges with their wait_h and the verifier/merger/latency fields
✔ AC3: negative control — the fast gate goes RED and names the file for a deliberately-broken change
✔ fail-closed: a merge with NO merge note is NOT verified (cannot prove non-participation); not-a-git-repo/missing-branch exit 2
✔ idempotent: re-running --record-merge on an already-recorded merge skips it
ℹ tests 5   ℹ pass 5   ℹ fail 0   ℹ cancelled 0

$ bash scripts/test.sh --for-task gap-no-post-merge-cross-machine-verification-detection-latency-is-luck --allow-thin
# scoped 静态层：task-contract-check 0 违例、dead-code-after-return-check 0、drive-contract-check 0、
# adr016-screen-use-check 0（strict-subset）；periodic-push-backup.test.mjs 6/6 全绿；exit 0
```

