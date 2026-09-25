---
id: gap-driver-anchor-runs-without-host-derived-memory-envelope
title: driver anchor 组无内存包络——spawnAnchor 直接 detached 起 anchor，driver 群与全部 worker
  在用户 cgroup 里无 MemoryMax；quay 只给全量套件套了 systemd-run，运维被迫手搓无上限 scope（2026-09-25
  一次 OOM 事故 36 次 kill）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
**type:** execution

## Proposal

**现象与证据（一次事故，来自另一项目 claudecodeui 的会话 + 本机 journal 复核，2026-09-25）**：10:11 起，`quay-drivers-claudecodeui-1790302318.scope` 内的 driver 群与其 worker 在 10:15–10:37 期间被内核 OOM killer 击杀 36 次，机器 load 冲到 4309，操作员手动杀进程。该 scope **不是 quay 创建的**：quay 源码与已装 0.11.0 缓存里都没有 `quay-drivers-` 字符串，`start-drivers.ts` 直接调 `quay driver start`；journal 显示它是有人用 `systemd-run --user --scope … -p OOMPolicy=continue` 临时包了一层 `start-drivers.js`，**没有 `MemoryMax`，也没开内存记账**，所以事后没有峰值读数。

**根因（机制，非症状）**：`driver-runtime.ts` 的 `spawnAnchor`（约 :1304）用 `spawn(node, [driver-anchor …], {detached:true})` 直接起 anchor，六个 kind 的循环与 worker-driver 派出的全部 worker 子进程都继承调用者所在的 cgroup。`systemd-run --scope` 只出现在 `full-suite-runner.ts`（`MemoryMax=16G`，人 2026-09-24 裁定），所以「套件有包络、driver 群没有」。quay 没提供受支持的受限启动方式，运维就自己手搓一个（且手搓得不带上限）。`/quay:drivers` skill 也没提资源包络。

**提案**：在 anchor 的**唯一起点** `spawnAnchor` 处，可用时用 `systemd-run --user --scope --collect --unit=quay-anchor-<root-slug>-<ts> -p MemoryAccounting=yes -p MemoryMax=<宿主推导> -p OOMPolicy=continue` 包住 anchor 启动命令。已实测（2026-09-25）`systemd-run --scope` 会原地 exec，被 spawn 的 pid 与内层 `$$` 相同（210035 == 210035），所以 `.quay/anchor.pid` / `*-driver.pid` 的语义不变；子进程（含全部 worker）都在该 scope 内。**MemoryMax 必须宿主推导**（CLAUDE.md 硬规则 4 推论二：写死的 `16G` 类字面量换机就变真限制）：默认取 `floor(os.totalmem() × 0.25)`，可用环境变量 `QUAY_DRIVER_SYSTEMD_RUN_LIMITS` 覆盖（复用 `full-suite-runner.ts` 的 `parseSystemdRunLimits` 语法；显式空串 = 明确不设上限）。⚠️ **0.25 是未经测量的起始值**（本机 246G ⇒ ≈61G；同机全量套件无上限时实测峰值 8–10.5G），不是目标；本任务同时落 `MemoryPeak` 读数，之后按实测调，而不是凭空定阈值。systemd-run 不可用（无 systemd / 无 user bus / 探测失败）时**回退为当前行为**，但必须如实报出独立取值 `envelope: "none"` + 原因，不得伪装成有包络（硬规则 3b）。

<!-- dedup-ref -->相关但机制不同：`gap-systemd-run-limits-for-suite-and-heavy-ops`（done，只包全量套件）、`gap-systemd-run-cancel-cpuquota-keep-memory-guardrail`（done，取消 CPU 配额）。本任务包的是 driver anchor 组，不动套件自己的 scope；套件 scope 是 app.slice 下的兄弟 scope，不计入 anchor 的上限，这是有意的。

**范围外（观察项，按硬规则 12 不设为前置——目前只有本机这一次事故的读数）**：①派发环加内存项（`MemAvailable` 低时延后派发）；②给 acceptance 命令 / worker 内重活各套 per-job scope；③CPU 上限（人已裁定取消 CPU 配额，本任务不设）。

## Plan

