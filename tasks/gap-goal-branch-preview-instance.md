---
id: gap-goal-branch-preview-instance
title: goal 预览实例：quay goal preview start|stop|status 在判据 worktree 上起停
  serve，.quay/ 用主检出只读快照
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-reaper-accepts-preview-serve
  - gap-goal-branch-criteria-evaluated-on-goal-worktree
goal_ac: AC-328
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.10，裁定⑮㉒㉓）：人要在并入前试用 goal 的改动；live-probe 类 AC（判据找 cwd 等于仓库根的 `quay.ts serve` 并 curl 页面，例 AC-288）也需要一个在跑的实例。读码确认可共存：serve 准入锁按 workspace root 分（`packages/quay/src/serve.ts:375-403`）；serve 默认只托管 web/control（`packages/quay/src/cli/driver-vocab.ts:44`），不带 driver，不会抢生产 worker。

**修法**：
1. `quay goal preview <GOAL-NNN> start|stop|status`：start 以该 goal 的判据 worktree 为 workspace root、显式 `--port N≥1`、`node --watch` 启动 serve；stop 读该 root 的 `.quay/server.json` 取 pid 停止（⛔ 不用 `pkill -f`，它会匹配到调用者自己）；status 读同一 carrier。serve 由人起停（裁定㉒）。
2. 判据 worktree 每次刷新时复制一份主检出 `.quay/` 的只读快照，**排除** `server.lock`、`server.json` 等实例身份文件；预览内的写操作落在副本上，随刷新丢弃（裁定㉓）。⛔ 预览代码不读写生产数据。
3. goal 并入或废弃时，goal-driver 删除判据 worktree 之前先停掉其上的 serve。
4. 没起 serve ⇒ live-probe AC 读 not-evaluated ⇒ 并入前置条件不满足——这是有意的：「人确实试用过」由此成为并入前置条件。

## AC

