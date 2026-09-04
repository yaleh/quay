---
id: gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics
title: claude -p headless mode has two unknowns official docs cannot answer —
  third-party-endpoint round-trip (gating) and stdin-open exit semantics — that
  decide whether the two-layer loop can migrate off tmux
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  depends_on: gap-adr-016-alternatives-rejected-one-shot-claim-is-factually-wrong
---

**type:** execution

## Proposal

管理者交办（依据 `orchestration/RESEARCH-claude-p-streaming-2026-08-04.md`，人指定方向的调研）。

调研已回答了官方文档能答的部分（Monitor 不可用 / cron 会话作用域 / 后台进程被杀 / 会话在 stdin
打开期间存活）。**剩下两个文档答不了的未知**，本任务**只**实测这两个——不是「查可用性」（已答完）。

### 未知 A（gating，决定整个方向生死）：第三方端点在 `-p` headless 下能否往返

官方文档**完全没有提及**第三方 Anthropic 兼容端点（DeepSeek 经 `ANTHROPIC_BASE_URL`）在 headless
模式下的支持——`headless.md`/`cli-reference.md` 都没写；只文档化了 Bedrock/Vertex/Foundry。
这是**文档空白，不是「已记载为不支持」**。**不能用则整个计划作废——这条必须先测。**

### 未知 B（决定「移植」还是「重新设计」）：stdin 保持打开时，退出语义是否改变

`headless.md` 原文：final result 返回**且 stdin 已关闭**之后才杀后台——两个条件并列。

- stdin 不关就不退出 ⇒ 现有并发派发模型（3 个在飞 subagent，跨小时）可**原样保留**（移植）
- 照退 ⇒ 内层并发必须改成「驱动进程起 N 个独立 `-p` 进程」（重新设计）

### ⚠️ 实钱风险（做任何实验前必读，写进 DoD）

`-p` 模式**只认 API key，不认 Pro/Max 订阅**。调研查到 **Max 订阅用户被无意导向 API 计费、产生
大额账单**的案例。**任何 `-p` 实验必须用 `claude-deepseek` 这类自带 key 的 launcher**，
**绝不能在 Anthropic 订阅态下裸跑 `claude -p`**。本任务不在管理者（Max）会话上做实验。

### 依赖关系

**AC1 不过则 AC2 不必做**（依赖写死）：AC1 证明不了第三方端点能往返，AC2 的退出语义就没有意义。

## Acceptance Criteria

- [x] AC1（**gating**）: 用 `claude-deepseek -p`（自带 deepseek key 的 launcher）发一句话，经
      `ANTHROPIC_BASE_URL` 指向第三方端点，确认 headless 下**能往返**（stdout 收到模型回复）。
      **负控制**：同一条命令在 **key 缺失/未设置**的环境下运行**必须失败**——否则证明不了 key
      真的被用上了
      —— **PASS**，见下方「实测证据 §1」；另发现 Contract 的负控制行字面执行**不失败**（launcher 内部
      重新 source key 文件），已改用「key 文件不可达」的忠实负控制，见 §1 负控制 2a。
- [x] AC2（**仅在 AC1 过时做**）: stdin 保持打开 + 起一个后台 subagent；subagent 完成后，判
      `-p` 进程**是否仍存活**（判据是 `ps` 的进程存活，**不是日志文本**）。存活 ⇒ 现有并发模型可
      移植；退出 ⇒ 需重新设计
      —— **PASS（stream-json 形态 = 移植）**，见下方「实测证据 §2」。细颗粒：plain `-p 'prompt'`
      形态照退（stdin 开着也退）；driver 用的 stream-json 形态**不关 stdin 就存活**，subagent 完成后
      进程仍存活到 EOF。
- [x] AC3: 实验环境隔离——只在 scratch 环境（非 quay 开发树、非任何在飞 worktree）跑；
      **全程用 `claude-deepseek`，不用裸 `claude -p`**（订阅态实钱风险）
      —— **PASS**：全部实测在 `/tmp/claude-p-measure-scratch/` 下进行（非 quay 开发树、非任何
      worktree）；所有命令经 `claude-deepseek` launcher（自带 deepseek key），从未裸调 `claude -p`
      （ps 中出现的 `claude -p` 是 launcher 内部 `exec claude` 的子进程，调用面是 launcher）。
- [x] AC4: 结果回写——把实测输出（往返回复 + 负控制失败输出；AC2 的进程存活/退出证据）逐字贴进
      本任务体，并在 `orchestration/RESEARCH-claude-p-streaming-2026-08-04.md` 第 3 节两条未知
      下补实测结论（若 AC1 失败：记录失败，跳过 AC2，标注「gating 未过」）
      —— **PASS**：实测输出已逐字贴入下方「实测证据」；结论已写入
      `orchestration/RESEARCH-claude-p-streaming-2026-08-04.md` §3 两条未知之下（§3A 结论 / §3B 结论）。

