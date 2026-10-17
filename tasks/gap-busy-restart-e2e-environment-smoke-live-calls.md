---
id: gap-busy-restart-e2e-environment-smoke-live-calls
title: 忙时重启 E2E 的环境冒烟每轮真调网关 3 次：文件自称 no live model calls，且绿色依赖外部错误措辞
status: done
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

- [x] AC1: 用记录 argv 的假 `claude`（PATH 最前）跑 `node --test plugin/test/driver-restart-busy-e2e.test.mjs`，改动后记录 0 条；把夹具 launcher 临时改回 `claude` 后同一手法记录 ≥1 条（负控制）。两条原始读数贴出。
- [x] AC2: 该文件仍全绿：贴出 `tests / pass / fail` 行；并在同一夹具宿主上手工跑一次 `start --kind worker`，stdout 出现 `environment-smoke: ok`，且 PATH 最前的假 `claude` 未被调用。
- [x] AC3: `bash scripts/test.sh --for-task gap-busy-restart-e2e-environment-smoke-live-calls --allow-thin` 以 exit 0 结束（贴出末行与静态检查摘要）。

## Definition of Done

- AC1–AC3 全部勾选并附原始读数（不是转述）；改动只落在声明的 Touches 两文件；该 e2e 仍在 lowconc 泳道运行，且不再产生任何 `test-model` 会话。

## Evidence

### AC1 — recorder readings (raw)

Recorder = executable `claude` at the FRONT of `PATH` (`list.append`-style shell script; every invocation appends `$*` to a record file), so a real launcher can never be reached on this host. Test command in both runs was identical:

```
PATH=<recorder-dir>:$PATH node --test plugin/test/driver-restart-busy-e2e.test.mjs
```

**After the change (`launcher: /bin/true`): records = 0.**

```
exit=0
ℹ tests 8
ℹ pass 8
ℹ fail 0
--- records: 0
```

**Negative control — fixture line temporarily reverted to `launcher: claude`, same command: records = 3** (exactly the three calls the Proposal predicts: pre start, post start, post `restartKind` → `startKind`):

```
exit=0
ℹ tests 8
ℹ pass 8
ℹ fail 0
--- records: 3
--- first 3 argv lines:
--settings /tmp/e2e-restart-ac2ar-pre-GaDU2d/.claude/launch.settings.json --model test-model -n quay-task-worker -p Reply with exactly: ok
--settings /tmp/e2e-restart-ac2ar-post-Q5wTDn/.claude/launch.settings.json --model test-model -n quay-task-worker -p Reply with exactly: ok
--settings /tmp/e2e-restart-ac2ar-post-Q5wTDn/.claude/launch.settings.json --model test-model -n quay-task-worker -p Reply with exactly: ok
```

The fixture was then restored to `/bin/true` and the file re-run: `exit=0`, `tests 8 / pass 8 / fail 0`, **records: 0** again (the final committed state).

### AC2 — still green + manual `start --kind worker`

```
ℹ tests 8
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Manual run on a scratch fixture host built exactly like the busy arm (plain `git init -b develop` host, `.quay/plugin` → `.quay`-free kernel tree, `profiles.yml` with `launcher: /bin/true`), with the same recorder at the front of `PATH`:

```
exit=0
--- stdout
environment-smoke: ok — launcher+model resolved and callable
started: anchor pid=140999 kind=worker driver pid=140999 confirmed_ms=302
--- fake claude records: 0
```

The shipped smoke path (`runEnvironmentSmoke` → `launchArgv` → child process) really ran (`environment-smoke: ok` is printed only on the `pass` verdict) and the PATH-front fake was never invoked ⇒ the process it spawned was `/bin/true`.

### AC3 — scoped gate

```
exit=0
```

Static-check summary (scoped, change-relevant tier) and the suite tail:

```
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
PASS — every declared landing target == forward branch 'develop' (0 violations)
PASS — valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0 (headBaseline {"valueSccs":0,"typeSccs":0,"reverseEdges":0})
PASS: no checked-in-tree writes: 180 write-verb call(s) across 1 executed input(s), 0 inside the tree — delta against develop (1 of 1 delta path(s) judged; unchanged test files are NOT judged by --changed)
ℹ tests 8
ℹ pass 8
ℹ fail 0
ℹ duration_ms 30150.888192
```

`NOT-EVALUATED: it0-split-or-commit-check --changed — no task file in this delta` is the expected non-blocking thin-tier entry (the task file itself is not part of the code delta), not a failure.

### DoD — no new `test-model` sessions

This file was executed three times in this session (after-change, negative control, restored-final). All three ran with the recorder shadowing `claude` at the front of `PATH`; the only real-launcher-shaped invocations observed were the 3 recorded argv lines in the negative control, which were served by the recorder and never reached a gateway. Final state: 0 launcher invocations, and the file keeps its `// @test-group lowconc` header (line 1), so it still runs in the lowconc lane.

## Touches

- tasks/gap-busy-restart-e2e-environment-smoke-live-calls.md
- plugin/test/driver-restart-busy-e2e.test.mjs

## Blocker

**2026-10-17T03:44:56.844Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: cadence must be one of the five enumerated values: touches-relax-tighten.ts → 每轮（worker-driver 驻留环的轮末一步；loop.touches_relax 未声明或 mode 为 off / 读不懂时不跑，该轮 round 记录的 auto_tighten 为 null） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=packages/quay-native/test/relation-sync.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：bba7c4b6-540b-4be2-880a-70e6f9f53b8d
