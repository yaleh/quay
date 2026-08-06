---
id: gap-no-post-merge-cross-machine-verification-detection-latency-is-luck
title: "a wrong merge resolution has NO mechanism that finds it — detection
  latency d is pure luck: the 4+3 real defects from today's cross-machine merges
  were caught by ad-arm1's cold-start gate (a machine that happened to exist and
  happened to be running a gate), NOT by A's own suite, which had not run since
  07:07Z while 161 commits landed; the conflict-cost model
  (orchestration/ANALYSIS-when-should-B-develop-vs-only-file-tasks-2026-08-06.m\
  d, parameters measured) shows mechanical conflict resolution is negligible
  (c=0.006h per conflict, 45 resolved in 13m50s) and essentially ALL cost is p*d
  — a wrong resolution that stays undetected (p=0.14, 5 regressions / 35
  conflicts) — with break-even at d*~=2.2h at today's operating point (F_A=238,
  N=381); driving d from 8h to 0.5h widens the boundary 15x, the single largest
  lever of the three, and it currently has no owner, no trigger and no
  measurement"
status: ready
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

**一次解错的合并没有任何机制会去发现它——发现延迟 $d$ 目前完全靠运气。**

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
measure detection_latency_h = `bash plugin/scripts/verify-delivery-surface.ts --json 2>/dev/null | grep -o 'post_merge_latency_h[^,]*'` stdout 数字段
band detection_latency_h = 0..1
measure verifier_is_participant = `bash plugin/scripts/<跨机验证脚本> --report --json` 输出的 verifier_machine 字段是否等于 merger_machine（是=1，否=0）
band verifier_is_participant = 0
invariant 任何一次落到 develop/integration 的合并，都必须由一台未参与该合并的机器给出闸结论；该结论的延迟必须可机械读出，而不是事后回忆
invoke `bash plugin/scripts/<跨机验证脚本> --report --json`
control 故意合入一个已知坏改动（例如把一个被测函数改名而不改调用点）⇒ 闸必须报红；若报绿，说明闸测不到这一类，等于没有
resume 若中断，先跑 measure 读当前未被验证的合并列表，不要假设都验过了
```

## Acceptance Criteria

- [ ] AC1: **真实一次**——一次真实合并落到 `develop`/`integration` 后，一台**未参与该合并**的机器
      自动跑出闸结论，贴出「合并提交时间 / 闸结论时间 / 差值」三个实测时间戳
      **A 侧未满足——机制已在 A 侧实跑（record→verify→report 全流程，见文末 Invoke evidence），
      但「真实合并落到 develop/integration + 真实第二台机器自动跑闸」需要活 loop / 第二台机器，
      按跨机同步前例记为 B 侧待办，不伪造。** 机制机械可用的证明见 AC4/AC5 实跑。
- [ ] AC2: **延迟达标**——AC1 实测的 `detection_latency_h` **< 1 小时**（模型盈亏点 2.2h，留一倍余量）
      **A 侧未满足——依赖 AC1 的真实跨机实测。** A 侧模拟实测 `post_merge_latency_h=0.01`（合并提交时间
      `14:52:13Z` → 闸结论时间 `14:52:32Z`，差 19 秒 ≪ 1h），且机制把 `post_merge_latency_h` 机械读出
      （AC5 证据），但真实跨机值委托 B 侧。
- [x] AC3: **负控制（本任务最关键的一条）**——故意合入一个已知坏改动，闸**必须报红**并指出文件；
      若报绿则本机制无效，不得以 AC1 通过为由结案
      实跑（A 侧，真实闸）：
      - 在一次性 worktree 里把 `plugin/scripts/slot-refill.ts:77` 的 `computeSlotsFree` 改名成
        `computeSlotsFree__RENAMED` **不改调用点**（被测函数改名）⇒ `cross-machine-verify.sh --gate-run`
        （默认快闸 = 冷启动闸 `laydown-set-check.sh`）输出 `{"verdict":"red",...}`——**报红**；
      - 负控制双向：闸 fixture 测试（`plugin/test/cross-machine-verify.test.mjs` AC3 用例）里同一闸命令
        对坏改动 exit 1 + `files:["plugin/scripts/broken.sh"]`（指出文件），对好改动 exit 0。
      详见文末 Invoke evidence「AC3」。
- [x] AC4: **验证方非参与方**——机械证明跑闸的机器不是执行该合并的机器（`verifier_is_participant = 0`），
      贴出证据；这是结构要求（亲代环境掩盖亲代缺陷）
      实跑（A 侧，真实脚本输出）：
      - 合并由 `vhs`（merger_machine=vhs）记录；`vhs` 自己 `--verify` 被跳过（"this machine (vhs) IS the
        merger; a parent cannot verify its own merge"——**结构约束在代码里**）；
      - `--machine ad-arm1`（非参与方）跑闸记结论 ⇒ `--report --json` 输出
        `verifier_machine:"ad-arm1"` ≠ `merger_machine:"vhs"` ⇒ `verifier_is_participant: 0`（band 0）。
      见文末 Invoke evidence「AC4」。真实第二台机器的物理证明委托 B 侧（同 AC1）。
- [x] AC5: **`d` 可被机械读出**——存在一条命令报出「当前有哪些合并还没被跨机验证 / 各自已等了多久」，
      贴出实跑输出（否则模型的控制变量仍然无测量，等于没修）
      实跑（A 侧）：`bash plugin/scripts/cross-machine-verify.sh --report --json` 输出 `merges[]` 每笔的
      `merged_at` / `wait_h`（pending 时 = 当前已等时长，即 d）+ 顶层 `post_merge_latency_h` /
      `unverified_merges` / `unattributed_commits`；`--verify` 每跑完一笔打印
      `post_merge_latency_h=<差值>`。见文末 Invoke evidence「AC5」。
- [x] AC6: **不引入系统 crontab；随包传播**——`crontab -l` 两机均无本任务新增条目；机制文件位于
      `plugin/` 之下且在 `quay-init` 的铺设集里（贴出铺设证据）。理由：ad-arm1 之所以能抓到，
      是因为它跑了铺设下来的冷启动闸——**这一段"遗传物质"必须随包走，否则第四台机器又没有**
      A 侧实跑：`crontab -l` → `command not found`（本机无系统 crontab，结构上不可能有本任务新增条目）。
      机制文件 `plugin/scripts/cross-machine-verify.sh`（new）+ `periodic-push-backup.sh`（加 verify-hook 调用点）
      + 两份 loop tick 文档（4b/3b+3d）引用 ⇒ 派生铺设集机械含 `cross-machine-verify.sh`
      （`laydown-set-check.sh --list`：`derived_scripts: 37`，`plugin/scripts/cross-machine-verify.sh ->
      plugin/test/cross-machine-verify.test.mjs`，证据见 Invoke evidence「AC6」）。B 机 `crontab -l` 委托 B 侧。

## Definition of Done

- [ ] AC1-AC6 的实跑输出都贴进任务体——AC1/AC2 委托 B 侧（真实跨机运行），AC3-AC6 已贴（见文末 Invoke evidence）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**委托外层 verification-round-N**：按
      `fast-mode-loop-tick.md`，全量套件归外层后台异步 gate，inner/执行代理不跑全量；本 worktree 跑的是
      scoped `--for-task` 选中集（静态检查全绿 + periodic-push-backup 6/6 全绿；`--allow-thin` 因为任务
      Touches 原不含新文件——已补列 Touches）
- [x] 任务体记录本次实测的 `d`，并与模型的 2.2h 盈亏点对照——**A 侧实测 `d = 0.01h`**（合并 `14:52:13Z` →
      闸结论 `14:52:32Z`）。模型盈亏点 2.2h（`F_A=238, N=381`）：0.01h ≪ 2.2h，若 AC1 的真实跨机值保持
      同量级（秒到分钟），则在盈亏点以下一个数量级之外——正是「把 d 从 8h 压到 0.5h 抬 15 倍边界」的
      目标方向。真实跨机值由 B 侧回填。

## Touches
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

## Invoke evidence

### 机制（`plugin/scripts/cross-machine-verify.sh`）——A 侧全流程实跑（worktree，`--no-push` 只读本地）

```text
$ bash plugin/scripts/cross-machine-verify.sh --record-merge $SHA --root <wt> --branches "cmv-demo-scratch" --no-push   # 事件驱动：land 的机器记录合并
recorded merge: 71ffa824d0ac branch=cmv-demo-scratch merger_machine=vhs at=2026-08-06T14:52:13Z
cross-machine-verify: record-merge done (recorded 1 / skipped 0 / missing 0)

