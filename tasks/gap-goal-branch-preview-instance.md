---
id: gap-goal-branch-preview-instance
title: goal 预览实例：quay goal preview start|stop|status 在判据 worktree 上起停
  serve，.quay/ 用主检出只读快照
status: todo
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

- [ ] 新增 `packages/quay/test/goal-preview.test.mjs`（临时 workspace）：start 后预览 root 下出现 `.quay/server.json`，其 pid 存活且 cmdline 是 quay serve，主 root 的准入锁不受影响；status 报告该 pid 与端口；stop 后进程退出、carrier 清除。
- [ ] 同一测试文件：刷新产生的 `.quay/` 快照不含 `server.lock` 与 `server.json`，其余文件与主检出一致。
- [ ] 同一测试文件：在预览 root 下运行一段按「cwd = git root」找 serve 的探测脚本（AC-288 判据的地址推导段），能找到预览 serve。
- [ ] 同一测试文件：goal 写为 retired 后判据 worktree 被删除前其 serve 已停止（无残留进程）。
- [ ] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（goal-driver 不出现 task 写路径与本仓 fan-in 载体引用——DIR-131；注意注释里出现该类词也会被判红）。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-preview-instance` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：人能对一个 branch-mode goal 起一个预览实例并在浏览器里使用，live-probe AC 在其上 pass。生产读数由 GOAL-028 的 AC-328 在第一个试点 goal（建议带 Web UI 面）并入后取得。

## Touches

- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/goal-preview.ts
- plugin/scripts/goal-driver.ts
- packages/quay/test/goal-preview.test.mjs
- tasks/gap-goal-branch-preview-instance.md
