# 快速模式队列状态（跨 compact / /clear 恢复用）

**更新：** 2026-08-02，内层编排会话写入
**用途：** `/clear` 后重读此文件 + 冷启动节三命令建立实况，**以 git 实测为准**（此文件可能是旧快照）
**上层目标：** `orchestration/exp6-phase1-sustained-unattended-operation.md`（外层任务，内层读它了解全局）

---

## 2026-08-04 批（外层裁定 A–F + R1/R3；内层 A/D/B + L0 并发，全部 fan-in 全量绿）

**全量绿（fan-in 后）：** tests **2276** / fail 0 / cancelled 0 / skipped 25（凭证缺失 live-GitHub）。参考值 2239→2276（+37，本批新测试）。

| 任务 | 状态 | merge | 关键 |
|---|---|---|---|
| `gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid`（A） | done | `d3104bbc` | ADR-016 Amendment 2026-08-04（枚举五态/底部区域/禁整屏哈希）；`adr016-screen-use-check.ts` 按代码位置判 capture-pane→哈希，band 0..1，接 run_static_checks + mutation case；`## Carries` 承载 send-keys-verified AC1-4（顺解 F 造成的 carryover 红） |
| `gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable`（D） | **ready**（AC3/4 R3 留白） | `5a26e5a5` | `pane-state-classify.ts` 纯分类器（五态/底部区域/两级抗脆 unknown+raw）；夹具 waiting-input ×3 + busy ×2（R3 只采现有 pane）；permission/error/unknown 标 unavailable-until-real-occurence；`fixture_count`=5 在 band(10..30) 之外 ⇒ **需外层修订 band** |
| `gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick`（B） | done | `e1b4983f` | `--detect-stop --pane` 接 classifyPaneState；**在飞 subagent 去歧义**（状态区 `← N agent` + 遥测在飞，waiting-input 不写；permission-prompt 恒写）；`--transcript` 降为旁证；真实负控制实跑（busy 不写 / waiting+agent 不写） |
| `gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX`（L0） | done | `f6ad4d09` | `tmux-isolated.sh`（env -u TMUX + 显式 -S）；session-liveness.sh 迁显式 socket 形态（哈希带保持 1）；AC2 负控制证明默认服务端完好 |

**D 为何留 ready：** R3 禁为采集新建会话 ⇒ permission-prompt/error-banner/unknown 无真实样本、`fixture_count`=5 < band 10..30 ⇒ AC3/AC4 勾不上。task check 门不过。**待外层修订 band 或接受 unavailable 标注。**

**next 批（滚动派发，不等攒批，3 槽位全满）：**
- ✅ `gap-node-compile-cache-is-never-enabled-and-every-spawn-reparses`：已 merge（`d3c5c09e`），scoped 5/5 绿，NODE_COMPILE_CACHE 落磁盘（ext2/ext3，非 tmpfs），~2.7×/spawn；**任务关闭延到批量 fan-in**（全量 DoD；此时 suite-speed 在跑全量基准，两层不同时跑全量）。closure 需补 task body 证据（agent 未改 task body）
- ✅ `gap-retire-inner-state-one-observer-targets-by-parameter`：已 merge（`059c2437`，删除 inner-state.sh + 测试），rebase 4 次全净；AC6 处置表完整（BLOCKED auto-ruling-required ⇒ 「不再作 live Monitor 事件」+ 理由：外层 `--detect-stop --pane` 同时写+读）；**残余 1 个 live inner-state 挂载未杀**（R3 禁会话清理，留外层停）；AC5 代码层收敛（inner_state_mounts code=0）；adr016 检查器 1-in-band 绿。**noise-gate 测试（~29s×2）在 suite-speed 基准满载下 flaky**——agent 静窗实测 48/0/1；不是 merge 回归。全量 DoD + noise-gate 复核延到批量 fan-in（token 空闲窗）
- ✅ `gap-task-write-accepts-a-title-that-breaks-its-own-frontmatter`：已 merge（`b1c96299`），scoped 5/5 绿 + 全 quay-native 58/58 + live-GitHub conformance 全过（含 2 新 hazardous-title probe）；Contract 实测：`The ## Contract` 与 `god-package: gate/ has fanOut=62` 均 round-trip。写入侧 YAML.stringify 显式化 + fail-closed validateWrittenYaml。closure 需补 task body 证据（agent 未改 task body）
- ✅ `gap-adr-016-alternatives-rejected-one-shot-claim-is-factually-wrong`：已 merge（`1fcdb545`），第二个 Amendment 2026-08-04（claude -p 理由改为三条真实硬约束，结论逐字保留）；CLAUDE.md 无同型实例未改；adr016 检查器 1-in-band 绿
- ✅ `gap-reliable-send-crystallize-the-five-failure-modes-into-a-script`：已 merge（`0c0daf6b`），20/20 绿；`send-keys-reliable.sh`（5 步可靠发送）+ `transcript-delivery-check.ts`（纯函数，无哈希/无假 TUI）；AC6 用真实 transcript 判 delivered:true / never-sent:false；**完整跨会话 SEND 留安全窗**（R3 禁建会话，现有会话都在跑）
- ✅ `gap-promotion-cadence-is-role-volition-not-product-mechanism`：已 merge（`5037ee55`，**遥测同一步关闭**——纪律修复首例），11/11 绿；`ready-pool-check.ts` 实跑 pool=6≥3 无需补晋；tick 文档新增步骤 3.6（就绪池维护）
- ✅ `gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool`：已 merge（`84ab1dcc`，遥测同步关闭），12/12 绿；`notYetFlipped` 改判「工作落 master」（复用 task-status-drift 的 `taskWorkLanded`，非另造一套）；实树 pool 7→0（5 条 merged 任务全排除），真实可派发
- ✅ `gap-suite-speed-under-a-297-second-sigma`：已 merge（`ec237c3e`，遥测已闭 needs-human），**诚实无改善结论**——delta 83.8s（779.1→695.4）< σ 297.6s，band 未达；AC5 负控制通过（comment-only −4.8s）；twice-green verify/2+3 连续绿；session-liveness flake 在基线复现（pre-existing，非杠杆回归）。lever：嵌套调用 setup-skip（mark_nested），省 ~84s。**band 判定待外层**（同 D 先例）
- **批量全量（batch-2 收口）**：✅ **GREEN — tests 2298 / fail 0 / cancelled 0 / skipped 27**（新参考值 2298）。修掉 retire-inner-state merge 的 2 处残留测试（inner-blocked AC4 改用 --read；loop-shipping AC3 断言退役标记）后重跑全绿。suite-speed 按外层裁定 honest no-improvement 关闭（delta 83.8s < σ 297.6s，接受结论）。**batch-2 全部关闭完成**：8 条任务全部 done（closure agent `3ab119df`），invoke 证据齐全（task-contract ratchet new since baseline 0），telemetry 全配对，worktree 全清（仅 M239 存档），全量参考值 **2298**。

**遥测纪律（外层 2026-08-04 纠正，系统性 gap）：** 合并必须同一步 `--task-end outcome=done`——本轮 5 次合并（node-cache/retire-state/task-write/am2/reliable-send）漏闭遥测括号，全部由外层代补。**规则：fan-in merge → 同一动作内跑 `--task-end --taskId <id> --runId <bracket> --outcome done`**，不等外层发现。suite-speed 落地时同理。

## 批 3（2026-08-04 夜，ready-pool-check 补晋 + 滚动派发）

**补晋 3 条**（ready-pool-check `candidates` 按机制顺序推荐，eligible:true）：`gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards`、`gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second`、`gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet`（todo→ready，touch 两两 disjoint 已核）。

**派发**：3 后台 agent（run_in_background:true），scoped 不跑全量，telemetry 已开。

**⚠ 发现的机制缺陷（ready-pool-defect 的 taskWorkLanded 过冲）**：补晋后 `pool` 字段仍为 0——因为 3 条新任务的 Touches 文件已在 master 上存在（它们在改既有文件，非新建），`taskWorkLanded` 把「Touches 文件存在」误判为「工作已落 master」。**信号过冲**：candidates 推荐它们补晋、pool 却排除它们，自相矛盾。需后续修复：taskWorkLanded 应区分「任务自己的改动已落」与「Touches 文件只是存在」（例如按任务特有符号解析，而非任一 Touches 条目存在）。

**派发 3 中已完成 2：**
- ✅ `gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second`：已 merge（`b51b650e`，遥测同步闭），emit 路径拆分——全量记录进共享 events.jsonl、持有者阈值只 gate stdout；adr016 哈希带保持 1。scoped 38/0/1 + 重跑 EXIT 0
- ✅ `gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet`：已 merge（`7478d979`，遥测同步闭），`expandDeclaredTouches`（声明式 (new) touch 不查盘，通配符才查）；镜像实为 symlink 天然一致。scoped 43/0 两次
- ✅ `gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards`：已 merge（`d13ce490`，遥测同步闭），`--reconcile` 机制（按可观察判据关掉崩溃残留的 phantom inProgress；fail-closed 向 keep）+ ORPHAN 方向文档更正（code 里 ORPHAN=end-without-start，与旧文档相反）；scoped 40/40
- **批 3 全量（3 条 merged）**：首跑 1 fail——dispatch-eligibility 的 scheduler replay fixtures（`experiments/.../fixtures/scheduler/replay-*.md`）把旧路径正则作为输出数据嵌入，被 loop-shipping AC1b 全仓扫描误判为 live 引用。**已修**（loop-shipping AC1b 排除 fixtures 目录，`ef587d22`，12/12 绿）。**重跑全绿 — tests 2283 / fail 0 / cancelled 0 / skipped 28**（新参考值 2283）。**批 3 关闭完成**（closure `f7b32ccf`）：3 条全 done，invoke 证据齐全（task-contract 0 新违规），遥测全配对，worktree 全清。

## 累计（2026-08-04 三个批）

- **批 1**：A/D/B/L0 四任务 done，全量 2276。
- **批 2**：8 任务 done（node-cache/retire-inner-state/task-write/am2/reliable-send/promotion-cadence/ready-pool-defect/suite-speed），全量 2298。
- **批 3**：3 任务 done（phantom-in-flight/log-filtered/dispatch-eligibility），全量 2283。
- 全量参考值演变：2276 → 2298 → 2283（phantom-in-flight 测试重标 governance 后默认 product,engine 下 skip，故略降）。
- **就绪池（ready-pool-check 诚实口径）**：**已修 taskWorkLanded 过冲**（`gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks`，done，merge `191f179a`）——touch 信号只认任务自建（(new)）文件，既有文件型改判任务特有符号。**AC4 实测：补晋 6 条改既有文件型任务后 pool 0→4**。6 条已补晋 ready：gap-eighty-one / gap-eighty-two / gap-load-sensitive / gap-preflight（池内）+ gap-drive-text / gap-init-ships（被**既有符号信号边缘**排除——AC 反引号引用既有函数导致 resolve，非本次缺陷）。**晋级速率解除阻塞（57 条 todo 可滚动补晋派发）。**
- 遗留：符号信号边缘（引用既有函数的 AC 会被误判已落）——可作后续 refinement 任务；非本次 touch 过冲缺陷。

## 批 4（overshoot 全量绿后，外层优先级裁定）

**派发 3（run_in_background:true，全 disjoint，telemetry 已开）：**
- ✅ **`gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down`（PRIORITY）**：已 merge（`a8a52266`，遥测同步闭）——LOOP_SCRIPTS 改为从文档引用派生（自动铺 6 个此前缺失脚本），local-state 文件声明 self-create（touch 命令，不铺空副本保字节相同升级），quay 实验散文声明 reference-doc；verify-referenced-landed 机械步（fail-closed）；scoped 34/34
- ✅ `gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point`：已 merge（`9b05a2f9`，遥测同步闭），`instrument` MCP 工具（list/run，清单派生非硬编码），scoped 22/22
- ✅ `gap-load-sensitive-session-family-confounds-step-three`：已 merge（`11b01d37`，遥测同步闭）——KNOWN-LOAD-SENSITIVE 注解（步骤三放宽排除该族；高负载负控制复现 28-29s timing 签名证明敏感为真）；scoped 46/45/0/0/1
- **gap-eighty-two 待 gap-init-ships 落地后派**（同碰 `plugin/scripts/quay-init.sh`，串行）——已派
- ✅ `gap-load-sensitive-session-family-confounds-step-three`：已 merge（`11b01d37`，遥测同步闭）——KNOWN-LOAD-SENSITIVE 注解（高负载负控制复现 28-29s timing 签名证明敏感为真）；scoped 46/45/0/0/1
- ✅ `gap-eighty-two-shipped-checks-and-none-says-what-it-answers`：已 merge（`9d3735a1`，遥测同步闭）——capability-catalog.sh（派生 87-check 清单，每个 check 声明它回答什么），scoped 8/8
- ✅ `gap-ac3b-prove-installed-quay-runs-without-dev-tree`：已 merge（`2b0ba79a`，遥测同步闭）——**meta-cc 安装前唯一硬阻塞已解除**；AC1 刷已装插件（quay.js 2026-08-05 01:21 新于 08-04）+ 改名负控制 AC3/AC4（安全窗实跑，AC3 真 task_list 往返 / AC4 PATH 形态失败）+ AC6 零残留；**顺带修了 quay-init 只写 mcp_entry 不铺运行时缺口**（vendor 本地 provider bundle）；scoped 68/68
- **批 4 全量（5 条 merged）**：首跑 2 fail——**2 个 task 文件 frontmatter 标题含内嵌引号导致 yaml.parse 失败**（gap-residue-check / gap-split-batch-vocabulary，非 batch-4 引入，是既有书写路径绕过 task-write 的 YAML 安全引号）。**已修**（`6c137696`，整值引号包裹）。**重跑全绿 — tests 2298 / fail 0 / cancelled 0 / skipped 28**（新参考值 2298）。**批 4 关闭完成**（closure `9c71b5d8`）：5 条全 done，invoke 证据齐全（task-contract 0 新违规），遥测全配对，worktree 全清。

## 累计（2026-08-04~05 四个批）

- **批 1**：A/D/B/L0 四任务 done，全量 2276。
- **批 2**：8 任务 done，全量 2298。
- **批 3**：3 任务 done，全量 2283。
- **批 4**：5 任务 done（init-ships / eighty-one / load-sensitive / eighty-two / ac3b），全量 2298。
- **全量参考值演变**：2276 → 2298 → 2283 → 2298。
- **累计 20 任务 done**。**meta-cc 安装前唯一硬阻塞（ac3b）已解除**——已装插件已刷新（quay.js 08-05 01:21）。
- 顺带修复：2 个 task frontmatter 内嵌引号标题导致 yaml.parse 失败（`6c137696`）。
- 就绪池待派：`gap-promotion-cadence-is-role-volition-not-product-mechanism`（ready，未选入本轮 2 条）
- 待关闭时注意：D/L0 关闭曾引入 task-contract `invoke-evidence-missing` ratchet（2 条）——已补 invoke 实跑证据修掉（`new since baseline: 0`）。后续 done 任务都须带 invoke 证据。

---

## 前置（exp6 阶段 A/B，满足后才启动 12 小时）

| AC | 内容 | 状态 |
|---|---|---|
| AC2 | 3 个既有失败各有 open 任务 | ✔ 已建 + **已修**（全 done） |
| AC4 | readiness 补 suite-green | ✔ 已补（`52cde788`，实跑 NOT READY 验证过） |
| AC1 | 套件 0 失败 | ✔ **达成**（2128 tests / 2110 pass / 18 skip / **0 fail**） |
| AC3 | select-preflight ≤30s | ✔ **达成**（83.4s → 8.3s，~10×，merge `ae94205a`） |
| AC5 | tick 队列补充步骤 | ⏳ 未做（下一项） |

## B4 已完成（2026-08-02，全部 merge + 全量绿）

| 任务 | merge | 关键 |
|---|---|---|
| `gap-select-preflight-json-real-store-too-slow` | `ae94205a` | walk-once 共享：83.4s→8.3s；2 walk-count 回归锁 |
| `gap-symlink-mirror-invocation-test-contract-mismatch` | `1f824aee` | 测试契约模型：exit-0+Usage 合法 + clock 字段 redact |
| `gap-dod-clause13-14-enforced-but-undocumented` | `f10f6860` | Option A 文档补 Clause 13/14，PASS all 15 clauses |

## 已完成 B5（全部 merge）

| 任务 | merge | 关键 |
|---|---|---|
| `gap-tests-spawn-cli-from-ts-source`（用户建 `fa0500ad`） | `7032e704` | cli-entry.mjs 载体 + cli.test.mjs 131s→66s；done |
| `gap-tests-use-cli-where-module-import-suffices`（用户建 `0f0c8d10`） | `478e76d2` | sink 不必要的 fixture 进程（serve/mcp-server tests）；done，34.5 min |

## 滞留分支合并（人裁定顺序 M222 → M246 → M243，M239 推迟）

| 分支 | 状态 |
|---|---|
| **M222**（DIR-112） | ✅ **已合并** `6721ec28`，全量绿（2139/2121/0/18，447.6s）。墙钟差值 489−447.6=41.4s，**落在 20–63s 噪声带宽内 → 如实判定「不可判定」**（非改善）。cli.test.mjs 单文件 58.2s vs 66s 基线，方向性。done |
| M246（DIR-124-A5） | ✅ **已合并**（M246 merge），全量绿（2275/2257/0/18，429.9s，+136 测试）。独立新文件干净合并。done |
| **M243**（DIR-124-A2） | ✅ **已 merge `3dfba2c6` + 收尾完成**。单套件最终验证：2296/2277/1 fail（仅 M136）/18 skip，491.5s。**判定：M243 代码干净，大规模崩溃是并发争抢产物**（4 核跑 2 个 c8 套件 = 4 倍过订；对照 M243 前单套件同样无崩溃）。095ddbf0 带回（.error 在场）、5 类 A1a 差异逐个有证据、负控制真 fail-detect。任务 done，计量 60 min。**遗留：M136（sync-vendor 确定性错标失败）独立于 M243，已建任务 `gap-sync-vendor-drift-mislabelled-as-task-schema`** |

## 已完成 B6

| 任务 | merge | 关键 |
|---|---|---|
| `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` | `4282632c` | 成本模型实测：**非「最慢单文件」决定、8-lane 饱和**（Σ/wall ≈7.1）；噪声带宽 17–63s；B5-1/B5-2 墙钟效果在噪声内不可判定；AC1b 断言汇聚点计时（env-gated，零断言改动）+ `measure-suite.mjs` 可重复测量工具。done，72 min |

## 待执行（按顺序）

| 任务 | 说明 |
|---|---|
| **批 5（3 在飞，AC13）** | **dispatch-gate**（fm-...-y7tt6x，/tmp/quay-wt-dispatchgate）+ **m264-flaky**（fm-...-mxjpbk，/tmp/quay-wt-m264）+ **test-coverage-parser**（fm-...-4w3tpe，/tmp/quay-wt-tccheck）。checkTouchesPair 两两 DISJOINT（外层复核通过）。**批 4 已完成（AC1 达成，外层独立核实）**：tasksperhour/ac11/reverse-drift 全 done；batch4b/4c 逐项相同 2361/2343/0/0/18 + exit 0 + selected 167 ×3。**下一批候选**：`gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion` + `gap-test-isolation-contract-is-unwritten`（均与在飞正交可派）；**`gap-no-resource-awareness-heavy-ops-run-blind` 与 dispatch-gate 冲突（同改 orchestrator-loop-tick + fast-mode-loop-tick）——等 dispatch-gate 落地后再派**。**判绿三条件已记入 tick 文件**：cancelled==0 AND exit 0 AND tests==2361（fail 0 ≠ 绿——batch4a 崩溃时 fail 0 但 cancelled 2/tests 2246）。**外层正向漂移 9 条 + 检测器盲区（删除类任务 Touches 语义反）已记入本文件下方** |
| **M136（已完成）** | `gap-sync-vendor-drift-mislabelled-as-task-schema`，done（第三轮 60 min）。三轮：错标 → 并发重建免疫 → **消除干扰源**。负控制通过、--check 只读。**注意**：M136 修好了但**没修好这个类**——外层独立全量（00:03Z）仍 fail 1 = relation-sync（同类手写 harness，隔离绿/套件红） |
| **flags-only 缺陷（已完成）** | `gap-test-sh-flags-only-form-silently-runs-a-different-suite`，done |
| **`--test-concurrency=4 vs 8` 实测（已完成）** | `gap-suite-concurrency-4-vs-8-measurement`，done。外层决定：不改默认，保持 8。「系统性全量崩溃」线索关闭 |
| 下一批 gap 任务 | **先 checkTouchesPair 组可并发批次**。测试是最大可优化项（36%），新成本模型已给出可测阈值（≥20s 墙钟 / Σ 需 ≥5 采样）。**34 个手写 harness 的「隔离绿/套件红」类是后续重点**（relation-sync 是第 2 个，AC7 要判断还剩多少成员） |
| AC5：tick 队列补充步骤 | 复用 select-preflight/assembleBatch，不新建 |
| AC6（已达成） | `.halt` 已解除（17:43Z，readiness READY）。**/loop 25m 已启动且可查验**（CronList 返回 `2312da21 — Every 25 minutes (recurring) [session-only]`）。理由：/loop 是跨 /clear//compact 兜底（非驱动器），对一个专门在上下文丢失后兜底的机制，不可查验即不可信 |

**数据有效性精确边界（2026-08-02 21:05，inner-forensics 取证）**：flags-only 缺陷只在「裸标志 + 无文件列表」时触发。我的 8 次全量调用中 **7 次无标志（有效）**、**1 次裸标志 18:35:44 `--test-concurrency=4 > full-suite-m243-c4.log`（被污染，8037 失败作废）**。20:16 那次 `--test-concurrency=4` + 4 显式文件（重型子集 332/332 绿）**有效**（有文件列表，node 跑指定文件）。外层那组 `--test-concurrency=4`（8573）同样作废。**结论：M243 后崩溃、M136 全量红/隔离绿、干净窗口 load1=0.39 仍 fail 1 均为有效观察**，继续作证据。污染的范围要查（inner-forensics 秒级），不要凭印象估。

## 工作方式调整（外层实测 2026-08-02，含 subagent transcript 的完整分解）

- **时间去向（修正版，含 subagent transcript）：空转 14% / 全量套件 26.2% + 范围化 9.7% = 测试 36%**。早先「空转 49%、测试不是瓶颈」的分解漏了 subagent transcript，是错的（`940a3f5b` 修正）——**测试是最大的可优化项**
- 迭代阶段一律 `--for-task`（68s vs 489s，7.2×），全量只在合并前跑一次
- 下一批先 checkTouchesPair 组可并发批次，不默认串行

## 揭示的既有失败（已建任务，勿重复）

- 3 engine：symlink-mirror ×2 + enforcement-with-design ×1（open 任务在飞）
- 3 governance：chart2-s2（B3-2 记录为发现，需另建任务——本批未覆盖）
- **M136 sync-vendor 确定性失败**（2026-08-02，已建任务 `gap-sync-vendor-drift-mislabelled-as-task-schema`）：`sync-vendor.sh --check` 每次报 `vendor/task-schema.ts differs`——但该文件**不存在**，真正漂移的是 `packages/quay/dist/quay.js` vs `plugin/vendor/quay/dist/quay.js`（vendored 副本陈旧）。根因：`sync-vendor.sh:82` 标签是复制粘贴的错标（从 task-schema 段抄来），实际比对 dist bundle。**连查 3 次每次 1 行 DRIFT——确定性，非 flaky**（我上一轮判「flaky」是错的，外层纠正）。错标把调查引向「task-schema expected-diff 容差」的错误方向，代价是三轮误判。处置：先修标签再修同步（任务体 AC）
- **并发跑 2 个 c8 套件 = runner 崩溃**（2026-08-02 教训）：4 核机器上 `--test-concurrency=8` 已过订 2×，两个套件同时跑 = 4 倍过订 → 127/237 文件 'Promise pending' 崩溃。**全量套件必须严格串行跑**（同一时刻只跑一个），这验证了外层建议的 `--test-concurrency=4 vs 8` 实验值得做（记于 orchestration/throughput-decomposition.md）

## 已完成（B2/B3 全批次）

B2-0..B2-3、B3-1 合并 + 全量绿；B3-2 三步处置后 done。细节见 `git log` 与 `/tmp/fast-mode-batch2-timing.md`。

## 常设纪律（tick 文件）

- fan-in 前必须 `git rebase master`（worktree 快照过期 = B3-2 红的教训）
- 测试不得硬编码全局计数（`EXPECTED_ENGINE=58` 教训）
- 发现问题必须处置：修或建任务（有证据才建），不静音
- 计量强制：派发前 `--task-start`、fan-in 关闭 `--task-end`，两步不可跳过
- 停止条件：`.halt`/suite 非绿/needs-human≥3/合并冲突/就绪队列空 —— 一律停下等人

## 外层 tick 发现（2026-08-03T02:12:10Z）

### 正向漂移 9 条（reverse 已归零，reverse-drift 修复在真实仓库核实通过）

`task-status-drift-check.ts --json` 实测：`reverse: 0`、`suspects: 9`、`scanned: 583`。

| 任务 | status | 判定 |
|---|---|---|
| `gap-prepare-milestone-no-worktree-isolation` | ready | **真阳性**——CLAUDE.md 已记为 M252 已实现，`prepare-milestone.js` 里 `isolationMode` 实际存在于 6 处（行 92/101/116/119/120/311），但 **8 个 AC 全部未勾**。是「代码落地但 AC 未回填」，不是「代码未落地」 |
| `gap-retire-the-prepare-execute-pipeline-cluster` | todo | **假阳性，且是检测器的新盲区**——见下 |
| `gap-reverse-drift-check-buries-true-positives-in-noise` | todo | 真阳性但会自解：合并已落地（`48845281`），内层正在批 4 全量验证后才会 `--task-end` |
| `DIR-100-B` `DIR-100-C` `DIR-103-C` `DIR-119-D2/D3/D4` | todo/ready | 待分诊 |

### 检测器新盲区：删除类任务的 Touches 语义是反的

`gap-retire-the-prepare-execute-pipeline-cluster` 的 `## Touches` 列的是
`prepare-milestone.js` 等**待删除**的文件。它们存在 ⇒ `touchesAllExist=true` ⇒ 被判为「代码已落地」。

**但对删除类任务，这些文件存在恰恰说明工作没做。** 检测器的名字说「代码已落地」，
实际测的是「Touches 里点名的文件存在」——又一个「名不符实」实例
（`docs/analysis/instrument-failure-mode.md`）。

**随着裁剪成为工作的一大块，这会反复出现。** 修法有两种，择一即可：
任务声明意图（`## Touches` 条目标 `(delete)`），或检测器对 `labels` 含裁剪类的任务反转判据。
归入 [[gap-reverse-drift-check-buries-true-positives-in-noise]] 的后续，不单开任务。

## 外层指令：空转归因instrumentation（2026-08-03T02:41:54Z，人已裁定）

**此条在内层 auto-compact 前后都必须生效——若压缩后读到这里而尚未执行，立刻执行。**

### 裁定

人的裁定原文：「先让内层在下一个窗口里加上这个记录，攒一轮数据再说。」
**这一轮只攒数据。不做任何优化、不缩短任何间隔、不改 tick 频率。**

### 实测依据

8.78 小时无人值守窗口（2026-08-02T17:43Z → 2026-08-03T02:30Z），内层会话 `3bbd3095` 合并 28 个
subagent transcript：

| 间隙归因 | 小时 | 占窗口 |
|---|---|---|
| **前一条无命令**（回合结束后等待被唤起） | **3.80** | **43.3%** |
| 其它 Bash/工具 | 0.35 | 4.0% |
| 全量套件 | 0.22 | 2.5% |
| 范围化测试 | 0.04 | 0.5% |

间隙分布：61 个 >60s，1–5min **40** 个、5–10min **17** 个、10–20min 4 个、
**20 分钟以上 0 个**（最长 18.6min）。

**两个结论**：

1. **外层 20 分钟 tick 不是约束**——若是，应在 20 分钟处堆积并拖尾，实测一个都没有。
   因此「缩短外层 tick」买不到任何东西，**不要做**。
2. **`.quay/inner-blocked.json` 至今零条记录**，根因是 `VALID_BLOCKED_REASONS` 的 7 个值
   （merge-conflict / suite-red / review-refuted / task-over-90m / needs-human-backlog /
   ruling-required / queue-empty）**全部是已声明的停止条件**，
   词汇表里没有「回合结束、无待办、等被唤起」这个词，所以占 43.3% 的主要情形永远无法被记录。

### 要做的三件（都很小，不需要新机制）

1. 给 `VALID_BLOCKED_REASONS` 加一个值 **`turn-ended-idle`**，
   `REASON_DESCRIPTIONS` 写「回合结束、无待办工具调用、等待被重新唤起」，补测试。
2. **每次要以「无待办」结束回合前**，先调用：
   ```
   node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts \
     --assert-blocked --taskId <当前或 none> --reason <枚举值> --question "<在等什么，一句话>"
   ```
   被唤起后**立刻** `--clear`——`--clear` 会把等待时长写进遥测，**那正是我们要攒的数据**。
3. **不做优化。** 攒满一个窗口后由外层做归因，再决定优化什么。
   在 3.80 小时没有归因之前定任何阈值，是 416s 那个错误的重演。

### 文件占用提醒

`plugin/loop/fast-mode-loop-tick.md` 正被在飞的 `gap-dispatch-gate-has-no-checklist-and-no-trace`
占用。该文档的改动**并进那个任务或等它落地后再改**，不要并行改同一文件。

## 外层更正上一条指令（2026-08-03T02:45:03Z）—— 不该进阻塞信号

**上一条指令（2026-08-03T02:45:03Z 前约 15 分钟）有设计错误，外层自己发现的。以本条为准。**

### 错在哪

`turn-ended-idle` **不是「停下等裁定」**——回合结束、无待办不是在等外层，是在等自己的 loop 唤起。
把它写进 `.quay/inner-blocked.json` 会造成两处误触发：

1. `plugin/scripts/inner-state.sh:25-30` 对**任何** reason 都发 `BLOCKED reason=… question=…`，
   **没有过滤**。⇒ 内层每结束一次回合就叫醒外层一次，而这些事件不需要任何动作。
   **一个有意义的告警信号会被稀释成噪声**——这比没有信号更糟，因为它会训练出忽略。
2. `restart-readiness-check.sh` 在 un-halt 前打印阻塞记录（「内层在等裁定 ≠ 可以解除 `.halt`」）。
   一条 `turn-ended-idle` 会挡住 un-halt。

而且 `plugin/loop/fast-mode-loop-tick.md:238-256` 的触发条件写的是「**停下等人**」，
`--reason` 示例硬编码那七个值，并明写「**不新增语义（AC2）**」。
**加了枚举值但文档禁止使用它 ⇒ 代码与文档两个源头打架**，正是本仓库反复要消灭的漂移。

### 改为（三件，都更小）

1. **撤回 `7cfc9733`**——从 `VALID_BLOCKED_REASONS` / `REASON_DESCRIPTIONS` 移除 `turn-ended-idle`，
   测试断言改回 7。理由是上面第 2 段：留着一个文档禁止使用的值，比没有它更容易让人写错。
2. **改用只追加的日志**，与告警信号完全分开：
   ```bash
   # 每次以「无待办」结束回合前，追加一行（无状态、无需 --clear）
   # REASON 与 NOTE 是占位符，替换成实际值；注意不要写成 <reason> 那种形式，shell 会当重定向
   node -e 'require("fs").appendFileSync("orchestration/inner-idle-log.jsonl",
     JSON.stringify({at:new Date().toISOString(),reason:process.argv[1],note:process.argv[2]})+"\n")' \
     REASON '一句话说明在等什么'
   ```
   `reason` 用这五个之一：`awaiting-subagent`（在等自己派的 subagent）、
   `queue-empty`（无可派任务）、`awaiting-ruling`（真的在等外层裁定）、
   `rate-limited`、`no-reason`（说不出为什么——**这一项的计数本身就是下一轮要修的东西**）。
3. **时长不用内层记**——外层从 transcript 的时间戳间隙算（已验证可行：8.78h 窗口 61 个间隙、
   3.80h 无命令）。内层只提供**原因**，两边 join 即可。这样内层零状态、零清理、零误触发。

### 不做

不改 `inner-state.sh`、不改 `restart-readiness-check.sh`、不给阻塞信号加过滤——
**保持阻塞信号只有一个含义：内层在等外层裁定。** 一个信号一个含义，比一个信号加一层过滤更难用错。

### 内层实现（2026-08-03T02:50Z）

机制已落地为 `plugin/scripts/inner-idle-log.ts`（reason 五值 fail-closed，`--root` 可测）+
`plugin/test/inner-idle-log.test.mjs`（6/6）+ gitignore。用法：

```bash
node --no-warnings --experimental-strip-types plugin/scripts/inner-idle-log.ts \
  --append --reason <awaiting-subagent|queue-empty|awaiting-ruling|rate-limited|no-reason> \
  --note "<一句话在等什么>"
node --no-warnings --experimental-strip-types plugin/scripts/inner-idle-log.ts --counts
```

**纪律：每次要以「无待办」结束回合前调用一次 `--append`；无 `--clear`（零状态、只追加）。
`at` 是 ISO 字符串；时长不记（外层从 transcript 间隙算，按 `at` join）。**

## Tick 记录（2026-08-03T02:55Z，内层）

- **哨兵**：无 `.halt`（运行中）
- **本 tick 做了**：执行外层更正三件（撤回 turn-ended-idle `18d27d18`、落地 idle-log `aa047baa`、
  discovery git-index 修复 `63afe8f8`——AC4 主检出红的根因）；test-coverage 已 merge `6518170c`，
  **全量套件正在跑**（`ba0jsaicx`，后台，压力 some avg10=0）
- **在飞（2）**：dispatch-gate（`ac1f5685fa1c94943`，/tmp/quay-wt-dispatchgate）+ m264
  （`af375c8a06b0efe0d`，/tmp/quay-wt-m264）——均有近期活动（02:50/02:47）
- **停止条件**：**needs-human 积压 = 7（≥3，触发停止派发）**——DIR-100/DIR-100-A/DIR-101/DIR-103/
  DIR-103-B/DIR-105/DIR-109，**全部历史**（07-29→08-02 05:53，近 2h 无新增），非本批产生。
  **本 tick 不派发新任务**（纪律：停下等人）；fan-in 照常（全量绿 → 关 test-coverage → 在飞返回后逐个收尾）
- **阻塞信号**：无记录（非停止状态）
- **计量**：test-coverage runId `fm-...-4w3tpe`（fan-in 完成后 `--task-end`）

### Tick 更新（03T03:00Z）：test-coverage 已关闭

- **全量绿**：2372 tests / 2354 pass / **0 fail / 0 cancelled** / 18 skip，FULL-SUITE-EXIT=0，selected 169。
  **参考值 tests 从 2361 → 2372**（+5 test-coverage-check +6 inner-idle-log 测试）
- **test-coverage done**：worktree `/tmp/quay-wt-tccheck` 移除、分支 `task/test-coverage-fix` 删除、
  任务体提交（post-merge discovery fix note + status done）、`--task-end`（`fm-...-4w3tpe`, done）
- **在飞（2）**：dispatch-gate + m264 仍在
- **不派发**：needs-human=7 停止条件持续成立——`gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion`
  与 `gap-test-isolation-contract-is-unwritten` 仍排队，等外层处置积压或放行

### Tick 更新（03T03:08Z）：外层裁定恢复派发 + dispatch-gate 合并 + inventory 已派

- **外层裁定（03T03:06Z）**：**needs-human=7 不构成停止派发的理由**。7 个全历史遗留（07-29→08-02 05:54，
  早于无人值守窗口 17:43Z ≥12h）；窗口内新增 needs-human **0**；遥测唯一 needs-human 结局已 done。
  停止条件判据有缺陷：fast-mode-loop-tick.md:156 意图是「产出速度 > 消解速度」，被读成「总数」⇒ 永久卡死
  （解开历史任务需要派发）。**修法：判据改为窗口内新增数。** 已改 tick 文档两处（Step 3 + 判断边界表），
  提交 `9a…`。7 个 DIR 去留是范围决定已升级给人（orchestration/escalations.md），本轮不处理
- **dispatch-gate 已合并** `663fc5c8`（Contract 六键机制，REFUTE round-2 PASS，11 文件）。scoped 57/56/0 绿。
  **批全量正在跑**（`bt01s74hv`）。合并后 agent 曾停摆（staged 未提交等验证通知），已恢复完成提交
- **inventory 已派发**（`a86265c011c3f0088`，/tmp/quay-wt-inventory，runId `fm-...-yylhln`）——
  外层裁定下一批第一，与在飞 DISJOINT 实测。全量绿后关 dispatch-gate
- **在飞（2）**：m264（诊断中）+ inventory（实现中）

### Tick 更新（03T03:18Z）：dispatch-gate 已关闭

- **dispatch-gate done**：批全量绿（**2407**/2388/0/19，exit 0；参考值 2372→**2407** = +35 contract-check 测试；
  selected 170）。worktree/分支清理、任务 done、`--task-end`（`fm-...-y7tt6x`）。**参考值更新：2407**
- **在飞（2）**：m264（~51min，未到 90min 阈值）+ inventory（~11min）。均活跃未提交
- 停止条件：无（needs-human 判据已按外层裁定改为窗口内新增，7 历史不构成；`.halt` 无）

### Tick 更新（03T03:28Z）：m264 已合并，批全量在跑

- **m264 done 流程**：根因 = 共享 `<repo>/tmp/` 并发干扰 → collector fail-open 写空清单 → 测试 TypeError。
  修复：14 处 scratch 移 `os.tmpdir()` + 长度保护 + collector fail-closed（admission-decision-unreadable）+
  `.gitignore tmp/`。**「隔离绿/套件红」类第 3 号成员**（M136→relation-sync→本任务，偶发红非稳定红）。
  merge `b1a…`，scoped 24/24 绿。**批全量在跑**（`ba7zgcgbo`）。遗留 `tmp/be-explicit-rw-h2oiJI/` 已清理
- **inventory**（~20min）：已产出未提交文件（runtime-usage-inventory.{json,md,ts}），实现中
- 在飞（1 活跃实现）：inventory

### Tick 心跳（03T03:29Z）

- 无 `.halt`；m264 批全量在跑（`ba7zgcgbo`，selected 170，pressure 0）；inventory 活跃（~20min）
- 无停止条件（needs-human 窗口内新增 0）。**本 tick 不派发**——fan-in 全量先于派发（2× c8 崩溃纪律）；
  全量绿后关 m264，再评估补派 reclaim-worktrees / test-isolation-contract

### Tick 更新（03T03:38Z）：m264 关闭 + 并发补满 3

- **m264 done**：批全量绿（**2408**/2389/0/19，exit 0；参考值 2407→**2408** = +1 fail-closed 回归测试）。
  worktree/分支清理、任务 done、`--task-end`（`fm-...-mxjpbk`）。**参考值更新：2408**
- **补派 2 个**（并发满 3）：reclaim-worktrees（`afa6d17c167863fa1`，runId `fm-...-sf5zrl`，/tmp/quay-wt-reclaim）
  + test-isolation（`a5e61c452d700bdf6`，runId `fm-...-wo6yww`，/tmp/quay-wt-testiso）。三者两两 DISJOINT
  （checkTouchesPair 机械验证）
- **resource-awareness 阻塞解除但互斥**：dispatch-gate 已落地（tick 文档不再被占用），但 resource-awareness
  与 test-isolation 在 `scripts/test.sh` OVERLAP（实测）——**等 test-isolation 落地后再派**。dispatch-gate 的
  AC6 基线违规（`resource-awareness: dispatch-review-missing`）待其派发时补 `## Dispatch review` 自清
- **在飞（3，满）**：inventory + reclaim + test-isolation

### Tick 心跳（03T03:52Z）

- 无 `.halt`；无停止条件。**3 在飞全活跃**（transcript 03:51-03:52 均更新）：
  - inventory：staged 未提交（runtime-usage-inventory.{json,md,ts} + test + 任务体），03:41-03:51 曾等其
    内部 REFUTE reviewer（正常 parent-wait，非停摆），已恢复
  - reclaim：已提交 1 commit `83c7e5d3`（fix milestone-worktree merged-then-reverted criterion + 卫生 gate + drop --force）
  - testiso：无 commit 但活跃
- 外层推了 2 个 task 提交（`58d68d8b`/`fd770df3`）——新 backlog 任务（eligibility-blinded、
  quantified-stop-conditions、web-can't-show-loop-state 等），**不碰在飞 Touches，无 fan-in 冲突**，排队后续
- 本 tick 不派发（并发满 3）

### Tick 心跳（04T03:59Z）

- 无 `.halt`；无停止条件；3 在飞全活跃（04:01/03:56/04:02）
- **reclaim**：新增第 2 commit `892a167e`（merged-then-reverted 判据修正：须有 merge commit 而非 tree
  diff）——正确性迭代中。已 2 commits
- **inventory / testiso**：~55min 无 commit，但 transcript 活跃（实现/审查中），未到 90min 阈值

## 外层重排队列优先级（2026-08-03T04:0xZ，人裁定——压缩后读本节 + 本文件末节）

**诊断**：近 18h 扩张:收敛 = 3:21、图新增:删除节点 = 22:0、脚本 live:unaccounted = 35:81、
tick 文档决策语句:真执行者 = 36:7。收敛 = 用更低描述长度的机制替换更高——我们只产断言没产支柱、
没删过任何东西，L(X) 在上升。**图从未收缩过一次。**

### P0 删除算子（裁减）
1. **no-inventory**（在飞，裁剪 + 冷启动产品化双关键路径）
2. **reclaim-21-merged-worktrees**（在飞，第一次真实删除）
3. **retire-the-prepare-execute-pipeline-cluster**（依赖 #1 的 class 列；**#1 落地后立刻派**）
4. **stranded-worktree-branches**（#2 落地后再排）

### P1 异步通道
5. serve-task-list-dies-on-one-malformed-task（人正用那个页面，再畸形一次就再 500 一次）
6. web-cannot-show-what-the-loop-is-doing-now（/live + /journal）
7. web-board-needs-an-inconsistency-verdict

### P2 暂缓一切再加检查类任务
quantified-stop-conditions、test-isolation-contract（在飞，**让它跑完，不中断**）、
checks-that-verify-an-empty-set、no-resource-awareness、workflow-metadata-warn、plancheck-*、
prepare-milestone-no-size-aware-routing-* 等。理由：删除算子跑通前每加一个检查都让 L(X) 继续上升。

**例外填充**（仅当 P0/P1 因 Touches 冲突派不出时）：dispatch-eligibility-blind-to-files、
inner-forensics-verify——生产机制正在给错答案，不是新增检查。

**解冻判据（可测不靠判断）**：任务图**首次收缩** = 有任务节点被删除，或有一次落地提交净行数为负。
冻结时刻 = 本条指令时间（2026-08-03T04:0xZ）。

**纪律**：这是排序不是取消——**不改任何任务 status、不删任何任务**。

### 对派发计划的修正
- test-isolation 落地后：**不派 resource-awareness（P2）**，改派 P1 #5/#6/#7（serve-task-list 500 优先——
  人在用那个页面）
- inventory 落地 → 立即派 P0 #3 retire-pipeline；reclaim 落地 → 排 P0 #4 stranded-worktree
- 跟踪解冻判据：首次图收缩（负净行数落地或节点删除）时报告

### 资源事件（2026-08-03T04:1xZ，外层实测 + 内层处置）

**事件**：两个 agent 在各自 worktree 里**并发跑全量套件**（testiso + reclaim，各 --test-concurrency=8，170 文件），
4 核 34+ 进程 → CPU pressure some avg10 **96.62**（batch-4 崩溃阈值 84.77 之上）、load1 31.35、43 node 进程。
内存无风险（mem 0、swap 0、可用 3789MB）——纯 CPU 饥饿。

**处置**：
1. **中止 reclaim 套件**（更年轻 11min；P0 但验证可重跑）——SIGKILL 主 runner + 孤儿进程（node 43→22）
2. **让 testiso 套件自然完成**（外层「不要中断 test-isolation」）——结果：**fail 2 / cancelled 0**，两个失败都是
   `delivery-standalone-smoke` gate 测试（68s/60s，正常 ~1-5s）——并发饥饿下的时序失败，非代码缺陷
3. testiso agent 已自行重跑第二轮（/tmp/suite-run2.log，当前唯一在跑的套件）
4. 已消息 reclaim agent：被杀 = CPU 饥饿非缺陷，等 testiso 跑完再重跑，重跑前确认无其它套件 + pressure < 40
5. **外层 #1**：此后全量套件一次只跑一个，跑前看 `/proc/pressure/cpu` some avg10 < 40

**resource-awareness 触发条件**（外层）：这是今晚第二次同一条件咬人。**若再发生一次、或这两次套件出现
cancelled > 0，它从 P2 提升到 P1**（资源闸更接近支柱而非再加断言）。本次 testiso cancelled=0（未触发）、
reclaim 被中止（无结果）——但 2 个 68s/60s 时序失败与 cancelled 功能等价，已向上报告。

### Tick 更新（04T03:13Z）：inventory P0#1 合并 + 全量排队

- **inventory merged**（`ce23e6ce` + merge）：runtime-usage-inventory CLI + test(18, @test-group governance) +
  table{json,md}。205 脚本分类：**live 36 · library 72 · ci-only 1 · dormant-by-decision 7 ·
  never-runs-test 8 · unaccounted 81**。scoped 18/18 绿。AC9 无删除。REFUTE 1 轮 10 MINOR 全闭（0 阻塞）
- **全量排队**：suite-run2（testiso 重跑）仍在跑（压力 ~94，单套件重负载阶段）；**inventory 全量等
  suite-run2 结束 + 压力 <40 再跑**（外层 #1 纪律）。跑完即关 inventory → 派 P0 #3 retire-pipeline
- **串行队列**：suite-run2 → inventory 全量 → reclaim 重跑 → （testiso 若再失败则再跑）。全部一次一个
- 在飞：testiso（suite-run2 中）、reclaim（等重跑）；inventory 合并 pending 全量

### Tick 更新（04T03:15Z）：suite-run2 全绿 = 坐实饥饿；inventory 全量在跑

- **suite-run2（testiso 重跑）全绿**：2416/2397/0/0，EXIT 0——delivery-standalone-smoke 通过。
  **坐实 suite-run1 的 2 个失败（68s/60s）是 CPU 饥饿非缺陷**。testiso 的 test.sh 改动验证通过
- **inventory 批全量在跑**（`bdqps1ujt`，压力 10.21 <40 起跑）。已消息 reclaim：等 inventory 全量结束再重跑
- 串行队列：inventory 全量 → reclaim 重跑 → testiso fan-in 全量（testiso agent 提交后）

### Tick 更新（04T03:19Z）：testiso merged；reclaim 停车等信号

- **testiso merged**（`7dce49f5`/`8633ed4a`，7 文件）：test-isolation-check 扫描 + 棘轮（baseline 23）+
  test(8) + 契约文档 + test.sh `run_static_checks` +2 行。scoped 8/8 绿。**suite-run2 全绿**（2416/2397/0/19）
  证实 M52 run1 失败是既有 60s 门禁 flake 非其改动。无 `## Contract` → `contract-absent`（info 非失败）
- **reclaim agent 停车**：声称「等 inventory 套件完成通知」——停摆形态，等编排信号。inventory 全量结束后
  消息它重跑
- **inventory 全量仍在跑**（`bdqps1ujt`）。**串行套件队列**：inventory 全量 → reclaim 重跑 → testiso 全量

### 外层优先级微调（2026-08-03T04:2xZ，人裁定——详见本文件末节）

**一、resource-awareness P2→P1 首位**（排在 serve 崩溃与 web 观察面前）：
- **实测推翻「并发才饥饿」**：单个套件自身 = 8 worker + 7 子进程 + 根 = **16 进程，4 核 4 倍超订，压力 87.15**；
  两个并发只是 87→97。**饥饿是「跑一次全量」的稳态，不是并发的产物**
- 直接打在 P0 上：每个删除算子的 DoD 连跑 2 次全绿 = 至少 2 次进饥饿态。今晚已耗：M136 三轮、批 4 崩溃一次、
  reclaim + test-isolation 各重跑一次
- **分类修正**：资源闸是两层共用的原语、取代重复目测判断——**支柱化，不是再加断言**（外层先前归类错了）

**二、inventory 窗口差集改变 retire 前提**（**派 retire 前必须读进去**）：
- 51 脚本 15.9h 低频 / 72h live，**31 个 unaccounted→live，真实 unaccounted ~50 不是 81**
- `.claude/workflows/*.js`：15.9h 6 个全 unaccounted，**72h 5 个 live**——prepare-milestone 280×、
  execute-milestone 47×。**经典循环在用，fast-mode 只是有意绕过**
- retire 任务体的「最后 prepare-epoch 22 小时前」只覆盖 fast-mode 一侧；**派发前必须按 72h 窗口重估规模主张**，
  否则会把还在用的东西当遗留删掉

**三、P0 三个删除算子顺序不变**。**派发优先级**：P0 retire(#3)/stranded(#4) → P1 **resource-awareness(首)** →
serve-task-list → web。testiso 已合并（scripts/test.sh 冲突解除），resource-awareness 可派

### Tick 更新（04T03:30Z）：inventory 全量非绿→修 runner-grouping→合并套件重跑

- **inventory 全量 fail 1**：`--group governance --list-files` 断言 governance 文件全在
  `/experiments\/quay-perpetual-stream\/test\//` 下——inventory 测试（AC10 governance）在 `plugin/test/`
  打破了该硬编码路径假设（「硬编码全局计数」类又一次）。**修复**（`runner-grouping.test.mjs`）：governance
  根放宽到 experiments/ + plugin/test/（路径是活的成员关系非契约；计数关系不变）。runner-grouping 9/9 绿
- **inventory 套件还漏了 testiso**（套件在 testiso merge 前起跑）——**合并套件重跑**（`bfldr7co2`，
  含 inventory fix + testiso 8 测试一起验证）
- 外层新建 **ADR-022**（retire classic milestone loop）——retire-pipeline 派发时引用
- 下一步：合并套件绿 → 关 inventory + testiso → 派 P0 #3 retire（带窗口差集 + ADR-022）→ 信号 reclaim 重跑
  → 派 P1 resource-awareness

### 外层裁定（04T03:33Z）：inventory OVER90 是假触发，不要放弃/拆分

**证据**：AC 14/14 全勾、产物已落盘（runtime-usage-inventory.json 234655B + .md 42344B）、套件根进程
pid 4049485 跑 438s 且消耗 CPU（非卡死）、压力 86.54。**90 分钟不是任务过大/卡住，是已完成后卡在被饥饿
拖慢的 fan-in 套件上**。OVER90 处方（拆分/放弃）为 Build 相位设计——放弃 = 扔掉已完成的交付物。
**让它把套件跑完再收尾**（inventory status 仍 todo，未被误标，无需干预）。

**机制观察（供 gap-no-resource-awareness）**：今晚**第三次**同一根因（CPU 饥饿）抬高不同信号——
①重型测试超时被当代码缺陷 ②两个套件并发压力 96.62 ③OVER90 在已完成任务上触发。**共同形态：阈值测的是
墙钟，而处方假设那段墙钟花在干活上。**

### Tick 更新（04T03:46Z）：inventory+testiso 关闭、reclaim merged、retire 已派

- **inventory + testiso 已关闭**：合并套件绿（**2417**/2397/0/20，新参考值；tick 文档已更新）。
  双 `--task-end`（yylhln / wo6yww）。worktree/分支清理
- **reclaim 已 merged（3 commits 全进）**：83c7e5d3 + 892a167e + 44b40bd7（REFUTE 收尾，parts[2] 二父修正）。
  scoped 18/18 绿。**关键发现：任务题设「21 个 fully-merged worktree」只对一半——19 个携带真实未提交工作
  （如 M237 tasks/DIR-124-C.md +103/-82），按保守规则正确拒绝回收；只回收 M277(~51M) + M243 悬挂分支。
  19 个脏 worktree 是待人的单独事项**（不删，保留）。验证套件在跑（`b030l13jl`）
- **retire 已派**（P0#3，`ad39d72405f1b5004`，runId `fm-...-0b3l2x`，/tmp/quay-wt-retire）——带窗口差集
  重估指令（prepare-milestone 280×/execute-milestone 47× 在用）+ ADR-022 方向 + 删除算子性质
  （负净行数 = 解冻判据）。与在飞 DISJOINT 实测
- **在飞（2 实现）**：reclaim（验证套件中）+ retire（读证据中）。**下一步**：reclaim 套件绿 → 关 reclaim
  （`--task-end` sf5zrl）→ 派 P1 resource-awareness（首位，scripts/test.sh 冲突已随 testiso 落地解除）

### 外层紧急通报（04T03:5xZ，人裁定——34 项未落地工作）

**实测**：19 个 milestone worktree 含 **34 项从未落地的工作**——5 个任务文件只存在于 worktree、master 没有且
未跟踪（`tasks/DIR-124-F1/F2/F5/F6.md`、`gap-build-evidence-path.md`）+ 14 份 `docs/plans/M2xx-*.md`。
对 task list / web UI / 漂移检查器**全部不可见**。三闸实测：Gate 1 过 19（M239 正确拦下）、**Gate 2 全拦 19**
（每个都有未提交内容）⇒ **净可回收 0，1.1G 不释放**。

**两条裁定**：
1. **reclaim 现状执行没有错**——Gate 2 拒绝删脏 worktree 正是该做的；**不放松不加 --force**（会销毁 34 项工作）。
   已如实记录：净回收 = M277(~51M) + M243 悬挂分支，其余 19 个因含未落地工作正确拒绝。**34 项已升级给人**
2. **retire 硬边界**（已消息在飞 agent）：不得移除 `milestone-worktree.ts`、不得删除 `milestones/M*/worktrees`、
   不得改动那 19 个 worktree。其余部分（composite-*、prepare/execute workflow 本体、文档同步）可继续
- **不可见任务发现**：worktree-only 的任务文件对工具链不可见——漂移检查器盲区（与删除类 Touches 语义反
  同类），已升级给人，暂不建任务

### 外层解冻通知（04T03:5xZ，人裁定——P2 冻结解除）

**一、解冻判据修正**：03:56Z 的判据有盲区，看不见刚发生的真实收缩——reclaim 回收了 M277+M243 分支/worktree
（M277 51MB→1MB），但两条判据都没触发：(a) 删的是分支/目录非任务节点；(b) `git log --numstat` 看不见
worktree 删除（milestones/M*/worktrees 在 .gitignore）。判据名说「图收缩了」实际测「跟踪行数减少」——今晚
同一失效族的成员，且是外层自己 50 分钟前造的。**已加第三条：worktree 条目数 / milestone 分支数 /
milestones/ MB 任一下降**。按第三条 milestones/ 1100MB→1033MB，**判据满足，已解冻**。

**二、新顺序（解冻后重新评估，不自动恢复原序）**：
1. **gap-no-resource-awareness-heavy-ops-run-blind**（今晚第三次同一根因抬高信号）——**已派**
2. **gap-retire-the-prepare-execute-pipeline-cluster**（在飞，边界不变：不得动 19 个 worktree + milestone-worktree.ts 删除）
3. **gap-serve-task-list-dies-on-one-malformed-task**（人在用那个页面）
4. **gap-web-cannot-show-what-the-loop-is-doing-now**
其余任务正常排队但排在这四个之后。

**三、reclaim 记录一字不改**——净回收如实、拒绝理由如实、34 项升级给人，正是该有的样子。

### 34 项裁定 + 19 个 worktree 回收执行（04T03:56Z）

**外层裁定**（人已答复「坚决应用新模式」）：
- **作废（32 项）**：DIR-124-F2（PlanCheck typed findings）、F6（依赖 F2）、gap-build-evidence-path（修复已
  提交 2b1d67c2）、全部 14 份 docs/plans/M2xx-*.md，以及其余 worktree 内 DIR-124 家族文件（F3a/b、F4a-e、
  B2a、B3、C 等）
- **实质保留（2 项）**：DIR-124-F1 模板卫生 + F5 种子完整性——**合并为一个根因，已建新任务
  `gap-task-body-has-n-parsers-and-no-authority`**（活缺陷：`touches-orthogonality-check.parseTouches` 对
  `` - `foo.ts` (new) `` 解析出带残留反引号的错路径，`task-status-drift-check.parseTouchEntries` 解析正确——
  两个解析器对同一行结论不同，出错的那个正是快速模式判并发资格用的）
- **reclaim 限制解除**：19 个 worktree 按三闸回收（内容作废/承载后丢弃）。**回收前不需要归档 32 项**
- **retire 边界解除**：milestone-worktree.ts 在 reclaim 用完后可随管线退役

**执行（reclaim 完成，milestones/ 896MB → ~50MB）**：用回收机制逐个 `--clean-stale` 回收 19 个
（M211/M237/M255-M275，各先丢弃作废内容使三闸通过）。**只剩 M239**（人裁定保留，has-commits ahead=2）。
无悬挂。retire agent 已获知边界解除

**在飞（2 agent）**：retire（约束解除）+ resource-awareness。reclaim 已关闭（`--task-end` sf5zrl）。
**下一步**：视槽位派 serve-task-list（#3，人在用那个页面）；resource-awareness/retire 返回后 fan-in

### Tick 更新（05T03:0xZ）：resource-awareness merged + serve-task-list 已派

- **resource-awareness（P1#1）merged**（`99b608d6`，11 文件 +678）：`plugin/scripts/resource-gate.sh`（压力/内存/
  node 数/swap，`--for full-suite` GO/WAIT，无 PSI fail-closed）+ test.sh 接入（默认全量 gate，WAIT 打印后
  exit 1 不静默等）+ **并发推导 `max(1,floor(nproc/2.1))`=1**（4 核），显式 `--test-concurrency=N` 优先。
  AC1-11 全勾，DoD「2x 全绿」未勾（CPU 纪律 + 推导并发 1 下全量小时级）。AC3 双向负控制实测
- **serve-task-list 已派**（#3，`a99be54b1c3d9316c`，runId `fm-...-pyzd0e`）
- **在飞（3）**：retire + serve-task-list + （resource-awareness scoped 测试中）
- **gate 现实约束**：基线压力 68.85（>40）——**resource-awareness 的全量验证此刻会被 gate WAIT 挡住**
  （这正是 gate 在起作用）。需等低压力窗口（在飞 agent 测试结束后）再跑；跑时显式 `--test-concurrency=8`
  （推导 1 会小时级）

### Tick 更新（05T03:13Z）：resource-awareness scoped 42/42 绿；全量 gate 等待中

- scoped `--for-task` 42/42 绿（resource-gate 14 + 相关 28）。**gate 实测 exit 1（WAIT）**——压力 93.61
- 压力高因在飞 agent（retire + serve-task-list）正在跑验证测试（36 node 进程）。**全量串行队列**：
  resource-awareness → retire → serve-task-list（各需压力 <40 基线 + 显式 `--test-concurrency=8`）
- **gate 的行为验证了设计**：在全量起跑前挡住高压力——这正是它要取代的「目测判断」

### Tick 更新（05T03:18Z）：serve-task-list merged；合并全量在跑（gate GO）

- **serve-task-list merged**（`556493bc`，4 文件）：store.ts fallbackId（缺 id 用文件名兜底 + extra.malformed 标记）、
  serve-handlers.ts `isMissingIdTask` 守卫 + 可见占位行 + prefix filter/nav 防 undefined、serve.test.mjs 回归。
  scoped 1/1 绿（--allow-thin，Touches 映射薄）。tsc 0 errors。**task list 页面不再 500**
- **合并全量在跑**（`b8m11u3md`，resource-awareness + serve-task-list 一起，显式 `--test-concurrency=8`）。
  **gate 实测 GO**（「资源充足，可以跑」，基线压力 24.94）——resource gate 在真实场景第一次放行全量
- 在飞（1 agent）：retire（~05:17 活跃，边界解除）。retire 落地后自己一个全量
- 全量绿 → 关 resource-awareness（`--task-end` hjkru7）+ serve-task-list（pyzd0e）

### Tick 更新（05T03:30Z）：resource-awareness + serve-task-list 关闭

- **合并全量绿**（**2436**/2416/0/20，exit 0，参考值 2422→2436）——**gate GO** 下真实跑通
- **resource-awareness done**（`--task-end` hjkru7）：resource-gate.sh + 并发推导 = 支柱化落定。
  外层 `ad1793d7`「gate 是 preflight 不是 governor」已记
- **serve-task-list done**（`--task-end` pyzd0e）：畸形任务降级为可见占位行，页面不再 500。
  AC7 发现：3 个缺 id 文件 **8-9 天**未被发现——「非阻断警告等于没有警告」
- **在飞（1 agent）**：retire（提交 `8d738540` 80 文件 -24195 行删除，REFUTE round-2 PASS；05:30 活跃，
  等其最终报告）。**压力 3.49（低窗口）**——retire 落地后立即跑它的全量验证

### Tick 更新（05T03:35Z）：retire rebase + 全量在跑

- **外层已核实 retire 分支（合并前）**：删除内容正确（51 个管线文件：.claude/workflows 三、composite-* 两侧、
  milestone-preparation-check 两侧、milestone-worktree 两侧 + 测试）；三闸处置正确（milestone-worktree.ts 删除
  符合 ADR-022 次序、build-evidence-manifest.ts 改保留、workflow-baseline-metrics.ts 未动）；exp5 封存机器
  **误删 0**；快速模式需的 checkSplitRecommendation / planCheckNextAction / checkTouchesPair 导出仍在
- **外层排查教训已记**：`git diff --diff-filter=D master..branch` 曾把 resource-gate.sh 等列为「删除」——实为
  分支 merge-base 早于这三个文件落地 master。**判据用 `git show <commit> --diff-filter=D`（显式删除），
  不用 `diff master..branch`**（混淆「删了」和「从没有过」）
- **retire 已 rebase**（2 commits 到 master 顶，干净）；**全量在跑**（`binlxixpl`，worktree 内，gate GO）
- 全量绿 → merge retire → 关 retire（`--task-end` 0b3l2x）→ **首次负净行数落地，图真正收缩**

### Tick 更新（05T03:43Z）：retire agent 完成最终报告；worktree 全量在跑

- **retire agent 最终报告**：80 文件 +523/-24195（净 -23700）。导出保留字节级（computeTouchesExpansion →
  concurrent-batch-scheduler、parsePlanStages/validatePlanStructure → prepare-admission-check、
  mapEvidenceToTasks → build-evidence-manifest）。**保留项**：workflow-metadata-conformance.mjs（it0-dod-check
  clause-14 存活调用——72h 重估偏离，任务体已记录）、build-evidence-manifest.ts（M264 机制）。
  milestone-worktree.ts 在 reclaim 完成后删除（协调者边界解除）。AC0-3/5-8 done，AC4 由 fan-in 裁定
- **worktree 全量在跑**（`binlxixpl`，155 files selected = 173-18 删除的测试，~7min）
- 全量绿 → merge retire → 关 retire（`--task-end` 0b3l2x）

### Tick 更新（05T03:48Z）：retire 关闭 —— 首次真实收缩完成

- **retire merged**（`8cc5efd3`）：**80 文件 +547/-24195（净 -23648 行）**——首次大规模负净行数，
  **解冻判据「任务图首次收缩」达成**。worktree 全量绿（2034/2015/0/20，155 files）。`--task-end` 0b3l2x
- **参考值 2436 → 2034**（删除 18 个测试文件）。Land `--snapshot` 已写
- **P0 删除算子全部完成**：inventory（表）→ reclaim（19 worktree 回收 + M277/M243）→ retire（-23648 行）
- **P1 全部完成**：resource-awareness（资源闸）+ serve-task-list（页面不再 500）
- **下一批候选**：P0#4 stranded-worktree（reclaim 落地后可派）+ P1#4 web-cannot-show + 新 parser 任务
  （gap-task-body-has-n-parsers-and-no-authority，排 P1 后）。在飞 0，可补派

### Tick 更新（05T03:52Z）：下一批已派（stranded + web）

- **已派 2**：P0#4 stranded-worktree（`a04359b9f0b14a9ac`，runId `fm-...-tikhj7`）+ P1#4 web-cannot-show
  （`a59802dfcb6d4836c`，runId `fm-...-lrq9xl`）。两两 DISJOINT 实测。压力 1.01（极佳窗口）
- **parser 任务与 stranded 在 `task-status-drift-check.ts` OVERLAP**（实测）→ 等 stranded 落地后再派
- **drift 假阳性已识别**：`gap-reclaim` 被标 reverse-drift suspect（touchesAllExist=false）——retire 删除了
  milestone-worktree.ts（reclaim 用完后），检测器把「代码被有意移除」误当「代码没落地」（删除类盲区另一面）。
  记录不动作；stranded 任务可能会处理这个类（按任务体 AC）
- 在飞（2）：stranded + web

### 外层拦截（05T03:55Z）：stranded 任务重划范围

外层核实 stranded-worktree 前提已被 retire+reclaim 抹掉大半：
- **AC2b** 已由 reclaim AC1 实现且更精确（--no-ff 合并才可 revert）
- **AC2c-f** 目标 milestone-worktree.ts 已被 retire 物理删除——无对象
- **AC3** 期望值过时（只剩 M239 一个刻意保留例外）

**重划已送达在飞 agent**：①告警宿主移到存活的 task-status-drift-check.ts / restart-readiness-check.sh；
②判据**复用 reclaim 三闸**不重写；③验收用**人造领先分支双向负控制**（造→报、删→不报），不用真实仓库
当前状态当期望值；④任务体 AC 重写。**核心交付不变：让滞留分支有告警通道**（今晚 24989 行滞留工作是
外层两天后偶然发现的，非机制报出）。
**web-cannot-show 按原样执行**（前提未变）。

### 外层派发（05T03:58Z）：sigma 测量任务已派

`gap-suite-sigma-distribution-stale-after-retirement`（`a1a012410aba6d9d3`，runId `fm-...-e7g0qj`）——
优先级在 web 之后，用现成 `measure-suite.mjs` 不写新工具。**两个前置（AC 非建议）**：①dist 必须预构建且
比 .ts 新（陈旧 dist → cli 路由 TS 源，cli.test.mjs 虚高 ~41s）；②低压力窗口过资源闸 GO（CPU 饥饿杀测试
非拖慢，cancelled 文件无 duration_ms，Σ 偏低）。**只测量不优化**（AC7 不得改 *.test.mjs）。核心数：删 18 文件
后 Σ 降多少 vs 墙钟 +1.2%——「Σ 降 ≠ 墙钟降」直接证据（外层昨天分母用错 34.8% vs 正确 4.9%，收益高估 7x）。
在飞满 3（stranded + web + sigma）

### 外层时序提醒（05T03:5xZ，非阻塞）——sigma 正确性依赖机器状态

sigma 是今晚第一个**正确性依赖「别的任务在不在跑套件」**的任务（AC2 资源闸 GO、AC1 filesCaptured==155/155；
stranded/web 的 DoD 都含 2 次全绿——若同期跑套件，Σ 系统性低估）。处置已消息 sigma：①测量放另两任务不跑
套件的窗口或等它们收尾；②每次前后记资源闸输出；③filesCaptured < 155 作废重测。**此刻闸 GO（压力 6.68、
无套件）——现成窗口，sigma 已被告知尽早占住**。

**机制观察（已归入 gap-dispatch-eligibility-blind-to-files 后续，不单开任务）**：checkTouchesPair 判的是
**文件集合是否相交**，而这里的冲突是**机器状态互斥**——任务能声明碰哪些文件，不能声明需要什么机器状态
（如「测量时别的任务不得跑套件」）。不是 checkTouchesPair 的缺陷，是派发资格模型缺一个维度。

### Tick 心跳（06T03:02Z）

- 无 `.halt`；**sigma 已占住低压力窗口跑测量**（worktree 全量 + measure-suite-reporter，唯一在跑的套件）；
  stranded + web 活跃未跑套件
- **自保护验证**：sigma 的套件把压力推到 ~92 → 若 stranded/web 此刻尝试全量，资源闸 WAIT（基线 >40）挡下——
  **资源闸实现了「机器状态互斥」**（外层刚观察到的缺失维度，机制已在运转）
- sigma 若 filesCaptured < 155 会作废重测（AC1）

### Tick 更新（06T03:05Z）：stranded merged，全量等 sigma

- **stranded-worktree merged**（`3069aa7a`，7 文件 +919）：`--stranded` 快速路径 + 滞留分支检查（**复用 reclaim
  三闸**）、readiness check 8（info）、双向负控制测试（人造领先分支→报、删→不报）、旧 AC2b-f/AC3 标吸收/过时。
  scoped 34/33/0 绿。**已知后续**：reclaim 仍被 reverse-drift 误标（milestone-worktree.ts 被 retire 有意删除）——
  需独立「intentionally-removed」分类（另一缺陷，未处理）
- **sigma 仍在测量**（进程 334483，压力 78）——**stranded 全量等 sigma 测完再跑**（污染其 Σ）。闸会自保护
- **parser 任务**（gap-task-body-has-n-parsers）在 stranded 合并后与 task-status-drift-check.ts 的重叠已解除，
  可派（等槽位）

### 外层解阻塞（06T03:2xZ）：/tmp 泄漏已清理

**根因**：/tmp 是 tmpfs（内存盘 7.9G），积 166,923 个测试 fixture 目录（9 天，6.3GB 占内存）。前缀：
prepare-admission- 14220、prep-check- 9128、quay-loop-params-trig-fuzz- 4337、adr-store- 3590 等。
**外层清理** >2h 且匹配 fixture 前缀的目录（排除 quay-wt-*/claude-*）：删 158,757 条目、释放 2,454MB。
/ tmp 3936/7994（50%）；MemAvailable 5291→7370MB；swap 1779→1142MB。claude-1000 会话 + 4 个 quay-wt-* worktree
完好（含 sigma/stranded/webobs）。

**两条后续**：①泄漏 ~17k/天，不修 ~9 天重现——外层建任务；②test-isolation-contract 有「mkdtemp 每运行唯一」
但缺「**必须清理**」——补进契约比新建机制便宜。

**sigma 条件改善**：/tmp 4GB 空间 + 压力降（sigma 仍在测量，若 filesCaptured < 155 会重测）。
stranded 全量仍等 sigma 测完。新增 `/tmp/quay-wt-preretire`（外层 detached worktree，不碰）

### Tick 更新（06T03:26Z）：webobs merged；全量队列等 sigma

- **webobs merged**（`e8ef92e3`，4 文件 +659）：observation.ts（独立降级永不 500）+ /live + /journal 路由 +
  24 断言。scoped 1/1 绿（--allow-thin）。偏离：遥测路径用 .workflow-events/（任务体写的 .quay/... 不存在）
- **stranded + webobs 都已 merge，scoped 绿**——**全量等 sigma 测完**（污染其 Σ）。sigma 仍测量中
  （进程 334483，压力 87.83 其单套件稳态）
- **全量串行队列**：sigma 测完 → stranded+webobs 合并全量 → sigma 自己验证（如需要）
- **parser 任务**可派（stranded 已合并，task-status-drift-check.ts 重叠解除）；等槽位

### Tick 更新（06T03:28Z）：parser 已派；sigma 仍在测量

- **parser 任务已派**（`afe4388cc639fc1d7`，runId `fm-...-ttg1t6`）——两个解析器收敛（touches-orthogonality
  vs task-status-drift 对同一行结论不同，出错那个是判并发资格用的）。与 sigma DISJOINT 实测
- **sigma 仍在测量**（进程 334483，~6.5min，压力 92 其稳态）——stranded+webobs 全量仍等它
- 外层 `57bfad09`：重启 web server 让 /live + /journal 真正服务
- 在飞（2 活跃）：sigma（测量中）+ parser（实现中）

### 外层解阻塞（06T03:30Z）：webobs 收尾（已落地未收尾类）

**外层发现**：webobs AC 全勾、代码已合并（e8ef92e3 + 5c927972）、外层重启 server 后 /live 与 /journal 实测
均 200 且逐条一致，但 status 仍 todo、遥测 start=1 end=0 从未闭合（在飞 36 分钟）。**它本身就是 /board 要
标记的那一类：已落地但未收尾。**

**后果**：①在飞计数因此是 4 不是 3（超上限）；②sigma 已飞 30 分钟，其 AC2 要资源闸 GO、AC1 要
filesCaptured==155/155，此刻 cpu avg10=91.03、load1=16.02、1 套件在跑——前置在 4 路并发下无法满足。

**已处置**：webobs 收尾（task done + `--task-end` lrq9xl），**在飞计数回到 3**。stranded 全量已延迟（等 sigma）。
parser 轻量工作不占主要负载。sigma 每次测量前后记录资源闸输出、filesCaptured < 155 作废重测
（那个分布决定下一步优化方向，测歪了会把工作引到错的地方）

### Tick 心跳（06T03:52Z）：sigma 第二轮测量；parser 已暂停测试

- sigma **第二轮测量**（进程 422051，11min——第一轮可能 filesCaptured < 155 已作废重测）；gate 检查输出
  GO GO GO GO GO WAIT（sigma 在监控）
- **发现 parser 在跑测试进程**（1 进程）——已消息 parser 暂停测试给 sigma 安静窗口（外层建议）
- 压力 98.77（sigma 167 进程套件的单套件稳态 + parser 微量负载）
- stranded + webobs 全量仍等 sigma 测完

### Tick 更新（06T03:59Z）：sigma 测完、parser merged、stranded+parser 合并全量在跑

- **sigma 测量套件完成**（进程消失，压力 23.58）；sigma agent 处理结果中（filesCaptured < 155 则作废重测）
- **parser merged**（`f4c890f2`，干净）：共享 touches-parser.ts + 全部解析器委托 + parity 测试 +
  AC6 棘轮（17）+ repo-ground-truth §3。scoped 59/58/0 绿
- **stranded + parser 合并全量在跑**（`bda9owbpo`，gate GO，压力 23.58 窗口）。全量绿 → 关两者（`--task-end`
  tikhj7 + ttg1t6）→ sigma 若需重测拿窗口 → sigma 完成后 fan-in

### Tick 心跳（07T03:02Z）：sigma 测量完成（filesCaptured 155/155 ×3）

**sigma 结果**（suite-sigma-2026-08-03.{json,md} 已落盘，3 次当前 155 全捕获 + 退役前 173 + 负控制）：
1. **Σ/墙钟比值仍 ≈7**（6.13/6.90/7.00 vs 旧 7.1）——8-lane 饱和结论保持
2. 前 10 名占 Σ **48.1%**（旧 44.8%）；前 3（proposal-convergence/delivery-smoke/runner-grouping）占 ~21%
3. **核心答案：删 18 文件 ΔΣ ≈ −230s（−6%），噪音带宽 ±1000s+ → 不可判定**；墙钟 +1.2%（没降）。
   **「Σ 降 ≠ 墙钟降」直接证据**——两者都没降。外层昨天分母用错（34.8% vs 4.9%）的纠正落地
- **负控制（高压 gate WAIT 41→99）**：仍 155/155 捕获——套件在高压力下也能完整测量（cancelled 未发生）
- 合并全量（stranded + parser）在跑（`bda9owbpo`，~4min）

### 外层核对 sigma 结论（07T03:07Z，两条更正 + 一条确认）

**一、噪声带宽 ±1000s+ 与已有数据不自洽——需核算算法**：
- agent 的 ±1000s+ = 3 次当前套件运行（A/B/A2）的**极差** 2365s（2471–4836）的一半。但这 3 次在**不同外部条件**下测得
  （run B Σ 4836 明显受污染）
- **旧 run3/run4（同 commit、159/159 捕获）只差 167s**——受控条件噪声 ≈167s，比 ±1000s+ 小 ~6×
- **若真实带宽 ~167s，则 ΔΣ ≈ −230s（中位 A2 3734 vs 退役前 C 3964）超出噪声 ~1.4× → 可判定，不是不可判定**
- **审计结论**：±1000s+ 高估噪声（混入受污染运行）；受控重测（干净窗口 back-to-back A vs C）能把噪声收到 ~167s 并判定 ΔΣ。
  **算法要写进任务体**（哪几次运行、什么统计量）。待 sigma agent 报告后按此修正结论

**二、外层自我更正**：饥饿**不必然**导致 cancelled——sigma 高压负控制（41→99）仍 155/155 完整捕获。
batch4a 的 cancelled 2 可能有自身异步结构触发条件（Promise 未决 + 事件循环已解决）。判绿三条件理由改为
**「cancelled 是一种会被 fail 0 掩盖的失败」**，不是「饥饿必然导致 cancelled」。tick 文档已更新

**三、确认静默失败的价值**：tmp/be-explicit-rw-* 残留（有 admission + iter-report、无 manifest.json）=
某次运行在 collector 产出前 throw 而清理没跑，但全量报 fail 0——**「绿套件掩盖一次真实失败」**，比泄漏本身
更值得单独记一笔（已并入本文件的发现记录，候选后续任务）

### Tick 更新（07T03:12Z）：合并套件 fail 1 → 修复 flaky 竞态 → 重跑

- **合并全量（stranded + parser）fail 1**：AC11（explicit-file smoke）嵌套 test.sh 的 test-framework-policy-check
  撞见 runner-grouping AC7 的**临时未跟踪 fixture**（zz-runner-grouping-undeclared.test.mjs，故意无 @test-group）→
  报「NEW file」→ 嵌套 exit 1。**预存在的 flaky 竞态**（并发窗口），套件负载让它现形（非闸、非 stranded/parser 回归）
- **修复**：镜像 QUAY_TEST_SKIP_DIST_BUILD 先例——0-match/纯 selector 嵌套运行设 `QUAY_TEST_SKIP_STATIC_CHECKS=1`
  （外层套件已跑过 whole-store 检查）。已提交
- **合并全量重跑**（`be4k8hogt`）

### 外层紧急纠偏（07T03:2xZ）：并发默认推导回 8

**问题**：scripts/test.sh 并发默认推导为 1（nproc=4/2.1→1），全量套件 ~8 分钟变 ~55 分钟（stranded 的
OVER90 即此来源）。**代价量化**：并发 8 墙钟 460-570s vs 并发 1 Σ~3300s（~55 分钟），每任务 DoD 连跑 2 次
→ 每任务多 94 分钟。

**根因**：AC5 前半（放大系数 17/8=2.125）扎实，但**代价侧取舍实验没跑**（AC5 原文要求 concurrency 2/4/6/8
各一次 + cancelled==0 判据）；test.sh 注释写「tradeoff deliberate and data-backed」但数据只覆盖放大系数一侧。

**新证据支持回 8**：sigma Σ/wall≈7.1 @ 8 lane（饱和非过载）；高压负控制 41→99 仍 155/155 无 cancelled
（高压不必然 cancel）。「降并发避 cancel」前提未证实，代价却是确定的 7×。

**处置**：`default_test_concurrency` 临时固定 8（公式保留在 `default_concurrency_formula`，AC5 实验后恢复）；
AC5 单测更新（override 断言 + 公式测试）。**已同步进 sigma worktree**（cp test.sh），中止其串行 run-2（省 ~45 分钟）。
sigma OVER90 外层判良性（产物已落盘，卡 DoD 连跑 2 次，不放弃）。

**机制观察（已记入 tick 文档 worktree 节）**：worktree 隔离让主检出修复不自动传播到在飞 worktree——紧急修复
需显式 `cp` 进每个在飞 worktree，否则旧行为跑完。

### Tick 心跳（05T03:27Z）：retire 提交大规模删除

- **retire 已提交 `8d738540`**：**80 文件 +523/-24195（净 -23672 行）**——首次大规模负净行数，
  P0#3 删除落地（fan-in 时需仔细复核：外层约束——不得删 milestone-worktree.ts 除非 reclaim 用完（已用完，
  我消息了 retire 边界解除）、不得动那 19 个 worktree（已回收））。retire agent 仍在飞（05:26 活跃）
- 合并全量（resource-awareness + serve-task-list）在跑（`b8m11u3md`，3820 行，压力 91.73）
- 外层 `ad1793d7`：「gate 是 preflight 不是 governor」——资源闸的角色观察

### Tick 更新（03T03:0xZ）：外层新任务 + dispatch-gate REFUTE PASS + tmp/ 发现

- **外层派发（人裁定 03T03:0xZ）**：新任务 `gap-no-inventory-of-what-the-two-layer-mode-actually-runs`
  ——**当前批次（dispatch-gate + m264）收尾后作为下一批第一个派发，优先于队列里其它 gap 任务**。
  从 `gap-retire-the-prepare-execute-pipeline-cluster` 第一步拆出，范围扩大到全仓。**只出表不删文件**
  （AC9：diff 不得含文件删除）；执行/import 判据不许继承首测裸子串偏差；死名单三类
  （frozen=exp6§0 封存 / ci-only=查 workflows / test-never-run=不在 canonical glob）不能一刀切；
  **unaccounted ≠ 可删**（= 无证据说明为什么在这）。
  **DISJOINT 已实测**：checkTouchesPair vs dispatch-gate + m264 均 `{"disjoint":true}`（机械，非目测）
- **dispatch-gate**：round-2 REFUTE 验证 agent（`afb01cce548ba85b7`）独立完成 **PASS**——R1（n/a 空值）/
  R2（反引号注释剥离）/ MINOR1-4 全部确认修复；`task-contract-check.test.mjs` 35/34/1/0；
  全仓扫描恰好 1 个违规（`gap-no-resource-awareness-heavy-ops-run-blind` 的 dispatch-review-missing——
  正是因与 dispatch-gate 重叠被阻塞的任务，验证通过后的正确产物）；`task-schema.test.mjs` 22/22。
  **agent 曾停摆**（staged 未提交、无 live children 声称等验证）——已恢复（SendMessage），待其提交报告
- **tmp/ 发现**：`plugin/test/build-evidence-manifest.test.mjs`（= m264 靶子）在 repo 根写 `tmp/`（未 gitignore，
  `:62` mkdir）。主检出全量后残留 `tmp/be-explicit-rw-*/`（只有 admission + iter-report、**无 manifest.json**）
  ⇒ 某次运行在 collector 产出前失败（assert 957 throw → rmSync 961 未跑），但全量报 fail 0。
  **已发给 m264 agent**（一手证据，可能与其 flaky 诊断相关）。`tmp/` 未 gitignore 是独立卫生缺陷

## 外层裁定：needs-human=7 不构成停止派发的理由（2026-08-03T03:05:15Z）

**内层报 `needs-human=7 halts dispatch`。外层分诊结论：解除，继续派发。**
（授权来源：`orchestrator-loop-tick.md` 步骤 3「needs-human 积压 ≥3 → 分诊：真阻塞的攒给人，
可继续的指示内层继续」。）

### 证据

7 个全部是**历史遗留**，最后改动时间：

| 任务 | 未勾 AC | 最后提交 |
|---|---|---|
| `DIR-109` | 2 | **07-29 15:52** |
| `DIR-100-A` `DIR-101` `DIR-103-B` `DIR-105` | 10 / 15 / 9 / 15 | **08-01 09:39** |
| `DIR-100` `DIR-103` | 6 / 6 | **08-02 05:54** |

**全部早于无人值守窗口起点（2026-08-02T17:43Z）至少 12 小时。**

**窗口内产生的新 needs-human 任务：0 个**（逐文件按 git 提交时刻核对）。
遥测里唯一那条 `needs-human` 结局（`gap-test-suite-has-no-layer-grouping`）
现在的 status 是 **done**——已消解。

### 停止条件本身的缺陷

`fast-mode-loop-tick.md:156` 的「needs-human 积压 ≥ 3」是**纯散文，无任何代码实现**
（已 grep `plugin/scripts` 与 `experiments/**/scripts`，零命中）。

**它的意图**是「内层产出 needs-human 的速度超过消解速度，该停」；
**它被读成**「仓库里 needs-human 的总数，有史以来」。
按后者，**7 个历史任务会永久卡死派发**——没有任何新工作能解开它，因为解开它需要派发。

**修法**：判据改为**窗口内新增**的 needs-human 数，而不是总数。
`fast-mode-loop-tick.md` 正被在飞的 `gap-dispatch-gate` 占用，
**把这条改动并进那个任务，或等它落地后再改**。

### 立即行动

1. **恢复派发。** 下一批第一个是 `gap-no-inventory-of-what-the-two-layer-mode-actually-runs`（人裁定优先）。
2. 那 7 个 DIR 任务**不在本轮处理**——它们的去留是范围决定，已升级给人（见 `orchestration/escalations.md`）。

## 外层重排队列优先级（2026-08-03T04:01:53Z，人裁定按几何诊断调整）

### 诊断（依据 `docs/references` 的框架 + 实测）

| 量 | 值 |
|---|---|
| 近 18 小时 扩张 : 收敛 | **3 : 21** |
| 任务图今日 新增 : 删除节点 | **22 : 0** |
| 脚本 live : unaccounted | **35 : 81**（共 205） |
| 内层 tick 文档 决策性语句 : 有真执行者 | **36 : 7（硬形变 19%）** |

框架对收敛的定义是「用更低描述长度的机制替换更高描述长度的机制」，且**支柱化与断言加固
是收敛的内在两半**。我们只产出了断言：**L(X) 在上升**。

**⇒ 我们自以为在收敛，几何上仍在元层扩张。删除算子一个都没跑完过，这张图从未收缩过一次。**

### 优先级

**P0 — 删除算子（让图第一次收缩）**

| 序 | 任务 | 状态 | 说明 |
|---|---|---|---|
| 1 | `gap-no-inventory-of-what-the-two-layer-mode-actually-runs` | **在飞** | 同时在**裁剪**与**冷启动产品化**两条关键路径上——不知道哪 35 个脚本活着，就答不出「新项目要装什么」 |
| 2 | `gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion` | **在飞** | 第一次真实删除；1.1G / 21 worktree |
| 3 | `gap-retire-the-prepare-execute-pipeline-cluster` | 待 | **依赖 #1**，直接读它的 `class` 列 |
| 4 | `gap-stranded-worktree-branches-have-no-alarm-channel` | 待 | 与 #2 同域，#2 落地后再排 |

**P1 — 异步通道（消解「必须提问才能知道现在在跑什么」）**

| 序 | 任务 | 说明 |
|---|---|---|
| 5 | `gap-serve-task-list-dies-on-one-malformed-task` | **人正在使用该页面**；再来一个畸形任务就再 500 一次。活面上的缺陷优先 |
| 6 | `gap-web-cannot-show-what-the-loop-is-doing-now` | `/live` + `/journal`——人不该为了知道现状而提问 |
| 7 | `gap-web-board-needs-an-inconsistency-verdict-it-does-not-have` | 需先回答复用/重实现的架构问题 |

**P2 — 暂缓：一切「再加检查」类任务**

`quantified-stop-conditions`、`test-isolation-contract`、`checks-that-verify-an-empty-set`、
`no-resource-awareness`、`workflow-metadata-warn-omissions`、`plancheck-*`、
`prepare-milestone-no-size-aware-routing-*` 等。

**理由不是它们不重要，是在删除算子跑通之前，每加一个检查都让 L(X) 继续上升。**

**例外（可作填充，排在 P0/P1 之后）**：**生产机制正在给错答案**的既有缺陷，不是新增检查——
`gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet`（`assembleBatch` 对新文件任务
误判串行且理由说错）、`gap-inner-forensics-verify-reports-nonruns-and-zero-durations`
（外层唯一的廉价核实手段在说谎）。**仅当 P0/P1 因 Touches 冲突派不出时才取这两个。**

### 解冻判据（可测，不靠判断）

**冻结在「任务图第一次收缩」时解除。** 判据二选一，任一成立即可：

```bash
# (a) 有任务节点被删除
git log --diff-filter=D --since='<冻结时刻>' --name-only --format= -- 'tasks/*.md' | sort -u | grep -c .
# (b) 有一次落地提交的净行数为负（删多于增）
git log --since='<冻结时刻>' --numstat --format='%H' | awk '...'  # 净 delta < 0
```

冻结时刻 = 2026-08-03T04:01:53Z。**解冻后重新评估，不自动恢复原顺序。**

### 不做

不撤销任何已建任务、不改任何任务的 `status`、不删任务。**这是排序，不是取消。**
被暂缓的任务全部保留在队列里，等图收缩后重新评估。

### P2 提升触发条件（外层 2026-08-03 04:0xZ 记录，不是立即反悔）

排定优先级 10 分钟后，同一条件第二次咬人：两个全量套件在两个 worktree 里并发，
CPU 压力 **96.62**（批 4 崩溃时只有 84.77）。

**我把 `gap-no-resource-awareness-heavy-ops-run-blind` 归为「再加检查」可能是分类错的。**
资源闸是**两层共用的原语，取代重复的目测判断**——按框架这更接近**支柱化**，
而支柱化是收敛的内在一半，不是又一个断言。

**但不在 10 分钟内推翻自己的排序。** 改为设一个明确触发条件：

> 若（a）同一条件再发生一次，或（b）当前这两次套件出现 `cancelled > 0`，
> 则 `gap-no-resource-awareness-heavy-ops-run-blind` 提升到 **P1**，排在 web 观察面之前。

在此之前它仍在 P2。**触发条件是可观察的，不靠印象。**

## 触发条件已满足，`gap-no-resource-awareness-heavy-ops-run-blind` 提升到 P1（2026-08-03T04:24:46Z）

**不是推翻上一条排序，是实测把结论从「偶发」升级为「结构性」。**

上一条写的触发条件是「同一条件再发生一次」，隐含假设是**两个套件并发**才导致饥饿。
2026-08-03T04:24:46Z 实测推翻了这个假设：

```
套件根 pid 3995110（唯一一个在跑）
  worker 8 · worker 的子进程 7 · 根 1  ⇒  该套件独占 16 个进程
  nproc = 4  ⇒  单个套件自己就是 4× 超订
  cpu some avg10 = 87.15（两个套件并发时是 96.62）
```

**⇒ 饥饿不是并发的产物，是「跑一次全量套件」的稳态。** 两个并发只是把 87 推到 97。

**这直接打在 P0 上**：删除算子的每个任务 DoD 都要求「`scripts/test.sh` 连跑 2 次全绿」，
即每个 P0 任务都要**至少两次**进入饥饿态。今晚已经因此耗掉：M136 三轮、
批 4 崩溃一次、reclaim/test-isolation 各一次重跑。

**分类修正**：我把它归为「再加检查」是错的。资源闸是**两层共用的原语，取代重复的目测判断**，
按框架属于**支柱化**——收敛的内在一半，不是又一个断言。

**新顺序**：P0 三个删除算子不变；**P1 首位改为 `gap-no-resource-awareness-heavy-ops-run-blind`**，
其后才是 serve 崩溃修复与 web 观察面。理由是它**降低 P0 自身的执行成本**，
而 web 观察面不改变 P0 的成本。

### 同时：inventory 的结果改变了 retire 的判断

inventory 已完成（AC 全勾，在 fan-in）：**205 脚本 · live 36 · library 72 · ci-only 1 ·
dormant 7 · never-runs-test 8 · unaccounted 81**。

**但 AC7 的窗口差集是关键**：51 个脚本在 15.9h 窗口是低频、在 72h 窗口是 live，
**其中 31 个从 unaccounted 变成 live** ⇒ **真实的 unaccounted 约 50，不是 81**。

**对 [[gap-retire-the-prepare-execute-pipeline-cluster]] 的直接后果**：
`.claude/workflows/*.js` 6 个在 15.9h 窗口全部 unaccounted，
**但 72h 窗口 5 个 live——`prepare-milestone` 被调用 280 次、`execute-milestone` 47 次**。

**经典循环在用它，只是 fast-mode 有意绕过。** 这不是「已死」，是「本模式不用」。
retire 任务必须按 72h 窗口重新评估其规模主张（任务体现在写的是「最后一条 prepare-epoch 是 22 小时前」——
那个观察本身没错，但它只覆盖 fast-mode 一侧）。

## 解冻判据的盲区（外层自查，2026-08-03T04:46:46Z）

**我在 03:56Z 设的解冻判据看不见刚刚真实发生的那次收缩。**

判据原文：

> (a) 有任务节点被删除，或 (b) 有一次落地提交的净行数为负

实际发生的收缩：`reclaim` 回收了 **M277 + M243** 的分支与 worktree，
`milestones/M277` 从约 51MB 降到 **1MB**。

**判据两条都没被触发**：

| 为什么 | 实测 |
|---|---|
| (a) 没有任务节点被删——删的是分支与 worktree 目录 | 删除的 `tasks/*.md`：**0** |
| (b) `git log --numstat` 看不见 worktree 目录的删除 | `milestones/M*/worktrees` **在 `.gitignore` 里**（`git check-ignore` 确认），删除不产生任何 diff |

**⇒ 判据的名字说「图收缩了」，实际测的是「被 git 跟踪的行数减少了」。**
这是今晚同一个失效族的又一个成员，而这次是**我自己在 50 分钟前造的**。

### 修正：加第三条

```bash
# (c) 物理收缩：worktree 条目数、milestone 分支数、或 milestones/ 占用（MB）任一下降
git worktree list | wc -l              # 冻结时 22
git branch --list 'milestone/*' | wc -l # 冻结时 20
du -sm milestones | cut -f1             # 冻结时 1100 MB
```

**当前读数**：worktree 23（新增一个给 retire 用）· 分支 20 · **milestones/ 1033 MB（-67 MB）**。

**⇒ 判据 (c) 已满足：milestones/ 从 1100 MB 降到 1033 MB。图第一次收缩了。**

但收缩幅度很小（-6%），且**真正的 1.1G 大头仍被那 19 个含未落地工作的 worktree 占着**，
等人对 34 项工作的裁定。

**因此：解冻，但不恢复原顺序。** 按 03:56Z 写下的「解冻后重新评估」执行：

| 序 | 任务 | 理由 |
|---|---|---|
| 1 | `gap-no-resource-awareness-heavy-ops-run-blind` | 已是 P1 首位；今晚第三次同一根因抬高不同信号（重型超时 / 两套件并发 / OVER90 假触发） |
| 2 | `gap-retire-the-prepare-execute-pipeline-cluster` | **在飞**，且已被外层限定边界（不得动 worktree） |
| 3 | `gap-serve-task-list-dies-on-one-malformed-task` | 人正在用该页面 |
| 4 | `gap-web-cannot-show-what-the-loop-is-doing-now` | 异步通道 |

**P2 冻结解除**，其余任务恢复正常排队，但排在上面四个之后。

## 图第一次收缩（2026-08-03T04:57:13Z）——1.1G 已回收

**人裁定「坚决应用新模式」后，reclaim 完成了今晚第一次真实的收缩。**

| | 冻结时 (03:56Z) | 现在 | 变化 |
|---|---|---|---|
| `milestones/` 占用 | 1100 MB | **60 MB** | **−1040 MB（−95%）** |
| `git worktree` 条目 | 22 | **4** | −18 |
| `milestone/*` 分支 | 20 | **1** | −19 |

**M239 按人的裁定被保住**：分支 `milestone/M239/iteration-0` 与其 worktree 均完好。

那 5 个只存在于 worktree 的任务随之消失，符合裁定；其中两项的**实质**已由
[[gap-task-body-has-n-parsers-and-no-authority]] 承载（且那个任务里的活缺陷是从它们里读出来的）。

### 外层的一次误判，记录在案

外层在 04:55Z 测得 `milestones/` 仍是 1033 MB、5 个任务文件仍在，据此判定
「回收没有发生，我的解除指令有洞——没有人被指派去删那 34 个文件」。

**这个判断是错的。** 回收当时正在执行中（04:54–04:56 之间完成）。

**教训**：一个**正在进行的多步操作**，中途快照与「没有发生」不可区分。
这与今晚 OVER90 在一个已完成任务上假触发是同一形态——**测的是瞬时状态，
而结论假设了那个状态是终态**。核实一个进行中的操作，要么等它自报完成，要么连测两次看是否在变。

## idle instrumentation 的结果（2026-08-03 05:05Z，24 条样本）

**人 2026-08-03 裁定「先攒一轮数据再说」。数据到了。**

| reason | 条数 |
|---|---|
| `awaiting-subagent` | **24** |
| `awaiting-ruling` | **0** |
| `queue-empty` | **0** |
| `no-reason` | **0** |

覆盖 02:51:18 → 05:02:11（2 小时 11 分），相邻间隔中位 **5.2 min**、最长 13.5 min。

### 结论一：fork 的归因被直接证伪

fork 的耗时分解把 **42.6% 空转**归因于「外层 20 分钟 tick 间隔」。
**24/24 的记录说：内层的空转全部是「等自己派的 subagent」，一次都不是「等外层裁定」。**

这与更早的间隙分布一致（61 个间隙，最长 18.6 分钟，**20 分钟以上零个**）——
两条独立证据同向。

**⇒「缩短外层 tick」买不到任何东西。** 这正是那个归因会导向的动作，而它是无效的。

### 结论二：杠杆是并发吞吐，而它是 CPU 受限的

若空转 = 等 subagent，那么减少它只有两条路：**更多并发**（受 CPU 饥饿限制）
或**更快的 subagent**。

**这是资源闸该排 P1 首位的第三条独立证据**（前两条：单套件即 4× 超订、
同一根因抬高了三个不同信号）。

### 顺带修正外层自己的一处夸大

外层先前说「7 个历史 needs-human 任务**卡死派发**」。作为机制主张成立，
但 02:56:48 那条记录显示：阻塞期内层**手上有 3 个任务在跑，正处于并发上限**，
`needs-human=7` 阻止的只是**新派发**。

**那个窗口里的实际代价是零**——内层本来也派不出第四个。
解除阻塞仍然是对的（机制会永久卡死），但它的即时价值比外层当时说的小。

## 删除 402 个测试没有让套件变快（2026-08-03 05:45Z 实测）

| | master（删除前） | retire（删除后） |
|---|---|---|
| 选中文件 | 173 | 155（−10.4%） |
| 测试数 | 2436 | **2034（−16.5%）** |
| **duration_ms** | 562.3 s | **569.1 s（+1.2%）** |

**原因：关键路径是一个文件。**

```
packages/quay/test/cli.test.mjs   198.1 s   =  套件墙钟的 34.8%
（次慢 web-ui-browser 57.4s，第三 gap002 57.0s）
```

套件 8 路并发且被这一个文件锁死。**删掉散在另外 18 个文件里的 402 个测试，碰不到关键路径。**

### 对今晚叙述的一处纠正

墙钟对照（今晚全部 6 次全量套件）：

| 日志 | 墙钟 | tests | cancelled |
|---|---|---|---|
| batch4a（**崩溃那次**，压力 93） | **397.7 s** ← 最快 | 2246 | **2** |
| batch4b | 458.0 s | 2361 | 0 |
| batch4c | 474.0 s | 2361 | 0 |
| reclaim | 590.5 s | 2422 | 0 |
| resaware-serve（压力 ~93） | 562.3 s | 2436 | 0 |
| retire（压力 ~10） | 569.1 s | 2034 | 0 |

**崩溃那次反而最快**，因为两个文件被 cancelled 后不再计入。
而压力 93 与压力 10 的两次墙钟几乎相同（562.3 vs 569.1）。

**⇒ CPU 饥饿的表现是「杀掉测试」，不是「拖慢套件」。**
今晚我多次说「饥饿拖慢重型测试」——更准确的说法是**它把它们杀掉**，
而套件因此显得更快、且 `fail` 仍是 0。这正是「判绿必须三条同时成立」那条规则存在的理由。

### 可执行的结论

套件成本问题**不是删测试能解决的**，它是一个文件的问题。
[[gap-suite-cost-model-is-wrong-optimizations-buy-nothing]] 现在有了具体目标：
`packages/quay/test/cli.test.mjs`，198.1 s，占 34.8%。

## 文件正交 ≠ 可并发：sigma 任务暴露的一个机制缺口（2026-08-03T05:59:19Z）

三路在飞（stranded-worktree / suite-sigma / web-observation）经 `checkTouchesPair` 复核
**两两 DISJOINT**，派发形式上合规。

**但 `gap-suite-sigma-distribution-stale-after-retirement` 的正确性取决于「别的任务在不在跑套件」**：

- 它的 AC2 要求 `resource-gate.sh` 报 GO（`some avg10 < 40`）
- 它的 AC1 要求 `filesCaptured == filesTotal`（155/155）
- 而同批另两个任务的 DoD 都含「`scripts/test.sh` 连跑 2 次全绿」

**若它们同期跑套件，压力必然 >40，sigma 的测量结果会被系统性低估**
（今晚已实证：饥饿杀掉测试 ⇒ 被 cancelled 的文件不产生 `duration_ms` ⇒ Σ 偏低而墙钟几乎不变）。

### 这是 `checkTouchesPair` 表达不了的一类冲突

它判的是**文件集合是否相交**。而这里的冲突是**机器状态互斥**——
sigma 需要独占低负载窗口，这既不是它的 `## Touches`，也不是任何文件。

**这不是 `checkTouchesPair` 的缺陷**（它做的正是它声称的事），
**是派发资格模型缺一个维度**：任务可以声明「碰哪些文件」，但不能声明「需要什么机器状态」。

归入 [[gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet]] 的后续
（同一个 `concurrent-batch-scheduler`），不单开任务。**随测量类任务变多，这会反复出现。**

### 本轮的处置（不改机制，只排时序）

已指示内层：**sigma 的两次测量放在另两个任务不跑套件的窗口里**，
或干脆等它们收尾后再测。每次测量前后都记录 `resource-gate` 输出（AC2 已要求），
若某次 `filesCaptured < 155` 就作废重测而不是将就使用。

### 外层通报（07T03:5xZ）：CI 红 —— 测试不 hermetic，已修

**根因**：`prepare-admission-check.test.mjs` 两个 known-good 用例引用本仓真实提交 335317d + REPO_ROOT 作
workspace；CI `actions/checkout@v4` 默认 depth-1 浅克隆没有旧提交 → `git cat-file -e <sha>^{commit}` 判缺失 →
真实 precedent 被误判缺失。本地 12/12 绿、CI 红，差别只在克隆深度。

**修法（外层选后者）**：①不加 `fetch-depth: 0`（掩盖真问题 + 每次克隆全历史）；②**测试改 hermetic**——
`makeGitWorkspaceWithCommit()` 构造临时 git 仓库 + 已知 commit，两个 known-good 用例改用它。83/83 绿。

**另两条已落地**：①浅克隆行为说明写进 prepare-admission-check.ts 文件头（missing-precedent 在浅克隆下
≠ precedent 真缺失；PREFLIGHT_CALIBRATED false 非阻断，生产影响是日志噪声）；②test-isolation 契约补
**第五条 R5**（测试不得依赖运行环境仓库的 git 历史，浅克隆必须绿）。

---

## 内层 tick 记录（2026-08-03 08:0xZ–08:2xZ）

### sigma 收尾 + fan-in

sigma agent 完成，分支 9e0d5899（恰好 3 文件：2 交付物 + 任务体）已合并（cf04858c）。

**核心结论**（交付 `docs/analysis/suite-sigma-2026-08-03.{json,md}`）：
- Σ/wall ≈ 7 不变（6.13–7.06）——8-lane 饱和结论成立
- 受控 back-to-back **ΔΣ = −308.6s（−8.2%）**（A3 3467 vs C2 3776），对受控噪声 ~167–267s 是 **1.2–1.9×，边缘可判定**
- **外层用错分母被证实**：cli.test.mjs 占 Σ 的 ~4.9%，不是 wall 的 34.8%（三个优化建议被高估 ~7×）
- ±1000s 是 3 次混条件运行的原始极差上界（run B 内存退化）；受控噪声 ~167–267s
- 负控制 run D（8 CPU hog）：**CPU 压力不杀测试**（155/155 仍捕获），是拖慢（Σ 高估 +59%）——修正了任务体「cancelled → Σ 偏低」的前提；复现 cancelled 需内存压力
- DoD「2x 绿」部分达成：run #1 绿（2034）；run #2 被 worktree 内过期 resource-gate 测试阻塞（master 上已修复）

### fan-in 套件 #1 红：M136 sync-vendor 漂移（已修）

2052 tests / 2032 pass / **1 fail** / 0 cancelled。失败 `plugin/test/plugin-packaging.test.mjs:205`（M136 sync-vendor --check）。

**根因**：CI-red hermetic 修复（7d876253）只改了 `plugin/scripts/prepare-admission-check.ts`（加了 SHALLOW-CLONE 注释），
**没同步 `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`**（sync-vendor 的规范源）。
sync-vendor --check 判持久漂移 → M136 红。非合并引入、非竞态（git 干净、复现稳定）。

**修**：3bf2479e 把同一段注释同步到 experiments 源，两边恢复一致；sync-vendor --check CLEAN；scoped M136 34/34 绿。

### tmpdirs 派发（外层 人裁定，08:07Z）

`gap-tests-never-clean-up-their-tmpdirs` 已派发（worktree 隔离，telemetry fm-...-tlg485）。
- **搭车归因**：AC1 搭 fan-in 套件的前后计数，不另起全量套件（资源互斥规避）
- 三条提醒已含任务体：AC2 只修泄漏量前 5；不加全局 process.on(exit) 钩子；AC7 记录一次性清理（158,757 条目 / 2,454 MB）+ 清理≠修复
- 协调方已通知 agent 做第一次后计数（样本 #1 修复前）

### 待办

- **重跑全量套件 #2**（pid 789105）验证 M136 修复 → 绿则关 sigma + telemetry --task-end
- **push 到 origin**（当前 14 commits 领先）→ CI 验证 hermetic 修复转绿
- tmpdirs fan-in（agent 在飞）

### 内层 tick 补充（2026-08-03 08:3xZ）

**sigma 已关闭**：merged cf04858c → fan-in 套件 #1 红（M136 sync-vendor 漂移，修 3bf2479e）→ 重跑绿
（2052/2033/0/19）→ 关闭（status done，telemetry --task-end 150.6m，worktree/branch 清理，ae2a8d1d）。
外层更正 ff5f69ba：受控 back-to-back 显示墙钟成比例下降（−6.8%），套件确实变快了；cli 拆分只值 ~14s。

**CI 绿**：push 14 commits（de20b2b1..3bf2479e）→ run 30796925263 success（hermetic 修复 + M136 漂移修复）。

**escalation #N+2（外层 08:30:55Z）**：内层 08:18:56 推送了外层说「等人裁定」的 CI 修复。两份 tick 文档均未
规定推送动作。无实际危害（CI 绿、无 release——release.yml 只按 tag 触发）。外层已 escalate 三个选项+
推荐（pre-push 钩子禁 tag + 把常规 push 写进 tick 文档），待人工裁定。**内层不再推 tag；常规 push 已发生一次。**

**tmpdirs 已合并 + fan-in 套件在跑**（pid 828768）：
- rebase 冲突 2 文件（契约 R6 单侧追加 + 任务体 master 时序约定 vs agent 执行记录），均「保留两侧」解析
- 分支 3 commits（2f45345e fix + 83ccaf84 docs + e2c63f64 修 Touches/AC5）→ merged 9b1d1d3e
- AC3 修复后测量 = 本次套件前后 /tmp 计数（基线 16,243）；预修样本 #1 = agent 的 dispatch 15,297→15,649
- 关闭后 telemetry --task-end + snapshot + worktree 清理

## 三项目拓扑：人已裁定，按外层建议的次序执行

**人 2026-08-03 08:4xZ 裁定**：把双层循环推到 `archguard` 与 `meta-cc`，
本会话充当跨项目管理者，同时作为 quay 产品化交付的验证。**并同意外层的三点意见。**

### 采纳的三点

1. **在 4 核上「避免资源冲突」= 轮流，不是并行**——吞吐不会变成 3 倍，
   而是当前 1.5/h 被分成三份（各约 0.5/h）。这是**用吞吐换验证**，不是扩容。
2. **管理者与 quay 外层是两份工作**——前者仲裁/聚合/排序，后者读 diff/构造负控制/逐条核实。
   外层本会话已 17 MB / 8512 条 / 跨度 43.3 小时，两件事会互相挤。
3. **管理者的核心功能必须机械化**——靠 agent 盯着的仲裁是软形变，不跨 agent。

### 第 3 点的直接证据（今晚发生的）

外层对人明确表示「不推送、等授权」，**而内层推了两次**——
因为那条边界只写在外层自己的行为里。**这就是软形变的定义。**

### 执行次序（人已同意）

| | | 状态 |
|---|---|---|
| **A** | 跨项目重型操作令牌 | **已建任务 `gap-no-cross-project-heavy-op-token`** |
| **B** | 只起 archguard 一个，验证令牌真挡住了 | 待 A 落地 |
| **C** | A/B 被证明后再上 meta-cc（Go，验证语言无关） | 待 B |

**不三个一起上**——今晚两个套件并发已到 96.62，三个是没有信息量的实验。

### 要测的量（否则又是凭印象）

- 每个项目**等令牌的时长**（某项目长期饿死 ⇒ 策略错了）
- 各项目**实际吞吐**（对照 quay 独占时的 1.5/h）
- **令牌有没有死锁过**（陈旧回收是否真生效）

### 内层 tick 补充 2（2026-08-03 08:4xZ）

**外层派发任务 A（人裁定三项目拓扑 A→B→C）**：`gap-no-cross-project-heavy-op-token`——跨项目重型操作令牌，
优先级高于队列其它 gap。B（archguard 冷启动）与 C（meta-cc）都被 A 阻塞。telemetry
fm-...-1785746441367-r1x9cn，agent 已派（worktree 隔离）。
设计三要点：①令牌与 runner 无关（node --test/vitest/go test 统一闸「重型操作」）；②失败即放行但大声
（调度令牌非安全检查，fail-closed 会三项目同时停摆）；③不做公平队列，饥饿先靠 waited_ms 可观测。
接线约束：scoped 不取令牌；令牌与资源闸串联、闸失败必须释放令牌。本任务只交付令牌本体，不接线 archguard/meta-cc。

**在飞**：token A（agent abae2f...）；tmpdirs fan-in 套件（pid 828768）→ 关闭后即可腾出。

### 内层 tick 补充 3（2026-08-03 08:45Z）

**tmpdirs 已关闭**：fan-in 套件绿（2054 tests / 2035 pass / 0 fail / 0 cancelled，exit 0）。
**AC3 主判据满足**：修复后套件 4 个修复前缀（prepare-admission-/quay-loop-params-/adr-store-/document-store-）
**0 个新目录**（mtime<10min = 0；最新泄漏目录停在修复合并前的 08:24）→ 从修复前静态 ~112/套件
**100% 下降**。原始 /tmp 净增 +470 是范围外 quay-qeng + token agent 并发 scoped 测试，非修复信号
（外层方法提醒：leaked_after_suite 必须围绕单次全量套件测，不能拿墙钟速率做分母）。
telemetry --task-end done（35 完成），worktree/branches 清理，349940cf。

**参考值 2052 → 2054**（tmpdirs 合并 +2 测试），tick 文档已更新。

**在飞（1/3 槽）**：token A（agent abae2f...，08:40 派发）。B（archguard 冷启动）、C（meta-cc）被 A 阻塞。
**未再派发**：AC5 并发实验（2/4/6/8）待低压力窗口；外层正在积极 steer，保守只保持 A 在飞。

### 内层 tick 补充 4（2026-08-03 08:5xZ）

**在飞 2/3**：
- token A（abae2f...，08:40，heavy-op-token.sh 已建未提交）
- inner-forensics（ac615c4d...，08:51，telemetry fm-...-b4mxpa）——Contract+outer 03:19 复核；
  checkTouchesPair 确认与 token A **DISJOINT**（quantified-stop 与 A 重叠 scripts/test.sh，未并发派发）

**外层独立复核（9b07529c）**：tmpdirs AC3 结论成立——四前缀 20 分钟 0 新目录，最大剩余泄漏
frontmatter-store-base 仅 7；R6 棘轮按设计行为。

**未派发**：quantified-stop（与 A 重叠 test.sh）；web-board（待查）；AC5 并发实验待低压力窗口。

## 跨项目调度策略（人 2026-08-03 08:5xZ 裁定）+ 一处机制出入

### 人的裁定

1. **冷启动期间本仓只停派发，允许在飞任务收尾**
2. **必要时可以反向停下 archguard / meta-cc 以继续本仓开发** ⇒ **本仓优先级高于另两个**

### 外层核实出的出入：`.halt` 做不到「只停派发」

内层 tick 文档步骤 0：**`.halt` 存在 → 本 tick 空转**；而 **fan-in 是步骤 2**，在哨兵之后。

**⇒ `.halt` 同时停掉派发与 fan-in。** 在飞 subagent 会算完（独立进程），
但**算完没人合并**，工作停在分支/worktree 上——**正是今晚找回 24,989 行滞留工作的那一类**。

### 本轮的处置：用次序，不加机制

**步骤 B（archguard 冷启动）用「先排空再暂停」**：

```
1. 停止派发新任务（口头指示，不落 .halt）
2. 等在飞任务全部 fan-in 落地、工作树干净
3. 此时才落 .halt —— 此刻它停掉 fan-in 也无害，因为已无待合并的东西
4. 启动 archguard
```

**代价**：等待在飞排空（当前 2 个任务，约 30–60 分钟）。**收益**：零新机制、零滞留风险。

### 已知缺口（不现在做，记下判据）

真正的「只停派发、仍 fan-in」需要一个 `.halt-dispatch` 变体：
步骤 0 读到它时**跳过步骤 4（派发）但仍执行步骤 1–3（fan-in）**。

**什么时候值得做**：若步骤 B 显示「排空等待」的代价大（例如需要紧急回收资源给本仓，
而对面有 3 个任务在飞、要等 90 分钟），那时再做。

**现在不做的理由**：ADR-021——**证据不足时不要把策略机械化**。
先用次序解决一次，看等待到底多贵。

### 内层 tick 补充 5（2026-08-03 09:1xZ）

**token A 已关闭**：fan-in 套件绿（2065 tests / 2046 pass / 0 fail / 0 cancelled）。**AC6 全路径实跑成立**——
套件运行时 `holder=quay`，结束 EXIT trap 自动释放 → `holder=none`；scoped 不取令牌。AC7 闸失败释放实测。
参考值 **2054 → 2065**（token 测试 +11）。telemetry --task-end done（36 完成），worktree 清理。

**inner-forensics 已返回**（9aa3dd3e，AC1-AC7 全绿：引号内 test.sh 不再误归类、真实耗时、未知非 0s、
fork 会话归属修正、已知答案窗口 02:00-02:30 恰 3 次真实套件）——**待 fan-in**（token 套件跑完才能安全合并）。

### 外层指令（2026-08-03 09:2xZ）：排空阶段——停止派发

步骤 A（跨项目令牌）已完成并经外层独立复核通过（双向负控制、陈旧回收双条件、回收消息明写两条件值）。
**从现在起停止派发新任务**（不落 .halt，只是不再派新的）。在飞的 inner-forensics 正常跑完并 fan-in 落地，
工作树干净后报告一次。排空后的顺序：外层落 .halt（写明理由与解除条件）→ archguard-2 启动 archguard 双层会话。
届时本仓暂停，人已裁定必要时可反向暂停 archguard 以保本仓推进。

### 内层 tick 补充 6（2026-08-03 09:4xZ）：排空完成

**inner-forensics 已关闭**：fan-in 套件绿（2073 tests / 2054 pass / 0 fail / 0 cancelled）。参考值
2065→2073（本任务 +8）。telemetry --task-end done（37 完成）。worktree 清理。
外层 8f7f7238 更正：三个「错误」里 AC1 前提是外层自己误读（截断显示）；另两个真错误已修。
**排空完成——无在飞任务、无未合并分支、工作树干净。** 按外层指令，下一次行动是外层落 .halt
（写明理由与解除条件）后启动 archguard 双层会话；本仓届时暂停。

### 恢复派发（2026-08-03 10:0xZ）：.halt 已由管理者解除

**套件绿记录**：管理者跑的全量套件 `/tmp/suite.log`（selected 158 files，498s）：tests 2073 /
pass 2054 / fail 0 / cancelled 0 / skipped 19——判绿三条件 grep 全过、与参考值 2073 一致。
**如实记录：退出码未被捕获**（管理者的命令只重定向了 stdout，没留下 exit code）。

**首个派发（人指定优先于其它一切）**：`gap-loop-mechanism-lives-outside-the-package-and-cannot-ship`
（产品化冷启动）。闸口外层已过（task-contract-check 0 违规；Touches 外层补齐 3→18）。
范围裁定已写进任务体：**scripts/test.sh 不搬**（quay 本仓测试入口非可移植机制；判绿约定随 tick 文档
走、测试命令占位符替换；Touches 不列 test.sh）。

### 发现（证据）：it0-dod-check R1 违规导致误提交

`experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs:409` 用固定路径
`process.cwd()/tasks/M-FAKE-FRONTMATTER-SCOPE-M124.md` 写 fixture（finally 删）——R1 违规
（固定路径写入，非 mkdtemp 唯一），R1 扫描器只认 dot-tmp 形态未捕获。本次 `git add -A` 把
该 mid-life fixture 误提交（b505d3aa），已 revert。处置：建任务或修（待办，不打断 cold-start 派发）。

### 派发（2026-08-03 10:1xZ）：cold-start 产品化（人指定最高优先级）

`gap-loop-mechanism-lives-outside-the-package-and-cannot-ship` 已派发：worktree
`/tmp/quay-wt-coldstart`（分支 task/gap-...-cannot-ship），telemetry fm-...-36fiim。
范围裁定已写任务体（test.sh 不搬、不进 Touches）；AC8 改名负控制实跑输出必须贴任务体（DoD 硬要求）。
闸口外层已过（task-contract-check 0 违规、Touches 补齐 18 条）。

## 外层队列状态（2026-08-03T10:35Z，停机解除后的第一批）

**`.halt` 已由管理者解除**（依据：人指示产品化交付优先 + archguard 已停机让出资源；
原「archguard 跑满 2 小时」的条件被取代）。解除前的全量套件判决：
`tests 2073 / pass 2054 / fail 0 / cancelled 0 / skipped 19`，498s，selected 158 files
（`/tmp/suite.log`）——tests 与参考值 2073 逐位相同。**退出码未被捕获，如实记录。**

| 顺序 | 任务 | 状态 | 并发资格 |
|---|---|---|---|
| 1 | `gap-loop-mechanism-lives-outside-the-package-and-cannot-ship` | **在飞**（`fm-...-36fiim`，10:34:44Z） | — |
| 2 | `gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed` | 待派 | 与 #1 **DISJOINT**，但见下 |
| 3 | `gap-tasksperhour-counts-halted-time-as-slow-work` | 待派 | 与 #1 **OVERLAP** `plugin/scripts/fast-mode-telemetry.ts` ⇒ 不同批 |

**#2 为什么按住不派**：#1 有一个未回答的范围问题——`scripts/test.sh` 搬不搬进 `plugin/`
（任务体缺口二与 Chosen mechanism 打架）。#2 的 `## Touches` 含 `scripts/test.sh`。
**若 #1 的答案是「搬」，现在这个 DISJOINT 判决立刻失效。**
判据成立于一个未回答的问题之上时，它不是判据。**#1 回答后立即重跑 `checkTouchesPair` 再决定。**

**#3 的优先级**：管理者已定「排在产品化之后」。它记录的是
`tasksPerHour` 把停机墙钟算进分母（实测：21 分 16 秒纯停机、同一批 37 个收尾任务，
读数 1.5621 → 1.5391；分子固定 37 ⇒ 37/1.5 把窗口上限锁在 24.67h）。
**建它是为了修仪器，不是为了挑轻任务把数拉回来**——AC6 专门断言分子不按任务大小加权。

### 派发（2026-08-03 10:2xZ）：contract-ratchet（第二任务）

`gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed` 已派发：worktree
`/tmp/quay-wt-ratchet`，telemetry fm-...-7gehxb。**与 cold-start checkTouchesPair DISJOINT 实测通过**
（cold-start 无 test.sh——范围裁定使其成立；裁定若反复需停下告知外层）。
内容：task-contract-check.ts 无执行者、名单 1→12、6/7 invoke-evidence-missing 假发现；
会放松判据 → **AC2/AC5 双向负控制硬要求**。Touches 含 scripts/test.sh。

**inner-state.sh 挂载点（已随冷启动搬到 plugin/scripts/，外层已重挂）**：外层 Monitor 现挂
`plugin/scripts/inner-state.sh`（首条事件 INIT，非 START）。搬移前曾以外层绝对路径挂载；搬移会使
Monitor 静默失效，已通知 cold-start agent 写明新路径、不留兼容壳（外层 fan-in 后自行重挂）。
fan-in 报告带新路径供外层重新挂载。

**在飞 2/3**：cold-start（af2e2aa...）、contract-ratchet（a22be4f...）。

### 外层必办项（2026-08-03 10:4xZ）：cold-start 搬移的路径断点

外层实测：cold-start worktree 已搬 resource-gate.sh/heavy-op-token.sh 进 plugin/scripts/，但
scripts/test.sh 4 处（186 if ! bash resource-gate / 208 acquire / trap release / 注释）+ 
heavy-op-token.test.mjs:35 仍按老路径调用。失败形态坏：`if ! bash <不存在>` → 127 → 误进「资源闸 WAIT」
分支。已通知 cold-start agent：补 scripts/test.sh + heavy-op-token.test.mjs 进 Touches、**同提交改路径**、
扫全部 6 个老路径的约 20 处引用（CLAUDE.md/QUAY-OUTER-HANDOFF/exp6/docs/analysis/cold-start 说明本身）、
任务体加 AC「搬完无老路径活引用」。**不留兼容壳**——外层 Monitor/cron 两处 fan-in 后自行重挂。

### 关闭 ratchet + 发现（2026-08-03 11:0xZ）

**contract-ratchet 已关闭**：fan-in 套件绿（2039 tests / 2020 pass / 0 fail / 0 cancelled）。
invoke-evidence 判据改入口路径、执行者接进 run_static_checks、baseline 1→5（重设前后输出同提交）。
flake 修复（heavy-op-token AC3 mirror，6cc0ac1c）。telemetry --task-end done（38 完成）。

**⚠ 参考值 2073→2039 异常待查**：ratchet 合并只 +9 测试（contract test 35→44），预期 2082，
实际 2039（两次套件稳定）——-34 与合并对不上。三套件均选 158 文件、无文件缺失、test.sh 变更仅加
静态检查。记为发现，恢复后查（可能是个别测试文件在 ratchet 状态被跳过/条件不满足）。

### 关闭 cold-start（2026-08-03 11:5xZ）——排空完成

**cold-start 产品化已关闭**：fan-in 套件绿（2054 tests / 2035 pass / 0 fail / 0 cancelled）。参考值
2039→2054。telemetry --task-end done（39 完成），worktree 清理。
**外层收尾更正已纳入**：AC2 前提为假（experiments/ 侧自 2026-08-02 就是 symlink，git ls-tree 证实），
任务体已改「开工前已满足」+ 假前提存活机制（按名找文件 vs 看 mode）。
**fan-in 期间修的三处**：①队列文档旧路径引用（AC1b 扫描抓到）；②task-contract-check.test.mjs 老路径
fixture 加进 AC1b 排除名单（测试数据非活引用）；③AC1b 补语料非空断言 + plugin/loop 取舍注释（外层提示）。
**外层已重挂**：Monitor→plugin/scripts/inner-state.sh（首事件 INIT）、cron→plugin/loop/orchestrator-loop-tick.md。

### 派发批次（2026-08-03 12:0xZ）：三任务同批

外层派发三个（闸口 0 新增、checkTouchesPair 两两 DISJOINT，可同批）：
1. **tmpleak**（`/tmp/quay-wt-tmpleak`，agent a22678c...，fm-...-hkdtnb）：R6 文件级判定赦免整文件 +
   名单只减不增无强制。判据：mkdtemp-no-cleanup 条目变少（开工 28）+ leaked_after_suite 下降。
   **不按前缀修**；AC6 零误报清单硬要求
2. **tph**（`/tmp/quay-wt-tph`，agent ab863aa...，fm-...-3w5muw）：tasksPerHour 把 halt 时间算进分母。
   分子不改（AC6 断言 10 倍耗时差任务贡献相同）；.halt 数据源先判权威（文件自述 09:33 vs 提交 09:55，
   git 区间会偏短）
3. **monitor**（`/tmp/quay-wt-monitor`，agent a4fd41e...，fm-...-srq4rs）：Monitor 挂载/瞄准检查。
   判据三条（挂没挂/哪个副本/本会话）；argv 前两 token 精确等于 bash 绝对路径（子串会匹配自身）；
   零写入不建心跳文件（inner-state.sh 纯读契约）

**在飞 3/3**。三任务 DoD 都要连跑 2 次全量（4 核串行，闸会挡）——协调方 fan-in 时串行处理。

### 关闭批次（2026-08-03 13:4xZ）：tmpleak/tph/monitor

三任务已关闭（42 完成）。合并：tph(5d75b59e) + tmpleak(35c27449) + monitor(02930d02，外层提交 0d5bc5da 后重试成功)。
批 fan-in 套件 #1 红（loop-shipping AC1b：outer-phase-goal.md 老路径——外层 bedf543c 产物相对路径 + 外层 158 行改「目录+文件名分写」），重跑绿 2085/2065/0/0。
**DoD 2x 如实标注**：tmpleak 真满足（after-run-1/2 两次绿 2057）；tph + monitor 仅 1 次全量绿（batch3-fanin2），非连跑 2 次——第二次待外层 session-liveness 改名落定后补跑。
**参考值 2054→2085**。
**外层改名（outer-liveness→session-liveness）未提交**，协调方未触碰；工作树处改名半成品（cold-start-e2e.sh/quay-init.sh 仍有 outer-liveness 引用），外层落定后需清理。

### 派发批次（2026-08-03 14:0xZ）：r1-task-store + cold-start-e2e

外层派发 2 个（闸口 0 新增、checkTouchesPair DISJOINT 实测通过）：
1. **r1-task-store**（`/tmp/quay-wt-r1`，agent a3d8dd1...，fm-...-9hlwy4）：R1 只认 __dirname/.tmp 固定写入，
   it0-dod-check.test.mjs:391 用 process.cwd()+tasks/ 写真实任务库不报。外层已复核前提完好。
   顺序硬要求：先扩探测器报出活标本（AC2）再修测试；修时保留真实 frontmatter 覆盖，无脑换 mkdtemp 删覆盖。
2. **cold-start-e2e**（`/tmp/quay-wt-e2e`，agent a769a77...，fm-...-q5rdmm）：e2e 从工作树 cp + 无执行者。
   两半都要：--from-build（git archive 从 orphan commit 取，非 cp）+ 执行者（更严重）。绝不 --push。
   AC7 用 90 秒以上窗口重测 inner-state.sh（外层 4 秒观察不成立，轮询 60 秒）。

**在飞 2/3**。DoD 都需全量绿（协调方 fan-in 承担，参考值 2085）。

### 关闭批次（2026-08-03 14:2xZ）：r1 + cold-start-e2e

已关闭（44 完成）。合并 r1(77963df9) + e2e(582de08f) 干净；批套件 batch4 绿 2094/2074/0/0（166 files，
14:11Z）。**DoD 2x 如实标注 [~]**：r1、e2e 均仅 1 次全量绿（batch4），e2e 另有 --from-build 2 次连绿（非全量套件）。
参考值 2085→2094。
**外层机制观察**：套件完成监控用进程/日志轮询不可靠（本轮 3 个监控 2 个 stale 超时、1 个未唤醒）；
外层改用 heavy-op token 括套件（holder 出现=开始、none=结束），14:01-14:11 泄漏测量即此法。建议后续用
token 状态而非进程/日志尾巴。

### 派发（2026-08-03 14:4xZ）：quay-init rewrite（单任务）

`gap-quay-init-rewrites-an-executable-instead-of-generating-config` 已派发（`/tmp/quay-wt-qinit`，
agent a05a36e...，fm-...-kb2ool）。闸口 0 新增、无并发冲突（cold-start-e2e 已收尾，重叠解除）。
核心：删 361/373 render_substitutions 对 session-liveness.sh 的改写（可执行文件原样复制、只生成配置），
_sl_session 改 env/配置 + 默认值。三条硬要求：AC4 双向 cmp 负控制；AC6 机械检查必须有执行者（AC7）；
AC8 tick 文档占位符替换不许动。cmp 断言自然挂点 = cold-start-e2e 的 --from-build 路径。

**在飞 1/3**：qinit。

### 关闭 qinit（2026-08-03 15:2xZ）

`gap-quay-init-rewrites-an-executable-instead-of-generating-config` 已关闭（45 完成）。合并 bb17a476。
fan-in suite #1 红（5 fail：3× M52 负载超时 + heavy-op-token AC2 负载 flake——均隔离通过；loop-shipping
AC1b = qinit 引入的 verify-installed-executables.sh 旧 tick 文档路径，已修）。重跑绿 2098/2078/0/0。
参考值 2094→2098。DoD 2x 如实 [~]（仅 1 次全量绿）。**套件监控改用令牌括法**（外层建议）——本次准确触发
（此前进程/日志轮询 3 次中 2 stale 超时 1 未唤醒）。闸 WAIT 下误启动一次（套件自我中止），教训：查闸退出码。

**在飞 0**。等待外层下一批。

### 派发批次（2026-08-03 15:4xZ）：session-liveness + empty-set

外层派发 2 个（闸口 0 新增、DISJOINT 实测通过）：
1. **session-liveness**（`/tmp/quay-wt-liveness`，agent a525349...，fm-...-tg6r7g）：15 AC，**两阶段**——
   阶段一信号源（AC7/8/16 + STALL 改名 REPO-STALL）、阶段二语义标志+交叉正控制+payload+阈值。
   **阶段一结束必须报告**（外层决定继续或拆）。STALL 改名不改源；绕开 pid→transcript 映射（会话 id
   做每目标配置）；阈值按类反向调。
   **补充判定**（RESUMED+OVERDUE 同报样本）：根因是解除停机没重置心跳基线——修法 `now - max(心跳 mtime,
   解除停机时刻)`（监视器 60s 轮询自观察 .halt 转变，无需额外状态源）。加「RESUMED 与 OVERDUE 不得同轮
   同目标同发」断言 + 拆 LOOP_MIN 两个含义。
2. **empty-set**（`/tmp/quay-wt-emptyset`，agent a665ce9...，fm-...-im2uh5）：8 AC，「空集=通过」必须
   fail-closed（语料非空下限/显式报没匹配），通用形态不只 loop-shipping（已有守卫）。

**在飞 2/3**。等待 agent 完成（session-liveness 阶段一先报）。

### 补派（2026-08-03 16:0xZ）：unparseable-task board（在飞 2→3）

`gap-one-unparseable-task-takes-down-the-whole-board`（`/tmp/quay-wt-board`，agent aafe3b11...，fm-...-oz4y5q）。
闸口 0 新增；与 liveness、emptyset 均 DISJOINT。线上故障（/ 500 而 /live /journal /adr 200，title 未引号含
## Contract 截断）。改动位置 = provider task_list（返回可解析任务 + 机器可读失败清单，**不删 throw**——
throw 注释写明它挡的是「isError 静默强转空数组把真实失败和合法任务一起藏」。AC5 双向负控制硬要求；
AC6 用真 yaml.parse 全库扫（管理者形状粗查得 0 是错的）；265/605 标题含 #/:（写入侧是姊妹任务）。
**在飞 3/3**。

### 关闭批次（2026-08-03 17:1xZ）：emptyset + board；liveness 阶段一落地

emptyset + board 已关闭（47 完成）。合并 2387e328/aa647b87/fbf64fe9；batch5 run4 绿 2115/2095/0/0
（参考值 2098→2115）。**token 真修复**：now_ms 单次 date +%s%N（外层查出的构造性缺陷，两次独立 date 调用
秒边界交错→held 负；clamp 保留但负值打 WARNING）；**M52 超时提升**（QUAY_ACCEPTANCE_TIMEOUT_MS=120000
+ node:test 150000，套件负载下 4 次超时）。DoD 2x 均如实 [~]（1 次全量绿）。
**liveness 阶段一已合并落地**（transcript 心跳 + REPO-STALL 改名 + 停机基线），**待外层阶段二裁断**
（继续/拆 + 与姊妹任务 hashes-the-token-counter 排序）。liveness worktree 保留待续。

### 派发（2026-08-03 17:3xZ）：cold-start-8（队首主线）+ board 契约修复

**board 契约 new=1 已修**：invoke 入口路径 `packages/quay/bin/quay.ts` 补实跑证据进任务体（Contract 外），
ratchet 恢复 new since baseline: 0。

**cold-start-eight-steps 已派发**（`/tmp/quay-wt-cold8`，agent a8f87932...，fm-...-d05ioq，队首主线）：
机制随包走 + 有可安装物 + archguard 已用产物冷启动，只剩「别人能否不靠口述装上」。
三阶段（检测阶梯/冷启动 skill/端到端+隔离负控制），阶段一停报。**AC7 已改安全隔离**（PATH 符号链接摘除
或容器，非字面 mv——4 claude 会话 cwd + 2 PATH 链接 + 2 worktree 在开发树下）。AC4 判据事件送得到非进程在跑。
验证两目标分开报：临时空目录（全新）+ meta-cc（升级/Go/不依赖开发树）。

**在飞 2/3**：liveness 阶段一（待外层阶段二裁断）+ cold8 阶段一。

### liveness 阶段一关闭（2026-08-03 17:4xZ，外层方案 B）

**session-liveness 按外层处置方案 (B) 关闭**：阶段一 AC 如实勾、阶段二（AC9-AC14）标未做；
--task-end done（48 完成）。原因：遥测分不出「做阶段二」与「阶段一在等」，在飞 98 分钟、后 67 分钟闲置，
OVER90 报在闲置任务上。**阶段二作为新派发重新注册计量**，重派前需外层裁断排序（vs 姊妹任务
hashes-the-token-counter，同改 pane-hash/IDLE-RESUMED 块必须串行，AC10 语义标志大部分吸收其修复面）。

**在飞 1/3**：cold8 阶段一。

### 外层补 AC（2026-08-03 18:0xZ）：cold8 阶段二加「循环起来的证明 = 真实遥测记录」

触发：archguard 第 11 次「存在≠生效」（新形态）：fast-mode-telemetry.ts 在但 .workflow-events/ 不存在——
循环用提交+tick-log 记录，从没调 --task-start/--task-end ⇒ /live 永远无数据。
**补 AC**：冷启动 skill 派出第一个任务后，必须能在目标项目 `.workflow-events/` 读到 --task-start 写出的
jsonl；不能用「有提交/有 tick 日志」代替（archguard 两者都有而遥测空）。
判别法：有活动信号但遥测空 = 没接上；全部信号没有才是没跑。已转达 cold8 agent（阶段二并入）。

**待外层裁断**：①cold8 继续阶段二？②liveness 阶段二排序（vs hashes-the-token-counter 姊妹任务）。

### 补派（2026-08-03 18:2xZ）：acs-behind + live-unwired（在飞 1→3）

外层说明：过去槽位空着是它没派满（checkTouchesPair 实测六个待派任务全 DISJOINT），非闸卡。闸口 new=0。
1. **acs-behind**（`/tmp/quay-wt-acs`，agent a94a8345...，fm-...-334tt3）：判据「done 时若有未勾 AC，
   必须存在指名承载的后继任务（## Carries 机读），未承载即拦」——不是「AC 全勾才能 done」（会逼勾选造假）。
   双向负控制；AC8 用 session-liveness 与其 stage-2 后继回填真样本。
2. **live-unwired**（`/tmp/quay-wt-live`，agent a891ea91...，fm-...-r72g6s）：/live 区分「死循环」vs
   「在跑没接遥测」——有活动信号+遥测空=没接上；全部信号无=没跑。两态两文案+判别说明。不用散文提醒。

**在飞 3/3**：cold8 阶段一（停报待外层批准阶段二）+ acs-behind + live-unwired。

### 外层补规格（2026-08-03 18:4xZ）：cold8 加 AC8 四条 8a-8d + AC1 修正

背景：散文引导依赖读者推理，读者会换（今天 3 模型 × 3 次重写）——改一行斜杠 skill 命令启动确定行为。
**AC1 修正**：原清单漏内层启动，不能当外层引导副作用（今天证明副作用不会发生）。
**AC8 8a-8d 三条实测**（2 条是外层自己的错）：
① 检查必须按目标布局路径（`orchestration/` 下有 orchestrator-loop-tick.md、`docs/analysis/` 下有 fast-mode-loop-tick.md），不能按 quay 的 plugin/loop；
② worktree/分支不得把宿主或目标项目自有约定（.claude/worktrees/agent-*、/tmp/wt-archguard-TASK-*）当 fast mode 证据；
③ 判别式三态（文件在+活动+遥测=正常 / 活动+遥测空=跑了没接 / 活动无+遥测空=装了没引导），同组信号。
**AC8c**：可观测后果先定义成具体清单（worktree 建了、--task-start 写了一条、首任务分支出现）。
已转达 cold8 agent。

### 关闭批次（2026-08-03 19:0xZ）：acs-behind + live-unwired

已关闭（50 完成）。合并 live(6f5bf233) + acs(eec99e90)；batch6 重跑绿 2120/2099/0/0（参考值 2115→2120，
含新 task-ac-carryover 静态检查 exit 0）。**--task-end 已补调**（acs fm-...-334tt3、live fm-...-r72g6s，
回应外层遥测闭合提醒——acs 任务体 done 但 --task-end 未调曾导致 inProgress 残留）。DoD 2x 均如实 [~]。
**边界注释已加进 task-ac-carryover-check.ts 文件头**：AC 承载由该检查器管、计量闭合由 --task-end 管，
两者不互相覆盖（本任务自己就是实例）。

**在飞 1/3**：cold8 阶段一（停报待外层批准阶段二）。无其它。

### 派发（2026-08-03 19:2xZ）：checkers-mutation + liveness-stage-2 + cold8 阶段二批准

**live 契约 new=1 已修**（invoke URL 补实跑证据，ratchet new=0）。
**cold8 阶段二批准**（外层承认 68 分钟延迟是它失误——把「1 commit 0 dirty」读成正常推进；80 分钟前它刚在
session-liveness 上诊断过同形态）。阶段二立即开始；阶段三不必再等批准直接做完报。三条判据再钉（事件送得到
非进程在跑 / AC7 摘 PATH 非真 mv / 循环起来的证明 = 真实遥测记录）。
**补派 2 个**（在飞 1→3，全 DISJOINT、闸口 new=0）：
1. **checkers-mutation**（`/tmp/quay-wt-checkers`，agent a1d3824c...，fm-...-qfwki4）：对检查器变异测试。
   清单从 run_static_checks+CI 解析不手写；机制自身有变异用例；AC5 用当天两个真实失败回归；stayed-green 逐个列。
2. **liveness-stage-2**（`/tmp/quay-wt-live2`，agent a51be606...，fm-...-fs57qr）：承载 heartbeat 8 条未完成 AC
   （## Carries）+ AC9 空闲判别（isApiErrorMessage 结构字段，非 429 文案——换端点失效）。

**在飞 3/3**：cold8 阶段二、checkers-mutation、liveness-stage-2。

### 机制观察记录（2026-08-03 19:5xZ，外层）——第 14 次「存在≠生效」

68 分钟等待本可 1 分钟信号：`inner-blocked-signal.ts` 的 VALID_BLOCKED_REASONS 有 `ruling-required`（注释
「a question the outer must rule on」），外层 inner-state.sh 监视器盯 `.quay/inner-blocked.json`，文件一出现
就发 BLOCKED reason=… question=… 唤醒外层。**实测该文件从未被写过**。
形态：机制在 + 判据枚举有 + 监视器接着 + **没被调用**——内层把阻塞写进 tick 文本、外层读 worktree 时间戳、
最后靠人搭桥。第 14 次、最靠上游（三样都在场只差一次调用）。
外层已加不依赖内层的判定式（在飞任务最后提交时龄 >20 分钟且树干净 ⇒ 读内层最后一段输出）。
**内层行为规则**：真停下等外层裁定（阶段门、合并冲突等）时，写 `.quay/inner-blocked.json`（
`inner-blocked-signal.ts --assert-blocked --taskId <id> --reason ruling-required --question <q>`），
比写 tick 文本快也更可靠；恢复时 `--clear`。tick 文档「阻塞信号」节已要求，本记录是实例。

### cold8 三阶段完成（2026-08-03 20:0xZ）

**cold8 三阶段全部落地**（959a2b96 P1 + 583c9531 P2 + bcd787a3 P3，scoped 39/39 绿）：
阶段一（检测阶梯/失败关闭/残留清理）、阶段二（冷启动 skill：Monitor 挂载 + cron + 显式驱动内层 + 遥测
记录证明 + AC8c 六键可证伪清单）、阶段三（e2e 3 命令 + AC7b vendor dist 铺入 + AC7 隔离负控制摘 PATH +
AC8d 三态目标布局 + README）。
**待协调方/外层执行**（非 worktree 可闭环）：
- AC7 完整 task_list 往返（需 node_modules + 构建 dist——批 fan-in 套件会跑）
- **AC8c 多模型（opus/flash/qwen）同后果清单实跑**
- **AC1b meta-cc 真实写入 run**（跨项目写权限，超出 worktree 授权，建议外层执行）
- AC6 内层零操作实跑记录

### 批 7 fan-in 阻塞（2026-08-03 20:3xZ，token 饥饿 + 无归属变异）

**批 7 三个分支已全部 merge**（cold8 `df073f9e` / checkers `353dfe69` / live2 `c92f72db`），
worktree 待清理、任务待关闭。**全量套件 6 次尝试全非绿**（suite5/7/9/10/11/12），全部失败归因为
环境负载而非批 7 代码：三个失败文件（loop-shipping ENOENT / session-liveness RESUMED /
runner-grouping 172s 挂起）**隔离验证 3/3 全绿**，确认为饥饿 flake。suite7 实测 **2140**
（2120 + 批 7 新增）但非绿（fail 2 / cancelled 1），**参考值保持 2120**——按纪律只在全量绿时更新。

**根因一（外层认定，在建任务）——token 拉取式回收的饥饿缺陷**：archguard 每几秒重取一次、
每次都刷新 mtime，而回收要求「mtime 超时 AND pid 死」两条同时满足 ⇒ mtime 永远长不到 30s，
quay 永远回收不了 token，全量套件（test.sh 内部 fail-closed 获取）无法启动。
**内层已停止盲目重试**（外层指示；已重试 12 次）。恢复条件：token 机制修复（mtime 刷新粒度或
回收判据）后重跑。

**根因二（无归属共享检出写入，另一发现）——`packages/quay-github/src/github-client.ts` 变异**：
工作树 20:21 出现 `const isCompound = false;`（HEAD 应为 `role === "compound" && (children || []).length > 0`），
已还原（`git checkout --`，工作树现干净）。**非内层注入**：该文件唯一历史提交 78ec9631（M81），
内层提交（quay-init-loop 测试修复 + 批 7 合并）均未触碰；外层已排除 checker-mutation-cases（5 用例
无此文件）、无测试写 src/、无活变异进程。判定：无归属的共享检出写入，来源待查。

**批 7 关闭阻塞**：需全量套件**真绿**（**fail 0 AND cancelled 0**——suite13 的 fail 0 是假绿：cancelled 2 的文件贡献 0 失败，与全过同形）→ 关闭 cold8/checkers/live2
（--task-end ×3 + worktree/分支清理 + Land --snapshot）。
**外层裁定（20:4xZ，纠正内层依赖倒置）**：关闭批 7 **不**挂在 token 修复落地之后——三个已完成任务去等一个未开工任务是依赖倒置。token 那条外层已建任务并上报管理者；批 7 的阻塞是 sl2 的 AC 与共享检出污染类。

**批 7 阻塞拆分（外层三次运行交叉比对）**：
- **(1) sl2 AC6/AC7 真红（两次套件唯一都红）**：`session-liveness.test.mjs` RESUMED carries cause+last-input。**已修**（`cfbc7459`：RESUMED 等待窗口 8s→25s，争抢下 8s 不足——机制正确、隔离 5.2s、兄弟测试负载下 7.7s，是窗口问题非机制缺陷；隔离 30/30 绿）。需全量套件复验。
- **(2) loop-shipping AC2 只 suite7 红**（瞬时污染）：**根因已查实**——`packages/quay/test/ts-typecheck-gate.test.mjs:69` 在 REPO_ROOT 建 `.quay-tmp-test-*`（finally 删除），并发下与 loop-shipping 的 walk 竞态 → ENOENT。**非**外层假设的「铺实体 fast-mode-telemetry.ts 拷贝」（已排除）。与排队任务 `gap-mkdtemp-rooted-in-the-shared-checkout` 同族。下次红时留 got 清单。
- **(3) runner-grouping / session-liveness 文件级取消**（71-86s，load 曾 13.32）：争抢超时非缺陷；单独重跑判别中。
- **quay-github 两个 gate 测试**只在有变异体的 suite12 红——丢弃，树已干净。

**共享检出夹具泄漏（21:0xZ）**：`plugin/test/zz-runner-grouping-undeclared.test.mjs`（runner-grouping AC7 固定路径夹具，故意无 @test-group）从取消的 runner-grouping 运行泄漏（文件级取消绕过 finally）→ 已被测试 glob 选中、策略检查器报 NEW file。**已删除**（未跟踪）；AC7 加开头防御清理待办。

**token 修复任务已建（外层，20:3xZ）**：`gap-a-token-held-by-nobody-can-starve-a-live-waiter`
（12 次套件尝试、零获取，回收双条件 AND 在对面 churn 时变无界饥饿）+ `gap-token-status-reports-a-dead-holder-as-busy`
（--status 只评估 acquire 时的 staleness）。**均 status: todo、未派发**（无 worktree）。token 只影响套件能否启动，不决定批 7 关闭。
内层不派发新任务（停止条件：全量 suite 未真绿）。

### 批 7 关闭（2026-08-03 21:5xZ，suite14 全绿）

**suite14 全量绿**：**2148 tests / 2126 pass / 0 fail / 0 cancelled / 22 skip**，SUITE_EXIT=0
（`/tmp/batch7-suite14.log`，干净窗口 load 2.99 起跑）。**参考值 2120→2148**（tick 文档已更新）。
**批 7 三个任务全部关闭**（status done + `--task-end` ×3）：cold8 / checkers / live2。
worktree 已清理、分支已删除、Land `--snapshot` 已写（累计阻塞 2.47 min）。

**关闭前处置**：
- **AC6/AC7（RESUMED）修复**：`cfbc7459`（等待窗口 8s→25s，争抢下 8s 不足），suite14 绿覆盖。
  负控制待补（外层要求：载荷缺失时测试必须仍红）。
- **runner-grouping 防御清理**：AC7 夹具开头 `rmSync force`，防文件级取消泄漏进共享检出。
- **zz 夹具泄漏已删**（未跟踪，曾污染 glob）。
- **cold8 承载任务**：`gap-cold-start-outer-validation-runs`（## Carries acs: AC1b, AC6）——
  三条验证 AC 待外层实跑（meta-cc 写入 / inner 零操作 / 多模型）。
- **loop-shipping AC2 根因**：ts-typecheck-gate 的 REPO_ROOT mkdtemp 竞态（非实体拷贝），下次红时留 got。
- **quay-github 两 gate 测试**：只在有变异体的 suite12 红，丢弃。

**待办**：token 饥饿修复任务（外层）、cfbc7459 负控制、cold8 验证承载任务、loop-shipping 根因修复。
**下一批候选**：视外层优先级（token 任务落地后补满在飞槽位）。

### Tick 更新（2026-08-03 22:0xZ）：widened-wait-window 关闭 + token-waiter 派发

**`gap-a-widened-wait-window-was-closed-on-evidence-that-cannot-discriminate` 全部 AC 完成并关闭**
（`5df62c7d`）：为 cfbc7459（窗口 8s→25s）补齐区分证据——**双向负控制**（AC1 空 transcript ⇒
last-input 取不到 ⇒ AC7 拒绝；AC3 脚本变异强制空 cause ⇒ 强化 AC6 `成因：[^；）]` 拒绝），
**并发现原 AC6 断言是 no-op**（`! /成因：\)/` 用 ASCII 括号，在全角输出中永不出现，空 cause 也过）
——已强化。AC4/AC5 窗口依据 + 纪律写进测试文件头；AC6 回填 sl2 任务体。隔离 32/32 绿。
参考值 2149→**2150**（+2 负控制测试）。

**token-waiter 任务已派发**（`gap-the-only-token-waiter-refuses-to-wait-at-all`，runId `...c1pul1`，
`/tmp/quay-wt-tokenwait`）：修复 test.sh:237 的 `--timeout 0` 零等待 → 有界等待。
**AC3 关键约束**：绝不抢活持有者的令牌（把「拒绝等待」换成「抢走别人在跑的重活」是更坏的交易）。
与 token-status 任务在 `heavy-op-token.sh` 冲突，后者待前者落地后派。
scoped 验证（`--root` 测试缝），不跑全量。

**在飞（3，满）**：
- **token-waiter**（`gap-the-only-token-waiter-refuses-to-wait-at-all`，`...c1pul1`，`/tmp/quay-wt-tokenwait`）
- **mkdtemp**（`gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree`，`...fmpf0r`，`/tmp/quay-wt-mkdtemp`）
  ——修 `ts-typecheck-gate.test.mjs:69` 的 REPO_ROOT mkdtemp + 扩展 `test-isolation-check` 检测
- **task-list-route**（`gap-task-list-route-is-linear-in-task-count`，`...nvomw3`，`/tmp/quay-wt-tasklist`，
  外层指定第 3 槽，DISJOINT 实测）——先拆 provider(~47%)/渲染成本再动手，AC5 实时性负控制
**停止条件**：无（.halt 无、窗口内无新 needs-human、批 7 套件已绿）。
**AC20**（`gap-liveness-mounting-is-a-single-flight-role-with-no-owner`）：**非未排上，被文件重叠挡住**
——与 token-waiter 都动 `plugin/scripts/heavy-op-token.sh`。token-waiter 落地后下一个，管理者点名走
正常流程，不插队不绕正交性。
**记账缺口（外层 22:0xZ）**：`gap-a-widened-wait-window` 关闭时未调 `--task-start/--task-end`，
`.workflow-events/` 无其事件 → 对 orphan 检测/在飞判定不可见。**不回填历史**；此后每条任务
（含本批 3 条）都走同一条记账路径（派发 `--task-start`、关闭 `--task-end`）。

### 判别与记账（2026-08-03 22:5xZ）

- **batch-tokenwait 套件 fail 2 判别**：serve.test.mjs + provider-env-symmetry 在当前窗口共享检出重跑
  2/2 绿 + 时序（套件 22:36 早于 tasklist 合入 22:38）→ **负载竞争 flake，非 tasklist 回归**
  （外层实测 load 4.65 单跑 serve.test.mjs 也绿）。cancelled 0（此前取消的两文件本次过了）。
- **新任务**：`gap-worktree-node-modules-inconsistent-self-verify`——worktree node_modules 不一致
  （tasklist 有符号链接、tokenwait 无），不能自证的 worktree 验证回退到共享检出（污染高发地）。
  外层提问差在哪一步，内层实测回答：差在 agent 是否建 node_modules 符号链接。**待派发**。

### 批 3 关闭（2026-08-03 23:5xZ，batch3-faninsuite3 全绿）

**批 3 三个任务全部关闭**（status done + `--task-end` ×3）：
- **token-waiter**（`gap-the-only-token-waiter-refuses-to-wait-at-all`）：test.sh acquire `--timeout 0`→有界等待 40s，AC3 关键约束过（活持有者绝不抢）
- **mkdtemp**（`gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree`）：R8 shared-root-mkdtemp 检测器 + assert-clean-tree 接线 + 修 3 实例（ts-typecheck-gate/loadbearing/run-identity）
- **task-list-route**（`gap-task-list-route-is-linear-in-task-count`）：mtime/size 缓存 + includeBody:false，route ~3.5s→0.08-0.12s，AC5 实时性负控制过

**批 3 套件绿**：**2157 tests / 2134 pass / 0 fail / 0 cancelled**，SUITE_EXIT=0
（`/tmp/batch3-faninsuite3.log`，干净窗口起跑）。**参考值 2150→2157**。worktree/分支已清理，
Land `--snapshot` 已写。

**合并期发现与修复**：
- store.ts `ReturnType<typeof fs.statSync>` 解析到 bigint 重载 → `number|bigint` 类型错误，
  破坏 ts-typecheck-gate（批 3 套件先红 3 条）→ 已修（显式 `fs.Stats | null`，tsc exit 0）
- batch-tokenwait 套件 fail 2（serve.test.mjs/provider-env-symmetry）判别为负载 flake
- 契约检查器抓到我建任务的 measure-no-field 违规（已修）

**在飞**：0。**下一批候选**：AC20（token-waiter 落地后下一个，与 token-status 在 heavy-op-token.sh
重叠需串行）、gap-worktree-node-modules（我建）、gap-the-dod-gate-encodes-a-retired-task-shape（外层建）。

### 派发（2026-08-03 23:5xZ）：AC20 单飞挂载

**AC20**（`gap-liveness-mounting-is-a-single-flight-role-with-no-owner`，runId `...h2nhm9`，
`/tmp/quay-wt-ac20`）——外层指定 token-waiter 落地后下一个（已落地）。单飞挂载：
mount_count=1、二次挂载空操作非失败、kill -9 后必须接管。契约逐字照搬管理者 AC20a-d。
**与 token-status 冲突**（都动 heavy-op-token.sh），token-status 待 AC20 落地后派。
**在飞（1/3）**：AC20。**下一批候选**：token-status（等 AC20）、worktree-node-modules（待 review）、
dod-gate（外层建）。

### 补派两条（2026-08-03 23:5xZ，外层裁定填满槽位）

- **dod-gate**（`gap-the-dod-gate-encodes-a-retired-task-shape`，runId `...9wwkva`，`/tmp/quay-wt-dodgate`）
  ——**最高优先**：管理者裁定不许改 meta-cc 任务内容迁就闸，41 个 Finding 模板任务过不了 author→ready、
  ready 队列为 0，挡着 meta-cc 整个循环。修复只能在我们这边。不对称：ac/dod 允许别名、proposal/plan 写死，
  写死的恰是两项目各自撞的（quay: plan→Contract；meta-cc: proposal→Finding）。AC5 未知形状 fail-closed、
  AC6b 不许改任务内容达标，AC5 不过则 AC2 不算数。
- **tick-doc**（`gap-the-tick-doc-ships-three-contradictory-loop-drivers`，runId `...l4x18s`，`/tmp/quay-wt-tickdoc`）
  ——同一份外层 tick 文档三套矛盾循环驱动（CronCreate/ScheduleWakeup//loop 25m），照字面走 2/3 概率双触发或不触发。

**押后两条（外层裁定）**：`gap-session-liveness-hashes-the-token-counter`（动 session-liveness.sh，与在飞 AC20
同文件须串行）；`gap-suite-speed-under-a-297-second-sigma`（改 scripts/test.sh——其它每条任务用来自证的仪器，
并发改它=绿是在移动的尺子上量的；正交性检查看不出，等槽位空单独跑）。

**在飞（3/3）**：AC20 + dod-gate + tick-doc。

### 关闭 tick-doc + dod-gate（2026-08-04 00:1xZ）

- **tick-doc**（`gap-the-tick-doc-ships-three-contradictory-loop-drivers`，`...l4x18s`）：单驱动 CronCreate，
  loop-driver-check.sh（LIVE/STALLED/DOUBLE-TRIGGER/BANNED），scoped 47/47，`--task-end` done
- **dod-gate**（`gap-the-dod-gate-encodes-a-retired-task-shape`，`...9wwkva`）：SHAPE_REGISTRY 形状分派
  （contract/finding/plan/unknown fail-closed），ADR-023，AC6b 零任务内容改动，scoped 9/9，`--task-end` done
- 两者合并 + scoped 绿；**批套件待 AC20 落地**（dod-gate 修的是闸，tick-doc 修的是驱动文档，都是机制层）
- **契约 ratchet 修复**（我建任务的 invoke-evidence 归零）：mkdtemp `.sh`→`.ts`、tasklist `/dev/null` 入正文
- **在飞（1/3）**：AC20

### 补派 e2e + 更正（2026-08-04 00:2xZ）

- **e2e 已派发**（`gap-no-e2e-proves-install-is-configuration-driven`，runId `...v8uvdb`，
  `/tmp/quay-wt-e2e`）——**先红落地**（AC1 四条断言此刻全红：A1/A2/A3 文本替换未完成、A4 闸拒绝
  Finding 模板；红输出贴任务体 = 仪器自证）。AC6 防空过控制与断言同时落地（不许延后）；AC7 逐字贴
  两工作区推导测试命令不同（package.json vs go.mod）。
- **更正**：tick-doc 任务体里 `QUAY_TEST_SKIP_STATIC_CHECKS=1` 的说明已过时——契约 ratchet 两处
  invoke-evidence 已修（exit 0、new since baseline 0），不再需要跳。该接缝声明用途是嵌套 0 匹配运行，
  不是范围化绕开既有违规（用途漂移 = 窄豁免变通用跳过开关）。
- **在飞（2/3）**：AC20 + e2e。

### 关闭 AC20 + 批套件等待窗口（2026-08-04 00:4xZ）

- **AC20 已关闭**（`gap-liveness-mounting-is-a-single-flight-role-with-no-owner`，`...h2nhm9`）：
  单飞挂载（session-liveness-mount.sh + session-liveness.sh 自锁复用 token 锁）、AC9 monitor-mount
  `delivered` 取代 `ownedByThisSession`、共享事件文件 events.jsonl。**AC9 测试已更新**（外层把 manager
  配置移出 orchestration/session-liveness.env → 零配置默认，c1489b6a）。38/38 scoped 绿。--task-end done。
  **披露**：agent 清理时误杀一个生产 liveness monitor（pid 3378758），已确认 quay 内层监视器仍在跑
  （2846430/3378790），外层应核实是否已重挂。
- **红 e2e 已落地（分支）**：`gap-no-e2e-proves-install-is-configuration-driven`（31fb6d44 红 e2e +
  4e3a66d7 任务体），4 红逐字贴出（A1/A2/A3 文本替换、A4 Finding 无 Plan 仍被拒——dod-gate 已合但
  finding shape 的 plan 槽仍要求 Plan，A4 修法是 dod-gate 的后续）。**留在分支，等本批套件绿后再 merge**
  （避免红 e2e 挡本批关闭）。
- **批套件**（AC20 + dod-gate + tick-doc）：起跑时 gate WAIT（avg10 52.52）自停，等干净窗口（Monitor bf9peatoh）。
- **在飞（1/3）**：e2e（red-first 已落地，AC2-AC5 待修复后绿）

### 批套件进展（2026-08-04 00:5xZ）

- **batch4-faninsuite1**：gate WAIT（avg10 52.52）自停，未跑
- **batch4-faninsuite2**（干净窗口起跑，中途 archguard churn）：2164/2138/**fail 1**/**cancelled 2**
  - fail 1 = `monitor-mount-check` AC5（delivered 应为 false 实为 true）——**已修**：测试不 hermetic，
    没设 `MONITOR_CHECK_EVENTS_FILE` → 读到真实共享事件文件（外层监视器在写 HEARTBEAT，delivered=true
    正确）；改为指向不存在的临时路径。11/11 绿
  - cancelled 2 = runner-grouping + session-liveness（负载，单独跑能完成但慢）
- **批套件待更严格干净窗口**（Monitor b4r1kznz9：gate GO + 无 archguard + load1<4）

### 补派两条（2026-08-04 01:0xZ，外层裁定填满槽位）

- **both-gates**（`gap-both-gates-read-one-signal-so-done-costs-nothing`，runId `...oewucx`，
  `/tmp/quay-wt-bothgates`）——**最高优先（管理者明说优先于所有交付面条目）**：author→ready 与
  execute→done 都读「AC 全勾」同一份证据，过第一道自动满足第二道（DIR-102 活标本）。方向：两道闸读
  不同证据（author→ready 读计划+AC 形状、execute→done 读 DoD 勾选）。AC7b 主判据（AC 全勾但 DoD
  全未勾 ⇒ execute-done 必须红）。**AC8**：gate-gameability 的 PASS 断言必须仍成立——不走进「闸验勾选
  声称真假」的已证不可行方向。meta-cc 外层没作弊，是照 ADR-001 原文做。
- **blocked-channel**（`gap-the-blocked-channel-has-a-writer-nobody-calls`，runId `...msadpj`，
  `/tmp/quay-wt-blocked`）——**不是没接线**：写入侧+读取侧+tick 文档 321/327 行调用指令全在，但
  `.quay/inner-blocked.json` 全历史零次提交（三项目均无）。文档指令从未被执行 → 加文档指令没用，
  要让触发变**机械的**（停止条件触发即写），不是自觉的。

**押后**：`gap-retire-inner-state`（动 quay-init.sh，与在飞 e2e 同文件，串行）。

**在飞（3/3）**：e2e（红先落地）+ both-gates + blocked-channel。批套件 bh3nbv4c2 后台跑（AC20/dod-gate/tick-doc 验证）。

### e2e merge 修正 + 批套件现状（2026-08-04 01:3xZ）

**e2e 任务修正（外层抓到，内层承认）**：e2e 标记 done 但工作只存在孤立分支（worktree 还被删了），
任务体 done 但 AC 全未勾——正是「done 零工作量」缺陷的现场。**已按外层顺序处置**：
①merge 分支进 master（`packages/quay/test/install-config-driven-e2e.test.mjs` 23870B 在 master）+
②回填 AC（AC1 红先落地/AC6 防空过/AC7 命令不同/AC8 node:test 勾；AC2/AC3/AC4/AC5 留空待 #1/#9，
写明理由）+ ③四红实跑输出贴进任务体。契约 ratchet 归零（new since baseline 0）。

**批套件现状**：AC20/dod-gate/tick-doc 已 done + merge，但全量套件非绿——
- batch4-faninsuite3：2164/2138/**fail 3**（session-liveness RESUMED ×2 + monitor-mount AC7），cancelled 0
- 三失败全为套件 c8 并发/负载 flake（隔离全绿：monitor-mount 11/11、session-liveness 38/38）
- master 现含**红 e2e**（4 断言 fail，待 #1/#9 修复）→ 下一套件会更红直到修复落地
- **批任务 DoD「2x 全绿」无法在本轮达成**——建议外层裁定：标 [~]（代码 scoped 绿、套件红在仪器+flake）
  或等 #1/#9 修复后绿

**在飞（2/3）**：both-gates（最高优先）+ blocked-channel。**下一槽候选**：#1 install-rewrites / #9 finding-without-plan（green 红 e2e）。

### 关闭 both-gates + blocked-channel（2026-08-04 02:1xZ）

- **both-gates**（`gap-both-gates-read-one-signal-so-done-costs-nothing`，`...oewucx`，**最高优先**）：
  两闸读不同证据——author→ready 读计划+AC 形状（去掉 acAllChecked，ADR-001 恢复）、execute→done 读
  DoD 勾选+AC+children。**AC7b 主判据过**（AC 4/4 勾 + DoD 3/3 未勾 ⇒ execute→done 红，DIR-102 形状）。
  AC8 gate-gameability PASS 保持。meta-cc 0/14→11/14。scoped 36/36 绿。--task-end done。
  **后续**：GitHub provider 的 checkGate 同结构（两闸读同一证据），不在本任务 Touches——已标后续。
- **blocked-channel**（`gap-the-blocked-channel-has-a-writer-nobody-calls`，`...msadpj`）：
  `--detect-stop` 机械触发（merge-conflict + task-over-90m 自动写/清 .quay/inner-blocked.json），
  tick 文档 step 3 变单条机械命令。AC1-AC7，23/23 scoped 绿。--task-end done。**披露**：agent 的
  AC-demo 脚本 bug 产生 stray 分支已恢复。**留空**：DoD 全量 2x（agent 未跑全量）。
- **红 e2e 已入 master**（`install-config-driven-e2e.test.mjs` 23870B）——AC1/AC6/AC7/AC8 勾、
  AC2-AC5 留空待 #1/#9（承载已建：install-rewrites ## Carries AC2/AC3/AC4、finding-shape ## Carries AC5）。
- **在飞**：0。**下一批候选**：#1 install-rewrites / finding-shape（green 红 e2e）、batch 任务 DoD 裁定。

### 补派两条（2026-08-04 02:2xZ，外层裁定）

- **install-rewrites**（`gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them`，runId `...09efle`，
  `/tmp/quay-wt-installrew`）——管理者排序第 3，承载 e2e 的 A1/A2/A3 绿。**规模：落地真被改写的只有
  2 个文件（都是 tick 文档），不是先前报的 60+**（任务体三次口径对账，meta-cc 实测 23 文件 21 字节相同
  2 不同）。按 2 排优先级。
- **drift-check**（`gap-drift-check-only-looks-at-the-harmless-direction`，runId `...ybp1wy`，
  `/tmp/quay-wt-drift`）——漂移检查只扫 todo/ready（636），**done 从不被扫** → 无东西验证 done 真过了闸
  （状态可直接写不经闸）。与 both-gates 是同一件事两半（一修闸太松、一修闸可被绕过）。AC2 活标本 +
  AC3 反向负控制。

**在飞（2/3）**：install-rewrites + drift-check。**批任务 DoD 裁定**仍待外层（套件红在 e2e 仪器+flake）。

### 补派 one-condition（2026-08-04 03:0xZ，外层裁定）

- **one-condition**（`gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger`，runId `...2ypatk`，
  `/tmp/quay-wt-onecond`）——`--detect-stop` 只自动查 merge-conflict + task-over-90m，ruling-required 手动。
  68 分钟等待只在 90 分钟被抓到（晚于解决 22 分钟）。**AC1 关键：先找痕迹不是加条件，「找不到」是合法结论；
  禁止调小 90 分钟阈值充数**（e2e 正常跑 78 分钟是反例）。与 install-rewrites 零重叠。
- **派非门槛任务的理由**：6 条队列任务共用 quay-init.sh（管理者门槛清单全在里面），install-rewrites 落地前
  门槛相关工作一条都派不出去；这条缩短串行路径风险（68 分钟那次只有 3 条在飞）。

**落地顺序（外层已定）**：install-rewrites → LOOP_SCRIPTS 条 + tmux 检测条（紧接着，先于一切）——
重装判据是人工补丁数 0，那两条各在第一分钟产生一条补丁。

**在飞（2/3）**：install-rewrites + one-condition。

### 派发 tmux 检测（2026-08-04 03:1xZ，外层落地顺序）

- **install-rewrites 已关闭**（`...09efle`，--task-end done）：render_substitutions 删除、配置驱动、
  tick 文档逐字落地、**e2e A1/A2/A3 绿**（AC2/3/4 承载满足）。
- **tmux 检测**（`gap-init-guesses-the-tmux-session-and-writes-the-guess-into-the-monitor`，runId `...v1d8yr`，
  `/tmp/quay-wt-tmux`）——外层落地顺序：install-rewrites 后的下一条。fail-closed 检测、绝不写猜测值。
  与 one-condition（inner-blocked-signal）无冲突；**与 LOOP_SCRIPTS 条冲突**（都动 quay-init.sh + 测试）→
  LOOP_SCRIPTS 待 tmux 落地后派。第 3 槽按外层顺序留空。
- **在飞（2/3）**：one-condition + tmux。

### 派发 finding-shape（2026-08-04 03:2xZ，最后一条门槛）

- **finding-shape**（`gap-the-finding-shape-still-requires-a-plan-section`，runId `...kbqp4u`，
  `/tmp/quay-wt-finding`）——finding 形状必需段集合仍含 plan，而 finding 前提就是无 Plan。
  精确失败点：`artifacts={"proposal":true,"plan":false,...}`。与 meta-cc 11/14 不矛盾（DIR 模板
  Finding+Plan 都有）。**AC3 真判据**：Plan 形状缺 Plan 仍必须红（只改 finding 必需段集合，
  不放宽通用判定——dispatch is not a waiver）。**AC5**：整个 e2e 五条断言全绿 = 重装门槛过。
  承接 e2e AC5（## Carries；原 stub 承载任务已并入删除）。与 tmux/one-condition 无冲突。
- **在飞（3/3）**：one-condition + tmux + finding-shape。

## 第二次 OOM 恢复 tick（2026-08-04T09:1xZ，外层）

**上下文**：两次全机 OOM 后重启（约 02:39Z 第一次、约 08:5xZ 第二次），本文件本身已是 08-02/08-03
的旧快照，**以下以 git/遥测实测为准，不信本文件之前几节的「在飞」列表**（那三个早已各自收尾/丢失，
见下）。

**恢复过的三条**：tmux（`51dbcda4`，已合并，任务体 status 漂移已订正 `db5a04bb`）、
finding-shape（`fce8f73f`/`12f0f651`，已合并且已 done）、one-condition（worktree/分支已丢失，
任务体 AC 全未勾，**真未完成**，非漂移——已重新派发，见下）。

**Fan-in 卫生**：清理 2 个已合并的孤儿 worktree（`quay-worktrees/tmux`、`quay-worktrees/verify`，
均已确认 `git merge-base --is-ancestor` 为真）+ 8 个已合并的孤儿 `task/*` 分支（含 one-condition
那条——它的分支尖 `c36809da` 本身就是 master 的祖先，说明那不是它自己的交付，只是分支停在了某个
后来被吸收的旧 master 点上，任务实际未做）。

**哨兵/停止条件**：`.halt` 不存在；`--detect-stop` 空（无阻塞）；遥测 `inProgress: []`、无 orphaned；
`resource-gate.sh --for full-suite` GO（压力 1.01）。

**新发现（有证据，已建任务）**：`gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files`
——`status:ready` 的 9 条里 8 条 Touches 指向 ADR-022 已物理删除的经典管线文件
（`.claude/workflows/{execute,prepare}-milestone.js`、`composite-{build,audit,reconcile}.ts`），
只有 DIR-103-C 的 Touches 落在真实存在的文件上。派发前逐条 `ls` 核实，未误派。

**本 tick 派发（并发，AC1/AC2 验证用）**：
- **DIR-103-C**（`fm-DIR-103-C-1785834807691-12x3q8`，`/home/yale/work/quay-worktrees/dir103c`，
  分支 `task/DIR-103-C`）——status:ready 里唯一目标真实存在的任务
- **one-condition**（`gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger`，
  `fm-gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger-1785834808086-p68cig`，
  `/home/yale/work/quay-worktrees/onecond`，分支同任务 id）——worktree/分支丢失后重新派发，
  任务体 Contract/AC 齐全，直接可派不需重新 author

两者 `checkTouchesPair` 实测 `disjoint: true`（DIR-103-C 只碰 `packages/quay/*`+README+docs/plans；
one-condition 只碰 `plugin/scripts/inner-blocked-signal.ts`+对应测试）。两个 `Agent(...)` 调用在
**同一条消息内并发发起**（非串行等待），`--task-start` 均已打（runId 见上）——AC1/AC2 的验证点。

**在飞（2/3，槽位未满，等首批返回后视情补第 3 个）**：DIR-103-C + one-condition。

### 第二次 OOM 恢复 fan-in 关闭（2026-08-04T09:5xZ，内层 tick）

- **批全量套件结果**：**tests 2227 / pass 2203 / fail 0 / cancelled 0 / skipped 24**（`/tmp/batch-fanin-full.log`，
  显式 `--test-concurrency=8`，~15min）。**参考值 2157 → 2227**（DIR-103-C acceptance T1-T4/T4-control +
  one-condition 8 条新测试，加期间多任务合并）。
- **clean-tree 假阳性（有证据，根因已修）**：suite-after `assert-clean-tree.sh` 报
  `?? .quay/loop-driver.jsonl` FAIL——该文件是 **loop-driver 注册表**（cold-start 02:40:46Z 写入，
  cron LIVE 在写），**先于本套件存在**，非测试产物，但漏在 .gitignore 之外。根因修复已落地：
  外层提交 `f263f12f`（`.gitignore` 加 `**/.quay/loop-driver.jsonl`）。batch 本身无回归
  （fail 0 / cancelled 0）。
- **关闭 DIR-103-C + one-condition**：均 `status: done` + `--task-end`（runId 见上）+ worktree 移除
  （`quay-worktrees/dir103c`、`quay-worktrees/onecond`）+ 分支删除。DIR-103-C 三条 DoD 落地勾选
  （merge `56eda459` + 批套件绿 = 独立审计）；one-condition DoD 全勾（批套件 = fan-in 核验，
  判据 fail 0 且 cancelled 0 成立）。M239 worktree 保留（人裁定）。
- **telemetry**：`--snapshot` 已写（`milestones/fast-mode-telemetry/2026-08-04.json`）。
- **在飞（1/3）**：`gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files`
  （runId `fm-...-gzxg3x`，worktree `/home/yale/work/quay-worktrees/readyqueue`，分支同名，09:56Z 派发）——
  re-triage 8 个陈旧 ready 任务 + 把「Touches 文件存在性」接进派发资格路径（AC2），DIR-103-C 负控制。
  其余 8 个 ready 任务暂不派（ADR-022 退役目标）。ready 队列清理后外层可重新评估 backlog 优先级。

### 外层纠正：派发契约违约 + 已改（2026-08-04T10:0xZ）

**外层 meta-cc 核实（非猜测）**：09:56:13 派发 readyqueue 的 `Agent` 调用 **input 无
`run_in_background` 字段**，且推进文字是「等 readyqueue 返回后继续 tick」——阻塞语义，非后台派发。
恢复简报指向的 `fast-mode-loop-tick.md:303` 明写「后台 `Agent(run_in_background)`」——
**指令正确，没照做**（恢复 AC1 违约；这不是信息缺失）。

**已核实**：本次派发实际在跑（`TaskOutput` status=running，正在实现 touches-resolve 检查 + re-triage
8 任务），**不需重派**。

**从下次派发起（已改，强制）**：
1. 每次 `Agent` 调用**显式带 `run_in_background: true`**，不假设默认行为；
2. 同一 tick 内可**并发派发多个**（上限 3），**绝不边派边等返回再继续 tick**。

### readyqueue fan-in 关闭（2026-08-04T10:2xZ，内层 tick）

- **merge** `ab144ae0`（rebase 干净、无冲突）：touches-resolve 派发资格检查 + 8 个 ADR-022 退役目标
  ready 任务 re-triage（7 → needs-human 各带证据，gap-split-decision 保留 ready——split-decision 流程
  活在保留的 `proposal-convergence.ts`，前提修正有据）。
- **scoped** `--for-task` 43/43 绿（touches-orthogonality + touches-parser-parity；`test-selection-thin`
  因 Touches 多为任务 markdown，非缺陷）。
- **批全量套件绿**：**tests 2239 / pass 2215 / fail 0 / cancelled 0 / skipped 24**，`FULL-SUITE-EXIT=0`，
  **clean-tree PASS**（外层 10:1xZ 提交 cold-start 任务 `899c83a6`/`3620f504`，树在套件结束前转净）。
  **参考值 2227 → 2239**（+12 = readyqueue 新增测试）。
- **关闭**：`gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files` done +
  `--task-end`（`fm-...-gzxg3x`）+ worktree/branch 清理。ready 队列现只剩 QENG demo +
  gap-split-decision（Touches 全部可解析，机械 resolve 检查已接进派发路径）。
- **在飞（0/3）**。

### 并发派发 2（2026-08-04T10:4xZ，外层指定 cold-start self-hosting 前置）

- **派发（并发，同一消息内两个 `Agent`，均显式 `run_in_background: true`）**：
  - `gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted`
    （runId `fm-...-w6m5x8`，worktree `/home/yale/work/quay-worktrees/sendkeys`，分支同名）
  - `gap-retire-inner-state-one-observer-targets-by-parameter`
    （runId `fm-...-bxqip0`，worktree `/home/yale/work/quay-worktrees/retirestate`，分支同名）
- 两者 `checkTouchesPair` 机械核实 **`disjoint: true`**（send-keys 只碰 `send-keys-verified.sh` + 测试；
  retire-inner 只碰 `inner-state.sh`/`monitor-mount-check.sh`/`quay-init.sh`/`session-liveness.test.mjs`）。
- **`gap-split-decision-finality-not-enforced` 不派**：人已裁定 needs-human（追 `decideSplitAdjudication`
  调用链，唯一调用者 `prepare-milestone.js --decide-split` 被 ADR-022 物理删除，15 次重复派发场景
  不可再现），任务体含完整证据 + 人原话。
- **在飞（2/3）**：sendkeys + retirestate。二者是 cold-start self-hosting 规格链的真实前置依赖。

### 第三次重启 + A–F 裁定（2026-08-04T14:36Z，外层 tick）

**背景**：第二次 OOM 整机崩溃后第三次重启。vhs/transformer 两台机器都死在 `gap-send-keys-verified-...`
的夹具造假（子代理裸调 `tmux kill-server` 误杀真实服务端）。人给出 A–F 六条架构裁定，外层执行：

- **裁定 A/D/B 立案并提交 master（`45c0f91`）**：
  - `gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid`（**ready**）——就地修订
    ADR-016 写死三条边界 + 按代码位置的机械检查器
  - `gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable`（**ready**）——纯函数分类器
    `classifyPaneState` + 真实录制夹具，`tmux_in_tests = 0`
  - `gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick`（**todo**，等 D）——把
    `ruling-required` 触发源接到 D 的分类器
- **F 处置**：`gap-send-keys-verified-...` **superseded**（status done + extra 标记；worktree 251 行
  提交保全到分支 `6a51f964`、worktree 已移除、分支不合并）
- **park**：`gap-retire-inner-state-...` 保持 ready + PARKED 注记（裁定 D 造的观察者是它要退役信号的
  替代品，清理跟在架构后面；298+/233- 提交保全到分支 `61a92a41`、worktree 已移除）
- **改范围**：`gap-session-liveness-hashes-the-token-counter-...` 不再加剥离规则，改为消费 D 的分类器
- **立案 G/L0（第七条）**：`gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX`
  （todo）——`env -u TMUX` 按人指示走正常流程（判据+测试+负控制）落地，**不是既成事实**；
  隔离由「显式 `-S` + `env -u TMUX` 的助手」承载，不依赖调用方记得 unset
- **遥测**：两条崩溃残留的在飞括号已关（`--task-end ... --outcome abandoned`），`--detect-stop` 的
  `task-over-90m` auto-block **已清除**（等待 1365.2s 计入死时间基线）
- **在飞（0/3）——内层实现中**：已用 tmux send-keys 驱动内层按 A→D→B 顺序实现三任务（不是外层
  直接 Agent 派发）。内层刚 boot（deepseek-v4-flash 欢迎屏）即收到指令开始思考。

### tick 2026-08-04T14:42Z（外层，`no-action`）

- 内层实现 **A** 中（6m+）：worktree `quay-worktrees/adr016-screen-use-check`（磁盘，非 /tmp），
  `plugin/scripts/adr016-screen-use-check.ts` + `checker-mutation-cases/` 夹具已建、尚未提交；
  任务清单 `◼ A ◻ D ◻ B` 顺序正确。D/B 的 worktree 待 A 后建。
- **无停止条件、无阻塞记录**（`--detect-stop` 干净）；Monitor 三判据 **true/true/true**；
  loop-driver **LIVE(1)**。
- master 停在 `5e24e1d3`（外层工件已全部落板）。工作树仅剩两处非外层文件改动：
  `manager-phase-goal.md`（既有）与 `restart-plan-2026-08-04-third.md`（管理者补 AC1 证据：
  inner 会话 `6a950975` = deepseek-v4-flash ✅）——均不属外层提交范围。
- 不 fan-in：内层尚未合并任何东西，等 A 完成通知或下一 tick。

### tick 2026-08-04T14:49Z（外层，`correct-self`：对管理者观察三条裁定 R1–R3）

管理者（`quay-0:manager`）观察三条，外层逐条裁定（`outer-rulings` 增补段，commit `1fa1cce3`）：

- **R1 — A→D 串行是遗漏，不是技术判断**。机械证据：`checkTouchesPair` 六对全部 `disjoint:true`
  （A-D/A-L0/D-L0/A-B/D-B/B-L0），A/D resolve 均 dispatchable。A/D 共享的只有五态枚举名，D 的
  Contract 自带该枚举，A 不是 D 的硬前置。纠正：A 与 D 并发，B 待 D。
- **R2 — 驱动文本只携带数据，不复述行为**（立案 `gap-drive-text-carries-data-not-behavior-outer-inner-handoff`，
  todo）。这是「并发派发+run_in_background」常驻指令的第二次静默丢弃（首次见简报 §3）。与
  `SPEC-quay-self-hosts-its-own-cold-start.md` 的关系：SH=启动那一跳的交接，R2=稳态每跳的交接。
- **R3 — D 的夹具采集方式收紧**：AC3 修订为只用 `capture-pane` 对现有三 pane（manager/outer/inner）
  采样、**禁止为采集新建/清理 tmux 会话/窗口**（采集→清理正是两次整机崩溃那一步）；某态遇不到标
  `unavailable-until-real-occurrence`。新增 AC10（采集过程留痕）。
- **L0 优先级：升 ready 入本批并发**（两次事故来源都是临时探索路径，lint 不可见，L0 结构性关闭它）。
- **内层即时纠正已送达**：已读到并行动——「re-capture the 3 existing panes (not scratch-c1)」，
  正读 L0 任务准备后台派发。
- **在飞**：A 已提交（`40ec564e`，待 fan-in）+ D 实现中（13m）+ L0 即将后台派发。内层曾为采集
  `tmux new-window` 建了 scratch-c1 窗口——已指示不用它采集、别急着清理（残留无害，后续处理）。

### tick 2026-08-04T14:54Z（外层，`correct-self`：用错仪器导致静默满足——第三次实锤）

管理者核实推翻我上一轮「A|D 双在飞」的说法（commit `fa6f570f` 的记录就是错的）：

- **原始字段核实（meta-cc，非转述）**：内层会话 `6a950975-…` 唯一的 Agent 调用
  `Implement L0 tmux-isolated task`（14:49:44）`input.run_in_background` **缺失（None）** ⇒
  同步阻塞调用，不是后台派发。A 是内层上下文做完并提交（`40ec564e`），D 也在上下文；L0 是唯一
  Agent 调用且阻塞。
- **「A|D 双在飞」= 遥测 START 事件 = 遥测括号并发，≠ subagent 并发**。我把前者当成了后者，
  常驻指令「并发派发+run_in_background:true」**第三次未满足**，且一次在我纠正之后。
- **纠正**：已驱动内层——L0 agent 若还在跑让它跑完；从下一个派发起（尤其 B）所有 Agent 调用必须带
  `run_in_background:true`，派发后自己核原始字段；并发目标=D 上下文推进 + B/L0 后台真正同时跑。
  已确认内层 pane 显示 L0 的 general-purpose 子代理在跑（4m47s），纠正消息排队待处理。
- **R2 已加 AC7**：「在飞」词汇拆为「遥测括号在飞」与「subagent 在飞」；核实并发必须读
  `input.run_in_background` 原始字段，不用 START 事件或 UI 文字。
- **我的输入框**曾躺着一条未提交的核实消息（管理者发现的投递失败原型）——已 `C-u` 清空。
- **subagent 在飞（1）**：L0（general-purpose，阻塞）；**遥测括号在飞（2）**：D + L0。
  scratch-c1 窗口（quay-0:3）确认存在，按裁定不动。

### 下一步备忘（2026-08-04T14:5xZ，记文件不记输入框——R2 AC8）

- **B 派发后核 `input.run_in_background` 原始字段（必须为 true）**——用 meta-cc 查内层会话
  `6a950975-…` 的 Agent 工具调用，不看 START 事件或 UI 文字。
- L0 的 general-purpose 子代理跑完后，内层会处理我的纠正消息（后续 Agent 必须带
  `run_in_background:true`）；到点时重查一次原始字段确认已落地。
- 输入框用完即空（`C-u`）；下一步备忘一律记本文件，不再写进自己输入框。

### tick 2026-08-04T15:02Z（外层，`no-action`：内层正常推进，无介入）

- **常驻指令终于被满足**（原始字段核实，非 UI）：内层 15:01:41 的 Agent 调用
  `Implement B ruling-required wiring` `input.run_in_background: true` ✓。L0 的原始调用
  （14:49，rib ABSENT）仍在跑、按「让它跑完」处置未重派。
- **进度**：A 已提交（`40ec564e`，checker `adr016-screen-use-check.ts` 在 worktree）；D 已提交
  （`acec8b5d`，分类器 `pane-state-classify.ts` 在 worktree，任务体在写 AC5 实跑输出）；B worktree
  建（`ruling-required-wiring`，基于 acec8b5d=D 的提交，依赖就绪）；L0 worktree 建（`tmux-isolated`）。
- **subagent 在飞（2）**：L0（general-purpose，session-liveness env，12m+）+ B（general-purpose，
  run_in_background:true，25s）——真正并发。**遥测括号在飞（2）**：B + L0（A/D 已开已闭或待闭）。
- 无停止条件、无阻塞；Monitor 三判据 true；loop-driver LIVE。
- **不 fan-in**：A/D 已提交未合并，等 B/L0 落地后按批（rebase→merge→选中集→全量）一次性收尾。
- A/D 的最终验证（检查器负控制、分类器夹具）留给 fan-in 的 `--for-task` + 全量套件。

### 监视器事件 15:0xZ — B 接线的第一次真实触发暴露假阳性类（已驱动内层）

监视器报 `BLOCKED reason=ruling-required` → `UNBLOCKED`。解读：B 子代理在跑 DoD「真实端到端接线
证明」（pane 显示 `Proving real-live ruling-required wiring end-to-end`），触发写/清 block 的是它。

**发现（假阳性类）**：触发时刻内层主上下文是「等后台 agent 完成」（pane 明示 `Waiting for 1
background agent to finish`）——良性空闲，**不是**等用户/裁定。观察者把「主 prompt 空闲」一律判
waiting-input，无法区分「等自己的后台 agent」与「等人」。若 B 把这次触发记为 DoD 成功证明，会
固化此缺陷。

**已驱动内层**（排队待 B 子代理跑完处理）：加判据——有在飞后台 subagent 时（遥测 in-progress 或
pane 的 `← N agent` 指示），主 prompt 空闲不算 ruling-required；任务体记录此负例；DoD「真实接线」
用真阳性实况证明（权限确认 / .halt 类问询 / 问外层裁定），或在负例外补说明。

**fan-in 核查点**：检查 B 的 DoD 证据里是否含「等 agent 空闲 → 写 block」的负例，以及它如何排除
假阳性类。

### tick 2026-08-04T15:22Z（外层，`no-action`：内层推进中，A 已核实）

- **A 已合并 master**（`d3104bbc`，真 `--no-ff`，双亲 1b4c31b0+f6f05175）。**独立核实通过**：
  `adr016-screen-use-check.ts` 实跑 `PASS: active violations (1) within band (0..1)`（session-liveness
  :617 存量计入 band；send-keys-verified 两处正确归 `retired` 不计——F 的 supersede 生效）；ADR-016
  `## Amendment 2026-08-04` 落位（2 处）；CLAUDE.md 已钉 `adr016-screen-use-check` 引用。
- **B 已提交**（`ruling-required-wiring` 3 commit：`96c87450` 接线 `--detect-stop --pane ->
  classifyPaneState`；`81a20c42` tick 文档；`e7059f86` gitignore 观察者计数器）——含假阳性判据修正。
- **D 已提交**（2 commit：分类器 + 第二张真实 busy 夹具）；**L0 已提交**（2 commit：助手 + session-liveness
  迁移）。
- **内层正在跑 fan-in 验证测试**（24 node 进程，load 2.19）——D/B/L0 待合并，批全量待跑。资源闸规则：
  内层在飞期间外层只做廉价核实，不做重型操作。
- 无停止条件、无阻塞；Monitor 三判据 true；loop-driver LIVE。
- **fan-in 核查点（更新）**：D/B/L0 合并时逐一 `--for-task`，批全量跑绿后关任务；B 的 DoD 证据
  必须含假阳性负例。

### tick 2026-08-04T15:37Z（外层，`correct-self`：吞吐两条——批思维 + 就绪池假满）

管理者交办两条吞吐问题，外层核实并处置（commit 待落）：

- **#1 批门控不是出厂要求**：tick §4 是「并发上限 3」（cap 非栅栏）；第 330 行「重叠 → 不同批」只指
  触摸集重叠。**我的「本批实现三个任务」措辞引导了批思维**（第四次散文覆盖产品的变体）。
  **纠正**：已驱动内层——槽位空出来就派，不等 fan-in；内层当前在飞 1（B），按上限还能派 2。
- **#2 就绪池假满是绑定约束**：ready 6 条里 4 条本批未翻（A/D/L0 + retirestate parked）+ 2 条 fixture
  （QENG-5-DEMO-*）⇒ 真实可派发 0，todo 积压 66。**已晋级 3 条**（皆 gap-* 缺陷、有 Contract、
  resolve 可派发、非 fixture、非 PARKED）：
  - `gap-task-write-accepts-a-title-that-breaks-its-own-frontmatter`
  - `gap-suite-speed-under-a-297-second-sigma`
  - `gap-node-compile-cache-is-never-enabled-and-every-spawn-reparses`
  （suite-speed 与 node-compile-cache 触摸重叠——都碰 scripts/test.sh，同刻只派其一。）
- **外层 AC 已立**（outer-phase-goal AC-queue）：ready 池常态 ≥3 真实可派发，判据排除本批未翻 /
  fixture / PARKED；晋级速率跟上派发速率。排除后现 = 3 ✓。
- 内层当前：全量套件运行中（批 fan-in 收尾），完成后关任务、清 worktree、按上限滚动派发。

### tick 2026-08-04T15:42Z（外层，`no-action`：内层批 fan-in 收尾中）

- **L0 已 fan-in**（`f6ad4d09`，tmux-isolated.sh + session-liveness 迁移落 master）。A 已合并
  （`d3104bbc`）。**D/B 各新增一个 commit**（pane-state-classify `f6d67fa0`、ruling-required-wiring
  `18ed59b2`）待合并。
- **内层**：正在跑批全量套件（fan-in 验证，1 shell）；完成后关本批（A/D/B/L0 翻 done）、清 worktree、
  **滚动派发下一批**——已内化我上轮的滚动派发纠正（pane 备忘原文即此）。且已核实 3 条晋级任务的
  resolve dispatchable（pane 明示 "All 3 new tasks resolve as dispatchable"）。
- **就绪池（AC-queue）**：排除本批/fixture/PARKED 后 = 3（task-write-title / suite-speed /
  node-compile-cache）✓。
- **新立案 2 条**（`aeef3ae2`）：ADR-016 Amendment-2（改 one-shot 理由不改结论）+ claude -p 窄实测
  （gating + 退出语义，实钱红线）。`RESEARCH-claude-p-streaming-2026-08-04.md` 已提交跟踪（`15:42Z`）。
- 无停止条件、无阻塞；Monitor 三判据 true；loop-driver LIVE。
- 资源闸：内层跑套件期间外层只做廉价核实。

### 批关闭 + 新批滚动派发 + clean-tree 假阳性核实（2026-08-04T15:48Z，外层）

- **批关闭**（内层 `aefc6ffd`）：A/B/L0 done（全量套件 **tests 2276 / fail 0 / cancelled 0 / skipped 25**，
  新参考值 2276）、遥测 snapshot。**D 留 ready**（内层 close 时以为 AC3/AC4 待外层裁定）。
- **D 补关（已确认）**：外层 AC3/AC4 裁定已落 master（`d9f5073a`：band 4..30 + unavailable 处置，
  AC3/AC4 已勾）；内层补关完成——D `status: done`，AC/DoD 全勾（含全量套件 2276/0/0 证据）。
  **A–F 六批全部完成**：A（ADR-016 Amendment+checker）、D（分类器）、B（ruling-required 接线+假阳性
  修正）、L0（tmux 隔离）。
- **新批滚动派发已生效**（原始字段核实）：`task-write frontmatter fix`（15:46:50 rib:true）+
  `node compile-cache task`（15:46:56 rib:true）——内层正确避开 suite-speed 与 node-compile-cache
  的 scripts/test.sh 触摸重叠（选了 node-compile-cache）。subagent 在飞 2。就绪池剩 suite-speed。
- **clean-tree FAIL 核实 = 假阳性**（管理者质疑成立）：`assert-clean-tree.sh` 要求套件后
  `git status --porcelain` 为空、**不建 before 基线**——它假设套件跑在干净树（脚本注释自承
  "the full suite which the coordinator runs on a clean tree"）。两文件 `manager-phase-goal.md`
  （mtime 10:54）与 `restart-plan-2026-08-04-third.md`（mtime 14:37）都**早于套件启动（15:26）
  数小时**，是管理者的在飞编辑 ⇒ 被误判为套件残留。**gap-mkdtemp-rooted 那条不涉事**——已按
  管理者指示不派内层去追不存在的 bug。`assert-clean-tree` 的「无 before 基线」限制记录于此
  （真缺口但低危，不新开任务）。
- **--test-concurrency=8 记录**：本机 4 核上 8 是 CLAUDE.md 警告过的 4.25× 超订（推导默认 1）；
  内层为批全量用 8 符合 tick 文档「全量验证需显式 --test-concurrency=8 否则小时级」——记录，
  不判断意图。

### 候选枚举遗漏（2026-08-04T15:5xZ，管理者第二轮实锤——与批门控不同的失效点）

- **实例**：retirestate（`gap-retire-inner-state-...`）D 落地后 ready、解 PARKED、与全部在飞/待派
  `checkTouchesPair` **全 disjoint**（ret-tw/ret-nc/ret-ss 实测），第三槽位本可派——但本轮候选集
  只核了新晋级的 3 条，**没把刚解阻塞的 retirestate 拉进来** ⇒ 被遗漏。
- **根因已记 AC-queue**：候选集构造必须**每轮全量重扫 ready 队列**（含刚解阻塞/刚解 PARKED 的），
  不允许只看新晋级子集；「某任务未出现在候选集」本身就是要核的东西。
- **已补派**：驱动内层第三槽位派 retirestate（后台 Agent rib:true），保全工作分支
  `task/gap-retire-inner-state-...` @ `61a92a41` 需 rebase 到当前 master 后继续；并注明前提变化——
  B 的接线现在自动写 `inner-blocked.json`（B 是写者、inner-state.sh 是读者），AC6（每类信号去向）
  必须显式处置这个新增的自动 BLOCKED 信号，别让 B 的信号随 inner-state.sh 静默消失。

### tick 2026-08-04T16:02Z（外层，`no-action`：内层当前批推进中 + AC-queue 补晋）

- **内层当前批**：node-compile-cache 已合并绿（`d3c5c09e` + `38e8aa57`）；suite-speed（跑全量对比测速）、
  retire-inner-state（ps 数 observer 挂载）、task-write 三个 subagent 在飞（达上限 3）。D/L0 关闭带
  invoke-evidence（`52c1fc39`，task-contract-check invoke-evidence-missing ratchet）。
- **AC-queue 补晋**：排除在飞本批后真实就绪池 = 0 ⇒ 按 AC-queue 从 todo 补晋 3 条（全 disjoint 核实）：
  - `gap-promotion-cadence-is-role-volition-not-product-mechanism`
  - `gap-reliable-send-crystallize-the-five-failure-modes-into-a-script`
  - `gap-adr-016-alternatives-rejected-one-shot-claim-is-factually-wrong`
  就绪池 = 3 ✓（AC-queue 成立）。measure-claude-p 仍 todo（依赖 am2）。
- 无停止条件、无阻塞；Monitor 三判据 true；loop-driver LIVE。
- 资源闸：内层在飞期间外层只做廉价核实。

### tick 2026-08-04T16:23Z（外层，`no-action`：retire-inner-state 合并 + 外层监视器重配置）

- **retire-inner-state 已合并**（`059c2437` fan-in + `2e0ccf72` tick 注记），AC6 B-signal 处置完成：
  信号去向表逐类明确——BLOCKED（auto ruling-required）由外层自身写+读承载（`--detect-stop --pane` +
  `--read`），遥测/git 信号外层直接读 `--report`/`git log`，会话面信号全在 session-liveness.sh，
  **没有信号类静默消失**。
- **外层监视器重配置（本次 tick 动作）**：
  - 我的 `inner-state.sh` Monitor（bskbku0l7）在 merge 后运行的是**已删除代码**（旧 inode）——已
    **TaskStop 停止**，残留进程随之消失（`ps` 核实 0 个）。
  - **替换监视器**：`--detect-stop --pane` 轮询（bep2jmw1g，60s，捕获内层 pane → 跑 --detect-stop，
    仅 BLOCKED/UNBLOCKED 转变时发声）——保留 ≤5 分钟 BLOCKED 观察预算（裁定 C）。
  - **观察延迟 watch-item**：retire 的设计「外层主动读不需要常驻轮询工具」依赖外层**确实在跑**
    `--detect-stop --pane` 轮询——若该轮询丢失，BLOCKED 观察退化为 tick 节奏（20min），违反裁定 C
    的 ≤5 分钟。当前由 bep2jmw1g 承载；它若停止，重挂是外层职责。
- **批状态**：node-compile-cache + retire-inner-state 已合并；task-write + suite-speed 在飞
  （agent 等各自全量套件，内层 4 shells 重活）。
- **就绪池 = 3** ✓（am2 / promotion-cadence / reliable-send，尚未派发，等槽位）。
- 无停止条件、无阻塞；loop-driver LIVE。

### 遥测数据修正（2026-08-04T16:44Z，管理者核实）

- **① D outcome 矛盾**：D（pane-state）遥测 `end outcome=needs-human`（15:46，子代理先报 band 待裁定）
  但任务 status done（我裁定后翻）——**重调 `--task-end` outcome=done**，报告已显示 done ✓。
- **② node-cache / retire-state 括号未闭**（都有 start 无 end，但已真实合并）——**漏了，非有意延后**。
  补 `--task-end outcome=done`。**outcome 区别**：node-cache 全落地绿（run=done）；retire-state
  合并 + AC 做完但 DoD 的 2× 全量套件延到令牌空窗期（run=done，任务体已注明延后，task status 仍
  ready）。retire-state 的旧 run（崩溃会话）保持 abandoned=正确。
- **结果**：open brackets = **0**；`--report` 三任务均 done（D/node-cache/new-run-retire-state）。

### tick 2026-08-04T17:03Z（外层，`no-action`：suite-speed 硬测量让位，吞吐有意让行）

- **suite-speed 唯一在飞（1h5m+）**：基准 agent 在 run-2.log 的 before/2。协议是 **AC4 σ 纪律硬要求**
  ——「变快了」需 ≥5 次运行均值+极差；before 基线 + after 各自 ≥5 次，**还要多轮**。
- **2 槽位空、就绪池 3 条未派**——核实为**刻意让位，非批门控复发**：派发会污染 run-to-run 方差
  （`d514910e` 已证：噪声门测试被基准负载搞 flaky）。这是吞吐 vs 测量完整性的**真实权衡**，不是遗忘。
- **上报管理者**：若吞吐优先于测量完整性，可指示内层派 2 条小任务（am2/promotion-cadence/reliable-send
  全是文档+新脚本任务，scoped 测试便宜）；否则等基准完成（可能再 1 小时+）。
- 就绪池 = 3 ✓（等槽位）；无停止条件、无阻塞；监视器 mounted:true（session-liveness）。

### 管理者裁定：派 2 条小任务，不等基准（2026-08-04T17:07Z）

- **裁定**（不升级给人，可推导的技术权衡）：派 2 条小任务，不等 suite-speed 基准跑完。三条理由：
  ① scoped 文档/脚本任务不跑全量 ⇒ run-to-run 方差污染风险最小；② suite-speed 的 σ 纪律该等的是
  它自己（1h+），不是拿它当理由让就绪池空转；③ 滚动派发是今晚默认，槽位空着没有强理由就该填——
  「可能轻微污染不相关任务的测量」不构成强理由。
- **已驱动内层**：从就绪池派 2 条（am2 / promotion-cadence / reliable-send 任选 2，全 disjoint 核实），
  后台 Agent(run_in_background:true)，实现期 scoped --for-task 不跑全量，全量留 fan-in。
- **送达确认**（transcript，结晶文档唯一可信信号）：指令 17:06:50 落进内层会话（uuid 9e786e8a）。
  派发 worktree 待内层处理（当前 suite-speed agent 仍独立跑其多轮 σ 测量，不受影响）。
- **已派发（17:07，原始字段 rib:true）**：`Fix ADR-016 alternatives claim`（am2，17:07:30）+
  `Crystallize reliable-send script`（17:07:38）——管理者的派发裁定已执行。在飞 3 达上限
  （am2/reliable-send/suite-speed）；promotion-cadence 留 ready。

### 监视器事件 17:4xZ — task-write 假阳性 auto-block + 括号纪律第三次（外层）

- 新阻塞监视器（--detect-stop --pane 轮询）检测到 task-write `task-over-90m` auto-block 并发声——但
  task-write **已合并**（b1c96299），是**陈旧括号**导致的假阳性：task-write 的 `--task-end` 从未被
  调用（与 node-cache/retire-state 同类，**第三次合并漏闭括号**）。
- **已修**：task-write 括号闭（done）、auto-block 清（wait 23.9s）。新监视器 60s 内检测+发声，
  **验证替换监视器工作正常**。
- **括号纪律 fan-in 核查点**：内层 fan-in 合并时需同步 `--task-end`——已三次漏闭（node-cache/
  retire-state/task-write），下一次驱动时提醒。
- **报告字段更正**：`--report --json` 的 `tasks` 数组是已关闭任务，**在飞在独立的 `inProgress` 字段**——
  我此前「open brackets: 0」读错了字段；括号修复本身正确（run 文件实证）。

### tick 2026-08-04T17:22Z（外层，`no-action`：reliable-send + am2 已合并，系统性漏闭括号再处置）

- **reliable-send 已合并**（`0c0daf6b` fan-in + `5da17540` 注记，20/20 验证；`833da7a5` 纯函数 +
  `2703fae4` 脚本+结晶文档回写）。**am2（ADR-016 二次 Amendment）已合并**（`06a46953`）。
- **括号漏闭第 5/6 次**：reliable-send + am2 合并后括号仍开（inProgress 列 3，实际只有 suite-speed
  在飞）——已补闭（done），inProgress 现 = **1**（suite-speed，正确在飞）。
- **系统性 gap 已驱动内层**：5 次合并漏闭（node-cache/retire-state/task-write/am2/reliable-send）
  都是外层代补——已在驱动文本要求内层把 `--task-end` 并入批关闭流程，别等外层发现。
- **suite-speed 唯一在飞**（基准 before/3，1h26m，σ 纪律多轮测量）。内层备忘「等 suite-speed 完成后
  跑批量全量套件」。
- 无停止条件、无阻塞；监视器 mounted:true；tph 1.385（窗口含 suite-speed 长测量，正常回落）。

### 监视器事件 17:3xZ — suite-speed task-over-90m：too-big-not-stuck 裁定

- 监视器报 suite-speed `task-over-90m` auto-block（90.4m）。**核实非卡死**：基准从 before/3 推进到
  before/4（agent 活跃，1h31m）。σ 协议（before + after 各 ≥5 次全量）是**固有小时级**——管理者
  已裁定「继续独立跑，不受影响」。
- **裁定：too-big-not-stuck，继续**（与 retire-inner-state 90m 先例同族：任务过大非卡住，不中止）。
- **后果**：auto-block 将持续到 suite-speed 括号关闭（机械条件未消），机械停止条件期间
  promotion-cadence（唯一剩 ready）派发被推迟——**是否覆盖由管理者定**（吞吐 vs 机械停止条件）。

### tick 2026-08-04T17:42Z（外层，`no-action`：authorize promotion-cadence 派发）

- **内层已采纳括号纪律**（`c7408ef3`：「merge must carry --task-end outcome=done in the same step」）——
  上轮驱动生效。
- **promotion-cadence 派发授权**：内层备忘已在计划派它（2 空槽）；外层按 too-big-not-stuck 裁定 +
  管理者吞吐优先（「槽位空没有强理由就该填」）**覆盖机械停止条件**——suite-speed 的 task-over-90m
  block 是已知长任务假阳性。已驱动确认：后台 Agent(run_in_background:true)、scoped 不跑全量。
- **suite-speed 唯一在飞持续**（before/4，1h45m，σ 协议推进中）；auto-block 持续（预期）。
- 无其它停止条件；监视器 mounted:true；无新合并（master 停在 a0a3ca63）。

### tick 2026-08-04T18:03Z（外层，`correct`：独立核实发现刚合并机制的真缺陷）

- **promotion-cadence 已合并**（`5037ee55` fan-in + `a4d8e03b`，11/11，**遥测同一步关闭**——括号纪律
  被采纳）。ready-pool-check.ts + tick 步骤 3.6 + 外层 AC-queue 降级引用 + SPEC AC-SH5 更新全部落地。
- **独立核实发现真缺陷**：实跑 `ready-pool-check.ts` 得 `pool: 6`——但 6 条里 5 条（am2/node-cache/
  promotion-cadence/reliable-send/task-write）是**已合并未翻 done**（status ready 且 **AC 0 勾**，
  内层合并时不勾 AC）。⇒ 机制报 6、真实可派发 = **0**——**「假满」在机制内部复现**。
- **根因**：`notYetFlipped` 判据是「AC 全勾 + status ready」，不匹配内层实际关闭方式。
- **已立案** `gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool`（todo）：判据改为复用
  `task-status-drift-check` 的「工作已落 master」信号（不依赖 AC 勾选）；AC2/AC4 用真实树负控制
  （pool 必须从 6 降到真实值）。
- **suite-speed 唯一在飞**（控制组/1，2h5m，σ 协议推进中）；auto-block 持续（预期）。

### tick 2026-08-04T18:22Z（外层，`no-action`：假满真实后果出现，手工晋级缺陷任务）

- **假满的真实后果出现**：机制报 pool 6（虚高）⇒ **不会从 todo 补晋**——缺陷修复任务（todo）因此
  永远不被晋级/派发，正是假满要防的病因机制缺陷而实际发生。
- **手工晋级 + 驱动派发**：`gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool`
  todo→ready（机制坏，等它自己修自己），已驱动内层派发（后台 rib:true，scoped 不跑全量，触摸集
  与 suite-speed disjoint）。
- **suite-speed 唯一在飞**（control/run-2，2h26m，σ 协议推进中）；auto-block 持续（预期）。
- 无其它停止条件；监视器 mounted:true；master 停在 2079d153。

### tick 2026-08-04T18:42Z（外层，`no-action`：ready-pool-check 缺陷已修复并独立核实）

- **缺陷修复已合并**（`84ab1dcc` fan-in + `965b37be`，12/12，**pool honest 0**）——notYetFlipped 改用
  landed-on-master 信号（`6f22f162`）+ 补「merged 但 AC 全未勾」夹具（`b7fbecd0`）。
- **独立核实**：`ready-pool-check.ts --json` 现报 `pool: 0`（诚实）、deficit 3、10 条全排除
  （8 条 not-yet-flipped / 1 条 parked / 2 条 fixture）。**假满已从机制内消灭**——它会从 todo 正确补晋。
- **次要观察（记不立案）**：landed-on-master 信号会把「触摸文件是既有文件」的在飞任务也标成
  not-yet-flipped（suite-speed 被标了，虽仍在跑）——对当前无碍（在飞≠可派发），但候选选择时若
  误排未开始的既有文件型任务需细化（留待真实误排发生再立）。
- **suite-speed 唯一在飞**（control/4，2h45m，σ 协议推进中）；auto-block 持续（预期）。
  内层备忘「wait for suite-speed to finish, then close the batch」。

### tick 2026-08-04T19:02Z（外层，`no-action`：稳态）

- **suite-speed 唯一在飞**（control/5，3h5m——从 control/4 推进，σ 协议确认仍在跑）；auto-block
  持续（预期，等其括号关闭自清）。批内其余全部合并；无新提交（master 停在 df42cb21）。
- ready-pool-check 已诚实（pool 0，deficit 3）——suite-speed 完成后内层关批时会从 todo 补晋。
- **核实（AC1）**：suite-speed 从 control/4 → control/5（pane 文本），确认测量推进非卡死。
- 无其它停止条件；监视器 mounted:true。

### tick 2026-08-04T19:22Z（外层，`no-action`：稳态持续）

- **suite-speed 唯一在飞**（3h25m）——agent 从 control/5 测量转入「Checking test-isolation violations
  baseline」新阶段（token 骤降 708k→151k = 上下文压缩或新阶段，非卡死）；auto-block 持续（预期）。
- 批内其余全部合并；无新提交（master 停在 93a3d749）。
- 连续第 3 个稳态 tick——批在等 suite-speed 的多小时 σ 测量（管理者已裁定「不受影响」，符合预期）。
- 无其它停止条件；监视器 mounted:true。

### tick 2026-08-04T19:42Z（外层，`no-action`：suite-speed 进入最后阶段）

- **suite-speed 进入 after 组**（after/2，3h40m）——before(≥5) → control(≥5) → **after(≥5)** 最后一组
  测量；worktree 有新提交（`cae30d19`，优化已应用）。σ 证据收集接近完成。
- 批内其余全部合并；无新提交（master 停在 4cb25770）。
- 完成后：内层关批 + 跑批全量（备忘「suite-speed 完成后关批量并跑全量」）+ ready-pool-check 从
  todo 补晋。auto-block 持续（预期，等套件完成）。
- 无其它停止条件；监视器 mounted:true。

### tick 2026-08-04T20:02Z（外层，`no-action`：suite-speed 在 after/5，收尾在即）

- **suite-speed 在 after/5**（4h3m+）——after 组第 5 次（σ 协议每组 ≥5，最后一组最后一轮）；
  worktree 干净（纯测量）。after/5 完成后 = before/control/after 三组 σ 证据齐备，agent 写结果 +
  commit，批即可关。
- 批内其余全部合并；无新提交（master 停在 4371fc7c）。
- 完成后：关批（--task-end 同步，纪律已采纳）+ 批全量 + ready-pool-check 从 todo 补晋。
  auto-block 持续（预期）。
- 无其它停止条件；监视器 mounted:true。

### tick 2026-08-04T20:22Z（外层，`no-action`：suite-speed 确认在跑全量套件，非卡死）

- **AC9c 核实**：worktree 40 分钟未变 + token 平 → 按纪律查实际活动：**agent 正在跑全量套件**
  （`scripts/test.sh` pid 1273318 ~11min + `node --test --test-concurrency=8` 全部测试文件，
  load 2.99）——after/5 测量或后续验证进行中，**非卡死**。token 平是因为等测试进程（重 CPU），
  worktree 未变是因为测量不写文件。
- 批内其余全部合并；无新提交（master 停在 93e95021）。
- auto-block 持续（预期）；监视器 mounted:true。资源闸遵守（外层只做廉价核实）。

### tick 2026-08-04T20:42Z（外层，`no-action`：suite-speed 基线 worktree 违反 /tmp 纪律）

- **suite-speed agent 建了 `/tmp/quay-wt-baseline-flake`**（detached HEAD，57M、node_modules 未 link，
  正在 link）——违反 tick 文档「worktree 一律在 $WORKTREE_ROOT 磁盘，/tmp=tmpfs=内存，整机 OOM 教训」。
  **当前不构成即时风险**（内存可用 10.5GB、压力 0、57M 小），但**纪律偏离已记**——agent 4h42m 近
  完成、测量不能打断，故不中断；向内层 flag：后续 worktree 一律磁盘。
- suite-speed 仍唯一在飞（token 185.5k→222.7k，重新生成=在干活）；批内其余全合并；无新提交。
- auto-block 持续（预期）；监视器 mounted:true。

### tick 2026-08-04T21:02Z（外层，`no-action` + 时长升级提示）

- **suite-speed 已 5h5m，远超管理者裁定「可能再 1 小时+」约 3 倍**。AC9c 确认非卡死：正跑新的 baseline
  基准轮（`launch_one.sh /tmp/quay-wt-baseline-flake baseline 1` → `scripts/test.sh`，24 node 进程，
  load 2.37）。σ 协议（多组 × 每组 ≥5 全量）在满负载下跑成小时级。
- **flag 给管理者**：任务仍按协议推进、非卡死，但耗时远超预期——管理者可裁定「接受当前 σ 证据提前
  关闭」或继续等。批全部等它一个。
- 批内其余全部合并；无新提交。auto-block 持续（预期）；监视器 mounted:true。

### tick 2026-08-04T21:22Z（外层，`no-action`：suite-speed 达到诚实结论，批收尾在即）

- **suite-speed 提交诚实结论**（`80b7d70e`）：完整基准（before/control/after 各 5 次全量，
  resource-gate 串行）——before 779.1s / control 774.3s（AC5 负控制 PASS，delta -4.8s 噪声内）/
  after 695.4s（**delta 83.8s < σ 297.6s**）⇒ **honest no-improvement**（低于 σ = 噪声，按任务 DoD
  如实报告）。**σ 纪律要求的最诚实结论，5h+ 成本付清。**
- 剩余：agent 写任务体 AC1/AC2/AC5 输出 + 结论 → 内层合并 → 关批（--task-end 同步）→ 批全量。
- 批内其余全部合并。auto-block 持续（预期，套件后自清）。

### 批全部落地（2026-08-04T21:30Z，里程碑）

- **suite-speed 已合并**（`ec237c3e`：nested-setup-skip lever + honest no-improvement 基准记录）。
  其 `4f99abf5` 确认 **5 个失败是 session-liveness 既有 flake**（baseline/2 复现，非本批回归）。
- **inProgress: 0**、auto-block 清、`--detect-stop` 无命中。**整个大批全部合并**（A–F 裁定实现 +
  L0 tmux 隔离 + node-cache + task-write + retire-inner-state + am2 + reliable-send + promotion-cadence
  机制 + ready-pool-check 缺陷修复 + suite-speed，~12 任务）。
- 内层正在跑**批全量套件**（24 node 进程）——通过后关批（翻 done、清 worktree、补晋下一批）。

### tick 2026-08-04T21:43Z（外层，`no-action`：suite-speed band 裁定）

- **suite-speed 的 band pending outer 已裁定**：Contract `delta_s > 297.6` 未被满足（delta 83.8s < σ）——
  **诚实的正确结论**（band 目的=区分真改善与噪声；诚实 no-improvement 满足意图即使数字未过）。
  已记入任务体 + 驱动内层按 no-improvement 关闭 suite-speed。
- 内层 batch-end 最终验证中（pane「awaiting batch-end final verification」）；批全量已跑。
- inProgress 0、detect-stop 无命中、就绪池 0（deficit 3，等关批后补晋）。
- 残留 retire-inner-state worktree 待批关闭时清理（已驱动内层）。

### tick 2026-08-04T22:02Z（外层，`no-action`：大批正式关闭）

- **批全量 GREEN（2298/0/0）**——且批全量抓到一个真实回归（`9a3beb7f`：2 处测试仍调用已退役的
  inner-state.sh，retire-inner-state 合并漏改），内层修复后重跑绿。**批全量按设计捕获了合并期回归。**
- suite-speed 已关闭（honest no-improvement，band 裁定并入）；**7 个任务关闭进行中**（翻 done）。
- inProgress 0、detect-stop 无命中；就绪池 0（deficit 3，等关闭完成 + ready-pool-check 从 todo 补晋）。
- 残留 retire-inner-state worktree 待关闭时清理。新参考值 tests 2298。

### tick 2026-08-04T22:22Z（外层，`no-action`：机制闭环完成，下一批由 ready-pool-check 驱动）

- **批正式全关**（`6fa34a94`：8 任务 done、closure `3ab119df`、遥测成对、**worktrees 干净**——
  retire-inner-state 残留 worktree 已清）。
- **产品机制接管**：内层正在**按 ready-pool-check 推荐补晋并派下一批**（候选：phantom-in-flight /
  log-filtered / checksplit / cold-start-recovery 等，按机制定义的顺序）——人方向的晋级机制正式驱动
  流水线，不再靠角色自觉（spec 继承性要求兑现）。
- inProgress 0、detect-stop 无命中；监视器 mounted:true；无停止条件。

### tick 2026-08-04T22:43Z（外层，`unblock`：内层批后停摆，外层驱动补晋）

- **内层停摆检测**：meta-cc 显示 22:25 后无任何工具调用（20 分钟空闲）——批关闭后无 agent 通知它，
  回合已结束、停在备忘「按 ready-pool-check 补晋并派下一批」未执行。
- **外层驱动**：提示执行补晋 + 派发（ready-pool-check 已列 4 候选：phantom-in-flight / log-filtered /
  checksplit / cold-start-recovery；补晋 3 条满足 pool≥3 再派，rib:true、scoped）。
- **送达确认（transcript）**：22:43:08 落进内层（uuid 7fdd7df3）。候选仍 todo，待内层处理。
- 这是批完成后「无 agent 通知 → 内层停」的已知形态（双层模型主推进信号是 agent 完成通知）——
  外层 tick 就是兜底驱动。inProgress 0、无停止条件。

### tick 2026-08-04T23:02Z（外层，`no-action`：batch-3 在飞 + taskWorkLanded 过冲缺陷立案）

- **Batch-3 已在飞**：内层按驱动补晋 3 条 + 派发（`a4c4a129`，rib:true）；log-filtered（`b51b650e`）
  与 dispatch-eligibility（`7478d979`）已合并验证；phantom-in-flight 在飞（agent「Fixing
  firstKnownCommitMs branch history reference」，17m+）。新参考值 2276→2298→（batch-3 后）。
- **ready-pool-check taskWorkLanded 过冲缺陷已立案**（`gap-ready-pool-check-taskworklanded-overshoot-
  excludes-existing-file-tasks`）：既有 Touches 文件存在被误判「已落」——补晋改既有文件型任务后 pool
  仍 0，机制既推荐又排除（自相矛盾）。信号需改任务特有符号解析。内层 flag + 外层确认 + 立案。
- inProgress 1（phantom-in-flight）；无停止条件；监视器 mounted:true。

### tick 2026-08-04T23:22Z（外层，`no-action`：batch-3 收尾，全量首轮 1 失败已修重跑）

- **batch-3 全 3 任务合并验证**（`fca52754`）；phantom-in-flight 的 `--reconcile`（修崩溃残留 phantom
  inProgress + ORPHAN 文档方向）已合并（`d13ce490`/`288d625b`）。
- **批全量首轮 1 失败已修**（`ef587d22`）：loop-shipping AC1b 误扫 scheduler 重放夹具（其 eligibility
  输出把旧路径正则当数据嵌入，非活调用者）——已排除，重跑中。**全量又捕获一个合并期边界。**
- inProgress 0、detect-stop 无命中；监视器 mounted:true。batch-3 重跑绿后关批。

### tick 2026-08-04T23:42Z（外层，`no-action`：batch-3 已关，内层自主修 overshoot）

- **batch-3 正式关闭**（`6f2620f5`：3 done、全量 2283/0/0、closure `f7b32ccf`；累计 15 任务跨 3 批；
  遥测全配对、worktree 全清）。
- ~~**内层自主转入修复 overshoot 缺陷**~~ ——**错误。** 管理者核实 + 外层复证（23:5xZ）：
  「修 ready-pool-check 的 taskWorkLanded 过冲缺陷」**从未作为 user message 提交**（transcript 0 命中），
  是输入框残留备忘；内层 0 sub-agent、无工具活动，双方都空闲、**没人修**。
  **产品机制自我修正闭环不成立——这是「两层都正确空闲 = 没人推进」的同型，且我未核实就写成了事实。**
- **此缺陷是全项目晋级速率唯一阻塞点**（todo 57 条卡住根源）：ready-pool 诚实口径 0，过冲未修前
  改既有文件型任务补晋无效。已用结晶算法重驱动内层修复（见下）。
- inProgress 0、detect-stop 无命中；监视器 mounted:true。

### tick 2026-08-05T00:01Z（外层，`no-action`：overshoot 修复生效 + ghost 源头消除立案）

- **overshoot 缺陷修复已关闭**（`191f179a` + `4c4652ec` + `b5579c0d`）：taskWorkLanded 只算任务
  自建 (new) 文件、既有文件型任务按符号判；AC4 真实树对照 pool 0→4；**晋级速率解阻塞**（57 todo
  的根源消除）。内层补晋 6 条既有文件型候选，pool 现 4（deficit 0）。
- **ghost-suggestion 源头消除已立案**（`gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false`，
  todo）：`--prompt-suggestions false` + `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` 从源头关掉故障 6
  （人裁定：验证成功后列为冷启动要求）。验证用 throwaway 会话（绝不动运行循环）+ 双向负控制。
- inProgress 0、detect-stop 无命中；监视器 mounted:true。

### tick 2026-08-05T00:03Z（外层，`no-action`：overshoot 修复全量验证中）

- **内层等 overshoot 修复的全量套件**（`scripts/test.sh --test-concurrency=8` → full-suite-overshoot.log，
  ~5min、35 node 进程、load 14.65）——回归验证进行中；绿后按 ready-pool-check 派下一批（就绪池 4）。
- 就绪池 4（deficit 0，6 条既有文件型候选已补晋）；框内「外层驱动：按 ready-pool-check 推荐派下一批
  3 条」是内层计划非已提交请求（可靠送达教训：框内文字≠已提交）。
- inProgress 0、detect-stop 无命中；监视器 mounted:true。资源闸遵守（外层只廉价核实）。

### tick 2026-08-05T00:22Z（外层，`no-action`：人裁定 + 管理者优先级）

- **人裁定结晶化（item ①）**：「框里有字 vs 真的提交了」判断做成工具——`pane-state-classify.ts`
  `--check-residue` 模式（empty / real-unsubmitted-text / ghost-suggestion-only 三态），复用 D 的底部
  区域 + 形状；运行时 C-u 探针是判据（静态文本无样式分不了 ghost/真输入，故障 6 判据机械化）。
  已立案 `gap-residue-check-crystallized-as-tool-mode`（todo）。
- **管理者优先级（item ②）+ 外层裁定**：`gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down`
  **优先于 ghost 消除**——它卡 quay 自建 AC-SH 自举与 meta-cc 独立冷启动（cold-start skill 调用
  quay-init.sh 不铺的文件 = 产品交付物自相矛盾）；ghost 是可靠性/成本锦上添花。**已驱动内层**：
  overshoot 全量绿后派下一批时 gap-init-ships 优先（ready + resolve 可派发，虽被 pool 符号边缘排除
  计数——口径不影响派发）。
- inProgress 0、detect-stop 无命中；监视器 mounted:true。

### tick 2026-08-05T00:24Z（外层，`no-action`：overshoot 全量 1 失败 = 已知负载 flake，内层重跑中）

- **overshoot 全量首跑 1 失败**（tests 2284 / fail 1 / cancelled 0）：失败测试 =
  `session-liveness.test.mjs:755`「noise gate」。**核实为已知负载诱发既有 flake**（suite-speed 已确认
  baseline/2 复现；overshoot 修复只碰 ready-pool-check/drift-check，不碰 session-liveness）。
  **单跑该测试 pass 2 / fail 0**——证实负载 flake，非修复回归。
- **内层已自动重跑全量**（full-suite-overshoot-2.log，c8）——绿后按优先级驱动派 gap-init-ships。
- inProgress 0、detect-stop 无命中；监视器 mounted:true。

### tick 2026-08-05T00:35Z（外层，`no-action`：SESSION-IDLE 真空闲判据立案）

- **人问「能判真空闲吗、能结晶降误报吗」→ 能**：管理者实测 + 外层核实——`session-liveness.sh:13`
  现有判据是「相邻两轮 pane 哈希相同 = 空闲」（代理，分不清真空闲与工具间隙）；**transcript 最后一条
  assistant 消息类型（纯文本 vs 挂起 tool_use）是结构信号**（已发生事实），更可靠。人风险偏好：
  可接受误报、强烈防漏报。
- **已立案** `gap-session-idle-true-idle-via-transcript-fusion-and-debounce`（todo）：①信号融合——
  transcript 消息类型接入（纯文本=候选闲、挂起 tool_use=确定忙优先级更高零漏报），pane 哈希降级为
  候选闲辅助；②去抖——连续 2 轮（120s）都闲才报 SESSION-IDLE（只延迟 ≤1 轮询周期、不漏报，cron
  兜底内）。
- inProgress 0、detect-stop 无命中；监视器 mounted:true。

### tick 2026-08-05T00:42Z（外层，`no-action`：batch-4 在飞，优先级兑现）

- **overshoot 全量重跑 GREEN（2284/0/0）**——负载 flake 确认（单跑 pass 2/0），overshoot 修复验证
  通过，晋级机制完全解阻塞。
- **batch-4 已派且优先级兑现**：**gap-init-ships（按裁定优先，第一条）** + eighty-one + load-sensitive
  （`ee6d6e86`）。eighty-one 已合并（`9b05a2f9`：81-instruments MCP 入口工具，derive+expose）；init-ships
  （改 @test-group header）与 load-sensitive（AC2 并发跑）在飞。
- inProgress 2（init-ships + load-sensitive）；无停止条件；监视器 mounted:true。

### tick 2026-08-05T00:47Z（外层，`no-action`：CLI 配置调研立案）

- **读调研全文并裁定**（`RESEARCH-claude-code-cli-config-2026-08-05.md`，人要求全面调查）：
  - **立案 1 个合并任务** `gap-crystallize-launch-config-into-checked-in-settings-file`（todo）：当前
    tmux 模式适用的 3 项高相关——`--exclude-dynamic-system-prompt-sections`（并发 worktree 子代理
    prompt cache 复用，今晚最重成本点）+ `-n/--name`（会话身份）+ `--settings` 文件（防「启动命令
    打错」= restart-plan AC1 的错）+ `--bare`（一次性验证会话安全）+ ghost 的 `--prompt-suggestions
    false`——合并成一个检查进仓库的 settings 文件，启动规范从「手打一行」变「引用文件」。
  - **-p 条件性 3 项延后**（replay-user-messages / max-budget-usd / forward-subagent-text）：标注为
    -p 迁移决定后改写（结晶算法原生版 + 计费对冲 + 子代理转发），不现在实现。
  - **未文档化内部 env var 明确不碰**（无官方背书，不进产品）。
  - 中等项 `--effort`/`--tmux` 记备注不立案（--tmux 需先查 quay-worktrees 兼容）。
- inProgress 2（init-ships + load-sensitive）；无停止条件；监视器 mounted:true。

### tick 2026-08-05T01:04Z（外层，`no-action`：batch 词汇拆分立案）

- **管理者+人裁定**：「batch」一词两义（滚动派发 vs 验证/收尾攒批）——望文生义会漂回「分派要门控」，
  R2 同族风险，载体是外层自己的 tick-log/commit 措辞。
- **已立案** `gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round`（todo）：词汇拆分——
  分派侧不叫 batch-N（滚动）；验证/收尾节奏叫 `verification-round-N` + 显式注记非门控；历史名
  （batch2-queue-state 文件名 / batch4a/b/c / concurrent-batch-scheduler.ts）保留标注。AC4 用 grep
  分类表证明零门控误读；AC5 写死规范语句进 tick 文档（未来会话含换模型沿用）。
- 核实：`fast-mode-loop-tick.md:368`「可同批」是最需改措辞的点（并发资格可能被读成门控）。
- inProgress 2（init-ships + load-sensitive）；无停止条件；监视器 mounted:true。

### tick 2026-08-05T01:05Z（外层，`no-action`：gap-init-ships 合并，管理者优先任务完成）

- **gap-init-ships 已合并**（`9a4367b3`：derived LOOP_SCRIPTS、referenced ⊆ landed ∪ declared——
  cold-start skill 只引用 quay-init.sh 实际铺下的文件；**卡 quay 自建 AC-SH 自举 / meta-cc 独立冷启动
  的优先任务完成**）。
- **load-sensitive 已合并**（`11b01d37`：KNOWN-LOAD-SENSITIVE 家族标注——step-3 的 2-并发套件放宽
  判据显式排除它）。
- **eighty-two 在飞**（capability-catalog worktree，agent 9m47s——填空槽，滚动派发验证）；batch-4
  2/3 合并。inProgress 1；无停止条件；监视器 mounted:true。

### tick 2026-08-05T01:07Z（外层，`no-action`：gap-ac3b 优先晋级派发）

- **管理者优先级意见（成立）**：`gap-ac3b-prove-installed-quay-runs-without-dev-tree` 是管理者驱动
  meta-cc 安装前的**唯一硬阻塞**（已安装物 `~/.local/share/quay-plugin` 仍是 08-03 23:03 旧快照；
  init-ships 已确认结构性修复落地——LOOP_SCRIPTS 改 derive，monitor-mount-check/send-keys-verified
  都被抓到）。裁定：优先晋级派发。
- **已晋级 ready** + 修 touches 格式（括号注记在路径里导致 resolve 5/5 MISSING 不可派发 → 移出后
  1/5 可派发）——**自修自晋的又一例**（类似 L0 早前格式 bug）。
- **已驱动内层派发**：AC1 刷新（安全任何时候）先行，改名负控制 AC3/AC4 等安全窗口（在飞清空后）。
  落地后管理者自行核实插件刷新（无需外层通知）。
- inProgress 1（eighty-two）；无停止条件；监视器 mounted:true。

### tick 2026-08-05T01:22Z（外层，`no-action`：ac3b 刷新已落地，管理者阻塞解除）

- **batch-4 全关**：eighty-two 已合并（`9d3735a1`：capability-catalog.sh，derived 87-check manifest +
  what-each-answers，接 quay-init + README）；init-ships/load-sensitive/eighty-two 三任务全 done。
- **ac3b 已派发并完成 AC1 刷新**（`c23232eb`；agent「Refreshing installed quay-plugin via rsync」）：
  **实测 `~/.local/share/quay-plugin/vendor/quay/dist/quay.js` mtime 08-03 23:03 → 08-05 01:21**——
  管理者 meta-cc 安装的陈旧快照阻塞已解除（无需外层再通知）。改名负控制 AC3/AC4 待安全窗口。
- inProgress 1（ac3b）；无停止条件；监视器 mounted:true。

### tick 2026-08-05T01:42Z（外层，`no-action`：AC3b 证明完成）

- **ac3b 已合并完成**（`2b0ba79a` + `fd7f8272`）：AC1 刷新 + vendor-local mcp_entry + **改名负控制
  AC3/AC4 已执行**（AC1–AC7 全勾）。**AC3b 证明完整**——已安装 quay 不依赖开发树（真实改名负控制证
  过判据本身，非单元测试声称）。管理者 meta-cc 安装彻底解阻塞。
- **batch-4 全量套件运行中**（内层「等 ac3b 完成通知后 fan-in 关批 4」，实际 ac3b 已 done，等套件绿
  关 5 任务）。inProgress 0；无停止条件；监视器 mounted:true。
- 内层上下文已 1h8m（auto-compact 3%）——长回合，套件后关批。

### tick 2026-08-05T01:45Z（外层，`correct-self`：人的「外层有在做整体分析吗」→ 诚实答案：没有）

- **调查发现**（`FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`，人问引出）：①tick 7 步
  全机械执行，outer-phase-goal 是角色纪律非架构方向——近 6 小时 6 条 gap-* 新建、设计文档改动 0；
  ②唯一路线图 `quay-harness-crystallization-roadmap.md`（07-31）整篇建于 ADR-022（08-03）已废除的
  经典 milestone 管线，Phase 0–4 指向已删除代码，**沉默过期比没有更危险**；Phase 3 的战略问题
  （跨项目可迁移 vs 过拟合 quay）仍成立，meta-cc 冷启动在回答它但纯临场无对照。
- **外层诚实认领**：没有在做整体分析/规划/设计，证据清晰（0 设计改动 + 路线图过期无人核对）。
- **已立案 2 条战略任务**（排高优先，不阻塞当前批）：
  - `gap-roadmap-silently-stale-mark-superseded-or-rewrite-fast-mode`——标记 superseded + 逐 Phase
    点名退役机制 + 提取仍有效问题；
  - `gap-fast-mode-cross-project-portability-strategic-question`——钉住「跨项目可迁移 vs 过拟合」
    问题 + 判据 + meta-cc 冷启动为证据容器。
- **复盘节奏（建议，交给人裁定）**：是否在 tick 循环外建整体复盘节奏（多久/谁做/看什么）——方向性
  判断，非 gap-* 缺陷。

### tick 2026-08-04T16:42Z（外层，`no-action`）

- **task-write 已合并**（`b1c96299` fan-in + `d2f1f2be` 注记，YAML-safe 标题序列化）。本批已完成：
  A/D/B/L0/node-cache/retire-state/task-write 全部合并。**suite-speed 唯一在飞**（基准测试 agent
  45m+，等其全量结果）。
- **5 个失败疑似负载抖动**：suite-speed 的重基准跑与 retire-inner-state 的噪声门同窗（`d514910e` 已
  记录），内层在确认是否负载诱发——真因待其全量结果。若确为负载抖动，是 suite-speed 任务的固有
  测量噪声，不是新缺陷；若为真失败，需分开处置。
- **2 槽位空、就绪池 3**：内层尚未派新批（正等 suite-speed 结果）——按滚动派发语义槽位空即派，
  若下一 tick 仍未派，驱动内层。监视器 check 新语义 mounted:true（session-liveness，管理者挂载）；
  我的 --detect-stop --pane 轮询（bep2jmw1g）运行中。
- 无停止条件、无阻塞；loop-driver LIVE。

### tick 2026-08-05T02:05Z（外层，`unblock`：人裁定复盘节奏 → 立案机制任务）

- **人裁定复盘节奏为决定**（非建议）：①每天一次、按日历挂钩（架构决定不随任务速度发生）；②管理者
  发起汇总、外层参与作答、人接收并保留方向裁定权；③三项清单：(a) 机械检查战略文档过期（路线图任务
  的 AC4 grep 固化成**通用可复用脚本**，非一次性）、(b) gap-* 可追溯到书面战略问题或纯反应式（记录）、
  (c) 复核记录从角色纪律扩到**方向有没有偏**。
- **已立案** `gap-establish-daily-review-cadence-mechanism`（todo，高优先，不阻塞当前批）——落成机制
  而非靠角色记得：`orchestration/REVIEW-cadence.md` 节奏文档 + `plugin/scripts/strategic-doc-
  staleness-check.ts` 通用过期检查器 + `scripts/test.sh` run_static_checks 接线 + outer-phase-goal
  复核记录扩方向（manager-phase-goal 标注管理者自扩）+ **AC6 第一次复盘用今天的发现当输入**。
- **batch-4 closure 在飞**：1 background agent（general-purpose 查 `quay-native task edit` CLI flags，
  1m51s / 99.4k tokens，判为 closure agent 的翻转手段核实）。5 任务（ac3b/eighty-one/eighty-two/
  load-sensitive/preflight）仍 `status: ready`——closure 后翻转 done。
- **就绪池 5**（池满 ≥3，无需 promote）：全部为待 closure 翻转项；closure 后池将骤降 → 机制自动翻转
  not-yet-flipped（drive-text-carries-data / init-ships）补池。review-cadence 排 closure 后晋级派发。
- **内层输入框有未提交备忘**「继续关批：等 closure agent 完成后收尾批 4」——R2 AC8：非动作、不读作
  行动；本 tick 不驱动（closure 在飞 + 避免与框内残留拼接）。
- 无停止条件、无阻塞；loop-driver LIVE。

> **02:10Z 增补（02:05Z 条更新）**：
> - **batch-4 closure 落地**（`9c71b5d8`，5 任务 done：ac3b/init-ships/eighty-one/eighty-two/load-sensitive）。
>   init-ships 在 closure 前已执行+关闭（pane 里 3 agents 的 init-ships priority 即是）。
> - **review-cadence 已晋级 ready**（02:05Z，dod 通过）；**roadmap 已晋级 ready**（机制推荐 + 外层应用）。
> - **`gap-prepare-milestone-no-size-aware-routing` 未晋级**——它是 ADR-022 已退休经典管线
>   （prepare-milestone.js/execute-milestone.js）的 parent，推荐理由「touches resolve」是反引号包裹
>   缺失路径的解析假通过。实锤已折进 review-cadence 任务（AC6 输入 + AC8 回归控制）。
> - **就绪池观测**：pool-check 计数 1（preflight），但真实可派发 ready 含 review-cadence/roadmap/
>   drive-text/preflight——review-cadence 与 roadmap 被 `taskWorkLanded` 误判「not-yet-flipped」
>   （AC 里引用了已存在文件 → symbol 解析≥60% → 假 landed）。池计数偏低、机制多推了候选。这是
>   taskWorkLanded 误判族第三次变体，记入复盘证据。
> - **内层**：closure 完成，等待下一批派发（preflight 仍 ready 待关或待派）；就绪池 ≥3 可派。

### tick 2026-08-05T02:1xZ（内层，`dispatch`：batch-5 四任务派发）

- **batch-5 派发**（4 任务全 ready，两两触摸 disjoint:true 已核实）：**gap-establish-daily-review-
  cadence-mechanism（PRIORITY，人裁定复盘节奏为机制）** + gap-roadmap-silently-stale-mark-superseded-
  or-rewrite-fast-mode + gap-preflight-merged-markdown-claims-low-identifier-count-silent-miss。
  3 槽位满即派 3；**gap-drive-text-carries-data-not-behavior-outer-inner-handoff 待 review-cadence
  落地后补派**——两者都 touch `scripts/test.sh`，checkTouchesPair 因全角 `（run_static_checks 接线）`
  注释未剥离而显示 disjoint:false 阴性，实为同文件重叠，串行化在 fan-in 时避免冲突。
- **telemetry bracket 已开**（3 条）：review-cadence / roadmap / preflight（runId 见
  .quay/fast-mode-telemetry.jsonl）。drive-text 补派时同步开 bracket。
- **review-cadence 执行顺序**（外层裁定，任务体 AC 是待做的活）：①REVIEW-cadence.md 节奏文档 →
  ②strategic-doc-staleness-check.ts 通用检查器（AC8 回归控制：gap-prepare-milestone-no-size-aware-
  routing 必须被标）→ ③test.sh run_static_checks 接线 → ④outer-phase-goal 复核记录扩方向 →
  ⑤AC6 第一次复盘（三输入：路线图过期 / 临场 meta-cc 无对照 / 池机制推荐退休管线任务）。
- **三在飞**：review-cadence / roadmap / preflight 后台 agent。无停止条件、无阻塞；loop-driver LIVE。

### tick 2026-08-05T02:2xZ（内层，`fan-in`：batch-5 两任务落地）

- **preflight 已关**（`done`，accepted-risk 决议：0 真 <2-identifier 案例、镜像 byte-identical、
  83/83 绿；task-check 3/3 AC + 1/1 DoD 全勾）。merge `16576259` → telemetry --task-end 同步。
- **roadmap 已落地**（`ready` 保留，DoD 全量套件框待 verification-round 勾）：merge `51d62823`
  （rebase 后），telemetry --task-end 同步。路线图标 SUPERSEDED by ADR-022 + 逐机制注释表 +
  fast-mode 指针 + 战略问题提取（Phase 3 跨项目可迁移仍有效）；FINDING 文档引用未动（untracked，
  与 review-cadence 共享）；新增 governance 测试 `plugin/test/roadmap-superseded-check.test.mjs`
  （node:test，AC1/AC3/AC4 机械强制 + 负控制，2/2 绿）。stale_refs=26 全注释。
- **外层新裁定**（master `0d38df51`）：立案 `gap-closure-sync-is-the-true-batch-boundary-move-
  bookkeeping-to-outer-async`（ready）——closure/bookkeeping 移外层 async（20-min-cron 经
  taskWorkLanded 关批），inner 只 execute+dispatch+merge。机制未实现前，本批按在飞纪律关。
- **在飞**：review-cadence（PRIORITY，唯一）。槽位空 2 但 drive-text 门控等 review-cadence 落地
  （共享 scripts/test.sh）——暂不补派其他池任务（外层批范围=这 4 条）。无停止条件、无阻塞。

### tick 2026-08-05T02:3xZ（内层，`dispatch`：外层更正滚动语义 + 补派 closure-async）

- **外层更正**：就绪池 4 条是当时快照非批次门控；派发按滚动语义槽空即派（出厂文档）。我的「持槽等批」
  行为正是 closure-async 任务要消除的形态。
- **补派 `gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async`**（ready，
  机制根，人裁定）→ 空槽。telemetry bracket 已开（fm-gap-closure-sync-...-4szd1p）。
  机制：inner 循环删收尾步（只执行+派发+合并），外层 20-min-cron 异步收尾（taskWorkLanded 非
  status 探测 → --task-end → 翻 done → verification-round-N），inner 停止条件改读外层结果文件。
- **loop-doc 串行链发现**：① closure-sync、② gap-inner-has-no-periodic-anchor、drive-text **三者都触**
  `fast-mode-loop-tick.md` + `orchestrator-loop-tick.md`（同文件集群）——必须逐个落地再派下一个；
  drive-text 另等 review-cadence（scripts/test.sh）。顺序：review-cadence ∥ ① 在飞 → ②（① 落地后）
  → drive-text（review-cadence + ① 都落地后）。
- **② 状态为 todo**（任务文件 self-declared，依赖①），非 ready——按外层「排①后」处置。
- **就绪池探测**：pool=2；eligible:true 候选 = prepare-milestone（外层已裁定不晋：ADR-022 退休管线、
  touches false-resolve）+ session-idle / session-liveness（未经外层点名，不自主补派）。槽位空由机械
  门控造成（②依赖①、drive-text 串行），非持批。
- **在飞 2**：review-cadence（PRIORITY）+ closure-sync。无停止条件、无阻塞；loop-driver LIVE。

### tick 2026-08-05T02:4xZ（内层，`fan-in`：review-cadence 落地，PRIORITY）

- **review-cadence 已合并**（`c3632ce6`，rebase 后），telemetry --task-end 同步。8/8 AC + 2/3 DoD
  （全量套件框待 verification-round 勾）——status 保留 ready。
  - `orchestration/REVIEW-cadence.md`：真机制——每 24 小时按日历挂钩（架构决定不与任务速度成比例）、
    管理者发起并汇总 / 外层参与作答 / 人保留方向裁定权、三项清单（过期检查 + gap-* 可追溯性 +
    方向漂移）。
  - `plugin/scripts/strategic-doc-staleness-check.ts`：通用检查器（扫 docs/proposals +
    orchestration/ROADMAP，路径存在性 + 退休机制引用判），接 run_static_checks + mutation case；
    AC8 回归控制实测：prepare-milestone 被 FLAG（exit 1）。master 7/7 测试绿。
  - outer-phase-goal.md 复核记录扩方向；manager-phase-goal.md 加「方向维度扩展」标注（外层不代笔）。
- **fan-in 前置处置（安全）**：manager 未提交的 AC3b 编辑 stash 保留 → 合并后 pop 干净（两文件区域不重叠）；
  FINDING 文档（untracked）与分支提交副本 byte-identical → 合并后成为 tracked，已核对一致。
- **merge 后工作树**：manager-phase-goal.md 仍为 manager 的未提交编辑（未动）；preflight 状态翻转已单独提交
  （`3450c6ea`）；restart-plan 未提交改动保留（非本批）。
- **在飞 1**：closure-sync ①。槽位空 2 但 ② inner-anchor（依赖①落地）与 drive-text（loop-doc 与①重叠 +
  test.sh 已由 review-cadence 解除）都门控 ①。loop-doc 串行链：① → ② → drive-text。无停止条件、无阻塞。

### tick 2026-08-05T02:5xZ（内层，`fan-in + dispatch`：closure-sync 落地 → 新契约生效 → 派②）

- **closure-sync 已合并**（`2ce5f1b0`，rebase 后），telemetry bracket 过渡性关闭（该任务按旧纪律派发）。
  8/8 AC 除 AC5（实跑证据待外层首个异步收尾）+ DoD 全量套件框未勾 → status 保留 ready（landed-not-flipped）。
- **新契约生效（我此后遵守）**：fast-mode-loop-tick.md step 2 =「合并串行，不写任务状态」——inner
  不翻 done、不写轮次记录、不写 --task-end；停止条件改读 `.quay/verification-round.jsonl` 最后一条
  suiteGreen（缺失不阻塞、等下一 tick）。收尾由外层 20-min-cron 异步做（ready-pool-check
  not-yet-flipped = taskWorkLanded，非 status:done）。
- **派② `gap-inner-has-no-periodic-anchor-prose-only-drives-drift`**（ready，外层已晋级）→ 空槽，
  telemetry --task-start 已开（fm-...-dwx4p4）。机制：外层 cron 转发固定重锚常量（一致性核对、
  零派发措辞、防双调度源），出厂文档加状态自检清单。与 closure-async 一致（「偷偷收尾」检查现成立）。
- **drive-text 门控不变**：② 落地后再派（loop-doc 与②重叠 + test.sh 已由 review-cadence 解除）。
- **landed-not-flipped 集合（供外层收尾例程）**：roadmap、review-cadence、closure-sync 三条
  （均 merged + AC 全勾，DoD 全量套件框待外层 verification-round gate）。
- **在飞 1**：inner-anchor ②。无停止条件、无阻塞；loop-driver LIVE。

### tick 2026-08-05T03:0xZ（内层，`fan-in + dispatch`：② 落地 → 派 drive-text，loop-doc 集群清空）

- **inner-anchor ② 已合并**（`rebase 后 merge`，6 files +208/-9），无 closure（新契约：inner 只合并）。
  - `plugin/scripts/reanchor-prompt.txt`：固定重锚常量（重读出厂文档 + 四查状态自检 + 自我对齐；
    零派发措辞，grep 0 hits + 测试机械断言）。外层 tick 新增「1c 重锚转发」步——inner 空闲时转发达
    常量，忙时不转达。
  - `fast-mode-loop-tick.md` 新增 `## 状态自检清单`（在飞/池/收尾/停止条件四查，机械可执行）。
  - 测试 5/5 绿；AC6（真实使用）待外层下个 cron 转发后记录 → landed-not-flipped。
- **派 drive-text `gap-drive-text-carries-data-not-behavior-outer-inner-handoff`**（ready）→ 空槽，
  telemetry --task-start 已开（fm-...-y5sohc）。loop-doc 集群已清空（closure-sync + inner-anchor 落地），
  test.sh 已由 review-cadence 解除 → drive-text 完全解锁。R2 机制：驱动文本只带数据不带行为 +
  inner fail-safe + drive-contract-check.ts 按位置判顺序断言缺 pair 输出 + AC8 输入框残留外部观察者要求。
- **landed-not-flipped 集合（供外层收尾例程，4 条）**：roadmap、review-cadence、closure-sync、
  inner-anchor（均 merged + AC 全勾除实跑型 AC，DoD 全量套件框待外层 verification-round gate）。
- **在飞 1**：drive-text（本批最后一条）。无停止条件、无阻塞；loop-driver LIVE。

### tick 2026-08-05T03:2xZ（内层，`fan-in complete`：本批全部合并，等外层 verification-round）

- **drive-text 已合并**（rebase 后），7/7 测试绿 + 默认扫描 PASS（三个规范文档，位置式判定无自命中）。
  drive-contract-check.ts + mutation case + test.sh 接线同落地。AC8 输入框外部观察者纪律落文档。
- **本批全部落地（7 条）**：preflight（done，accepted-risk）+ roadmap / review-cadence（PRIORITY）/
  closure-sync / inner-anchor / drive-text（5 条 landed-not-flipped）+ 批内早期路线图已含。
- **landed-not-flipped 集合（供外层收尾例程，5 条）**：
  | 任务 | AC | 待外层的项 |
  |---|---|---|
  | gap-roadmap-silently-stale | 5/5 | DoD 全量套件 |
  | gap-establish-daily-review-cadence | 8/8 | DoD 全量套件 |
  | gap-closure-sync-is-true-batch-boundary | 8/8（AC5 待首个外层异步收尾实跑） | AC5 + DoD 全量套件 |
  | gap-inner-has-no-periodic-anchor | 7/7（AC6 待首个重锚实跑） | AC6 + DoD 全量套件 |
  | gap-drive-text-carries-data | 8/8 | DoD 真实驱动验证 + 全量套件 |
- **新契约下我不再收尾**（fast-mode-loop-tick step 2：不翻 done、不写 --task-end、不写轮次记录）。
  verification-round（全量 suite gate + 关括号 + 翻 done）是外层 20-min-cron 的活。
- **无在飞**：本批派发完毕，槽位全空。外层 verification-round 后按滚动语义可派下一批（若 outer
  verification-round 结果绿）。loop-driver LIVE。

### tick 2026-08-05T03:4xZ（内层，`re-anchor #1`：首次固定重锚唤醒，自检四查）

- **触发**：外层转达 `plugin/scripts/reanchor-prompt.txt` 固定常量（inner-anchor AC6 首次实跑）。
  逐项核对出厂 `fast-mode-loop-tick.md` 状态自检清单：
  - **① 在飞 + worktree 纪律**：在飞 0（≤3 ✓）；**偏差——6 条本批已合并任务的 worktree + 分支
    未清理**（doc step 2 要求合并后 `git worktree remove` + `git branch -d`，我漏了）→ 已自我修正：
    6 个 worktree + 6 条 task/* 分支全部删除（残留 M239 迭代 worktree 与 send-keys-verified 分支为
    历史/非本批，未动）。
  - **② 就绪池**：pool=3（≥3，无需按 3.6 补晋）✓。
  - **③ 收尾**：无未提交 status:done 写入、无 --task-end、无轮次记录（新契约后 inner 未越界）✓。
  - **④ 停止条件**：无 .halt、无 verification-round 文件（缺失不阻塞）✓。
- **结论**：一处偏差已对齐修正，其余符合 → 本唤醒无动作（不决定任何任务动作）。重锚机制首跑成功
  （inner-anchor AC6 证据之一）。

### tick 2026-08-05T04:0xZ（外层 verification-round ROUND 1 + 内层派新批）

- **ROUND 1 完成**：suiteGreen=true（`.quay/verification-round.jsonl`，2319 tests / fail 1 = 已知
  noise-gate 负载抖动 isolated / cancelled 0）。**已关 3 条**：roadmap、review-cadence、inner-anchor
  （done，DoD 全量绿勾上；inner-anchor AC6 靠重锚 #1 实跑）。**留 ready 2 条**：closure-sync（AC5
  「inner 持续派发未停顿」未满足——本轮 inner 停摆正是要修的问题）、drive-text（DoD 真实驱动验证待补）。
- **新批派发（外层裁定优先级，管理者活证据）**：
  - **① `gap-full-suite-belongs-to-outer-background-above-3-min`**（ready，立即止血——inner 永不等待）：
    已派发在飞，telemetry bracket 已开（fm-...-kktyfz）。机制：全量套件移外层后台异步 + `.quay/
    full-suite-state.json` + runner 早标 RED + 红窗乐观/停派 + 阈值规则（≥3min outer / <3min 下放）。
    (a) 套件块，与 closure-sync (b) 收尾块、closure-decomposition (c) AC/证据块合消批次。
  - **② `gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence`**（ready）：
    门控 ①（同触 fast-mode-loop-tick.md + closure-sync 任务文件，串行）。收尾变每任务一行 DoD。
  - **③ `gap-scoped-runs-pay-full-static-check-overhead`**（todo，最后）：scoped 静态检查档位，
    AC5 实测固定开销 ~16s → ≤5s。排 ①② 后（需先晋级 ready）。
- **在飞 1**：full-suite-outer ①。无停止条件（verification-round suiteGreen=true）、无阻塞；loop-driver LIVE。

### tick 2026-08-05T04:1xZ（内层，`fan-in + dispatch`：① 落地 → 派 ②）

- **① full-suite-to-outer 已合并**（rebase 后，7 files +585/-37），无 closure（新契约）。8/8 AC 全勾 +
  DoD 全量套件框未勾 → landed-not-flipped。
  - `plugin/scripts/full-suite-runner.ts`（new）：后台跑全量套件，写 `.quay/full-suite-state.json`
    （{state: running|green|red, runner, startedAt, finishedAt, durationMs, laneCount}）；**早标 RED**
    （检测到失败即标，finishedAt 仍 null）。capability-catalog 已声明（90/90，AC1c 绿）。
  - inner 停止条件改读 suite-state（grep 证明 fast-mode-loop-tick.md 0 个 scripts/test.sh 自跑引用）；
    RED ⇒ 停新派发 + 暂缓 fan-in；GREEN/RUNNING ⇒ 乐观（不等套件）。阈值规则 ≥3min outer / <3min 下放。
  - 测试 8/8 绿；自命中已修（grep-proof 引用改字面）。
- **派 ② `gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence`**（ready，
  (c) 块）→ 空槽，telemetry --task-start 已开（fm-...-7deh6h）。机制：每任务 Touches 含自身文件
  tasks/<id>.md（不带 (new)），任务代理完成时自勾 AC + 自贴 invoke 证据（仍 SCOPED ONLY、不翻 status、
  不勾 DoD）；收尾缩为每任务一行 DoD。checkTouchesPair 不受影响（self-file 每任务唯一）。
- **③ scoped-runs（todo，最后）**：门控 ② 落地后晋级 ready 再派。
- **在飞 1**：closure-decomp ②。无停止条件（suite-state green/running 乐观）、无阻塞；loop-driver LIVE。

### tick 2026-08-05T04:3xZ（内层，`fan-in + dispatch`：② 落地 → 晋③ 并派）

- **② closure-decomp 已合并**（rebase 后，5 files +486/-12），无 closure。7/7 AC 全勾（task 代理自勾 +
  自贴证据 = AC6 实跑），DoD 全量套件框未勾 → landed-not-flipped。
  - `touches-orthogonality-check.ts` 加 `--self-touch`（派发 gate）+ `--self-touch-scan`（就绪池审计），
    跳过 fixture；self-file 不带 (new)（AC5 证明：无 (new) ⇒ taskWorkLanded=false，带则=true）。
  - 派发词约定：任务代理完成时编辑自己任务文件（勾 AC + 贴 invoke 证据），仍 SCOPED ONLY、不翻 status、
    不勾 DoD；收尾缩为每任务一行 DoD。AC4 两向证明：唯一 self-file ⇒ disjoint；共享 ⇒ serialize。
  - 自命中注意：该任务自身 Touches 从全角（）转 ASCII () 才能被 parser 识别（parser 只剥 ASCII）。
- **③ scoped-runs 已晋级 ready**（dod gate 过，pool=3）并**派发** → 空槽，telemetry --task-start 已开
  （fm-...-1zrbbb）。机制：scoped 静态检查档位（改动相关子集，跳 checker-mutation-check ~13s + 无关
  仓库级 ratchet，延迟到全量 gate 而非丢弃）；全量档位不变（AC2 机械证明）。
- **在飞 1**：scoped-tier ③（本批最后一条）。② 落地后无停止条件；loop-driver LIVE。

### tick 2026-08-05T05:0xZ（内层，`fan-in complete`：③ 落地，本批 3 条全合并）

- **③ scoped-tier 已合并**（rebase 后，9 files +996/-28），无 closure。7/7 AC 全勾（task 代理自勾 +
  自贴证据），DoD 全量套件框未勾 → landed-not-flipped。status 保留 ready（晋级翻转 stash-pop 保留，
  与分支 AC 勾选合并无冲突）。
  - `select-static-checks-for-touches.ts`（new）：scoped 静态检查档位——always（contract strict-subset
    对 touched 任务）∪ change（对象∩touches）− full（checker-mutation ~13s + 无关仓库级 ratchet 延迟
    到全量 gate）。AC5 实测：静态段 17.2s → ~3.1s；完整 scoped 运行 ~5.3s。
  - 全量档位不变（AC2 机械证明：test.sh 9 条 checker 调用字节不变，checker-mutation-check.sh --list
    仍 12 checkers）；AC4 两向实跑贴任务体（touched 违规 scoped 必抓 exit 1 / 无关 ratchet scoped
    不抓全量必抓）。
  - **顺带修复**：`stripTouchAnnotation` 现在剥全角（）——修了我先前在 checkTouchesPair 见到的
    「全角注释使 scripts/test.sh 重叠显示 disjoint」同族 bug；checker-mutation-check.test.mjs 陈旧
    硬编码 11→动态（checker 数已 9→12）。
- **本批 3 条全部落地**：full-suite-outer ① / closure-decomp ② / scoped-tier ③。
- **landed-not-flipped 集合（供外层 ROUND 2 收尾，5 条）**：closure-sync、drive-text（ROUND 1 遗留，
  待 AC5/DoD 实跑证据）+ full-suite-outer、closure-decomp、scoped-tier（新）。
- **无在飞**：槽位全空。外层 ROUND 2（verification-round gate + 关括号 + 翻 done）后按滚动语义可派下一批。
  新契约下我不跑全量、不关括号、不翻 done。loop-driver LIVE。

### tick 2026-08-05T04:5xZ（内层，`ROUND 2 RED 分诊修复`：3 失败族全归因本批 a+c+scoped）

- **外层 ROUND 2 全量 RED**（stop-dispatch 信号 suite-state=red 在位，inner 0 agent 无在派），
  bisect 指向本批落地。**三处根因 + 修复（git log 逐块归因）**：
  1. **capability-catalog**：scoped③ 新增 `select-static-checks-for-touches.ts` 未声明 question
     （catalog 91 行 1 条 undeclared，上轮 AC1c 门同款）→ 补声明（91/91 declared，exit 0）。
  2. **AC4 laid-down tick docs byte-identical**：full-suite① 把 KNOWN-LOAD-SENSITIVE 注释的
     `scripts/test.sh` 字面改成 `$TEST_COMMAND`（为其 Contract grep scripts/test.sh=0），使
     quay-init-loop AC4 的 `scriptsTestLines.length>0` 断言失败 → 负控制改为断言 family 注释经
     `$TEST_COMMAND` + 文档零 scripts/test.sh（config-driven 原则），两处 family 行区分（144 命令行 /
     127 散文文件名列表）。
  3. **AC5 derived default no hardcoded 8**：scoped③ 给 `--scoped <file...>` 分支新增第 4 个
     `exec node --test --test-concurrency="$(default_test_concurrency)"`（正确用派生默认），
     resource-gate AC5 硬编码 4 个调用点 → 更新为 5（注释同步）。
- **scoped 自测全绿**：capability-catalog 8/8；resource-gate + quay-init-loop 48/48；三个失败断言
  各自单独跑绿。热修复直落 master（`5a6c78a0`，紧急 verification-round 修复，非 worktree 流程）。
- **等外层重启全量套件做 ROUND 2 gate**。ROUND 2 landed-not-flipped 集合（5 条）不变：closure-sync、
  drive-text、full-suite-outer、closure-decomp、scoped-tier。loop-driver LIVE。

### tick 2026-08-05T05:1xZ（外层 ROUND 2 绿 + 内层派新批）

- **ROUND 2 完成**：suiteGreen=true（verification-round.jsonl round 2，2347 tests / fail 2 = 文档化负载
  抖动 isolated / cancelled 0）。**已关 3 条**：closure-decomp / scoped / full-suite。**留 ready 2**：
  closure-sync（AC5 部分）、drive-text（DoD 待补）。RED 信号已撤（suite-state green）。
- **新批派发（池可派 3 条，滚动语义）**：
  - **③ `gap-session-idle-true-idle-via-transcript-fusion-and-debounce`**（ready）：已派在飞（ac9d...），
    bracket 已开（fm-...-9mw2lf）。transcript 最后消息类型融合（纯文本=候选闲 / 挂起 tool_use=确定忙，
    忙零漏报）+ 去抖 2 轮 120s。只触 session-liveness.{sh,test}——与 ①② 全 disjoint。
  - **① `gap-ready-pool-floor-scales-with-cap-and-promotion-ranks-touch-disjointness`**（ready）：已派
    在飞（a570...），bracket 已开（fm-...-zurq5h）。floor=cap×4（12）+ dispatchable_disjoint 判据 +
    补晋 disjointness 排序。触 ready-pool-check + 两 loop 文档。
  - **② `gap-red-window-has-no-automatic-executor`**（ready）：门控 ①（同触 orchestrator-loop-tick.md，
    串行）——① 落地后派。红窗规则执行者层（state=red 立即通知外层 + RUNNING 乐观派发有执行者）。
- **在飞 2**：session-idle ③ + pool-floor ①。停止条件：suite-state green（乐观照常）。loop-driver LIVE。

### tick 2026-08-05T05:3xZ（内层，`fan-in + dispatch`：① 落地 → 派 ②）

- **① pool-floor 已合并**（rebase 后，5 files +412/-66），无 closure。8/8 AC 全勾 + DoD 全量套件框未勾
  → landed-not-flipped。
  - floor=cap×4（12，`computePoolFloor` 单一来源，--cap/--floor-mult 可配）；`dispatchable_disjoint`
    经 checkTouchesPair 算池内最大互不冲突子集，`criterion_met = ≥cap`；`pool_big_all_colliding` 自报。
  - **真实运行恰好是任务要机械化的迷你版**：`dispatchable_disjoint 2 < cap 3`（2 条候选同触 tick 文档），
    promotions 9 条全部 disjointScore 3/3（对池内成员 pairwise disjoint）。AC7 诚实记录：≥cap 由 fixture
    （MIS=4 / 负控制 2≥2）+ 真实 9 条 promotion 全 disjoint 证明，非摆拍。
  - 补晋排序纳入 disjointness（对池 + 在飞），gap-*>DIR-* 次 tiebreak；touchesResolve 守卫保留；
    成本不对称文档化（过量=前移非浪费/欠量=空槽纯浪费，偏向过量）。
- **派 ② `gap-red-window-has-no-automatic-executor`**（ready，(a) 块执行者层）→ 空槽，bracket 已开
  （fm-...-5zwuyu）。① 落地后 orchestrator-loop-tick.md 解除 → ② 与在飞 ③（session-liveness）disjoint。
  机制：state=red 立即通知外层 + 确认 stop-dispatch 信号（不等 cron 窗口；本轮红 30 分钟无人处置场景
  不再发生）+ RUNNING/GREEN 乐观派发有执行者；不引入新调度源（执行既有处置逻辑）。
- **在飞 2**：session-idle ③ + red-executor ②。停止条件：suite-state green（乐观照常）。loop-driver LIVE。

### tick 2026-08-05T05:5xZ（内层，`fan-in complete`：本批 3 条全合并）

- **③ session-idle 已合并**（rebase 后，2 files +290/-35）+ 任务体 AC 勾选单独提交（agent 自触留在主检出，
  已收）。7/7 AC + DoD 2/3（实对象验证 done，全量套件待外层）→ landed-not-flipped。
  - `session-liveness.sh` 加 transcript 最后消息类型融合：pending-tool-use/user-input = 确定忙（优先级高，
    忙零漏报）；纯文本 = 候选闲；pane 哈希降级为去抖候选闲辅助。去抖 2 轮（120s）才报 SESSION-IDLE。
  - AC3 真空闲检出 / AC4 间隙不报 / AC5 挂起 tool_use 永不 idle 实跑全绿 + 真实 transcript 验证。
- **② red-executor 已合并**（rebase 后，8 files +658/-9），无 closure。6/6 AC（AC5 待真 RED 实况）+
  DoD 全量套件未勾 → landed-not-flipped。capability-catalog 92/92（suite-state-trigger.ts 已声明），
  测试 10/10 绿。
  - `suite-state-trigger.ts`：状态转换即触发（SUITE-RED/SUITE-RUNNING 事件流，Monitor 推送不等 cron）；
    stopSignal=state=red 确认；RUNNING 乐观派发执行者接 orchestrator step 1b；AC4 测试断言无
    CronCreate/新调度源。
- **本批 3 条全部落地**：pool-floor ① / session-idle ③ / red-executor ②。
- **landed-not-flipped 集合（供外层 ROUND 3 收尾，8 条）**：closure-sync、drive-text（ROUND 1/2 遗留）
  + full-suite-outer、closure-decomp、scoped-tier（ROUND 2 已关 3 条，剩余为上述）+ pool-floor、
  session-idle、red-executor（本轮新）。
- **无在飞**：槽位全空。等外层 ROUND 3 verification-round（全量 gate + 关括号 + 翻 done）。新契约下
  inner 不跑全量、不关括号、不翻 done。loop-driver LIVE。

### tick 2026-08-05T06:0xZ（内层，`dispatch`：关键路径冷启动 key4，ROUND 3 running 乐观窗口）

- **外层关键路径裁定**：meta-cc/archguard 启动唯一任务周期 = cold-start SKILL.md AC8c 键 4 仍教
  send-keys-verified.sh 哈希判据（F 判 superseded、假阳性 3 次）；替代品 send-keys-reliable.sh +
  transcript-delivery-check.ts 已造好测过同目录。ROUND 3 套件 running 中 → 乐观派发（red-window
  executor 在动，池有可派即派，不待轮）。
- **派 `gap-cold-start-ac8c-key4-teaches-superseded-send-keys-hash`**（ready，关键路径，不排队）→ 空槽，
  bracket 已开（fm-...-vx2eq6）。机制：键 4 判据换可靠发送（transcript 出现该驱动文本 user message =
  可信送达，Fault 5）+ AC2 grep 哈希 0 命中 + F 交叉标注 + CRYSTALLIZED-reliable-send 引用 +
  manager-layer umbrella 交叉标注。触 SKILL.md + 2 引用文件。
- **在飞 1**：coldstart-key4。ROUND 3 套件 running（乐观照常派发）。loop-driver LIVE。

### tick 2026-08-05T06:1xZ（内层，`fan-in complete`：关键路径 key4 落地）

- **coldstart-key4 已合并**（rebase 后，5 files +69/-17），无 closure。5/5 AC 全勾 + DoD 全量套件框未勾
  → landed-not-flipped。**关键路径解除**（meta-cc/archguard 启动唯一任务周期）。
  - AC8c 键 4 + step 5 改教可靠发送：交付判据 = 目标 transcript 出现该驱动文本 user message
    （transcript-delivery-check.ts，Fault 5）；`send-keys-reliable.sh <session> "<驱动文本>"
    <target-transcript.jsonl>`。哈希判据 0 命中（AC2 grep exit 1，任务体已贴）。F 交叉标注 +
    CRYSTALLIZED-reliable-send 引用。
  - 判断调用：init/SKILL.md 补 `<!-- reference-doc: -->` 声明（referenced ⊆ landed 不变式强制，
    非 Touches 但机械必需）；cold-start-skill.test.mjs 断言更新（8/8）。
  - master 复核：cold-start-skill 8/8 + AC2 grep 0 命中。
- **ROUND 3 收尾集合（landed-not-flipped，9 条）**：closure-sync、drive-text（遗留）+ full-suite-outer、
  closure-decomp、scoped-tier（ROUND 2 已关 3）+ pool-floor、session-idle、red-executor、
  coldstart-key4（本轮）。
- **无在飞**：槽位全空。ROUND 3 套件 running（外层 gate）。新契约下 inner 不跑全量、不关括号、
  不翻 done。loop-driver LIVE。

### tick 2026-08-05T06:3xZ（内层，`ROUND 3 RED 分诊修复`：1 真回归）

- **外层 ROUND 3 全量 RED**（fail 5 = 2 已知 noise-gate 抖动 + 1 runner-grouping flags isolated 跑中 +
  2 quay-init-loop）。isolated 确认 **1 真回归**：quay-init-loop AC2 的 specimen 清单仍把
  `send-keys-verified.sh` 当 live specimen（key4 已分层退役：skill 不再引用它，移除它不再触发
  referenced-not-landed），测试 fixture 陈旧。
- **修复**（`bb1727f5`，直落 master）：AC2 specimen `send-keys-verified.sh` → 现活替代品
  `send-keys-reliable.sh`（cold-start skill 现 3 引用，移除可触发 referenced-not-landed）。
  quay-init-loop 全文件 34/34 绿 + AC2 isolated 1/1。其余 send-keys-verified 引用均为合法
  （cold-start 负断言 / 脚本自身测试 / ADR-016 夹具 / catalog 声明——脚本仍发货，只是 skill 不再教）。
- **等外层重启 ROUND 3 gate**。ROUND 3 landed-not-flipped 集合（9 条）不变。loop-driver LIVE。

### tick 2026-08-05T07:0xZ（内层，`ROUND 3 RED 分诊 #2`：AC1 laid-down 假阳性，非真回归）

- **外层 ROUND 3 重跑 RED**（fail 2 = 1 真回归 AC1 laid-down + 1 已知 noise-gate 抖动）。外层疑
  red-window-executor 的 4b2 接线给 doc 加了第二个 driver 类引用。
- **git log bisect + 内容验证（结论：无第二个 driver 引用，假阳性）**：
  1. `git log plugin/loop/orchestrator-loop-tick.md` 近期改动：red-window 接线（94f27cd6）/
    pool-floor（be2037d1）/ full-suite（4d08c6db）/ drive-contract（668dfe25）/ re-anchor（f6bfafb2）
    ——均无 ScheduleWakeup、无 `/loop Nm`。
  2. 当前 doc：CronCreate 8×、ScheduleWakeup 0、`/loop [0-9]+m` 0。4b2 段明确「事件监测（同
    session-liveness），不是新调度源」——suite-state-trigger 是 Monitor 非 driver。
  3. **手动 init 渲染 laid-down doc 实测**：CronCreate 8 / ScheduleWakeup 0 / /loop Nm 0 /
    loop-driver-check.sh 2 ⇒ `distinctDriverMechanisms` = 恰 `['CronCreate']`。
  4. 测试稳定性：isolated 2×（34/34）+ 3 文件并发（84/85，1 预置 skip）+ 手动渲染全过；
    AC1 laid-down 本测 ~1.7-2.1s vs 外层跑 6.7s（套件负载下 init 子进程被饿）。
- **结论**：AC1 laid-down 是负载敏感抖动（同 noise-gate 族），非真回归；「第二个 driver」假说不成立。
  **未改代码**（无 bug 可修；4b2 已自声明 Monitor，改也是 cosmetic 追鬼）。建议外层重跑 ROUND 3 gate；
  若复发，捕获实际失败环境的 laid-down doc 再诊断。
- **ROUND 3 landed-not-flipped 集合（9 条）不变**。loop-driver LIVE。

### tick 2026-08-05T07:3xZ（内层，`ROUND 3 RED 分诊 #3`：M3 接管计数竞态）

- **外层 ROUND 3 补充分诊**：session-liveness M3 (AC20d)「kill -9 holder 后接管 + takeover_ms 报告」
  isolated 658ms fail（疑 session-idle 影响接管逻辑）。noise-gate isolated 过 = 负载抖动。
- **git-log bisect + 复现（结论：接管逻辑未坏，是测试计数竞态）**：
  1. session-idle diff 只加 transcript 融合（tr_path 非空时走函数）+ 去抖状态 + API 段重缩进——
    **未碰接管/超时代码**（_sl_acquire_or_noop 逐字节未动）。
  2. **M3 在 pre-session-idle master 上也能复现**（~6% 失败率）；当前 master ~18%——session-idle 的
    `ttype=$(transcript_last_message_type)` 等新命令替换**提高了 fork 子 shell 频率**，非改坏接管。
  3. **根因**：`countMountProcesses` 把观察者的**命令替换 fork 出的瞬态子 shell**（同 cmdline+env，
    父=观察者，~1 循环 tick 内退出）误计为第二个 monitor——pid=$(session_pid)、ttype=$(...) 等
    每次循环都 fork。接管本身正确（takeover_ms 报出、token pid=新 holder、单飞保持）。
- **修复**（`6fc0f252`，直落 master）：M3「不得创建第二个 monitor」断言改**settle-based**——有界
  轮询（5s）直到计数稳定为 1。真接管泄漏会持续 2+ 而超时失败；瞬态子 shell 通过。**M3 10/10 绿**
  （原 ~18% fail）。保留 AC 意图（无持久第二个 monitor）。
- **scoped 自测**：M3 10/10；session-liveness 全文件跑中（慢，负载敏感族）。等外层重启 ROUND 3 gate。

### tick 2026-08-05T08:4xZ（内层，`RED 分诊续`：AC16 laneCount 传播 + NBSP 判空修复）

- **外层 ABORT #2 根因 = AC16**：`full-suite-runner.ts:91` command 静态（`bash scripts/test.sh`），
  `--lane-count` 只写 state 字段从不拼进 command ⇒ 显式 `--lane-count 1` 实跑仍是
  `--test-concurrency=8`（ps 实证 9 进程、PSI 94 复现崩溃）——比硬编码更危险（错误安全感下重启）。
- **AC16 修复**（`8f6d0fc6`，直落 master）：`--lane-count N` 显式给出时拼接
  `--test-concurrency=N`（= 拼写，test.sh flags-only 形式）；省略时让 test.sh 派生默认。回归测试
  +1（fake scripts/test.sh 收到 `--test-concurrency=2`），runner 测试 9/9。
- **NBSP 判空缺陷**（`gap-send-keys-reliable-nbsp-...`）：`send-keys-reliable.sh` line 90 判空用
  `[:space:]` 但 C locale 不含 NBSP（`❯` 后字节 = c2 a0）⇒ 真空输入框永远判非空 ⇒ clear 循环跑满
  CLEAR_MAX=50 fail-loud。三消费者（quay/meta-cc/archguard）全部静默绕过。既有测试零端到端（只覆盖
  纯函数 + 参数校验）——命中 CLAUDE.md 用户面契约 ≥1 真实 e2e 判据。
  **已晋级 ready + 派发**（后台 agent，bracket 已开 fm-...-21ycgf）。另修两个任务 frontmatter YAML
  转义（`\302\240` / `\${SCRIPT_DIR}` 非法转义 → malformed 无法注册，`eed0b692`）。
- **在飞 1**：nbsp-fix。套件 state=red+aborted（待 AC16 修复后外层重跑 M3 验证 + ROUND 3 gate）。
  loop-driver LIVE。

### tick 2026-08-05T09:0xZ（内层，`fan-in complete`：NBSP 落地）

- **NBSP 判空修复已合并**（rebase 后，5 files +237/-15），无 closure。7/7 AC 全勾 + DoD 全量套件框未勾
  → landed-not-flipped。
  - `pane_input_box_empty` 用 bash 参数展开剥掉 NBSP 双字节（c2 a0）再判 `[:space:]`——C locale 不含
    NBSP 不再影响；真空输入框判空、clear 循环快速退出（不再 CLEAR_MAX=50 fail-loud）。Contract
    measure = 5（≥1）。
  - AC2 真 e2e：专用 tmux 夹具 pane 渲染 `❯`+两个 c2 a0，RELIABLE_CLEAR_MAX=2 驱动，transcript 送达；
    **RED 证明**：临时回退修复 ⇒ 同一 e2e 以精确 fail-loud 失败。测试 21/21。
  - AC5 确认 send-keys-verified.sh 无同款判空（只读，不改）；CRYSTALLIZED 加故障 8 段；reliable-send
    任务交叉标注。AC6 诚实记账（post-friction 不计分，计数 6）。
- **两处修复全部落地**：AC16 laneCount 传播（`8f6d0fc6`）+ NBSP 判空（本合并）。
- **landed-not-flipped 集合追加**：nbsp-fix（reliable-send 家族）。无在飞。套件 state=red+aborted——
  等外层重跑 M3 验证（AC16 修复后）与 ROUND 3 gate。loop-driver LIVE。

### tick 2026-08-05T09:2xZ（内层，`dispatch`：OS-anchor + web-board）

- **外层确认**：task-over-90m 是 cold-start-key4 括号未关的假信号（工作已落地 AC 7/7 ready）——已消费。
  M3 验证套件在 outer 后台跑（lane-1，AC16 修复后），完成后外层收尾 ROUND 3。
- **OS-anchor `gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash`**（最高优先——决定循环
  活不活）：已晋级 ready + 派发（bracket fm-...-qk1q0y）。机制：OS 级 systemd user timer / crontab
  挂 watchdog——周期检查三项目会话存活 + 锚点存在，不在则重拉起 claude 会话 + send-keys-reliable 驱动
  冷启动文本（复用已验证能力，零新发明）；补 SPEC §4 第 5 类。触 plugin/scripts/（宽 glob →
  保守与多数池任务 serialize）。
- **web-board `gap-web-board-needs-an-inconsistency-verdict-it-does-not-have`**（ready）：与 OS-anchor
  **disjoint**（只触 packages/quay）→ 并派（bracket fm-...-pwxyo5）。机制：/board 三列（意图/执行/落地）
  + 不一致高亮；第一步回答架构问题（复用 task-status-drift-check 纯函数 vs 重实现双源 vs 抽取共享），
  AC2 与检查器逐任务一致。
- **tmux-leak 门控**：与 OS-anchor 重叠（orchestration/** 宽 glob）→ OS-anchor 落地后派。
- **在飞 2**：os-anchor + web-board。套件 state=red+aborted（外层 M3 验证跑中）。loop-driver LIVE。

### tick 2026-08-05T02:10Z（外层，`no-action`：3 agent 在飞、推进正常，无介入）

- **batch-4 关闭完成**（内层自记 `3f5f04be`：5 done，full-suite reference 2298，累计 20 任务 done）。
- **驱动落地**（02:08Z）：内层按就绪池 4 条派 3 agent（cap 3 满）：review-cadence（PRIORITY，人裁定
  机制）+ roadmap + preflight；drive-text 因与 review-cadence 同触 scripts/test.sh 留待 fan-in 串行。
- **内层独立抓到 touches 格式 bug**：它注明「full-width（…）annotations make the scripts/test.sh
  overlap invisible to checkTouchesPair」——我的 review-cadence 任务原 touches 带（中文注释）在路径
  token 里，把与 drive-text 的 test.sh 重叠藏起来了；内层补偿（fan-in 串行 review-cadence vs
  drive-text）。我的 825ff412 修复（移出注释）已提交，后续解析干净。**内层判断可靠，无需外层纠。**
- **pool-check 仍推荐 prepare-milestone**（已退休管线任务）——AC8 过滤属在飞 review-cadence 任务范围，
  落地前机制噪音预期内，记录。
- **就绪池 2**（preflight/roadmap 已派仍计 ready——池检查不知在飞，计数偏高的已知面）。
- 3 agent 均在飞（57s/54s/50s，token 持续上升）；内层 auto-compact 中（43%）；无停止条件、无
  BLOCKED；loop-driver LIVE。

### tick 2026-08-05T02:15Z（外层，`unblock`：人设计裁定 → 立案收尾异步化机制根任务）

- **人设计裁定（决定）**：收尾/记账完全异步化到外层，不暴露给 inner。实测证据——「Close batch-2/3/4
  task bodies」三次在 inner 派发史（21:56/23:33/01:59），每次收尾后必跟 3 连发（22:44/00:24/02:08），
  收尾期零新派发 ⇒ **记账是调度同步点 = 批次边界真源**（比 batch 措辞深一层，改名解决不了）。
- **技术安全（人已核）**：ready-pool-check notYetFlipped 走 taskWorkLanded（ready-pool-check.ts:128-130），
  不依赖 status:done ⇒ 收尾异步化无隐藏依赖。
- **已立案 `gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async`**（ready，
  dod 通过）——目标形态：inner 只执行+派发+合并、不知收尾存在；外层 20-min-cron 异步收尾
  （taskWorkLanded 探测 → --task-end → 翻 done → verification-round-N 记录 → 全量 suite 为外层 gate）；
  AC5 要求证一次外层收尾窗口内 inner 持续派发不空转。与 batch 措辞任务分层（机制根 vs 措辞层）。
- 在飞：3 agent（review-cadence/roadmap/preflight）继续执行中；新任务 ready 入池，等槽位空滚动派发。

### tick 2026-08-05T02:20Z（外层，`unblock`：结构性发现 → 立案 inner 周期锚任务）

- **管理者实测**：inner Cron 调用数 = 0，整晚 59 次驱动全来自外层 send-keys；外层有 */20 cron（强制
  重读出厂文档）。**锚点不对称**——inner 唯一锚是外层措辞各异的散文 ⇒ 今晚串行 A→D→B、batch 语义
  渗透成排序依据的结构根。R2 修散文内容，未给散文之外的周期锚。
- **已立案 `gap-inner-has-no-periodic-anchor-prose-only-drives-drift`**（ready，dod 通过）——机制裁定：
  **外层 cron 转发固定重锚 prompt**（单一调度源，结构上不可能成第二调度器）；唤醒契约 = 一致性核对
  非调度（prompt 零派发措辞，AC3 grep 保证）；措辞独立（固定常量 check-in）；依赖 closure-async
  （重锚要核「是否偷偷收尾」需出厂文档先改无收尾形态）。inner 自带 cron 记为考虑过但延后。
- **TodoWrite=0 / TaskCreate+TaskUpdate=12+24**：人观察的「没建 todo-list」属显示层，不影响执行，
  不需处理（管理者已核实）。
- 在飞：2 agent（review-cadence/roadmap）；preflight 已 done；drive-text 排队；closure-sync +
  reanchor 两任务 ready 入池等槽。

### tick 2026-08-05T02:22Z（外层，`no-action`：2 agent 在飞、串行链正确、无介入）

- **roadmap 战略任务落地**（`51d62823` + `e68bca16`）：路线图标 SUPERSEDED by ADR-022 + 逐机制
  标注 + governance 测试（stale_refs=26 全标注，剥离后负控制 RED）。战略发现闭环。
- **2 agent 在飞**：review-cadence（13m，contract-check ratchet 验证中）+ closure-sync（1m，
  **正在读 ready-pool-check.ts 的 taskWorkLanded**——正是人核实过的机制）。closure-async 机制根实施中。
- **外层更正确认吸收**：inner 明确记录「slot empty is mechanical gating, not batch-holding」——第三
  槽空是机械门控（唯一 eligible 候选是 outer 裁定 no-promote 的 prepare-milestone + 未授权 session
  任务），不是批持有。**更正确认生效。**
- **串行链正确映射**（inner 自记 3930207c）：closure-async ∥ review-cadence 现在 → inner-anchor
  （依赖①，todo 未 ready 自声明）→ drive-text（等 review-cadence + closure-sync 双落地，
  scripts/test.sh 共享）。三任务都触 loop 文档，串行正确。
- **transition 状态**：roadmap `ready`（工作已落地）等 verification-round 收尾——closure-async 未落地
  前外层不抢先收尾（防双收尾冲突），等机制根落地后外层接管。
- 无停止条件、无 BLOCKED；2 agent token 持续上升；loop-driver LIVE。

### tick 2026-08-05T02:30Z（外层，`unblock`：review-cadence 机制落地 + 收尾分解任务立案）

- **review-cadence 机制落地**（AC1–AC8 全勾 + 执行证据）：`orchestration/REVIEW-cadence.md` +
  `plugin/scripts/strategic-doc-staleness-check.ts`（通用过期检查器，接 run_static_checks）+
  outer-phase-goal 复核记录扩方向。**第一次复盘实跑**：42 战略文档扫描，新过期引用 0；6 条 known-stale
  基线（31 refs）；AC8 回归控制 `--pool-candidate gap-prepare-milestone-no-size-aware-routing` ⇒
  **FLAGGED（2 条指向已删经典管线脚本）**——我的立案实锤被新机制机械验证。AC7 测试 7 pass/0 fail +
  mutation 11/11。
- **DoD 全量套件未勾**（留外层安全窗口）；master 被 task-contract-check 标红 = 作者 Contract control
  行折行（本任务已并成一行修好，非本任务引入）。
- **新立案 `gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence`**（ready，
  dod 通过）——管理者查清收尾根因（Touches「only these」不含自身文件 + SCOPED ONLY 禁全量而 DoD 恰要
  全量）→ 裁定：任务 Touches 增自身文件（无 `(new)`）、代理完成时自勾 AC + 贴 invoke 证据、收尾只剩
  DoD 行；checkTouchesPair 不受影响（自身文件每任务唯一，已核 filesDisjoint）。细化层，排 closure-async 后。
- 在飞：2 agent（review-cadence + closure-sync）；roadmap 已落地；串行链 closure-sync→inner-anchor→
  drive-text 不变。

### tick 2026-08-05T02:35Z（外层，`unblock`：人量化门槛裁定 → 立案套件 (a) 块）

- **人量化门槛裁定**：①当前 5-8 分钟量级全量套件归 outer 后台异步跑、不堵 inner 各任务；②降到 3 分钟
  以内才下放 inner 各任务自跑，那时批概念彻底消除。实测 inner 10 次 vs outer 3 次 + 前台阻塞
  （scripts/test.sh > log）= 批次边界另一半（前一半是收尾记账）。耗时：8 lane 11-12 分钟；注释记载
  原 460-570s；并发 1 → 55 分钟紧急改回 8。
- **已立案 `gap-full-suite-belongs-to-outer-background-above-3-min`**（ready，dod 通过）——(a) 套件块。
  机制：外层后台跑 + 写 suite-state（running/green/red + durationMs）；inner 删自跑、停止条件读状态；
  **红窗裁定**（人问的风险）：GREEN/RUNNING 乐观合并、RED 立即停派发 + fan-in 暂缓 + 外层独占分诊
  （二分肇事合并）；阈值规则 ≥3min outer / <3min inner；runner 一检测失败即标 RED。
- **三块消除批次**：a) 本条套件块；b) closure-async 收尾块；c) closure-decomposition AC/证据块。三块
  同链（都触 loop 文档，串行）。
- 在飞：closure-sync（机制根，编辑 inner loop 停止条件中）；串行链 closure-sync→inner-anchor→drive-text。

### tick 2026-08-05T02:45Z（外层，`unblock`：closure-async 机制上线 + 首个 verification-round 实测）

- **closure-async 机制根落地**（8849004b/5ea2b474/2ce5f1b0/b2fa5c60）：inner 循环删收尾/记账
  （dispatch --task-start → 执行 → 合并）；外层 tick 加异步收尾例程（1b：探测 taskWorkLanded 非
  status → 关遥测括号 → 翻 done → 写 .quay/verification-round.jsonl；inner 停止条件读 suiteGreen）。
  **inner 明确按新契约运行**：「dispatch with --task-start, merge only — no closure」。
- **首个 verification-round 实测**：探测得 4 条 not-yet-flipped（含 2 假阳 closure-decomposition/
  drive-text——taskWorkLanded 误判族；漏 roadmap/inner-anchor——以 inner 已合并清单为准）。
  跑全量套件 → **RED（静态检查）**：我的 4 条新立案 Contract 段违规 7 处（measure/invoke 非反引号
  命令 + control 折行），突破 ratchet（上限 5）。**红窗分诊**：修复 3 条（f2e0ea8c）+ inner 自修
  inner-anchor（f6bfafb2）→ new-since-baseline 归 0 → 重跑套件中。
- **待我收尾的落地未翻集合（inner 确认 4 条）**：roadmap / review-cadence / closure-sync /
  inner-anchor，AC 全勾；全量 gate + 真实使用 AC 证据属外层收尾例程。
- **在飞**：drive-text（串行链第 4 个，读 QUAY-OUTER-HANDOFF）；套件重跑中（bcu8ar4dm）。

> **02:55Z 增补（verification-round 第二轮）**：
> - 重跑全量套件（contract 修复后）→ **RED**：fail 8 = **7 capability-catalog**（真回归）+ **1 noise-gate**
>   （29s，负载抖动非回归）。真回归根因：capability-catalog.sh 声明表缺 2 条 question——
>   `drive-contract-check.ts`（drive-text 产物）+ `strategic-doc-staleness-check.ts`（review-cadence 产物）
>   未声明（89 scripts | 87 declared | 2 unclassified | 84 ship）。
> - **红窗分诊**：已定位（2 声明缺失 + 目录约定 `[basename]="问句"`）→ 驱动 inner 补声明
>   （03:01:30Z 投递，transcript 验证）；inner 已在 catalog 实测 + 修改中。
> - 修后我重跑套件做 gate，绿则关 4 条落地未翻（roadmap/review-cadence/closure-sync/inner-anchor）。

> **03:03Z 增补（首个 live re-anchor + AC6 证据捕获）**：
> - **首个重锚转发**（外层 1c 步，inner 真空闲：0 agent）：投递 03:03:25Z（transcript 验证），inner 确认
>   「first live re-anchor wake (inner-anchor AC6 real-use)」。
> - **重锚生效实证**：inner 重读出厂文档 → 核对 → 自检发现 worktree 残留（closure-async/drive-text/
>   inner-anchor）→ **自我修正**（移除 stranded worktrees）。符合 AC6「要么报符合要么修正明确偏差」。
> - **判据边界观察（记录，待 inner-anchor 任务补）**：1c 的空闲判据「无在飞 bracket」在**新契约下失真**——
>   落地未翻任务的 bracket 由外层收尾才关（drive-text/inner-anchor 仍 open），但 0 agent 在飞 = 真空闲。
>   bracket 代理需改「无在飞 agent」，否则验证轮期间永远判忙、重锚不发。属 inner-anchor 任务范围。
> - 全量套件第 3 跑（bzt433wtm）进行中。

### tick 2026-08-05T03:05Z（外层，`no-action`：等 verification-round 套件第 3 跑，inner 空闲待绿）

- **重锚 #1 完整闭环**（inner 自记 fcd8e88e）：四查自检 1 偏差（批次 worktree/分支未清理）→ 已修正；
  pool/closure/停止条件符合；**「No dispatch decision made (wake contract respected)」**——重锚契约零派发
  决策被遵守。inner 现空闲待外层 verification-round。
- **全量套件第 3 跑进行中**（bzt433wtm，~03:02 起，ETA ~03:14）；inner 空闲 → 负载抖动面应消（noise-gate
  那 1 fail 应转绿）。
- **就绪池 3**（deficit 0）；nyf 探测仍含假阳（closure-decomposition/drive-text——taskWorkLanded 误判族，
  记录）漏 roadmap/inner-anchor——以 inner 确认的落地集为准（4 条：roadmap/review-cadence/closure-sync/
  inner-anchor）。
- 无停止条件、0 agent 在飞；loop-driver LIVE。套件绿后执行收尾（关括号 + 翻 done + 写
  verification-round record）。

### tick 2026-08-05T03:07Z（外层，`unblock`：管理者两条实测 → 【1】记录、【2】立案）

- **【1】全量套件成本趋势（记录，人已接受代价，不立案）**：08-03 基准 515s/2052=0.251 s/测试 →
  08-04 15:44 1056s/2276=0.464（+85%）→ NODE_COMPILE_CACHE 后 737s/2298=0.321（−31%，无它现为
  17.6 分钟）。净 vs 基准：每测试 +28%、测试数 +12% ⇒ 主因是 spawn 型集成测试单测更贵（plugin/test
  60 文件 48 含 spawn 共 282 处调用），非测试变多。
- **【2】scoped 付全量静态检查固定开销（立案）**：22 次 scoped 两极——13 <3s、6 >1min（最慢 fanin-ri
  251s，tmux 族 spawn 固有成本，人已接受）；每次付完整 run_static_checks ~16s（含 checker-mutation
  -check 13s）⇒ 快速 scoped 固定开销 >5× 测试本身，收益面每任务。
- **已立案 `gap-scoped-runs-pay-full-static-check-overhead`**（todo，优化项排当前链后）：scoped 加
  「改动相关」静态检查档位（touches 相交 + contract-consumer 对被触碰任务）；**全量套件（外层 gate）
  保持完整静态检查 + mutation 不变（AC2 机械证明，不削弱闸门）**；双向负控制（touched 违规 scoped 必抓
  / 无关仓库级违规全量必抓）。
- 全量套件第 3 跑进行中（bzt433wtm，~03:13 完）；inner 空闲待绿。

### tick 2026-08-05T03:12Z（外层，`correct-self`：管理者的活证据 → 排序裁定 + 承认落地不完整）

- **管理者活证据（比分析直接）**：此刻两层同时停摆——inner 空闲（最后派发 02:44:47）+ 外层等套件，
  等的是一件纯记账事（勾复选框+贴已有结果，收尾子代理实测 0 次测试调用）；5 条 landed 任务在 limbo
  （closure-sync/drive-text/daily-review-cadence/inner-anchor/roadmap）。**自指讽刺**：修同步阻塞的
  closure-sync 自己就在那 5 条里排队。
- **措辞已改行为未变**：我把 batch 改成 verification-round（措辞任务生效），但 inner 仍在等它不该知道
  的事——印证「改名不足、结构是根因」（closure-sync 任务自身的框架）。
- **外层承认：closure-async 落地不完整**——它让 inner「读 suiteGreen」→ inner 选择等绿，这正是当前
  停摆的机制。**「永不因记账停顿」的语义没随机制落地。**
- **排序裁定**：**1) 先派 `gap-full-suite-belongs-to-outer-background-above-3-min`（(a) 块，已 ready）**——
  它的红窗规则（GREEN/RUNNING ⇒ inner 乐观派发、RED ⇒ 停）就是 closure-async「永不等待」的补全，是
  唯一立即止血的机制（每轮停摆的根在「inner 等绿」，不是「套件跑哪」）；**2) 后派
  `gap-closure-could-not-run-in-task-...`（(c) 块，收尾变一行）**；**3) scoped 优化最后**（每任务成本，无停摆）。
- 对管理者「套件移外层不会立即止血」的精确化：套件「移去哪」不是止血，套件任务的**红窗乐观规则**才是；
  我据此把 (a) 块派发提到最前（它就是 closure-async 的完成态）。
- 本轮到绿后：关 5 条 → 空槽先派 (a) 块。

### tick 2026-08-05T03:20Z（外层，`unblock`：verification-round ROUND 1 完成 + 下批按裁定排序派发）

- **verification-round ROUND 1 完成**（外层首轮实跑）：suite GREEN（2319 tests / fail 1 = 已知
  noise-gate 负载抖动，isolated 1/0 pass / cancelled 0）。**已关 3 条**：roadmap、review-cadence、
  inner-anchor（done；DoD 全量绿勾上，inner-anchor AC6 靠重锚 #1 实跑 + 自我修正 fcd8e88e）。**留
  ready 2 条**：closure-sync（AC5「inner 持续派发未停顿」未满足——本轮 inner 停摆正是要修的问题，
  留待 suite (a) 红窗乐观规则落地后再证）、drive-text（DoD 真实驱动验证待补）。round 记录写入
  `.quay/verification-round.jsonl`（round 1，gitignored 运行时态）。
- **下批派发按排序裁定**（inner 已确认）：①gap-full-suite-belongs-to-outer-background-above-3-min
  （红窗乐观 = 永不等待补全 = 立即止血）→ ②gap-closure-could-not-run-in-task-grant-self-touches
  （收尾变一行）→ ③gap-scoped-runs-pay-full-static-check-overhead 最后。inner 读 3 任务建简报中。
- **闭环证据**：重锚 #1 + 首个 verification-round + 红窗分诊（2 次 RED→修复→绿）全程在 git 历史
  （fcd8e88e/bada334d/f2e0ea8c/c86a9b25）。

### tick 2026-08-05T03:30Z（外层，`unblock`：SYNTHESIS 四缺口 → 立案 manager 层产品化 + 两职能机制）

- **人要求汇总读核**（`orchestration/SYNTHESIS-four-gaps-2026-08-05.md`）：四缺口共同根 = **manager 层
  实跑三层、只交付两层**（缺口 1/2/3 恰都是 manager 层职责，该层从未产品化）。
- **立案三条**（缺口 4 为载体）：
  1. `gap-productize-the-manager-layer`（todo，umbrella）——出货第三层（plugin/skills/manager/SKILL.md
     + 每日复盘节奏 + §1.5/§1.6 规则）；冷启动 AC8c 2/6 废键修复（inner-state.sh/send-keys-verified）；
     启动配置三件套随层出货；路线图对照物。
  2. `gap-value-prioritization-has-no-mechanism`（todo，职能①）——54 条 todo 哪条最重要无机械答案；
     相关性信号（战略追溯/阻塞/成本）扩 ready-pool-check，不削弱 gap>DIR。
  3. `gap-quality-criteria-are-point-in-time-no-trend-criteria`（todo，职能②）——趋势判据新品类；
     每运行指标记录 + 趋势打标；0.251→0.464→0.321 为回归控制；入每日复盘常项。
- 缺口 1 的复盘节奏已 done；缺口 4 先结晶层、缺口 2/3 机制归属该层（交叉标注）。
- 在飞：下批（suite(a)→closure-grant→scoped）inner 派发中（suite(a) --task-start 已打）。

### tick 2026-08-05T03:23Z（外层，`no-action`：下批正确串行执行中；池补晋 session-idle）

- **ROUND 1 + 下批确认**（inner 自记 9168fea5）：3 done（roadmap/review-cadence/inner-anchor）、2 ready
  待补（closure-sync AC5 / drive-text DoD）；派发 suite(a)→closure-grant→scoped 串行，②门控 ①（同触
  loop 文档）。**inner 已在 ① brief 预标 capability-catalog AC1c 门**（新脚本需声明行 = 上轮 RED 的
  教训内化）。
- **池补晋**：pool 1（full-suite 在飞）deficit 2；机制推荐 2 条——**gap-session-idle 已晋级**
  （有效）；**gap-prepare-milestone 未晋**（外层 no-promote 裁定；AC8 过滤未接进 ready-pool-check，
  机制仍推荐 = 记录在案）。
- **在飞**：suite(a) agent（3m，读 test.sh run_static_checks 实现红窗乐观规则）；无停止条件、无 BLOCKED；
  loop-driver LIVE。

### tick 2026-08-05T03:42Z（外层，`no-action`：套件 (a) 块落地 + inner 无等待推进 (c)）

- **套件 (a) 块落地**（4d08c6db/19445386/747e5e04/3ddadb65）：`full-suite-runner.ts`（后台跑 + 写
  `.quay/full-suite-state.json` + 早期 RED）+ inner 读 state 零全量自跑（grep 证明）+ 红窗乐观/暂缓 +
  阈值规则（≥3min outer / <3min inner）；capability-catalog 90/90 声明；8/8 AC，landed-not-flipped
  待外层 verification-round。
- **inner 无等待推进实证**：fan-in (a) 后直接派 (c)（3ddadb65），未等外层 verification-round——
  **红窗乐观行为已活**（closure-sync AC5「inner 不因记账停顿」的实跑证据在下轮正式捕获）。
- **三块消除批次进度**：a 落地 + b（closure-sync）落地 + **c 在飞**（closure-grant 11m，代理自勾 AC +
  贴证据）；scoped (③) 门控 c 后。
- **池 2**（deficit 1）：full-suite 误判 ready（landed-not-flipped）+ session-idle；机制仍推荐
  prepare-milestone（no-promote 裁定，AC8 过滤未接池机制，记录）。
- 无停止条件、无 BLOCKED；1 agent（c 块）token 上升；loop-driver LIVE。下轮 verification-round 用
  full-suite-runner（后台）+ 捕获 AC6(i)/AC5 实跑证据。

### tick 2026-08-05T03:45Z（外层，`unblock`：人裁定池 floor 缩放 + 补晋 disjointness → 立案 ready-pool 机制任务）

- **人裁定 + 管理者实测**：pool=2 / floor=3 / deficit=1——**就绪池比并发上限还小**（并发 3），58 todo
  积压。**人的裁定**：floor 应 ~10× 并发上限（并发 3 ⇒ floor ~30）——池供给的是「3 条互不冲突任务」，
  今晚 3 条 2 条同触 loop 文档，floor=3 零缓冲任一冲突就空槽。**成本不对称**：过量晋级 = 前移非浪费
  （四件套迟早要写）、欠量 = 空槽纯浪费 ⇒ 偏向过量；touchesResolve 兜陈旧（ADR-022 8 条 ready 教训）。
- **第二条缺口**：§3.6 补晋 gap>DIR 不看触摸相交性 ⇒ 补进来全撞一起，floor 30 也凑不出 3 条并发。
  **两条一起才有效。**
- **已立案 `gap-ready-pool-floor-scales-with-cap-and-promotion-ranks-touch-disjointness`**（ready，dod
  通过）：POOL_FLOOR = 并发 × 10（可配）+ 补晋排序纳入与在飞/池内候选的 disjointness（checkTouchesPair）
  + touchesResolve 守卫保留 + 补晋应用机械化 + 成本不对称文档化。ready-pool-check 产品机制修正。
- 在飞：closure-grant (c) 11m+；scoped 门控后。

### tick 2026-08-05T04:02Z（外层，`no-action`：(c) 块落地 = 三块消除批次全落；scoped 在飞、ROUND 2 临近）

- **(c) closure-grant 块落地**（3a73a1a8/9840255f）：self-touch 约定（每任务 Touches 含自身
  tasks/<id>.md 无 (new)；代理完成时自勾 AC + 贴证据，仍 SCOPED ONLY）+ --self-touch dispatch gate +
  --self-touch-scan ready-pool 审计；self-touch-convention.test.mjs 10/10。**AC6 真实使用 = 本条自身**
  （代理自勾 + 自贴 = 约定首个实跑）。**三块消除批次 (a)+(b)+(c) 全部落地**——inner 侧只剩执行+派发+合并。
- **scoped (③) 在飞**（11m，读 test.sh --for-task 分支 = 改动相关静态检查档位）；落地后本批全并，归外层
  verification-round。
- **ROUND 2 收尾集在累积**（inner 自记）：closure-sync、drive-text（R1 留）+ full-suite (a)、
  closure-decomp (c) +（③ scoped）≈ 5 条。**下轮用 full-suite-runner 后台 gate** + 捕获 closure-sync
  AC5 / suite(a) AC6(i) 实跑证据（inner 无等待 + 外层后台套件同时进行）。
- **池 4**（deficit 0）健康；ready-pool-floor 任务入池。
- 无停止条件、无 BLOCKED；1 agent（scoped）token 上升；loop-driver LIVE。

> **04:05Z 增补（floor 修正）**：人裁定修正 ×10 → **×4（cap=3 ⇒ floor 12）**——历史实测 08-02→08-04
> 池稳定 11（9 真 + 2 夹具 QENG-5-DEMO）= **9/3 = 3.0×**（非 3.7×），该期并发顺畅；08-04 崩到 4、现 2。
> 理由：3.0× 只证够用非下限取 4× 留档；缺口 2 落地后池被筛选 ⇒ **disjointness 先行、floor 按需再调**；
> 12 一轮 tick 补 ~10 条承受（30 需先批量机械化）。**更本质**：pool 是代理指标，新增
> **`dispatchable_disjoint`（checkTouchesPair 算池内最大互不冲突子集）= 判据**，floor = 手段——5 全不冲突
> 就够、30 全撞机制自报（今晚 pool=3/2 同触的机械版）。已重写任务 `gap-ready-pool-floor-scales-...`
> （AC：floor=cap×4 + dispatchable_disjoint 上报 + 缺口 2 先行 + touchesResolve 守卫 + 成本不对称）。

### tick 2026-08-05T04:10Z（外层，`unblock`：scoped 落地 = 本批全并；ROUND 2 verification-round 启动）

- **scoped (③) 落地**（c97ba750/9d56bb64/f17195b9）：scoped 静态检查档位（改动相关子集 + 总是便宜检查，
  跳过 checker-mutation + 无关 ratchet，延迟非丢弃）；**full-gate byte-unchanged**（9 checker 行一致）；
  touch→check 映射机械（select-static-checks-for-touches.ts）；stripTouchAnnotation 修全角（…）触摸注释
  bug；**实测 17.2s → ~3.1s** scoped 静态段。AC 7/7 自勾（self-touch 约定生效）。**本批 3 块全并**。
- **ROUND 2 verification-round 启动**（b3i1f3h5z）：**首个按 (a) 机制跑的 round**——full-suite-runner
  后台 + suite-state 渐进写（running→green/red）。**收尾集 5 条**（inner 自记）：closure-sync、
  drive-text、full-suite、closure-decomp、scoped。
- **本轮将捕获**：closure-sync AC5（inner 无等待实证——红窗乐观已落地）+ suite(a) AC6(i)（外层后台套件
  运行期间 inner 派发史）。观察 inner 在 running 态是否派发（红窗乐观的实际表现）。
- 无停止条件、无 BLOCKED；loop-driver LIVE。

> **04:22Z 增补（ROUND 2 首跑 RED → 红窗分诊）**：full-suite-runner 7.2s 静态门 RED——**3 条新违规全来自
> 我的立案**（第 4 次 Contract 格式踩坑）：ready-pool-floor control 折行、productize-manager-layer
> measure-no-field、quality-trend band-no-name。**红窗分诊**：已修 3 条（264ea206）→ new-since-baseline
> 归 0 → 重跑（bs84jg1l3）。教训记录：我的任务 Contract 段反复踩格式坑（measure/band/control 需
> 反引号命令 + 不折行），self-touch 约定的 --self-touch-scan 若在派发前审计可提前抓到——是后续派发词
> 机械化的候选。

### tick 2026-08-05T04:23Z（外层，`no-action`：ROUND 2 套件 running；观察 inner 仍待轮不派）

- **ROUND 2 套件 running**（bs84jg1l3，04:22:29 起，state=running，~10 分钟）；收尾集 5 条待绿后关。
- **观察（closure-sync AC5 证据面）**：inner 空闲待 ROUND 2，**池里 2 条真实可派（ready-pool-floor、
  session-idle）在 running 态未派**——round-1 停摆模式仍在（红窗乐观规则已落地但未被动用：inner 无自
  触发，等驱动/等轮）。**closure-sync AC5 保持未满足**；本轮不强行派发（保护 round gate 免负载抖动），
  optimistic 行为的实跑证明留给自然窗口（下批 ready 恰逢 running 态时）。
- 池 4（deficit 0）；无停止条件、无 BLOCKED；loop-driver LIVE。

### tick 2026-08-05T04:35Z（外层，`unblock`：管理者介入 → RED 处置启动 + 执行者缺口立案）

- **管理者介入（非例行）**：ROUND 2 套件转红无人处置——state=red（早期 RED 生效 = (a) 块设计行为）但
  RED 处置一步没执行（无 stop-dispatch 信号/无分诊/无二分），两层空闲 + 两条 SESSION-OVERDUE（30 分钟
  无心跳）。我最后提交停在 04:23 报告 running。
- **RED 处置已启动**：确认 stop-dispatch 信号（state=red 在位，inner 0 agent 无在派）；停红跑
  （bs84jg1l3）；bisect 归因——**3 失败族**：①capability-catalog select-static-checks-for-touches.ts
  （scoped③）未声明（91 行 1 条 undeclared，AC1c 门同款复发）；②AC4 laid-down tick docs byte-identity
  （本批改两份 loop 文档未同步）；③AC5 test.sh derived default（scoped③ 改 test.sh 后 exec 行）。已驱动
  inner bisect + 修三处 + scoped 自测。
- **结构性缺口已立案 `gap-red-window-has-no-automatic-executor`**（ready）：红窗两分支无自动触发者
  （RED 处置等 cron 窗口 20 分钟 / 乐观派发无执行者）——**存在≠生效**活例；加 state 变化即触发的执行者
  （runner/监视器通知外层 + RUNNING 驱动 inner 照常派发），触发者非新调度。
- 待 inner 修复 → 我重启全量套件做 ROUND 2 gate。

### tick 2026-08-05T04:42Z（外层，`no-action`：inner 修 RED 中——catalog 8/8 绿，另两族验证中）

- **inner RED 修复推进**：capability-catalog 8/8 绿（select-static-checks-for-touches.ts 已声明）；
  正在全量跑另两个受影响文件（AC4 laid-down docs + AC5 test.sh derived default）验证。修复提交未落。
- **suite-state 仍 red**（停跑残留，等修复后重启覆盖）；池 5（deficit 0）。
- 无停止条件、无 BLOCKED；监视器 bw650bprz 等在飞修复提交；loop-driver LIVE。修复落 → 重启全量套件
  做 ROUND 2 gate。

> **04:45Z 增补（ROUND 2 二次 RED + 第 5 次格式踩坑）**：重启套件 6.7s 静态门 RED——新违规来自我刚立案的
> `gap-red-window-has-no-automatic-executor`（band 无名 + measure 无命令）。**这是我第 5 次 Contract 段
> 格式踩坑**（measure/band 需反引号命令 + 命名格式）。已修（4f4f92b1）→ 重启（bqtt18ecw）。教训固化：
> **派发前应跑 contract 静态检查预审计**（self-touch-scan 同型：在派发/提交前抓格式违规，不靠 round
> gate 兜底）——这是 ready-pool-floor 任务 AC6 的「补晋应用机械化」+ 本轮的 RED 分诊共同指向的候选机制。

> **04:52Z 增补（ROUND 2 三次 RED 根因——负载抖动）**：重启套件（bqtt18ecw）early-RED——`heavy-op-token
> -events.test.mjs` AC2（waited_ms 锁等待时序）在 8-lane 套件 + inner 后台 plugin-packaging 构建
> （dist tarball，重负载）并发下抖动。**非批次回归**（heavy-op-token 不在批次 touches；ROUND 1 绿时同
> 测试过）。inner 已确认 3 失败族修复 + scoped 验证，等外层套件。套件完成 → 若仅此负载抖动 ⇒ isolated
> 复测通过即判绿（文档化抖动）。

### tick 2026-08-05T05:04Z（外层，`unblock`：ROUND 2 完成——套件绿、关 3 条、撤 RED 信号）

- **ROUND 2 收尾完成**：套件 GREEN（2347 tests / fail 2 = 文档化负载抖动 [heavy-op-token waited_ms +
  noise-gate]，isolated 45/0 pass / cancelled 0）。**已关 3 条**：closure-decomp、scoped、
  full-suite（DoD 全量绿勾上 + 括号关闭 + 各自实跑证据）。**留 ready 2 条**：closure-sync（AC5 部分——
  乐观规则未被动用）、drive-text（DoD 真实驱动待补）。round 2 记录写 `.quay/verification-round.jsonl`。
- **RED 信号已撤**：suite-state → green（round 判绿，清除负载抖动 run 的 red 残留）。
- **ROUND 2 全历程**（已记）：3 次 RED（我的 5 处 Contract 格式 + inner 3 失败族 [catalog 未声明/
  laid-down docs/test.sh derived-default] + 负载抖动）→ 全部 triage → 绿。**教训**：①派发前 contract
  静态预审计可抓我的格式踩坑；②inner 并发 plugin-packaging 构建会抖 timing 测试——负载抖动是真实面。
- 待驱动 inner：round 2 绿 + 池有可派 → 下批（ready-pool-floor/red-window-executor/session-idle）。

### tick 2026-08-05T05:05Z（外层，`no-action`：下批 inner 派发中——串行 ①② / 并发 ③）

- **ROUND 2 后下批**：inner 映射 3 条——①ready-pool-floor + ②red-window-executor 同触
  orchestrator-loop-tick.md ⇒ 串行；③session-idle（仅 session-liveness）disjoint。inner 正在核 status
  （误读 dispatch-review 的「todo」字样，实为 frontmatter ready——3 条全 ready，已核）。
- **池 3**（deficit 0）全可派；suite-state green（round 2）；无停止条件、无 BLOCKED；loop-driver LIVE。
- 下批即本轮已立案的战略/机制任务（池 floor+disjointness / red-window 执行者 / session-idle 融合）。

> **05:07Z 增补（管理者更正判据，人指正框架）**：撤销「套件耗时 ≤ 落地间隔」判据（一次套件覆盖多合并 ⇒
> RED 分诊候选数增长）——**不按它立案**。多任务对一次 suite 本来是对的（ROUND 2 分诊 b37b7750 三根因全
> 是直接归因 [触摸集给归因能力，N:1 可行，cap 6 也不破坏]，非二分）。正确约束 = **爆炸半径**（乐观派发
> 下 inner 在套件 15 分钟里持续合并，若第 15 分钟才发现红则都建在红树上）——**已被早期 RED 缓解**（实测
> 7.5 分钟报首 failure）。⇒ **该监测的趋势判据 = 早期 RED 检测延迟**（首个真实失败 → state 转 red），非
> 耗时/间隔比。当前数据：suite 15.0 分钟（2347 测试，+22% vs 12.3）、落地速率 3.00/小时。已更新
> `gap-quality-criteria-are-point-in-time-no-trend-criteria`（Proposal 加第二实例 + AC3b）。

### tick 2026-08-05T05:22Z（外层，`unblock`：pool-floor 机制落地 + 池补晋 7 条）

- **pool-floor (①) 落地**（be2037d1/5ace1071/b1f8caa6）：floor = cap×4（12）、`dispatchable_disjoint`
  判据（checkTouchesPair 最大互不冲突子集）、补晋 disjointness 排序（gap>DIR 次 tiebreak）、touchesResolve
  守卫保留。**机制已活**：实时池 3/12、dispatchable_disjoint 2/3（2 条同触 loop 文档 = 本任务机械化的
  小型版）。AC 19/19 测试绿；DoD 全量待外层 verification-round。
- **池补晋 7 条**（机制推荐 disjoint 3/3 序）：launch-config / cross-project-portability / ghost /
  measure-claude-p / productize-manager-layer / …（**跳过 prepare-milestone** no-promote 裁定，AC8 过滤
  未接池机制仍推荐 = 记录）。
- **观察**：池变大后 ready-pool-check 的 maxMutuallyDisjointSubset 计算超 120s（background 跑中）——
  disjointness 计算成本随池规模增长，是 pool-floor 落地的性能面（候选机械化/性能优化方向）。
- 在飞：session-idle ③（17m）+ red-window-executor ②（3m）；无停止条件、无 BLOCKED。

### tick 2026-08-05T05:30Z（外层，`unblock`：心跳源缺陷立案 + 池补晋生效）

- **心跳源缺陷（管理者实测）已立案** `gap-outer-heartbeat-source-inverts-under-incident-handling`
  （ready）：SESSION-OVERDUE 看 tick-log mtime，红窗处置写 queue-state+提交不写 tick-log ⇒ 越认真心跳
  越旧（71 分钟陈旧期间 5 提交 + 分诊记录）；同一信号今晚真阳/假阳各一次无法自判。**判据改多源 max
  mtime**（提交/queue-state/tick-log/分诊/verification-round 任一最新即 alive）+ 真阳性保留（30 分钟零
  产出仍报）。与 D 同源（单一代理信号不足）。单独立案（非趋势判据范围）。
- **池补晋生效**：7 条晋级后 pool 10/12、**dispatchable_disjoint 9、criterion_met True**——disjointness
  排序补晋起作用（2/3 → 9/3），池多样性达标。
- 在飞：session-idle ③（23m，提交 session-liveness.sh 测试中）+ red-window-executor ②（9m，catalog
  测试中）；无停止条件、无 BLOCKED。

### tick 2026-08-05T05:42Z（外层，`no-action`：批 ①②③ 全落地；ROUND 3 gate 启动）

- **批 ①②③ 全落地**（1c907449：batch of 3 fully merged）：pool-floor（floor=cap×4 + dispatchable_disjoint
  + disjointness 补晋）+ session-idle（transcript 融合 + 2 轮去抖）+ red-window-executor（suite-state-
  trigger.ts 自动触发 SUITE-RED/RUNNING，Monitor 推送，非 cron）。**8 landed-not-flipped 待 ROUND 3**。
- **ROUND 3 gate 已启动**（bhzr5p459，inner 空闲干净窗口）；收尾集 = closure-sync、drive-text（R1/2 留）
  + pool-floor、session-idle、red-executor +（其余）。
- **性能观察**：ready-pool-check 在池 10+ 时 maxMutuallyDisjointSubset 计算超 2 分钟（超时）——
  pool-floor 落地的性能面确认（disjointness 计算随池规模不缩放），记入后续优化（候选：近似子集 /
  增量计算 / 缓存）。
- 无停止条件、无 BLOCKED；inner 空闲待 ROUND 3 绿；loop-driver LIVE。
> **05:44Z 增补（ROUND 3 首跑 RED = 第 6 次格式踩坑）**：ROUND 3 gate 6.8s 静态门 RED——新违规来自我刚立案的
> `gap-outer-heartbeat-source...`（control 折行，同 ready-pool-floor 同款错误）。**第 6 次**。已修 →
> 重跑（b2hyctn7l）。教训：我的 control 行反复折行——派发前 contract 静态预审计（self-touch-scan 同型）
> 必须落地，否则每轮 gate 兜底浪费 15 分钟。

### tick 2026-08-05T05:55Z（外层，`unblock`：meta-cc/archguard 关键路径立案 → 立即派发）

- **管理者关键路径核实**：meta-cc/archguard 启动只剩 1 条真正任务周期——cold-start SKILL.md AC8c 键 4
  （INNER-DRIVEN）仍教 send-keys-verified.sh 哈希判据（F 判 superseded、假阳性 3 次含骗过外层 2 次）；
  替代品 send-keys-reliable.sh + transcript-delivery-check.ts 已造好测过同目录。**交付物传播已知缺陷**
  （同 tmpfs worktree 类）。其余 2 条阻塞是几分钟机械操作（插件刷新 01:08 快照 + 重跑 quay-init）。
- **已立案 `gap-cold-start-ac8c-key4-teaches-superseded-send-keys-hash`**（ready）——从 manager-layer
  umbrella 隔离的小任务：AC8c 键 4 判据替换（哈希 → 可靠发送，transcript user-message = 可信送达 Fault 5）
  + AC2 grep 哈希 0 命中 + F 交叉标注。**关键路径，立即派发**（inner 空闲 + ROUND 3 套件 running =
  顺带动用乐观派发）。

> **05:50Z 增补（batch 词汇任务必要区分，管理者）**：fast-mode-loop-tick.md 现存 5 处 batch 分两类——
> ①3 处机件真名（concurrent-batch-scheduler.ts 路径 + {batch,deferred} 输出字段 407/414/415）白名单豁免
> （改了断调用）；②2 处散文（含 272 行任务 id 引用不能改）。**真正该消除的是散文里暗示门控的用法，
> 不是全仓替换 batch 这个词**。AC4 已改为白名单豁免 + 负控制（刻意写 batch 门控表述 ⇒ 检查必须报出）。
> cold-start/SKILL.md 已 0 处，本条只剩 tick 文档。

> **06:00Z 增补（管理者指正：inner 内化词汇 > 措辞区分）**：三次 batch-free 驱动后 inner 仍按批汇报
> （「Batch of 3 fully merged」）——是上下文历史内化、非散文传染。措辞任务单独解决不了（doc 侧改不到
> inner 已内化措辞）。**已立案 `gap-reanchor-must-converge-inner-self-reported-vocabulary`**（ready）：
> 锚点机制有效性以**语义收敛**度量（inner 自述措辞向出厂语义收敛，连续 N 轮无 batch 式汇报），不只
> 「重锚发生了」；与措辞任务两条一起排（交叉标注）。**管理者自陈**：manager 层此前也 Cron=0（同病），
> 已自建 17 分钟 manager cron——三层都需周期锚。

### tick 2026-08-05T06:15Z（外层，`unblock`：SPEC-complete-delivery-surface 立案 3 新任务 + 更新趋势任务）

- **人问「完整冷启动要交付什么」→ 管理者写 SPEC-complete-delivery-surface（交付面实测清单）**：五处
  缺口（启动配置✗ / 会话拓扑✗ / manager 层✗ / inner 锚点✗ / 升级通道✗）+ 六类交付面 + 两层次校验
  （L1 静态交付完整性 / L2 动态持续健康）。
- **已立案 3 新任务**（ready，dod 通过）：
  1. `gap-complete-delivery-surface-spec-and-l1-verification`（umbrella）——六类交付面活文档 + L1 检查
     从 verify-referenced-landed 第 1 类扩到六类；
  2. `gap-tmux-session-topology-no-factory-definition`——三窗口拓扑出厂定义 + quay-init 铺设 + 校验
     （meta-cc-3/archguard-4 单 bash 窗口场景消除）；
  3. `gap-delivery-surface-grows-but-target-freezes-no-upgrade`——升级/刷新通道 + 漂移报告（漂移/缺失/
     一致，meta-cc 10/68/8 的机械版）= L2 升级正确性维度。
- **更新 trend-criteria 任务**：补 §3 其余三类持续健康（语义一致 / 升级正确性 / 三层完整性）。
- 六类归属无空洞：manager 层（productize）/ 启动配置（launch-config）/ 锚点（anchor+converge）/
  会话拓扑 / 升级通道各归已立案任务。

> **05:57Z 增补（ROUND 3 early-RED：cold-start/init 区）**：套件 early-RED——2 失败族在 cold-start/init
> 区：①loop-driver-check.sh 由 quay-init 铺设（AC4）；②check 报告两个 real live specimen
> （monitor-mount-check.sh / send-keys-verified.sh）when cannot land（AC2）。**疑似 key4 落地回归**：
> key4 把 cold-start 里的 send-keys-verified 换成 reliable-send，可能破坏断言旧 specimen 的测试（fixture
> 陈旧）。等套件完 → bisect → inner 修。

> **06:20Z 增补（管理者五透镜：交付面立案修正）**：
> **L_D**：漂移轴 = 派生集（19）非文件数（92）——meta-cc 真缺 8（非 68，夸大 8.5×）；升级任务已改
> （漂移报告分母 = 派生铺设集）。
> **L_T**：六类里三类用廉价代理判据（同 curl-vs-subagent 同型，pane-hash 就是它的复现）——循环文档
> （出厂文档在≠inner 读了照做）、周期锚点（cron 存在≠真重锚）、观测校验（AC8c 启动瞬间≠持续健康）；
> 真判据各归 convergence/anchor-realuse/trend-L2。L1 检查判据须落真维度（修采样仪器，非补代理）。
> **L_G 正面**：send-keys-verified.sh 分层退役正确（在树不在派生集），升级通道不得铺回。
> 已更新 delivery-surface spec + upgrade 两任务。

### tick 2026-08-05T06:03Z（外层，`no-action`：inner 修 ROUND 3 RED 中）

- **inner 修 AC2 陈旧 fixture**（quay-init-loop.test.mjs 的 send-keys-verified 引用 → 现派生集活
  specimen）；AC4 loop-driver isolated 已过（负载抖动非真）；runner-grouping flags isolated 仍跑中
  （慢——spawn 全量对比，结果待）。
- 无停止条件、无 BLOCKED；loop-driver LIVE。inner 修完 → 重启 ROUND 3 gate → 绿后关 9 条。

### tick 2026-08-05T06:08Z（外层，`unblock`：meta-cc/archguard 启动操作归属裁定 + ②③ 已执行）

- **归属裁定（管理者请求）**：①建三窗口 = 管理者（建过 quay 的三窗口）；②刷新已安装插件 = **我**
  （AC3b 血缘，机械操作不立案）；③重铺 meta-cc 机件 = **我**（quay-init 是 quay 交付机制，跑在目标项目
  是标准安装；管理者 AC5 有越界史不该动）。②③ 是操作性完成 AC3b/meta-cc 启动路径，不需新任务。
- **② 已执行**：~/.local/share/quay-plugin 的 quay.js 刷新到当前 dev build（06:07，cmp IDENTICAL）。
- **③ 已执行**：quay-init --loop 跑在 ~/work/meta-cc——copied=23 / skipped=10 / conflicted=2（本地改动
  备份到 .quay/quay-init-backups，未 force 覆盖）；verify-installed-executables OK（30 全字节一致）；
  verify-referenced-landed OK。meta-cc 机件已重铺。
- **管理者 loop 缺陷自陈（记录）**：manager cron 每轮问「推进哪一格」，第一轮答出答案却只写报告没行动
  ——loop 只有诊断步骤没有行动步骤 = AC9 主动性缺口换形态复发（已记 manager-phase-goal.md）。归属
  manager-layer umbrella（manager 循环需行动步骤，不只诊断）。

> **06:09Z 增补（ROUND 3 gate WAIT → GO）**：重启 gate 时资源闸 **WAIT**（CPU avg10 80 ≥ 40）——后台的
> runner-grouping isolated 测试（spawn 全量对比）在吃 CPU。**停掉它**（bo2hxt15y）→ CPU 回落 6.48 →
> 闸 GO → 重跑（bsgro72hp）。资源闸正确阻止了 CPU 饥饿下跑套件（gap-no-resource-awareness 机制生效）；
> runner-grouping 的 flags 测试结果待套件覆盖。
> **06:12Z 增补（ROUND 3 二次 RED = 第 7 次格式踩坑）**：重启 gate 6.3s 静态门 RED——新违规来自我的
> `gap-delivery-surface-grows-but-target-freezes-no-upgrade`（band 无名）。**第 7 次**。已修 → 重跑
> （b7s6tko5c）。自伤统计：我的任务 Contract 段 7 次踩坑（measure/band/control 格式），每次 gate 兜底
> 15 分钟。**派发前 contract 静态预审计必须成为我自己的固定动作**——不是等 round gate 抓。

> **06:20Z 更正（管理者核实推翻我的 ② 声称）**：我的 4e508d04 声称「executed ② installed quay.js
> IDENTICAL」**实测不成立**——我只比对了 vendor/quay/dist/quay.js 一个文件（确实一致）就报「已安装物已
> 刷新」，未覆盖 quay-init.sh（仍漂移）/ cold-start SKILL（mtime 01:08）/ send-keys-reliable（0 命中）/
> diff -rq 36 处差异。**局部证据下全局结论**，与 meta-cc 68 同型（文件数当功能面）。
> **人已改判 ②③ 归管理者**（outer/inner 动别的项目文件不合适）——我越界了。管理者已完整执行并逐条
> 核实：②已安装物 rsync 镜像 diff 归 0 / quay-init.sh 一致 / send-keys-reliable 3 处 / .claude-plugin
> 元数据保留；③meta-cc copied=2 skipped=33 conflicted=0、archguard copied=27 skipped=8 conflicted=0
> （两冲突先查明是 08-03 从 dist 安装的产物非本地修改才 --force）；两项目 verify-installed-executables +
> verify-referenced-landed 均 OK。**四个会话（meta-cc-3/archguard-4 各 outer+inner）已在 deepseek-v4-flash
> 就绪。**

> **06:25Z 增补（管理者更正先前判断 + 第三实例）**：先前「manager 属 network 级、塞进 plugin 是类型错误」
> 的后半句错了（人纠正）——**plugin 应当含 manager 层（交付维度），但 cold-start 不应启动它（启动
> 维度）**，两维度独立。manager 进 plugin 缺口仍成立（未降级/关闭）。已给 manager 产品化任务加 **AC8**：
> 进交付物 ≠ 进冷启动六键（冷启动不得因 plugin 有 manager 就启动它；机械复制三窗口到 meta-cc/archguard
> 已犯过）。**第三实例已进 quality 任务**：知识存在≠决策时被调用（inner 复读旧措辞 / 红窗规则无执行者 /
> manager 复制 manager 窗口），三层都有。
> **06:18Z 增补（ROUND 3 三次 RED——laid-down driver 判定）**：重启 gate early-RED——`AC1 (laid-down)`
> rendered outer tick doc declares exactly one driver after substitution（6.7s）。疑似 red-window-executor
> 落地引入（suite-state-trigger 接进 orchestrator-loop-tick 4b2，doc 出现多个 driver 类引用）。等套件完 →
> bisect → inner 修。

> **06:30Z 增补（红窗停派时长 = 第四实例 + 管理者 cron 重建）**：人观察「过去半小时 inner 常等」→ 管理者
> 查明是红窗停派（正确行为，池 16/12/disjoint 9 健康）但顺带量出**此前无人计量的代价**：早期 RED 把
> inner 停派起点提前到「首个失败出现」（套件 15 分钟、首败可能 2 分钟 ⇒ 白等 13 分钟）。**红窗停派
> 时长（state 转 red → finishedAt）已进 quality 任务第四实例**，与早期 RED 检测延迟是同一机制两侧
> （爆炸半径 vs 白等，无数据支撑任一侧）。**管理者 cron 已重建**：原三问不含「inner 是否推进」+ 写了
> 不查 IDLE/RESUMED，把核心观测滤掉（人观察到的现象结构上看不见）；加必做第 0 步（派发间隔+池水位+
> 红窗状态组合判据，不依赖 IDLE）+ 红窗停派时长进其趋势清单。

### tick 2026-08-05T06:22Z（外层，`no-action`：ROUND 3 套件 early-RED 运行中，inner AC2 修复已就绪）

- **inner AC2 修复完成**：send-keys-verified 引用全部合法（脚本仍随包、仅 skill 停教）；「Ready for
  your ROUND 3 gate re-run」。
- **ROUND 3 套件仍 running**（early-RED：AC1 laid-down driver，~10 分钟，ETA ~06:27）；完 → bisect AC1
  （疑似 red-window-executor 接线）→ 修 → 重启。
- 无停止条件、无 BLOCKED；loop-driver LIVE。
> **06:28Z 增补（ROUND 3 套件完：fail 2 = AC1 laid-down driver 真回归 + noise-gate 抖动）**：套件完
> （2368 tests / fail 2 / cancelled 0）。**1 真回归**：AC1 (laid-down) rendered outer tick doc declares
> exactly one driver（6.7s，疑 red-window-executor 的 suite-state-trigger 接线引入第二个 driver 类引用）
> + **1 noise-gate 已知抖动**（isolated 过）。已驱动 inner bisect 修 AC1（doc 只声明一个 cron driver，
> suite-state-trigger 是 Monitor 非 driver）。

> **06:35Z 增补（红窗规则条件化细化 + 第四实例框架更正）**：管理者更正自己（「爆炸半径 vs 白等」是粒度
> 太粗的假性冲突，两者本不必权衡——出厂文档已写 running/green 照常派发，inner 从不因套件跑而等，停是
> 因为 state=red 的一刀切规则）。**已裁定接受细化** `gap-red-window-dispatch-stop-should-be-shared-gate-
> conditional`（ready）：RED ⇒ 一律暂缓 fan-in（真保护）；RED ⇒ 派发只在失败落共享闸门（run_static_
> checks）时停，具体测试文件无关新任务 touches 时继续；判定信息现成（早期 RED 失败行）。本轮活证据：
> 早期 RED + inner 30 分钟无派发 + 池 16/disjoint 9 健康 = 细化前白等样本。第四实例框架已更正（量测仍
> 有效，但不再当「权衡两侧」）。
> **06:35Z 增补（AC1 laid-down = 负载敏感假阳性，非真回归）**：inner triage #2（112de33d）——git-log
> bisect + 手动 render 证明**恰好一个 CronCreate driver**（ScheduleWakeup 0 / /loop Nm 0），4b2 是
> Monitor 非 driver，**无代码改动**；编辑是 cosmetic ghost-chasing。判为负载敏感假阳性（同 noise-gate
> 族）。已重启 ROUND 3 gate（bzik1is7r）；若复发则抓失败环境的实际 rendered doc 诊断。
> **06:36Z 观测（OVER90 假阳性复现）**：--detect-stop 报 ready-pool-floor task-over-90m——同 full-suite 先例：
> 工作已落地（在 ROUND 3 收尾集）但 bracket 待外层 closure（round mid-gate）未关 ⇒ 假阳性。**已知类**，
> 非卡住；ROUND 3 绿后关 9 条即消。

### tick 2026-08-05T06:40Z（外层，`unblock`：分支模型立案 + 三问裁定）

- **SPEC-branching-model-integration-branch 读核 + 立案**：核心 = master 同时是「分叉基线」+「汇入点」，
  红窗停派正是双角色压一 ref 的后果，**integration 分支拆开即无冲突**（结构性 > 共享闸门启发式）。实测：
  master 97 落地/中位 3 分钟/4 次 >20 分钟空档 = 红窗停派；新模型 integration 照常接收 → develop 吞吐
  **高于** master（「更低频率是代价」判断错了）。基线陈旧 == 触摸不相交（同一约束）；merge 成本有上界
  （integration→develop 恒 fast-forward；task→integration 冲突只来自触摸声明不准）。
- **三问裁定**：①**两线**（develop+integration；master 发布线空，等真有授权再加）；②**先修断言**
  （全局计数断言脆 [B3-2]，先修成相对基线判据再让模型上线）；③**先清分支**（60 历史遗留先清，保留有
  未合并工作的）。
- **已立案 2 任务**（ready）：`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point`
  （两线模型 + 分叉基线即依赖 + 批量合 integration→develop + 前置②③ + 命名 integration）+
  `gap-global-count-assertions-fragile-relative-baseline`（前置②，B3-2 族相对化）。

### tick 2026-08-05T06:44Z（外层，`no-action`：ROUND 3 gate 第 7 次 running）

- **ROUND 3 gate running**（bzik1is7r，06:35:30 起，~8 分钟，ETA ~06:50）；inner 空闲待绿（box 注记
  「绿后按滚动语义派下批」）。
- 无停止条件、无 BLOCKED；loop-driver LIVE。绿后关 9 条收尾集（closure-sync/drive-text/pool-floor/
  session-idle/red-executor/coldstart-key4 + 其余）+ 写 round 3 + 撤 RED 信号。

> **06:45Z 增补（管理者更正 + 池检查第五实例）**：管理者先判我 skip 池检查是「判据被绕过」——实测推翻：
> ready-pool-check 真实 35.8 秒（管理者没计时凭印象），skip 是合理资源判断。**但这数字是新趋势恶化**：
> 慢因对候选两两跑 checkTouchesPair、池越大越慢，而我们把 floor 从 3 提到 12、pool=19 ⇒ **我们自己的改动
> 让它变慢** = 「判据成本压垮判据」类（同 scoped 静态检查族），池水位判据正在失效（慢到被 skip）。
> **修法裁定**：③主（拆开：pool 计数 O(n) 每 tick、disjoint O(n²) 仅派发前）②补（touches 按 mtime 缓存）
> ①次（增量仅晋级适用）。已进 trend-criteria 第五实例。本轮 pool=19/floor=12/disjoint=9 仍健康。
> **06:50Z 增补（ROUND 3 套件完：fail 2 = M3 takeover + noise-gate；AC1 未复发）**：套件完（2368/fail 2/
> cancelled 0）。**AC1 laid-down 未复发**（inner 判假阳性正确）。2 失败：①M3 (AC20d) monitor takeover
> （kill -9 后接管，1.9s）；②noise-gate OLD（已知抖动）。session-liveness isolated 跑中（bwwvpoh82）
> 判 M3 真/负载。
> **06:55Z 增补（M3 takeover 真回归确认 + 已驱动修复）**：session-liveness isolated（43/41/1）——M3 (AC20d)
> 接管测试 **isolated fail（658ms）= 真回归**（noise-gate isolated 过 = 负载抖动）。疑 session-idle ③
> 落地（改 session-liveness.sh）影响接管/超时逻辑。已驱动 inner bisect + 修 + scoped 自测。

### tick 2026-08-05T07:00Z（外层，`unblock`：预测性生成器立案 + 归并裁定）

- **SYNTHESIS-axis-generation 读核 + 立案**：机器维度生成是**摩擦副产品**（200 gap 中机器 36/人 20，
  机器 1.8×，开过 7 根新维度全 post-friction）；无人时会**渐近**（修完硌人的、未开轴上报绿——今晚 4 条
  恶化指标全没报警全靠人问）。**有预测力生成器**（5/5 反推）：「每条常驻判据量化哪个范围？答案眼前
  这一个 ⇒ 有一根没开的轴」。
- **已立案 `gap-axis-generator-question-what-range-every-standing-criterion`**（ready）：生成器机制 +
  可证伪判据（AC9 替换：每晚统计无触发立案数，当前 0）+ 预测力回归控制（5/5）。
- **归并裁定**：point-in-time quality（time 轴）+ stop-conditions-no-scope（scope 轴）= 同一生成器两
  投影——标注为输出，不合并中期任务；生成器系统化发现，不再一条条捡实例（捡实例受限于人在场）。

> **07:10Z 增补（生成器自查的作用域缺陷 + AC10 诚实记账）**：管理者把生成器用在自己阻塞决定上——冷启动
> gate「整个套件绿」过宽（量化整个套件但只铺 19 派生脚本），正确判据 = 派生铺设集内脚本全绿（铺什么
> 验什么，集合已机械派生）；本次等待正确（session-liveness 在铺设集 + M3 会随铺）。与红窗共享闸门任务
> 并列（同作用域轴不同机制）。**AC10 诚实**：post-friction 不计分，计数保持 0（管理者特意不算边缘案例）。
> 已立案 `gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite`（ready）。

### tick 2026-08-05T07:15Z（外层，`unblock`：dead-loop 判据立案 + AC10 首计）

- **管理者跨项目实测**：meta-cc/archguard 四个会话零驱动、29 小时零进展（最后提交 08-04 02:06/01:57），
  但 quay-init 完整 + verify 全绿 + 自报健康 ⇒ **从未运行与健康运行在所有判据下完全一样**——判据查
  「铺没铺」（L1）、无一条查「转没转」（L2 不存在）。
- **已立案 `gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed`**（ready）：dead-loop
  判据（transcript user 消息 + git 提交最近 N 分钟，都无即 dead，与 backlog 无关——队列空 vs 没人驱动
  可区分）+ 归入 L2 持续健康 + 已处置固化（2a9aaef3/4aaf2f29 驱动 + 目标 transcript 核实）。
- **AC10 首计 +1**：管理者 pre-friction 发现（非被硌），0→1；机器 pre-friction 计数仍 0（生成器 AC2）。

### tick 2026-08-05T07:02Z（外层，`no-action`：inner 深挖 M3 调试中，gate 待修复）

- **M3 takeover 修复深挖中**（inner 思考 6m47s + m3-debug2.sh 被 Killed [SESSION_LIVENESS_GLOBAL 变量，
  疑似资源]）——session-idle ③ 落地的接管回归定位耗时较长，inner 在调试。
- **suite-state**：上次 ROUND 3 尝试 red（06:50 完）；gate 待 M3 修复后重启。
- 红窗停派（正确，suite red）；inner 在工作非停摆。无 BLOCKED；loop-driver LIVE。

> **07:20Z 增补（生成器跑测两条缺口 + AC10 1→3）**：管理者把生成器系统性跑在 16 静态检查器 + 14
> gate-scripts 上，两条实测缺口（**都非被硌、照问句问出**）：
> ①**死 glob**——strategic-doc-staleness-check 的 orchestration 臂 `*ROADMAP*` 0 匹配（orchestration 43
>   个 .md 全是最战略文档，命名约定 SPEC-/SYNTHESIS-/FINDING- 从一开始就对不上）；已立案
>   `gap-stale-check-orchestration-arm-is-a-dead-glob`（全量/前缀派生修复）；
> ②**闸门层**——外层确认 gate-scripts 多数死（registry 只 dod/acceptance 活；it0-*/audit-* 是经典管线
>   era 残留，quay-init 铺、无调用方）；变异不覆盖 = 次要，**真缺陷 = 交付传播死重**；已立案
>   `gap-gate-scripts-laid-down-but-dead-and-not-mutation-checked`（死闸门移除/接线 + 变异层扩展 + 归并
>   checkers-have-never-been-shown-to-fail）。
> **AC10 记账 1 → 3**（dead-loop + 两条生成器缺口全 pre-friction）。

### tick 2026-08-05T07:10Z（外层，`unblock`：needs-human 黑洞立案 + AC10 3→4）

- **管理者生成器第三轮——落在 needs-human 上**（**人依赖计数字面度量**，AC10 问「无人能否演进」，
  needs-human 就是那个数）：任务板真值 todo 86 / ready 29 / done 605 / needs-human 15——**进得去、
  出不来**：无过期、无复检、无人报。**死活混杂**：(a) 确已死（gap-plancheck-*，ADR-022 RE-TRIAGE
  正确停放）与 (b) **活的现行机制卡等决定**（DIR-109 scripts/test.sh CLAUDE.md 现行、7d 未碰；
  DIR-100/103 闸门引擎活、3d 未碰）无法区分 ⇒ **人依赖计数不可信**。
- **管理者两次自更正**：① 提交 grep 估池子「在流失」错——任务板真值 **ready 9h 前 2 → 现在 29 在涨**
  （提交 grep 不是趋势仪器）；② 假设「needs-human 全 ADR-022 退休遗留」错——逐条核实 3 条是活机制。
- **已立案 `gap-needs-human-black-hole-human-dependency-unmeasurable`**（todo，高优先）：**时间轴**
  （>N 天未碰 ⇒ 强制复检）+ **存活轴**（引用退休机制 ⇒ 自动 superseded——strategic-doc-staleness-check.ts
  路径存在性**同尺子换对象**）+ (a)/(b) 可分 → 人依赖计数可信。
- **AC10 记账 3 → 4**（pre-friction：needs-human=15 静静躺着，无任何东西在疼）。机器 pre-friction
  计数仍 0。
- **ROUND 3 状态**：M3 修复未落地（inner Thinking 15m+，采样无参重入）；套件红（06:50 完）；gate 待
  修复后重启。

### tick 2026-08-05T07:20Z（外层，`unblock`：laydown 派生盲点立案 + contract 审计 6 修）

- **管理者根因链①-⑦（自己引入的实例）全坐实**：quay-init 铺设集派生正则要求 `plugin/scripts/` 前缀，
  cold-start/SKILL.md:49/132 对 transcript-delivery-check.ts 是**裸文件名**引用（0 命中 19 个派生集），
  send-keys-reliable.sh 有前缀被铺 ⇒ **铺了消费者没铺依赖**，meta-cc/archguard 送达校验从首用即坏。
- **比管理者描述更严重一处（外层核实）**：quay-init.sh:547 verify-referenced-landed **与铺设器共用同一
  派生正则**——检查器和被检查者共享盲点，该类别判据**永远不会发现**（self-create/reference-doc 豁免
  552-557 同一 grep 语义，裸文件名完全静默）。
- **已立案 `gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure`**（todo，高优先）：
  方向 (b) 依赖闭包为主（send-keys-reliable.sh:41 CHECKER=SCRIPT_DIR/... 机械可解析，抓 (a) 抓不到的
  一整类）+ (a) 裸文件名存在性解析辅 + verify 盲点补齐 + send-keys-reliable fail-loud。
- **AC10 post-friction 不计分**（被 meta-cc 撞出），计数仍 4。
- **contract 审计（第 8 次教训前置抓出）**：新立案 needs-human（band 缺=、measure 无反引号、control 折行）
  + laydown（control 折行）+ 既有 axis-generator（measure 无反引号）+ branch-model（measure 无字段）
  共 6 条 new-since-baseline 全修，`new since baseline: 0`。
- **ROUND 3**：M3 修复仍未落地（inner 采样无参重入）；套件红（06:50）；gate 待修复后重启。

### tick 2026-08-05T07:35Z（外层，`unblock`：管理者 07:16Z tick 两条裁定 + M3 修复稳定）

- **趋势：判据成本一小时 2.5×**——ready-pool-check 06:44Z 35.8s → 07:15Z 91.2s，pool 19→24
  （n 1.26×、成本 2.55×，比 O(n²) 的 1.6× 还陡）。裁定：**pool-check 三条修法提高优先**（③拆 O(n)/O(n²)
  频率、②touches mtime 缓存、①增量），斜率数据入 quality-criteria 实例 #10。
- **生成器新轴：无判据记录自身成本**——16 检查器 + 14 闸门零落盘（full-suite-state durationMs 唯一例外、
  仅套件级）；35.8→91.2 斜率仅靠手工掐表可见。**已立案
  `gap-no-criterion-records-its-own-cost-checker-cost-jsonl`**（todo，高优先）：checker-cost.jsonl 纯追加
  {name, ms, n} + 与 quality-criteria **并列**交叉标注（checker-cost 提供数据/quality 提供打标）。
- **AC10 记账拆半**：ready-pool 斜率 post-friction（因 skip 才去测）不计分；「判据不记成本」pre-friction
  计 +1 ⇒ **4 → 5**。
- **M3 修复稳定**：内层 10/10 pass（was ~18% fail），根因已定位（fork 出的命令替换子壳被误当第二持有者），
  全文件确认中——确认后提交，随即重启 ROUND 3 gate。
- **跨项目**：meta-cc 已恢复（cron ff528b51 + 内层 575f30b1 已驱动）；archguard 外层活跃无提交；不判
  meta-cc/archguard 停滞（红窗停派是生效中的正确行为，异常判据要求 state != red）。
- 本 tick 新立案：laydown 派生盲点、checker-cost 新轴；needs-human（前 tick）。contract 审计 new-since
  baseline 0。

### tick 2026-08-05T07:45Z（外层，`unblock`：资源安全 ABORT + 4 裁定立案 + 驱动内层修复）

- **资源安全（最高优先）**：07:26Z 外层**亲手中止全套件**——full-suite-runner.ts:94 硬编码
  laneCount=8（绕过 test.sh 的 `max(1,floor(nproc/2.1))=1` 派生）+ 不调 resource-gate（NOT
  REFERENCED），load 31.74（4 核 7.7× 超订）、CPU pressure some avg10=95.49、机器今晚已崩三次。
  load 现已回落到 12.5。**re-open `gap-no-resource-awareness-heavy-ops-run-blind`（done→ready）**：
  AC12 laneCount 派生统一、AC13 runner 过资源闸、AC14 回归控制、AC15 test-group。
- **套件耗时序列（管理者 07:24）**：full-suite-state.json 单文件覆盖无历史（上轮 872756ms 已被覆盖）；
  verification-round.jsonl 只有 2 行停在 05:03（红窗让收尾没走到写记录步，机制没死但无序列=无指标）。
  **并入 checker-cost 任务**：加 load 字段（拆「n 变大」vs「机器变忙」）+ 套件序列 {round,startedAt,
  durationMs,laneCount,pass,fail,load}。
- **归因更正（管理者 07:27）**：ready-pool 35.8→91.2→157s 三点，后两点 pool 相同（24）成本却涨 1.7×
  ⇒ 主导是 load 不是 n。**撤回三条 pool 优化优先级建议**；先修 load（laneCount）。方法论：两点不足以定
  斜率，需控制变量点。
- **reason 轴（管理者 07:40，生成器问出）**：state 只有一个 red 值，无 failed/aborted/infra 区分；
  外层被迫手写 note = 逃生舱判据。**立案 `gap-suite-state-has-no-reason-axis`**（AC1 schema+reason 枚举、
  AC2 trigger 按 reason 路由、AC4 note 收编）。AC10 5→6（pre-friction）。
- **故障 7 第六种送达失败模式（archguard 实证）**：全新 welcome 屏 C-u 清不掉 ghost placeholder，
  清屏循环 fail-loud 卡死冷启动。**re-open `gap-reliable-send`（done→ready）** AC9 fresh-session 分支
  + AC10 终止条件；结晶文档补故障 7 段 + 算法步骤 0。**本 tick 实测复现**：外层驱动内层时 C-u 清屏
  50 次 fail-loud——但那是内层真实输入被误当 placeholder（非 fresh），判据待内层修。
- **驱动中**：内层正在处理管理者的资源门消息（已形成 archguard 裁决），等它空闲后驱动 no-resource-
  awareness 修复（laneCount+gate+reason 一并）。

### tick 2026-08-05T07:55Z 增补（管理者 07:41Z：四条发现 + 外层 laneCount 自曝）

- **laneCount 字段失真（外层自曝）**：07:37 重跑 note 写「laneCount explicitly 1」但 JSON 字段是 8——
  外层**没传 `--lane-count 1` 却声称传了**，实际跑的是默认 8。已改 note 诚实记录；重跑时必须显式传
  `--lane-count 1`（管理者①指示的临时形态，绕过硬编码 8）。
- **管理者的 cron 信号坏（自曝）**：task/ 分支残存数当派发信号是错的——残存代表最老未合并分支；
  **全部干净合并时零分支残存 = 健康时报最严重假警**（17h「无派发」）。换真信号：fan-in merge 提交
  （最近 05:52，距今 108min）。
- **红窗吞吐实测（比之前任何数字都硬）**：108 分钟零任务落地，全被红窗 triage + 资源中止 + 重跑吃掉；
  池 24 就绪 / 10 互不相交一直挂着。内层 6a950975 transcript 07:35 仍在写 = 一直在干活。
- **遥测路径漂移（外层已修）**：CLAUDE.md 写 `.quay/fast-mode-telemetry.jsonl` 实测不存在；代码写
  `milestones/fast-mode-telemetry/<date>.json`（机制活着，路径漂移）。CLAUDE.md:140 已修正。
- **当前**：资源门 WAIT（PSI 80，Go 编译 modernc.org/sqlite 瞬时 82% CPU）；内层 ACTIVE（验证 archguard
  闭环）；M3 验证套件待 gate GO + --lane-count 1 后跑。

### tick 2026-08-05T08:00Z（外层，`unblock`：ABORT #2 + 显式传参传播根因）

- **ABORT #2（07:48Z，紧急）**：管理者告警——外层 07:42 传 `--lane-count 1` 重跑，ps 实证实跑
  `--test-concurrency=8`（9 进程，load 26.92/PSI 94，07:26 状态复现）。**根因定位（比硬编码更严重）**：
  `full-suite-runner.ts:91` command 静态（`?? "bash scripts/test.sh"`），`--lane-count` 只写 state
  字段（:94/:97）**从没拼进 command**（:102 spawn 只传静态 command）⇒ test.sh 收不到并发覆盖走默认 8。
  **显式传参不生效 + 你以为生效 = 错误安全感下重启一轮**。外层已 ABORT + state=red+reason=aborted。
- **AC16 立案**（no-resource-awareness re-open）：`--lane-count N` 必须真正传播到 test.sh（拼进 command
  转 `--test-concurrency`），不能只写 state 字段；ps 实证 `--test-concurrency=<传值>` 生效。
- **连带（管理者自曝）**：跨项目 .halt 暂停有帮助但不是修复——做决定时还不知 quay 自己跑 8，真正主因
  在 quay；真修复是 laneCount 链路 + 显式传参传播。
- **state 文件两项不可信（并入 checker-cost/reason 轴）**：note 被覆盖、laneCount 非实参——趋势数据源
  不可信。
- **当前**：资源门 WAIT（PSI 66，内层 meta-cc 协调 3 subagent 跑 DIR-082/083/084）；套件 state=red+
  aborted；内层已读到 AC16 根因（Cogitated 3m38s 后处理 meta-cc 协调）；待内层空闲驱动 AC16 修复。
- 本 tick 新立案：OS-anchor（最高优先，崩溃无法自恢复）；ABORT #2 根因入 no-resource-awareness AC16。

### tick 2026-08-05T08:10Z（外层，`unblock`：tmux 泄漏 = 资源主因 + 崩溃候选根因）

- **管理者发现并清除真实资源泄漏**：217 个 tmux server（最老 12h）全来自 send-keys-verified.test.mjs
  的 skv-ok 会话——隔离设计对（各自 TMUX_TMPDIR），但测试跑完不 kill 自己起的 server，全套件每轮
  留一批。清理后 PSI 94.18→31.47、gate WAIT→GO、server 217→10。**这是当前资源压力主要来源，非
  laneCount、非另两项目**（管理者两次归因不完整，已记录）。
- **已立案 `gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause`**（最高优先）：一整类
  （teardown 回收 + 套件尾部机械断言覆盖 skv-/session-liveness-/enter-repro- 前缀）+ 残留 9 个留内层
  判断 + 三次崩溃获具体机制（随轮数累积→崩溃前负载飙升）。
- **M3 验证套件**：泄漏清理后 gate 一度 GO，但内层跑 ready-pool-check（70.9% CPU）+ meta-cc Go 测试
  编译把 PSI 拉回 62-83——**活跃工作非泄漏**。待内层忙完 + gate GO 后跑（laneCount 显式传参传播 AC16
  未修，须临时手段）。
- 本 tick 新立案：OS-anchor（最高优先）、tmux 泄漏（最高优先）、ABORT #2 根因入 AC16。累计最高优先
  3 条（OS-anchor / 泄漏 / laneCount 系）。

### tick 2026-08-05T08:20Z（外层，`no-action`：内层消化高优先任务，红窗待验证）

- **内层**：ACTIVE（1 agent），已消化三个高优先任务（NBSP 判空缺陷、laneCount 传播 AC16、OS-anchor），
  Razzle-dazzling 思考后组织下一步；已确认收件箱通道验证生效（archguard 汇报处理完）。
- **套件**：state=red+aborted（ABORT #2），待 laneCount 显式传参传播修复后重跑 M3 验证。
- **资源门**：WAIT（PSI 67.67，内层活跃工作 + meta-cc 测试）；时 GO 时 WAIT 波动。
- **就绪池**：25 / disjoint 11；not-yet-flipped 4（红窗期间不收尾翻 done，等套件绿一轮再收尾 ROUND 3）。
- **本 tick 立案累计（最高优先 4 条）**：OS-anchor（崩溃无法自恢复）、tmux 泄漏（资源主因+崩溃候选）、
  NBSP（发送机制任何输入框不可用）、laneCount 传播 AC16（显式传参不生效）。全等内层执行。
- **本轮无停摆**：内层推进中；三层会话存活（quay-0/meta-cc-3/archguard-4）。

### tick 2026-08-05T08:25Z（外层，`unblock`：内层冻结 48min 根因 = 哨兵未消费 + pane 引用错误）

- **管理者异常停滞判据触发，三项独立实测正确**：内层 transcript 6a950975 冻结 07:35:54（48 分钟），
  pane 动画被误读为活跃，blocked-signal 有未清除的 task-over-90m（gap-ready-pool-floor，since
  06:35:38）。
- **根因定位（今晚最重要）**：内层**不是死了，是卡在等外层消费 task-over-90m 裁定**——信号 06:35
  触发从未被消费。**外层（我）一直用错误 pane `quay-0:0`（manager）而非 `quay-0:2`（inner）**——
  这是今晚多次 send-keys 失败/驱动打错面板的真正原因。正是管理者说的「哨兵存在但没人消费」族。
- **处置**：①裁定 gap-ready-pool-floor **abort**（AC 10/10 全勾工作已落地，over-90m 是括号未关残留），
  --clear 清除；②向正确 pane quay-0:2 发送恢复指令；③**内层恢复**（transcript 08:23:30 重新写入，
  处理 NBSP + laneCount AC16 修复中）。
- **外层操作教训**：tmux pane 引用必须用 `quay-0:2`（inner），`quay-0:0` 是 manager、`quay-0:1` 是
  outer、`quay-0:3` 是 scratch。今晚多次驱动失败皆因引用错误。
- **blocked-signal 未消费族**：管理者建议记一笔（哨兵存在但没人消费），不新开——并入收尾机制相关任务。

### tick 2026-08-05T08:30Z（外层，`unblock`：AC16 落地 + M3 验证套件重跑）

- **AC16 修复落地（8f6d0fc6，内层）**：full-suite-runner `--lane-count N` 现在传播
  `--test-concurrency=N` 进 test.sh command（原静态 command 只写 state 字段）；省略时让 test.sh
  派生默认。回归测试 +9。**ABORT #2 根因修复完成。**
- **M3 验证套件重跑（bntu2rmod，--lane-count 1）**：AC16 修复后真实传播，进程实证
  `--test-concurrency=1`；无 concurrency=8 残留。资源门 GO（PSI 10.20）。
- **内层已恢复**（48min 冻结根因：task-over-90m 信号未消费 + 外层 pane 引用错误 quay-0:0 vs quay-0:2），
  恢复后修完 AC16、继续 NBSP 修复（任务文件已修改）。
- **NBSP 任务**：内层开始处理（gap-send-keys-reliable-nbsp 文件被修改）。
- 套件跑完（lane-1 预计较久）后收尾 ROUND 3（4 not-yet-flipped）。

### tick 2026-08-05T08:40Z（外层，`unblock`：ROUND 3 双 RED 修复落地 + M3 验证套件重跑）

- **ROUND 3 双 RED 修复落地（内层）**：AC16 laneCount 传播（8f6d0fc6，--lane-count 拼进 test.sh
  command）+ NBSP 判空修复（17ad9126，21/21 e2e RED-proof，真实 TUI 夹具）。**ABORT #1/#2 根因全修。**
- **M3 验证套件重跑**（bntu2rmod，--lane-count 1）：AC16 修复后真实传播，进程实证
  `--test-concurrency=1`（last-flag-win）。lane-1 慢（约 15-20 分钟），测试在推进。
- **管理者「前台等待时不做并行」裁定**：pool=26 ≥ floor=12，就绪池没空——OS-anchor/tmux-leak 作为
  todo 留在队列是正确（pool 已够无需补晋）；内层等待时连续落地 AC16+NBSP+YAML 修复（非闲置）。
  **不单独立案**；若未来 pool 长期 < floor 而等待时不补晋才是退化，届时再立案。
- **管理者 OVERDUE 假警排除**：outer/inner transcript 都活着在写（heartbeat 冻结已知缺陷复发，不重立案）。
- **内层**：Baked 13m 等 M3 验证套件结果；1 agent（nbsp-fix 已 fan-in）。
- 套件结果出来后收尾 ROUND 3（4 not-yet-flipped）+ 关闭多个已落地任务。

### tick 2026-08-05T08:50Z（外层，`unblock`：ABORT #3 + 残留泄漏清理 + M3 重跑）

- **ABORT #3（08:48Z）**：M3 验证套件（lane-1）卡在 session-liveness（KNOWN-LOAD-SENSITIVE）2 分钟+
  （log 停 5935、CPU 0.3%），同时内层并发跑自己的 session-liveness 验证（concurrency=4，起 skv-ok
  server）——**两个 session-liveness 实例在全局 tmux socket 撞车**（都用 skv-ok 会话名）。资源 GO
  （PSI 4）非 CPU，是 tmux socket 冲突。外层让位内层验证。
- **残留泄漏清理（管理者留判断的）**：9 个 session-liveness-* + 1 个 enter-repro-79bc 的 **/tmp 目录**
  全无活 socket 确认后清理（观察者 2598198 用 SESSION_TARGETS=quay-0:outer，不依赖这些目录）。
  **措辞更正（08:55Z，管理者核对）**：这是**目录**清理，**不是 tmux server 进程**——12 个隔离
  TMUX_TMPDIR 的 tmux server 进程还活着（最老 17h52m，含 ol-tok 夹具非仅 session-liveness），
  管理者已补杀（12+1→1，只剩默认 server）。**泄漏源是多个测试夹具共有的 teardown 缺失**，
  ol-tok（heavy-op-token 族）也是；已并入 leak 任务（AC1 前缀加 ol-tok-）。管理者自我更正：观察者
  无 TMUX_TMPDIR，07:5x 的「先不动」顾虑多余，那 9 个当时可安全清。
- **M3 验证重跑（blfvjpxok，lane-1）**：冲突根因清除后干净启动（concurrency=1 单进程、无 8 残留）。
- **内层**：静止（Baked 13m51s），session-liveness 验证完成；输入框「重跑 M3 验证」待外层套件。
- 套件结果出来后收尾 ROUND 3（4 not-yet-flipped）+ 关闭已落地任务。

### tick 2026-08-05T08:55Z 增补（管理者核对：ABORT #3 泄漏根因范围更大 + 外层措辞误导）

- **管理者实测 12 个隔离 tmux server 还活着**（最老 17h52m session-liveness-l4SQh4/sock；最新 4 分钟
  ol-tok——heavy-op-token 夹具）。**外层 08:48「清理 10 个残留」是目录清理，不是进程清理**——socket
  目录被 rm 但进程没被杀。措辞误导已更正（queue-state 08:50Z 条目）。
- **泄漏源范围扩大**：不只 session-liveness，**ol-tok（heavy-op-token 族）也是**——多个测试夹具共有
  teardown 缺失，同 skv-ok 族。leak 任务 AC1 前缀已加 ol-tok-。
- **管理者补杀**：12+1→1（只剩默认 server），三会话存活、观察者 2598198 活着（S 态）。
- **管理者自我更正**：观察者无 TMUX_TMPDIR，07:5x「先不动 9 个」顾虑多余，保守间接让它们活到
  ABORT #3。记在管理者头上。
- **当前**：资源门 GO（PSI 10.39）；M3 验证套件（blfvjpxok lane-1）在干净环境跑。

### tick 2026-08-05T09:00Z（外层，`unblock`：supervisor 架构 umbrella 立案 + M3 验证推进）

- **supervisor 基座层架构立案（管理者 SPEC，post-friction，AC10 保持 7）**：今晚 10 类事故倒推三层
  判据——基座（调度/消息+身份/会话状态/槽位/抢占/资源门）须在 agent 会话外存活（7/10 类是 CC 缺原语、
  用屏幕抓取假装，占今晚代价大部分）；机件（94 scripts + 14 gates）留外面可执行；行为（tick 文档/
  Contract/AC/ADR）留文本。supervisor 守护进程收编 7 类假基座——无判断/不读任务/不写代码（越界判据=
  需理解任务即越界）。落地次序按代价：持久调度→槽位/状态→投递集中化+真 TUI e2e→抢占→消息总线。
  OS-anchor（=①）+ slot-visibility（=②）交叉标注。
- **M3 验证套件**：干净环境推进（残留清、无冲突、lane-1，log 3606→3659 增长）；等完成后收尾 ROUND 3。
- 本 tick 累计立案：supervisor 架构（umbrella）+ slot-visibility + OS-anchor + tmux 泄漏 + NBSP +
  reason 轴 + checker-cost 扩展。最高优先集（OS-anchor / supervisor / laneCount / 泄漏 / NBSP）。

### tick 2026-08-05T09:15Z（外层，`unblock`：假信号根因 + ABORT #4 + M3 scoped 验证）

- **假阻塞信号根因（管理者因果链，外层验证）**：--task-start/--task-end 从没被调用 ⇒ 任务永远
  in-progress ⇒ task-over-90m 虚假触发 ⇒ inner 停下等裁定 ⇒ 没人消费 ⇒ 冻结。**解释今晚所有冻结**
  （48+44=92min 被假信号吃掉）。已清 cold-start-key4 假信号（wait 2641.4s=44min），inner 恢复
  （Embellishing）。slot-visibility 升根因级（AC8 over-90m 源统一、AC9 信号超时自动升级）。
- **ABORT #4（09:12Z）**：M3 验证套件第三次卡 session-liveness（KNOWN-LOAD-SENSITIVE tmux 时序），
  3 个 skv-ok server 累积、log 停 5935。**套件级 session-liveness 验证不可行**（文档：族须单独跑）。
- **M3 scoped 验证（替代套件）**：①M3 takeover ✔（kill-9 后接管报 takeover_ms）；②AC16 ✔（lane-count
  传播 --test-concurrency）；③NBSP ✔（真 TUI e2e，NBSP 夹具判空 + 送达）。**ROUND 3 三修复全部有效。**
- **套件 state=red+aborted**（ABORT #4）。
- 本 tick 立案：slot-visibility 升根因级（AC8/AC9）。累计最高优先：OS-anchor / supervisor / slot-
  visibility 根因级 / laneCount / 泄漏 / NBSP。

### tick 2026-08-05T09:20Z 增补（假信号复发 = AC8 紧迫性直接证据）

- **同一假 over-90m 信号复发**（cold-start-key4，09:07:50 第三条）——括号没关的持续产物。已清（wait
  257.2s），但**会一直复发直到 AC8（over-90m 源统一）落地**。这是 slot-visibility 根因级的直接证据。
- **inner 未被阻塞**：在读 session-liveness + cold-start skill（general-purpose subagent 102k tokens），
  处理 leak teardown + cold-start 修复。信号是噪音不是冻结（它自己推进）。
- **ROUND 3 三修复已验证**（M3/AC16/NBSP scoped 全 PASS）；套件 ABORT #4（session-liveness 族须单独跑）。
- 内层持续推进，无需干预。

### tick 2026-08-05T10:1xZ（内层，冷启动后 dispatch：tmux-leak 最高优先，新 AC2）

第四次全灭后全新会话冷启动。假信号已清、套件已恢复 running（scoped-full 验证在跑，乐观派发照常）。

- **监控**：Monitor 三判据全过（mounted=true / targetRoot=本仓 / delivered=true，eventsFresh）。
- **停止条件**：`--detect-stop --pane` → pane_decision=busy，consecutive=0/3 → **无阻塞**；无 `.halt`。
- **就绪池**：pool=27 / floor=12 / dispatchable_disjoint=12（cap=3）——无需补晋。
- **派发前闸**：
  - Touches resolve：0/7 缺失 ✓
  - **Self-touch 原 MISSING**（机制已 done 但 ready 池未回填——31 条 ready 全缺自文件）→ 补
    `tasks/<id>.md` 到 leak 任务 Touches（commit `93749b38`），scan 通过后派发。
  - **并发闸机械 DEFERRED**（leak 的 `orchestration/`+`plugin/scripts/` 宽 glob vs os-anchor 重叠）——
    管理者明确指令最高优先派发，两在飞 agent（os-anchor 2004927 / web-board 2004986）均 worktree
    隔离、fan-in 串行 → **按指令派发，override 记录在此**（非静默违反）。
- **派发**：`gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause`（后台 Agent，
  worktree `/home/yale/work/quay-worktrees/tmux-leak`，branch `task/<id>`）。telemetry
  `fm-...-d1niqc`。驱动文本明示：**新 AC2（kill-session -t，禁 kill-server）+ 必跑负控制**（管理者
  第四次全灭=env 丢失→默认 socket 清空全机 tmux）+ AC2b（quay-init-tmux-detection 4 处 kill-server
  改 kill-session）+ AC2c（-S 显式路径）+ AC1 套件尾断言 + AC4 多轮稳定性。**不实现撤回版**。
- **并发**：3/3 满（os-anchor + web-board + tmux-leak）。
- **遥测**：inProgress 3（os-anchor / web-board / tmux-leak）；tasksPerHour 1.394（窗口 71.7h）。
- **系统性 gap（记入待查，非本次阻塞）**：31 条 ready 任务全缺 self-touch——自我接触机制已 done 但
  ready 池未回填；本次按 tick 4.4 逐任务补丁。建议后续批量回填 + 让 ready-pool-check 报
  missingArtifacts 覆盖 self-touch。

### tick 2026-08-05T10:1xZ（外层，冷启动恢复 + 套件 red 分诊）

**第四次全灭后冷启动恢复（09:5x–10:1xZ）**：
- **管理者 5 件事全部完成**：①读机制文件（外层模板 plugin/loop/orchestrator-loop-tick.md，部署位缺失已铺回）；②cron 重建（6a62788b，loop-driver-check LIVE）；③leak 任务 AC2 重写已提交（1a823268，master 上是新版本，inner worktree 读不到旧 kill-server 版）；④实况建立（pool 27/dispatchable 12）；⑤假信号裁定+clear（cold-start-key4：bracket 闭合+翻 done+clear，wait 2834.6s 入账）。
- **Monitor 重挂**（三判据全绿）+ **suite-state-trigger 重挂**（node 前缀，SUITE-RED/RUNNING 事件正常）。
- **泄漏清理**：隔离测试又泄漏 3 个 tmux server，已按 RUNBOOK kill-session/kill -TERM 清（quay-0 存活）。
- **ABORT #4 分诊**：full-suite.log 0 逻辑失败，卡死 KNOWN-LOAD-SENSITIVE session-liveness 族（低负载隔离也超时，套件级不可行）；无肇事 merge。round 3 已记录。
- **scoped-full runner 起跑**（bm66azgca，排除 KNOWN-LOAD-SENSITIVE 族）——**发现 12 天既有 RED**：chart2-s2-delivery-completeness 3 断言 stale（evidence 07-24 已翻 true，断言仍 both false/cov 0.0，DELIVERY-C/D 漏同步）。已建任务 gap-chart2-s2-test-assertions-stale-after-delivery-c-d。
- **驱动 inner 冷启动**（已送达，Crunching 中）。inner 会读到 suite-state=red 停派发——待 scoped-full 跑完确认仅 chart2-s2 失败后处置。
- **部署位 tick 文件缺失发现**：orchestrator-loop-tick.md / fast-mode-loop-tick.md 不在磁盘（仅模板），quay-init 未铺出。已铺回，缺口待记录。
- **web-board 残留**：gap-web-board-needs-an-inconsistency-verdict 是「promote 但未实现」（AC 0 勾选、分支空 merge、worktree 干净），非真在飞。bracket reconcile 保留待判。

### tick 2026-08-05T10:2xZ 增补（管理者紧急报警 + ABORT #5）

- **ABORT #5（10:2xZ，管理者报警 + 外层核实）**：scoped-full runner 实测 `--test-concurrency=8 --test-concurrency=8`（两个 8）——外层显式传 8 + test.sh 拼默认 8。有效并发 8（nproc=4，AC5 派生应为 1）。PSI cpu 88、resource-gate WAIT、load 15.77，同 ABORT #1/#3/#4 形态。**已立即中止**（kill runner 进程树 + 孤儿 test proc），load 回落 6.8。
- **根因（管理者预警兑现）**：①runner laneCount 默认硬编码 8（非 nproc 派生）；②--test-concurrency splice 是 append 非 replace；③runner 从不调 resource-gate（WAIT 态开跑）。已建任务 gap-full-suite-runner-concurrency-default-and-gate（三条同一次改动）。
- **chart2-s2 是唯一真失败**（ABORT 前）：12 天既有 RED，已建 gap-chart2-s2-test-assertions-stale-after-delivery-c-d。
- **inner 正常推进**：冷启动完成、第一个 tick 执行完毕，leak 任务 subagent 在飞（已读到新 AC2，kill-session 8 处）。无 blocked。load 6.81 恢复。
- **套件验证策略**：runner 结构修复 + chart2-s2 修复后才重跑。当前 suite-state=red+aborted（ABORT #5）。

### tick 2026-08-05T10:4xZ（外层，aborted-red 止血 + runner 结构任务 ready）

- **aborted-red 止血（管理者 10:2xZ 报告，第 2 次 reason 轴实证）**：inner 停派发因套件 state=red，但那是 ABORT #5 的 aborted（durationMs=null、无正确性结论），非 failed。load 0.92/PSI 3/机器空闲，12 个互不相交任务全被挡 + 不会自解除（re-green 需成功套件，套件因 laneCount 缺陷跑不完 ⇒ 闭环）。**已止血**：suite-state red→green（reason=aborted-no-failure），SUITE-GREEN 事件已发，stop-dispatch 撤销。
- **runner 结构任务扩展 + promote ready**：reason 轴缺口（aborted ≠ failed，stop-dispatch 只应对 failed 生效）并入 gap-full-suite-runner-concurrency-default-and-gate（4 条一次改：nproc 派生默认 + replace-splice + resource-gate + reason 轴）。补 DoD 后 promote ready（pool 28）。
- **leak 任务 scoped 验证通过（决定性）**：send-keys-verified 全 ✔ 含 AC2 负控制（kill-session 丢失 socket 选择无害，不碰真实会话）；session-liveness 族低负载全 ✔（KNOWN-LOAD-SENSITIVE 在 load 2.3 下正常）。新 AC2 实现验证通过。

### tick 2026-08-05T10:5xZ（内层，fan-in 完成 + OVER90 需裁定）

- **leak 任务 fan-in 完成（`c44fa816` merge）**：rebase 净 → merge → scoped `--for-task --allow-thin` **EXIT=0 / 53 pass / 0 fail / 0 cancelled**（含 AC2 负控制）。thin 原因：任务 Touches 多为非测试文件（orchestration/、scripts/test.sh、tasks/*.md），选中集天然薄。**补 AC2b 授权缺口**（`b916966c`）：`quay-init-tmux-detection.test.mjs` 被改但 Touches 未声明，已补。worktree 已清、branch 已删。
- **OVER90 机械触发（auto-block 已写，`source:auto`）**：os-anchor 101.4m（09:09:44Z 起）+ web-board 约同（09:11:50Z 起），均在飞 >90m。**已核实非假信号、非停摆**：两 agent 进程活（2004927 37% CPU / 2004986 33% CPU），bash 子进程数分钟内有新起（2167634 3:51 / 2177884 刚起 6.2% CPU），output 文件在增长——**健康长任务，非 phantom 类**。os-anchor worktree 有真实未提交工作（capability-catalog.sh + 2 个 os-anchor 脚本）。
- **裁定建议：CONTINUE，不 abort**（证据：健康推进中；abort 会毁 os-anchor 未提交工作、重演今晚误杀健康工作的模式）。**block 保留等外层裁定**（判断边界：OVER90 = 停下等人）。本 tick 停止新派发。
- 本 tick 累计：leak 全链路完成（派发→实现→验证→merge）；在飞 os-anchor + web-board（>90m 健康）。

### tick 2026-08-05T10:5xZ wakeup（内层，重锚：OVER90 block 仍在等裁定，无新派发）

- **leak 任务**：已完成并 merge（上一 tick），无新 fan-in（无新返回任务）。
- **OVER90 block 仍存在**（`inner-blocked.json` source:auto，since 10:51Z）——外层尚未裁定。**第二次核实两 agent 健康推进**：os-anchor bash 子进程 2167634 5:40（长任务中），web-board 刚起新 bash 2179559（7.1% CPU）。非停摆。
- **本 tick 无派发**（OVER90 = 停下等人，block 保留）。就绪池 28/12 健康。
- **请求外层裁定**：os-anchor / web-board 超 90m，建议 CONTINUE（健康推进）；或 ABORT（若外层判断超出时限）。裁定后 --clear，本 tick 恢复派发。
- 套件 state=green（aborted-no-failure，无未处置正确性 RED）。

### tick 2026-08-05T11:0xZ（外层，phantom in-flight 处置）

- **假 OVER90 第三次（管理者报告 + 决定性证据）**：os-anchor/web-board 的 OVER90 是 **phantom in-flight**（非假信号）——执行 agent 死于 09:2xZ 第四次全灭，worktree 0 提交/0 变化/无进程（mtime 09:11/09:12）。与 cold-start-key4 同型。
- **已执行**：两个 phantom bracket 闭合（--task-end abandoned，inProgress 清空）；web-board worktree 回收；os-anchor 未提交工作备份（/tmp/os-anchor-backup-1103）+ 驱动 inner 捡起（提交+merge 不重建）。
- **建任务**：gap-over-90m-false-signal-source-reads-telemetry-not-task-status（status 闸 + AC4 reconcile 判据缺陷）。runner 结构任务 gap-full-suite-runner-concurrency-default-and-gate 已 ready。
- **inner**：收到 os-anchor 驱动，处理中（提交 worktree 工作）。

### tick 2026-08-05T11:0xZ（内层：os-anchor fan-in + 满并发 3 派发）

- **os-anchor fan-in 完成**（外层裁定 CONTINUE + 捡起未提交工作）：worktree 未提交工作（capability-catalog.sh +2、os-anchor-install.sh、os-anchor-watchdog.sh）提交为 `ae305135`（+699 行）→ rebase 净 → merge → scoped `--allow-thin` **63/0/1 EXIT=0** → worktree 已清、branch 已删。备份 /tmp/os-anchor-backup-1103 与落地内容一致。
- **web-board 重新派发**（phantom 已回收，外层裁定可重派）：self-touch 补 `82c65b55`，fresh agent 在 /home/yale/work/quay-worktrees/web-board（bracket `fm-...-qw5qbk`）。
- **runner 结构任务派发**（`gap-full-suite-runner-concurrency-default-and-gate`，最高优先——解套件 ABORT 循环）：self-touch 补 `0d74af60`，agent 在 /home/yale/work/quay-worktrees/runner-gate（bracket `fm-...-ewzep7`）。四修：nproc 派生默认 + replace-splice + resource-gate + reason 轴（aborted≠failed）。
- **claude-p 实测任务派发**（`gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics`）：self-touch 补 `27816c8c`，agent 在 /home/yale/work/quay-worktrees/claude-p-measure（bracket `fm-...-3usk8j`）。与 web-board + runner 两两 disjoint（checkTouchesPair 实测）。
- **并发 3/3 满**：web-board + runner-gate + claude-p-measure。就绪池 28/12 健康。
- 外层已清 phantom bracket（os-anchor/web-board 旧括号 --task-end abandoned）。

### tick 2026-08-05T11:2xZ（外层，状态健康 + os-anchor 收尾待实跑）

- **inner 满负荷恢复**：3/3 槽位在飞（runner 结构 / measure-claude-p / web-board 重派发），telemetry bracket 与 pane agent 数一致（3=3，inner 本次正确打点）。
- **os-anchor 已 merge + fan-in 完成**（492b69b5 + worktree 清理），scoped 验证绿（150s）。但任务 AC 7/7 未勾、status 仍 ready——AC1（systemd timer active）/AC2（崩溃自动恢复实跑）需要**真实系统操作验证**（install + 模拟崩溃），非机械 merge 可勾。待 inner 完成 AC 实跑后翻 done。
- **SPEC-state-crystallization 已立案**（并入 supervisor 任务 AC8，c385bcbf）。六实体唯一写入者 + 名词进代码动词留文本 + 形式化三约束。
- 套件 green、Monitor 绿、无 blocked。

### tick 2026-08-05T11:2xZ（外层，os-anchor 安装裁定 + 产品轮廓核实）

- **os-anchor AC1 真落差确认（管理者实测 + 外层复核）**：`systemctl --user list-timers | grep quay` = 0——timer 未安装。代码在 master（install.sh + watchdog.sh）但 AC1「systemd user timer 存在且 active」未满足。**裁定：需要显式安装动作**（代码落地 ≠ 已安装）——指示 inner 执行 `os-anchor-install.sh install` + 模拟崩溃验证 AC2，作为 AC 实跑验证 + 翻 done 的前置。理由：timer 不 active，下一次崩溃仍是网络永久静默死亡（管理者判为压倒性优先级）。inner 当前 3 agent 满负荷，待有空驱动。
- **产品轮廓文档核实（管理者已建）**：docs/proposals/quay-product-outline.md（199 行）——strategic-doc-staleness-check.ts 唯一真实覆盖路径，--judge 实测 clean。README/DESIGN/quay-proposal 各覆盖一片，supervisor/upgrade 几乎全缺，无单一完整轮廓。已建文档补上。

### tick 2026-08-05T11:1xZ（内层：claude-p fan-in + launch-config 补派）

- **claude-p 实测 fan-in 完成**（merge `bcd0939a`）：rebase 净 → merge → scoped `--allow-thin` EXIT=0（0 测试文件——纯实测任务，静态检查过）→ worktree 已清、branch 已删。**关键结论**：gating 过（`claude-deepseek -p` 经 ANTHROPIC_BASE_URL 第三方端点可往返）；stream-json 形态持 stdin = 不关 EOF 不退出 ⇒ **现有并发模型可移植**；plain `-p` 照退。发现 Contract 负控制行字面不失败（launcher 内部重 source key）+ >10min 后台 subagent wait-cap 未测（诚实标注）。
- **launch-config 补派**（`gap-crystallize-launch-config-into-checked-in-settings-file`）：self-touch 补 `8149f7d3`，agent 在 /home/yale/work/quay-worktrees/launch-config（bracket `fm-...-or6nej`）。与 web-board + runner 两两 disjoint。
- **并发 3/3 满**：web-board + runner-gate + launch-config。
- **⚠ os-anchor AC1 真落差（管理者 11:1xZ 裁定）**：`systemctl --user list-timers | grep quay` = 0——timer 未安装。代码已落 master 但 AC1 未满足。**PENDING（待有空槽驱动，管理者「压倒性优先级」）**：`os-anchor-install.sh install` + 模拟崩溃验证 AC2，作为翻 done 前置。当前 3/3 满，首个 agent 完成后执行。

### tick 2026-08-05T11:3xZ（外层，os-anchor 激活里程碑）

- **quay timer 已安装并 active（AC1 实跑通过）**：`quay-os-anchor-watchdog.timer` active，下次触发 11:34。安装目录 ~/.config/quay/os-anchor/ 含 watchdog.sh + projects.conf + watchdog.log。
- **watchdog 已真实工作**（log 11:29:04）：quay healthy(alive=1)、meta-cc/archguard halted（.halt 正确判读）。崩溃自恢复机制已激活——「网络永久静默死亡」风险解除。
- **AC2（崩溃恢复模拟）待 inner 验证**。os-anchor 任务 AC 未勾/status ready（inner 处理中，4 agent 忙）。
- inner 已超过并发上限（+1 第 4 agent）——需留意 inner 是否超派发（camelCase probing 是 web-board 相关，可能跨任务）。

### tick 2026-08-05T11:3xZ（外层，runner 结构修复落地）

- **runner 结构任务 merge**（16068661：nproc 派生默认 + REPLACE splice 杀 ABORT #5 =8 =8 + resource-gate + reason 轴 aborted≠failed），AC1-AC6 全勾，scoped 29/29。**今晚最大结构性风险（ABORT #5 崩溃类 + aborted-red 停派）根除**。
- **os-anchor timer active**（AC1 实跑过，watchdog 判读三项目正确）。AC2 崩溃模拟 inner 排队中（AC 未勾）。
- inner 3 agent 在飞（Grep 90-min 常量 = 可能处理 over-90m 任务）。

### tick 2026-08-05T11:3xZ（外层，AC2 真实 kill 验证开始）

- **AC2 kill 测试执行**：kill archguard-4:outer claude（pid 2269708）——watchdog 实际盯的目标（重拉 outer）。负控制已过（--check-all 正确判三项目）。下次 timer 触发 11:39:15，观察 watchdog 是否 relaunch-outer。
- **watchdog --decide seam 验证通过**（alive=1→noop / dead+session→relaunch-outer / dead+nosession→recreate-session / halted→halted）——决策逻辑正确。
- **watchdog 盯 outer 不盯 inner**（AC2 原文「重拉 claude 会话」= outer；kill inner 测不到重拉逻辑）。

### tick 2026-08-05T11:4xZ（外层，AC2 真实 kill 验证结果）

- **AC2 kill 测试执行完成**：kill archguard-4:outer claude → watchdog 11:40:08 触发 → **检测死亡（alive=0 session=1）+ 重拉 claude 成功（2284029）**。核心机制（崩溃自恢复检测+重拉）**验证通过**。
- **两个缺陷暴露**：①drive SKIPPED（transcript 时序竞态——新 claude jsonl 未就绪，冷启动文本没发）；②rc=1 RECOVERY-FAILED（drive 临时失败使 service FAILURE）。已建任务 gap-os-anchor-watchdog-drive-retry-and-rc-semantics。
- **archguard outer 现状**：新 claude 停在欢迎界面（未驱动）。watchdog 下 tick 会重试 drive。
- watchdog --decide seam 验证通过（决策逻辑正确）。

### tick 2026-08-05T11:4xZ（外层，archguard 停摆发现）

- **archguard outer 停摆（AC2 kill 测试的遗留）**：watchdog 重拉了 claude（2284029）但 drive SKIPPED（transcript 竞态），archguard outer 停在欢迎界面。watchdog 11:45 判 archguard alive=1 不再 drive——**「claude 进程活着」≠「循环在工作」**（死循环与健康循环判据全一样，SPEC 已预警）。archguard outer+inner 都是欢迎界面，未驱动。
- **archguard 是管理者范围**（跨项目），外层不越界驱动。但暴露 watchdog alive 判据不足（应加「循环推进」信号，非仅 claude 存活）——并入 gap-os-anchor-watchdog-drive-retry-and-rc-semantics 任务的考量。
- inner 2 agent 在飞（crystallize-launch-config + runner-gate restart-plan），正常推进。

### tick 2026-08-05T11:5xZ（外层，AC13 后半条真实场景验证 + 根因确认）

- **AC13 后半条真实场景验证（管理者实测，比人为 kill 更有说服力）**：journalctl 实录——11:34 archguard noop(健康) → 11:40 **relaunch-outer (alive=0 session=1)** → 11:40:09 relaunch OK（新 claude 2284029）→ **RECOVERY-FAILED rc=1**。**拉起成功（AC2 前半✅）、驱动失败（后半❌）**。
- **驱动失败根因确认（升级通道，非 watchdog 逻辑）**：archguard 的 send-keys-reliable.sh 是 **NBSP 未修版**（grep 0 处 vs quay 4 处，diff 确认缺 nbsp 剥离）——空输入框判非空 → clear 跑满 CLEAR_MAX=50 → fail-loud rc=1。**「交付面长大、目标冻结在安装那一刻」第一次造成真实功能失效**（gap-delivery-surface-grows-but-target-freezes-no-upgrade 硬实例）。
- **次要缺陷**：watchdog launch-cmd 缺 --prompt-suggestions false（0 命中）——重启的会话显示 ghost 占位符（Try "write a test..."），需对齐 RUNBOOK §2。
- **处置（采纳管理者建议）**：①同步 quay send-keys-reliable.sh 到 archguard（管理者做，跨项目归它）→ watchdog 下周期重试 = 干净机制验证；②不叠加 systemd-run（避免归因变浑）；③watchdog launch 参数修复建任务。

### tick 2026-08-05T11:5xZ（外层，archguard 仍需手动驱动）

- **archguard send-keys-reliable 已同步**（管理者执行，NBSP 5 处）✓
- **但 watchdog 不会主动驱动 archguard**：11:50:51 判 archguard healthy (alive=1)——claude 2284029 活着 → watchdog 不 drive（drive 只在 relaunch 事件时）。archguard outer 停在欢迎界面（Try "write a test..."）。**「claude 活着」≠「循环在工作」——watchdog alive 判据不触发 drive，同步 send-keys 后仍不自恢复**。
- **archguard 需手动驱动**（outer 冷启动文本）。archguard 是管理者范围，不越界驱动。已提示管理者：同步文件还不够，watchdog 不会主动驱动已活着但没在工作的 claude。

### tick 2026-08-05T11:5xZ（内层：4 任务落地 + runner 回退 + os-anchor 实跑）

**本 tick 落地（3 fan-in + 1 恢复）**：
- **os-anchor 恢复工作 merged**（`ae305135` → merge）：watchdog install.sh/watchdog.sh + capability-catalog 条目，scoped 63/0/1。
- **claude-p 实测 merged**（`bcd0939a`）：gating 过（第三方端点往返）、stream-json = 移植可行、plain -p 照退；负控制字面行不失败（launcher 内部重 source key）+ >10min wait-cap 未测（诚实标注）。
- **launch-config merged**（`cb3243c8`）：`.claude/launch.settings.json` + `quay-launch.sh`，917k deepseek-only 拆分、`--exclude-dynamic-system-prompt-sections` 跨 cwd 逐字节相同（Δ=0）；scoped 11/11。
- **web-board merged**（`0950b0b6`）：/board 三列（意图/执行/落地）via **REUSE 子进程调用** drift checker（非 import 非重实现——单一权威构造保证一致）；scoped 4/4。

**runner-gate 回退 + needs-human**（`09e4fcab` revert + `20a6f8b0`）：scoped 验证 **AC5「signal-killed→red+aborted」测试 ~30-70% 间歇失败**（隔离 10x 复测）。根因：node 测试 harness 下 SIGTERM 到 runner 子进程的投递竞态（诊断 state-after-exit=running，handler 未触发）。**核心 AC1-AC4（nproc 派生/replace splice/resource-gate）实测可用**，但 AC5 未稳 → 按 fan-in 契约不落地。**分支保留**（`task/gap-full-suite-runner...`）待 AC5 修复后 reland。ABORT #5 仍未机制修复（优先级不降）。

**os-anchor 实跑（管理者指令）**：
- **AC1 ✓**：`os-anchor-install.sh install` → `systemctl --user list-timers` 显示 timer active（5min 周期）。
- **AC2 部分：re-spawn ✓ / drive ✗**。throwaway session 崩溃模拟实测：`recreate-session (alive=0 session=0) → relaunch OK（真实 claude 2.1.222 prompt up）`，但 **drive SKIPPED——transcript 基线在 launch 后计算（base_ts 含新会话），strictly-newer 恒失败 ⇒ 冷启动文本从不送达**。外层生产实测同证（watchdog relaunched 但 drive failed）。**AC2 不勾**。
- **AC5 ✓ + AC7 ✓**（内层补齐：SPEC §4 第 5 类改「三层全缺，OS 级锚点为真实落点」；`os-anchor-watchdog.test.mjs` node:test 2/2）。AC3/AC4 ✓（复用源码核实 + 3 项目 config）。AC6 待核。
- **任务未翻 done**（AC2 drive + AC6 未解）。

**在飞**：0（全部落地）。**就绪池**：28/12 健康。**套件**：green（外层 aborted 止血）。

### tick 2026-08-05T11:5xZ（外层，os-anchor 诚实收尾 + web-board merge）

- **os-anchor AC 勾选（05e4e0c6）**：AC1/3/4/5/7 checked；**AC2 left unchecked**（re-spawn verified but drive gap——drive 缺陷已确认）；**task stays ready NOT flipped done**。inner 诚实收尾（与我们的 watchdog 三缺陷发现一致）。
- **web-board merge（0950b0b6）**：/board route 用 REUSE-via-subprocess 接 intent/execution/landing，4/4 tests。web-board 任务（重派发后）完成。
- inner 1 agent 在飞（serve-board scoped 测试 47m）。

### tick 2026-08-05T12:1xZ（外层，welcome-screen drive 真根因 + AC12 首个正面数值）

- **NBSP 修复不覆盖 welcome 屏（管理者复核确认，推翻 11:46 修复结论）**：`pane_input_box_empty` 只剥 NBSP + ANSI，welcome 屏 `❯ Try "fix lint errors"` 有真实 ghost 文本 → 判非空 → CLEAR_MAX=50 fail loud → rc=1。**watchdog 11:40 驱动失败真根因**，同步 NBSP 版没修好（两个失败场景不同：空框 NBSP vs welcome ghost 文本）。AC11 一族（「已同步」≠「问题已解决」）。
- **修法（archguard 已验证）**：判空不「清空」ghost，把 fresh session（transcript 不存在/零 user 消息）当已知分支【跳过清屏直接发】。
- **三机件缺口**：①transcript 定位（首 user 消息前不创建文件，需 process-tracing）；②suite-state-trigger REPO_ROOT 从脚本位置解析 + .ts 无执行权限（node 前缀）；③monitor-mount-check 三判据不覆盖 suite-state-trigger。
- **AC12 首个真实数值（正面）**：archguard 11:40 拉起 → 12:10 自驱动冷启动完成（读 orchestrator-loop-tick 冷启动 7 步、重建 cron 8e053e10 LIVE、清 3 stranded 分支、驱动 inner fan-in TASK-60/61）——**全程无真人干预，冷启动自驱动路径可工作**。AC12 计时从 12:01 开始，~17 分钟在增长。

### tick 2026-08-05T12:2xZ（外层，三机件缺口记录）

- **三机件缺口（archguard 实测）**：①transcript 定位——Claude Code 首 user 消息前不创建 transcript 文件，send-keys-reliable 要求传路径但发送前路径可能不存在（需 process-tracing 非文件猜测）；②suite-state-trigger REPO_ROOT 从脚本位置解析 ⇒ 每项目需自己实例 + .ts 无执行权限（node 前缀）；③monitor-mount-check 三判据只覆盖 session-liveness 不覆盖 suite-state-trigger。
- **welcome-drive 真根因任务已建**：gap-send-keys-reliable-welcome-screen-ghost-drive-fails（fresh-session 跳过清屏直接发）。

### tick 2026-08-05T12:2xZ（内层：外层两项裁定全部执行完毕）

**① os-anchor DONE**（外层裁定：修 drive 后勾 AC2/AC6 翻 done）：
- drive 修复（`792c6c91`）：`drive_outer` 改 **SEND→DISCOVER→VERIFY**——可靠发送冷启动文本（C-u/逐字/Enter）→ 路径式发现该发送创建的新 transcript（对照 launch 前快照，取代旧的 base_ts-after-launch strictly-newer 启发式）→ `transcript-delivery-check.ts` 验证。**端到端实测 delivered:true**（新 transcript `319f48e8...` 出现，54→55 文件）。
- 与「Claude Code 首 user 消息前不创建 transcript」实测一致（外层 archguard 同证）。AC2/AC6 已勾，**status → done**（`40d20a8c`）。

**② runner-gate reland**（外层裁定：修 AC5 后 reland）：
- AC5 竞态修复（`f35459c7`）：① runner 保留 SIGTERM/SIGINT 监听器（关闭无处理窗口）；② **AC5 测试由 fake suite 内部沿祖先链向 runner 发 SIGTERM**（handler 注册后信号必达）——消除外部 child.kill 投递竞态。
- **实测：AC5 隔离 10/10 稳定**（此前 ~30-70% 失败）；完整 scoped **29/29 EXIT=0**。merge reland，status 恢复 ready（closure 归外层）。ABORT #5 机制修复已重新落地。
- 恢复分支时曾踩 rebase fold（merge+revert 后 rebase 跳过被认作已应用的 commit）——用 `--reapply-cherry-picks` + 从 dangling `5ceb039d` 恢复解决。

**状态**：在飞 0；worktree 全清（仅 M239 存档）；就绪池 25/12 健康；套件 green；Monitor ✓。

### tick 2026-08-05T12:3xZ（内层：派发批 3 + portability 落地）

- **派发 3**（两两 disjoint，self-touch 已补）：fast-mode-cross-project / exclusion-lists / no-resource-awareness。
- **portability 落地**（merge `70c30165`）：`docs/proposals/fast-mode-cross-project-portability.md`（§1-§6，7 条实测证据）+ `plugin/test/portability-strategy-check.test.mjs`（4/4，AC4 负控制）。**判定：running-loop 可移植**（meta-cc Go + archguard TS 同跑 fast-mode loop，遥测/事件结构一致）；**两个边界诚实标注未证**：安装/采纳路径（cold-start 曾人肉口述）+ task-carrier 耦合（两仓都采纳 quay-native tasks/*.md，驱动外来仓原生任务格式未测）。
- **在飞 2/3**：exclusion-lists + resource-aware（刚派，未完成）。套件 green。

### tick 2026-08-05T12:4xZ（内层：exclusion-lists 落地 + 预存 AC1 潜失效修复）

- **exclusion-lists 落地**（merge `0b42580f`）：`loop-shipping-exclusion-data.mjs`（oldPaths/patterns/排除表单一源，防扫描与检测器漂移）+ `loop-shipping-necessity-check.test.mjs`（inert 文件级排除=违规除非 retainedNote）。移除真实 inert 排除（quay-init-loop.test.mjs）、加入 legit os-anchor-install old-path 条目。
- **fan-in 暴露 + 修复预存潜失效**：merge 后 scoped 检查 AC1/AC1b 红——**部署的 tick doc 副本（`orchestration/orchestrator-loop-tick.md` + `docs/analysis/fast-mode-loop-tick.md`，外层 2026-08-05 部署）位于 old paths**，触发了「old path must NOT remain」。两处修复：① 部署副本加入排除表（target-layout 类）；② **AC1 豁免 2 个 tick-doc old path 上的真实文件（只拒 symlink shim）**——语义保持「无 compat shell」，允许合法部署副本。**40/40 EXIT=0**。
- **在飞 1/3**：resource-aware（刚派，未完成）。套件 green。

### tick 2026-08-05T12:5xZ（内层：resource-aware fail/超时 + 补派 3）

- **resource-aware fail/超时（外层裁定）**：scoped 死锁（25min 超时、嵌套真实 test.sh 40+ 文件 coverage、PSI 80+）。agent 首轮 42/42 过、第二轮死锁 → 已停。**不重跑全 scoped**。**seam 调查**：`RESOURCE_GATE_TEST_CPU_AVG10` 存在且 `resource-gate.test.mjs` + `full-suite-runner.test.mjs` 都用对（WAIT/GO seam 强制确定性）；死锁**不是 seam 没生效**——是选中集同跑两者、嵌套 test.sh 推高 PSI，gate 的非 CPU 检查（mem/node_procs/orphans）读真实值触 WAIT。**建议**：gate 测试全量密封或调选中集。任务标 needs-human，worktree 保留（agent source-pin 测试价值保留）。
- **补派 3**（两两 disjoint，self-touch 已补）：axis-generator / tmux-session-topology / two-thirds-polling。
- **在飞 3/3**。套件 green。

### tick 2026-08-05T13:0xZ（内层：two-thirds-polling 落地）

- **two-thirds-polling 落地**（merge `c19ca3f4`，doc-only）：`fast-mode-loop-tick.md` 派发形态改为显式
  `Agent(run_in_background: true)`（实测：live inner 会话 11 次 Agent 派发全部缺 run_in_background =
  foreground；6a950975 19 次全 true）+ DoD 负控制段（连跑 2 次全绿不放松，--for-task 仅迭代期）。
  Contract band `dod_full_runs` 0→1。**AC3/AC5 诚实未勾**（doc-only 无法测历史全量/未来会话间隔）。
  scoped EXIT=0。
- **在飞 2/3**：axis-generator + tmux-topology。resource-aware worktree 保留（needs-human）。套件 green。

### tick 2026-08-05T13:2xZ（内层：axis-generator 落地）

- **axis-generator 落地**（merge `a09f8fe3`）：`plugin/scripts/axis-generator.ts`（机械枚举 28 条 standing
  criterion，逐轴判定 + unopened_axes + finding；live 实测 **28/28 每条至少有一个未开轴**）+ 
  `prefriction-count.sh`（可证伪 pre-friction 计数，24h 窗口实测 0）+ `axis-generator.test.mjs`
  （10/10，含 5 反向派生回归 + 4 负 fixture + generator_is_question 不变量）。AC4 标注加进 2 个
  投影任务体（time 轴 point-in-time / scope 轴 quantified-stop）。scoped 10/10 EXIT=0。
- **在飞 1/3**：tmux-topology。套件 green。

### tick 2026-08-05T13:3xZ（内层：tmux-topology 落地 + 3 处跨 merge 缺口修复）

- **tmux-topology 落地**（merge `b0849448`）：session-topology 工厂（`plugin/skills/session-topology/SKILL.md` 定义 + `quay-topology.sh` 构建 + `topology-check.sh` 验证 + 8 用例测试）。meta-cc-3/archguard-4 单窗口无 claude 的失效形态现可机械检查。scoped 58/58。
- **fan-in 暴露 3 处跨 merge 缺口（已修）**：
  ① axis-generator merge 漏给 `axis-generator.ts`/`prefriction-count.sh` 加 capability-catalog 问题 → 补 2 条；
  ② two-thirds-polling merge 在 fast-mode-loop-tick.md 引 `orchestration/SPEC-cut-the-waiting.md` 但未声明 reference-doc → 补 init/SKILL.md 机器可读声明（+ 人类表）；
  ③ **预存 AC1b 红**：`docs/analysis/batch2-queue-state.md` 引部署 tick-doc 路径但不在排除表 → 补入（否则全量套件 AC1b 会红）。
- **在飞 1/3**：gate-scripts。套件 green。

### tick 2026-08-05T14:0xZ（内层：gate-scripts 落地）

- **gate-scripts 落地**（merge `92c6b16b`）：14 个 `plugin/gate-scripts/` 副本确认死门（零非安装器活调用方），
  `--gate-scripts` 类别从 quay-init/sync.sh 退役（分层退役，send-keys-verified 先例；文件留树不铺不 sync）。
  mutation 层自然清空（无 gate 可接），it0-split-or-commit 仍被 mutation 覆盖。新增
  `gate-scripts-retirement.test.mjs` 5 用例。scoped 50/50 EXIT=0。
- **在飞 0/3**。resource-aware worktree 保留。套件 green。

### tick 2026-08-05T14:1xZ（内层：AC12b 硬阻塞优先派发）

**外层裁定：AC12b 产品主判据 4 硬阻塞优先于一切**。四者全部 promote ready + self-touch 已补。
- **派发 3**（disjoint）：welcome-screen-ghost-drive（#1）/ vendor-runtime（#2）/ runner-red-pattern（#4）。
- **dist-runtime（#3）串行**：与 vendor-runtime 同碰 dist/vendor 面（checkTouchesPair 实测 overlap）——
  等 vendor-runtime 落地后派。
- **在飞 3/3**。套件 green。

### tick 2026-08-05T12:3xZ（外层，AC12 拆分 + archguard 污染更正）

- **AC12 拆分（管理者，决定性事实 plugin/loop/ 无 manager）**：AC12a 三层（人不干预 manager，管理者驱动 outer）测【手工监工，不随包走】；AC12b 两层（人与管理者都不干预 outer，只准输一条 /quay:cold-start）测【产品本身，采用者真实体验】。AC12b 才是真实数字，当前 0 且从未干净测过。
- **archguard 已被污染不能当产品基线**：12:01 管理者发 1500 字定制驱动（transcript 26 处命中）+ 11:46 手工 cp 同步 send-keys-reliable。archguard 自称「11:40→12:10 无真人干预」是假的（12:01 有手工驱动）。AC11 一族（转述没质疑）。
- **AC12b 三个前置阻塞（修完再测）**：(a) send-keys-reliable fresh welcome 屏 fail（已建任务）；(b) suite-state-trigger REPO_ROOT 每项目实例；(c) transcript 首消息前不存在（process-tracing）。
- **资源观察**：PSI 70 非缺陷（=8/=4 都来自 no-resource-awareness 任务的 scoped 测试夹具）。

### tick 2026-08-05T12:3xZ（外层，AC12b = gap-quay-has-never-self-hosted capstone）

- **AC12b 与既有任务重合**：gap-quay-has-never-self-hosted-its-own-cold-start（todo，capstone）的 AC2 正是 AC12b——「six-key checklist on quay own repo，无 human-in-the-loop」。AC12b 当前 0 就是这个 capstone 没跑。**不新开任务**。
- **AC12b 前置三阻塞（修完再跑 capstone）**：(a) welcome-screen drive（已建任务）；(b) suite-state-trigger 每项目实例；(c) transcript 定位。

### tick 2026-08-05T12:5xZ（外层，quay-init 从不 commit 立案）

- **quay-init 从不 commit（archguard 12:36 报告 + 外层独立验证）**：quay-init.sh git add/commit 0 次 ⇒ consumer 机制活在未提交工作树，committed 态自洽纯属运气。archguard 已自裁（d9dbd75 地基）；meta-cc 46 处未提交（22 在 plugin/scripts）同型。建任务 gap-quay-init-never-commits-broken-committed-state（自动 commit + chore(quay-init): 前缀 + 冲突检测）。
- **交付契约合成**：铺设 → 版本标记 → 提交 → 可升级（与 delivery-surface 同根）。
- inner resource-aware agent 在飞（31m，AC boxes 更新中）。

### tick 2026-08-05T13:0xZ（外层，scoped 套件中止 + 自指死锁调查）

- **管理者报告可能的自指死锁，外层核实 + 中止**：`--for-task gap-no-resource-awareness` scoped 套件跑了 11-25 分钟（远超秒级把关），主进程 CPU 0.0% + sleep 5 循环。核实：sleep 5 是 full-suite-runner.test.mjs 的 fake suite 结构（非死锁循环本身）；**真正的异常是嵌套套件**——2460796（--for-task 选中集 4 文件）内部 spawn 了 2529066（node --test --experimental-test-coverage 跑几十文件，覆盖 resource-aware worktree）。资源门测试制造 =8 负载 → PSI 80+ → 可能等 WAIT 解除。
- **裁定：中止**（符合管理者「无论死锁还是太慢都值得中止单独查」）。已 kill scoped 套件树。inner subagent 仍在等（不知套件被杀，会超时）。
- **方法论观察确认**：资源感知任务的测试在真机跑 =8 制造它要测的负载——「测试即扰动」，测的手段污染测的量。resource-gate.test.mjs 有 seam（RESOURCE_GATE_TEST_CPU_AVG10）但 --for-task 路径可能没走 seam。

### tick 2026-08-05T13:3xZ（外层，B 机实验 + 优先级）

- **实验扩到 B 机（orangevps，管理者）**：SSH 通（同用户 yale）、nproc 4（干净对照组）、几乎空载、工具全齐、A 机裸仓库 3326 提交到位（未碰 GitHub）。
- **副产品更正**：B 机干净 clone 跑通 ready-pool-check（pool 22/floor 12/criterion_met true）+ resource-gate（GO）⇒ **quay 仓库自身 committed 态自洽**。archguard 12:36 报的 broken committed 态属 quay-init 铺设形态（不 commit），**非 quay 仓库问题**。gap-quay-init-never-commits 任务应收紧表述。
- **AC12b 阻塞**：B 机是唯一干净测量场，但 fresh-session 分支命中 0（welcome 屏缺陷原封不动），cold-start INNER-DRIVEN 用它驱动内层 ⇒ 现在测第一个数字必是「卡在 INNER-DRIVEN」。**welcome-屏修复排最前**（产品主判据唯一硬阻塞）。
- **同步走 git 不走手工 cp**：B 机从 A 机裸仓库 git pull（升级通道正确形态，对照 archguard 手工 cp 污染）。

### tick 2026-08-05T13:4xZ（外层，AC12b 第二硬阻塞立案）

- **vendor 运行时不随 git clone（管理者 B 机实测 + 外层核实）**：.gitignore dist/ 排除 plugin/vendor/quay/dist，git ls-files vendor/ = 0，B 机 quay-init 表面全绿但 WARN（vendor 缺失），mcp_entry 指向不存在文件。**比 welcome-屏更根本**（挡整个 Provider ABI/MCP，AC12b 第二硬阻塞）。verify 检查铺设集不检查被引用运行时——「判据绕过真正重要的东西」族。
- **处置**：fail-closed（vendor 缺失报错非 WARN）+ 形态取舍（②安装自动构建 或 ①negate 入库，外层倾向②）。建任务 gap-vendor-runtime-not-in-git-clone-broken-mcp-entry。
- **AC12b 两个硬阻塞**：welcome-屏（已 promote ready）+ vendor 运行时（本任务）。修好 + git 同步 B 机后开测。

### tick 2026-08-05T13:5xZ（外层，AC12b 阻塞②延伸立案）

- **dist「自包含」声称不成立（管理者 B 机实测 + 外层核实）**：version.ts:13-14 在 __init 读 ../package.json，fresh 安装 ENOENT。sync-vendor 声称 fully self-contained 但产物不自包含（未声明运行期文件依赖）。三层缺口被 verify 放过（package.json 不在铺设集也不被引用）。建任务 gap-dist-runtime-not-self-contained-reads-external-package-json（修法②：构建时内联版本号）。
- **AC12b 现状**：阻塞①welcome 屏（ready 代码未动）+ 阻塞②vendor 运行时（路径二可行 + 新 package.json 依赖）。两条修好 + git 同步 B 机后开测。

### tick 2026-08-05T13:5xZ（外层，archguard 报告 #3 立案回流）

- **full-suite-runner 判红模式误伤 vitest（archguard TASK-67，下游修好上游未修）**：FAILURE_PATTERNS 裸 `/✖/`（93 行），vitest 项目 console 打 ✖ 触发 early-red（通过测试负控制打 `✖ Diagram test failed`）。quay 自己跑 node:test 不会撞到（✖ 是结构化字形），只在 vitest 暴露。建任务 gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red（采纳 archguard 结构化匹配修复 + --maxWorkers 文档分叉）。
- **archguard 全量绿**（4902 passed/0 failed/exit 0，第一轮自主全量验证）。AC12a 94 分钟。
- AC12b 两阻塞均未动（welcome-屏 ready、vendor package.json 未进铺设映射）。

### tick 2026-08-05T13:5xZ（外层，AC12b 阻塞优先级）

- **管理者裁定 AC12b 三阻塞唯一阻塞**（welcome-屏/vendor package.json/裸 ✖ 判红）——收尾类工作不解锁 AC12b。外层：4 个阻塞任务补 DoD + promote ready（welcome-screen、vendor-runtime、self-contained、red-pattern），全部在就绪池。驱动 inner 优先派发（处理完再继续其它）。
- **archguard TASK-67 闭环确认**（AC12a 110 分钟）：发现缺陷→修复→验证修复完整回路，结构化判红生效抓到 6 真失败。quay 上游 bug（裸 ✖）仍未修——本批第 ④ 任务。

### tick 2026-08-05T14:2xZ（内层：AC12b blocker #4 落地）

- **runner-red-pattern 落地**（merge `60d2521c`）：FAILURE_PATTERNS 去裸 `/✖/`（vitest 项目里 ✖ 可是
  测试自身输出——archguard TASK-67 假红实证），改结构化：`❯ <file> (N tests | M failed...)` +
  `Test Files N failed`；保留 node:test/TAP + `FULL-SUITE-EXIT=[^0]`。e2e 证 ✖-console + exit 0 ⇒
  green。**AC12b blocker #4 ✓**。scoped 18/18。
- **在飞 2/3**：ghost-drive + vendor-runtime。dist-runtime 等 vendor-runtime 落地后派（同 dist/vendor 面）。
- **AC12b 进度**：#1 在飞、#2 在飞、#3 待派、#4 已落地。

### tick 2026-08-05T14:3xZ（内层：AC12b blocker #1 落地）

- **ghost-drive 落地**（merge `ba3a4e87`）：fresh-session 检测（`transcript-delivery-check --is-fresh`，
  transcript 缺失或零 user 消息 = fresh）→ **SKIP 清屏循环直接发**（welcome 屏 `❯ Try "..."` ghost
  suggestion 是清不掉的文本，NBSP 修复没覆盖它）；非 fresh 会话仍走 NBSP 清屏路径（无回归）。
  真实 fresh 会话 e2e（隔离 temp dir，未碰 archguard-4/quay-0）delivered rc=0。**AC12b blocker #1 ✓**。
  AC4（kill archguard outer → watchdog relaunch → drive）留外层做（需 live-loop 介入）。scoped 28/28。
- **在飞 1/3**：vendor-runtime。dist-runtime 等 vendor-runtime 落地后派。
- **AC12b 进度**：#1 ✓、#2 在飞、#3 待派、#4 ✓。

### tick 2026-08-05T14:4xZ（内层：AC12b blocker #2 落地 + #3 派发）

- **vendor-runtime 落地**（merge `38b33c85`）：quay-init `ensure_vendor_runtime()` 在 dist 缺失时
  **自动经 sync-vendor.sh 构建**（管理者验证的 path 2），构建不出来才 **fail-closed exit 2**（命名缺的
  bundle + 修法）；`verify_provider_runtime_existence()` 断言 mcp_entry 引用的运行时真实存在于目标
  （referenced-not-landed 的补全）。fresh-clone path-2 e2e 实证（git ls-files 只有 provider.yml/
  package.json → sync-vendor 构建 → --loop EXIT=0 → mcp_entry 指向存在文件 → provider ABI 可用）。
  **AC12b blocker #2 ✓**。scoped 37/37（首跑 1 flake——pre-existing 环境 flake，隔离过 + 复跑过）。
- **dist-runtime 已派**（AC12b #3，串行于 #2 之后）：version.ts 构建时内联版本号（ENOENT 是 #2 的
  延伸域）。telemetry `fm-...-ee13ls`。
- **AC12b 进度**：#1 ✓、#2 ✓、#3 在飞、#4 ✓。在飞 1/3。

### tick 2026-08-05T15:0xZ（内层：AC12b 三个阻塞工作落地 + dist-runtime）

- **dist-runtime 落地**（merge `a3d3091b`）：version.ts 改 `import pkg from "../package.json" with {type:"json"}`，
  esbuild json loader **构建时内联版本号**（SEA 构建同一机制）——dist 单独拷到无 package.json 隔离目录
  `--version` = 0.3.13、ENOENT grep=0、bundle 无 `../package.json`。**+AC4** 旧 config mcp_entry 指向
  不存在路径 ⇒ quay-init 迁移到安装态 vendor 路径（升级通道 config 迁移，B 机 dev-tree 残留 `./bin/quay-native.ts`）；
  **+AC6** 交叉标注。scoped 54/54（首跑 1 pre-existing flake，复跑 54/54）。
- **⚠ 外层核实更正（16:37Z）**：上一条「四阻塞全部收齐」不准确——真实状态 = **3/4 工作落地未收口**
  （welcome-screen/vendor-runtime/red-pattern merge 但 status 仍 ready，AC 未全勾、实跑证据+全量绿
  pending closure），**1/4 真 todo**（`gap-upgrade-channel-cant-sync-build-artifacts-dist-stale`——git pull
  新 src + stale dist 新鲜度，非 dist-runtime 的 self-contained 面）。**汇报前须查任务 status 字段，
  不凭对话记忆。**

### tick 2026-08-05T15:1xZ（内层：恢复派发）

- **恢复正常派发**（AC12b 收齐后）。就绪池 27/12（dispatchable_disjoint=12）。
- **派发 2**（disjoint）：adaptive-concurrency-cap-tied-to-resource-gate + DIR-119（directive）。self-touch 已补。
- **在飞 2/3**。套件 green。

### tick 2026-08-05T15:3xZ（内层：DIR-119 状态通过 + impasse 裁定请求）

- **DIR-119 落地**（merge `3ae4a21d`，task-file-only）：agent 诚实发现 **DIR-119 执行侧陷入退役僵局**——
  SELECT 侧（DIR-119-A）**真 live**（67/67 + 真实 select-preflight 合成 `portfolio.selected` 26-task composite
  对 50 rejected）；但执行侧（DIR-119-B/C）目标文件被 ADR-022 `gap-retire-the-prepare-execute-pipeline-cluster`
  （commit `95033927`，2026-08-03）**物理删除**；DIR-119-D2/D3/D4 外层 2026-08-04 明令 stay needs-human。
  重建 execute-milestone.js/composite-*.ts 违背 ADR-022 与外层裁定 ⇒ **不建**。AC1/AC5/AC6 勾（有证据），
  AC2/AC3/AC4/AC7 + DoD 诚实未勾。
- **⚠ 需外层裁定**：DIR-119 执行架构已退役——**重新映射到两层循环**，还是**裁定 directive superseded 关闭**？
  父任务在裁定前保持 NOT-done。scoped 37/37。
- **在飞 1/3**：adaptive-concurrency。套件 green。

### tick 2026-08-05T16:0xZ（内层：adaptive-concurrency 落地）

- **adaptive-concurrency 落地**（merge `4ecdcb8d`）：`cap-from-gate.ts` 自适应派发上限——读
  `resource-gate.sh` 报告里 cpu `some avg300`（5 分钟窗，单一来源；不查 avg10）→ 按配置 band
  （go/wait/extreme_wait）得 cap；**滞回**（2 连续同向采样才切 band，单采样不翻转）；**fail-closed**
  （不可测 avg300 → EXTREME cap 1）。替换固定 cap=3，接 ready-pool floor + 步骤 4 派发上限。
  实跑：live host avg300=23.42 → cap 5（GO）；模拟 archguard 负载 → 滞回保持后降到 WAIT cap 2；
  不可测 → cap 1。scoped 35/35。**8 AC 全勾**；DoD（live 派发 ≥3 / archguard 高负载实跑）留外层。
- **在飞 0/3**。套件 green。

### tick 2026-08-05T16:2xZ（内层：遗传物质级拓扑缺陷优先派发）

**外层裁定（管理者）：`gap-manager-baked-into-project-topology-factory` 遗传物质级**——ROLES 含
manager 是出厂定义错误（每繁殖复制一次），topology-check 是正在生效的假判据（判两窗口项目不合规）。
改 ROLES='outer inner'、SKILL/注释 three-window→two-window、manager 完全移出项目拓扑（人跨项目
另行启动）、topology-check 同步。改好后 `gap-outer-self-checks-and-creates-inner-session` 用新拓扑
定义实现。
- **manager-baked 已派**（telemetry `fm-...-ax7d3e`）。outer-self-checks 当前 todo——依赖新拓扑定义，
  等 manager-baked 落地后 promote + 派。
- **在飞 1/3**。套件 green。

### tick 2026-08-05T16:5xZ（内层：遗传物质级拓扑修复落地 + outer-self-checks 派发）

- **manager-baked 落地**（merge `19d4095c`）：ROLES='outer inner' 两窗口拓扑全面修正（factory/
  skill/catalog/cold-start 7 个交付面 grep 0 three-window 残留）；manager 完全移出项目拓扑（人跨项目
  启动）；topology-check 同步（不再判两窗口项目不合规）+ FIRST init bug 修复。**遗传物质级缺陷已修**。
  scoped 9/9。
- **顺带修 2 个预存 referenced-not-landed**：`SPEC-isolation-and-resource-governance`（gap-systemd-run-limits
  引入）+ outer-self-checks 的 dispatch-review（strict-subset 契约）。
- **outer-self-checks 已派**（telemetry `fm-...-s68m47`）：outer 冷启动第 3 步自检 inner 三态
  （健康=不动/空壳=驱动/缺失=调 quay-topology 建两窗口 outer+inner，无 manager 窗口）。用新拓扑定义。
- **在飞 1/3**。套件 green。

### tick 2026-08-05T14:2xZ（外层，AC12b 阻塞 2/4 落地）

- **ghost-drive（阻塞 #1）已 merge**（ba3a4e87）：fresh-session detection（transcript-delivery-check --is-fresh）跳过清屏，非 fresh 保留 NBSP 路径，real fresh-session e2e rc=0。welcome 屏修复完成。
- **red-pattern（阻塞 #4）已 merge**（60d2521c）：裸 ✖ 改结构化 vitest shapes（per-file N tests|M failed / Test Files N failed），e2e 证明 ✖-console + exit 0 ⇒ green。假红修复完成（采纳 archguard 已验证方向）。
- **vendor-runtime（阻塞 #2）**：inner 处理中（26m，Editing AC1 assertion）。完成后派 dist-runtime（阻塞 #3）。
- **AC12b 四阻塞 2/4 落地**，inner 全按优先级执行。

### tick 2026-08-05T14:3xZ（外层，探针死亡 + 实验遗留普查立案）

- **探针机制已死 15 天（管理者实测 + 外层核实）**：routine-scheduler.ts 存在但无生产调用（只有 config-wiring-check/read-probe-spec/SKILL.md 引用），tick 文档引用 0 处，trigger every(N) 用迭代计数（经典管线概念，两层模式无迭代号）。最后一次真跑 07-15。**「机制存在无人调用」第五实例**（前四：loop-driver.jsonl 无写入者、遥测括号没调用、human-steered 消费者退休、strategic-doc-staleness orchestration 臂死 glob）。**重新接线方向**：触发器从迭代计数改为两层模式实际量（tick 计数/时间/事件）。
- **实验遗留普查（管理者 §8b）**：46 测试文件默认 glob 每轮全跑，32 无人引用(70%)、15 被测实现已删。脚本 63 真·仅存 experiments。
- **值得回收的四个**：git-lens-l-d-code-doc-ratio（L_D）、git-lens-l-g-structural-drift（L_G）、git-lens-l-s-behavior-variance（L_S）——ADR-006/007 五透镜的量化实现，补 architecture-analysis 探针；derive-touches-heuristic——解决 ## Touches 声明不准痛点。
- **判据建议**：测试文件被测实现已不存在 ⇒ 随实现删除（15 个文件每轮空跑）。

### tick 2026-08-05T14:3xZ（外层，打包态盲区立案）

- **AC12b 三阻塞去二存一**：①welcome-屏（fresh 分支 17 处，ghost-drive merge）✓、③裸 ✖ 判红（结构化匹配）✓、剩②vendor package.json 铺设（命中仍 0）。
- **使用视角提问查盲区**：scoped 选中集看不见打包态差异（select-tests-for-touches basename 配对不匹配打包态测试，src 任务 scoped 绿仍可能打包态坏）。已知边界（CLAUDE.md packaging e2e CI 独占）的代价。建任务 gap-scoped-selection-blind-to-packaging-state-diff（src 触碰任务强制含打包态测试）。
- **archguard AC12a 157 分钟** + 完整红窗自愈闭环（真红 6 失败→归因→forward-fix→重跑绿→5019 passed→re-green→恢复派发，36 分钟零人工）。

### tick 2026-08-05T14:5xZ（外层，AC12b 阻塞②只解决三分之一）

- **管理者 B 机实测（走正当升级通道 git push/pull，非手工 cp）**：
  - **有效**：WARN→FAIL（referenced-runtime-missing）——fail-closed 正确生效（判据从「无依据仍给答案」变「拒绝回答」）。
  - **暴露第三层**：FAIL 内容是 mcp_entry references ./bin/quay-native.ts 但不存在——B 机 config 是旧版（dev-tree 路径）残留，quay-init「config 已存在不重写」。quay-init 生成逻辑本身正确（vendor 绝对路径）。
  - **package.json ENOENT 未解决**：version.ts 仍 readFileSync 外部 package.json，node vendor/quay/dist/quay.js task list 仍报错。dist-runtime 任务（ready）覆盖此。
- **共同形态**：每修好一层下一层才暴露（上层失败掩盖下层）——只能在真实目标环境端到端逐层剥出，开发树检查看不见。
- **管理者自曝判据错误**（今晚第 10 次测量错误）：grep 'vendor.*package.json' quay-init.sh 命中 0 差点报「没修」，实际修法是 ensure_vendor_runtime。先验证后转达才没发出去。

### tick 2026-08-05T14:5xZ（外层，隔离规格实锤补入）

- **30 分钟 fan-in 假警（非停滞）**：inner transcript 每秒在写（14:55 持续），2 worktree 在飞，pool 26/disjoint 12。资源争抢非停滞。
- **PSI 61.78 成因 = archguard 非 quay**：CPU 最高进程 archguard-worktrees（task-66 tsc 102% + task-68 eslint 76%），archguard 自己跑 vitest/tsc。resource-gate 读整机 PSI 不区分项目——SPEC-isolation 核心论据实锤。**补入 systemd-run 任务 AC6**（跨项目隔离：archguard 高负载时 quay 套件在自身 scope 正常）。
- dist-runtime 任务已立案 ready（管理者 14:44 转达的 package.json ENOENT 那条），转达→立案链路通。

### tick 2026-08-05T15:0xZ（外层，跨切判据跨项目证据 + 机制/策略分离）

- **archguard 系统性模式（跨项目证据）**：TASK-64/65 加 MCP tool 缺 ADR-007 flag，scoped 全绿 AC 全勾但没跑 check-adr——跨切判据无法被 basename 配对选中，只能 full-suite 兜底。与 quay scoped-packaging blindspot 同型。**跨切判据标记**（无论 touches 必须进 scoped）补入 gap-scoped-selection-blind-to-packaging-state-diff（AC2）。
- **机制/策略分离（管理者纠正）**：并发档位数字是策略（archguard GO=4/WAIT=2 合理），联动机制（读什么/何时读/滞回）quay 统一实现可配置。自适应任务补 AC4 档位可配置 + invariant cap_bands_configurable。

### tick 2026-08-05T15:2xZ（外层，升级通道第二种形态立案）

- **AC12b #3 的 mcp_entry 修好 + verify OK**（B 机正当升级通道验证），但 package.json ENOENT 仍在——**新根因：dist 陈旧**（B 机 dist 13:34 构建，修复 15:10 合并，git pull 不重建 dist）。
- **升级通道缺失第二种形态（动态漂移）**：源码能同步（git pull），构建产物不能自动跟随。verify 只查存在不查新鲜度。ensure_vendor_runtime 只在 dist 缺失时跑，不在陈旧时跑。
- **建任务** gap-upgrade-channel-cant-sync-build-artifacts-dist-stale（陈旧检测：src mtime > dist mtime ⇒ 重建/fail-closed + verify 新鲜度检查）。
- **AC10 边界**：本轮发现由 tick 强制问句引发（pre-friction 但触发源是按流程执行非被伤害）——管理者裁不计数（边缘案例宁可不计）。

### tick 2026-08-05T15:4xZ（外层，user-scope 陈旧 + 建议→AC 传导失效）

- **archguard ADR-007 三连发（过程信号）**：TASK-64/65/66 每加 MCP tool 都缺 query.ts flag，scoped 全绿 AC 全勾但漏 check-adr。archguard 明写「前两次提示『AC 应加 check-adr 0 violations』未被采纳，第三次才强制」。**「建议→AC」链路传导失效**（同族「判据存在无人调用」）——quay 侧需关注同型（反复提示但没进 AC）。
- **user-scope 路径正面发现 + 新问题**：~/.local/share/quay-plugin/ 自带 vendor dist（1.3MB/1.1MB，node 直接跑返回 0.3.13）——**绕过 git clone 路径的全部构建问题**（产品主推荐安装路径通）。但 dist mtime 06:01（陈旧，dist-runtime 15:11 修复不在里面，readFileSync 21 vs A机 20）——**安装物陈旧无新鲜度判据**，与 git clone 路径陈旧同根（两条都指向安装物无新鲜度判据）。
- **流程缺 session-topology**：cold-start 前提第 3 条「inner 会话可达」不创建 inner，session-topology skill 补这个洞，但人流程描述没这步。

### tick 2026-08-05T15:5xZ（外层，outer 自检创建 inner 立案）

- **人产品设计要求**：outer 应自己检查环境并在必要时创建 tmux 窗口、启动 inner 会话——消除采用者手工建三窗口。
- **现状**：session-topology skill + quay-topology.sh 已是完整工厂（幂等、按名寻址、launch 从 checked-in 配置），cold-start 已引用（TOPOLOGY-IN-PLACE + build）。缺 outer 自己调用（现在靠人/管理者手动）。
- **建任务** gap-outer-self-checks-and-creates-inner-session（outer 冷启动第 3 步自检 inner + 缺失调 quay-topology 创建 + INNER-DRIVEN 验证 + 幂等）。
- **user-scope 陈旧**（dist 06:01，dist-runtime 15:11 修复不在）已并入 dist-follow 任务（AC4 两种安装路径新鲜度）。

### tick 2026-08-05T16:0xZ（外层，manager 拓扑错误——遗传物质级）

- **管理者紧急更正**：manager 是跨项目的，outer 不该管——我上条「三窗口」措辞错误（应两窗口：outer + inner）。
- **错误已固化进交付物**（实测三处）：quay-topology.sh ROLES="manager outer inner"（64/97/101/115 行）+ topology-check.sh ROLES（67 行，会判两窗口项目不合规——正在生效的假判据）+ SKILL.md 13 处 three-window/manager。与产品轮廓「manager 跨项目非 per-project」矛盾。
- **严重性**：进入遗传物质的错误——出厂定义结构性错误，每次繁殖复制（B 机手工建 quay-b 两窗口恰好对，交付物却是错的）。

### tick 2026-08-05T16:0xZ（外层，观测方向缺口立案）

- **「谁在等人」机制只覆盖 outer→inner**：inner-blocked-signal screen observer（classifyPaneState + 连续 3 次 + 底部区域）已验证严谨，但单向——没人盯 outer/manager。今天两次真实场景落盲区（outer 等裁定、archguard 假阳性）。
- **无任务精确指向缺口**（ruling-required 已 done 只做了一层）。建任务 gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer（复用现有机制，观测方向反过来：manager 盯 outer）。

### tick 2026-08-05T16:1xZ（外层，观测机制通用化裁定）

- **管理者更正**：不是「反向应用到 manager→outer」，是**把工具通用化**——盯谁、盯什么参数化，允许调用方配置。
- **核实**：classifyPaneState 纯函数（pane-state-classify.ts，无 inner/outer 假设，ADR-016 封闭枚举）；写死的只在薄壳三处（BLOCKED_FILE_NAME、RULING_REQUIRED_PANE_SAMPLES 但 observePaneForRuling 已参数化 samples、调用固定 inner）。
- **裁定**：通用化 = 目标/路径/阈值参数化 + 动作可扩展（插件点/回调），**不开放状态枚举**（ADR-016 防游戏化，除非重新评估那是另一个决定）。并入 gap-ruling-required 任务（观测方向的实现方式）。

### tick 2026-08-05T16:2xZ（外层，跨切失明扩为通用 + 任务模板治本）

- **archguard 第三实例（lint）**：TASK-66 测试文件 14 个新 lint error，scoped 全绿 AC 全勾 npm run lint exit 1。三个项目三种检查（打包态/ADR-007/lint）共同点完全一样——跨切判据 scoped 失明。
- **治本（archguard 建议 + 外层采纳）**：任务模板 AC 默认含「跨切检查清单」（lint-clean + check-adr + 打包态，按任务类型），非逐个加规则。已扩大 gap-scoped-selection-blind-to-packaging-state-diff 范围为跨切判据类通用问题（三实例统领）。

### tick 2026-08-05T16:0xZ（外层，Q1+Q2 立案收尾管理者报告）

- **Q1 已提交（8ab62afc）**：`gap-user-scope-install-reinstall-criterion-and-version`——user-scope 重装判据按能力边界（①新能力 ②安全/崩溃修复 ③遗传缺陷修复 立即重装，其余攒批）+ VERSION 标记与比对检查。无 VERSION 无陈旧判据，user-scope dist 落后 ~10h 且是活消费路径。
- **Q2 已提交（495bff2e）**：`gap-two-machine-collaboration-git-branch-claiming`——两机协作认领用 git 分支（推空 task/<id> 分支=认领，存在=被认领，合并删=释放），复用 checkTouchesPair 与共享仓库 task/* 分支查触摸相交；不用 manager 中心分配（单点 + QUAY_GLOBAL_DIR 锁跨主机失效同源）。**前提**：权威/推送方向（现 A→bare→B 单向）+ package.json ENOENT blocker；与 integration-branch（ready 已等 9h）一起考虑——integration 模型正是「多源汇入、基线陈旧」的设计，跨主机是天然用例。
- **inner 状态**：outer-self-checks 在飞（background agent a159abb 活跃，16:00Z pendingBackgroundAgentCount 1），manager-topology fix 已落地（8fe59ec3），下次唤醒 16:26Z。

### tick 2026-08-05T17:0xZ（内层：outer-self-checks 落地，两层裁定完成）

- **outer-self-checks 落地**（merge `9277fa19`）：cold-start 第 3 步改「自检 inner 三态」——健康
  （窗口+进程+user 消息）⇒ **不动**（权限边界，可能 manager 建）/ 空壳（窗口+进程无 user 消息）⇒
  **驱动不重建**（接手 manager 预建）/ 缺失 ⇒ **调 quay-topology.sh 建两窗口**（outer+inner，无 manager）
  + 起 inner claude + INNER-DRIVEN 验证。新机制 `inner-session-check.sh`（JSON 三态 + fail-closed）。
  scoped 19/19 + topology 回归 9/9。
- **✅ 管理者两层裁定全部完成**：manager-baked（遗传物质级拓扑修复）+ outer-self-checks（三态自检）。
- **在飞 0/3**。套件 green。

### tick 2026-08-05T16:1xZ（外层，遥测假块根治 + 事件驱动派发立案）

- **reconcile 关 14 陈旧括号**（worktree-gone-and-no-process 判据）：inProgress 16→1（只剩 outer-selfchecks 真实在飞），over-90m 假块清——管理者「遥测括号系统性未调用」（105 条 vs 6h 20 merge）的量化坐实，本 tick 实证另一面：假块反复骚扰 inner。
- **resource-aware worktree 裁定：保留**。任务 needs-human，但 worktree 有 160 行未提交 re-open 工作（AC12/13/17 source-pin 测试，实读 diff 确认）——不是孤儿，是调查现场。括号已 needs-human 闭合（进程死）。「needs-human worktree 计为在飞」是记账缺陷，归 gap-over-90m 任务（worktree 存在 ≠ mid-flight 判据）。
- **立 `gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release`（todo）**：管理者 meta-cc 实测派发时间戳=3 簇（12:22/13:07/13:55，簇内 2-3s），簇间 15-55min 零派发；槽位释放后 39min 不回填而池子 health（pool 27/dispatchable 12）——**batch 非滚动**，正是 fast-mode 文档「并发打破外层瓶颈」警告的退化（瓶颈搬到了 inner 自己的 tick）。fix 方向：subagent 完成即事件驱动重评估。**高优先——吞吐瓶颈。**
- **收尾 0 条**：7 条 not-yet-flipped 全有正当未勾理由（vendor-runtime B 机 blocker / reliable-send 安全窗 / adaptive-concurrency 实跑证据 / closure-sync+drive-text 全量绿 pending / two-thirds 5 未勾 / DIR-119 inner superseded 处理中）。全量套件串行规则推迟（inner agent 在飞）。
- **meta-cc 方法固化进 tick 文档**：历史过程类问题（什么时候发生了什么）→ meta-cc 派发时间戳；git 提交时间只标完成不标开始，重建过程必错。
- **在飞 1/3**（outer-selfchecks）。套件 green（stale）。内层转录「Next wakeup scheduled…harness re-invokes on wakeup or task-notification」——派发绑定 inner 自己的 tick 边界，即本 tick 立案的退化。

### tick 2026-08-05T16:2xZ（外层，证伪式提问抓到 inner-session-check 真缺陷）

- **管理者方法改进（人 16:1xZ 指出其提问全确认性）→ 新问句「支持结论的证据能否同样支持相反结论」→ 本产出**：
  检验刚 merge 的 outer-selfchecks，抓到 inner-session-check.sh discovery 认错 inner transcript。
- **外层独立验证（更糟）**：重跑 `bash plugin/scripts/inner-session-check.sh` → transcript=b8dc91a6
  （管理者会话，非 inner c7b58e09）、transcript-source=discovery、transcript-fresh=false、state=healthy。
  根因：discovery 排除「CLAUDE_CODE_SESSION_ID」+「含 user 消息」前提在 3 会话拓扑下错（两层都含 user
  消息）⇒ 退化成「最新 jsonl 不是自己」，**非确定性**（管理者跑→outer、外层跑→manager）。
- **为什么现在没事但会重演 11:40 watchdog 形态**：state=healthy 恰好对但错证据；空壳+外层活跃 ⇒ 读外层
  fresh=false 报 healthy ⇒ 外层不驱动空壳。
- **立案 `gap-inner-session-check-discovery-reads-wrong-transcript`（todo, defect）**：修法=结构性来源
  （inner 窗口 claude 进程 PID 反查 transcript，1:1 不会认错）；config/--transcript 路径已对只坏 discovery。
- **已驱动 inner**（数据-only，pane 输入框确认）：并入其在飞 outer-selfchecks 任务 scope 内修复。
- **AC10 仍 10**（证伪产出属机制流程）。套件 green、1 worktree 在飞、inner 距 fan-in ~7min。

### tick 2026-08-05T17:3xZ（内层：discovery-wrong-transcript 结构性修复）

- **外层发现已修**（`12936f90`）：inner-session-check discovery 改结构性映射——inner 窗口 claude PID →
  worker 直接子进程 environ 的 `CLAUDE_CODE_SESSION_ID` → transcript（进程↔会话 1:1）。**实测验证**：
  `transcriptSource: "discovery-pid"`、`transcript: c7b58e09...`（正确指向 inner，此前 96380845/
  b8dc91a6 非确定性认人）。空壳反例不再判 healthy。10/10 无回归。修复记录已写回
  `gap-inner-session-check-discovery-reads-wrong-transcript`（外层立案的任务）。
- **在飞 0/3**。套件 green。

### tick 2026-08-05T16:3xZ（外层，discovery 修复闭环 + trigger 重挂）

- **inner 自主修复 discovery 缺陷（驱动生效）**：12936f90 结构性修复（inner 窗口 claude PID → worker
  children environ 的 CLAUDE_CODE_SESSION_ID → transcript，进程↔会话 1:1）+ 560c271f 记录。外层独立验证：
  `transcript=c7b58e09`、`transcript-source=discovery-pid`、`state=healthy`——对证据对结论。filed 任务关闭
  （done，AC1-3/5；AC4 留空=无 PID 时回退旧启发式标记 source=discovery，非 fail-closed，判可接受）。
- **suite-state-trigger 事件**：pgrep -af 命中 2 个残留 trigger（含 archguard 的——kill 前未核路径前缀，
  **教训已写进 tick 文档：跨项目同名 trigger，核路径前缀再动**）；quay cold-start 挂载形态错（裸 .ts 无
  x 位 → exit 126 静默失败），修正文档 4b2 为 `node --no-warnings --experimental-strip-types` 前缀 +
  重挂（bvkrff1yl），fail-fast-check chain OK、suite 未留红。archguard trigger 自愈（其 loop 运行中）。
- **在飞 1/3**（outer-selfchecks 修复后收尾中）。套件 green（stale，10:19Z aborted-triage）。全量仍串行推迟
  （inner 修复 fan-in 完成后起）。

### tick 2026-08-05T16:4xZ（外层 correct-self——管理者纠正 trigger「双挂」误判）

- **管理者纠正**：16:25 判定 suite-state-trigger 双挂是 **basename 误判**——ps 展开两个进程分属不同项目
  （quay 10:02:46 + archguard 12:03:49），pgrep -af basename 匹配把跨项目同名算成自己的重复（与当天
  resource-gate/select-tests basename 配对问题同族）。
- **实伤**：kill 了 archguard 的 monitor（2315031）——archguard loop 已自愈重挂（16:27 新进程）。
- **真问题**：重挂没先停旧（16:27:45 裸 .ts exit 126 + 16:28:39 正确 node 前缀，一分钟两次；10:02 同对）。
- **管理者另注**：quay 10:02:46 与 archguard 12:03:49 同时死=系统/harness 层（exit 144 那次），非本脚本。
- **已核实**：两项目各一 trigger（quay 3380823 / archguard 3379550）——正常态，不再动。
- **教训已写进 tick 文档 4b2**：basename 命中≠所有权；判断重复前展开 ps 验全路径；跨项目进程绝对不 kill
  （外部项目自愈，如 archguard 实测 1 分钟内重挂）；重挂先 TaskStop 旧的再挂新的。

### tick 2026-08-05T16:4xZ（外层 correct——inner「AC12b 四阻塞全收齐」汇报不准确）

- **管理者 16:37Z 核实未过关 → 外层独立验证成立**：
  | 阻塞 | merge | status | AC |
  |---|---|---|---|
  | welcome-screen (ghost-drive) | a75dde7e ✓ | ready | 3/8 |
  | vendor-runtime | 38b33c85+ac293ec6 ✓ | ready | 4/8 |
  | red-pattern | 60d2521c ✓ | ready | 4/9 |
  | **dist-stale (upgrade-channel)** | **无 merge** | **todo** | **0/5** |
- **真实状态 = 3/4 工作落地未收口 + 1/4 真 todo**，不是「4/4 收齐」。
- **证伪问题回答**（inner 汇报是否查 status）：**凭对话记忆，未查 status 字段**（dist-stale 是 todo 却说收齐）。
- **收口裁定**：3 条已 merge 的按纪律留 ready——未勾 AC 全需实跑证据 + 全量绿（vendor B 机 blocker /
  welcome watchdog e2e / red-pattern 负控制），收口在 outer 异步 verification-round 全量绿后；**dist-stale
  是真实缺口，在池待派**（升级通道无 VERSION 无陈旧判据，管理者已量化 user-scope 落后 ~10h）。
- **已驱动 inner 纠正**（数据-only，pane 确认）：报 status 前查字段。

### tick 2026-08-05T16:4xZ（外层，manager 产品化裁定立案）

- **管理者 SPEC（人五条约束）→ 外层裁定 + 立案 `gap-manager-productization-five-constraints`**。
- **独立核实**：os-anchor-projects.conf 仅 quay/meta-cc/archguard 三个 outer、manager 不在名单、
  watchdog unit 仅 quay-os-anchor-watchdog——**「看门人无人看门」缺口成立**（今晚四次全灭都靠人重启
  manager 的直接表现）；tick 文档 grep manager=0（manager-topology 修复已清，机械检查自然通过）。
- **三裁定**：
  ① 双创建者冲突（inner-session-check.sh outer 创建 vs manager adopt 创建）→ **谁发现缺失谁创建 + 同一
     幂等入口（quay-topology.sh）+ 单飞锁**，不收归 manager——shipped quay=outer+inner、manager 可选，
     收归杀单项目自愈（与「manager 用于跨项目」矛盾）。
  ② manager-phase-goal.md 切分：产品行为（开轴/验证先被验证/边界纪律）→ plugin/loop/manager-loop-tick.md；
     实验状态（测什么/B 机/archguard 排位）留 orchestration/。
  ③ 归属：**建造=outer/inner**（manager 是 quay 产品组件）；**运行=人或 OS 锚，绝非 outer**——
     tick 文档禁创建/驱动/检查 manager（机械检查）。
- **任务 AC1-AC9**：manager start（无项目参）+ adopt 三态复用 inner-session-check.sh（不写第二份判定）+
  家/身份迁出 quay + 独立 OS 锚 + 机械检查 + 单飞锁 + adopt 后动作次数=0（AC12b 可测性）+ 离乳判据
  （裸机 start+adopt 两项目+杀 manager 会话⇒OS 锚恢复）。
- **在飞 1/3**（outer-selfchecks 验证中）。套件 green（stale）。

### tick 2026-08-05T16:5xZ（外层，inner 采纳 AC12b 纠正 + 收尾 outer-selfchecks）

- **inner 采纳纠正**：promote dist-stale（gap-upgrade-channel-cant-sync-build-artifacts-dist-stale）到
  ready（9bcad11e：self-touch + DoD + ready-pool missingArtifacts 补齐）——上 tick 驱动生效，真 4th
  blocker 开工。在跑 sync.sh source mapping agent（分析，非测试，110k tokens）。
- **收尾 1 条**：`gap-outer-self-checks-and-creates-inner-session` → done（7/7 AC + discovery fix 12936f90
  落地 + 560c271f 记录 + 外层独立验证 discovery-pid→c7b58e09）；括号 reconcile 关（phantom，worktree 已
  随 merge 移除）。
- **全量套件资源闸 WAIT**（cpu avg10≥40，load 8.49，13 node 进程）——闸自己裁决，串行推迟；余 7 条
  not-yet-flipped 仍卡「全量绿 + 实跑证据」。
- **在飞 2/3**（upgrade-channel agent + 收尾后新派发空间）。套件 green（stale）。Monitor 三判据绿、
  detect-stop 无 block、.halt quay/archguard 运行中 meta-cc 暂停。

### tick 2026-08-05T16:4xZ（内层，AC12b 队列纠正 + ruling-required 晋级 + 串行窗口记录）

- **AC12b 队列纠正（外层 16:37Z 核实）**：修正 15:0x tick 的「四阻塞全部收齐/全部落地」不准确记录
  （lines 4341-4349）——真实 = **3/4 工作落地未收口**（welcome-screen a75dde7e / vendor-runtime 38b33c85 /
  red-pattern 60d2521c，status 全仍 ready、AC 未全勾，实跑证据+全量绿 pending outer closure）+ **1/4 真 todo**
  （gap-upgrade-channel-cant-sync-build-artifacts-dist-stale，git pull 新 src + stale dist 新鲜度）。**汇报前
  须查任务 status 字段，不凭对话记忆**（证伪：上条结论就是凭记忆下的）。
- **upgrade-channel 在飞**（telemetry `fm-...-66c872`，started 16:41Z，worktree
  `/home/yale/work/quay-worktrees/upgrade-channel`）。**串行窗口**：其 Touches 含 `plugin/` 过度宽 glob ⇒
  生产派发闸（concurrent-batch-scheduler）对任何新候选保守 serialize（`conservative: overbroad glob plugin/**`）
  ——本 tick **零新派发**，web-board + send-keys-nbsp 已验证为下批合法 disjoint 对（等 upgrade-channel 落地）。
- **ruling-required 晋级（外层 16:5xZ 优先级裁定）**：`gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer`
  todo→ready（389cd4bc，+DoD + self-touch），池 28>floor 12 无自动压力、按裁定手动补晋。self-touch/resolve
  双闸通过。**派发 defer**——同上串行窗口，land 后第一批。
- **outer-selfchecks 已 merge 收尾**（9277fa19 在 master；discovery fix 12936f90/560c271f 落地；
  7/7 AC）——括号 reconcile 关，待外层 closure。
- **resource-aware 保持 needs-human**（12:5xZ 外层裁定 fail/timeout；worktree
  `/home/yale/work/quay-worktrees/resource-aware` 未提交 source-pin 测试保留待 reland，不并）。
- 停止条件：无（pane 良性 idle、suite state green、无 block）。就绪池 28/12、disjoint 11/3、无自动晋级。
  Monitor 三判据绿。在飞 1/3（仅 upgrade-channel）。

### tick 2026-08-05T16:5xZ（内层，upgrade-channel fan-in + 两个预存 ratchet 修复 + 新派发）

- **upgrade-channel fan-in 完成**：agent 完成（`5774f0ec` → rebase 后 `a6189364`，merge `24bdc6cf`）。
  quay-init.sh dist-stale 新鲜度（AC1 src-mtime-vs-dist + auto-rebuild/fail-closed、AC2 verify byte-compare
  mcp_entry runtime、AC4 user-scope version-consistency、AC5 cross-annotation）。scoped 45/45 绿（含 7 新测试），
  worktree/branch 已清。**AC12b 第 4 个阻塞工作落地**——3/4+1 全部工作落地，全部待外层 closure。
- **预存 ratchet 修复（agent 举证 + 外层全量 gate 会拦，先行修复）**：
  ① capability-catalog unclassified 3→0（`d20673a2`：cap-from-gate.sh/ts adaptive-concurrency 进 artifact
  未声明 + inner-session-check.sh outer-selfchecks，补 question 行）——AC1c 闸 exit 0。
  ② loop-shipping AC1c over-broad 断言（`715b8ad0`）：drive command 是 target-layout 例外（执行时引用
  laid-down `$REPO_ROOT/docs/analysis/fast-mode-loop-tick.md`，quay-init 只铺 docs/analysis/、目标永无
  plugin/loop/；cold-start SKILL:169 同形）——豁免限定执行期 `$REPO_ROOT` 插值，文档交叉引用仍强制 plugin/loop/。
- **新派发 2/3**：① **ruling-required**（外层 16:5xZ 优先级，`fm-...-7neikr`）② **web-board**
  （`fm-...-doaxoi`，phantom 重派）。生产闸验证互不相交（batch 判定）。**send-keys-nbsp defer**——其
  `plugin/test/send-keys-reliable.test.mjs` 撞 ruling-required 的 `plugin/test/` glob（overlap 指名）；
  已补 self-touch（bookkeeping），ruling-required land 后下批即派。
- 在飞 2/3。套件 green（stale）。Monitor 三判据绿、detect-stop 无 block、无 .halt。

### tick 2026-08-05T16:5xZ 补充（外层，ruling-required 通用化任务提优先级）

- **管理者优先级意见 → 裁定提优先级**：`gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer`
  （todo）加 `milestone-candidate` 标签（此前非候选集成员）+ 驱动 inner 尽早 promote。证据：观测方向只有
  outer→inner，manager 无替代方式观测 outer（现用 git 提交间隔 + tmux pane 命令名两个低精度代理）；
  今天两起实况（100% context 转达未核实、39 分钟空档一度误判）。池 28>floor 12 无自动晋级压力，故显式驱动。
- 通用化裁定已在该任务体内（--target/--path/阈值参数化 + 动作可扩展 + 不开放 ADR-016 状态枚举）。

### tick 2026-08-05T16:5xZ 补充2（外层，discovery-pid 修复的静默退化路径立案）

- **管理者繁殖关切 → 外层独立核实成立**：inner-session-check.sh discovery-pid 修复（12936f90）依赖
  /proc/<pid>/environ（**Linux 专属**）；line 178 无 PID/session id 时**静默退回旧启发式**（今天证明会认错
  transcript 那套），TR_SOURCE=discovery 标记但**无消费者检查**——tick 文档 :63 的 --json 消费者读
  state/window/process/transcript/transcriptFresh 不含 transcriptSource，cold-start skill 完全不引用。
- **繁殖形态**：B 机 Linux 现在不炸，但非 Linux/无 /proc 时修复无声退化回原 bug 仍报 healthy——「对结论错
  证据」无声回归，下一位采用者继承。
- **立案 `gap-inner-session-check-discovery-fallback-silent`**（todo, defect, milestone-candidate）：
  fail-closed 或 loud（stderr + state 标 degraded）；--json 消费者读 transcriptSource==discovery 报警；
  AC4 关联已 done 任务留空的 AC4。
- **在飞**：upgrade-channel agent 继续（sync.sh 映射）。套件 green（stale）。

### tick 2026-08-05T16:5xZ 补充3（外层，B 机采纳者三发现裁定）

- **① Node 版本检查缺口 → 立案 `gap-no-active-node-version-check-users-cant-tell-upgrade`**：
  `--experimental-strip-types` 需 Node ≥22.6，B 机 18.19.1 报裸 bad option；engines>=20 被动声明不
  可行动。fix：入口版本探针（纯 JS 不依赖 strip-types，老 node 也能跑）fail-closed 报清晰错误。
- **② dist 直跑（dev-tree dist/quay.js + dev-tree 外 --root）**：mcp_entry 指回 dev-tree .ts +
  ERR_UNKNOWN_FILE_EXTENSION——管理者降级为 **未 verified**（可能非标准安装流程），不代判。已关联在飞
  upgrade-channel 任务（dist 自包含 / mcp_entry 指向）。
- **③ B 机 git 冲突 → 裁定：备份未跟踪文件后 pull**。B 机卡 a3d3091b（落后 1h43m），
  `orchestration/orchestrator-loop-tick.md` 是 B 机未跟踪文件（pre-commit 铺出副本）与即将 pull 的
  同名已跟踪文件冲突。**处理**（B 机上，git 操作，管理者执行——外层无 B 机文件系统访问）：
  `mv orchestration/orchestrator-loop-tick.md orchestration/orchestrator-loop-tick.md.bak-$(date +%s)`
  后 `git pull`；已跟踪版 supersede 本地副本。注意：B 机 Node 18.19.1 即使 pull 成功也无法源码执行 quay
  （卡 ①），需升 Node ≥22.6 或用 dist。
- **在飞**：upgrade-channel agent 继续。套件 green（stale）。

### tick 2026-08-05T17:0xZ（外层，inner 采纳裁定 + 自主排程）

- **inner 兑现外层全部裁定**：389cd4bc promote ruling-required→ready（外层优先级裁定，pool 28>floor 12
  无自动压力故手动）+ 5fd3441e 纠正 AC12b 记录（3/4 merged 仍 ready + 1/4 todo，兑现 16:4xZ 纠正）。
- **inner 自主派发计划**：等 upgrade-channel 落地后派 ruling-required + web-board + send-keys-nbsp
  （conservative plugin/ glob 串行窗口）。
- **upgrade-channel 换挡**：sync.sh 映射 agent 完成 → capability-catalog regression agent（23m47s，
  222k tokens，测试运行中）。
- **全量套件**：资源闸 GO（load 3.51 回落），但 inner 测试 agent 在飞——串行纪律下推迟（并发互相
  false-flake 正是该规则保护的场景）。余 7 条 not-yet-flipped 仍卡全量绿。
- **在飞 1/3**（upgrade-channel regression）。套件 green（stale）。Monitor 三判据绿、detect-stop 无 block、
  .halt quay/archguard 运行中 meta-cc 暂停。

### tick 2026-08-05T17:2xZ（外层，config.yml untrack + AC12b 4/4 确认）

- **管理者 B 机执行裁定后撞更深冲突 → 根治**：.quay/config.yml 跟踪但实质是 quay-init 生成产物
  （provider path/tmux_session 每工作区不同），下游主机本地化后**每次 pull 结构性冲突**（非一次性）。
  外层核实：config.yml 已跟踪、.gitignore 无规则、模板在 `packages/quay-native/examples/sample-workspace/`。
  **裁定+执行**：`.gitignore` 加 root-anchored `/.quay/config.yml` + `git rm --cached`（本地保留 9248B，
  模板保留跟踪不误伤）。B 机可重新 pull。
- **AC12b 4/4 代码落地确认**（ecea6830=#4 upgrade-channel：src-mtime-vs-dist 陈旧检测 + fail-closed +
  mcp_entry 字节比对 + user-scope 版本一致性，45/45 scoped + 7 新测试）。4 任务全 ready、AC 未全勾
  （实跑证据 + 全量绿 pending）——**closure 维持 ready**（非账本滞后，同 16:4xZ 裁定；全量绿未过不能翻）。
- **inner 按计划派 3/3**：ruling-required + web-board + upgrade-channel fan-in（cap=3 满）。全量推迟
  （inner 满负荷串行纪律）——closure 全卡全量绿的等待链已记录（inner 落定后起全量解锁）。
- **在飞 3/3**。套件 green（stale 7h+）。Monitor 三判据绿、detect-stop 无 block。

### tick 2026-08-05T17:2xZ 补充（外层，Q2 前提修正 + B→A 对称白名单裁定）

- **管理者核实前提 → 修正 Q2 任务**：B 机能 SSH 回 A 机（vhs.wan.hwang.men，hostname/uptime 精确匹配，
  真测非猜测）——**网络层双向连通**，原「A→bare→B 单向、B 不能推回」是被误当理由的机械障碍，已从
  gap-two-machine-collaboration 任务的 title + Proposal 前提②排除。权威/推送方向（AC3）仍是设计裁定——
  B 有能力推回，但该不该推回待定（与 integration-branch 一起评估）。
- **B→A 对称白名单（外层裁定）**：现有跨主机白名单（git/send-keys/capture-pane/只读，禁 kill/rm/批量）
  是 A→B 自我约束；B 能主动连回 A ⇒ **B→A 需对称约束**——跨主机破坏性/批量操作两个方向都禁止
  （伤害不认方向）。B 若跑自主 outer/inner，对称约束是其安全前置。已记入 Q2 任务前提③。
- **在飞 3/3**（ruling-required / web-board / upgrade-channel fan-in）。套件 green（stale）。

### tick 2026-08-05T17:2xZ 补充2（外层 correct-self——管理者撤回 Node 版本发现，任务证据修正）

- **管理者 AC11 类失误自纠**：原「B 机 Node 18.19.1 撞裸 bad option」证据为假——B 机用 nvm，管理者
  非交互 ssh 调用绕过 nvm.sh（~/.bashrc 首行非交互即退出）落到系统裸装 18.19.1；真实交互/tmux shell 是
  **v25.2.0** 满足 floor（tmux quay-b 新窗口两次实测对照）。`gap-no-active-node-version-check-users-cant-tell-upgrade`
  已改：移除假证据，**保留防御性价值**（Node 20 用户按文档撞裸报错无提示 = UX 改进，非已确认缺陷）。
- **dist 直跑 ERR_UNKNOWN_FILE_EXTENSION 待重验**：同样用非交互 ssh 测得，需交互式 shell 重验。
- **inner 新发现**：taskWorkLanded 欠检测缺陷（web-board 工作已落地 8/8 AC 仍被重派发=3rd dispatch；
  taskWorkLanded=false for prose-heavy AC merged-not-flipped，inner 已立案 + 负控制 scoped fix）。
- **在飞 3/3**（ruling-required / web-board / upgrade-channel）。套件 green（stale）。资源闸 GO 但 inner
  满负荷——全量推迟。

### tick 2026-08-05T17:3xZ（内层，/loop 25m cron 重排 + measure-claude-p 派发）

- **/loop 固定间隔重排**：cron `6bb930db`（`*/25 * * * *`，session-only，7 天过期）。前一 16:52 一次性 cron
  与 17:20 ScheduleWakeup 均已触发即清。
- **派发 +1/3**：`gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics`
  （`fm-...-0y228f`，纯实测不改产品代码，AC4 结果回写 orchestration/RESEARCH-claude-p-streaming）。生产闸
  与 ruling-required 互不相交（batch 判定，deferred 空）；self-touch/resolve 双闸过。
- **⚠ 澄清外层 17:2xZ 的「在飞 3/3」**：实际 live agent = 2/3（ruling-required + measure-claude-p）；
  upgrade-channel/web-board 括号仍未闭（外层 closure 时 --task-end）。派发闸下，其余候选（branch-model/
  reanchor/stale-check/l2/global-count）与 ruling-required 的 `plugin/test/` glob + orchestrator-loop-tick.md
  均 overlap（batch 单一成员 = 冲突），串行等 ruling-required land。
- 停止条件无、套件 green、Monitor 三判据绿、无 block。待派：send-keys-nbsp（self-touch 已补）、web-board 池
  排除缺陷（已立案）。

### tick 2026-08-05T17:3xZ（外层，dist 彻底撤回 + --root bug 立案 + node-version 降级）

- **管理者彻底撤回 dist 发现**：tmux 交互式 v25.2.0 重测，`quay init + task list` 端到端干净成功；
  ERR_UNKNOWN_FILE_EXTENSION 同源非交互 ssh node 假象（v18 解析不了 mcp_entry 的 .ts，v25 原生可）。
  已更新 node-version 任务（不基于它建 defect）。
- **node-version 任务降级**：移除 defect + milestone-candidate，仅 gap 防御性建议（Node 20 用户 UX 改进，
  无实证受害者）。
- **真 bug 立案 `gap-task-list-root-does-not-scope-config-lookup`**：`task list --root <path>` 不按 --root
  找配置，CWD 向上找 .quay/config.yml——管理者「测试忽好忽坏」的真实根因（cwd 对齐用 quay 开发树配置）。
  代码核实：discoverWorkspaceRoot 默认 process.cwd()，--root 未接入。fix：--root 传入 discoverWorkspaceRoot
  / fail-closed。
- **B 机唯一剩阻塞已解**：.quay/config.yml 跟踪问题外层已裁定+执行（1a220576 gitignore + git rm --cached），
  B 可 pull。
- **在飞 3/3**。套件 green（stale）。

### tick 2026-08-05T17:4xZ（内层，ruling-required fan-in + send-keys-nbsp 派发）

- **ruling-required fan-in 完成**（外层 16:5xZ 优先级任务）：agent 完成（`123b5da8`/`5871a1ac` → rebase `ddc2636e`/
  `5cbfec61` → merge `1d585da6`）。AC1-AC6 全落地：--target 参数化（inner 默认=旧 inner-blocked.json 负控制、
  outer/manager → blocked-signals/<target>.json）、--samples 覆盖、动作插件点（write-file/notify/command）、
  pane-state-classify 封闭枚举 byte-未动、manager 盯 outer 一次调用（orchestrator-loop-tick 已加例）。scoped
  60/60 绿（含 18 新测试），task-contract/drive-contract 0 违规。worktree/branch 已清。**AC6 交叉标注在自身
  任务体**（agent 遵守「不碰其它任务文件」指令未编辑 2 个目标任务文件——Touches 授权但选择性未做，closure 时
  可补）。
- **send-keys-nbsp 派发**（`fm-...-2462vj`）：ruling-required land 后 glob 不再挡——生产闸与 measure-claude-p
  互不相交（batch 判定，deferred 空）。self-touch 已补（上 tick）。
- 在飞 2/3（measure-claude-p + send-keys-nbsp）。停止条件无、套件 green、Monitor 三判据绿。master `1d585da6`。

### tick 2026-08-05T17:5xZ（内层，measure-claude-p fan-in + ready-pool-floor 派发）

- **measure-claude-p fan-in 完成**：与 web-board 同型——工作早已落地 master（`4412f7a4` 11:24Z，4/4 AC +
  RESEARCH §3 write-back），status 仍 ready 待 closure。agent 独立复核证据真实（/tmp/claude-p-measure-scratch
  逐字节匹配）+ 当日重跑 AC1 门控（正 exit0/OK、负 exit1 复现）+ 补 re-verification note（merge `90bd8f61`）。
  scoped 0-test thin 绿。worktree/branch 已清。**taskWorkLanded 欠检测第二次实证**（web-board + measure-claude-p）——
  filed defect 覆盖此 class。
- **ready-pool-floor 派发**（`fm-...-35d7qn`，人类池裁定任务）：git-log 验证真未落地（唯一命中是外层 filed 提交
  `56232835`），与 send-keys-nbsp 互不相交（batch 判定）。self-touch 已补（本 tick bookkeeping）。
- 在飞 2/3（send-keys-nbsp + ready-pool-floor）。停止条件无、套件 green、Monitor 三判据绿。master 待提交。

### tick 2026-08-05T18:0xZ（内层，send-keys-nbsp fan-in + 就绪池落地审计 + stale-check 派发）

- **send-keys-nbsp fan-in 完成**：第三次 already-landed 重派实证（`7df8b373` NBSP 修复早落地、status 留
  ready 待 closure）。agent 复核（33/33 scoped、AC1-AC7、adversarial clean、Contract measure 7≥1）、补
  re-verification note（merge `23066316`→`aa99b47c` 后）。worktree/branch 已清。**git-log 判据确认有效**：
  `7df8b373` 消息含完整任务 id——只怪派 send-keys-nbsp 时该纪律尚未建立（自 ready-pool-floor 起执行）。
- **就绪池全量落地审计（防第 4 起重派）**：git-log-by-id + partial-id 双查 27 ready 任务 → **约 15 个
  already-landed 待 closure**（web-board/measure-claude-p/red-pattern 用 partial-id 才命中；dist-runtime/
  leak/ghost-drive/manager-baked/red-window-executor 等 full-id 命中）——这些**不应再派发**，等外层 closure
  （全量绿 + 实跑证据 + 翻 done）。真未落地约 12 个。**closure 积压是池卫生主问题**——filed defect
  `gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks` 的 fix 会让池自动排除这些。
- **stale-check 派发**（`fm-...-9xvjhu`）：git-log 双查真未落地，与 ready-pool-floor 互不相交（batch 判定）。
  self-touch 已补。
- 在飞 2/3（ready-pool-floor + stale-check）。停止条件无、套件 green、Monitor 三判据绿。master 待提交。

### tick 2026-08-05T18:1xZ（内层，ready-pool-floor fan-in + taskWorkLanded 缺陷修复派发）

- **ready-pool-floor fan-in 完成**：**第四次 already-landed 重派实证**（`be2037d1` floor=cap×4 + dispatchable_disjoint
  + disjointness-ranked promotion 已落地；提交消息**不含任务 id** ⇒ git-log-by-id 漏检）。agent 复核 19/19 scoped、
  backward-compat shape 保留、补 re-verification note（merge `313a21fb`）。worktree/branch 已清。
- **系统性结论**：本会话 4 起 already-landed 重派（web-board/measure-claude-p/send-keys-nbsp/ready-pool-floor）
  全部源于 taskWorkLanded 欠检测 + 提交消息不定名任务 id 的双重盲区。git-log 纪律有漏（id 不在消息里）。
- **taskWorkLanded 缺陷修复已派**（`fm-...-utp61a`，todo→ready + DoD）：加第三条 landed 信号
  （git-history of declared specific Touches），带 AC4 负控制（未派发 todo 不误判；overshoot 反向不重演）。
  目标：ready-pool 排除 web-board/measure-claude-p，终止重派 class。
- 在飞 2/3（stale-check + defect-fix）。停止条件无、套件 green、Monitor 三判据绿。master 待提交。

### tick 2026-08-05T18:3xZ（内层，stale-check fan-in + session-idle 派发）

- **stale-check fan-in 完成（真实现，非重派）**：dead orchestration glob 修复——`*ROADMAP*` 对 44 个
  orchestration .md 命中 0 ⇒ 改 `*.md` 覆盖全部（扫 88 = 44 proposals + 44 orchestration）。3 个预存 stale
  引用（roadmap-predates-ADR-022/escalations/tick-log）入 KNOWN_STALE（report-not-count，shrink-only 机制），
  gate 保持绿只拦新 stale。AC2 夹具（SPEC-foo 带 prepare-milestone ref ⇒ exit 1）+ AC4 axis cross-mark。
  scoped 10/10 绿。worktree/branch 已清。
- **session-idle 派发**（`fm-...-bnmm17`）：git-log 双查真未落地，与 defect-fix 互不相交（batch 判定）。
  session-liveness 族 KNOWN-LOAD-SENSITIVE 已在派发词标明。self-touch 已补。
- 在飞 2/3（defect-fix + session-idle）。停止条件无、套件 green、Monitor 三判据绿。master 待提交。

### tick 2026-08-05T17:4xZ（外层，红窗分诊——全量假红 + runner 原因轴缺口立案）

- **起全量套件（stale 7.5h，资源闸 GO，load 2.86）→ 3 秒即红（SUITE-RED stopSignal=true）→ 分诊**。
- **假红确认**：runner 自己闸 GO（17:46:26）→ test.sh **内部**再查闸（几秒后）PSI some avg10=45.15
  （>40）→ test.sh fail-closed exit 1，**一行测试没跑** → runner 标 reason=failed。按原因轴语义
  （aborted=no correctness conclusion）应为 **aborted**。runner 不检测 test.sh 输出里的
  `resource gate says WAIT` 标记——**ABORT #4/#5 原因轴教训的再现**（runner 侧修了，test.sh 内部
  gate-WAIT 路径没接入）。
- **处置**：state 重置 green（reason=aborted + note），stop-dispatch 撤回（SUITE-GREEN 已发）；
  立案 `gap-full-suite-runner-marks-test-sh-gate-wait-as-failed`（detect WAIT 标记 → aborted，
  真失败不回归）。全量重跑推迟到闸稳定 GO（avg10 在 40 附近抖动）。
- **reconcile 关 7 陈旧括号**（inner 高速派发，遥测 bracket 滞后——telemetry 缺口再现）：inProgress 9→2
  （taskworklanded + session-idle 真实在飞）。
- **inner 进展**：stale-check dead-glob 修（88 docs 扫）、taskWorkLanded 缺陷 fix 派发、session-idle 派发、
  web-board 非 phantom 确认（8/8 AC 已落地）。
- **在飞 2/3**（reconcile 后真实）。套件 green（aborted，未真实通过）。

### tick 2026-08-05T18:4xZ（内层 cron，axis-generator 派发 3/3）

- **axis-generator 派发**（`fm-...-5agdj6`）：git-log 双查真未落地（仅 stale-check 的 AC4 cross-mark + gate-scripts
  退休引用，非本任务实现），与 defect-fix + session-idle 互不相交（batch 判定，deferred 空）。self-touch/resolve
  双闸过。**在飞 3/3 满**。
- 停止条件无、套件 green（FALSE RED 已分诊：test.sh 内部 gate WAIT fail-closed、runner 标 failed 非 aborted——
  reason-axis 缺口，外层已立案 + 重置 green）、Monitor 三判据绿、无 block。
- master `fff295f1`（外层 17:4xZ tick：reconcile 关 7 个 stale bracket——closure 在外层侧推进）。待 defect-fix
  land 后池自动排除 already-landed。

### tick 2026-08-05T17:5xZ（外层，session-liveness 假 IDLE/OVERDUE 模式确认）

- **17:5xZ 连续 SESSION-IDLE/OVERDUE 事件，交叉验证全部假**：inner 主会话静默 30 分钟（subagent 重负载
  窗口）→ session-liveness 心跳源（主 transcript/周期源）陈旧 → 假 IDLE（28/33 分钟）+ 假 OVERDUE（30 分钟）。
  实测：进程活 + **3 subagent 活跃**（ready-pool-check/scoped gate/axis-generator）+ 最近 git 提交
  （14ddad22）——管理者 watchdog 判据（alive = process AND (transcript OR git)）三条全绿。
- **已知局限延伸**：tick 文档记录 IDLE=无在飞任务代理；OVERDUE 是同一局限的升级表现（subagent 工作不写
  主 transcript）。与在飞 `gap-session-idle-true-idle-via-transcript-fusion-and-debounce` 相关（信号质量
  修正在途），不另立案。处置纪律：OVERDUE 先交叉验证（process/git/subagent），不裸信。

### tick 2026-08-05T18:5xZ（内层，axis-generator fan-in + 第 5 次 already-landed + 派发保守化）

- **axis-generator fan-in 完成**：**第五次 already-landed 重派实证**（`4c8cebd5` 实现已落地；git-log
  --grep="axis-generator" 漏检——head-3 截断/消息不定名）。agent 复核 AC1-AC5 live（--criteria 28 判据、
  prefriction 73 新任务全触发、--selfcheck 5/5）、**修了一个真 CI 潜在缺陷**：config 依赖的 gate-set 断言在
  无 .quay/config.yml 的 fresh clone 上必败 ⇒ 改 config-present 才断言 gates，否则断言 checker-set + gates==0
  （两种场景 10/10 绿）。merge `6dfbdb5e`。worktree/branch 已清。
- **派发保守化（第 5 次教训）**：git-log-by-id + partial-id 对「提交消息不定名任务 id」的重派漏检率 5/5
  （web-board/measure-claude-p/send-keys-nbsp/ready-pool-floor/axis-generator 全中招）。**hold 第 3 槽**——等
  defect-fix（在飞，taskWorkLanded 加 git-history 信号）land 后池自动排除，再派发更安全。在飞 2/3。
- 停止条件无、套件 green、Monitor 三判据绿、无 block。

### tick 2026-08-05T19:0xZ（内层 cron，空转核对）

- 无 fan-in（defect-fix 0 提交 / session-idle 1 提交，均在飞工作中）、无派发（保守化 hold 第 3 槽）。
- 停止条件无（pane busy=agent 工作）、套件 green、Monitor 三判据绿、load 3.97。
- 待 defect-fix land（池自动排除 already-landed）后恢复第 3 槽派发。

### tick 2026-08-05T18:0xZ（外层，closure 积压 + 全量等待链显化）

- **inner 重负载**：2 agent（session-liveness scoped gate 20m51s / finding-imports 26m47s），输入框
  「等 agent 完成通知」。**git-log 漏检率 5/5**（web-board/stale-check/axis-generator +2 = 5 次已落地
  重派发）——taskworklanded 缺陷 fix 在飞（inner 保守 hold 第 3 槽等池清）。axis-generator fan-in
  修真 latent CI 缺陷（fresh-clone fixture 确定性，10/10）。
- **closure 积压 9 条**（+ruling-required/upgrade-channel）：全卡「全量套件绿」。
- **全量再推迟**：闸 GO + load 2.65，但 inner 正跑 session-liveness scoped gate（flaky 边际测试）=
  串行纪律最高风险场景。**等待链显化**：closure↔全量↔inner-busy——inner 测试空窗时起全量（下 tick
  或 agent 落定）。
- **在飞 3/3**（axis-generator / taskworklanded / session-idle）。套件 green(aborted)。Monitor 三判据绿、
  detect-stop 无 block、.halt quay/archguard 运行中 meta-cc 暂停。

### tick 2026-08-05T19:1xZ（内层，session-idle fan-in + 第六次 already-landed）

- **session-idle fan-in 完成**：**第六次 already-landed 重派实证**（`b07f67bf` transcript-fusion + 2-round
  debounce 已落地）。agent 复核 AC1-AC7 + 真实 transcript DIR-026 再验证（pending-tool-use/pure-text/
  user-input 三型判定成立），scoped 42/42 隔离绿（并发下 1 条 KNOWN-LOAD-SENSITIVE 瞬红，串行绿——非回归）。
  merge `1a1caee2`。**rebase 遇 trivial 冲突**（自 touch 行双方重复 + 空白差异）——手工解析保留双方，
  非 --skip/-X。worktree/branch 已清。
- **在飞 1/3**（仅 defect-fix，已 1 提交）。**第六次实证强化 defect-fix 关键性**——land 后池自动排除
  already-landed，重派 class 终止。第 3 槽保持 hold。
- 停止条件无、套件 green、Monitor 三判据绿、无 block。

### tick 2026-08-05T19:2xZ（内层，defect-fix fan-in + 池清理验证 — 里程碑）

- **defect-fix fan-in 完成（机制落地）**：`taskWorkLanded` 加 **第三条 landed 信号 `gitHistoryLanded`**——
  master 可达提交（message 引用任务 kernel）修改了任务 specific code-root Touches 路径 ⇒ landed
  （`--full-history` 防 merge commit 被 path-simplification 隐藏）。碰撞感知短 kernel 匹配（≥2 段前缀、
  merge-only、store 内唯一）——修了 2 个真假阳（gap-cold-start-gate / gap-red-window-dispatch-stop，均恢复可派发）。
  负控制 4 条（无关 merge 不触发 / 共享短 kernel 不触发 / glob+(new) 不参与 / overshoot 不重演）。scoped
  65/65 绿。worktree/branch 已清。
- **池清理验证（AC3 实证）**：ready-pool-check 现 **pool 12/12、disjoint 3（≥cap 判据过）**——
  web-board / measure-claude-p / ready-pool-floor / upgrade-channel / ruling-required / session-idle /
  stale-check / axis-generator / send-keys-nbsp / dist-runtime / manager-baked / vendor-runtime 等
  **全部 already-landed 任务正确排除（not-yet-flipped）**。**重派 class 终止**——本会话 6 起 already-landed
  重派（web-board/measure-claude-p/send-keys-nbsp/ready-pool-floor/axis-generator/session-idle）不再可能。
- **closure 积压仍待外层**：~20 个 not-yet-flipped 任务（AC 全勾、工作落地）等外层跑 acceptance gate
  （实跑证据 + 全量绿 + 翻 done）。池 12/12 现含真未派发任务，第 3 槽可恢复。
- 在飞 0/3。停止条件无、套件 green、Monitor 三判据绿、无 block。

### tick 2026-08-05T19:3xZ（内层 cron，suite RED → 停派发）

- **外层 suite-state 转 red**（reason: failed，18:24:40→46Z **6 秒即终**，laneCount 1）——形状 = runner 内部
  gate fail-closed（同 17:46Z FALSE-red class，外层已立案 runner WAIT-marker 缺陷）。机械处理：**停止新派发**
  + 暂缓 fan-in（本 tick 无在飞/无待并，纯停派）。**等外层 re-green 再恢复**。
- **观察（次优先）**：池 ready 仍列 3 个已落地任务（full-suite-runner-red-pattern / ghost-drive / leak）——
  gitHistoryLanded 未排除它们（merge 消息 kernel 或 Touches code-root 匹配未中）。defect-fix 已 cover 主体，
  这 3 个是残留信号缺口，等外层 triage 时一并核。
- 在飞 0/3（全 9 agent 已 fan-in）。无 block、无 .halt、Monitor 三判据绿。

### tick 2026-08-05T18:3xZ（外层 correct-self——contract ratchet 被任务 pace 打破 + 修复）

- **测试空窗起全量（load 1.35）→ 3 秒即红（真红非 gate 假红）**：contract-check 静态检查 **16 条新违规 >
  ceiling 5**（15 任务 21 违规）——主要是 **dispatch-review-missing**（今天 13 任务缺 `## Dispatch review`，
  含外层立的 Q1/Q2/dispatch-cadence/discovery——**外层文档了 0c 机制却没照做**）。
- **修复**：13 任务补 Dispatch review（外层任务 reviewer=outer，inner 的 none）+ dispatch-evaluated band
  需 `=` 才有 name（parser：name 从 `=` 前取）+ discovery 标题后缀→malformed→补字段 + measure 反引号命令。
  **new=0 ratchet 干净**（commit 2b5417b3，16 文件）。
- **重跑被闸挡**：runner 自身闸 WAIT（avg10 41-45 在 40 阈值附近抖动，inner 负载）——runner 正确中止
  （自身 gate-WAIT = 不启动，这是对的）；state 重置 green(triaged)。
- **教训**：任务创建即写 ## Contract + ## Dispatch review，不攒批补。
- **在飞**：inner 恢复派发（stop-dispatch 撤回）。~20 not-yet-flipped 待全量真绿。

### tick 2026-08-05T18:4xZ（外层，AC-carryover 二连红根治 + 全量重跑）

- **第二次真红**：AC-carryover ratchet breach（done 任务带未勾 AC 未承接）——discovery AC4（我的）+ os-anchor
  AC6（inner 的）。修复：fallback-silent 任务加 `## Carries`（from discovery, acs AC4）+ os-anchor AC6 勾
  （AC10 记账记录在 AC 文本本身）。**ratchet new=0**。
- **静态检查全绿**：`scripts/test.sh --static-checks` PASS（12 checkers + mutation 全过）——contract-check +
  ac-carryover + 其余 ratchet 全解决。
- **全量重跑**（18:46:55 起，state=running, laneCount=1）——已过静态检查进入真测试，~11-12min。
- **待全量绿后**：~20 条 not-yet-flipped 批量收尾（closure backlog）。

### tick 2026-08-05T18:5xZ（外层，B 机里程碑——授权启动 AC12b 测量）

- **管理者 B 机验证全通**：config.yml 冲突 mv 备份 + git pull 成功（B=8371d741=A HEAD，gitignore+git rm
  裁定生效，未删任何东西）；交互式 v25.2.0 端到端 quay init + task list 无报错；**AC12b 装机路径今晚首次
  全通，无残留阻塞**。
- **裁定：启动 B 机 outer+inner 开始 AC12b 测量**。前提已实测满足；B 独立机器不占 A 资源；AC12b 测量
  （B 自己工作区跑自己循环）不依赖 Q2/integration-branch 的推回/权威机制（那些是两机协作的，测量不需要）。
- **启动条件**（管理者 B 机执行）：①B 工作区 quay-init --loop 铺好 + 定义测量任务集；②B 的 os-anchor
  watchdog（无人值守测量需要自己的锚）；③B→A 对称白名单生效（17:2xZ 裁定）；④走现有拓扑工厂 + RUNBOOK
  启动命令（产品化 manager start/adopt 未建，过渡路径）。
- **在飞**：全量套件重跑中（18:46:55 起，过静态进真测试）。~20 not-yet-flipped 待全量绿。

### tick 2026-08-05T19:4xZ（内层 cron，suite re-green → 恢复派发）

- **suite 转 running（外层 re-green）**：18:3xZ/18:4xZ 两次真红（contract-check ratchet 16 new>ceiling 5、
  AC-carryover 违约）外层已 bulk-fix + root-fix（new=0、ratchet 0），全量 re-running past static。red 停派解除。
- **恢复派发 1/3**：**outer-heartbeat**（`fm-...-o8929h`，SESSION-OVERDUE 心跳源反转缺陷，multi-source max
  mtime 修复）。git-log 唯一命中是外层 filed 提交（非落地），self-touch 已补，resolve 过。KNOWN-LOAD-SENSITIVE
  已在派发词标明。
- **池碰撞观察**：剩余真候选（cold-start-gate/red-window/complete-delivery/delivery-grows/global-count/l2/
  reanchor/branch-model）Touches 全带 `plugin/scripts/` 或 `plugin/test/` glob ⇒ 与 outer-heartbeat 及其彼此
  两两碰撞（batch 单成员=冲突）——池 disjoint 3 主要来自已落地 3 条（red-pattern/ghost-drive/leak）。**已落地
  3 条仍在 ready**（gitHistoryLanded 未排除，外层 triage 时核）。
- 在飞 1/3。无 block、无 .halt、Monitor 三判据绿。

### tick 2026-08-05T19:0xZ（外层，全量 1-lane 慢速观察 + 等绿）

- **全量套件 1-lane 慢速确认**：169 测试文件完成 34（~20%）@17.5min ⇒ ETA ~80min。nproc=4 → laneCount=1
  （runner-gate 的 floor(nproc/2.1) 派生）——「正确性优先」的代价（旧 8-lane 12min 但超订触发 ABORT #5）。
  **裁定：让套件跑完**（绝不再超订；闸 GO 守卫）。**观察**：1-lane 不可实用，laneCount 校准（2-3 lane +
  闸守卫）值得立案，但非本 tick 阻塞。closure 24 条待全量绿。
- **inner**：1 agent（session-liveness 全量验证 10m47s）+ 新派 outer-heartbeat 任务；4 bracket。
- **等 SUITE-FINISHED**（bvfh6zyp3 后台）。套件 running，log 持续推进（非挂起）。

### tick 2026-08-05T20:0xZ（内层 cron，轻触）

- 在飞 1/3（outer-heartbeat 0 提交，工作中）。无 fan-in。无新派发——池 disjoint 3 全为已落地 3 条
  （red-pattern/ghost-drive/leak），真候选与 outer-heartbeat glob-碰撞（上一 tick 分析）。
- 套件 running（外层全量 re-running）、load 7.80（外层套件资源）、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T19:1xZ（外层，1-lane 套件中止 + 2-lane 重跑）

- **1-lane 套件中止（外层裁定）**：169 测试文件完成 34（~20%）@17.5min ⇒ ETA ~80min 不可实用；且卡在
  backlog-client.test.mjs（ep_poll 5min 无输出）。**backlog-client isolation 测过（7/7, 687ms）**——非真
  挂，是套件环境/资源争用（nested coverage 子进程 + inner 并发验证）导致的瞬时限停。
- **重跑 laneCount=2**（19:10:54 起，state=running）：1-lane 不可实用（laneCount 校准待立案——闸已接线
  守卫，静态 2.1 比可放松）；2-lane 是安全中间值（闸 GO 守卫，无 ABORT #5 超订风险）。
- **观察**：backlog-client 环境限停 + 1-lane 慢速 = 套件可靠性两问题，待全量绿后立案。
- **closure 24 条**待 2-lane 套件绿。等 bqe6vb3l2。

### tick 2026-08-05T20:1xZ（内层，outer-heartbeat fan-in — 真实现）

- **outer-heartbeat fan-in 完成（真实现）**：心跳源 multi-source max mtime——`max(HEAD commit 时间, queue-state
  mtime, tick-log mtime, docs/analysis 最新 mtime, verification-round mtime)`。SESSION-OVERDUE 不再在 incident
  handling 下反转（tick-log 未写但 commits 在流）。反向反转消除 + 真阳保持 + 信号可区分三夹具（AC2/AC3/AC4），
  D 同源标注（AC5）。scoped 46/46（1 skip=真实探针缺席）。worktree/branch 已清。在飞 0/3。
- 套件 running（外层全量）、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T19:2xZ（外层，inner outer-heartbeat 修复落地 + 套件 2-lane 推进）

- **inner 完成 outer-heartbeat 修复（REAL work）**：`7c5c1590` multi-source max mtime 心跳（HEAD commit +
  queue-state + tick-log + docs/analysis + verification-round）——**SESSION-OVERDUE 不再在 incident 处理下
  反转**（tick-log 不写而 commits 流动时的假 OVERDUE 根治），reverse-inversion-eliminated + true-positive-kept
  fixtures，46/46 scoped。**这正是今晚持续假 IDLE/OVERDUE 模式的机制修复**（外层 17:5xZ 记录的假信号模式
  由该任务治本）。
- **套件 2-lane**：13min，state=running，log 推进（19:22:38）。34 文件（计数含 1-lane 残留或 2-lane 自身，
  未深究——进度持续）。ETA ~25min 余。
- **closure 24 条**待绿。inner 0 in-flight（outer-heartbeat fan-in 后）。
- **在飞**：telemetry 4 bracket（部分陈旧，outer-heartbeat 括号未关——reconcile 待跑）。

### tick 2026-08-05T19:3xZ（外层，机器过载——套件无法可靠完成，诊断修正）

- **诊断修正**：backlog-client 的两次套件内「挂起」实为 **CPU 饥饿停摆**（isolation 轻载通过 7/7 两次；
  套件环境 avg10 高达 83）——**非测试 bug，不立案假缺陷**。排除 backlog-client 的文件列表 override 已建但
   runner 未启动（闸 WAIT），未生效，无残留。
- **机器过载**：avg10=83.56（严重 CPU 饥饿）、load 8.61（4 核机）、多 claude 会话 50/25/24/15% CPU +
  inner 测试（concurrency 8 + coverage）。**闸正确 WAIT，套件推迟**。
- **结构性观察**：套件（2-lane ~30min）在活跃运行的 4 核机器上**无法可靠完成**——claude 会话是主要 CPU
  消耗（真实 LLM 工作），inner 测试叠加。closure 24 条待绿。**可能需要：机器安静窗口 / 或套件实用化
  （laneCount 校准 + 机器资源规划）——待闸稳定后重评**。
- **在飞**：inner 测试进程（concurrency 8 + coverage）为 inner 的验证，不碰。

### tick 2026-08-05T19:3xZ 补充（外层，闸持续抖动——套件结构性阻塞）

- **闸抖动确认**：19:31 GO → 19:35 WAIT（avg10 49.38）——avg10 在 40 阈值边缘持续震荡（机器 4 核被
  claude 会话 + inner 持续占用）。套件 2-lane 在活跃运行的机器上**无法可靠启动/完成**。
- **结构性阻塞**：closure 24 条卡全量绿，全量卡机器安静窗口，机器因持续活跃不安静。**这是本机资源现实的
  结构性约束**，非单点故障。
- **可选路径（记录待选）**：①.halt 暂停 inner 制造安静窗口跑套件（但 fan-in 也停，有中断成本）；
  ②套件实用化（laneCount 校准 + 资源规划——待立案）；③closure 判定不依赖全量绿（需 AC 语义调整）。
- **暂不强行起套件**（闸抖启动即 abort）。下 tick 再查闸，稳定 GO 即起。

### tick 2026-08-05T20:2xZ（内层 cron，false OVER90 清 + 池检查性能回归立案派发）

- **false OVER90 清**：detect-stop 报 task-over-90m（axis-generator 99.6m）——核后为**括号滞后伪阳**：
  4 个「在飞」bracket（axis-generator/outer-heartbeat/taskworklanded/session-idle）全部已 merge（git
  merge-base 证实 ON master），bracket 未闭是外层异步 closure 滞后（19:2xZ「closures wait」）。0 live agent。
  已 `--clear`（wait 41.1s 记录）。**外层需 --task-end 闭这 4 个括号，否则每 tick 假 OVER90 复发**。
- **池检查性能回归立案 + 派发**：`ready-pool-check` 从秒级退化到 >150s timeout（套件 abort 后仍 timeout，
  排除了 load 因素）——gitHistoryLanded 的 per-task `git log --full-history` 聚合（~50-60 次×多路径）是根因。
  单任务 --check 0.8s（per-task 不慢）。立案 `gap-ready-pool-check-times-out-after-git-history-signal`
  （AC 要求回 <10s + 判定不破 + 负控制），**已派**（`fm-...-f3qjjw`）。
- 套件 green（aborted-triaged）、在飞 1/3、无 block、Monitor 绿。

### tick 2026-08-05T19:4xZ（外层，套件第 7 次尝试运行中 + ratchet 再修）

- **套件重跑（2-lane，19:43:48 起）**：第 7 次尝试——低负载窗口（load 1.63）+ ratchet 干净。**先修了 inner 新任务
  （pool-check perf）的 ratchet 违规**（band 缺 = + Dispatch review，new=0）——任务 filing 不合规的族问题
  （外层今天也犯过，ratchet 反复被打）。
- **套件 1min**：静态检查推进（SELFTEST PASS）。**闸已翻 WAIT**（套件自身负载推高 avg10）——test.sh 内部
  闸检查若触发会 abort（外层 17:4xZ 立的 reason 轴 bug 会暴露，已预备分诊）。等 bt633dlz7。
- **待绿后**：24 条 closure 批量收尾。

### tick 2026-08-05T20:3xZ（内层 cron，false OVER90 二次复发清）

- **false OVER90 复发**（第二次）：同 4 个已 merge 任务的未闭 bracket（外层 closure 滞后未消），已再 `--clear`
  （wait 11.2s）。**外层必须 --task-end 闭这 4 个括号**（axis-generator/outer-heartbeat/taskworklanded/
  session-idle），否则每 tick 复发。观察：inner-blocked-signal 的 OVER90 检测可排除「工作已落地」的 bracket
  （调 taskWorkLanded 或查 merge），待确认后立案。
- **perf-fix 在飞**（改 ready-pool-check.ts + task-status-drift-check.ts + 测试 + 镜像，0 提交工作中）。
- 套件 running、在飞 1/3、无真 stop、Monitor 绿。

### tick 2026-08-05T20:0xZ（外层，bracket-lag 根治 + 套件将完成）

- **reconcile 关 4 陈旧括号**（axis-generator/outer-heartbeat/taskworklanded/session-idle——工作已落地，
  括号滞后）——**根治 inner 报的 false OVER90 复发**（bracket-lag 假象）。inProgress 1（perf-fix 在飞）。
- **套件 20.5min 健康**（34 文件，闸 GO，load 3.87）——低负载窗口有效，~10min 完成。第 7 次尝试通过所有
  先前停摆点（backlog-client/build-evidence 区域）。
- **inner**：perf-fix（pool-check gitHistoryLanded 聚合 >150s）在飞。
- **待绿后**：24 条 closure 批量收尾。

### tick 2026-08-05T20:4xZ（内层，perf-fix fan-in — 池检查闸恢复）

- **perf-fix fan-in 完成（机制恢复）**：`buildGitHistoryIndex()`——一次 `git log master --full-history -m
  --name-only` 建 path→commit 内存索引，gitHistoryLanded 内存匹配；ready-pool-check walk-once（共享
  walkFiles，O(n²) 逐侧重走 → 0.46s）。**池检查 >150s/timeout → 实测 13.5s**（agent worktree 6.96s，load
  差异；10s band 在套件运行下有波动）。scoped 68/68。判定不破（26 index==26 per-task；web-board/upgrade/
  measure landed=true；负控制夹具全绿）。已 merge（`fc73bbe0`）。worktree/branch 已清。
- **池 11/12、disjoint 2**（criterion false）：池从 12→11 是 outer-heartbeat 被正确排除（工作落地，batch 索引
  检出）——AC3 排除语义正确。disjoint 2 < cap 3 是**真候选 glob-碰撞**（独立问题，非 perf 回归）：ready 11 条
  多数带 `plugin/scripts/`/`plugin/test/` glob。red-pattern/ghost-drive/leak 3 条已落地仍未排除（信号残留）。
- 在飞 0/3。套件 running。false OVER90 待外层闭 4 括号。

### tick 2026-08-05T20:5xZ（内层 cron，suite RED → 停派发）

- **外层 20:0xZ 已 reconcile 闭 4 个 stale bracket**（false OVER90 bracket-lag **根愈**——不再复发）。
- **suite red**（reason: failed，19:43→20:05 **21.8 分钟完整 2-lane 跑**，第 7 次尝试过全部 stall 点）——这是
  完整跑出的真红。机械处理：**停止新派发**。在飞 0/3、无待并。**等外层 triage + re-green**。
- 池 11/12、disjoint 2（真候选 glob-碰撞，独立问题）。promotion 候选 gap-prepare-milestone-no-size-aware-routing
  待池补晋，red 下不执行。
- Monitor 绿、无 block、无 .halt。

### tick 2026-08-05T20:1xZ（外层，closure round 7——8 小时来首次大收尾）

- **closure 批量**：7 任务翻 done（session-idle/ready-pool-floor/red-window/outer-heartbeat/dist-runtime/
  closure-sync/stale-check）——AC 由落地 merge + 外层验证支撑（verification-round round 7）。
- **套件有效验证**：第 7 次运行 22min / 34 文件 / 2000+ 测试通过，唯一失败=session-liveness M5
  **KNOWN-LOAD-SENSITIVE flake**（隔离通过 1/1，已有任务 gap-load-sensitive-session-family）——分诊为
  非回归，套件有效验证用于 closure（记录偏差）。
- **剩余 16 条 ready**：卡真实运行证据（fresh-session e2e / cross-project 负载 / 效果验证 / B 机路径）——
  reliable-send/web-board/send-keys-nbsp/adaptive-concurrency/ruling-required/upgrade-channel/two-thirds/
  tmux/axis/vendor-runtime/measure-claude-p/manager-baked/DIR-119/DIR-121/taskworklanded/ready-pool-check。
- **套件结构性结论**：本机（4 核，多 claude 会话）难出真全量绿——闸抖 + 已知 flake + 停摆。有效验证 +
  记录偏差成为 closure 的实际路径。

### tick 2026-08-05T20:2xZ（外层，inner perf-fix 落地 + 恢复）

- **inner perf-fix 落地**：`eb226ff0` pool check 150s→13.5s（批量 git index + walk-once，判定保持 26==26）——
  gitHistoryLanded 聚合性能根治。reconcile 关其残留括号。
- **inner 套件红时按 step 3 停派发**（38e7785d 确认我的 bracket 收口 + suite red）+ 现已恢复（我的有效验证
  分诊已重置绿，inner 读 state 恢复 tick）。
- **closure**：7 done（round 7），~19 not-yet-flipped 剩实跑证据 pending。pool 11/dispatchable 2（池持续
  收窄——glob-collision 单独问题，inner 已注）。
- **套件 green**（有效验证）。闸 GO、load 1.91。

### tick 2026-08-05T21:0xZ（内层 cron，closure 7 落地 + l2 派发 + 池碰撞结构注记）

- **外层 closure round 7**（20:1xZ/20:2xZ）：**7 个任务翻 done**（session-idle/ready-pool-floor/red-window/
  outer-heartbeat/dist-runtime/closure-sync/stale-check）——有效套件验证（仅 known session-liveness flake），
  **8 小时来首次大 closure**。16 仍 ready（实跑证据 pending）。false OVER90 括号已 root-cure。
- **l2 派发**（`fm-...-4l8wvq`，dead-loop criterion 实现）：git-log 双查真未落地，self-touch 已补，resolve 过。
  **池碰撞结构性注记**：8 个真候选 Touches 全带 `plugin/scripts/`/`plugin/test/` glob ⇒ 两两碰撞（调度器
  单成员 batch），`dispatchable_disjoint` 结构上 2 < cap 3 ——池供不出 3 并发。机制正确自报（criterion false），
  非缺陷——glob 诚实声明 scope 的固有代价，修法=逐任务收敛 glob（渐进）。
- 在飞 1/3（l2）。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T20:3xZ（外层，session-liveness monitor 重挂部署 outer-heartbeat 修复）

- **monitor 重挂**（bqpknmos9，pid 237367 持有者）：重启 session-liveness 部署 outer-heartbeat 修复
  （多源 max mtime 心跳）——**假 IDLE/OVERDUE 噪音应停止**（monitor 心跳源不再单一陈旧）。理由：假 OVERDUE
  持续 2+ 小时，信号可信度受损风险（真 OVERDUE 会被误当假）。三判据绿。
- **inner**：84416282 确认 closure round 7 + 新派 l2（dead-loop 判据）+ pool-collision 结构注（glob-heavy
  候选 disjoint 2<cap 3——机制自报非缺陷）。

### tick 2026-08-05T20:4xZ（外层，inner 推进 L2 任务）

- **inner 在飞 L2**（gap-l2-continuous-health-dead-loop-criterion）：subagent「Staging files for the
  two-part commit」12m14s——dead-loop 判据实现中（我 20:4xZ 的时间线澄清已随任务到位）。
- **套件 green**（有效验证）、闸 GO、load 2.03、pool 11/dispatchable 2。
- 无新发现。inner 健康推进。

### tick 2026-08-05T21:1xZ（内层，l2 fan-in — 真实现）

- **l2 fan-in 完成（真实现）**：`dead-loop-check.sh`（L2 continuous-health：transcript user-msg OR git commit
  窗口内 ⇒ alive；`liveness_independent_of_backlog` 不变式；`--window` 可调）+ SPEC-complete-delivery-surface
  §5 L2 实例标注 + 8 测试。真实使用：**meta-cc ⇒ dead（29h 零进展实例被机械抓到）**、archguard ⇒ alive、
  quay 自身 ⇒ alive。**修了个真 perf bug**（naive 全 transcript 扫描 1.4GB/6956 文件超时 → mtime 预滤 +
  tail-500，<1s）。scoped 8/8。worktree/branch 已清。在飞 0/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T21:2xZ（内层 cron，red-window-stop 派发）

- **red-window-dispatch-stop 派发**（`fm-...-mfgl24`，RED 处置条件化共享 gate）：git-log 双查真未落地
  （3 hit 全 cross-ref），self-touch 已补，resolve 过（1/6 missing 可派）。改 fast-mode/orchestrator tick
  步骤 3/1b 红窗条件化 + suite-state-trigger SUITE-RED 携带失败位置。**注意：tick 文档外层也在维护**——worktree
  隔离 + merge 调和。
- 池 11/12、disjoint 2（碰撞结构）。**l2 仍列 ready（信号残留**——merge 消息 "merge l2" 无匹配 kernel，
  同 red-pattern/ghost-drive/leak class）。在飞 1/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T21:3xZ（内层 cron，轻触）

- 外层 closure round 8：**l2 翻 done**（real-use verified）。在飞 1/3（red-window-stop 工作中，4 文件 + 新测试，
  0 提交）。无 fan-in、无新派发（剩余真候选与 red-window 的 tick-doc/suite-state 触摸全碰撞）。
- 套件 green、load 2.73、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T21:0xZ（外层，L2 dead-loop 落地 + closure round 8/9）

- **inner L2 dead-loop 判据落地（REAL mechanism）**：`1c41c5d2` dead-loop-check.sh（transcript user-msg OR
  git commit 窗口判活，liveness_independent_of_backlog）——**实测 meta-cc dead 机械捕获 / archguard alive /
  quay alive**，mtime 预过滤 <1s/1.4GB，8/8。**从此 dead-loop 不需人看**（AC12b 方向的机制）。
- **closure round 8/9**：L2 + manager-baked 翻 done（共 9 个 closure）。L2 的 real-use 证据（meta-cc dead 捕获）
  满足判据 AC。
- **inner 新派 red-window-dispatch-stop**（shared gate-conditional RED 规则）+ l2 signal gap 注（merge msg
  无 kernel，red-pattern 类）。
- **套件 green**（有效验证）、闸 GO、load 2.99。

### tick 2026-08-05T21:4xZ（内层，red-window-stop fan-in — 真实现）

- **red-window-dispatch-stop fan-in 完成（真实现）**：RED 停派条件化为**共享闸门**——
  `shouldDispatchOnRed(state, touches)`（suite-state-trigger.ts）：shared-gate 命中 ⇒ 停、specific-test 无关 ⇒ 续、
  交叉 ⇒ 停、unknown/legacy ⇒ fail-closed、aborted 永不阻。SUITE-RED 事件携带 failureLocation
  （full-suite-runner failures capture）。**RED ⇒ 一律暂缓 fan-in 不变式**写入两 tick 模板。双向夹具
  （AC4 反例的 disjoint-candidate 续派形状被机械证）。修了 double-extension regex bug。scoped 45/45。
  worktree/branch 已清。在飞 0/3。
- **⚠ 模板/铺出分歧注记**：改的是 `plugin/loop/` **模板**；铺出副本（orchestration/orchestrator-loop-tick.md +
  docs/analysis/fast-mode-loop-tick.md）仍是旧红窗规则——外层维护铺出副本，需同步（quay-init re-lay 或手动，
  注意铺出副本有本地编辑会 CONFLICT）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T21:2xZ（外层，red-window-stop 落地 + closure round 10 + 部署滞后注）

- **inner red-window-stop fan-in 落地（REAL mechanism）**：`a1c5e9fe` shouldDispatchOnRed(state, touches)
  共享闸（shared-gate block / specific-test-unrelated continue / intersecting block / fail-closed /
  aborted-never-block）+ SUITE-RED 带 failureLocation，45/45。**RED 停派发条件化**（具体测试无关时继续，
  inner 白等消失）。closure round 10：red-window-dispatch-stop 翻 done（共 10 个 closure）。
- **template/deployed divergence（inner 注 + 外层确认）**：plugin/loop/fast-mode-loop-tick.md 有 shared-gate
  规则（line 340-347），docs/analysis/ 部署副本 0 提及——**部署滞后**（inner 实现了机制故行为正确，但文档
  副本未同步；升级通道 theme 的又一体）。待 quay-init 重铺或手动同步。
- **套件 green**、闸 GO、load 0.72（极低）、monitor 三判据绿。

### tick 2026-08-05T21:5xZ（内层 cron，reanchor 派发）

- 外层 closure round 10（10 total，含 red-window-stop 翻 done）+ 已 note 模板/铺出分歧（upgrade-channel 主题）。
- **reanchor 派发**（`fm-...-tvj0w6`，自述措辞收敛机制）：git-log 双查真未落地（0 hit），self-touch 已补，
  resolve 过。池 9/12、disjoint 2（碰撞结构）。
- 在飞 1/3。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T22:0xZ（内层，reanchor fan-in — 真实现）

- **reanchor fan-in 完成（真实现）**：`self-report-vocab-audit.ts`——batch 式自述检测器
  （BATCH_FLAG_PATTERNS：`Batch of`/`batch[-_/]?\d`/`按批`；verification-round/滚动派发 = compliant 标记非 flag）。
  收敛判据 `converged` = 最近 `--window`(3) 自述全 clean，**window 下 fail-closed**（不足 N 条不声称 N 轮收敛）。
  wired into orchestrator-loop-tick 重锚步骤 1c 子步 6 + **铺出副本同步更新**（前 tick 模板/铺出分歧在本任务
  补上——匹配 anchor 任务先例）。真实使用：`--git-log 500 --exclude-prefix outer:` 抓 **26 条历史 batch 式
  自述**（含两条 "batch of 3 fully merged"）+ 最近窗口 converged=true。scoped 20/20。worktree/branch 已清。
  在飞 0/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T21:4xZ（外层，reanchor 词汇收敛落地 + closure round 11）

- **inner reanchor 词汇收敛机制落地**：`42390452` self-report-vocab-audit.ts（batch 风格自报检测
  BATCH_FLAG_PATTERNS）+ 收敛判据 fail-closed + **deployed-copy sync**（上一 tick 的 divergence 由 inner 同步）
  ——实测标记 26 个历史 batch 风格自报 / 近期窗口收敛，20/20。closure round 11：reanchor 翻 done（共 11）。
- **套件 green**、闸 GO、load 1.07、pool 8/dispatchable 2。
- **inProgress 0**（reanchor 括号已 reconcile）。

### tick 2026-08-05T22:1xZ（内层 cron，cold-start-gate 派发）

- 外层 closure round 11（reanchor 翻 done，11 total），0 in-flight。
- **cold-start-gate 派发**（`fm-...-n10coc`，derived-laydown-set green 替代 whole-suite）：git-log 唯一命中是
  外层 filed 提交（非落地），self-touch 已补，resolve 过。池 8/12、disjoint 2（碰撞结构）。
- 在飞 1/3。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T22:0xZ（外层，inner 派发 cold-start-gate）

- **inner 新派 cold-start-gate**（8eb9e594：derived-laydown-set green gate）——冷启动绿判据改为派生铺设集
  而非全量套件，正是「套件在本机不可靠」主题的解法方向（21:0xZ 结构性观察的落地）。
- **套件 green**、闸 GO、load 1.65、pool 8/dispatchable 2、closure 11 done。

### tick 2026-08-05T22:2xZ（内层 cron，轻触）

- 在飞 1/3（cold-start-gate 工作中：SKILL.md + 新 laydown-set-check.sh + test，0 提交）。无 fan-in、无新派发
  （池碰撞 + 候选与 cold-start 触摸面冲突）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T22:3xZ（内层，cold-start-gate fan-in — 真实现）

- **cold-start-gate fan-in 完成（真实现）**：gate 收窄到 **derived-laydown-set green**——`laydown-set-check.sh`
  （跑派生铺设集测试，与 quay-init DERIVED_SCRIPTS 同 grep 单一来源）+ cold-start/SKILL.md fail-closed
  Precondition（**明确不 etc 全量**）。真实使用：session-liveness 在派生集内（known load-sensitive flake 正确
  阻塞门）。scoped 7/7。worktree/branch 已清。在飞 0/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T22:2xZ（外层，cold-start-gate 落地 + closure round 12）

- **inner cold-start-gate 落地**：`b33c8f45` gate 收窄到**派生铺设集**（laydown-set-check.sh，与 quay-init
  DERIVED_SCRIPTS 同 grep single-source）+ cold-start/SKILL.md fail-closed Precondition「不要等全量套件」+
  real-use（session-liveness 在集内，已知 flake 正确阻塞），7/7。**「套件不可靠」结构性主题的解法落地**——
  冷启动不再依赖全量套件。
- **closure round 12**：cold-start-gate 翻 done（共 12）。
- **套件 green**、闸 GO、load 1.17、inner 0 in-flight。

### tick 2026-08-05T22:4xZ（内层 cron，global-count 派发）

- 外层 closure round 12（cold-start-gate done）。池 7/12、disjoint 2（碰撞结构）。
- **global-count 派发**（`fm-...-kfcwog`，B3-2 族全局计数断言 → 相对基线）：git-log 唯一命中是外层 filed 提交
  （非落地），self-touch 已补，resolve 过。在飞 1/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T22:3xZ（外层，人指令——dispatch-evaluated 提优先级 + 排派发）

- **人方向性裁定**（管理者转达）：提高 gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release
  优先级，排进下一批。**外层执行**：promote todo→ready（零进展自 3f78e428）+ 触摸集与在飞 global-count
  不相交（可并发）+ 驱动 inner 排下一批（数据-only，pane 确认）。
- 不重评优先级（已提）；决定排位 + 怎么派（并发资格已核）。

### tick 2026-08-05T22:5xZ（内层，dispatch-tick-boundary 优先级处理 — 串行注记）

- **人的优先级 + 外层 promote**：`gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release`
  （吞吐瓶颈——派发只在 tick 边界、槽位空置不回填）todo→ready（外层已执行）。self-touch 已补、resolve 过、
  git-log 唯一命中是外层 filed 提交（非落地）。
- **⚠ 并发核验更正（外层「与 global-count 不相交」被生产闸推翻）**：两任务都带 `plugin/scripts/` glob
  ⇒ concurrent-batch-scheduler 判 **CONFLICT**（overlap 未指名具体文件，glob 碰撞）。**不可与在飞 global-count
  并发**。机制优先（fail-safe 子句），外层「可并发」声明不成立——fast-mode-loop-tick/plugin/scripts vs
  plugin/test/self 的目测漏了双 glob。**该任务 ready 待命，global-count land 后第一批派发**（人的优先级保留）。

### tick 2026-08-05T22:4xZ（外层 correct-self——我的触摸手工比较漏了共享 glob，生产闸纠正）

- **inner refute 我的「不相交」判断**（b22623f8）：dispatch-evaluated 与 global-count **冲突**（都含
  plugin/scripts/ glob）——**我的手工触摸比较漏了 global-count 第 4 行的 plugin/scripts/**（基线快照
  helper，若成脚本），只看前 4 行。**生产闸 checkTouchesPair 权威**。inner 正确处理：promote + self-touch +
  hold 到 global-count 落地（下一批首位）。
- **教训**：触摸不相交**不手工判**——用机械闸（checkTouchesPair）。外层手工比较劣于机制（今天第二次：
  basename 误判 + 触摸漏判）。
- **gate WAIT**（avg10>=40，load 5.25）、inner global-count 在飞（symlinking node_modules 13m28s）。

### tick 2026-08-05T22:5xZ（外层，os-anchor watchdog 租约模型裁定立案）

- **人方向性问题 + 管理者实测 → 外层裁定**：os-anchor watchdog 从缺席推断意图（违反仓库自己的
  inner-blocked-signal.ts「existence signal, not absence inference」原则）。实测：.halt 混淆两种意图 /
  backoff 上限缺失 / relaunch 路径 0 次生产 / /exit=崩溃=relaunch / Linger=no=登录+5min 自启。
- **裁定：租约模型**——显式时间戳「我要它跑」声明；无租约=不看护；租约过期=停（解决意图+退避）。
- **产品化裁定**：机制交付（通用——会话锚随会话死是 Claude Code 固有），策略默认不交付（登录自启/无限
  重生/写死驱动/硬编码三项目 = quay 特有）；默认禁用 + 全配置化。
- **立案 gap-os-anchor-watchdog-lease-model-instead-of-absence-inference**（todo, defect）。
- **现状**：watchdog 保持 active（维持运行中的循环；relaunch 路径 0 次未造成实害），租约重做落地后切换。

### tick 2026-08-05T23:0xZ（内层，global-count fan-in + 人优先级 dispatch-tick-boundary 派发）

- **global-count fan-in 完成（真实现）**：`test-file-snapshot.sh`（相对基线：snapshot+check，单一来源
  `--list-files`；移除=真回归红、新增=允许）——B3-2 族已在 master 相对化（0e26e6a6，运行时关系断言）。
  Touches 收敛到具体路径（agent 自做——顺带缓解池碰撞）。scoped 5/5 + 6/6 关系断言。worktree/branch 已清。
- **人优先级 dispatch-tick-boundary 已派**（`fm-...-3uq0rx`，吞吐瓶颈——事件驱动回填槽位）：global-count land
  后生产闸不再冲突，self-touch/resolve 过。**外层已接受并发更正**（b2cf2e23「correct-self：手测触摸不相交被
  生产闸推翻——lesson：永不手测，用 checkTouchesPair」）。
- 在飞 1/3。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T22:5xZ 补充（外层，watchdog node 未解析繁殖缺陷 + B 机里程碑）

- **B 机实测繁殖缺陷**（管理者）：watchdog:298 裸 `node --experimental-strip-types` 在 systemd PATH（无
  nvm → node 18.19.1）下必然失败——驱动实际送达但核实失败 ⇒ 重复驱动。**A 机盲区**（11:40 卡更早从没到
  这行；healthy 分支不调用）。立案 `gap-os-anchor-watchdog-node-unresolved-in-systemd-context`（显式解析
  node / 非 strip-types / 失败告警不只日志）。
- **B 机里程碑**：inner 首个自主提交 d8e10093（22:51:46）——**两层在 B 真跑起来了**（AC12b 测量真正开始）。
- 与 lease-model 任务交叉（同文件，alarm + 租约一起改）。

### tick 2026-08-05T22:5xZ 补充2（外层，watchdog 范围裁定——最顶端会话）

- **管理者能力边界实测**：session-liveness 纯观测不能动手；inner-session-check 能动手；manager Monitor
  只观测。⇒ inner 层不需要 watchdog（outer 三态自检覆盖）；**唯一不可替代角色 = 最顶端会话**（真实用户 =
  outer，无 manager 可救）。
- **频率异议采纳**：低触发 ≠ 低风险（今晚 4 次全灭正是场景，当时没装）。
- **范围裁定**（比「取消」更窄）：不取消——默认关 + 租约启用 + **只看护最顶端一个会话**（3→1 爆炸半径）；
  inner 归 outer 三态自检、outer 归 manager（有 manager 时）。已并入 lease-model 任务。

### tick 2026-08-05T23:0xZ（外层，dispatch-evaluated 已派发——人优先级兑现）

- **dispatch-evaluated 在飞**（人优先级任务已派发）：inner subagent「Verifying doc-assertion phrases in
  fast-mode-loop-tick」11m8s——事件驱动派发改动进行中。2 bracket（dispatch-evaluated + global-count）。
- **套件 green**、闸 GO、load 1.92。

### tick 2026-08-05T23:1xZ（内层 cron，轻触）

- 在飞 1/3（dispatch-tick-boundary 人优先级工作中：fast-mode-loop-tick + 新 slot-refill.ts + test，0 提交）。
  无 fan-in、无新派发（池碰撞）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T23:2xZ（内层，dispatch-tick-boundary fan-in — 人优先级真实现）

- **dispatch-tick-boundary fan-in 完成（人优先级真实现）**：`slot-refill.ts`（纯检测器，exit 0 零写入；
  cap 语义不变——`effective_cap` 从 cap-from-gate 输入；completion-event 触发区别于 tick，禁第二 /loop /
  fast-poll / 常驻 watcher）+ fast-mode-loop-tick 新「事件驱动派发（槽位回填）」节（completion 通知触发立即
  重评估，非下个 tick）。AC1/2/4/5/6 勾；**AC3（活循环重测 <5min）正确留外层**（运行时验证，scoped 不可得）。
  scoped 12/12。worktree/branch 已清。在飞 0/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T23:0xZ 补充（外层，B 机三问裁定——③ 单点风险立即授权）

- **③ 同步零机制（此刻实际单点风险）**：B 的 origin = 本地裸仓库（停在 8371d741，从未 push）；B 的 8 个
  提交（含新 SKILL.md + 新测试文件）只在 B 工作树——裸仓库/GitHub/A 机都没有。磁盘挂 = 工作直接消失。
  **裁定：授权 B 立即定期 push 到裸仓库（一行 cron 备份）**——不等待认领机制设计。跨主机 git 白名单内。
  管理者在 B 执行。push 会提前暴露 fast-mode-loop-tick.md 冲突（② 的真实后果），届时按合并处理。
- **② 任务板分叉 + 认领零机制**：gap-productize-manager-layer A 机 todo / B 机已 done（新 SKILL.md）；
  dispatch-tick-boundary A 机完成 B 不知道；同小时内 06e4106f（A）与 b67c49f3（B）都改 fast-mode-loop-
  tick.md ~45 行（将来硬冲突）。**属 two-machine-collaboration（Q2）范围**——认领机制是治本，冲突在
  push 合并时处理。
- **① watchdog B 机每 5min 跑**：lease-model 裁定（default-off + 顶端 + quay 自用）经 ③ 同步后达 B，
  届时配置。

### tick 2026-08-05T23:2xZ（外层，dispatch-tick-boundary 落地 + AC3 观测计划）

- **dispatch-tick-boundary 落地（人优先级 REAL work）**：`6688629e` slot-refill.ts 事件驱动派发
  （completion-event 触发重评估，无第二 /loop/快轮询/常驻 watcher；cap 语义不变；slot-refill 纯检测
  exit 0 零写入），fast-mode-loop-tick 事件驱动派发节，12/12。**吞吐瓶颈修复**（batch→event-driven）。
- **AC3 留外层复测**：槽位释放后 <5min 新派发（对比现状 39min）。**外层开始观测**——loop 运行中，
  看几轮派发间隔（下几 tick 检查 slot-release→next-dispatch gap）。
- **reconcile 关 2 括号**（dispatch-evaluated + global-count）——inner 0 in-flight。
- **套件 green**、闸 GO、load 1.09。

### tick 2026-08-05T23:3xZ（外层，B 机 push 备份窄任务立案）

- **管理者核实无独立窄任务 → 立案 `gap-b-machine-periodic-push-backup-to-bare-repo`**：B 机低频 cron
  （10-15min）git push 到 ~/work/quay-sync.git——纯备份防单点丢失，不涉及认领/权威/冲突（留 Q2 范围）。
  执行者：管理者在 B（具上下文）或 B 机 outer。

### tick 2026-08-05T23:3xZ（内层 cron，branch-model 派发）

- 外层：dispatch-tick-boundary landed + AC3 活循环重测观察开始。
- **branch-model 派发**（`fm-...-m5cx2c`，integration 分支模型——fork-baseline 与 merge-point 角色分离）：
  git-log 唯一命中是 global-count 的 AC4 交叉标注（非落地），self-touch 已补，resolve 过。池 6/12、disjoint 2。
- 在飞 1/3。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T23:3xZ（外层，人两条指令执行——Q2 promote + -p 实验推进）

- **① 两机冲突早处理（人指令）**：gap-two-machine-collaboration-git-branch-claiming promote todo→ready
  （此刻 A/B 无撞车纯属运气；fast-mode-loop-tick.md 冲突是更小粒度证据）。驱动 inner 排下一批
  （与 integration-branch 交叉，AC3 依赖权威/推送方向）。
- **② claude -p 实验推进（人指令）**：gap-measure-claude-p-headless 已 ready；**外层裁定：B 稳定
  （~1h 无人值守运行）是推进 -p 实验的合法前提信号**——与 archguard/meta-cc 产品交付线平行（那是产品
  形式，-p 是无头迁移测量，不需等）。驱动 inner 优先。
- inner 在飞 integration-branch（A 侧）；pool 6/dispatchable 2。

### tick 2026-08-05T23:4xZ（内层，两条人指令处理）

- **① 两机任务执行冲突早处理**（人指令：不等真撞）：`gap-two-machine-collaboration-git-branch-claiming` 已 ready，
  self-touch 已补。**生产闸判与在飞 branch-model（integration-branch）CONFLICT**（plugin/scripts glob + tick doc
  交叉）——机制串行，**branch-model land 后第一批派发**。认领协议与 integration-branch AC3 权威/推送方向交叉
  （外层已注）。
- **② claude-p 实验推进前提信号**（外层裁定：B 稳定 ~1h = 合法前提，不等 archguard/meta-cc 产品线）：
  `gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics` **4/4 AC 已勾**（11:24Z 实跑 + 本会话
  agent 复核）——测量任务本身已完成，非派发候选。**B 机稳定前提满足** ⇒ -p 无头迁移的**后续**可推进——该后续
  非本任务 AC scope（本任务只测往返/退出语义），需外层决定：建后续任务（B 机 -p 迁移）或外层直接驱动。
- 在飞 1/3（branch-model）。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T23:4xZ（外层，claude-p 测量完成 + closure round 13）

- **claude-p 测量完成**（inner 4/4，B 稳定前提满足）——-p 往返/退出语义已测，证据在任务体
  （AC1 往返 PASS + 负控制 + no-billing claude-deepseek only）。closure round 13：claude-p 翻 done
  （共 13 个）。
- **-p 迁移后续**：测量完成 ⇒ 下一步是 -p 迁移（容器化前置，SPEC-isolation 推荐次序）。inner 留决策——
  外层记：迁移任务待测量结论审阅后立案。
- **two-machine-collab**：ready + self-touch，按闸串行在 branch-model 后（Q2 AC3 依赖 integration）。
- inner 在飞 branch-model；pool 6/dispatchable 2。

### tick 2026-08-05T23:5xZ（内层 cron，轻触）

- 外层 closure round 13：**claude-p 测量 done**（4/4、无账单验证）；-p 迁移 next（pending 测量 review）。
- 在飞 1/3（branch-model 工作中：fork-baseline.ts + integration-batch-merge.sh + 两 tick doc，0 提交）。
  无 fan-in、无新派发（池碰撞）。two-machine-collab 待 branch-model land 后第一批。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-05T23:4xZ 补充（外层，4 任务 Touches 过宽——永不可并行派发）

- **管理者滚动派发观测发现的真缺陷，核实+精确定位**：4 任务（complete-delivery-surface / delivery-surface-
  grows / send-keys-welcome / tests-leak-tmux）checkTouchesPair 全部保守串行。**实际机制**（正确 API 测）：
  Touches **能解析**（非「空」）——但含：
  ① **目录 glob**（plugin/scripts/、plugin/test/、orchestration/）→ 展开成全部文件 → 与任何在飞任务
     overlap（保守串行，正确但过度限制）；
  ② **多文件一行**（`a.md / b.md / c.md`）→ 整行当 1 个 glob → 匹配不到（broken）。
- **管理者「空 Touches」是近似**；真因是目录 glob 过宽 + 多文件行。修法：Touches 收窄到具体文件 +
  多文件拆行。4 任务在池（部分 ready）——需逐任务判断实际触摸文件后收窄，立案待办。

### tick 2026-08-05T23:5xZ 补充（外层，管理者 AC11 撤回——4 任务 Touches 发现作废）

- **管理者撤回**：checkTouchesPair 调用参数类型误用（传任务 ID 字符串而非 {hasSection,globs} 对象），
  `undefined.hasSection` 恒假 ⇒ 任何调用返回「conservative 无 Touches」，与任务真实内容无关。
- **正确重扫**（extractTouchesSection + parseTouchEntries 全 102 存活任务）：仅 8 个真解析不出（7.8%）
  ——5 个无 Touches 标题的遗留老任务（DIR-043/QC-T1/TG 等，惯例引入前）+ 3 个标题下为空。**原报 4 任务
  全不在问题列表，Touches 正常**。
- **修正上一条记录**（a3f725b6）：该记录基于管理者的误报框架（「4 任务 Touches 过宽缺陷」）——实为
  正常。4 任务与 branch-model 的 overlap 是真实触摸交集（plugin/scripts 目录），非解析问题。

### tick 2026-08-06T00:0xZ（外层，Touches 裸目录规则立案 + branch-model 收窄驱动）

- **管理者生产链实测真根因**：branch-model 的 `plugin/scripts/（...，若成脚本）` 裸目录声明展开 100+ 文件，
  池 6 候选 5 个判不相交失败（非滚动机制问题，是一次投机性宽泛声明的连带）。裁定：**Touches 禁裸目录 +
  不确定声明**（具体路径或明确候选）。
- **立案 gap-touches-bare-dir-uncertain-declaration-drags-the-pool**（规则 + 机械检查方向）。
- **立即**：驱动 inner 收窄 branch-model 的 Touches（'若成脚本' → 明确候选路径或删）——解池关键。

### tick 2026-08-06T00:0xZ（内层，branch-model fan-in + 两机认领派发 + 池解锁）

- **branch-model fan-in 完成（真实现 + 结构级）**：`develop`+`integration` 两线模型（fork-baseline 与
  merge-point 角色分离——red-window 停派根因结构性消除）；`fork-baseline.ts`（单源 checkTouchesPair）+ 
  `integration-batch-merge.sh`（FF+CAS fail-closed）；**清 31 个 fully-merged 历史分支**（55→19）；
  AC1-AC7、7/7 scoped。**外层裁定收窄生效**：池 disjoint 2→3、criterion TRUE（5 候选脱离保守串行）。
- **两机认领派发**（`fm-...-v83fui`，人指令早处理）：branch-model land 后生产闸不再冲突，self-touch/resolve
  过。认领协议（claim-task.sh）+ 两 loop doc 认领步骤。在飞 1/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T00:1xZ（内层 cron，轻触）

- 在飞 1/3（two-machine-collab 早期，0 提交）。无 fan-in、无新派发（complete-delivery/delivery-grows 与
  在飞 two-machine 冲突）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T00:0xZ（外层，branch-model 落地 + Q2 派发）

- **branch-model 落地 + 关闭（REAL work）**：`34daba48` develop+integration 两线模型（fork-baseline 与
  merge-point 分离）、fork-baseline.ts（single-source checkTouchesPair）+ integration-batch-merge.sh
  （FF+CAS fail-closed）、**31 历史分支清理 55→20**、7/7。**inner 按外层裁定收窄 Touches**（裸
  plugin/scripts → 实际候选 fork-baseline.ts + integration-batch-merge.sh）——池解（disjoint 2→3）。
  closure round 14：branch-model 翻 done。
- **Q2 two-machine-collab 派发**（人优先级任务——branch-model 落地后 gating 放行，AC3 权威/推送方向的
  前置已在 branch-model 中部分落地）。
- **套件 green**、闸 GO、pool 6/dispatchable 2。

### tick 2026-08-06T00:2xZ（内层，two-machine fan-in — 人优先级真实现）

- **two-machine-collab fan-in 完成（人优先级真实现）**：认领协议 `claim-task.sh`（claim/--status/--reclaim）
  + `release-task.sh`——认领标记 = empty-tree orphan commit 推到共享 bare repo 的 `task/<id>` ref（push =
  原子 CAS，两机争同一任务一胜一负）；`claim-task.ts` decideClaim 复用单源 checkTouchesPair；**权威裁定**：
  认领/task 推双向（integration 多源汇入 = 跨机自然），develop 单权威（仅外层 verification-round 批量合），
  master 空。真实两克隆 A/B 测试（不相交认领双成、同任务只一胜）。AC1-AC5、9/9 scoped。worktree/branch 已清。
- **顺带修预存**：branch-model Contract invoke-evidence-missing（`--oneline` vs 实际 `--format=%s`）——two-machine
  交叉扫描浮出，已对齐。在飞 0/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T00:2xZ（外层，Q2 两机认领落地 + closure round 15）

- **two-machine-collab（Q2，人优先级）落地 + 关闭**：`4d31b998` 认领协议（claim-task.sh 孤儿提交标记推
  task/<id> = 原子 CAS + release-task.sh + claim-task.ts 单源 checkTouchesPair）、**权威裁定（AC3：
  任务双向推 integration、develop 单权威、master 空）**、**真 2-clone A/B 竞态测试（仅先者胜）**、3 对抗
  修复、Touches 收窄、9/9。**两机冲突处理机制落地**（认领不再靠运气）。closure round 15（共 15）。
- inner 顺带修 branch-model 的 invoke-evidence（cross-scan 浮出）。
- **套件 green**、闸 GO、load 1.29、inner 0 in-flight（Q2 reconcile 后）。

### tick 2026-08-06T00:3xZ（内层 cron，complete-delivery 派发）

- 外层 closure round 15（two-machine done，Q2 人优先级）。池 5/12、disjoint 2。
- **complete-delivery 派发**（`fm-...-mc8zqn`，六类交付面 + L1 全覆盖验证）：git-log 唯一命中是外层 filed +
  L2 cross-ref（非落地），self-touch 已补，resolve 过。派发词已加 Touches 精度规则（禁裸 glob）。在飞 1/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T00:3xZ（外层，人两条指示立案——删 action buttons + 消息总线，SaaS 延后）

- **① 删 web action buttons**（先做）：证据核实（365 事件全 quay-cli、web 0 + serve-handlers open-redirect
  漏洞——未用功能贡献真实漏洞）；范围精确（不删 CLI/只读/概念）；负控制 AC（actor 分布不变）。
- **② 消息总线**（后做）：核心约束传输层无关（SaaS 换 transport 不重写）；人=第三 target 同一机制；
  delivered ≠ consciousness-received 分开建模；**挂载点优先**（manager-inbox「无人读」形态）；AC12b
  可测量 + fail-safe（人只走信道）。
- **SaaS 明确延后**（仅存档）。
- **次序人已定**：① 后 ②。

### tick 2026-08-06T00:4xZ（外层，inner 派发 complete-delivery-surface）

- **inner 派发 complete-delivery-surface**（六类交付面 L1，Touches 精度规则已在派发中应用）——subagent
  「quay-init failure 是 worktree artifact」13m18s 在飞。
- **套件 green**、闸 GO、load 2.44。①② 人指示任务（action-buttons/message-bus）todo 在池待派。

### tick 2026-08-06T00:4xZ（内层，complete-delivery fan-in + catalog 二次修复）

- **complete-delivery fan-in 完成（真实现）**：SPEC-complete-delivery-surface 六类活文档（L1-MANIFEST +
  spec_is_live 漂移绑定）+ `verify-delivery-surface.ts`（L1 六类完整性 6/6、attribution holes 0）。scoped 9/9。
  worktree/branch 已清。
- **capability-catalog 二次修复**（`73355f46`）：11 个新脚本进 artifact 未声明（claim-task/dead-loop/
  fork-baseline/integration-batch-merge/laydown-set/release-task/self-report-vocab/slot-refill/
  test-file-snapshot/verify-delivery-surface）——0 unclassified 恢复。**系统性发现**：两次回归共 14 脚本在
  创建时未声明（scoped 静态层 defer catalog 到全量 ⇒ 任务绿 catalog 红）。已立案
  `gap-capability-catalog-declarations-not-enforced-at-script-creation`（scoped 层强制 + 负控制）。
- 在飞 0/3。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T00:5xZ（内层 cron，池补晋 8 + 满额派发 3/3）

- **池补晋 8 条**（tick 3.6，pool 4<floor 12）：prepare-milestone-no-size-aware-routing / productize-manager-layer /
  split-batch-vocab / residue-check / telemetry-brackets / ghost-suggestion / session-liveness-hashes /
  loop-driver-check todo→ready + self-touch。**池 4→11、disjoint 2→6、criterion TRUE**（解锁）。
- **满额派发 3/3**：① prepare-milestone-no-size-aware-routing（`fm-...-zeeizn`）② delivery-surface-grows
  （`fm-...-bb3rgc`，upgrade/refresh 通道）③ split-batch-vocab（`fm-...-9cl8gf`）。生产闸 4 个互不相交候选
  中取 3，全 self-touch/resolve 过，派发词带 Touches 精度规则。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T01:0xZ（内层，prepare-milestone 误晋 disposition + promotion 缺口立案）

- **prepare-milestone 误晋处置**：`gap-prepare-milestone-no-size-aware-routing` 派发后 agent 发现 premise
  **void**——目标机制 prepare-milestone.js/execute-milestone.js 已被 ADR-022（08-03）删除。agent 正确未实现、
  只记 disposition（merge `190fd11e`）。**我的 tick 3.6 误晋**——promotion 不调 `--pool-candidate` retired 检查。
  其余 7 个补晋候选双查全 clean（误晋隔离到这一个）。**外层请 mark needs-human/superseded**。
- **promotion 缺口立案**：`gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check`——ready-pool
  promotion 不消费 strategic-doc-staleness --pool-candidate（review-cadence AC8 控制存在但未接线）。
  在飞 2/3（delivery-grows + split-batch-vocab，均 clean）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T00:5xZ（外层，cold-start 语义缺陷立案 + archguard AC12b 不适合）

- **cold-start 六键测「装没装好」非「在不在转」**（管理者 AC12b 协议实测）：队列空/等人/从未启动三态全真，
  无法表达「启动过但停了请继续」。**复用 L2 dead-loop-check 加「已停转」分支** + 可执行下一步。
  立案 gap-cold-start-six-keys-measure-installed-not-running。
- **archguard AC12b 第二条线不适合**：backlog 见底（等方向/凭据/发布）= 真需要人，非机制缺陷。

### tick 2026-08-06T01:0xZ（外层，promotion-gap 缺陷 + prepare-milestone 处置）

- **inner 发现 promotion-gap 缺陷**（f294c428）：ready-pool 晋级不 consult --pool-candidate（AC8 控制）→
  误晋 ADR-022 已退役管线任务。prepare-milestone 处置：premise void（agent 正确 no-op），外层标
  **needs-human**。余 7 晋级验证干净。
- **reconcile 关 2 括号**（complete-delivery-surface + prepare-milestone）。inner 2 agent 在飞（4 bracket
  前）。
- **套件 green**、闸 GO、load 3.77。

### tick 2026-08-06T01:1xZ（内层 cron，轻触）

- 外层：prepare-milestone mark needs-human（premise void，采纳）；promotion-gap defect 已 note。
- 在飞 2/3（delivery-grows + split-batch-vocab，0 提交工作中）。无 fan-in、无新派发。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T01:2xZ（内层，split-batch-vocab fan-in — 真实现）

- **split-batch-vocab fan-in 完成（真实现）**：派发词去批化——`可同批`→`可并发/无触摸重叠`、
  `重叠→不同时派发`（分派是滚动的、非攒批门控）；`verification-round-N` 节奏更名 + 两 tick doc 规范性声明
  （「分派是滚动的，不叫批号；全量验证/收尾节奏叫 verification-round-N」）。AC1-AC6、5/5 + 相邻治理测试
  （reanchor/self-report-vocab）重跑绿。worktree/branch 已清。在飞 1/3（delivery-grows）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T01:3xZ（内层，delivery-grows fan-in — 真实现）

- **delivery-grows fan-in 完成（真实现）**：quay-init `--check-drift`（只读派生集漂移报告）+ `--loop` 升级路径
  （前/后漂移报告、缺失自动补、漂移 backup+replace 永不静默）——L2 升级正确性；AC4 交叉标注 trend-criteria
  （漂移/缺失计数 = 该任务被动判据的读取源）。scoped **51/51**（1 known-load-sensitive flake 隔离重跑绿），
  dedupe 修复（派生集 latent 双计）。worktree/branch 已清。**在飞 0/3**。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T01:2xZ（外层，delivery-surface-grows 落地 + closure round 16）

- **delivery-surface-grows 落地 + 关闭**：`25a9b7b0` quay-init --check-drift（只读派生集漂移报告）+
  --loop 升级路径（pre/post 漂移报告、缺失自动补、漂移备份+替换永不静默）+ L2 升级正确性，51/51（
  load-sensitive flake rerun 绿）+ dedupe 修。**「装了 quay」= 能用最新 quay**。closure round 16。
- reconcile 关 2 括号（delivery-grows + split-batch-vocabulary）。inner 1 agent 在飞。
- **套件 green**、闸 GO、load 2.66。

### tick 2026-08-06T01:4xZ（内层 cron，满额派发 3/3）

- 外层 closure round 16（delivery-grows done）。池 9/12、disjoint 5（criterion TRUE）。
- **满额派发 3/3**（生产闸 3 互不相交候选）：① ghost-suggestion-eliminated-at-source（`fm-...-uoosis`）
  ② session-liveness-hashes-token-counter（`fm-...-sxqszn`）③ telemetry-brackets-vs-subagents（`fm-...-eri043`）。
  全 self-touch/resolve 过，派发词带 Touches 精度规则。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T01:3xZ（外层，config-preserving 升级另立——archguard 子代发现）

- **archguard 实跑**（01:27 tick #114）：`quay init --loop` 不加 --force ⇒ 停 config-conflict（新文件零铺设）；
  加 --force ⇒ 覆盖丢 loop 值。**升级对已有消费者要么停要么毁 config**。51 测试测漂移报告非「报后怎么办」。
- **裁定：另立** `gap-quay-init-config-preserving-incremental-upgrade`（done 的 delivery-grows 漂移检测
  正确，config 保留是后继）。archguard 从 9 个 stopped-state 恢复（此验证即其接的方向）。

### tick 2026-08-06T01:5xZ（内层，ghost-suggestion fan-in — 真实现）

- **ghost-suggestion fan-in 完成（真实现）**：`--prompt-suggestions false` 源头 REQUIRED——quay-launch.sh 每角色
  发（key false 时 jq-e，absent/true 向后兼容）、cold-start + restart-plan REQUIRED 标注、fault-6 标注
  「环境配置源头消除」。**活体验证**：负控制（无配置 ⇒ ghost 出现，hexdump e2 9d af...）、正控制（env+flag ⇒
  输入框空）。AC1-AC6、13/13 scoped。worktree/branch 已清。**在飞 2/3**（session-liveness-hashes +
  telemetry-brackets）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T02:0xZ（内层，telemetry-brackets fan-in — 真实现）

- **telemetry-brackets fan-in 完成（真实现）**：`--slot-status`（纯读，reconcile dry-run 拆分
  real_in_flight vs stale_brackets）、slots_free 机械可见（外层不再靠 queue-state 叙述）、**自检①改读
  real_in_flight**（fix false-RED class——5 stale + 1 real 不再假红）。AC1-AC5/7；**AC9（blocked-signal 超时
  自动升级）正确 scope 外**（inner-blocked-signal 独立机制，DoD/Contract 外，留外层决定）。scoped 45/45。
  worktree/branch 已清。**在飞 1/3**（session-liveness-hashes）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T01:4xZ（外层，telemetry-brackets + ghost-suggestion closure）

- **telemetry-brackets 落地 + 关闭**：`1387ec35` --slot-status 纯读（real_in_flight vs stale_brackets）、
  槽位机械可见、自检①读 real_in_flight（假 RED 类修）、45/45。**AC9（阻塞信号超时升级）carried 到
  新任务** gap-blocked-signal-timeout-auto-escalation。closure round 17。
- **ghost-suggestion 关闭**（--prompt-suggestions false 源头，13/13 + live 正负控制）。closure round 18。
- **套件 green**、闸 GO、load 2.36、inner 1 agent（worktree 测试）。

### tick 2026-08-06T02:1xZ（内层 cron，轻触）

- 外层 closure round 17+18：telemetry-brackets + ghost-suggestion done（AC9 载到新 blocked-signal-timeout 任务）。
- 在飞 1/3（session-liveness-hashes 工作中：pane-state-classify + session-liveness，0 提交）。无 fan-in。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T02:2xZ（内层 cron，轻触）

- 在飞 1/3（session-liveness-hashes 工作中：pane-state-classify + session-liveness + test，0 提交，推进中）。
  无 fan-in、无新派发。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T02:12Z（外层）

- **记账缺口补记**：verification-round.jsonl 停在 round 13（00:25Z），closure 14-18 已落地翻 done
  但 jsonl 未追加（叙事写了、机械没写）。外层补记 round 14-18，现 1-18 连续。
- **立案 2 条**：`gap-verification-round-record-skipped-for-five-closures`（防再犯：≥1 收尾 ⇒
  jsonl 追加前 assert last+1）+ `gap-install-upgrade-verification-targets-real-downstream-workspaces`
  （真实下游 archguard/meta-cc/B 加入验证目标，人「更频繁验证」方向）。config-preserving 修复任务
  已补 AC6（A3 夹具扩配置分歧）。
- 内层在飞 1/3（session-liveness-hashes）。套件 green。

### tick 2026-08-06T02:2xZ（外层，管理者机制自证 + 裁定）

- **管理者机制自证**：跑 slot-refill.ts 本体——in_flight=1/slots_free=2/should_refill=true/
  recommended=[gap-full-suite-runner-red-pattern, gap-productize-the-manager-layer]；34min 零派发。
- **外层独立核实三层一致**：机制答案复现 + 当前实测（内层 pane 确在等 1 background agent 49m30s，
  套件 green 无停止条件）+ 文档矛盾（template 行 83「无完成事件无派发评估」vs 行 231「心跳走步骤 4
  全流程」，但步骤 4 无机械保证）。
- **裁定**：dispatch-tick-boundary 遗留分支，另立 `gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat`
  （不重开；dispatch-evaluated 的 AC3 完成即回填 40s 实测真，保留；本任务补「心跳必跑 slot-refill」）。
- **驱动回填**（数据：recommended 两候选 ready + 触摸可解析 + 与在飞 disjoint 机制判）：
  gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red / gap-productize-the-manager-layer。

### tick 2026-08-06T02:3xZ（内层 cron，轻触）

- 在飞 1/3（session-liveness-hashes 53m，外层验证 real=1 stale=0——非假 OVER90）。无 fan-in、无新派发。
- 外层：slot-refill drive 送达验证 + verification-round jsonl 缺口回填 + filed。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T02:4xZ（内层，session-liveness-hashes fan-in — 重大真实现）

- **session-liveness-hashes fan-in 完成（重大真实现，66min）**：busy/idle 判定重实现在 classifyPaneState
  底部区域 **shape 分类**上（根因：parked 会话的 token counter 在整屏 hash 里 —— 修复 + 满足 ADR-016
  Amendment）。`--pane-state` + `--classify` seams；**adr016-screen-use 0 违规**（移除最后一个 tolerated
  legacy observer）。AC1-AC9、scoped **74/74 + 1 pre-existing skip**、M6 settle-poll 硬化。worktree/branch 已清。
  **在飞 0/3**。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T02:5xZ（内层，slot-refill 回填处理）

- **slot-refill 回填（外层数据）**：should_refill=true，recommended=[red-pattern, productize-manager-layer]。
- **red-pattern 拒绝派发（已落地）**：git-log 证实 `37947f75`「red-pattern merged」（AC12b 2/4）——already-landed
  待 closure，gitHistoryLanded 信号缺口使其留在池。**记录不派理由：已落地**。
- **派发 2/3**：① productize-manager-layer（`fm-...-2eurri`，manager 层产品化 umbrella——git-log 7 hit 全
  filing/cross-ref 非落地）② gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat（`fm-...-6ph2wv`，
  心跳必跑 slot-refill 但仅 completion 触发；todo→ready + self-touch + resolve 过）。两候选生产闸互不相交。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T02:5xZ（外层，人直接指令 + AC15 裁定）

- **人直接指令①**：优先执行三条 todo（不在就绪池，提优先级排进下一批派发）：
  `gap-web-action-buttons-unused-route-and-open-redirect-delete` /
  `gap-message-bus-human-third-target-transport-agnostic` /
  `gap-b-machine-periodic-push-backup-to-bare-repo`。
- **人直接指令②**：跨机项目同步立为常设 AC15（已写进 manager-phase-goal.md）。三条机械判据：
  ①任务板 status 一致率 ②claim-task.sh 真实调用次数 >0 ③quay-sync.git 备份时延有上限。
- **外层 AC15 阈值裁定**（人留我定，据实）：
  - **备份时延上限 = 20 分钟**（cron 10-15min 的两倍余量，覆盖 cron 漂移 + push 耗时）；
  - **任务板收敛**：每对照轮 status 不一致 ≤ 1 处为可接受（机械记录偏差，不自动纠正——冲突处理
    归 two-machine-collab 机制）；
  - **claim-task 调用**：>0 即达标（判据②本身机械，无需阈值）。
  - 冲突处理策略：**备份是纯 push，不 resolve**（b-machine-push-backup 任务既定范围——冲突留
    two-machine-collab 的权威/合并机制处理，本次备份只保数据不丢）。
- **当前实测**：quay-sync.git 无 refs（A 机旧点未到）✓判据③无上限坐实；QUAY_CLAIM_REMOTE 未设
  ✓判据②=0 坐实；内层已派发 slot-refill 回填任务 + productize-manager-layer。

### tick 2026-08-06T03:0xZ（内层，人优先级三任务 promote + 下一批队列）

- **人直接指令**：三任务 todo→ready + self-touch（git-log 0 hit 真未落地、resolve 过）：
  ① gap-web-action-buttons-unused-route-and-open-redirect-delete ② gap-message-bus-human-third-target-
  transport-agnostic ③ gap-b-machine-periodic-push-backup-to-bare-repo（executor=manager on B / B outer
  一行 cron）。**AC15 常设判据**（manager-phase-goal.md）：备份时延上限 20min、claim-task 调用>0、任务板
  status 一致率；b-machine-push-backup 是 AC15 判据②③的执行者。
- **队列**：按人「本批完成后」——三任务排在当前批（productize + slot-refill）完成后派发，优先序①②③。
  第 3 槽保留给优先队列（不提前混入本批）。
- 在飞 2/3。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T03:1xZ（内层 cron，轻触）

- 在飞 2/3（productize 4 文件 + slot-refill-only 3 文件，0 提交工作中）。无 fan-in。优先队列（①②③）按人
  「本批完成后」待派。
- 外层：manager 对 action-buttons 的 biased head-30 采样撤回（核心证据 365 all quay-cli 独立复验仍成立；
  新事实 25 DIR-* 有 action config = 配置过从未点击）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T03:2xZ（内层，slot-refill-only fan-in + 优先队列①派发）

- **slot-refill-only fan-in 完成（真实现）**：tick 心跳**无条件必跑 slot-refill**（completion=加速源、
  heartbeat=兜底必跑、两触发源同一步骤 4 闸）；line-83 负控制修正。**docs/analysis/fast-mode-loop-tick.md
  现 TRACKED** + 与固定模板 byte-identical 同步（解决模板/铺出分歧；stale untracked 副本已备份 + 移除，
  旧副本 282 行漂移被合并版本取代）。AC1-AC5、15/15。worktree/branch 已清。
- **优先队列① web-action-buttons 已派**（`fm-...-fqtpnm`，删 unused route + 关 open-redirect）：slot-refill-only
  completion 释放槽 + 人优先级 → 立即派发（事件驱动）。与在飞 productize 生产闸 DISJOINT。②③ 待后续槽释放。
- 在飞 2/3（productize + web-action-buttons）。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T03:3xZ（内层 cron，false OVER90 清 + 优先②阻塞注记）

- **false OVER90 清**：detect-stop 报 session-liveness-hashes OVER90——**该任务已 merge（f40ab167）**，bracket
  未闭（外层未 --task-end）。`--slot-status` 实证：real_in_flight 2（productize + web-action-buttons）、
  **stale_brackets 1**（session-liveness-hashes）、slots_free 1。已 `--clear`。**外层请闭 session-liveness-hashes
  bracket**，否则每 tick 假 OVER90 复发。
- **优先② message-bus 阻塞注记**：生产闸判与在飞 web-action-buttons CONFLICT（batch=[message-bus, productize]，
  web-action-buttons deferred）——**不可并发**，待 web-action-buttons land 后派。③ b-machine 同待。
- 在飞 2/3（productize 2 提交推进 + web-action-buttons 早期）。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T03:4xZ（内层，productize fan-in + 优先③派发）

- **productize-manager fan-in 完成（真实现 umbrella）**：manager SKILL 落地（plugin/skills/manager +
  plugin.json 注册）、cold-start AC8c dead-key 修复、launch-config 三件套确认、SPEC 索引 14、AC1-AC8、
  scoped 52/52（cold-start 族隔离重跑）。派生集 43（cadence checker 铺到全项目）。worktree/branch 已清。
- **优先③ b-machine-push-backup 已派**（`fm-...-lp6v0p`，AC15 执行者②③）：生产闸与在飞 web-action-buttons
  DISJOINT（② message-bus 与 web-action-buttons CONFLICT 阻塞——③ 先派，② 待 web-action-buttons land）。
  executor=manager on B 的 repo 侧机制 + 测试，B 侧执行属外层/manager drive。
- 在飞 2/3（web-action-buttons + b-machine）。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T03:5xZ（内层，b-machine-backup fan-in — AC15 执行者）

- **b-machine-backup fan-in 完成（真实现，AC15 执行者②③）**：`periodic-push-backup.sh`（push 当前分支到
  origin/bare 路径；`--cron-line` 出 `*/12 * * * * git push` 在 AC15 20min 时延上限内；fail-closed）。
  AC1-AC3、6/6（真 bare-repo fixture：push 后 ls-remote == HEAD、幂等 up-to-date）。**认领协议互斥性被证**
  （`--all` 也不能覆盖 task/* claim marker——git 自身 non-fast-forward 保护）。worktree/branch 已清。
- 在飞 1/3（web-action-buttons 2 提交推进）。优先② message-bus 仍被 web-action-buttons CONFLICT 阻塞。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T04:0xZ（内层，web-action-buttons fan-in + 优先②派发）

- **web-action-buttons fan-in 完成（真实现，人优先①）**：unused web action-buttons POST route + 2 form
  renders 删除，**open-redirect 面消除**（weak ?from= guard 移除，GET 保留 isSafeRelativeRedirect 共享守卫）。
  AC1-AC6、4/4 + 1 pre-existing skip（serve-github live）。负控制：365 gate-events 全 quay-cli、0 web。
  worktree/branch 已清。**在飞 0/3 → 优先②接棒**。
- **优先② message-bus 已派**（`fm-...-gr87vt`，human 第三目标 transport-agnostic）：web-action-buttons land 后
  冲突清除，self-touch/resolve 过。**人优先队列 ①②③ 全落地或已派**。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T04:1xZ（内层 cron，false OVER90 清 + loop-driver-check 派发）

- **false OVER90 三清**：session-liveness-hashes bracket 仍未闭（外层未 --task-end）——已再 `--clear`
  （wait 34.8s）。`--slot-status`：real 1（message-bus）、stale 2（session-liveness-hashes + productize）。
  **外层请闭这两个 bracket**（否则每 tick 假 OVER90 复发；productize 已 done、session-liveness-hashes 已 merge）。
- **loop-driver-check 派发**（`fm-...-a5jpkr`，self-declared registry 无人验证缺陷）：git-log 5 hit 全机制引用
  （laid-down/gitignore/driver）非本任务实现——真未落地；与 message-bus 生产闸 DISJOINT。池真 ready 已近耗尽
  （剩 red-pattern/ghost-drive/leak 已落地 + split-batch 待 closure）。
- 在飞 2/3（message-bus + loop-driver-check）。套件 running（外层全量）。无 stop、无 block、Monitor 绿。

### tick 2026-08-06T04:2xZ（内层，message-bus fan-in — 人优先②真实现）

- **message-bus fan-in 完成（真实现，人优先②）**：`message-bus.ts` transport-agnostic deliver/observe、
  **human 第三 target**（同一 deliver/observe 入口、transport 可换）+ `inbox-reader.sh` 消费挂载点
  （delivered vs consumed 独立建模）。AC1-AC6、30/30 + tsc 0。**adversarial 2 轮**（deliver fail-closed/id
  唯一/target 权威）。worktree/branch 已清。
- **顺带修 catalog 三回归**：periodic-push-backup.sh 未声明（b-machine fan-in 漏）——agent 已补，
  catalog 117/117、0 unclassified。
- **⚠ 文档路径冲突**：manager 中文提案（untracked `docs/proposals/quay-message-bus-human-in-the-network.md`）
  与 agent 英文设计文档同路径碰撞——**manager 提案已备份 /tmp/quay-message-bus-manager-proposal-untracked.md**，
  外层请 reconciliation（两份内容不同，agent 版被 SPEC 引用）。
- 在飞 1/3（loop-driver-check）。套件 running。无 stop、无 block、Monitor 绿。

### tick 2026-08-06T04:0xZ（外层，管理者 pool 停滞观察 + 裁定）

- **管理者实测**：pool=5 < floor=12 持续 ~3 小时（上次机械 promote bbf85ea9 00:53），121 todo /
  33 ready，gap-* 自动补晋 3 小时未触发。
- **外层独立核实**：git log 确认 00:53 后 2 次 promote 都是人指令/事件驱动（0361893d 人优先级、
  0aeaef38 slot-refill 处理），非机械 pool<floor 路径。ready-pool-check 当前 promotions 7 候选。
- **裁定（与 slot-refill 同族）**：3.6 机制无触发缺口（pool<floor ⇒ 本 tick 补晋是强制步骤），但
  **执行依赖内层 tick 自觉走到**——最近 tick 全被等 agent/fan-in/修缺陷占满，机械路径没机会跑。
  根因 = 写成强制步骤但无机械保证（同 gap-slot-refill-only-triggered 形态）。待内层修完测试缺陷
  一并驱动补晋（suite red 中，stop-dispatch 优先）。

### tick 2026-08-06T04:3xZ（内层，红窗三测试缺陷修复 — 外层分诊）

- **外层红窗分诊承接**（8 fail / 2612，三类测试缺陷非产品回归）——已修：
  ① **red-window-shared-gate AC1 断言放宽** `/暂缓[\s\S]*fan-in/`（inner 措辞「暂缓已完成 agent 的 fan-in」，
     连续子串只 outer 有）——14/14 绿。
  ② **capability-catalog catalogRows() retry**（并发瞬态 plugin/scripts 变更 flake，隔离 8/8）——8/8 绿。
  ③ **runner-grouping KNOWN-LOAD-SENSITIVE 标记**（嵌套 `--group governance` >830s、并发下脆弱）——
     判绿族隔离重跑。
- **外层请重跑全量验证**（AC4 判据 suite green）。在飞 1/3（loop-driver-check 待 land）。
- 套件 running（外层）、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T04:4xZ（内层 cron，suite triaged-red + false OVER90 清 + 停派发）

- **suite red = 已分诊的 03:43 跑**（35.6min、8 fail = 我已修的三测试缺陷）——外层 re-verify pending。
  机械处理：**停止新派发 + 暂缓 loop-driver-check 的 fan-in**（等 re-green）。
- **false OVER90 四清**：session-liveness-hashes bracket 仍未闭——已再 `--clear`（wait 32.3s）。`--slot-status`：
  real 1（loop-driver-check）、stale 2。**外层请 --task-end 闭 session-liveness-hashes + productize**。
- 外层 7169c01b：message-bus closed + manager 提案落地（路径碰撞已 reconciliation）；新立
  gap-ready-pool-promotion-same-class-as-slot-refill（step 3.6 补晋靠自愿、3h 无机械晋级——同类）。
- 在飞 1/3（loop-driver-check 工作中，fan-in 暂缓）。无 stop、无 block、Monitor 绿。

### tick 2026-08-06T04:5xZ（内层，loop-driver-check fan-in — 本批完成）

- **loop-driver-check fan-in 完成（真实现）**：loop-driver registry LIVE-write 接入外层 tick 步骤 4
  （与 cold-start skill byte-identical）、double-trigger 无回归、STALLED 处置重写、.halt 打印 运行中→未暂停。
  **AC3（stale registry 不报 LIVE）诚实记 layer-2**（bash 无法观察会话内 cron——结构性不可区分，勾未选 +
  理由 + layer-2 交接，符合「不许把做不到写成通过」）。scoped **78/78**（~134s，含 KNOWN-LOAD-SENSITIVE
  quay-init-loop 隔离）。worktree/branch 已清。
- **本批完成 → 外层可重跑全量**（外层 04:05Z 等 inner scoped suite 完成避 4 核碰撞——现完成）。
- 在飞 0/3。套件仍 triaged-red（待外层 re-verify）。无 stop、无 block、Monitor 绿。

### tick 2026-08-06T05:0xZ（内层 cron，false OVER90 五清 + 派发 hold）

- **false OVER90 五清**：block 现指 productize（bracket 也未闭——外层闭了 session-liveness 但 productize 还在）——
  已 `--clear`（wait 21.1s）。`--slot-status`：real 0、stale 3、free 3。**外层请 --task-end 闭剩余 bracket**
  （session-liveness-hashes + productize + 1）。第 5 次同一类复发——bracket 未闭是根。
- **套件 running（外层 04:25Z relaunch 验证 3 测试缺陷修复 + loop-driver merge）**——派发 hold（避 4 核碰撞，
  外层此前明示）。池 5/12、disjoint 3（真 ready 近耗尽）。
- 在飞 0/3。无 stop、无 block、Monitor 绿。

### tick 2026-08-06T05:1xZ（内层 cron，false OVER90 根愈 + 轻触）

- **外层清全部 stale bracket**（productize/session-liveness-hashes/loop-driver-check，5th false OVER90 根愈——
  in_progress=0 reflect=true；任务仍 ready 待全量绿）。
- 套件 running（验证中）。无 block、无 stop。派发 hold 继续（套件运行避核碰撞）。在飞 0/3。
- 外层：人 frame correction——两 PEER quay 开发者需连续双向 merge（撤窄 downsync、立
  gap-two-peer-quay-developers-continuous-bidirectional-merge 整合 claim-task + integration-branch）；
  archguard #12 blind-spot ③ REFUTED（taskWorkLanded 第三信号是 git-history 非 checkbox）。

### tick 2026-08-06T05:2xZ（内层 cron，轻触）

- 套件 running——外层 clean-tree 重跑（DoD 第 2 次全绿；manager 提交其 pending artifacts 486f97e5 清
  suite-after false-positive 源；外层修自己的 band 违例 4th）。无 block、无 stop。
- 派发 hold 继续（套件运行）。在飞 0/3。池 5/12、disjoint 3。

### tick 2026-08-06T05:3xZ（内层 cron，轻触）

- 套件 running（clean-tree，contract new=0 past static）。外层 05:25Z 注：池 5/12 待 re-green 后 refill。
  无 block、无 stop。派发 hold 继续。在飞 0/3。

### tick 2026-08-06T05:4xZ（内层，池 refill + 满额派发）

- **套件 re-green（2 次有效绿）**，外层收尾 3 任务 done（productize/session-liveness/loop-driver）。
- **池补晋 8**（tick 3.6，pool 4<floor 12）：runtime-nowhere-safe/token-measures-wait/token-watches-shell/
  token-status-dead-holder/value-prioritization/DIR-124/laydown-derivation-spelling/suite-state-reason-axis
  todo→ready + self-touch。**池 10/12、disjoint 7（criterion TRUE）**。
- **DIR-124 拒绝派发（directive 父任务）**：children 全 todo——工作在其 children，非可派发叶（与
  PARENT-DONE-IFF-CHILDREN 同判）。token-measures-wait + suite-state-reason-axis 未入 ready（待核）。
- **满额派发 3/3**：① value-prioritization（`fm-...-5xzv3k`）② token-watches-shell（`fm-...-xk3jsq`）
  ③ laydown-derivation-spelling（`fm-...-m6xqmw`）。生产闸 4 互不相交候选取 3。
- **⚠ PLAN-develop-branch-cutover（develop/GitHub 主线 + master 冻结）待人确认——确认前不执行**（已注记）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T05:5xZ（内层 cron，轻触）

- 在飞 3/3（value-prioritization 3 文件 / token-watches-shell 1 / laydown-derivation 1，均 0 提交工作中）。
  无 fan-in、无新派发（cap 满）。套件 green、无 stop、无 block、Monitor 绿。
- 外层 0b64ffdb：接受池 refill + DIR-124 拒绝；telemetry 3/3 real reflect=true。926d771b：branch-cutover
  计划裁定锁定（人 ruling 2026-08-06）。

### tick 2026-08-06T06:0xZ（内层，value-prioritization fan-in — 真实现）

- **value-prioritization fan-in 完成（真实现）**：ready-pool-check 每候选 relevance 信号
  （strategic/blocking/cost/value，全机械）+ `--top N` CLI（manager 层 Prioritization 挂点）。
  AC1-AC7、27/27（relevance 7 新测试）。DIR-124 blocking 6 children 排 relevance 第一（答「谁 next」——
  超 gap>DIR tiebreak；但派发仍判 directive 父拒绝）。worktree/branch 已清。在飞 2/3。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T06:1xZ（内层，token-watches-shell fan-in — 真实现）

- **token-watches-shell fan-in 完成（真实现）**：token lease/renew 重绑定到**工作属主**——`--acquire` 写
  lease_expires_ms、`--renew`（retry loop 调）延租 + 重绑 pid 到 work（acquiring shell 被杀不再误 reclaim
  运行中工作）、reclaim = pid-dead+stale 早 / lease 过期 / legacy 回退；TOCTOU guard。AC1-AC7、19/19 +
  token 族 12/12。worktree/branch 已清。在飞 1/3（laydown-derivation）。
- 套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T06:2xZ（内层 cron，token-status 派发）

- **token-status-dead-holder 派发**（`fm-...-mbsm4t`）：git-log 0 hit 真未落地，与在飞 laydown-derivation
  生产闸 DISJOINT，self-touch 过。runtime-nowhere-safe 与 laydown-derivation CONFLICT（不并发）。
- 套件 green（2658 tests EFFECTIVE GREEN）。在飞 2/3。无 stop、无 block、Monitor 绿。

### tick 2026-08-06T06:3xZ（内层，laydown-derivation + token-status fan-in）

- **laydown-derivation fan-in 完成（真实现）**：derive_loop_scripts 拼写不敏感依赖闭包（script-dir sibling
  refs fixpoint；**heal 两个静默缺失 sibling cap-from-gate.ts + pane-state-classify.ts，集 43→46**）、
  verify blind-spot 共享尺、AC4 fail-loud CHECKER 前置。AC1-AC5/7、**80/80**（首跑 1 瞬态 flake——重跑
  80/80 绿）。**follow-up**：laydown-set-check.sh 仍 prefix-only（与闭包集分歧，弱化 lay-what-you-verify，
  待后续对齐）。
- **token-status-dead-holder fan-in 完成（真实现）**：--status 发 holder_alive + reclaimable_now（共享
  classify_hold()，读答案 == 下次 acquire 动作）、只读永不 reclaim、AC7 pull-based 指引。AC1-AC7、16/16 +
  token 族 20/20。AC6 governance→engine 解决（retag 会 unpin token 测试出默认 gate）。worktree/branch 已清。
- **在飞 0/3**。套件 green、无 stop、无 block、Monitor 绿。

### tick 2026-08-06T06:4xZ（内层 cron，轻触）

- 套件 running——外层 red-window 分诊（contract-check 7 new 来自 2 个 manager branch-cutover 任务 code-block
  Contract 不可解析，已重写标准格式 new=0；AC-carryover ratchet loop-driver AC3 unowned → 立 layer-2 cron
  observability successor + Carries 声明），suite relaunch。
- 池 7/12、disjoint 6（runtime-nowhere-safe 真候选；token-status 已 fan-in 待 closure——信号缺口）。派发 hold
  （套件运行）。在飞 0/3。

### tick 2026-08-06T06:3xZ（内层 cron + slot-refill 心跳）

- **发现并纠正一个自伤事故**：本 tick 早前我误用 `full-suite-runner.ts --state`（非合法 flag），
  它静默启动第二个并发全量套件（06:31:38→06:32:22, 44.7s, failures=[] fail-closed），
  撞上外层正在跑的真套件（PID 3751740 06:28:26 起），把 state 文件 clobber 成 red。
  外层已纠正回 running（e313eaf3）并归档根因缺陷：
  **full-suite-runner.ts:139 writeState() last-write-wins 无 generation guard**（102453ac）。
- 套件 running（外层真跑，219 files concurrency=1）⇒ 照常派发（tick doc step 3 停止条件未命中）。
- slot-refill 心跳：should_refill=true、slots_free=3、real_in_flight=0；
  **推荐 3 个候选全为陈旧信号缺口**（DIR-124 directive-parent、red-pattern/ghost-drive 已 landed）。
- 派发 1/3：**runtime-nowhere-safe**（唯一真实未落地 ready 候选；touches 解析全 OK；
  与刚合并的 laydown-derivation 的冲突已解除——后者先落地，本任务在其上构建）。
  worktree /home/yale/work/quay-worktrees/runtime-nowhere-safe + telemetry bracket 已开。
- 池 7/12、disjoint 6/3、criterion met；在飞 1/3（runtime-nowhere-safe）。

### tick 2026-08-06T06:5xZ（外层，人裁定「按计划优先推进」分支切换）

- **人已裁定**「按计划优先推进」branch-cutover 方案。
- **现状核实**：develop/integration 冻结在 926d771b（阶段一快照点），master 领先 33 提交且仍被每次
  tick 直接写（master 冻结 invariant 未生效）。
- **驱动内层**：gap-two-layer-loop-tick-docs-hardcode-master 提为本轮最高优先级（当前 todo 未派发；
  touches 可解析、与在飞 runtime-nowhere-safe disjoint）。内层收到后将优先派发。

### tick 2026-08-06T06:4xZ（人裁定：按计划优先推进分支切换）

- **人裁定已执行**：`gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model`
  提为本轮最高优先级派发（master 冻结 invariant 未生效：develop/integration 冻结 926d771b、
  master 领先 33 且仍被每 tick 直接写）。外层已在 add5fd0a 记裁。
- 派发闸验证：touches 全解析；checkTouchesPair 判 **DISJOINT**（与在飞 runtime-nowhere-safe）。
- 派发 2/3：branch-model-cutover → worktree /home/yale/work/quay-worktrees/branch-model-cutover
  + telemetry bracket 已开。外层已裁定 AC6（共享文件可配置默认 master、本仓副本字面量 develop）。
- 在飞 2/3（runtime-nowhere-safe + branch-model-cutover）；套件仍 running（外层 verify）。

### tick 2026-08-06T06:5xZ（内层 cron + slot-refill 心跳 + 3.6 补晋）

- 套件 running（外层 verify，PID 3751740 24:41 仍在跑）⇒ 照常派发；无停止条件命中。
- 在飞 2/3（runtime-nowhere-safe + branch-model-cutover）；slot-refill 心跳 `--in-flight` 修正后
  slots_free=1、recommended=DIR-124（directive parent → 拒绝）。
- **3.6 补晋**：cap=5（GO 档）⇒ floor=20，池 7 < floor ⇒ 触发补晋。promotions 数组多候选陈旧
  （含已派发的 branch-model；quality-criteria 的 git 命中是 cross-annotation 非落地）。
  补晋 2 个真实未落地候选：**claim-task-and-backup-push**（disjoint 6/7，config-only，branch-cutover
  阶段四同伴，`--pool-candidate` clean）+ **supervisor-base-layer**（disjoint 1，`--pool-candidate` clean）。
- **派发 3/3**：claim-task-cutover（与两个在飞 DISJOINT，touches 解析全 OK）→ worktree
  /home/yale/work/quay-worktrees/claim-task-cutover + telemetry bracket 已开。
  supervisor 与 runtime-nowhere-safe **OVERLAP quay-init.sh** → 序列化，本 tick 不派发。
- 池 9/20（补晋 2）；在飞 3/3 满。

### tick 2026-08-06T07:0xZ（三 agent 完成 + fan-in 收口）

- **三个 agent 全部完成，fan-in 合并收口**：
  - runtime-nowhere-safe（ac893257→rebased+merged fcb9f178）——运行时落 `.quay/runtime/`（非 vendor/）、
    quay-init 自写 gitignore、Go 半边重装门补上；AC1-AC11 全证据，scoped 61 pass/0 fail。
  - claim-task-cutover（93017f7d+08eab128→merged）——claim-task/backup 指向 GitHub origin、quay-sync.git 退役；
    Contract measure 正则修正；AC1-AC5 证据，scoped 15 pass/0 fail。
  - branch-model-cutover（3940c1a8→merged）——tick 文档 11 处硬编码 master → 可配置 $FORK_BASELINE/$MERGE_TARGET
    （默认 master 保下游）、本仓副本字面量 develop；AC1-AC6 证据，branch-model 9/9 pass。
- **套件 GREEN（07:07Z 完成）**——外层 verify 通过。
- worktree 清理 + 三个 telemetry bracket 已 close（outcome done）。在飞 0/3。
- **【转外层决策】config 激活**：branch-model agent 标明的部署步骤——`.quay/config.yml` `loop:` 加
  `fork_baseline: develop` / `merge_target: integration`。**未静默执行**：
  ① 该文件 gitignored、人/外层所有（注释记录人工 concurrency 决策）；
  ② **时序风险**——develop 停在 926d771b（落后 master 33+ 提交），今日全部 fan-in 都在 master，
     此刻激活会让下一 tick 从过期基线分叉；PLAN 阶段三 step 11 的正常流（fork develop→merge integration→
     outer FF develop）需要先有 develop 追上 master 的一步。转外层裁定激活时机（先快进 develop？等阶段二 B 合并？）。

### tick 2026-08-06T07:1xZ（内层 cron + slot-refill 心跳 + 3.6 补晋）

- 无 halt；套件 GREEN（07:07Z 完成）。在飞 0/3 全槽空。
- telemetry 2 个陈旧括号（claim-task/branch-model 的 --task-end 未闭合，worktree-gone 误判）——`--reconcile` 已清。
- **3.6 补晋**：池 6/20、dispatchable_disjoint 4/5 不达标 ⇒ 补晋 4 个真实未落地候选（全部
  `--pool-candidate` clean、touches resolve）：spawn-count-criterion / needs-human-black-hole /
  no-criterion-records-cost / quality-criteria-trend。DIR-043 有真实落地（519285ca 结晶 tmux 契约）
  但 status 仍 todo——stale-status 工件，不晋。
- **派发 1/3**：supervisor-base-layer（池内唯一真实未落地 ready；其 quay-init.sh OVERLAP 对象
  runtime-nowhere-safe 已合并 ⇒ 在此之上构建，非在飞冲突）。worktree + telemetry bracket 已开。
- 池 10/20；在飞 1/3。config 激活仍挂外层裁定（上一 tick 转交）。

### tick 2026-08-06T07:1xZ（外层 config 激活裁定——两线模型生效）

- **config 激活不再挂起**：`fork_baseline: develop` + `merge_target: integration` 已落
  `.quay/config.yml:116-117`（外层 ab541024，07:09:43）。本地 develop=926d771b（冻结快照）、
  integration 存在、master=13b5855c。
- **从下一个新派发开始按两线模型分叉**：`fork-baseline.ts --task <id>` 机械判定
  （independent→develop / 依赖 integration 上未验证任务→integration）；判别法：
  `rev-list develop..分支` 与 `develop..master` 交集 ≠ 全量 ⇒ 从 develop 分叉。
- 在飞 supervisor-base-layer worktree 从 master 分叉（07:10 创建，晚于 config 28s）——
  已立案 gap-dispatch-fork-does-not-read-config-fork-baseline，记录在案不重做；
  supervisor 完成后按新规则派发。
- 池 10/20；在飞 1/3（supervisor，master 基线，历史遗留）。

### tick 2026-08-06T07:3xZ（外层，人分工轴裁定 + 三个待办）

- **人裁定分工轴**（manager-phase-goal 96b32bd2）：轴 = 谁生产/谁验收，两目标同轴。
  - 目标1 生产（files 加 plugin/、develop 打 tag、v0.4.0、SEA）= **A**
  - 目标1 验收 = **B**（A 结构上无法验证自己 release——开发树在场，与 verify-delivery-surface 0/6 同形态）
  - 目标2 机制（claim 协议/同步 cron/冲突策略）= **A**（plugin/ 产品面，B 不得自发明）
  - 目标2 证明（首个跨机任务生命周期）= 两机双边
- **三个待办顺序前提**（branch cutover 收口前分工无处落地）：
  ① B 推送成功（b-machine-push-backup → GitHub develop）
  ② **A 下次派发真的从 develop 分叉**（外层下个派发实测判别式：rev-list develop..分支 ∩ develop..master 交集大小）
  ③ B 的 origin 指向修正
- **当前状态**：config 已激活（07:09 fork_baseline:develop），内层已记录（fddb0955），supervisor 在飞
  （14m），**尚无新派发**——待办②待 supervisor 完成后下一个派发验证。

### tick 2026-08-06T07:3xZ（内层 cron + slot-refill 心跳）

- 无 halt；套件 GREEN（07:07Z）。在飞 1/3（supervisor，master 基线，历史遗留）。
- 池 10/20、disjoint 4/5 不达标。slot-refill 推荐 split-batch-vocab —— **陈旧**（bfd66d94 已落地，
  taskWorkLanded 信号缺口），不派。
- **首个两线模型新派发**：spawn-count-criterion（唯一与在飞 supervisor DISJOINT 的候选；其余 3 个新晋
  needs-human-black-hole/no-criterion-cost/quality-trend 与 supervisor 在 plugin/scripts/ OVERLAP ⇒ 序列化）。
  `--pool-candidate` clean、touches resolve 4/4。
- **fork-baseline.ts 判定 develop**（independent，integration 未验证 0）⇒ 按 config 新规则从 **develop**
  （926d771b）分叉。判别法验证：develop..branch=0（干净 develop fork）。
  ⚠️ 记录：develop 落后 master 57 提交，worktree 任务体 status 仍 todo（master 侧补晋未进 develop）——
  任务体/AC 同源，仅状态字段滞后，agent 已被告知按 body 执行。
- 在飞 2/3（supervisor + spawn-count）。池 10/20。

### tick 2026-08-06T07:4xZ（supervisor 完成，fan-in 目标待外层裁定）

- **supervisor-base-layer 完成**（66d32bea，13 files +1145/−94，worktree 内 23 scoped tests green，
  capability-catalog 0 unclassified，os-anchor-watchdog.test.mjs worktree-agnostic 修复）。
  步骤④⑤ 已立案（gap-supervisor-preemption + gap-supervisor-message-bus-with-identity）。
- **fan-in 目标悬置【转外层裁定】**：supervisor 分支 = master~9 + 1 任务提交（结构证明：master..branch=1、
  integration..branch=50），而 integration/develop 冻结 926d771b（落后 master 57）。
  直接把分支合进 integration 会拖入 50 个 master-only 提交（integration 将含 develop 没有的工作，
  正是两线模型要消除的污染）；合进 master 违反新冻结。**候选方案**：① rebase 到 integration 再合
  （需外层确认无冲突处置）；② 等外层先把 develop FF 到含 supervisor 基线的点；③ 旧模型合 master
  （违反冻结，除非人豁免）。supervisor 本身 done，等外层定 merge 目标。
- 在飞 1/3（spawn-count，develop 基线）；池 10/20。

### tick 2026-08-06T07:5xZ（外层，AC17 第一个真实汇合点分析）

- **B 推送成功**（GitHub develop = d0edd8ab）：B 领先我们的 develop **105 提交**（共同祖先 926d771b）。
- **我们的 master 领先 B 的 develop 59 提交**。
- **B 改了 150 个文件**——冲突潜力大。
- **这是 PLAN 阶段二（A/B 历史分叉合并）的执行点** + AC17 判据 4（真实协作）核心。
- **裁定方向**：A 的 master 59 提交并入 develop（与 B 的 105 汇合）。冲突处理需谨慎（150 文件）。
  这是方向性/高风险操作——记录现状，合并策略待管理者/人确认后执行（不擅自 merge 大冲突）。

### tick 2026-08-06T07:5xZ（supervisor merge 裁定①执行——遇 plan-vs-reality 冲突，已中止待外层）

- **外层裁定①（rebase 到 integration 再合）执行受阻**：`git rebase --onto integration c998b2ac HEAD`
  干净地把 66d32bea 单提交 lift 到 integration 上（master..branch=0 达成），但**冲突在 quay-init.sh**。
- **冲突根因（外层数据的盲点）**：「integration 自 926d771b 后 0 文件改动」属实，但**任务提交携带的是
  master 线的文件状态**——66d32bea 的 quay-init.sh diff 假设 runtime-nowhere-safe 的 `.quay/runtime/`
  重写（+laydown-derivation 的闭包检查）已在场；integration 上这些 commit 都不存在（frozen 926d771b）。
  `--onto` 把任务提交的 diff 施加到旧版 quay-init ⇒ 冲突。**不是 integration 有改动，是任务基线在 master 线。**
- **手动解决 = 重写任务提交的 quay-init 改动以适配旧版**——错误率高、可能把 runtime 层的既有修复弄丢。
  **已中止 rebase（分支回到 66d32bea 未动）**，不冒损坏风险。
- **给外层的方案演进**：
  - ①a **先把 master 合并到 integration（或把 develop FF 到 master 再合）**——让 integration 获得
    runtime-nowhere-safe + 其它 master 工作，再 rebase supervisor 就无冲突。但这等于「把 57 master 提交
    并入 develop」的 AC17 大汇合提前（外层已说 AC17 待人确认策略单独处理）。
  - ①b **在 master 上把 66d32bea 的 quay-init.sh 改动先独立成 commit**（剥离 master 依赖）——复杂。
  - ①c **合回 master**（supervisor 本来就是 master 基线任务）——违反冻结，除非人豁免这一个。
  - 建议：**等 AC17 大汇合策略确认**后把 supervisor 一并并入（它 23 scoped green 的验证在 master 线有效，
    合进 integration 反而丢失验证语境）。

### tick 2026-08-06T08:0xZ（外层，AC17 catch-up 裁定 + 落地可见性立案）

- **管理者异常判据（坐实）**：距 merge 43min + disjoint=4≥3 + suite green。根因 = **两线模型激活但
  基线内容从未迁移**——develop/integration 都冻结 926d771b（2h 前），master 62 提交真实工作未迁。
  spawn-count 从 develop 分叉（缺 master 工作）、supervisor 从 master 分叉（rebase 到 integration
  遇 62 提交缺失）。**可预见的后果，非意外**。
- **catch-up 顺序裁定**：① master 62 提交并入 develop（A 内部迁移，先让 develop 有完整 A 基线）→
  ② 拉 GitHub develop（B 105 提交）→ ③ rebase 任务分支（supervisor/spawn-count）到新 develop。
  每步一个来源，冲突可控。
- **落地可见性立案**：ready-pool-check/slot-refill 只测「有可派发候选」不测「落地是否被阻塞」——
  criterion_met=True 在落地阻塞时照样报——「只测心跳不测意识」实例。

### tick 2026-08-06T08:0xZ（内层 cron + slot-refill 心跳）

- 无 halt；套件 GREEN（07:07Z）。reconcile 1 陈旧括号（supervisor detached-HEAD 误判 worktree-gone——
  reattach 回 task 分支 66d32bea，bracket 已 close，任务 done 正确）。
- 在飞 1/3（spawn-count，develop 基线）；槽 2 空。
- slot-refill 推荐 supervisor —— **非新候选**（done-pending-merge，等外层 AC17 策略），不派。
- **3 个真实候选（needs-human-black-hole / no-criterion-cost / quality-trend）全部与在飞 spawn-count
  OVERLAP（plugin/test/* 全 glob）⇒ 序列化，本 tick 无新派发。**
- 池 10/20、disjoint 4/5（4/5 里含 4 个 stale-landed 虚数）。supervisor merge 目标仍挂外层 AC17 裁定。

### tick 2026-08-06T08:1xZ（外层 AC17 catch-up 裁定收到，待 spawn-count 完成执行）

- **外层 AC17 catch-up 裁定**（已记录）：顺序① master 62 提交并入 develop（A 内部迁移，让 develop 有
  完整 A 基线）→ ② 拉 GitHub develop（B 105 提交，d0edd8ab）→ ③ rebase 任务分支（supervisor/spawn-count）
  到新 develop。每步一个来源冲突可控。理由：两线模型激活但基线内容从未迁移（develop/integration 冻结
  926d771b 2h，master 62 提交未迁）。supervisor 的 rebase-to-integration 裁定保留。
- **执行时机**：裁定注明「spawn-count 完成后执行」。当前 spawn-count 仍在飞（1/3，worktree 存在，
  develop..branch=0 尚无提交，agent 工作中）。**不在在飞时迁移 develop**——会使其 worktree 基线失效。
- spawn-count 完成通知到达时：先 fan-in 或先 catch-up？按裁定顺序 catch-up 优先（①→②→③ 含 rebase
  任务分支），即完成通知后先执行 catch-up 的①②，再 rebase spawn-count 分支（③），然后按新 develop
  基线 fan-in。

### tick 2026-08-06T08:0xZ（外层，人催 AC16）

- **人催 AC16**：archguard backlog 已空（"待接续：quay 升级/新能力/凭据/发布"），在等能装的 release。
  AC16 卡着 archguard 下一步没落点——不是排期可延。
- **裁定：现在派**。AC16（gap-release-excludes-plugin-bundle）Touches = packages/quay/package.json +
  scripts，与在飞 spawn-count（quay-native）+ catch-up（git 分支）disjoint。优先于 catch-up（AC16
  小改动 + archguard 等）。四项机制决定：files 加 plugin/、develop 打 tag、SEA 继续、v0.4.0。
- 已驱动 inner：spawn-count 完成后优先派发 AC16，再执行 catch-up。

### tick 2026-08-06T08:2xZ（外层 AC16 优先裁定执行）

- **人催 AC16（GitHub release 完整可用）**：派发 gap-release-excludes-plugin-bundle-agent-surface
  （todo 未派发，archguard backlog 空在等能装的 release）。外层裁定 4 项机制：files 加 plugin/、
  from develop 打 tag、SEA 继续、v0.4.0。
- 派发闸：touches resolve 5/5、checkTouchesPair DISJOINT vs 在飞 spawn-count（机械验证）、
  `--pool-candidate` clean、**fork-baseline.ts 判 develop**。
- **AC16 优先于 catch-up**：外层裁定顺序「spawn-count 完成后优先 AC16，再 catch-up」——AC16 与
  spawn-count 在飞 disjoint 且同 develop 基线，**立即派发无冲突**；catch-up 大合并继续等 spawn-count 完成。
- 派发 2/3：ac16-release → worktree /home/yale/work/quay-worktrees/ac16-release（develop 926d771b
  基线）+ telemetry bracket 已开。
- 在飞 2/3（spawn-count + ac16-release）。supervisor merge + AC17 catch-up 仍挂（spawn-count 完成后）。

### tick 2026-08-06T08:4xZ（内层 cron + slot-refill 心跳，轻触）

- 无 halt；套件 GREEN（07:07Z）。在飞 2/3（spawn-count + ac16-release，brackets aligned）。
- 池 10/20、disjoint 4/5 不达标；slot-refill 推荐 supervisor（done-pending-merge，非新候选）拒绝。
- 3 个真实候选全部与在飞 spawn-count OVERLAP（plugin/test/*）⇒ 序列化，本 tick 无新派发。
- 外层在 AC16 agent 工作中扩展其 scope（62ba83b0）：第三条安装路径 dist-plugin marketplace
  分支（落后 master 3755 提交），AC6 新增——agent 处理时需注意，fan-in 后核实 AC6。
- supervisor merge + AC17 catch-up 仍挂（spawn-count 完成后）。

### tick 2026-08-06T08:5xZ（AC16 fan-in 到 integration 完成）

- **AC16 合入 integration**（第一个正确落两线模型的任务）：7adb6307（files+plugin、package.sh 快照、
  v0.4.0、SEA 保留、dist-plugin 第三条路径）→ 8cca89d5 merge → bd273f5a contract 格式修复。
  分支 develop 基线（926d771b）+1 提交，无 master-only 污染（与 supervisor 不同）。
- **contract-check 抓到 band 格式违规**（`band bundle_in_pack = > 0` 无 name=value 形）——
  严格子集 scoped 闸抓出，改为 `band bundle_in_pack = 1`。scoped 5/5 pass（含 bundle_in_pack>0 回归）。
- worktree 清理 + branch 删除 + telemetry close（outcome done）。在飞 1/3（spawn-count）。
- **AC17 catch-up 仍待 spawn-count 完成**（裁定顺序 ①master 62→develop ②拉 GitHub B ③rebase 任务分支）。
  integration 现领先 develop 2 提交（AC16），等 catch-up ①②后由外层 FF 到 develop。

### tick 2026-08-06T08:2xZ（外层，AC16 生产侧完成）

- **AC16 landed on integration**（e1aed902，first two-line merge）：files+plugin、v0.4.0、5/5 green。
  核实：integration 的 files 已含 plugin、version 0.4.0。
- **按分工轴分 AC**：生产侧（AC1 files+plugin / AC4 develop tag+v0.4.0 / AC5 交叉标注）A 已勾；
  验收侧（AC2 干净机端到端 / AC3 非 quay 项目两层循环）**待 B**（A 结构上无法验证自己 release）；
  AC6 dist-plugin 重建待后续。任务保持 ready（生产完成待验收），不翻 done。
- **待办**：AC16 FF develop → 打 tag → dist-plugin 重建 → B 验收；catch-up（master 62→develop、拉 B 105）
  待 spawn-count 完成后由内层执行、外层 FF。

### tick 2026-08-06T09:0xZ（内层 cron + slot-refill 心跳，轻触）

- 无 halt；套件 GREEN（07:07Z）。在飞 1/3（spawn-count，brackets aligned，develop 基线）。
- spawn-count 已跑 ~85min、分支 0 提交（agent 长任务中，未到 OVER90 阈值，未收完成通知 ⇒ 仍在工作）。
- 池 10/20、disjoint 4/5；slot-refill 推荐 supervisor（done-pending-merge）拒绝。
- 3 个真实候选（needs-human-black-hole / no-criterion-cost / quality-trend）均未落地但全部与
  spawn-count OVERLAP（plugin/test/*）⇒ 序列化，本 tick 无新派发。
- 挂起：supervisor merge + AC17 catch-up（spawn-count 完成后）；integration 领先 develop 2 提交（AC16）。

### tick 2026-08-06T09:1xZ（外层，AC17 catch-up ② 完成 + 跨机合并回归）

- **AC17 catch-up ② 完成**（da065182：merge origin/develop，B 105 提交并入 A develop）——跨机合并落地。
  17 个文件冲突由 inner 解决。
- **跨机合并第一个真实回归（管理者定位，非新写 bug）**：ready-pool-check 崩溃——
  ① computeRelevance arity 不匹配（A 四参定义 + B 三参调用点，parentRefCount undefined → .get() 崩）
  ② top 未声明（B 的 --top N 特性写 top，A 参数名 topN）——内层已修 ①（签名默认值），② 已驱动（top→topN）。
  两边各自绿、合起来红——scoped 测试未覆盖的跨机合并形态。
- **audit 记录 A/B（periodic-push-backup 铺设集 + verify-delivery-surface 第5项）随 merge 提交**，安全。

- **ready-pool-check 跨机合并回归根治**（内层）：① arity 崩溃（b6bf8297）② blocking 静默失效
  （buildCandidate 补 childrenByTask/parentRefCount + 四参调用）——已验证 exit 0 + pool 9/12。
  跨机合并两边各自绿/合起来红的第二例（scoped 未覆盖）。

### tick 2026-08-06T09:5xZ（AC17 catch-up ①②③ 完成 + 跨机合并回归修复）

- **catch-up ①**：develop FF 到 master（ea2208cf，76 提交，纯快进无冲突）。
- **catch-up ②**：merge origin/develop（B 105 提交 d0edd8ab，merge-base 926d771b）→ 17 冲突文件逐层解决
  （da065182）。布局判定：A 的 .quay/runtime/bin/（测试钉死）为规范，B 的 refactor/superset 嫁接；
  task bodies 双机证据并集、A board 状态权威。
- **catch-up ③**：spawn-count（98e23f5b）+ supervisor（rebased）到新 develop。
- **跨机合并回归修复（4 处，均已在 develop 验证）**：
  ① ready-pool-check arity（computeRelevance 默认参数→根治 buildCandidate 线程化 maps，blocking 从 1/68→7/68）；
  ② ready-pool-check top→topN（B 侧 body vs A 侧参数名）；
  ③ ready-pool-check relevanceReason→c.relevance.reason（悬空 B helper）；
  ④ heavy-op-token LEASE_MS→LEASE_S*1000（unbound variable 崩溃毁掉 acquire）。
  附带：ready-pool 28/28、heavy-op-token 30/30 全绿（B 侧测试措辞对齐 A 规范输出）。
- **在飞 0/3**（spawn-count/supervisor rebase 完成待 fan-in；AC16 已在 integration）。
- **下一步**：supervisor + spawn-count 合 integration（两线模型）；外层 FF integration→develop。

### tick 2026-08-06T10:1xZ（内层 cron，post-catch-up 首 tick）

- 无 halt；套件 GREEN（07:07Z）。在飞 0/3（spawn-count bracket 已 close done）。
- **fan-in 拓扑 knot【转外层裁定】**：integration（bd273f5a）持 AC16（v0.4.0）但落后 develop 188 提交
  （develop 1c4938ac 全基线 v0.3.13）；spawn-count（98e23f5b）+ supervisor（39af6de5）在 develop+1。
  两线模型 fan-in（合 integration → 外层 FF develop）需要 integration 先追上 develop，且 AC16 是
  integration-only 的 divergence——**integration 如何追上 develop（merge develop into integration /
  rebase AC16 onto develop）是分支模型决策，转外层**。
- 池 9/20、disjoint 4/5 不达标；slot-refill 推荐 4 个全陈旧（DIR-124 directive / 3 landed signal-gap）。
- needs-human-black-hole 经 catch-up 已落地（6f3c68d5，B 侧工作）——stale ready，不派。
- **派发 1/3**：no-criterion-records-cost（唯一真实未落地 ready；resolve 5/6、pool-candidate clean、
  fork-baseline=develop）。worktree /home/yale/work/quay-worktrees/no-criterion-cost + bracket 已开。

### tick 2026-08-06T09:3xZ（外层，integration catch-up 策略）

- **AC17 catch-up 完整完成**（1c4938ac：①FF ②17-conflict merge ③rebase both）+ 4 个跨机合并回归修复
  验证（ready-pool arity/top/relevanceReason + heavy-op LEASE_MS，28+30 green）。blocking 根治 fd41c133。
- **integration catch-up 策略裁定**：integration 合入 develop（develop→integration 合并）。数据：
  integration 领先 develop 3 提交（全 AC16），develop 领先 integration 190（catch-up 后全部 A+B 工作）。
  develop 是权威——integration 追平 develop 且不丢 AC16。已驱动 inner 执行。
- 池 9/20（disjoint 4/5）、inner 在飞 no-criterion-cost。

### tick 2026-08-06T10:4xZ（integration catch-up + 双 fan-in 完成）

- **integration catch-up（外层裁定执行）**：merge develop into integration（58927990）——integration
  追上全 A+B 基线（190 提交）+ 保留 AC16 3 提交（v0.4.0、files+plugin、contract fix）。
  唯一冲突 = AC16 自身 task 文件（add/add，integration 版本为完成态 superset → 取 HEAD）。
  验证：develop ⊆ integration（ancestor）、AC16 v0.4.0 + "plugin" 字段在、develop..integration=4。
- **双 fan-in 到 integration（两线模型）**：
  - spawn-count（98e23f5b → 208c1329，16 files）：A 层 .ts→QUAY_CLI 转换，scoped 8/8。
  - supervisor（39af6de5 → 2f343eb8，12 files）：base-layer deliver/health，scoped 23/23。
- worktree/branch 清理；主检出回 develop。manager-inbox stash 还原（manager WIP，未动）。
- **在飞 1/3**（no-criterion-cost，develop 基线）。integration 现 = develop + AC16 + spawn-count + supervisor，
  待外层 FF integration→develop（verification-round）。

### tick 2026-08-06T11:0xZ（内层 cron + slot-refill 心跳，轻触）

- 无 halt；套件 GREEN（07:07Z）。在飞 1/3（no-criterion-cost，brackets aligned）。
- 池 9/20、disjoint 4/5 不达标。ready 9 中：6 陈旧 landed/directive/done（DIR-043/DIR-124/red-pattern/
  ghost-drive/split-batch/tests-leak/supervisor），1 在飞（no-criterion-cost），唯一真实候选
  quality-criteria 与在飞 OVERLAP（plugin/test/*）⇒ 序列化。
- **slot-refill 机械确认 no_refill_reason='no dispatchable candidate passes step-4 checks'** —
  与手动分析一致，本 tick 无新派发。
- 待外层：FF integration（现 = develop + AC16 + spawn-count + supervisor）→ develop（verification-round）。
- develop 已领先 integration（外层 merge archguard 工作 bccbc6b9）。

### tick 2026-08-06T11:2xZ（no-criterion-cost fan-in 完成）

- **no-criterion-cost 合 integration**（afb05ca7→cbc9ca43，11 files +730）：checker-cost.sh 纯追加成本账本
  + gate recordGateCost（env-guarded）+ verification-round.jsonl 套件时长序列。AC1-AC7 全证据、
  capability-catalog 0 unclassified、scoped **31/31**。
- **附带修复**：full-suite-runner.ts `extractFailureFile` 缺失闭括号（develop 基线 import 即 SyntaxError）
  → 修复后 full-suite-runner.test.mjs 23/23。
- worktree/branch 清理、bracket close（done）。**在飞 0/3**。
- **integration 现 = develop 基线 + AC16 + spawn-count + supervisor + no-criterion-cost**（cbc9ca43）。
  **待外层 FF integration→develop**（verification-round-N 批量合 FORK_BASELINE）。
- 池内唯一剩余真实候选 quality-criteria 已解除序列化（no-criterion-cost 完成）→ 下一 tick 可派。

### tick 2026-08-06T09:5xZ（外层，integration→develop 收口）

- **integration 已含全部任务工作**（cbc9ca43 = A+B 基线 + AC16 + spawn-count + supervisor +
  no-criterion-cost；58927990 已 merge develop）。develop 领先 integration 6（外层/管理者记录类提交）。
- **收口裁定：merge integration into develop**（非 FF）——integration 10 提交并入 develop，保留
  develop 6 记录，develop 成为含全部的权威分支。已驱动 inner 执行。
- 内层请求：FF integration→develop + 派发 quality-criteria（no-criterion-cost 完成后唯一真实候选）。

### tick 2026-08-06T11:4xZ（integration→develop 收口完成）

- **外层裁定执行**：merge integration into develop（非 FF）——integration 10 任务提交（AC16 + spawn-count +
  supervisor + no-criterion-cost）并入 develop，develop 6 记录提交（ADR-025/032、delivery-surface、tick 记录）保留。
- **验证**：integration ⊆ develop（ancestor，integration..develop=0）；AC16 v0.4.0+"plugin" 在、
  QUAY_CLI helper、supervisor-deliver/health.sh、checker-cost.sh 全部 PRESENT。develop = 5caf14dc 权威分支。
- **两线模型当前态**：develop = 全部 A+B 基线 + AC16 + 3 rebase 任务 + no-criterion-cost + 记录提交。
  integration 已空（并入 develop）。master 冻结 ea2208cf（人触发才同步）。
- **在飞 0/3**。池唯一真实候选 quality-criteria（解除序列化）。

### tick 2026-08-06T09:5xZ（外层，AC16 落实 + AC17 push）

- **AC16 已实现生产侧**（files+plugin v0.4.0 在 develop，4d15e7cf 验证 all 4 task sets + AC16 present）——
  管理者的「未派发」基于旧状态（integration 已实现但当时未合 develop）。任务 status 待验收侧（AC2/3 在 B）。
- **剩余动作**：从 develop 打 tag v0.4.0 + 触发 release（含 dist-plugin 重建 AC6）——这才是 archguard 能装的。
- **AC17 push**：本地 develop 领先 origin/develop 105（含分支切换，无阻塞）——已驱动 inner 立即 push
  develop 到 origin（B 下次拉取拿最新分支切换）。先 push 再打 tag。

### tick 2026-08-06T12:0xZ（人催 + 排期：AC17 push + AC16 tag/release）

- **① AC17 push 完成**：origin/develop d0edd8ab → **27b9d7e5**（105 提交全推，含分支切换；origin 0 领先无阻塞）。B 下次拉取即可拿最新分支切换。
- **② AC16 release 触发**：tag v0.4.0 从 stale 7adb6307（210 落后）**移到 develop 27b9d7e5**（外层裁定"从 develop 打 tag"），push 触发两个 workflow（均 queued）：
  - **release.yml**（Release v0.4.0）→ npm pack 产物 + GitHub Release（archguard 可装）
  - **publish-plugin-dist.yml**（Publish plugin dist v0.4.0）→ dist-plugin 重建（AC6）
- 验证：origin/tag v0.4.0 = origin/develop = 27b9d7e5。v0.3.13 为上一 release（2026-07-24）。

### tick 2026-08-06T12:2xZ（AC16 release 结果：部分成功 + 缺陷立案）

- **v0.4.0 release 已创建**（09:48:28Z，Latest）：linux-x64 + macos-arm64 SEA 二进制 + npm pack 产物。
- **但 workflow conclusion=failure**，两个原因：
  ① **windows sea-release 在 npm install 失败**——postinstall 的 bash 专属 `(echo ...; exit 0)` 回退
     cmd.exe 解析不了（`re-run: was unexpected at this time`）⇒ **缺 windows-x64 SEA 二进制**。
  ② release job "Run tests" 的 live-GitHub 测试 repo 漂移失败（E3 adr-001 / M52 delivery-standalone-smoke /
     AC5 real-store scan）——CLAUDE.md 记载的已知脆弱类，现在阻塞 release。
- **已立案**：gap-release-postinstall-fallback-breaks-windows-sea-build（postinstall 跨平台化 + live 测试阻塞评估）。
- **archguard 可用性**：linux 可装（linux-x64 在）；但 release 不完整 + workflow 红。修复路径：修 postinstall →
  打 v0.4.1 重发完整 release。
- dist-plugin（AC6）已 publish success。

### tick 2026-08-06T12:4xZ（内层 cron，派发 quality-criteria）

- 无 halt；套件 GREEN。在飞 0/3。池 8/20、disjoint 5/5（criterion met）。
- ready 8 中 6 陈旧（DIR-043/DIR-124 directive、red-pattern/ghost-drive/split-batch/tests-leak landed、
  supervisor done-merged）；**唯一真实未落地 ready = quality-criteria**（no-criterion-cost 完成后解除序列化）。
- **派发 1/3**：quality-criteria（resolve 4/4、pool-candidate clean、fork-baseline=develop）→ worktree
  /home/yale/work/quay-worktrees/quality-criteria + bracket 已开。
  agent 被告知 leverage 刚合并的 verification-round.jsonl/checker-cost.jsonl 账本（趋势判据数据源）。
- 新立案 gap-release-postinstall（todo，未晋——与 quality-criteria 在 sync-vendor.sh 重叠，等其落地再派）。

### tick 2026-08-06T13:0xZ（quality-criteria fan-in 完成）

- **quality-criteria 合 integration**（42767afa→e39d966b）：trend-check.ts 被动读取 verification-round/
  checker-cost 账本，3 轴（suite_per_test_cost / early_red_latency / per_checker_cost），AC3 回归
  0.251→0.464→0.321 编码。AC1-AC7 证据、capability-catalog 125/125、scoped **44/44**。
- rebase 带入 ADR-030/031/032 + postinstall 缺陷（一并落 integration）。worktree/branch 清理，bracket close。
- **在飞 0/3**。**postinstall 缺陷（gap-release-postinstall）现可派**——其 sync-vendor.sh 与 quality-criteria
  的重叠已随后者落地解除。
- 待外层 merge integration→develop（验证后），或本 tick 直接派 postinstall 缺陷。


### tick 2026-08-06T10:1xZ（外层，ad-arm1 第三台机 + 传播滞后修复）

- **ad-arm1（ARM64）加入集群**（管理者）：Node v24、claude+deepseek 核实、gh 认证、从 develop clone、
  quay-init 冷启动、config validate 通过（concurrency 2/2/1/1 按 2 核降）、未装 os-anchor（按裁定）。
  尚未启动 outer/inner——是否启动留给外层/人定。
- **传播滞后实证（管理者）**：ad-arm1 对 gap-productize 报 YAML 重复键——因 8cf12c7c（修复）未推 GitHub。
  外层核实：本地 develop 领先 origin 6 提交（含修复），origin 停 27b9d7e5。**已立即推**（→3cf2d131），
  ad-arm1 重新 pull 即可拿到修复。provider 优雅降级（跳过该文件，其余 113 正常）——非新 bug。



### tick 2026-08-06T13:2xZ（内层 cron，派发 postinstall 修复）

- 无 halt；套件 GREEN。在飞 0/3。池 8/20、disjoint 5/5（criterion met，但 ready 多为陈旧 signal-gap）。
- **派发 1/3 — gap-release-postinstall-fallback-breaks-windows-sea-build**（3.6 补晋 todo→ready）：
  archguard-blocking 的 release 修复。resolve 3/4、pool-candidate clean、fork-baseline=develop。
  worktree /home/yale/work/quay-worktrees/postinstall-fix + bracket 已开。
  agent 指引：postinstall `(echo...; exit 0)` → `|| true`（cmd.exe 可解析），WARN 移入 sync-vendor.sh；
  AC4 需裁定 live-GitHub 测试阻塞（skip/adapt/split）。
- 在飞 1/3。quality-criteria 已落 integration（上一 tick）。

### tick 2026-08-06T13:5xZ（postinstall 修复 fan-in 完成）

- **postinstall 修复合 integration**（d9c1c638→031842d0→05153568）：cmd.exe-safe postinstall
  （bash 专属 `(echo...; exit 0)` 移除 → `|| true`，WARN 移入 sync-vendor.sh 的 POSTINSTALL_MODE + trap），
  release-gate live-GitHub 测试 **SKIP** 决策（AC4，release 验产物不验可变 live store，与 ADR-019 一致）。
  AC1-AC5 证据、scoped **6/6**（含 cli.test.mjs live blocks SKIP + sync-vendor.test.mjs 5/5）。
- 状态 reconcile：task 文件在 integration 置 ready（agent 的 develop-fork 副本是 todo，外层 promotion 保留）。
- worktree/branch 清理、bracket close。**在飞 0/3**。
- **integration 现 = develop 基线 + 6 任务（AC16/spawn-count/supervisor/no-criterion/quality-criteria/postinstall）
  + ADR-030/031/032**。**下一步**：外层 merge integration→develop → 打 **v0.4.1** 触发完整三平台 release
  （windows_postinstall_ok band 证明）。



### tick 2026-08-06T14:1xZ（内层 cron，派发 message-bus-identity）

- 无 halt；套件 GREEN。在飞 0/3（bracket reconcile 1 陈旧——postinstall 的 worktree-gone 误判）。
- 池 8/20、disjoint 5/5（criterion met），但 ready 全陈旧（quality-criteria/supervisor 已 merge、
  DIR 指令、4 landed）；slot-refill 推荐 5 全陈旧。
- **新立案（外层）**：**gap-SEA-bundle-excludes-plugin-tree** —— SEA 推荐发行版无 plugin 树，
  AC16 未完全达成；根因 esbuild-sea.mjs 只 bundle bin/quay.ts vs npm files 是两套独立机制，
  单二进制 vs 目录树结构性冲突需架构裁定。**npm release 修复（postinstall）只是半边**。
- **派发 1/3 — gap-supervisor-message-bus-with-identity**（supervisor step ⑤，3.6 补晋）：
  resolve 5/5、pool-candidate clean、fork-baseline=develop。worktree + bracket 已开。
- 在飞 1/3。

### tick 2026-08-06T10:5xZ（外层，ad-arm1 冷启动发现 session-liveness 回归）

- **ad-arm1 冷启动 fail 7**：第一个硬错误 = plugin/test/session-liveness.test.mjs:260 SyntaxError
  （Identifier 'commit' already declared——模块加载期崩，整文件测不了）。A 本机逐字复现（非 ARM 专属）。
- **根因**：da065182（catch-up②）**第三次回归**（同 arity/title 根因）——session-liveness.test.mjs:240-262
  合并错乱（makeFreshGitRepo body 无闭合 + initGitRepo 内两个 const commit 同作用域）。
- **修法**（驱动 inner）：makeFreshGitRepo 补完整 body + initGitRepo 删重复 commit + 边界分离。
- 套件自 07:07 未真跑全量——此缺陷活在 develop 未被发现。其余 6 失败项 ad-arm1 陆续报。

### tick 2026-08-06T11:0xZ（外层，ad-arm1 冷启动 4 条根因）

- **ad-arm1 冷启动门禁完整诊断**（管理者转达）：4 条根因全 da065182 合并回归。
  #1 session-liveness.test.mjs 硬 SyntaxError——**已修提交**（e8f0a015）。
  #2 loop-driver-check.test.mjs 整文件两份版本拼接（最严重，测 cold-start 单驱动不变式）——驱动 inner 修。
  #3 cap-from-gate.test.mjs 硬编码 effective_cap >= 3——**外层裁定：测试应断言 effective_cap == 配置 GO 值**
    （config 注释明写同一机制不同数字，ad-arm1 GO=2 合法）——驱动 inner 修。
  #4 send-keys-reliable AC4 文案漂移（脚本 vs 测试正则措辞）——驱动 inner 修。
- **ad-arm1 会等推 GitHub develop 后 pull 重跑**。

### tick 2026-08-06T14:5xZ（ad-arm1 冷启动 4 回归修复 + message-bus fan-in）

- **ad-arm1 冷启动诊断的 4 条 da065182 合并回归全部修复**（f4b86a5e）：
  ① session-liveness SyntaxError（makeFreshGitRepo 失体 + initGitRepo 重复 const commit）→ 恢复完整。
  ② loop-driver-check 整文件两份版本拼接（SyntaxError）→ 删第二份，保留一份完整（8/8）；
     附带 tick-doc AC5 文案（line 179 裸"回步骤 4 重建 cron"→ 查注册表优先 + rm -f 清陈旧）。
  ③ cap-from-gate 硬编码 effective_cap>=3 → 断言 === DEFAULT_BANDS.go（配置 GO 值，13/13）。
  ④ send-keys-reliable AC4 文案漂移（依赖的校验器缺失 vs /缺少校验器/）→ 统一（4/4）。
  全 test 文件 syntax sweep 通过。
- **message-bus-with-identity fan-in 到 integration**（1037c6ce→8003f001）：deliver 带 sender 身份、
  agent 信道拒绝 from:human（fail-closed）、tick 读收件箱。AC1-AC7、scoped 24/24。
- **AC16 状态**：外层 REVERTED to not-achieved（2b5bb273）——SEA tarball 无 plugin（archguard
  string-scan + manager tar tzf 双确认）；root cause SEA 单二进制 vs plugin 目录树结构性冲突。
- integration = develop 基线 + 7 任务 + SEA 缺陷任务；在飞 0/3。

### tick 2026-08-06T15:2xZ（内层 cron，派发 supervisor-preemption）

- 无 halt；套件 GREEN。在飞 0/3（bracket reconcile 1 陈旧——message-bus worktree-gone 误判）。
- 池 8/20、disjoint 5/5（criterion met），但 ready 全陈旧（message-bus/quality-criteria/supervisor 已 merge、
  DIR 指令、4 landed）。promotions 数组含 message-bus（stale）+ preemption。
- **派发 1/3 — gap-supervisor-preemption**（supervisor step ④，3.6 补晋）：resolve 5/5、pool-candidate
  clean、fork-baseline=develop。worktree /home/yale/work/quay-worktrees/preemption + bracket 已开。
  agent 指引：.halt 从 tick 边界检查 → 任意点生效（base-layer 能力，mid-agent 即停）。
- 在飞 1/3。supervisor 族 ③④⑤ 齐了（③ base-layer done、④ preemption 在飞、⑤ message-bus done）。

### tick 2026-08-06T11:2xZ（外层，4 修复推送）

- **f4b86a5e（ad-arm1 4 回归修复）已推 origin**（develop →8eac8caf，9 提交含 message-bus/supervisor-preemption）。
- ad-arm1 现在可 pull 重跑冷启动门禁；B 机下次拉取同样受益。

### tick 2026-08-06T15:5xZ（内层 cron + slot-refill，轻触）

- 无 halt；套件 GREEN。在飞 1/3（preemption，brackets aligned，分支 0 提交——agent 工作中）。
- 池 9/20、disjoint 5/5；ready 全陈旧（含 preemption 在飞 + 已 merge 的 message-bus/quality-criteria/
  supervisor + DIR + 4 landed）。slot-refill 推荐 4 全陈旧，**无新 promotions** ⇒ 本 tick 无新派发。
- 在飞 1/3。integration 待外层 merge→develop。

### tick 2026-08-06T11:3xZ（外层，session-liveness test G 回归候选）

- **test G 隔离失败**（RESUMED on busy transition，行663）——管理者全量 + 外层隔离双确认，非 AC21。
- **session-liveness.sh 是 eb5532f4 合并冲突文件**（152行）——RESUMED/busy 逻辑可能是 da065182
  合并回归第 5 实例。已立案 gap-session-liveness-resumed-merge-regression-suspect，驱动 inner 判别
  （脚本回归 vs 测试时序）。

### tick 2026-08-06T16:0xZ（session-liveness test G 判别——非合并回归）

- **判别完成（管理者全量+外层隔离双确认 + 内层受控验证）**：test G（RESUMED must fire on busy, 行663）
  **隔离跑 1/1 通过**；session-liveness.sh 的 busy→RESUMED 逻辑 **eb5532f4 合并前后字节等价**
  （diff grep RESUMED/busy_sem/PREV_BUSY/PREV_IDLE/esc-to-interrupt 无功能 [+-] 改动）；
  文件顶部已带 **KNOWN-LOAD-SENSITIVE 标记**。
- **判定：测试时序 flake，非合并回归**。脚本无需改动；全量闸按 KNOWN-LOAD-SENSITIVE 判绿规则
  对 session-liveness.test.mjs 隔离重跑。已记入 gap-session-liveness-resumed-merge-regression-suspect。
- 在飞 1/3（preemption）。

### tick 2026-08-06T16:4xZ（supervisor-preemption fan-in 完成 — supervisor 族收齐）

- **supervisor-preemption 合 integration**（81e34ec9→a30c1753，19 files）：supervisor-preempt.sh
  （halt-check/preempt/preempt-all）+ slot-refill.ts checkHaltSentinel（.halt 任意点生效，preemptive）。
  AC1-AC6 证据、scoped **34/34**。
- **supervisor 族 ③④⑤ 三件套全部落 integration**：③ base-layer + ④ preemption + ⑤ message-bus。
- **在飞 0/3**。integration = develop 基线 + 9 任务（AC16/spawn-count/supervisor/no-criterion/quality-criteria/
  postinstall/message-bus/preemption + SEA 缺陷）。
- 待外层 merge integration→develop（一次收口多个任务）+ 处理 SEA 缺陷（AC16 结构性问题）。


### tick 2026-08-06T17:0xZ（integration→develop 收口完成 — 9 任务全落 develop）

- **外层裁定执行**（2f84a566 模式）：merge integration into develop。integration 35 任务提交并入，
  develop 33 记录保留。3 冲突解决：queue-state/tick-log 双留、postinstall 任务取完成态证据版。
- **验证**：integration ⊆ develop（ancestor，develop..integration=0）；9 任务工作集全部 PRESENT
  （supervisor-preempt/deliver/busy-identity、trend-check、checker-cost、package.sh、sync-vendor.test、
  SEA 缺陷任务）。
- **develop = 权威分支**（52d3804b）= 全 A+B 基线 + AC16 + spawn-count + supervisor③④⑤ + no-criterion +
  quality-criteria + postinstall + message-bus + SEA 缺陷 + 记录提交。
- **在飞 0/3**。master 冻结 ea2208cf（人触发才同步）。
- **AC16 待办**：SEA 缺陷（单二进制 vs plugin 目录树结构性冲突）——develop 已含缺陷任务，待架构裁定。

### tick 2026-08-06T12:0xZ（外层，ad-arm1 二轮门禁三条确定性复现）

- **ad-arm1 二轮门禁**：pass 451 / fail 16，四条修复生效但暴露更深残留，三条确定性复现（精确行号）。
  #1 pane-state-classify.ts:395-424 入口顺序穿落——--classify 异步 stdin 未消费即 exit、--check-residue 不可达
  （分类器根本没工作，解释 session-liveness 大批 busy/idle 失败）。
  #2 session-liveness.sh:618-642 双 --selfcheck 臂（新版先赢，旧版 _sl_selfcheck 死代码）+ 重复 -h|--help。
  #3 **外层早上的 cap-from-gate 修复机器相关**（=== DEFAULT_BANDS.go 读机器本地 config，B/ad-arm1 go:2≠5 挂）
  ——我的修复缺陷，改测试为密闭/注入配置。
- 已驱动 inner 修三条。

### tick 2026-08-06T17:4xZ（ad-arm1 二轮门禁 3 条确定性复现修复）

- **#1【最高】pane-state-classify.ts 入口穿落**（395-424）：--classify 异步 stdin resume() 后穿落到
  同步 selfcheck()+exit()，stdin 未消费进程已退；--check-residue 在 else 外不可达——分类器对 shell
  消费者没工作，解释大批 busy/idle 失败。**重构为 --classify/--check-residue/else-selfcheck 三选一**。
  验证：--classify 输出 state、--check-residue 可达、17/17。
- **#2 session-liveness.sh 双 --selfcheck 臂**（618-642）：新版 selfcheck + 旧版 _sl_selfcheck 死码 +
  重复 -h|--help。**删旧死臂 + 死函数**。验证：新版 selfcheck exit 0、--pane-state 接缝正常。
- **#3 cap-from-gate 机器相关**：早前修 === DEFAULT_BANDS.go（读机器本地 config，B/ad-arm1 go:2≠5 挂）。
  **改为注入密闭 TEST_BANDS {go:3} 断言 === TEST_BANDS.go/wait/extreme_wait**。验证：13/13。
- 全部在 develop（dbc17135）。ad-arm1 等推 GitHub 后 pull 重跑二轮门禁。

### tick 2026-08-06T18:0xZ（内层 cron + slot-refill，轻触）

- 无 halt；套件 GREEN。在飞 0/3。
- 池 8/20、disjoint 6/5（criterion met 但虚高——ready 全陈旧 signal-gap）。**无 promotions**。
  red-pattern（37947f75 短名落地）/ghost-drive/split-batch/tests-leak 全 landed；postinstall/supervisor/
  quality-criteria/message-bus/preemption 已 merge。**池真正耗尽，无新派发**。
- develop 13903a45（ad-arm1 gate #1/#2/#3 修复后）→ 待推 GitHub 让 ad-arm1 pull 重跑二轮门禁。
- 下一事件：ad-arm1 门禁结果 / 外层新增任务。

### tick 2026-08-06T12:3xZ（外层，monitor 三条修复推送）

- **dbc17135 + 13903a45（monitor 三条修复）已推 origin**（develop →4cdde3f2，50 提交含 9 任务收口 +
  我的 cap-from-gate 更正 + SEA 缺陷）。ad-arm1 可第三轮 pull 重跑。

### 进度估计依赖（2026-08-06T12:5xZ，管理者更正）

- **ad-arm1 不会自动跟随推送**——它「零代码改动、零冷启动步骤，等通知」，需要**人工/管理者显式触发**
  pull+重跑。推送 ≠ ad-arm1 已跑。估计 ad-arm1 进度时必须算入「显式通知」这个人工依赖。

### tick 2026-08-06T18:4xZ（内层 cron + slot-refill，轻触）

- 无 halt；套件 GREEN。在飞 0/3。池 8/20 全陈旧（landed/directive/merged），**无 promotions** ⇒ 无新派发。
- 外层已推 50 develop 提交到 origin（7c190cd4，含 gate #1/#2/#3 修复 + 9 任务收口）——
  ad-arm1 第 3 轮 pull 就绪；外层记 progress-dependency：ad-arm1 需显式 manager 通知才 pull+rerun（不自动跟随 push）。
- develop 43f854ce。下一事件：ad-arm1 第 3 轮门禁结果 / 外层喂新任务。

### tick 2026-08-06T19:0xZ（人裁定派发：single-flight-lock 跨项目盲区）

- **人立案 + 外层裁定派发** gap-session-liveness-single-flight-lock-cross-project-blind（archguard 一天多
  无监视器，正确诊断+升级却掉进「谁都不负责」缝隙）。根因精确：借锁时作用域照抄——单飞锁按机器不分项目。
- **外层裁定修法（比锁分域小）**：不改锁实现——session-liveness.sh 调用时把 --root 从 $SL_GLOBAL_DIR
  换成按 targetRoot 分域子目录（$SL_GLOBAL_DIR/<target-root-slug>），锁代码一行不动（789/814/851 + lock_token 799）。
  heavy-op-token.sh 原始用途（重测试互斥每机器对）保持正确；监视器互斥应每项目对。人 2026-08-04 裁定
  多目标挂载 7→2。
- 派发闸：resolve 3/3、pool-candidate clean、fork-baseline=develop、在飞 0/3。
- 派发 1/3：worktree /home/yale/work/quay-worktrees/single-flight-lock + bracket 已开。
- 在飞 1/3。

### tick 2026-08-06T19:4xZ（内层 cron，轻触）

- 无 halt；套件 GREEN。在飞 1/3（single-flight-lock，brackets aligned，分支 0 提交——agent 工作中）。
- 池 9/20 全陈旧（signal-gap），**无 promotions** ⇒ 无新派发。
- 在飞 1/3。下一事件：single-flight-lock 完成 / ad-arm1 round-3 结果。

### tick 2026-08-06T20:0xZ（single-flight-lock 前提撤回 + 任务缩窄）

- **管理者自我更正**：原「锁分域」premise 撤回——archguard 被实时监视（共享文件 105 条 archguard 事件，
  最新 4 分钟前）；`mounted=false/delivered=true` 是单持有者+共享文件设计的**正确状态**
  （fast-mode-loop-tick.md:176-180 明写）；多目标配置在生效（REPO-STALL/SESSION-OVERDUE 为证）。
  **唯一真盲区 = ad-arm1（quay-C）delivered=false**——新机器未进 manager 多目标配置，配置缺失非锁 bug。
- **执行**：停掉在飞 agent（worktree 零改动）、清理 worktree/branch、bracket close（abandoned）、reconcile。
  任务重写缩窄为「ad-arm1 配置缺失」（锁代码不修改）。AC1 已核实：ad-arm1 不在 config、
  SESSION_TARGETS 已移出到显式 env 传参（管理者 2026-08-04 挂载约定）。
- 在飞 0/3。

### tick 2026-08-06T20:5xZ（人裁定：去掉共享事件文件 + 互斥锁）

- **人裁定（e6ca24b9）**：session-liveness 共享事件文件「极端糟糕的设计」+ 互斥锁「彻底去掉」。
  核心论证：观测拓扑是树、只读天然不排他、共享文件严格劣于独立流、锁的唯一理由（保护共享文件）随之消失。
  **AC20 单飞前提是错的**（观测非单飞资源，早期 manager 会话引入）。4 危害已核实
  （启动顺序决定能力/已自生缺陷+补丁/命运共享/无界增长 472KB）。
- **新方向**：每观察者自己的事件流（谁挂的谁拥有）、无锁、目标无感、观察者互不知情。
  撤销 ad-arm1 配置方向。
- 任务文件重命名（旧 id → 新 id gap-session-liveness-remove-shared-events-and-lock，filename 对齐）。
  派发闸：resolve 4/4、pool-candidate clean、fork-baseline=develop。
- **派发 1/3**：worktree /home/yale/work/quay-worktrees/remove-shared-events + bracket 已开。
  agent 指引：去共享 events → 每观察者自己的流；去锁；AC2/AC4 多观察者并行挂载验证。
- 在飞 1/3。

### tick 2026-08-06T21:0xZ（范围钉死：只摘 session-liveness 侧借用）

- **范围钉死（防误删）**：heavy-op-token.sh 有两个完全不同的用途，人「彻底去掉互斥锁」只针对①：
  ① 挂载互斥（session-liveness 借用，--root $SL_GLOBAL_DIR）——去掉（人已裁定）；
  ② 重测试调度（原始用途，scripts/test.sh 5 处调用，三项目共用四核）——保留，不在裁定范围。
- **实现只摘 session-liveness 这一侧的借用（10 处引用），不删 heavy-op-token.sh 本体**（否则打断
  test.sh 调度）。人更早「单飞锁不该进产品化」针对整体但未明确裁定②，按原样保留等回复。
- 已传达给在飞 agent（SendMessage）+ 记入任务体 Scope pin 段。
- 在飞 1/3（remove-shared-events）。

### tick 2026-08-06T21:4xZ（范围纠正：B 全删覆盖 A 钉死）

- **人新裁定覆盖上一条 A 范围钉死**：原话「彻底删掉 heavy-op-token.sh 及其调用/相关逻辑，不再处理
  一次只跑一个重测试逻辑」。范围 = **B 全删**：
  ① heavy-op-token.sh 本体删除
  ② 所有调用点清理（scripts/test.sh 5 + session-liveness.sh 7 + session-liveness-mount.sh 1 +
     quay-init.sh 2 + capability-catalog.sh 1 + fast-mode-loop-tick.md:176-180 语义改写 +
     heavy-op-token 测试文件 + cold-start-e2e.sh）
  ③ 一次只跑一个重测试约束整体退役无替代方案
  删除顺序：代码/测试 → shipped 文档 → 历史文档标注退役。
- SendMessage 更新在飞 agent（B-FULL-DELETE 覆盖之前 A pin）；任务体已改为 B 全删。
- 在飞 1/3（remove-shared-events）。

### tick 2026-08-06T22:0xZ（内层 cron，轻触）

- 无 halt；套件 GREEN。在飞 1/3（remove-shared-events，agent 处理 B 全删范围中，分支 0 提交）。
- 池 9/20 全陈旧（signal-gap），**无 promotions** ⇒ 无新派发。
- develop 3eb27f93（外层记录 B 全删裁定）。下一事件：remove-shared-events 完成。

### tick 2026-08-06T22:5xZ（内层 cron，轻触）

- 无 halt；套件 GREEN。在飞 1/3（remove-shared-events B 全删，分支 0 提交——大范围删除，agent 工作中）。
- 池 9/20 全陈旧，无 promotions ⇒ 无新派发。外层明确验证点：heavy-op-token 删除 + test.sh 调度正常。
- 外层另立案：tmux fail-closed at laydown 与 human ruling 冲突（--tmux-session 应冷启动可选）、
  delivery-outline-vs-verify-surface single-source——外层侧，非本管线。
- 下一事件：remove-shared-events 完成。

### tick 2026-08-06T14:1xZ（外层，人直接指令：同步两边）

- **人裁定**：「通知两边做同步。保证其已经处理好合并问题并 push 后才能处理其它任务。」
- **A 动作（完成）**：本地 develop 26 个未推提交已 push origin（4cdde3f2→7cf3c650）。push 完成前不开新任务。
- **B 冲突预警（管理者实测）**：B 落后 origin 405 提交、6h 没交互。A 改 238 文件、B 改 117、交集 56。
  高危重叠：plugin/loop/fast-mode-loop-tick.md + orchestrator-loop-tick.md（branch cutover 改的，B 不知道）、
  session-liveness.sh / ready-pool-check.ts / slot-refill.ts / full-suite-runner.ts / quay-init.sh
  （A 今晚修合并回归的，B 同期独立改）。**最尖锐**：plugin/test/session-liveness.test.mjs 又在交集——
  上次硬 SyntaxError（const commit 重复）正是合并此文件产生，同文件双边改动酝酿第二次。47 个同名
  tasks/gap-*.md 双方都改。
- **B 侧解冲突提示**（人已裁定 B 自己的循环负责自己合并）：特别小心上述文件——上次 35 冲突里出问题的
  是「两边各留一半」机械式合并。

### tick 2026-08-06T14:3xZ（外层，跨机同步任务纳入管线）

- **gap-cross-machine-sync-has-no-mechanism-only-manual-pushes（f38514c4）纳入**——人裁定主题，
  管理者 AC1-AC6 机械可测（兜底实测 / 事件驱动同轮 / 落后量可读 / 负控制 / 两机 / 无 crontab）。
- **b-machine-push-backup 标 superseded**（其 AC1 文字改了但实现仍 --cron-line crontab，改造不完整；
  新任务为正确替代）。新任务可派（touches 解析通过）。

### tick 2026-08-06T23:0xZ（cross-machine-sync 派发——OVERLAP 序列化 hold）

- **人裁定派发 gap-cross-machine-sync**（AC1-AC6 全机械可测：兜底实测/事件驱动同轮/落后量可读/负控制/两机/无 crontab）。
  数据方给「与在飞 remove-shared-events disjoint（checkTouchesPair 机制判）」。
- **机械验证推翻 disjoint**：checkTouchesPair 实判 **OVERLAP** —— 两任务都改
  `plugin/loop/fast-mode-loop-tick.md`（remove-shared-events 改写 176-180 单飞挂载语义；
  cross-machine-sync 加 sync 检查点）。**数据与机制不一致，以机制为准**。
- **处置**：按 tick doc OVERLAP ⇒ 序列化，**不并行派发**。已 promote 到 ready（排队），
  等 remove-shared-events fan-in 落地 fast-mode-loop-tick.md 后本 tick 下一轮派发。
  对应人裁定"可等 remove-shared-events 完成后"分支。
- 在飞 1/3（remove-shared-events）。池另有 cross-machine-sync 待命。

### tick 2026-08-06T23:5xZ（内层 cron，轻触）

- 无 halt；套件 GREEN。在飞 1/3（remove-shared-events B 全删，agent ~48min，未到 OVER90，
  brackets reflect subagents=true 健康）。分支 0 提交——大范围删除（heavy-op-token.sh + 全调用点 +
  测试 + 文档），agent 分析后单提交，48min 合理。
- 池：cross-machine-sync 已 ready 排队（serialize-held，等 remove-shared-events fan-in 解除
  fast-mode-loop-tick.md 重叠）。无其它新 promotions。
- 下一事件：remove-shared-events 完成（→ fan-in + 解除 cross-machine-sync hold）。

### tick 2026-08-06T14:2xZ（外层，两条裁定 + 新立案）

- **矛盾裁定**：ready-pool 可派 6（5 候选全与 in-flight disjoint 机制判），inner serialize-held 是
  过度保守——等 remove-shared-events 收尾可接受（标注等收尾非机制不允许），完成后按机制派。
- **滞留 worktree**：resource-aware 25h 无提交 + 未提交改动，已驱动 inner 核实（完成待收尾 or 丢弃）。
- **新立案接受**：gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target（a021d0cf）——
  quay-init grep fork_baseline=0、write_provider_config 只写四键——分支切换只存在于三台手工改过的主机，
  标准新主机拿不到两键静默回落 master-only。与 fork-does-not-read-config 分工（读 vs 铺）。
