---
id: gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only
title: serve 宿主没有"加载版本 vs 已安装版本"读数——driver status 的 loaded_version 只覆盖
  anchor，/health 的 latestCodeCommitAt 对已安装产物恒为 null
status: ready
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**症状(2026-10-06,cantus 实测)**:插件 pin 于 11:22:42Z 从 0.15.0 换成 0.16.0,anchor 四个 driver 仍跑 0.15.0(`quay driver status --kind worker` 正确报出 `loaded-version-behind: loaded=0.15.0 installed=0.16.0`),而同一 workspace 的 `quay serve` 宿主没有任何等价读数,无从知道它跑的是哪一版。

**机制(已读代码)**:
1. `plugin/scripts/driver-runtime.ts` 的 loaded-version 读数(约 2455 行起;状态 current/behind/ahead/not-evaluated,来源 `/proc/<pid>/cmdline`)针对 anchor/driver,没有针对 serve 宿主的调用。
2. serve 的 `/health` 暴露 `latestCodeCommitAt`/`evaluated`(`packages/quay/src/serve.ts` 约 212-250 行):它读 workspace 中 serve 源码的 git 提交时间并与进程启动时间比(`isStale`);对装在插件缓存里的第三方项目,workspace 里没有 quay 源码提交,输入恒为 null ⇒ `evaluated:false`——对已安装产物结构上取不到,与 anchor 曾经恒报 `supervisor_stale=fresh/unwatched` 同形。`plugin/scripts/start-drivers.ts` 的 STALE⇒重载分支用的同一个时间比较,不是版本号。
3. 输入其实够用:serve 宿主的 `/proc/<pid>/cmdline` 是真实版本目录(`plugin/bin/quay` 用 `cd -P` 解析真实路径,2026-10-06 实测 pid 4000576 的 cmdline 为 `node …/cache/quay/quay/0.16.0/vendor/quay/dist/quay.js serve`)。缺的只是有人去读。

**修法**:serve 宿主增加与 anchor 同一套的 loaded-version 读数——**复用** driver-runtime 的读版本逻辑(⛔ 不复制一份),对象为 `.quay/server.json` 载体里的宿主 pid;在 `quay server status`(`packages/quay/src/cli/server.ts`,JSON 与人读输出)中输出 `loaded_version`(current/behind/ahead/not-evaluated)、`loaded`、`installed`、`source`(proc-cmdline)。cmdline 读不出版本目录(例如符号链接路径、进程已死、非 Linux)⇒ `not-evaluated` 并给原因,⛔ 不与 `current` 同形。只报告,⛔ 不自动重启。注意 Core(`packages/quay`)不得静态依赖 plugin 层,需经现有动态解析手段(`plugin-root.ts` 的 `resolvePluginScript*`)取用 driver-runtime 的读版本函数,或把该纯函数提到 Core 与 plugin 共享的位置——由实现者选,AC 约束行为与单一实现。

**不在范围**:自动重载 stale 宿主;serve 进程级监管与 systemd 单元模板;/health 的 latestCodeCommitAt 语义改造(保留,另案)。

<!-- dedup-ref -->相关(追溯,非前置):gap-driver-status-loaded-vs-installed-version-drift(done,anchor 的 loaded_version);gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it(done,`pointer` 读数)。

## 实现（落地形态）

修法两条路里选了**第二条**：把该纯读数提到 Core 与 plugin 共享的位置。新增
`packages/quay/src/loaded-version.ts`，`plugin/scripts/driver-runtime.ts` 删掉本地那份、
改为从 Core **import 并原样再导出**（`plugin/` → `packages/` 是受认可方向；Core ⛔ 不得静态 import plugin）。

⛔ 没走「从 Core 动态 import 内核」那条路，理由有两条（都是判据可信度问题，不是风格）：
① 内核经 `resolvePluginScriptExec` 解析，而 `plugin-root.ts` 约束 ① 规定**从 linked worktree 加载的模块
重定位到主检出** ⇒ 在任务 worktree 里跑，读数会反映**主检出**的代码而不是被测代码；
② 运行时 import 内核会把整个内核闭包拖进一条 status 命令。