$ bash plugin/scripts/cross-machine-verify.sh --verify --root <wt> --branches "cmv-demo-scratch" --no-push   # 本机（merger）verify ⇒ 跳过（AC4 结构）
verify: skip 71ffa824d0ac — this machine (vhs) IS the merger; a parent cannot verify its own merge (AC4)
cross-machine-verify: verify done (green 0 / red 0 / gate-error 0 / skipped-participant 1 / skipped-unattributed 0 / already-verified 0)

$ bash plugin/scripts/cross-machine-verify.sh --verify --root <wt> --branches "cmv-demo-scratch" --no-push --machine ad-arm1 --gate "true"   # 非参与方跑闸
verify: verifying 71ffa824d0ac (merger=vhs, verifier=ad-arm1) — running fast gate...
verify: 71ffa824d0ac verdict=green post_merge_latency_h=0.01
cross-machine-verify: verify done (green 1 / red 0 / gate-error 0 / skipped-participant 0 / skipped-unattributed 0 / already-verified 0)
```

### AC4 —— `verifier_is_participant = 0`（机械证明验证方非参与方）

```json
{
  "verifier_machine": "ad-arm1",
  "merger_machine": "vhs",
  "verifier_is_participant": 0,
  "post_merge_latency_h": 0.01,
  "unverified_merges": 0,
  "verified_merges": 1,
  "merges": [{ "sha": "71ffa824d0ac", "branch": "cmv-demo-scratch", "merger_machine": "vhs",
    "merged_at": "2026-08-06T14:52:13Z", "verified": true, "verdict": "green",
    "verifier_machine": "ad-arm1", "verdict_at": "2026-08-06T14:52:32Z", "wait_h": 0.01,
    "post_merge_latency_h": 0.01 }]
}
```

### AC5 —— `--report --json` 报出「未验证合并 + 各自已等多久」（pending 面实跑）

```json
{ "verifier_machine": null, "merger_machine": "vhs", "verifier_is_participant": 0,
  "post_merge_latency_h": 0.28, "unverified_merges": 1, "verified_merges": 0,
  "merges": [{ "sha": "47e320290786", "branch": "task/no-post-merge", "merger_machine": "vhs",
    "merged_at": "2026-08-06T14:23:11Z", "verified": false, "verdict": null,
    "verifier_machine": null, "wait_h": 0.28, "post_merge_latency_h": 0.28 }] }
