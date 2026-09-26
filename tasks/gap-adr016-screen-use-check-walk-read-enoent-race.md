---
id: gap-adr016-screen-use-check-walk-read-enoent-race
title: "adr016-screen-use-check: walk→read ENOENT race crashes the scan (exit 1
  same shape as a violation)"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象与证据（2026-09-26）**：develop CI run 36208923838（headSha 89fec6283）的 `test` job 是该 run 唯一红项，且全套 821 个测试文件里只有一个失败：`plugin/test/adr016-screen-use-check.test.mjs:108`（"AC3/AC7"），签名 `ENOENT: no such file or directory, open '/_work/quay/quay/packages/quay/plugin/scripts/drivable-workspace-check.sh'`，栈顶 `scanForScreenHashViolations (plugin/scripts/adr016-screen-use-check.ts:249)`。此前 3 个 develop run 的红是另外 5 个测试文件（已由 0978ebe97 修掉），本项是它们之后唯一剩下的。

**机制（读码推断，未在 CI 复现）**：`packages/quay/plugin/` 是 gitignored 的 `plugin/` 镜像快照，由 npm-pack / delivery-smoke 路径（`packages/quay/scripts/package.sh`、`packages/quay/test/delivery-standalone-smoke.sh`）暂存进源码树再 `rm -rf`。套件并发度 128 时，`collectShellScripts` 列出的 .sh 可在 `readFileSync` 前消失 ⇒ ENOENT 崩溃，退出码 1 与「发现违规」同形（硬规则 3b）。`plugin/scripts/dead-code-after-return-check.ts#scanTree` 已按「消失 ⇒ 跳过并上报，非 ENOENT 仍抛」修过同一类竞态；`adr016-screen-use-check.ts` 是漏修的兄弟（硬规则 5b）。

**实现已存在**：task 分支 `task/gap-adr016-screen-use-check-walk-read-enoent-race`（提交 224e6b97f，worktree `/data/home/yale/work/quay-worktrees/gap-adr016-screen-use-check-walk-read-enoent-race`，与本任务 id 同名）已含修复与测试。接手的 worker 应在该分支/worktree 上复核、勾选 AC、交 fan-in，⛔ 不要另起炉灶重做。

**兄弟扫描（硬规则 5b）**：走 collectShellScripts/listExecutableFiles/walkFiles 的 16 个脚本中，仅 dead-code-after-return-check 与本检查器有 ENOENT 处理，其余 14 个未处理；未观察到它们红过，故本任务不动（观察项，不设为前置，硬规则 12）。

## Plan

1. `plugin/scripts/adr016-screen-use-check.ts`：`scanForScreenHashViolations` 的读取步对 ENOENT 跳过并推入新增的 `ScanResult.unreadable`（`{rel, reason}`），非 ENOENT 照旧抛出；`judgeScreenHashScan` 的 verified 文案、`--json` 与文本输出都具名上报 unreadable 计数。
2. `plugin/test/adr016-screen-use-check.test.mjs`：既有 `judgeScreenHashScan` 夹具补 `unreadable: []`；新增两条测试（mock `fs.readFileSync` 对一个真实 .sh 抛 ENOENT ⇒ 被跳过并上报；抛 EACCES ⇒ 仍抛出）。无 spawn/mkdtemp，符合该文件的 path→content 约定。
3. 复核：`node --test plugin/test/adr016-screen-use-check.test.mjs` 全绿；撤掉 1 的修复后 ENOENT 那条新测试转红（负控制）。

## Acceptance Criteria

- [ ] `node --no-warnings --experimental-strip-types --test plugin/test/adr016-screen-use-check.test.mjs` 退出码 0（17 条全过，含 2 条新增的 walk→read 竞态测试）。
- [ ] 负控制可复核：把 `adr016-screen-use-check.ts` 的读取步还原成裸 `fs.readFileSync`（`git stash` 该文件）后，同一命令上「walk→read race: a listed .sh that vanishes」那条复红，其余不变。
- [ ] `node --no-warnings --experimental-strip-types plugin/scripts/adr016-screen-use-check.ts --root .` 输出含 `unreadable: 0` 且退出码 0；`--selftest` 8/8。
- [ ] 非 ENOENT 读错误仍抛出：EACCES 那条测试通过（不得把所有读错误一律吞成「已跳过」）。

## Definition of Done

真实落地：修复经本任务 fan-in 的全量套件后进 develop，之后 develop 的 `ci.yml` `test` job 不再因该检查器的 walk→read ENOENT 红。仅改注释、或仅在测试里 mock 掉扫描，不算完成。

## Touches

- plugin/scripts/adr016-screen-use-check.ts
- plugin/test/adr016-screen-use-check.test.mjs
- tasks/gap-adr016-screen-use-check-walk-read-enoent-race.md
