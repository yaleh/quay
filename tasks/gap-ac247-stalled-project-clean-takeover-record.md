---
id: gap-ac247-stalled-project-clean-takeover-record
title: AC-247 没有生产者：当前 build 在停摆 ≥14 天的存量项目上从零安装并接管后，载体里产不出 ac=GOAL-016-AC-247
  记录（driver 真活读载体，⛔ 不读 start 退出码）
status: done
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-247
---
## Proposal

**症状（机械可复算）**：GOAL-016 的 AC-247 要求「当前 build 在 ad-arm1 上干净接管停摆一月的存量项目，且 driver 真活」，判据读载体 `.quay/productization-verification.jsonl` 里 `ac=GOAL-016-AC-247` 的记录。**该记录一条都没有**（今天实测，全量 carrier 的 `ac` 取值集合）：

```
{AC85, AC86, AC88, AC104..AC108, AC118, AC119, AC168-marketplace,
 GOAL-009-AC-201/203/204/205/206/207/232/238/239, GOAL-015-AC-234}
⇒ 含 GOAL-016 的 = 0
grep -rn 'GOAL-016\|AC-247' plugin/scripts/*.sh plugin/scripts/*.ts  ⇒ 0 命中（生产者也不存在）
grep -rn 'goal_ac:.*AC-247' tasks/*.md                             ⇒ 0（无人认领）
```

**不是「有生产者但没跑」，是步骤缺失**：现有四个近亲步骤（目标侧 `--ac89` / `--ac205-session` / `--ac207-e2e` / `--ac239-e2e`，驱动侧 `--verify-coldstart` / `--verify-upgrade` 传输）各自产出的字段集**都不含** AC-247 要的四件读数。`stale_days` / `pre_task_count` / `post_task_count` 这三个字段名在**整个 carrier 的历史记录里一次都没出现过**；`build_sha` 虽有（AC-201 起统一补锚），但没有任何一条 GOAL-016 记录用它。

**目标态的判据要求（逐字取自 `goals/AC-247-*.md`，⛔ 本任务不改判据文件）**：记录须同时满足
`host≠本机` ∧ `project_root` realpath ∉ 本仓库 ∧ `pre_task_count>0` ∧ `post_task_count==pre` ∧ `stale_days≥14` ∧ `build_sha` 非空 ∧ `driver_alive==1` ∧ `carrier_records>0`；缺 ⇒ exit 1，载体缺失 ⇒ exit 3（NOT-EVALUATED，⛔ 不与合格同形）。

**为什么 liveness 必须读载体**（判据正文逐字）：`quay driver start` 今天就会打印 `started: supervisor pid=… exit=0` 而系统是死的（GOAL-009 AC-203 已实证）⇒ 本次**不许**用 start 的退出码代替。

**目标主机现状（2026-09-12 本会话实测 probe，⛔ 非转述 origin）——负控制成立**：

```
ssh ad-arm1 ⇒ hostname=instance-20221019-1509, arch=aarch64
  command -v quay                     ⇒ ABSENT
  npm ls -g --depth=0                 ⇒ (empty)
  git -C /home/yale/work/archguard log -1 ⇒ 14ea9e63 2026-08-21T15:12:58+00:00（⇒ 距今 22 天 ≥14）
  ls /home/yale/work/archguard/tasks | wc -l ⇒ 61（真实存量，⛔ 非全新 quay-init）
```

⇒ 任何声称满足 AC-247 的记录**必须是真装真跑出来的**：`stale_days≥14` 这一条结构上排除「当天现造一个项目来凑形状」。

**⚠️ 四个已知陷阱（先看一眼，省几小时；实现注释里也要写）**：