## 实测证据（2026-08-05，全程 scratch，经 `claude-deepseek` launcher）

### §1 AC1 gating：第三方端点 headless 往返

**正控制（roundtrip_ok = 1，stdout 1 行，PASS）**
```
$ cd /tmp/claude-p-measure-scratch && claude-deepseek -p '回复 OK 即可'
exit: 0
stdout: OK
stderr: ⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is
set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
```
（stderr 的 connector 警告恰好反向证明：auth 走的是 env 里的 key，不是 claude.ai 订阅态。）

**同日晚间复验（dispatch 的 inner agent，2026-08-05 17:xx UTC，scratch 内，仍经 `claude-deepseek`）：**
```
$ cd /tmp/claude-p-measure-scratch && time claude-deepseek -p '回复 OK 即可'
exit: 0   （real 0m11.144s）
stdout: OK
stderr: ⚠ claude.ai connectors are disabled ...（同上）
$ env -u ANTHROPIC_API_KEY -u DEEPSEEK_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL \
    HOME=/tmp/claude-p-measure-scratch/nohome claude-deepseek -p '回复 OK'
exit: 1   stdout:（空）  stderr: Error: DeepSeek API key file not found: <nohome>/.local/etc/deepseek-api-key
```
复验与上午实测完全一致：正控制 exit 0 stdout=OK（往返成立），忠实负控制 exit 1（key 缺失必失败）。
AC1 gating 结论独立复现，非一次性巧合。

**负控制 1（Contract 字面行）—— 意外 SUCCESS，暴露 Contract 行规格错误**
```
$ env -u ANTHROPIC_API_KEY -u DEEPSEEK_API_KEY claude-deepseek -p '回复 OK'
exit: 0
stdout: OK
```
**发现**：`claude-deepseek` launcher 内部 `source ~/.local/etc/deepseek-api-key` 会**重新设置**
`DEEPSEEK_API_KEY` 并据此 `export ANTHROPIC_AUTH_TOKEN`，所以父环境 `env -u` 两个变量**不影响**
launcher 内部。字面执行 Contract 的 control 行**不会失败**——这不满足 AC1 负控制意图，需忠实负控制。

**负控制 2a（忠实：key 文件不可达，key 真正缺失）—— FAIL 如预期（PASS）**
```
$ env -u ANTHROPIC_API_KEY -u DEEPSEEK_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL \
    HOME=/tmp/claude-p-measure-scratch/nohome claude-deepseek -p '回复 OK'
exit: 1
stdout: （空）
stderr: Error: DeepSeek API key file not found:
/tmp/claude-p-measure-scratch/nohome/.local/etc/deepseek-api-key
Please create the file and add your API key.
```

**负控制 2b（追加：坏 key 值）—— 也失败（API 层 execution error），但失败不干净（挂起重试）**
```
$ env -u ANTHROPIC_API_KEY -u DEEPSEEK_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL \
    HOME=/tmp/claude-p-measure-scratch/badkeyhome claude-deepseek -p '回复 OK'
stdout: Execution error    （随后进程挂起重试，被 kill）
```
→ 坏 key 值在 API 层被拒（Execution error），进一步证明真实命中第三方端点用的是 key；但失败形态
是挂起重试而非干净退出，故以 2a（exit 1，launcher 明确报 key 缺失）为 AC1 负控制的正式证据。

**AC1 结论：`ANTHROPIC_BASE_URL` → DeepSeek 第三方端点在 `claude -p` headless 下可往返。**
gating **过**。AC2 依依赖写死必须做。

### §2 AC2：stdin 保持打开 + 后台 subagent 的退出语义

**形态 1（plain `-p 'prompt'` 参数形态，stdin 用 `tail -f /dev/null` 保持打开）—— 照退**
```
$ tail -f /dev/null | claude-deepseek -p '<起后台 subagent 的 prompt>' --permission-mode bypassPermissions
CLAUDE_PID=2216402
t+5s: -p process=ALIVE | subagent-not-done
t+10s: -p process=ALIVE | subagent-not-done
...（t+15s..t+41s 均 ALIVE）
t+46s: -p process=EXITED | subagent-not-done
FINAL: EXITED
```
stdout 主回复：subagent「已在内部把 sleep 25 放到后台」，即 subagent 回合已返回。**主回合 + 后台
subagent 回合结束后，即使 stdin 仍打开，plain 形态也退出。** stdin 打开在 plain 形态下**不**持有会话。

