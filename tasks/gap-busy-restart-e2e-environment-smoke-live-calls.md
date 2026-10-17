---
id: gap-busy-restart-e2e-environment-smoke-live-calls
title: 忙时重启 E2E 的环境冒烟每轮真调网关 3 次：文件自称 no live model calls，且绿色依赖外部错误措辞
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
## Proposal

`plugin/test/driver-restart-busy-e2e.test.mjs` 的文件头写着 `FIXTURES (no live model calls, no budget ceiling touched)`，但 `startKind` 的启动环境冒烟（`plugin/scripts/driver-runtime.ts:4152-4168`，来自已完成的 `gap-worker-quick-death-environment-fatal-halts-driver`）会在 `kind === "worker"` 时用 profile 里的 `launcher` + `model` 真起一次子进程。busy arm 的夹具（`:865`）写的是 `launcher: claude` / `model: test-model`，而该 arm 的 worker 本身由 `QUAY_E2E_WORKER_CMD` 逐字覆盖（`:876`）——launcher 在这个 arm 里的唯一消费者就是这个冒烟。

每次运行该文件产生 **3 次**真实调用：pre arm 的 `start --kind worker`（`:883`）、post arm 的同一条、以及 post arm 的 `restartKind` 成功后再进 `startKind`（`driver-runtime.ts:4637`）；pre arm 的 restart 在 `stop-failed` 就返回（`:4635`），不进 startKind。实测会话载体：`~/.claude/projects/` 里含 `Invalid model name passed in model=test-model` 的 jsonl 共 642 条（10-14 87 / 10-15 306 / 10-16 184 / 10-17 65），首条消息 `Reply with exactly: ok`、`agentName=quay-task-worker`、cwd 与跑 suite 的 worktree 逐项吻合；同一 worktree 的 mtime 呈「每 ~3 分钟 3 条」的簇。

危害不只是噪声：①该文件自己声称没有 live 调用，现在这句话是假的；②CI 也真调（runner 容器内 `claude` 在 `/opt/hostedtoolcache/node/24.21.0/x64/bin/claude`，由 setup-node 放上 PATH；10-17 的 CI test job 里该文件 passed 即证明冒烟在 CI 里也跑通了）；③绿色取决于外部错误措辞——当前 400 原文 `Invalid model name passed in model=test-model...` 不匹配 `ENVIRONMENT_FATAL_SIGNATURES`，一旦措辞改成含 `model_not_found`，冒烟返回 `refused`，`start --kind worker` exit 1，该 e2e 确定性变红；launcher 不在 PATH 时同理（`launcher-enoent`；已实测不存在的 launcher 使 `runEnvironmentSmoke` 返回 `refused`）。

## Plan

1. 把 busy arm 夹具的 `launcher: claude` 换成恒 exit 0 的 launcher（`/bin/true`，先例 `plugin/test/criterion-fidelity-default-wiring.test.mjs:104`；或 host 内一个 `exit 0` 的 fake 脚本）。worker 仍由 `QUAY_E2E_WORKER_CMD` 逐字覆盖 ⇒ 被测路径一行不变。
2. 负控制：把一个记录 argv 的假 `claude` 脚本放到 PATH 最前，跑该文件；改后记录应为 0 条，把夹具那一行临时改回 `launcher: claude` 后同一手法记录应 ≥1 条（证明该计数可取假）。
3. 其余两条 `profiles.yml`（`:1007`、`:1122`）不触发冒烟（那两个 arm 直接 spawn `worker-driver.js`，不经 `startKind`），本任务不改，避免无谓 diff。

## Acceptance Criteria

- [ ] AC1: 用记录 argv 的假 `claude`（PATH 最前）跑 `node --test plugin/test/driver-restart-busy-e2e.test.mjs`，改动后记录 0 条；把夹具 launcher 临时改回 `claude` 后同一手法记录 ≥1 条（负控制）。两条原始读数贴出。
- [ ] AC2: 该文件仍全绿：贴出 `tests / pass / fail` 行；并在同一夹具宿主上手工跑一次 `start --kind worker`，stdout 出现 `environment-smoke: ok`，且 PATH 最前的假 `claude` 未被调用。
- [ ] AC3: `bash scripts/test.sh --for-task gap-busy-restart-e2e-environment-smoke-live-calls --allow-thin` 以 exit 0 结束（贴出末行与静态检查摘要）。

## Definition of Done

- AC1–AC3 全部勾选并附原始读数（不是转述）；改动只落在声明的 Touches 两文件；该 e2e 仍在 lowconc 泳道运行，且不再产生任何 `test-model` 会话。

## Touches

- tasks/gap-busy-restart-e2e-environment-smoke-live-calls.md
- plugin/test/driver-restart-busy-e2e.test.mjs