1. **非登录 shell 的 `node` 是 v18.19.1**（`/usr/bin/node`），而 quay 需 Node ≥20（源码路径 ≥22.6）；登录 shell 才解析到 `~/.local/opt/node-current/bin/node` = v24.19.0，nvm 另有 v22.23.2。**driver 继承的是驱动进程的 env，不是登录 shell 的 env**（本仓既有实证）⇒ 起 driver 前必须把 ≥20 的 node 前置进 PATH，否则「接管失败」的表象是 node 版本/语法错误，不是 quay 缺陷。
2. **目标机有跨 21–26 天的陈旧残留进程**（`/home/yale/work/archguard/.quay/runtime/bin/quay-native.js mcp`、`~/quay-ac88-project/...` 的旧 shell、旧 `quay-verify-coldstart` 的 mcp 进程）⇒ **`ps | grep quay` 不是 liveness 读数**（硬规则 4b：代理量，它在被测对象停摆时恰好也不更新）。liveness 一律读 `quay driver status --json`。
3. **`stale_days` 必须在【接管动作之前】取**：`quay-init` auto-commit 会无条件提交（本仓既有实证）⇒ 接管后再算 HEAD 时刻会得到 ~0 天，判据当场恒假。取 pre 读数时就把时刻一起落档。
4. **主检出里的 `packages/quay/plugin/` 是 9-10 遗留的生成残件**，从源码树跑 CLI 时它可能赢得 walk-up 从而遮蔽真 `plugin/`（既有实证）⇒ 取证前先核 CLI 实际解析到的 plugin root 是哪一个。另：`verify-deliver-coldstart.sh` 的 `$SCRIPT_DIR` 依赖是**手工 scp 枚举**的，若本次新增了对同目录 sibling 文件的依赖，必须同步改 `develop-deliver-tgz.sh` 的随行清单——否则远端恒 unreadable 而本机 selfcheck 照样绿（既有实证）。

<!-- dedup-ref -->
**与既有任务的关系（仅追溯，不构成任何依赖声明）**：`gap-aged-third-party-project-quay-upgrade-verification`（AC-238，done）验的是「带旧 vendored runtime 的**副本**升级后存量不丢」；`gap-ac207-e2e-target-driver-driven-real-commit-task-done`（AC-207，done）验「第三方项目里驱动出真提交」；`gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable`（done）修的是跨机证据的步骤顺序与回传。三条都在 carrier 上留了记录，但**没有一条产出 `stale_days`/`pre_task_count`/`post_task_count`，也没有一条针对停摆 ≥14 天的存量项目做「从零安装 + 接管」**——AC-247 的区分量正是这三件读数。本任务不复用它们的机制，只补这条缺失的生产者步骤。

## Plan

1. **先定读数，再写代码**——四个新字段各定一个**直接量**来源，全部在**目标机**上读：

   - `host` ← 目标机 `hostname`（目标机读，⛔ 不由驱动方传入）；
   - `project_root` ← 目标项目根的 `realpath`（目标机读）；
   - `pre_task_count` / `post_task_count` ← 目标项目**自己的 task store** 条目数（同一实现读两次：接管前、driver 起来后）；
   - `stale_days` ← 目标项目 HEAD 提交时刻（目标机 `git log -1 --format=%ct`）到**接管前那一刻**的天数；
   - `build_sha` ← 本次投递的 tgz 所对应的 develop commit（与 AC-201 同源，⛔ 不新造锚字段）；
   - `driver_alive` / `carrier_records` ← 目标机 `quay driver status --kind promotion --root <项目> --json`，复用既有 `probe_ac203_driver_status`（⛔ 不读 `quay driver start` 的退出码）。

2. **生产者步骤（目标侧）**：在 `plugin/scripts/verify-deliver-coldstart.sh` 增加一个 opt-in 步骤（形如 `--ac247-takeover --takeover-root <项目根>`），顺序固定：
   (a) 读 pre 三件（task 数 / HEAD 时刻 / driver 状态）并原样打印；→ (b) 既有的从零安装段已完成；→ (c) 用**目标项目自己的** runtime 起 promotion（必要时 worker）driver；→ (d) 读 `driver status --json`；→ (e) 重读 task 数；→ (f) 八件读数**全部有效**才写记录；任缺 ⇒ **不写** + 打印可区分的 NOT-EVALUATED + 退出非 0。
   **写入必须走既有唯一补锚 choke point `ac89_append_goal009`**（它统一补 top-level `ts`/`build_sha`）——⛔ 不在新写入点再写一份 `"build_sha"` 字面量（既有注释逐字禁止：多一个补锚点 = 下次改锚格式必漏一处）。

