---
id: gap-ac257-verify-leg-misses-declared-worker-env
title: --verify-ac257 腿不下发声明的 worker 环境，而 AC-257/AC-258 共用同一段 worker 前置 ⇒
  只能用旁路凭据的目标机上 AC-257 结构上不可达
status: todo
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: v1
goal_ac: AC-257
---
## Finding

`plugin/scripts/develop-deliver-tgz.sh` 的 `--verify-ac258` 在远端脚本序言里下发调用方【声明的 worker 环境】：

```
2683:$(ac258_worker_env_export)
```

而 `--verify-ac257` 的远端序言里【没有】这一行（同一文件 ~2249 起，只有 `$(verify_node_export_for "${hk}")`）。
`ac258_worker_env_export` 的**唯一生产调用点**就是上面那一行（`grep -n ac258_worker_env_export` 的另外三处都在
`selfcheck_worker_preflight` 的夹具里）。

后果不是「少一个便利项」：**两条腿共用同一段步骤序** —— `step_ac257_project_scope` 的第一个动作就是
`ac258_worker_preflight`（`verify-deliver-coldstart.sh`，与 `step_ac258_user_scope` 同源）。该前置在【远端进程环境】里跑
`claude -p "say ok"`，读的是它自己进程的 `QUAY_AC258_WORKER_PROBE_CMD` / `QUAY_AC258_WORKER_ENV`。

⇒ 对一台**自身 Claude Code OAuth 已死、只能靠旁路 Anthropic-compatible endpoint 跑 worker** 的目标机
（ad-arm1 / orangevps 都是这个形态：`~/.claude/.credentials.json` 的 `accessToken` 与 `refreshToken` 均为空串、
`expiresAt=0`；而 `~/.local/etc/fjdac-api-key` + `~/.local/bin/claude-fjdac` 是人 2026-09-09 授权的既定形态）：

- **AC-258 腿**：调用方可以声明该环境 ⇒ 前置通过、worker 拿到同一环境 ⇒ 可达。
- **AC-257 腿**：调用方**结构上没有表达方式**把同一环境送到远端进程 ⇒ 远端前置返回 `credentials`，
  `step_ac257_project_scope` 在**任何破坏性步骤之前** `return 1` ⇒ `AC257-NOT-EVALUATED` ⇒ AC-257 记录永不产出。
  失败形态是「记录没写出来」，与「机制真的坏了」同形（硬规则 3b）。

**当场读数（2026-09-15，ad-arm1，非推断）**：

```
$ ssh ad-arm1 'bash -lc "claude -p \"say ok\""'
Failed to authenticate: OAuth session expired and could not be refreshed
REMOTE_RC=1

$ ssh ad-arm1 'bash -lc "source ~/.local/etc/fjdac-api-key; export ANTHROPIC_BASE_URL=\"https://fjbigmodel.fjdac.cn/\"; export ANTHROPIC_AUTH_TOKEN=\"\$FJDAC_API_KEY\"; export ANTHROPIC_API_KEY=\"\"; export ANTHROPIC_MODEL=deepseek-v4-pro-anthropic; claude --model deepseek-v4-pro-anthropic -p \"say ok\""'
[claude-code:unrecognized_model] {"model":"deepseek-v4-pro-anthropic","query_source":"sdk"}
ok
REMOTE_RC=0
```

同一条谓词、同一台机器，只差【声明的环境】—— 而 AC-257 腿无法把它送进去。

**为什么这是同一件事的两端（硬规则 5b）**：`ac258_worker_env_export` 的头注释逐字写着它存在的理由
——「一台目标机只有两条登录面：① 该机自己的 OAuth；② 调用方声明的 Anthropic-compatible 环境」，
以及「片段在远端 `bash -ls` 下**先于** verify-deliver-coldstart.sh 执行 ⇒ 该脚本的前置探测与它随后启动的
driver/worker 继承【同一个】环境 ⇒ 探测对象 == 实际 spawn 对象」。这条理由对 `step_ac257_project_scope`
**逐字成立**（它做的是同一件事：起目标项目的 driver 驱动一条真任务到 done），只是当时只落在了 AC-258 一处。

## Requested action

1. 在 `verify_ac257_mode` 的远端 heredoc 里、`$(verify_node_export_for "${hk}")` 之后加一行
   `$(ac258_worker_env_export)`，与 `verify_ac258_mode` 逐字对齐。
2. 该函数在 `QUAY_AC258_WORKER_ENV` / `QUAY_AC258_WORKER_PROBE_CMD` 都未设时输出为空 ⇒ 对现有全部调用方
   **逐字零变化**（这条本身要有一条判据：未声明时不产生任何字节）。
3. 扩 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`：断言 `verify_ac257_mode` 的远端序言
   与 `verify_ac258_mode` 一样携带该下发（按位置取，⛔ 不是全文 grep 关键词）。
4. 反向控制：确认「只声明 `QUAY_AC258_WORKER_ENV` 而远端探测仍用缺省谓词」这一不对称由
   `QUAY_AC258_WORKER_PROBE_CMD` 一同下发来消除（该函数已同时下发两者）；若把后者去掉，
   远端前置应回到 `credentials`。

## Acceptance Criteria

- [ ] AC1 `grep -n 'ac258_worker_env_export' plugin/scripts/develop-deliver-tgz.sh` 的**生产**调用点从 1 处变 2 处（两处分别位于 `verify_ac257_mode` 与 `verify_ac258_mode` 的远端 heredoc 内），贴命令与输出。
- [ ] AC2 判据：把两处调用点各自移出后，对应模式在「远端探测读不到声明环境」这一方向上的行为【可区分】—— 即存在一条机械检查会红（⛔ 不是只靠人读）。
- [ ] AC3 未声明时零变化：`QUAY_AC258_WORKER_ENV='' QUAY_AC258_WORKER_PROBE_CMD=''` 下 `ac258_worker_env_export` 输出 0 字节，且既有 `--selfcheck-worker-preflight` 仍 exit 0。
- [ ] AC4 端到端：在 ad-arm1 上跑一次 `--verify-ac257`，远端前置须为 `usable` 而非 `credentials`（前后两次读数都贴）。

## Definition of Done

- [ ] `--verify-ac257` 与 `--verify-ac258` 在「目标机 worker 登录面」上行为一致：同一份声明、同一处下发、同一处生效。
- [ ] 该一致性有机械判据（AC2），⛔ 不是靠注释里写一句「勿忘两处一起改」。
- [ ] AC4 的真实两机读数落在记录里（ad-arm1）。

## Touches

- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs

Note: this task is filed from the AC-259 re-anchoring worker, where it was discovered (the AC-257 leg had to be driven by invoking the remote verification script directly, with the declared env in the login shell, because this transport leg cannot carry it).