顺带关掉一条已登记的例行发现：`driver-runtime.ts` 里那份手搓的
`fs.readFileSync('/proc/<pid>/cmdline') + NUL split` 被删掉，改为复用 kernel leaf
`packages/quay/src/kernel/proc-identity.ts::readProcCmdline`（`.quay/routine-findings.jsonl` 的
`driver-runtime-handrolled-proc-cmdline`，routine `semantic-dedup-scan`，2026-09-29，suggestedAction=merge）。

版本推导在原「① plugin root 的 VERSION」与「③ 路径里的版本段」之间新增第 **②** 级：用路径里的版本段
**锚定版本目录**，从它的 `VERSION`/`.claude-plugin/plugin.json` 读——serve 的 vendor bundle 布局
（`…/cache/quay/quay/<x.y.z>/vendor/quay/dist/quay.js`）下 ① 的上跳落在 `…/<x.y.z>/vendor`（无版本记录）。
三级都 ⛔ 不 exec 该产物自己的 `--version`。

## Touches
- `packages/quay/src/loaded-version.ts`
- `packages/quay/src/cli/server.ts`
- `plugin/scripts/driver-runtime.ts`
- `packages/quay/test/server-status-web-control-same-pid.test.mjs`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `tasks/gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only.md`

## AC
- [x] 新增用例(`packages/quay/test/server-status-web-control-same-pid.test.mjs` 或同目录新测试):伪造 `.quay/server.json` 载体指向一个 cmdline 含 `…/cache/quay/quay/0.15.0/vendor/quay/dist/quay.js serve` 的夹具进程,伪造注册表安装版本 0.16.0 ⇒ `quay server status --json` 含 `loaded_version:"behind"`、`loaded:"0.15.0"`、`installed:"0.16.0"`、`source:"proc-cmdline"`;版本相同 ⇒ `current`;宿主 pid 已死或 cmdline 读不出版本目录 ⇒ `not-evaluated` 且 `reason` 非空(与 `current` 取值不同)。`node --experimental-strip-types --test` 对应测试文件退出 0。
- [x] 取假:把判定改成"总是 current"后 behind 用例红(附实跑输出)。
- [x] 单一实现:`grep -rn "proc.*cmdline" packages/quay/src plugin/scripts --include=*.ts` 排除测试后,读 `/proc/<pid>/cmdline` 取版本的逻辑只有一份实现被 anchor 与 serve 共用(先列出改前命中)。
- [x] 版本比较用目录里的 `VERSION`/`plugin.json`,⛔ 不用 `quay --version` 输出:夹具让 `--version` 打印与 VERSION 不同的值,读数仍取 VERSION。
- [x] Core 不新增对 plugin 层的静态 import:`bash scripts/test.sh --for-task gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only` 退出 0 且执行了 ≥1 个测试文件(其中包括既有的依赖方向/导入图检查)。
- [x] 读生产载体:在本机 cantus(宿主与 pin 版本不一致的真实 workspace,若届时已一致则在临时 workspace 用旧版本缓存起一个宿主再升级 pin)实跑 `quay server status --json`,读出 `loaded_version` 与 `driver status` 的 anchor 读数并列;原文贴进完成记录。该 AC 在撤销本任务改动后必须变红(负控制)。

## DoD
真实落地:一个跑着旧版本的真实 serve 宿主,在插件 pin 升级后,`quay server status` 读出 `loaded_version: behind` 并给出 `quay server restart` 提示;读不出时为 `not-evaluated`。仅 fixture 绿不算完成。

## Evidence

### AC1 — 用例与实跑（`node --experimental-strip-types --test packages/quay/test/server-status-web-control-same-pid.test.mjs`，EXIT=0）
```
ℹ tests 14   ℹ pass 14   ℹ fail 0
✔ loaded_version — the serve host loaded 0.15.0 while 0.16.0 is installed ⇒ behind (+ both versions, source=proc-cmdline)
✔ loaded_version — the SAME fixture with the installed version equal to the loaded one ⇒ current (behind is not a constant)
✔ loaded_version — host pid dead / cmdline carries no quay serve script / no version dir ⇒ not-evaluated with a NON-EMPTY reason (⛔ never current)
✔ loaded_version — the version comes from the version dir's VERSION file, NOT from `quay.js --version` (its output differs on purpose)
✔ loaded_version — the TEXT form leads with loaded-version-<state> and, on behind, names `quay server restart` (⛔ never silent)
```
夹具是真跑着的进程（`node <cacheRoot>/cache/quay/quay/0.15.0/vendor/quay/dist/quay.js serve`），读数取自它自己的
`/proc/<pid>/cmdline`；断言 `loaded_script === <该脚本绝对路径>` 且 `fs.existsSync` 为真。第 3 条覆盖三种读不到：
宿主已死 / 活着的 pid 但 argv 里没有 `quay … serve` / 有 serve 脚本但路径推不出版本目录 —— 三者一律
`not-evaluated` + 非空 `reason`，且 `assert.notEqual(…, "current")`。