3. **传输步骤（驱动侧）**：在 `plugin/scripts/develop-deliver-tgz.sh` 增加一条与既有 `--verify-coldstart` / `--verify-upgrade` **同形**的传输 flag：scp 回目标机的证据文件，经既有 `transport_evidence_append`（按 `(ts, ac, host, project_root)` 去重）追加进**驱动方 repo root** 的 `.quay/productization-verification.jsonl`。证据缺失/不可读/零行 ⇒ 非 0 + `NOT-EVALUATED`（⛔ 不静默 exit 0）。

4. **记录必须落在生产 root 的载体里**：判据由生产 goal-driver 在 `/home/yale/work/quay` 求值 ⇒ 传输落点必须是**该 root** 的 `.quay/`。若本任务在 worktree 里执行，先在 worktree 跑通，再把证据传输/追加进生产 root 的载体，并在**生产 root** 下干跑判据核 exit 0（⛔ 不要在 worktree 的 `.quay/` 里自证——那是另一份载体）。

5. **负控制（能取假）**：
   a) **pre 读数**：接管前打印的 driver 状态必须是「不活 / 未安装」；安装 + 起 driver 后**同一条读法**翻成 `driver_alive=1`——两次读数同源、方向相反。
   b) **缺值不写**：把任一读数人为置成读不出 ⇒ 新步骤**零记录** + NOT-EVALUATED（⛔ 不写 `driver_alive:0` 的记录——那会把「没查成」伪装成「查过且不合格」）。
   c) **判据三态**：载体副本删掉该记录 ⇒ exit 1；移走载体 ⇒ exit 3；两条与 exit 0 并列留档，证明 exit 0 来自记录内容而非环境。

6. **存量不丢不增是真读数**：`pre_task_count>0` ∧ `post_task_count==pre_task_count`。若接管动作本身改变了目标项目的 task 存量，**不写记录**，并报告是丢还是增、差多少。

7. **夹具与自检**：新步骤要有 hermetic selfcheck 正/负控制（同既有 `--selfcheck` 形态）并进套件。

## Acceptance Criteria

- [x] **AC1 生产者存在且 fail-closed（能取假）**：目标侧新步骤 + 驱动侧传输 flag 就位；hermetic 自检打印正/负两组读数——**正控制**：八件读数齐备 ⇒ 写出一条 `ac=GOAL-016-AC-247` 记录；**负控制**：逐个把任一件置为读不出 ⇒ **零记录** + 可区分的 NOT-EVALUATED + 退出非 0。读数与输出原文留档。⇒ 见 `## Evidence` §AC1/AC2 与 §AC6（自检四组读数原文）。
- [x] **AC2 每个字段是直接量（⛔ 无字面量/默认值）**：`grep` 证明记录写入点的每个字段都来自运行时读数（pre/post 计数、HEAD 时刻、status JSON、tgz 源 commit），写入路径里不存在任何字段的硬编码默认值。**引用任一计数前先打印它匹配到的前 3 条实际内容**（硬规则 2），把命中数与前 3 条一起贴进记录。⇒ 见 `## Evidence` §AC1/AC2 的逐字段【grep 模式 + 命中原文】（含 `write_ac247_record` 体内 `build_sha` 命中数 = 0）。
- [x] **AC3 真跑真装（生产载体上的判据翻转）**：在 host≠本机、该项目 user-scope quay 安装**接管前实测为缺**、项目停摆 ≥14 天且 task 存量 >0 的目标上真跑一次（GOAL-016 origin 点名的候选 = ad-arm1 的 `/home/yale/work/archguard`）。留档：接管前的 pre 读数（install 缺 / driver 不活 / task 数 / HEAD 时刻）、接管后的 `driver status --json` 原文、传输输出（`EVIDENCE-TRANSPORT appended=N`）。随后在**生产 root** 下**逐字取 `goals/AC-247-*.md` 的判据干跑**：改前 exit 1、改后 exit 0，两条读数并列（翻转的成因是载体内容，⛔ 不是环境）。⇒ 见 `## Evidence` §AC3 与 §AC6（criterion 干跑 exit 1 → exit 0）。
- [x] **AC4 liveness 不是退出码、也不是进程表**：记录里的 `driver_alive` / `carrier_records` 来自 `quay driver status --json`；`grep` 证明新步骤**没有**从 `quay driver start` 的退出码派生该字段；留档目标机上 `ps` 读到的陈旧进程与 status 读数的**分歧**（证明两种读法确实不同，而记录用的是后者）。⇒ 见 `## Evidence` §AC4（ps=7 vs status `driver_alive:0`）与自检 `ac247-liveness-source(from-AC203_DRIVER_ALIVE)=1 bad-assign-hits=0`。
- [x] **AC5 存量不丢不增（pre/post 同源读数）**：`pre_task_count>0` ∧ `post_task_count==pre_task_count`，两条读数的命令与输出原文留档；若差值非 0 ⇒ 记录**未**写出，且报告差值与方向（本条同时是「接管不许破坏存量」的判据）。⇒ 见 `## Evidence` §AC5（61 → 61，同一函数同一命令）。
- [x] **AC6 记录落在生产 root 且判据三态可区分**：`/home/yale/work/quay/.quay/productization-verification.jsonl` 里存在该记录（打印该行原文 + 行数）；载体副本删记录 ⇒ exit 1、移走载体 ⇒ exit 3，与 exit 0 并列留档。⇒ 见 `## Evidence` §AC6（85 行 + 记录原文 + exit 0/1/3 三条）。
- [ ] **AC7 全量套件绿 —— 外层 verification-round 验证**（worker 结构上被禁跑全量 suite；本条的量的产生处是 fan-in / 外层的 suite 轮，⛔ 不是 worker 自己的读数；scoped 门绿不等于全量绿）

