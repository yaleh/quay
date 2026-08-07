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
invoke `bash plugin/scripts/<跨机观测脚本> observe --host <target> --root <path>`
control 故意让远程目标的 git ref 落后于人工制造的新提交，不 fetch 直接跑 observe()，输出必须已经是刷新后的值（不能是陈旧值）；若不是，说明"先 fetch 再比较"没有真正封装进去
resume 若中断，先跑 measure 读当前实现覆盖了 observe() 的哪些字段，不要假设全覆盖
```

## Acceptance Criteria

- [ ] AC1: 存在一个只读观测入口，本地/远程用同一套参数形状调用，贴出对本机与至少一台远程机器
      各跑一次的实测输出
- [ ] AC2: **负控制（承重条）**——复现"没先 fetch 就比较"的今晚真实场景（陈旧 ref），确认修复后
      的实现报出刷新后的正确值；若仍报陈旧值，本任务无效
- [ ] AC3: 覆盖今晚踩过的 4 类具体错误（fetch-before-compare / HEAD-vs-branch / 监视器缓存陈旧 /
      进程 comm 字段匹配），逐条贴出改前会错、改后不会错的对照
- [ ] AC4: 与 `supervisor-deliver.sh` 同等地位记录——本任务是它在读方向的对称实现，
      任务体需说明两者的调用形状是否应当统一（如 `supervisor-observe.sh` 命名对称），
      或说明为什么不统一
- [ ] AC5: 不引入新的调度源；机制位于 `plugin/` 之下且在 `quay-init` 铺设集里

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- tasks/gap-cross-machine-readonly-observation-orchestration-not-a-tool.md
- plugin/scripts/monitor-mount-check.sh
- plugin/scripts/session-liveness.sh
- plugin/scripts/supervisor-deliver.sh（对称关系交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-06T16:1xZ
changed: 尚未派发/审阅（人直接裁定立案并转外层，管理者代笔）
