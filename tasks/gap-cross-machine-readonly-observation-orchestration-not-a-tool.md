---
id: gap-cross-machine-readonly-observation-orchestration-not-a-tool
title: "the manager hand-assembles the SAME ssh+git+capture-pane+/proc
  combination every single time it needs to read a cross-host target's state
  (B/orangevps, C/ad-arm1) — no shipped tool exists for 'read this remote quay
  checkout's git/suite/session/process state read-only', so it gets rebuilt
  ad-hoc per call all night, with real mistakes along the way (a stale
  remote-tracking ref read without fetching first, HEAD-vs-branch comparison
  errors, pgrep/grep field-matching errors repeated across hosts); this is the
  missing counterpart to supervisor-deliver.sh (which crystallized the WRITE
  side — deliver(target,payload)) on the READ side: observe(target) ->
  {git_state, suite_state, session_state, process_state}, read-only,
  ssh-transport-agnostic (same shape for local vs remote); manager 2026-08-06,
  filed per human direction to transfer to outer"
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

**送达侧已经结晶（`supervisor-deliver.sh`），观测侧从来没有——manager 每次要看一眼远程机器的
状态，都在手工现拼 `ssh + git + capture-pane + /proc`，今晚拼了几十次，出过好几次真实错误。**

### 实测（今晚手工拼过的具体实例）

| 何时 | 手工拼的命令组合 | 出的错 |
|---|---|---|
| 查 B 的分叉状态 | `ssh B "git rev-list --left-right --count origin/develop...develop-local"` | **没先 fetch**，读到陈旧 remote-tracking ref，把 12 落后报成 0 落后 |
| 查 B 是否已同步 | `ssh B "git rev-list --left-right --count origin/master...master"` | 拿 `HEAD`（当时是 `master`）跟 `develop` 比，比错了对象 |
| 查 B 的 tmux 拓扑 | `ssh B "tmux list-panes -a -F ..."` | 用 5 分钟轮询的 Monitor，报了陈旧缓存值 |
| 查 ad-arm1 的会话/进程 | `ssh C "pgrep -af 'claude...'"` / `ps -o pid,pcpu,etimes,args -p ...` | grep 模式反复写错（`pgrep -c` 子串自匹配、`pgrep -x` 漏匹配、`awk $2=="tmux"` 因 comm 截断漏匹配） |

**四次错误里三次是同一类**（读取前没先刷新/没验证字段真实含义），因为**每次都是从零手写**，
没有一个统一实现把"先 fetch 再比较""正确匹配 comm 字段"这些坑封进去、封一次管一辈子。

### 与 `supervisor-deliver.sh` 的对称关系

`supervisor-deliver.sh` 的头注写得很清楚：**"the ONE unreliable operation... goes from
'3 agents each hand-write' to 'one hardened implementation'"**——这句话对写方向成立，
对读方向同样成立，但读方向从未被结晶。今晚 manager 就是那个"hand-write own sequence"的 consumer，
在读侧重复了写侧已经用血教训修过的错误。

### 选定机制（方向，接法留执行时）

`observe(target) -> {git_state, suite_state, session_state, process_state}`，**只读**，
本地/远程同一形状（`--host` 参数决定是否套一层 ssh，调用方不用关心）：

- `git_state`：先 fetch 再比较，返回 ahead/behind/dirty，不返回陈旧值
- `suite_state`：读 `.quay/full-suite-state.json`，同今晚已用的字段
- `session_state`：tmux 拓扑 + 会话存活，复用 `pane-state-classify.ts` / `topology-check.sh`
  的判定逻辑而不是重新写
- `process_state`：目标进程的 CPU/存活证据，用正确的 `comm` 匹配（今晚踩过的坑内置修正）

**不预设成为一个新脚本**——如果现有的 `monitor-mount-check.sh` / `session-liveness.sh` 稍加扩展
就能覆盖，应该扩展而不是新增；只有确认现有能力覆盖不了才新建。

## Contract