## Definition of Done

**AC-247 在生产载体上的判据 exit 0**，且该记录是一次**真安装、真接管、真读数**的产物：带 `stale_days≥14` ∧ `pre_task_count>0` ∧ `post_task_count==pre` ∧ `build_sha` 非空 ∧ `driver_alive=1` ∧ `carrier_records>0`，`host` 与 `project_root` 都指向外部停摆项目。生产者步骤在缺任一读数时**不写记录**（缺值 ≠ 合格），且它的 liveness 读数与「start 退出码」「进程表」两种代理量**可区分**。

⛔ 以下不算达成：

- 用夹具 / 手写一条记录塞进载体（硬规则 4 推论三：能产出 ≠ 已产出；`stale_days≥14` 会直接判死当天现造）；
- 从 `quay driver start` 的退出码或 `ps` 派生 `driver_alive`；
- 新起一个项目冒充「停摆一月的存量项目」（`stale_days` / `pre_task_count` 是区分量）；
- 只在 worktree 的 `.quay/` 里自证，而生产 root 的载体上没有该记录；
- 把「读不出」写成 `driver_alive=0` 的记录（「没查成」被伪装成「查过且不合格」）。

## Evidence

**实现落点**：目标侧 `plugin/scripts/verify-deliver-coldstart.sh` 段⑧（`--ac247-takeover --takeover-root <dir>` → `step_ac247_takeover`，读数助手 `ac247_task_store_count` / `ac247_head_epoch` / `ac247_stale_days` / `ac247_probe_user_install` / `ac247_ps_stale_procs` / `ac247_read_driver_status`，写入点 `write_ac247_record`）；驱动侧 `plugin/scripts/develop-deliver-tgz.sh` 的 `--verify-takeover` → `verify_takeover_mode` + `validate_takeover_args`。提交：`9f5d96968`（实现）+ `8582ff8f1`（测试侧修复，见 §AC1/AC2 末段），落任务分支 `task/gap-ac247-stalled-project-clean-takeover-record`。

### AC3 —— ad-arm1 真跑（2026-09-12，C = ad-arm1.wan.hwang.men）

远端 stdout 全文落档：`/home/yale/work/quay/.quay/verify-takeover-remote-C-1d916698.log`；证据文件副本 `/home/yale/work/quay/.quay/verify-takeover-evidence-C-1d916698.jsonl`。