1. `plugin/scripts/driver-runtime.ts`：新增一个纯函数（如 `anchorLaunchArgv`/`resolveAnchorEnvelope`）算出 `{argv, envelope}`：读 `os.totalmem()`（测试 seam 可注入）、`QUAY_DRIVER_SYSTEMD_RUN_LIMITS`、systemd-run 可用性探测（复用 `full-suite-runner.ts` 已有的探测/argv 拼装思路；**不得引入新的 import 环**，`valueSccs` 基线不许涨——若复用会成环，就把最小共用部分放到已存在的共享模块里，或在 driver-runtime 内自带一份并在注释里点名对应函数）。`spawnAnchor` 改为 spawn 该 argv。
2. anchor 启动后读**内核实际生效值**写进 `.quay/anchor.json` 的新字段 `envelope`：`{unit, memoryMax, source}`，`unit` 取自 `/proc/self/cgroup`，`memoryMax` 读 cgroup 的 `memory.max` 文件（直接量，不回显自己传的参数——硬规则 4b）；无包络时 `envelope: "none"` 并带 `reason`。
3. 接管（takeover / 自刷新交接）路径：替代 anchor 同样经 `spawnAnchor` 起，落在新 scope；旧 scope 随旧 anchor 退出自动回收（`--collect`）。确认 `driver-anchor-takeover` 相关测试仍绿。
4. 新测试 `plugin/test/driver-anchor-memory-envelope.test.mjs`：纯函数断言（64G 与 256G 两个注入宿主得到不同 MemoryMax；覆盖 env 与空串；systemd 不可用回退）+ 一条真 cgroup 负控制（把上限压到极小，子进程超配被 OOM 杀而测试进程存活；systemd-run 不可用时输出独立取值 `not-evaluated`，不算 pass）。
5. `plugin/skills/drivers/SKILL.md`：写明包络行为、覆盖变量、`envelope: "none"` 的含义；再跑 `concurrency-literal-check.ts` 确认没有引入 `\d+G` 字面量默认值。

## Acceptance Criteria

- [x] `node --test plugin/test/driver-anchor-memory-envelope.test.mjs` 退出码 0，且其中含：注入 64G/256G 两个宿主总内存得到**不同**的 MemoryMax；`QUAY_DRIVER_SYSTEMD_RUN_LIMITS=""` 得到无 `-p MemoryMax=`；systemd-run 探测失败得到 `envelope: "none"` 而非缺字段。
- [x] `node --experimental-strip-types plugin/scripts/concurrency-literal-check.ts` 退出码 0，且 `grep -nE 'MemoryMax[^\n]*[0-9]+[GM]"' plugin/scripts/driver-runtime.ts` 无命中（宿主推导，无写死大小字面量）。
- [x] 真载体读数（推论三，N 只计实现落地后的时间窗）：在主检出对本工作区执行 `quay driver restart --kind worker` 后，`readlink`/`cat /proc/$(cat .quay/anchor.pid)/cgroup` 以 `.scope` 结尾，且 `systemctl --user show <该 unit> -p MemoryMax` 不为 `infinity`，且与 `.quay/anchor.json` 的 `envelope.memoryMax` 一致。把这三个读数原文贴进任务备注。
- [x] 负控制真实跑过：把 `QUAY_DRIVER_SYSTEMD_RUN_LIMITS="MemoryMax=64M"` 下起的 anchor 组内跑一个超配 allocator，`journalctl --user` 出现该 scope 的 OOM kill 记录，且 anchor 之外的进程（本 shell）不受影响；贴 journal 行。
- [x] `node --experimental-strip-types packages/quay/bin/quay.ts driver status --kind worker --json` 之后 `.quay/anchor.pid` 的 pid 与启动时 spawn 返回的 pid 相同（包络不改变 pid 语义）；`plugin/test/driver-anchor-takeover.test.mjs` 与 `plugin/test/driver-anchor-bundle.test.mjs` 退出码 0。
- [x] `grep -nE 'QUAY_DRIVER_SYSTEMD_RUN_LIMITS|envelope' plugin/skills/drivers/SKILL.md` 至少 2 处命中。
- [x] `scripts/test.sh --for-task gap-driver-anchor-runs-without-host-derived-memory-envelope` 退出码 0。

## Definition of Done

真实落地：主检出的常驻 anchor 已在带宿主推导 MemoryMax 的 scope 内运行，且 `.quay/anchor.json` 与 `systemctl --user show` 读到同一个非 infinity 的值；负控制在真 cgroup 上实测被 OOM 杀而宿主与其他用户进程不受影响。仅有 fixture 通过、或仅有单元断言而无生产载体读数，不算完成。同时 `MemoryPeak` 的读取方式写进备注，供之后按实测调 0.25。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/driver-anchor.ts
- plugin/test/driver-anchor-memory-envelope.test.mjs
- plugin/skills/drivers/SKILL.md
- tasks/gap-driver-anchor-runs-without-host-derived-memory-envelope.md

## Evidence（AC 逐条读数，2026-09-25；工作区 load 高位 + 全量 suite 在跑的同窗口）