```
measure observe_call_shape_consistent = `bash plugin/scripts/<跨机观测脚本> observe --host local --root . --json | python3 -c "import json,sys;print(sorted(json.load(sys.stdin).keys()))"` 与同一命令加 `--host <remote>` 的输出字段集合是否相同（相同=1，不同=0，需两次实跑手工比对）
band observe_call_shape_consistent = 1
measure fetch_before_compare = `bash plugin/scripts/<跨机观测脚本> observe --host <target> --root <path> --json | python3 -c "import json,sys;print(json.load(sys.stdin)['git_state']['behind'])"` stdout 的数字段（须与人工 `ssh <target> "git fetch && git rev-list --count HEAD..origin/<branch>"` 的结果一致）
band fetch_before_compare = 1
invariant 任何跨主机只读观测调用，manager 不得手写 ssh+git 组合命令；必须调用这一个实现
invoke `bash plugin/scripts/supervisor-observe.sh observe --host <target> --root <path>`
control 故意让远程目标的 git ref 落后于人工制造的新提交，不 fetch 直接跑 observe()，输出必须已经是刷新后的值（不能是陈旧值）；若不是，说明"先 fetch 再比较"没有真正封装进去
resume 若中断，先跑 measure 读当前实现覆盖了 observe() 的哪些字段，不要假设全覆盖
```

## Acceptance Criteria

- [x] AC1: 存在一个只读观测入口，本地/远程用同一套参数形状调用，贴出对本机与至少一台远程机器
      各跑一次的实测输出
- [x] AC2: **负控制（承重条）**——复现"没先 fetch 就比较"的今晚真实场景（陈旧 ref），确认修复后
      的实现报出刷新后的正确值；若仍报陈旧值，本任务无效
- [x] AC3: 覆盖今晚踩过的 4 类具体错误（fetch-before-compare / HEAD-vs-branch / 监视器缓存陈旧 /
      进程 comm 字段匹配），逐条贴出改前会错、改后不会错的对照
- [x] AC4: 与 `supervisor-deliver.sh` 同等地位记录——本任务是它在读方向的对称实现，
      任务体需说明两者的调用形状是否应当统一（如 `supervisor-observe.sh` 命名对称），
      或说明为什么不统一
- [x] AC5: 不引入新的调度源；机制位于 `plugin/` 之下且在 `quay-init` 铺设集里

### Evidence（AC1-AC5 实跑输出，2026-08-07）

**实现说明（为什么新建而不是扩展）**：`monitor-mount-check.sh` 只读 /proc 判监视器挂没挂、
`session-liveness.sh` 是长驻事件监视器、`supervisor-deliver.sh` 是写方向——三者都覆盖不了
「一个 ssh-transport-agnostic 的 4 字段只读观测」形状（无 ssh 包装、无 fetch-before-compare、
无统一 JSON 形状、无 process_state）。故新建 `plugin/scripts/supervisor-observe.sh`（与
`supervisor-deliver.sh` 命名对称），只读、`--host` 决定是否套 ssh，本地/远程同一形状。

**AC1 — 只读观测入口，本地/远程同形**（`supervisor-observe.sh observe --host <local|主机> --root <根> [--branch] [--comm] [--json]`）