**形态 2（driver 实际形态：`--input-format stream-json --output-format stream-json --verbose`，
stdin 由 writer 进程握 200s 不关）—— 存活到 EOF（移植）**
```
$ claude-deepseek -p --verbose --input-format stream-json --output-format stream-json < fifo
CLAUDE_PID=2218319（writer PID 2218318 握着 fifo 200s，sleep 200 后关闭→EOF）
t+5s..t+197s: -p process=ALIVE | marker=no   （每 5s 轮询全部 ALIVE）
t+203s: -p process=EXITED                      （= writer sleep 200 结束、fifo 关闭、EOF）
FINAL: EXITED
```
事件时间线（stdout 是 stream-json 事件流）：
- `t+9.4s`：主回合 result 事件，assistant text =「已启动后台 subagent」
- `task_started` 事件：后台 subagent（local_agent / general-purpose）已启动
- `t+~138s`：`task_updated` 事件 `{"patch":{"status":"completed","end_time":1785928843723}}` +
  `task_notification` 事件（status completed）+ `background_tasks_changed` 事件 `tasks:[]`
  ⇒ **后台 subagent 于 ~t+138s 完成**
- `t+138s → t+197s`：subagent 已完成、无更多后台任务，但 `-p` 进程**仍存活**（stdin 未关）
- `t+203s`：writer 的 `sleep 200` 结束、fifo 关闭（EOF）→ `-p` 进程才退出

（marker 文件始终未出现，是因为子代理在 sandbox 下被挡：`/tmp` 写被拒、`sleep` 前台被 harness 拦。
与核心语义无关——subagent 的**完成事件**由 `task_notification` 明确给出，且进程存活判据是 `ps`。）

**AC2 结论（未知 B）：** 分形态——
- **plain `-p 'prompt'` 参数形态：照退。** stdin 打开不持有会话；主回合 + 后台 subagent 回合结束即退出。
  此形态无法承载「驱动进程握 stdin = 持久会话」。
- **stream-json 形态：不关 stdin 就不退出。** 后台 subagent 异步完成（`task_notification` 事件投递），
  完成后进程**仍存活**到 EOF。**现有并发派发模型（3 个在飞 subagent、跨小时）可原样保留（移植）**，
  前提是驱动进程用 stream-json 形态并持续握着 stdin——这正是调研 §2 的「驱动进程接管」设计。

### §3 AC3 隔离证据

- 实验目录：`/tmp/claude-p-measure-scratch/{,ac2,ac2-stream}`（非 quay 开发树、非任何 worktree）
- 命令面：全部 `claude-deepseek`（ps 中的 `claude -p` 为其内部 `exec claude` 子进程）
- 未触碰任何在飞循环会话；未产生任何订阅计费（DeepSeek key 计费，非 Max 订阅态）

## Definition of Done

- [x] AC1–AC4 全部勾上（AC1 失败则只勾 AC1/AC3/AC4，AC2 记「未做：AC1 未过」）
- [x] AC1 的往返 + 负控制输出、AC2 的进程存活/退出证据逐字贴进本任务体
- [x] 不产生任何账单——全程 `claude-deepseek`，无裸 `claude -p`

## Touches

- tasks/gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics.md（自身文件：勾 AC + 贴 invoke 证据授权）
- （本任务不改产品代码——纯实测）
- orchestration/RESEARCH-claude-p-streaming-2026-08-04.md（AC4 结果回写，改此文件）

## Contract

measure   roundtrip_ok = `claude-deepseek -p '回复 OK 即可'` stdout 的行数字段
band      roundtrip_ok = ≥1（收到模型回复即过；空输出 = 不过）
invariant launcher_is_deepseek = 1（命令必须是 claude-deepseek，含自带 key；裸 claude -p 即违规）
invoke    `claude-deepseek -p '回复 OK 即可'`
control   `env -u ANTHROPIC_API_KEY -u DEEPSEEK_API_KEY claude-deepseek -p '回复 OK'` ⇒ 必须失败（AC1 负控制）
resume    每步实测即贴任务体，中断从缺口续跑

## Dispatch review

reviewer: outer
at: 2026-08-04T15:5xZ
changed: 外层受管理者交办立案。四处收紧：
(1) **窄实测，只验两个未知**——不是「查可用性」（调研 §6 已答完）；AC1/AC2 之外无扩充；
(2) **AC1 gating 先行的依赖写死**——不过则 AC2 不做，避免在无意义的退出语义上花时间；
(3) **AC2 判据是进程存活不是日志**——调研 §3B 原文明确，日志文本会说谎（这也是 D 任务那族教训）；
(4) **实钱风险进 DoD 而非仅注释**——`claude-deepseek` 是硬性 invariant，裸 `claude -p` 即违规。
status: todo——排在 ADR-016 二次 Amendment（`gap-adr-016-alternatives-rejected-...`）之后，
因为本任务的结论要写进那次的理由修正；且需安全窗口（纯 scratch 实测，不碰在飞循环）。