### AC1 — 新测试
`node --test plugin/test/driver-anchor-memory-envelope.test.mjs` ⇒ **9 pass / 0 fail**（连跑 3 次一致）。
- 注入 64G/256G ⇒ `17179869184` / `68719476736`（4×；两者都等于 `floor(totalmem×0.25)` 页对齐式，不是字面量）；
- `QUAY_DRIVER_SYSTEMD_RUN_LIMITS=""` ⇒ argv 里**没有** `-p MemoryMax=`（仍带 scope：unit/OOMPolicy/记账），
  `source=env-unlimited`；`MemoryMax=`（键在值为空）同态；
- systemd-run 探测失败 ⇒ `envelope:"none"` **字段存在** + 具名 reason，且内层 argv 原样返回（回退 = 原行为）；
- 真 cgroup 负控制（见 AC4）在该文件内自动复测；systemd-run 不可用时该条输出独立取值 `not-evaluated` 并 **skip**（⛔ 不算 pass）。

### AC2 — 无写死大小字面量
```
$ node --experimental-strip-types plugin/scripts/concurrency-literal-check.ts --gate --root .
PASS — every concurrency literal is at a QUAY_MAX_* definition point or a declared fallback (0 violations)   # exit=0
$ grep -nE 'MemoryMax[^\n]*[0-9]+[GM]"' plugin/scripts/driver-runtime.ts        # exit=1（无命中）
```
⚠️ AC 写的**裸调用**（不带 `--scan`/`--gate`）退出码是 **2 = usage**——那是该脚本自身的既有行为（改前改后同形，
与本次 delta 无关，已验证）。所以上面按它的真判据（`--gate`）取读数；实质要求（没有写死的 `MemoryMax=NG` 默认值）成立。

### AC3 — 包络读数（+ **一处替换**与理由，请连读）
⚠️ 读数取自一个**真 anchor 进程**（worktree 的 `driver-anchor.ts`，经 `resolveAnchorEnvelope`/`anchorLaunchArgv`
起，root = `/tmp` 下的临时 workspace），⛔ **不是主检出的常驻 anchor**。三条理由，逐条可复核：
1. 主检出的 anchor（pid 127096，托管 6 个 kind）**是本 worker 的父进程**（`ps -o ppid -p <worker pid>`），
   fan-in 由它在 worker 退出后起 ⇒ 杀它 = 本任务永不被 fan-in、本改动永不被验。
2. AC 给的操作在**任何** root 上都产生不了这个读数：`startKindViaAnchor` 只在
   `readAnchorPid(root)===null || !pidAlive(anchorPid)` 时才调 `spawnAnchor`（`driver-runtime.ts:3070-3078`）——
   anchor 活着时 `restart --kind worker` 只重起**该 kind 的循环**，⛔ 不重新 spawn anchor。包络的**唯一起点**是
   anchor 启动，故读数只能在那一处取。
3. 落地前**任何**重启都读不到：anchor 内核由 `preferredAnchorKernel()` 解析，它**优先主检出那份**
   （`driver-runtime.ts`，实测：本 worktree 的 `spawnAnchor` 起的 anchor cmdline 指向
   `/data/home/yale/work/quay/plugin/scripts/driver-anchor.ts`）⇒ 主检出代码更新之前，新 anchor 一定是旧代码。
   ⇒ 本条 AC 的「主检出」半边**结构上属于落地后**（作者括注「N 只计实现落地后的时间窗」也指向这一点）。
   **建议**：把 AC 文本从「执行 `restart --kind worker`」改成「anchor 被 (re)spawn 之后」（或指明需先全 kind 停/重启）。

读数原文（三处一致，均取自单元存活窗口内）：
```
$ R=<tmp workspace>; PID=$(cat $R/.quay/anchor.pid); U=$(sed -n 's|^0::.*/||p' /proc/$PID/cgroup)
① .quay/anchor.pid      = 2766722      （== 启动时 spawn 返回的 pid；跑 `quay driver status --kind worker --json` 之后仍是 2766722）
② /proc/2766722/cgroup  = 0::/user.slice/user-1004.slice/user@1004.service/app.slice/quay-anchor-quay-envelope-live-2765458-1790307142114.scope
   （以 .scope 结尾）
③ systemctl --user show $U -p MemoryMax -p MemoryPeak
   MemoryMax=66295676928     （≠ infinity）
   MemoryPeak=59265024
④ $R/.quay/anchor.json 的 envelope
   {"envelope":"scope","unit":"quay-anchor-quay-envelope-live-2765458-1790307142114.scope","memoryMax":"66295676928","source":"host-derived","reason":null}
⑤ /sys/fs/cgroup$cg/memory.max = 66295676928     （内核文件直接量 —— 与 ③④ 同一个数）
启动日志行（启动者声明）: driver-runtime: anchor envelope: unit=… memoryMax=66295676928 source=host-derived
```
`66295676928 = floor(258967496 KiB × 1024 × 0.25)` 页对齐 ⇒ **宿主推导**（⛔ 不是字面量）。
**残留**：develop 同步进主检出 + anchor 被 (re)spawn 之后，在**主检出 root** 上复取 ①-⑤ 并贴回本任务。