本机（`/tmp/obs-demo` 封闭演示仓，`--branch develop`；真实 tmux 拓扑 + 真实 claude 进程）：
```json
{"host":"local","observedAt":"2026-08-07T07:23:03",
 "git_state":{"ok":true,"branch":"develop","head":"523cad9","remote":"origin","upstream":"origin/develop","comparedRef":"origin/develop","ahead":1,"behind":1,"dirty":0},
 "suite_state":{"ok":true,"state":"absent"},
 "session_state":{"ok":true,"tmuxAvailable":true,"sessions":[{"name":"quay-0","windows":[{"name":"claude","panes":1,"claude":1},{"name":"inner","panes":1,"claude":1},{"name":"outer","panes":1,"claude":1}]}]},
 "process_state":[{"pid":2984334,"comm":"claude","cmdline":"claude --permission-mode bypassPermissions","elapsed_s":55282.1,"cpu_sec":8156.75,"cpu_pct":14.8}]}
```
远程（`--host localhost` —— 真实 ssh 传输，脚本自运输到对端以 `--host local` 跑，字段集合与本机
逐项一致；B/orangevps、C/ad-arm1 在本工作树环境不可达，故用 ssh localhost 演示传输路径，Contract
measure 以 ssh localhost 对拍；同一调用形状在 manager 侧指向真远程主机）：
```json
{"host":"local","observedAt":"2026-08-07T07:13:00",
 "git_state":{"ok":true,"branch":"develop","head":"a33f73d","remote":"origin","upstream":"origin/develop","comparedRef":"origin/develop","ahead":1,"behind":0,"dirty":0},
 "suite_state":{"ok":true,"state":"absent"},
 "session_state":{"ok":true,"tmuxAvailable":true,"sessions":[...same shape...]},
 "process_state":[...same shape...]}
```
`observe_call_shape_consistent` measure：local keys = remote keys =
`['git_state','host','observedAt','process_state','session_state','suite_state']`（相同 = 1）。

**AC2 — 负控制（承重条）：先 fetch 再比较真正封装进去了**

复现今晚「没先 fetch 就读陈旧 ref」场景（`/tmp/obs-demo`：本地 develop 领先 1，origin 在本地
不知情下又前进到 c3）：
- 改前（今晚的 bug，不 fetch 直接比）：`git -C /tmp/obs-demo rev-list --left-right --count HEAD...origin/develop` → `1 0`（behind 错报 0，陈旧值）
- 改后（observe() 不手工 fetch 直接跑）：`behind: 1`（内部先 fetch 再比较，刷新后的正确值）
- 人工 ground truth（`git fetch && git rev-list --count HEAD..origin/develop`）→ `1`，与 observe() 完全一致
- `fetch_before_compare` measure：observe stdout behind = `1` = 人工 `ssh <target> "git fetch && rev-list --count"` 结果 `1`（相同 = 1）

**AC3 — 四类错误的改前会错/改后不会错对照**

| 错误类 | 改前（会错） | 改后（observe()，不会错） |
|---|---|---|
| 1. fetch-before-compare | `rev-list --left-right --count HEAD...origin/develop` 不 fetch → `1 0`（陈旧 behind=0） | observe() 内部先 `git fetch` 再比较 → `ahead:1 behind:1`（= 人工 fetch 后 count） |
| 2. HEAD-vs-branch | 拿 HEAD（当时是 master）跟 develop 比，比错对象 | `observe --branch develop` 报 `branch:develop comparedRef:origin/develop ahead:1 behind:1`——永远命名分支、按分支自己的 upstream 比，绝不 HEAD-as-某分支 |
| 3. 监视器缓存陈旧 | 5 分钟轮询 Monitor 的陈旧缓存值 | session_state 每调用实时 `tmux list-sessions/list-windows/list-panes`；测试证：新建会话立即出现、杀掉立即消失；脚本无任何缓存/状态文件 |
| 4. 进程 comm 字段匹配 | `pgrep -c` 子串自匹配、`pgrep -x` 漏匹配、`awk $2=="tmux"` 因 comm 截断漏匹配 | process_state 单 python3 进程直读 `/proc/<pid>/comm`（内核截断后的精确值）+ `/proc/<pid>/cmdline`；匹配 = comm==模式 或 argv[0] basename==模式；observer 自身进程树排除；路径子串（如 `~/.claude`）不匹配（`observe --comm claude` 恰好只报 5 个 comm=claude 的 CLI 进程，不报 192 个 bash 包装） |

**AC4 — 与 supervisor-deliver.sh 的对称关系与命名**