### AC2 — 取假（负控制，实跑）
```
# 变异1：const state = "current";  // MUTATION (AC2): always current
✖ loaded_version — the serve host loaded 0.15.0 while 0.16.0 is installed ⇒ behind …
  AssertionError [ERR_ASSERTION]: 落后必须报 behind: "current"
  actual: 'current'   expected: 'behind'
ℹ pass 0   ℹ fail 1            （另 2 条 behind 相关用例同时红：VERSION 取值条、文本形态条）
# 变异2：把 degraded() 的 state 也改成 "current"（3b 那一半）
✖ loaded_version — host pid dead / cmdline carries no quay serve script / no version dir ⇒ not-evaluated …
  AssertionError [ERR_ASSERTION]: 宿主已死 ⇒ not-evaluated: "current"
  actual: 'current'   expected: 'not-evaluated'
```
两次变异都用 `cp` 备份还原（`diff` 确认逐字节相同，`grep -c MUTATION` = 0）。

### AC3 — 单一实现（先列改前命中）
```
# 改前（git show develop:plugin/scripts/driver-runtime.ts | grep -n "proc.*cmdline"）
  283: *  任何把**符号链接路径**当作 exec 实参的启动都会让 `/proc/<pid>/cmdline` 只留下链接路径 …
  2480://   · 「运行中进程实际加载了哪份内核」—— `/proc/<pid>/cmdline` …
  2523:  /** `loadedKernel` 的来源（`proc-cmdline` = … / `anchor-state` = …）
  2524:  loadedKernelSource: "proc-cmdline" | "anchor-state" | null;
  2600:/** 内核脚本的 basename 形状（判定 `/proc/<pid>/cmdline` 里**哪一段**是内核）。 */
  2604:/** 运行中进程**实际加载的**内核脚本（… exec 实参，外部可核的直接量）。 */
  2608:    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");      ← 唯一一处「读 /proc 取版本」的实现
  2783/2793: （其余是赋值与 reason 文案）
# 改后：读 cmdline 取**加载版本**的实现在全仓只有一处
packages/quay/src/loaded-version.ts:164  export function loadedScriptFromCmdline(pid, pick)
两处消费者（共用同一份）：
packages/quay/src/cli/server.ts:363        serveHostLoadedVersionReading(workspaceRoot, hostPid)   ← serve 宿主
plugin/scripts/driver-runtime.ts:2575      loadedVersionReadingForHost(root, hostPid, DRIVER_HOST_PROBE) ← anchor
真正的 /proc 读本身也只有一处：packages/quay/src/kernel/proc-identity.ts:63 procCmdlinePath()
```
`grep -rn "proc.*cmdline" packages/quay/src plugin/scripts --include=*.ts` 余下的 `readFileSync(/proc/…/cmdline)`
命中全部属于**别的用途**（`fast-mode-telemetry` 按 runId 匹配、`worktree-process-reaper` 判进程身份、
`server-restart-inflight-verify` 读 driver 进程树），⛔ 没有一个在读版本。

### AC4 — 版本取自 VERSION 文件，不是 `--version` 输出
夹具产物在 `--version` 时打印 `9.9.9`，其 `<ver>/VERSION` 写 `0.15.0`；已安装 `0.16.0`。
测试先证明夹具**确实**用 9.9.9 回答 `--version`（`spawnSync(node, [script, "--version"]) → "9.9.9"`），
再断言读数 `loaded === "0.15.0"` 且 `loaded_version === "behind"` —— 若实现 exec 了产物，会读出
`9.9.9` 且方向变成 `ahead`，两条断言同时红。