```
== ⑧ AC-247 takeover: current build takes over a ≥14-day-stalled legacy project ==
  [⑧a] PRE (taken BEFORE the takeover action) host=instance-20221019-1509 project_root=/home/yale/work/archguard
  [⑧a] PRE user-scope quay install=absent (absent|present|not-evaluated —— 三态, ⛔ 非布尔)
  [⑧a] PRE task_store_count=61 head_epoch=1787325178 stale_days=21.759 (at epoch 1789205195)
  [⑧a] PRE driver_alive=0 carrier_records=1 last_record_ts=2026-09-12T09:07:57.127Z (source: quay driver status --kind promotion --json)
  [⑧a] PRE ps-proxy quay_procs=7 (⛔ 代理量, 仅供与上面的 status 读数对照; 本步骤任何字段都不由它派生)
  [⑧b] install segment done: delivered CLI = /home/yale/quay-verify-takeover-1d916698.npm/lib/node_modules/quay/dist/quay.js (isolated prefix /home/yale/quay-verify-takeover-1d916698.npm, 目标机 user-scope 未被写入)
  [⑧c] takeover action: start the project's OWN promotion driver against /home/yale/work/archguard
  [⑧c] driver start rc=0 (⛔ 诊断量, 不是 liveness 读数)
  [⑧d] POST driver_alive=1 carrier_records=2 (pre=1) last_record_ts=2026-09-12T09:26:37.778Z (poll window 120s)
  [⑧e] POST task_store_count=61 (pre=61)
  [⑧f] ac247 record written → /home/yale/quay-verify-takeover-evidence-1d916698.jsonl ✓ (host=instance-20221019-1509 project_root=/home/yale/work/archguard pre=61 post=61 stale_days=21.759 driver_alive=1 carrier_records=2)
AC247_EVALUATED=1 · AC247_DRIVER_ALIVE=1 · AC247_CARRIER_RECORDS=2 · AC247_DRIVER_START_RC=0
VERIFY-RC 0
EVIDENCE-PATH /home/yale/quay-verify-takeover-evidence-1d916698.jsonl
EVIDENCE-LINES 3
```

驱动侧传输输出原文：
```
EVIDENCE-TRANSPORT appended=3 carrier=/home/yale/work/quay/.quay/productization-verification.jsonl evidence=/home/yale/work/quay/.quay/verify-takeover-evidence-C-1d916698.jsonl
develop-deliver: evidence-completeness COMPLETE present=1
develop-deliver: C (ad-arm1.wan.hwang.men) — declared ac set [GOAL-016-AC-247] transported into /home/yale/work/quay/.quay/productization-verification.jsonl ✓
develop-deliver: --verify-takeover OK — GOAL-016-AC-247 record transported into /home/yale/work/quay/.quay/productization-verification.jsonl
```

接管后的 `driver status --json` 原文（另一次读取）：
```
{"kind":"promotion","supervisor_pid":3287662,"driver_pid":3287671,"supervisor_alive":1,"driver_alive":1,"alive":1,"running":1,"carrier_path":"/home/yale/work/archguard/.quay/promotion-outcome.jsonl","carrier_records":4,"last_record_ts":"2026-09-12T09:27:38.734Z","supervisor_started_at":1789205197136,"supervisor_stale":"fresh"}
```
连带证据：接管后目标机的 user-scope 安装**仍然为缺**（`command -v quay` ⇒ ABSENT；`npm root -g` ⇒ `/home/yale/.local/opt/node-v24.19.0/lib/node_modules`，其下无 quay）——本次安装只落进隔离前缀，⛔ 没碰 user-scope。

### AC4 —— 进程表 vs status 载体（分歧留档）

同一时刻、同一台机器上两条读法给出**不同**的结论：

```
$ ps -eo pid,args | grep -c '[q]uay'          ⇒ 7   （含 4 条 21–26 天的陈旧进程）
  911812 26-18:09:38 bash -lc cd ~/quay-ac88-project/plugin/scripts; ...
  916014 26-18:01:28 bash /home/yale/quay-ac88-project/plugin/scripts/session-liveness.sh
1958965 21-18:19:04 node /home/yale/quay-verify-coldstart/verify-ac107-c-rerun.npm/lib/node_modules/quay/plugin//vendor/quay/dist/quay.js mcp
1959016 21-18:18:50 node /home/yale/work/archguard/.quay/runtime/bin/quay-native.js mcp
$ quay driver status --kind promotion --root /home/yale/work/archguard --json   ⇒ driver_alive:0（接管前）
```
⇒ 进程表说「有一堆 quay 在跑」，status 载体说「这个项目的 promotion driver 不活」——两者确实不同，记录用的是后者。`write_ac247_record` 体内不含 `AC247_DRIVER_START_RC`；`driver start` 的退出码只以 `driver_start_rc` 这个诊断字段落档。自检的结构控制 `ac247-liveness-source(from-AC203_DRIVER_ALIVE)=1 bad-assign-hits=0` 把这条钉在位置上（负控制：把右端换成 start 退出码，谓词翻成 0）。