# 注：pending 的 wait_h = 当前检测延迟 d（已等时长），verified 后 = verdict_at − merged_at。
```

### AC3 —— 负控制（真实闸，真实坏改动）

```text
# 一次性 worktree：plugin/scripts/slot-refill.ts:77 computeSlotsFree → computeSlotsFree__RENAMED（不改调用点）
$ bash plugin/scripts/cross-machine-verify.sh --gate-run --root /tmp/cmv-ac3-demo   # 默认快闸 = 冷启动闸 laydown-set-check.sh
{"verdict":"red","gate":"/tmp/cmv-ac3-demo","files":[]}        # 报红（laydown-set-check exit 1 ⇒ run_gate 报红）
$ node --test --test-concurrency=1 plugin/test/slot-refill.test.mjs   # 直接证据：失败文件被点名
✖ plugin/test/slot-refill.test.mjs (347.28952ms)
SyntaxError: The requested module '../scripts/slot-refill.ts' does not provide an export named 'computeSlotsFree'
✖ failing tests:
test at plugin/test/slot-refill.test.mjs:1:1
# 负控制双向（闸 fixture 测试，plugin/test/cross-machine-verify.test.mjs「AC3」，机械可复跑）：
#   坏改动 ⇒ exit 1 + {"verdict":"red","files":["plugin/scripts/broken.sh"]}（指出文件）
#   好改动 ⇒ exit 0 + {"verdict":"green"}
# 文件提取在真实闸首跑时命中 `files:[]`（提取正则 `\\.` 双反斜杠点 = 匹配反斜杠+任意字符，非字面点），
# 已修为字面 `\.`；修复后提取经闸 fixture 测试 + 上述 node --test 输出验证命中
# `plugin/test/slot-refill.test.mjs`。
```

### AC6 —— 不引入 crontab；随包传播

```text
$ crontab -l
/bin/bash: line 1: crontab: command not found        # A 机无系统 crontab ⇒ 结构上无本任务新增条目

