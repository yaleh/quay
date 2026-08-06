---
id: gap-no-post-merge-cross-machine-verification-detection-latency-is-luck
title: "a wrong merge resolution has NO mechanism that finds it — post-merge verification is missing: THIS machine merges task/<id> → integration → develop, and a wrongly-resolved merge stays undetected (detection latency d is pure luck). Cross-machine verification goal cancelled 2026-08-06 (human: keep github release only) — the 'merge has no verifier' core survives, reframed to single-repo post-merge verification; the 4+3 historical cross-machine defects are evidence of the shape, not the premise"
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
- [ ] AC2: **延迟达标**——AC1 实测的 `detection_latency_h` **< 1 小时**（模型盈亏点 2.2h，留一倍余量）
- [ ] AC3: **负控制（本任务最关键的一条）**——故意合入一个已知坏改动，闸**必须报红**并指出文件；
      若报绿则本机制无效，不得以 AC1 通过为由结案
- [ ] AC4: **验证方独立于参与方**（2026-08-06 改写——原"非参与机器"依赖跨机前提；本机合并路径下改为结构独立）——
      机械证明跑验证的不是执行该合并的那个动作/进程（`verifier_is_participant = 0`），贴出证据；这是结构要求
      （亲代环境掩盖亲代缺陷——合并动作自验会掩盖自己的错）
- [ ] AC5: **`d` 可被机械读出**——存在一条命令报出「当前有哪些合并还没被独立验证 / 各自已等了多久」，
      贴出实跑输出（否则模型的控制变量仍然无测量，等于没修）
- [ ] AC6: **不引入系统 crontab；随包传播**——`crontab -l` 两机均无本任务新增条目；机制文件位于
      `plugin/` 之下且在 `quay-init` 的铺设集里（贴出铺设证据）。理由：ad-arm1 之所以能抓到，
      是因为它跑了铺设下来的冷启动闸——**这一段"遗传物质"必须随包走，否则第四台机器又没有**

## Definition of Done

- [ ] AC1-AC6 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录本次实测的 `d`，并与模型的 2.2h 盈亏点对照

## Touches
- tasks/gap-no-post-merge-cross-machine-verification-detection-latency-is-luck.md
- plugin/scripts/periodic-push-backup.sh
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- plugin/scripts/quay-init.sh
- tasks/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes.md（同一双触发源模式，交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-06T14:1xZ
changed: 内层立案任务补 Contract 格式（measure 补 backtick 命令 + 字段、invariant/control 续行合并、加本段）。任务待派（dispatch 记账 0d6e98b7 补晋 ready）。