### AC5 —— 存量不丢不增（同一实现读两次）

```
$ node <delivered quay> task list --root /home/yale/work/archguard --json | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'
pre  → 61   （接管前，[⑧a]）
post → 61   （driver 起来后，[⑧e]）
$ git -C /home/yale/work/archguard log -1 --format='%H %ct %cI'
14ea9e63d416a306fb4eac3d73151eae58687a56 1787325178 2026-08-21T15:12:58+00:00
```
接管动作**没有改动存量**（差值 0，既不丢也不增）。旁证——接管后该项目自己的 round 记录（`/home/yale/work/archguard/.quay/promotion-round.jsonl` 末行）：
```
{"ts":"2026-09-12T09:27:38.734Z","round":3,"run_id":"pm-prod-1789205197","pid":3287671,"action":"none","pool":0,"should_apply":false,"promoted_ids":[],"applied":[],"error":null,...,"halted":false,"gate":{"go":true,"reason":"=> GO: 资源充足，可以跑"},"liveness":{"checked":true,"deaths":null,"running":true}}
```
（`pool: 0` / `action: "none"` / `applied: []` ⇒ 这一轮没有翻任何任务状态，故 task 存量不变。）

### AC6 —— 生产 root 载体 + 判据三态

`/home/yale/work/quay/.quay/productization-verification.jsonl` 全载体 **85 行**，其中该记录**原文**：
```
{"build_sha":"1d9166985b3a78daf32af976884bd497ca14997d","ts":"2026-09-12T09:26:12Z","ac":"GOAL-016-AC-247","host":"instance-20221019-1509","project_root":"/home/yale/work/archguard","pre_task_count":61,"post_task_count":61,"stale_days":21.759,"driver_alive":1,"carrier_records":2,"carrier_records_pre":1,"stale_processes_ps":7,"driver_start_rc":0,"last_record_ts":"2026-09-12T09:26:37.778Z","user_install_pre":"absent","head_epoch":1787325178}
```

**逐字取 `goals/AC-247-*.md` 的 criterion 干跑**（payload 由该文件提取并折叠 YAML `>-` 块标量后喂 python，⛔ 不手抄一份；三条并列留档，证明 exit 0 来自记录内容而非环境）：
```
exit 0 : cd /home/yale/work/quay && python3 <criterion>                    → exit=0（无输出）
exit 1 : cd <tmp> && 载体副本 grep -v '"ac":"GOAL-016-AC-247"' 后跑同一条 → exit=1
         stderr: AC-247: carrier holds no qualifying GOAL-016-AC-247 record (need host != local hostname,
         project_root outside this repo, pre_task_count greater than zero, ... carrier_records greater than zero)
exit 3 : cd <tmp> && rm -f .quay/productization-verification.jsonl 后跑同一条 → exit=3
         stderr: AC-247 NOT-EVALUATED: carrier .quay/productization-verification.jsonl absent — cannot read driver-liveness evidence
```

### AC1 / AC2 —— 自检与逐字段来源

```
$ bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck           ⇒ PASS
  selfcheck: ac247-record(fields+anchor) ok=1 missing_fields='' anchor-literal-hits=0
  selfcheck: ac247-refusal(9 negative specs + boundary-14.000-accepted) negatives_all_refused=1
  selfcheck: ac247-task-store-count(61 via real node stub) ok=1 head/stale-unreadable-checks=0
  selfcheck: ac247-liveness-source(from-AC203_DRIVER_ALIVE)=1 status-read-hits=1 bad-assign-hits=0
$ bash plugin/scripts/develop-deliver-tgz.sh --selfcheck-takeover-transport ⇒ PASS
  （正：AC-247 证据 → appended=1 + COMPLETE；负：别的 ac → NOT-EVALUATED；负：缺失/零行 → NOT-EVALUATED；
    位置控制：transport + completeness 两个调用点都在 verify_takeover_mode 体内 hits=2）
```
三份测试全绿：`plugin/test/ac247-takeover-record.test.mjs`（4/4）、`plugin/test/verify-deliver-coldstart.test.mjs`（14/14）、`plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`（8/8）。其中 `ac247-takeover-record.test.mjs` 从 `goals/AC-247-*.md` **提取** criterion 正文并跑它的三态（0 / 1（stale_days=13.999 边界）/ 3），另断言 criterion 读的每个字段都被生产者写出（含反控制）。