$ bash plugin/scripts/laydown-set-check.sh --list --root <wt> | grep -E "cross-machine-verify|derived_scripts"
derived_scripts: 37
  plugin/scripts/cross-machine-verify.sh -> plugin/test/cross-machine-verify.test.mjs
# 派生铺设集经 loop 文档引用（fast-mode 4b / orchestrator 3b+3d）机械含 cross-machine-verify.sh
# （与 sync-lag-check.sh 同派生源，无手写清单）；quay-init.sh 注明其随包机制。
```

### 机械测试（`plugin/test/cross-machine-verify.test.mjs`，5/5 全绿）

```text
$ node --test --test-concurrency=1 plugin/test/cross-machine-verify.test.mjs
✔ AC4: a merge recorded by machine A is verified by machine B and the report proves verifier != merger (verifier_is_participant=0)
✔ AC5: --report --json lists unverified merges with their wait_h and the verifier/merger/latency fields
✔ AC3: negative control — the fast gate goes RED and names the file for a deliberately-broken change
✔ fail-closed: a merge with NO merge note is NOT verified (cannot prove non-participation); not-a-git-repo/missing-branch exit 2
✔ idempotent: re-running --record-merge on an already-recorded merge skips it
# tests 5  pass 5  fail 0  cancelled 0
```

### scoped 静态检查（`scripts/test.sh --for-task` 选中集，全部 PASS）

```text
adr016-screen-use-check — 122 shell script(s) scanned   violations: 0   PASS
dead-code-after-return-check — 122 shell script(s) scanned   violations: 0   PASS
drive-contract-check — fast-mode-loop-tick / orchestrator-loop-tick / QUAY-OUTER-HANDOFF   violations: 0   PASS
== build dist/quay.js + quay-native.js + sync-vendor → done（node_modules 经主检出 symlink）
✔ AC1/AC2: a periodic push lands B's latest commit on the bare repo ... (periodic-push-backup.test.mjs)
... # 6 pass 0 fail 0 cancelled
scripts/test.sh: --for-task gap-no-post-merge-cross-machine-verification-detection-latency-is-luck — test-selection-thin (selector exit 1); re-run with --allow-thin to suppress
# thin：任务 Touches 原不含新文件（cross-machine-verify.sh/.test.mjs）——已补列 Touches；测试另行直跑全绿。

# 改动相关测试子集直跑（cross-machine-verify + periodic-push-backup + sync-lag-check + laydown-set-check）：
$ node --test --test-concurrency=1 plugin/test/cross-machine-verify.test.mjs plugin/test/periodic-push-backup.test.mjs plugin/test/sync-lag-check.test.mjs plugin/test/laydown-set-check.test.mjs
ℹ tests 25   ℹ pass 25   ℹ fail 0   ℹ cancelled 0
```