### AC5 — Core 无新增 plugin 静态 import；scoped 门退出 0
```
$ bash scripts/test.sh --for-task gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only --allow-thin
EXIT=0        ℹ tests 123   ℹ pass 123   ℹ fail 0
```
其中既有的依赖方向检查：
```
$ node --experimental-strip-types plugin/scripts/import-graph-check.ts .
import-graph-check: files=444 edges=1222 (value 1107 / type 115)
  valueSccs=0 typeSccs=0 reverseEdges=0
  kernelChecked=true (violations=0)
PASS — valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0
```
`reverseEdges=0` 即「`packages/**` import `plugin/**`」的边为 0（本任务新增的 Core 文件只 import
`./kernel/proc-identity.ts`、`./server-state.ts`、`./plugin-root.ts`，均在 Core 内）。
另跑 `plugin/scripts/identity-replication-check.ts` exit 0（AC2 判定重写节 0 处待合并；本文件新增的
`/proc` 读只在测试夹具里，落在既有 carve-out）。`npx tsc --noEmit -p tsconfig.json` exit 0。

### AC6 — 生产载体实跑（与 anchor 读数并列）
本机 `claudecodeui` 是真实生产 workspace：其 serve 宿主 pid 180534 跑
`…/cache/quay/quay/0.14.0/vendor/quay/dist/quay.js serve`，注册表已装 0.16.0（`lastUpdated`
2026-10-06T11:22:42.520Z）。撤销本任务改动 ⇒ 该 JSON 里与 loaded-version 有关的键 **(无)**，AC 取不到读数 = 红。

```
--- (1) quay server status --json（serve 宿主侧，本任务改动后）---
{ "pid": 180534, "carrier": "present",
  "loaded_version": "behind", "loaded": "0.14.0", "installed": "0.16.0",
  "installed_at": "2026-10-06T11:22:42.520Z", "installed_source": "registry",
  "loaded_script": "/data/home/yale/.claude/plugins/cache/quay/quay/0.14.0/vendor/quay/dist/quay.js",
  "source": "proc-cmdline", "loaded_version_relation": "loaded-older", "loaded_version_reason": null }
status= running
--- (2) 同一 workspace 的 anchor 侧：driver status --kind worker ---
loaded-version-behind: loaded=0.14.0 installed=0.16.0 (installed_at 2026-10-06T11:22:42.520Z)
  kernel=/data/home/yale/.claude/plugins/cache/quay/quay/0.14.0/scripts/dist/driver-anchor.js source=proc-cmdline
  — the running host loaded an OLDER kernel than the installed one: run `quay driver restart` to load it
--- (3) 人读形态 ---
quay server: RUNNING — pid 180534 hosts web + control on one process
  workspace /data/home/yale/work/claudecodeui
  loaded-version-behind: loaded=0.14.0 installed=0.16.0 (installed_at 2026-10-06T11:22:42.520Z)
    script=/data/home/yale/.claude/plugins/cache/quay/quay/0.14.0/vendor/quay/dist/quay.js source=proc-cmdline
    — the running server loaded an OLDER build than the installed one: run `quay server restart` to load it
--- (4) 负控制：撤销改动（主检出未改的 packages/quay）跑同一条命令 ---
改前 JSON 里与 loaded-version 有关的键： (无)   ⇒ 红
--- (5) AC 点名的 cantus ---
其 carrier 指向的宿主 pid 4000576 已死、pin 亦已升到 0.16.0 ⇒ 该 workspace 上取不到 behind 读数；
实跑给出诚实的 not-evaluated：
{ "pid": 4000576, "status": "not-running", "loaded_version": "not-evaluated", "loaded": null,
  "installed": "0.16.0", "source": null,
  "loaded_version_reason": "serve host pid 4000576 is not alive — nothing to read the loaded script from" }
⇒ behind 的真实生产载体取同机的 claudecodeui（见 (1)(2)），即 AC 给出的「宿主与 pin 版本不一致的真实
workspace」这一条；cantus 提供的是 not-evaluated 那一支的生产见证。
```

### DoD
(1)(3) 即 DoD 的两次读数：一个**真实运行中、加载旧版本**的 serve 宿主（claudecodeui pid 180534，
0.14.0）在插件 pin 升到 0.16.0 后，`quay server status` 读出 `loaded_version: behind` 并给出
`quay server restart` 提示；读不出时（cantus，见 (5)）为 `not-evaluated` + 非空 reason。
⛔ 未做自动重载（不在范围）：本读数只报告，exit code 仍由 AC-251 的 pid 同一性契约决定。