**AC2 逐字段来源**（每条贴 `grep` 的【模式 + 命中原文】；⛔ **不引用行号**——行号随实现编辑漂移，本轮就漂过一次，引用它等于把一个生命周期短于判据本身的对象写进证据）：
```
field=host             grep 'AC247_HOST="$(hostname'              → AC247_HOST="$(hostname 2>/dev/null || echo '')"
field=project_root     grep 'AC247_PROJECT_ROOT="$(cd'            → AC247_PROJECT_ROOT="$(cd "$root" && pwd -P)"
field=pre_task_count   grep 'pre_count="$(ac247_task_store_count' → pre_count="$(ac247_task_store_count "$root" "$qrl" || true)"
                                                                  → AC247_PRE_TASK_COUNT="$pre_count"
field=post_task_count  grep 'AC247_POST_TASK_COUNT="$(ac247_task_store_count' → AC247_POST_TASK_COUNT="$(ac247_task_store_count "$root" "$qrl" || true)"
field=stale_days       grep 'AC247_STALE_DAYS="$(ac247_stale_days' → AC247_STALE_DAYS="$(ac247_stale_days "$head_epoch" "$AC247_PRE_TS_EPOCH" || true)"
                       两个时刻 : AC247_PRE_TS_EPOCH="$(date +%s)"
                       源头     : epoch="$(git -C "$root" log -1 --format=%ct 2>/dev/null || true)"
field=driver_alive     grep 'AC247_DRIVER_ALIVE='                 → AC247_DRIVER_ALIVE="$AC203_DRIVER_ALIVE"   ← probe_ac203_driver_status "$status_json"
field=carrier_records  grep 'AC247_CARRIER_RECORDS="\$AC203'      → AC247_CARRIER_RECORDS="$AC203_CARRIER_RECORDS"
                       源头     : status_json="$( (cd "$root" && node "$qrl" driver status --kind promotion --root "$root" --json) 2>/dev/null || true)"
field=build_sha        由 ac89_append_goal009 统一补（BUILD_SHA ← 本次投递 tgz 的 develop tip）
```
逐项命中数：`build_sha` 在 `write_ac247_record` 体内 = **0**（⛔ 没有第二个补锚点，自检 `anchor-literal-hits=0` 钉住）；`AC247_DRIVER_ALIVE` 的赋值语句只有 1 条，其右端就是 `$AC203_DRIVER_ALIVE`（`bad-assign-hits=0`）。写入路径里不存在任何字段的硬编码默认值。

**两处实现期实测（都值得记）**：

1. `ac247_task_store_count` 最初用 `console.log(j.length)`，在本仓库套件环境（`FORCE_COLOR` 置位）下 Node 会给**数字**加 ANSI 色 ⇒ 命令替换拿到的是 `\033[33m61\033[39m`，一切按字符串比较的判据当场恒假。改用 `process.stdout.write(String(...))`（⛔ 不走 console 的格式化层）。既有教训 `force-color-breaks-node-console-log-read-parsing` 的又一次现身。
2. `goal 的 criterion 是 YAML **折叠**块标量（`>-`）`，不是「把行拼起来」。第一版测试直接 join，在 criterion 的长行被重新换行后把源码换行**带进了 `"…"` 字符串字面量** ⇒ python 语法错 ⇒ exit 1 —— 而 exit 1 恰好就是「跑过了、没有合格记录」的取值，测试把它读成了判据违例（**同形**，硬规则 3b）。修复（`8582ff8f1`）按 `>-` 的三条规则折叠（同缩进折成空格 / 空行变换行 / 更深缩进保留换行），并**先 `ast.parse` 断言 payload 是合法 python 再信它** ⇒ 以后的折叠 bug 会响，而不是冒充判据结论。这个缺陷是 scoped 门（步骤 2b）抓到的，不是本机自测抓到的——本机自测当时是绿的，因为那时 criterion 恰好没有被重新换行。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/test/ac247-takeover-record.test.mjs (new)
- tasks/gap-ac247-stalled-project-clean-takeover-record.md