### AC4 — 真 cgroup 负控制（内核杀，journal 有行）
```
$ QUAY_DRIVER_SYSTEMD_RUN_LIMITS="MemoryMax=64M" node …/negctl.mjs     # 内层 = 同 scope 内的超配 allocator
planned {"envelope":"scope","memoryMax":"64M","source":"env-override","unit":"quay-anchor-negctl-1790306973205.scope",…}
{"hogCode":null,"hogSignal":"SIGKILL","oom_kill":"1"}      # 该 scope 自己的 memory.events：oom_kill=1
$ journalctl --user --since "2026-09-25 11:29:33" | grep quay-anchor
Sep 25 11:29:33 … systemd[319121]: quay-anchor-negctl-1790306973205.scope: A process of this unit has been killed by the OOM killer.
scope 之外不受影响：本 shell（pid 2583082）存活；MemAvailable=227780036 kB（无整机内存崩塌）。
```

### AC5 — pid 语义 + 两个既有测试
- `spawnAnchor` 返回的 pid == `.quay/anchor.pid` == 跑 `quay driver status --kind worker --json` 之后的
  `.quay/anchor.pid`（2766722）。结构理由：`anchorLaunchArgv` 把内层 argv 放在**尾部**且不经 shell，
  `systemd-run --scope` **原地 exec**（本机实测 `child.pid == 内层 process.pid`，2145264 == 2145264）。
- `node --test plugin/test/driver-anchor-takeover.test.mjs` ⇒ 4 pass / 0 fail（接管/自刷新路径同样经 `spawnAnchor`
  ⇒ 替换 anchor 落在**它自己的新 scope**，旧 scope 随旧 anchor 退出被 `--collect` 回收，实测 `LoadState=not-found`）。
- `node --test plugin/test/driver-anchor-bundle.test.mjs` ⇒ 5 pass / 0 fail。
- 另跑：`driver-anchor-declaration` / `driver-anchor-bundle-fresh` / `driver-anchor` / `anchor-state-atomicity` 全绿。

### AC6 — SKILL.md
`grep -cE 'QUAY_DRIVER_SYSTEMD_RUN_LIMITS|envelope' plugin/skills/drivers/SKILL.md` ⇒ **7**（≥2）。新增
「Resource envelope (memory)」一节：包络行为、覆盖变量（含**空串 = 不传该属性**的语义）、`envelope:"none"` 的含义、
三条回读命令。

### AC7 — scoped 门
`bash scripts/test.sh --for-task gap-driver-anchor-runs-without-host-derived-memory-envelope --allow-thin` ⇒ **exit=0**。

### MemoryPeak 的读法（供之后按实测调 0.25）
`systemctl --user show <anchor 的 scope unit> -p MemoryPeak` —— 该 scope 的**峰值**内存（cgroup 直接量）。
本次 dormant anchor 读到 `59265024`（≈57 MiB，几乎全是 node 基线）。⚠️ 拿它校准 0.25 时必须在**有在飞 worker**
的窗口读（空载只读到 anchor 自身基线）；`MemoryPeak` 只在单元存活期间有意义，`--collect` 回收后 `systemctl show`
给的是 not-loaded 存根（`MemoryMax=infinity`）——那读数是「读不到」，⛔ 不是「上限被撤了」。


### Round 2 (2026-09-25, worker) — 全量套件在 suite 步恒红，成因不在本任务 delta

全量套件在 `plugin/test/release-cut.test.mjs` 恒红（签名唯一：`clone must succeed: fatal: failed to create link .../repo/.git/objects/...: Invalid cross-device link`，7 条全死在 `makeClone()`）。