- [x] 新增 `packages/quay/test/goal-preview.test.mjs`（临时 workspace）：start 后预览 root 下出现 `.quay/server.json`，其 pid 存活且 cmdline 是 quay serve，主 root 的准入锁不受影响；status 报告该 pid 与端口；stop 后进程退出、carrier 清除。
- [x] 同一测试文件：刷新产生的 `.quay/` 快照不含 `server.lock` 与 `server.json`，其余文件与主检出一致。
- [x] 同一测试文件：在预览 root 下运行一段按「cwd = git root」找 serve 的探测脚本（AC-288 判据的地址推导段），能找到预览 serve。
- [x] 同一测试文件：goal 写为 retired 后判据 worktree 被删除前其 serve 已停止（无残留进程）。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（goal-driver 不出现 task 写路径与本仓 fan-in 载体引用——DIR-131；注意注释里出现该类词也会被判红）。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-preview-instance` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：人能对一个 branch-mode goal 起一个预览实例并在浏览器里使用，live-probe AC 在其上 pass。生产读数由 GOAL-028 的 AC-328 在第一个试点 goal（建议带 Web UI 面）并入后取得。

## Evidence

**实现落点**（worker worktree `/data/home/yale/work/quay-worktrees/gap-goal-branch-preview-instance`，2026-10-03）：
- `packages/quay/src/goal-preview.ts`（新）——预览实例的**单一实现**：`snapshotQuayDirInto`（`.quay/` 只读快照；排除 `server.json`/`server.lock`/`server-services.json` 三个实例身份文件 + 重/废路径，后者与 `refresh-worktree-quay.sh` 同集合）、`startPreviewServe`（`detached` + `node --watch` + **显式 `--port N≥1`**，起的是**预览 worktree 自己的** `packages/quay/bin/quay.ts`，等它发布自带 carrier）、`stopPreviewServe`（读**该 root 自己**的 `.quay/server.json` → SIGTERM **整个进程组** → 等退出 → 清 carrier/lock；⛔ 不用 `pkill -f`）、`readPreviewStatus`（四态 running / stale / not-running / not-evaluated）。
- `packages/quay/src/cli/goal.ts` + `packages/quay/src/cli/help.ts` —— `quay goal preview <GOAL> start|stop|status`（端口展示回退取自 `SERVE_BINDING_FALLBACK` 单一定义点）。
- `plugin/scripts/goal-driver.ts`（经 Layer 0 `driver-runtime.ts` 再导出）——建/刷判据 worktree 时做快照（读数落 `quaySnapshot`），删 worktree **之前**先 `stopPreviewServe`（读数落 `previewStop`）。
- **同批修了兄弟测试** `plugin/test/goal-driver-criterion-worktree.test.mjs`：其「worktree 里**无**账本」断言的前提（快照落地前）已不成立；换成**更强**判据——worktree 的账本 == 主账本在快照时刻的**前缀** ∧ **独立 inode**（证明它是冻结副本、⛔ 不是活账本，本轮 append 的事件只在主 root）。**故 Touches 新增 `plugin/scripts/driver-runtime.ts` 与该测试文件。**

**AC1–AC4 —— 新增用例 4 条全绿**（真 git 仓库 + 真子进程：serve 子进程 argv 含 `quay.ts serve`、cwd = 预览 root、发布 `server-state.ts` 的真实 carrier 形状；⛔ 不伪造读数）：
```
$ node --test packages/quay/test/goal-preview.test.mjs
✔ AC1: start brings up a serve under the preview root; main lock untouched; status reports pid+port; stop ends it (373ms)
✔ AC2: the snapshot carries the main checkout's .quay/ but never its instance-identity files (52ms)
✔ AC3: the AC-288 address-derivation block, run in the preview root, finds the preview serve (526ms)
✔ AC4: a retired goal's serve is stopped BEFORE its criterion worktree is deleted (581ms)
ℹ tests 4  ℹ pass 4  ℹ fail 0
```
AC3 跑的是 **AC-288 判据里那段 derivation 块本身**（从 `goals/AC-288-*.md` 逐字抽取，⛔ 不是重写一遍）：`pgrep -f 'quay.ts serve'` × `/proc/<pid>/cwd == git root` 找到预览 serve，`DERIVED_ADDR=127.0.0.1:45932`，且 REPORT 里该 pid 带地址。AC4 用**真 goal-store CLI** 把 GOAL-901 写 `retired`（该路径 discard `goal/GOAL-901`），再跑 `syncGoalCriterionWorktrees` ⇒ `state=removed` ∧ `previewStop.state=stopped` ∧ worktree 已删 ∧ 无残留进程。

**AC5 —— DIR-131 边界检查**
```
$ node --no-warnings --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts --json
{"ok":true,"notEvaluated":false,"target":"…/plugin/scripts/goal-driver.ts","violations":[]}   EXIT=0
```

**AC6 —— 取假（cp 备份，⛔ 未用 `git checkout --`）**
备份：`cp packages/quay/src/goal-preview.ts .quay/ac-preview/goal-preview.ts.bak`（md5 `d6f40eb274a1059f65542dbb89dcaa0d`）。回退：把 `snapshotQuayDirInto` 的实例身份排除分支短路（`if (false && …)`）。
```
$ node --test packages/quay/test/goal-preview.test.mjs        # exit 1
✖ AC1 …  AssertionError: preview serve must start: no live preview serve registered … within 30000ms
✖ AC2 …  AssertionError: snapshot must NOT copy server.json
✖ AC3 … / ✖ AC4 …
ℹ tests 4  ℹ pass 0  ℹ fail 4                                 # 至少 1 条变红 ✔
```
恢复：`cp .quay/ac-preview/goal-preview.ts.bak packages/quay/src/goal-preview.ts`（md5 一致 `d6f40eb2…`）后 4 条全绿（输出见上）。

**AC7 —— scoped 门**
```
$ bash scripts/test.sh --for-task gap-goal-branch-preview-instance --allow-thin    # EXIT=0
ℹ tests 99  ℹ pass 99  ℹ fail 0
```
被执行的测试文件（selector `--paths-only` 输出）：`packages/quay/test/{goal-preview,adr-gate,adr-store,build-dist,cli-adr,mcp-adr,npm-pack-e2e}.test.mjs`、`plugin/test/{goal-driver-criterion-worktree,plugin-packaging}.test.mjs`（另有 scoped 静态检查层）。缓存以合并时的 develop tip `56312870ff0b9e2556dea72062f6b332c9884da1` 写入 `.quay/scoped-gate-cache.json`。

**已知边界（如实记账，⛔ 未在本任务修）**：`node --watch` 的**监督进程** argv 里也含 `quay.ts serve`，而 `worktree-process-reaper.ts --orphan-serves` 只豁免「carrier 登记的 pid == 自己 pid」的那一个（依赖任务 `gap-goal-branch-reaper-accepts-preview-serve` 的 `isSelfRegisteredServe`）⇒ 回收器**可能**杀掉 `--watch` 监督进程（真正的 serve 因自证而存活，预览仍可用，只失去 import 变更自动重启）。回收器不在本任务 Touches 内，未改。`stopPreviewServe` 走**进程组**信号，故人 `stop` 时监督进程与 serve 一起结束，无残留。

## Touches

- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/goal-preview.ts
- plugin/scripts/goal-driver.ts
- plugin/scripts/driver-runtime.ts
- packages/quay/test/goal-preview.test.mjs
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-branch-preview-instance.md