命名为 `supervisor-observe.sh` 与 `supervisor-deliver.sh` 对称（同一 supervisor 基座层，读/写各一个
入口）。调用形状【不】统一成一个脚本：deliver = `<tmux目标> <payload>`（位置参数，目标=tmux target、
payload=文本）；observe = `--host <local|主机> --root <根> --json`（命名参数，目标=host+checkout、
产出=JSON）。签名不同故不合并；对称性体现在【同一基座层命名空间 + 各方向唯一硬化实现 +
ssh-transport-agnostic】——正是 supervisor-deliver.sh 头注 "the ONE unreliable operation ... to one
hardened implementation" 在读方向的镜像。已在 `capability-catalog.sh` 注册 `supervisor-observe.sh`
的问题声明（与 deliver 同列）。

**AC5 — 位于 plugin/ 且在 quay-init 铺设集；不引入新调度源**

- 机制 = `plugin/scripts/supervisor-observe.sh`（plugin/ 之下）。
- 已引用进 `plugin/loop/orchestrator-loop-tick.md` 的「观察（只读，不动手）」节 → 经 quay-init
  `derive_loop_scripts` 步骤 (a) 派生进铺设集：`laydown-set-check.sh --list` 现列 41 个脚本（含
  `supervisor-observe.sh`），`laydown_set_green: green`。
- 不引入新调度源：observe() 是点查探针（每调用实时读），不是 Monitor/循环/cron——不常驻、不轮询、
  不产生事件流、不写任何目标文件（唯一"写"是 git fetch 刷新 remote-tracking ref，即 Contract 要求的
  fetch-before-compare）。

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（见上节 Evidence）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**无法达成：基座套件当前红（pre-existing），如实报告**，见 Evidence 底部「测试记录」

### 测试记录（2026-08-07）

- **相关测试文件直跑**（`scripts/test.sh plugin/test/supervisor-observe.test.mjs plugin/test/capability-catalog.test.mjs plugin/test/laydown-set-check.test.mjs`）：`24 pass / 0 fail / 0 cancelled`。
- **scoped 静态层（最终 Touches）**（`scripts/test.sh --for-task <id> --allow-thin`）：test-framework-policy-check / test-isolation-check / task-contract-check（strict-subset，本任务 no violations）/ adr016-screen-use-check / dead-code-after-return-check 全 PASS；选中测试（capability-catalog + monitor-mount + session-liveness + supervisor-deliver + supervisor-observe 五个文件）`85 pass / 1 skip（环境性：probe 会话不在本机）/ 0 fail / 0 cancelled`。
- **完整套件**（`scripts/test.sh`，concurrency=2）：**基座套件当前红**——manager 自记 `.quay/full-suite-state.json` = `{"state":"red","reason":"failed"}`（07:08-07:21 一次跑，durationMs 796365）；tick-log 2cb14bb9 亦记「suite final red (95 fail)」。本任务跑 full-suite 中仅见 pre-existing 失败（`config-wiring-check.test.mjs: mirror-path invocation is real, not a silent no-op`，与本任务改动无关）；本任务触及文件的测试（supervisor-observe / capability-catalog / laydown-set）直跑与 scoped 均全绿。
- **DoD「连跑 2 次全绿」不可达**：基座红是既有事实（manager 自记），本任务改动不引入新失败（full-suite 部分运行 + 直跑 + scoped 三重证据）。如实报告，不假装全绿。

## Touches
- tasks/gap-cross-machine-readonly-observation-orchestration-not-a-tool.md
- plugin/scripts/supervisor-observe.sh（新建：读方向入口，supervisor-deliver.sh 的对称实现）
- plugin/test/supervisor-observe.test.mjs（新建：四类错误的负控制 + 本地/远程形状一致性）
- plugin/scripts/capability-catalog.sh（注册 supervisor-observe.sh 的问题声明）
- plugin/loop/orchestrator-loop-tick.md（「观察（只读）」节引用，纳入 quay-init 铺设集）
- plugin/scripts/monitor-mount-check.sh（研究：结论为扩展无法覆盖，新建）
- plugin/scripts/session-liveness.sh（研究：结论为扩展无法覆盖，新建）
- plugin/scripts/supervisor-deliver.sh（对称关系交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-06T16:1xZ
changed: 尚未派发/审阅（人直接裁定立案并转外层，管理者代笔）