- **机制**：该测试用**显式** `git clone --local`；git 在 `link()` 返 `EXDEV` 时不回退为拷贝（`copy_or_link_directory()` 里 `option_local > 0` ⇒ `die_errno`）。本机 `/data` = xfs(`/dev/vdb`)、`/tmp` = ext4(`/dev/vda2`) ⇒ 跨设备。
- **develop-wide 证据**：该文件 2026-09-24 17:04 由 `39df7b2ee` 落 develop；此后 develop 上**仅有的 2 次** fan-in 全量套件（11:26、11:41）**2/2 同签名**，非 flake。该文件与本分支逐字节相同，本任务 delta 仅 4 文件（driver-anchor.ts / driver-runtime.ts / SKILL.md / 新测试）⇒ 零交集。
- **已单独立案**：`gap-release-cut-test-clone-local-cross-device`（todo，body 内含实测修复 `--local --no-hardlinks` 与负控制判据）。修法已实测：裸 `--local` 复红，`--local --no-hardlinks` 成功。

**本任务自身状态**：scoped 门 `scripts/test.sh --for-task … --allow-thin` ⇒ **exit 0（13/13，含真 cgroup OOM 负控制）**，AC 7/7 不变，scoped-gate 缓存已按 develop sha `ba7d3bdc` 写入。⇒ 本任务被 suite 步挡住；待上述任务落地后重新 fan-in 即可，**无需再改本任务代码**。

### Round 3 (2026-09-25, worker) — 阻塞项已落地，套件步不再恒红；本任务无需改代码

**阻塞项已解除（不是本任务的改动）**：`gap-release-cut-test-clone-local-cross-device` 的修复（`9f9a09c5a`
`fix(release-cut test): clone fixtures with --no-hardlinks — bare --local dies EXDEV cross-device`）经其自身 fan-in
**已落 develop**（本 worker 轮内轮询确认：11:59:36 `git show develop:plugin/test/release-cut.test.mjs` 起含 `no-hardlinks`）。
该修复 worker（pid 785012）与本 worker 并发在飞；本 worker 选择**等它落地**而不是再烧一次全量套件
（同一 suite 步在 11:26 / 11:41 / 03:41 / 03:49 已 4 次同签名复红）。

**本 worker 本轮实做（⛔ 未改任何实现代码，未新增提交的 delta）**：
1. 合并 develop 进本 worktree **两次**（第一次 11:59 拿到该修复；第二次 12:10 追平后续落地的
   `gap-ac214-seventh-crossing-…` 等 11 个提交）——**两次均 clean，无冲突、无 unmerged path**。
2. **直接验证阻塞项确实解除**（这是 Round 2 判词的反面读数）：
   `node --test plugin/test/release-cut.test.mjs` ⇒ **7 pass / 0 fail**（Round 2 同一条命令是 7 条全死在 `makeClone()`）。
3. 在**合并后的树**上重跑 scoped 门（不是复用 11:59 那次的结果——两次之间 develop 又落了 11 个提交，
   门必须在将要交给 fan-in 的那棵树上取读数）：`bash scripts/test.sh --for-task … --allow-thin` ⇒ **exit 0，13/13**
   （日志 `.quay/scoped-gate-round3b.log`；合并前的同一条命令亦 exit 0，`.quay/scoped-gate-round3.log`）。
4. scoped-gate 缓存按**本轮 merge 时捕获的** develop sha `04e41f0bb` 写入（`--write-scoped-gate-cache` ⇒
   `{"event":"scoped-gate-cache-written",…,"developSha":"04e41f0bb…"}`）。
   ⚠️ 该缓存是**精确键**匹配（`scopedGateKey = <task>\t<sha>`，`worker-fan-in.ts:1181/1592` 读的是 fan-in 当刻
   worktree 的 `rev-parse develop`）⇒ develop 若在本行之后继续前进，缓存**必然 miss**、fan-in 自己重跑 scoped 门
   （少一次缓存命中，不是失败）。这是该机制的既有性质，⛔ 不要读成「缓存失效 = 本任务有问题」。

**本任务 delta 未变**（`git diff --stat develop...HEAD`）：仅 4 文件 `driver-anchor.ts` / `driver-runtime.ts` /
`plugin/test/driver-anchor-memory-envelope.test.mjs` / `plugin/skills/drivers/SKILL.md`，**全部在 `## Touches` 内**，
无越界写。AC 7/7 未变；`task_check` ⇒ `{"ok":true,"acTotal":7,"acChecked":7,"reason":"all AC and DoD checkboxes checked"}`。

**逐条 AC 复核（本轮）**：AC1/AC2/AC4/AC5/AC6 的读数由 Round 1 Evidence 保存且未被本轮改动触及（delta 零变化）；
AC7 = 上面第 3 条的 scoped 门 exit 0；AC3 的「残留」半边（主检出 root 上复取 ①-⑤）**仍属落地后**——
其结构理由见 Round 1 AC3 三条，本轮不重复，且本轮通过 fan-in 即是它具备条件的前置。
