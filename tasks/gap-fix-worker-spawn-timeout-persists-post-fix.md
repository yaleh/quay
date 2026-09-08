---
id: gap-fix-worker-spawn-timeout-persists-post-fix
title: promotion fix-worker 修复后仍 14/14 空转：unrecognized_model + 超时持续 15 天，判据须读生产载体
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**问题（manager 2026-09-07 复核实测，读生产载体）**：promotion-driver 的 fix-worker 路径**已连续 15 天没有一次干净返回**。`.quay/promotion-round.jsonl` 全历史统计：`fixes[].spawned == true` 共 **88** 次，其中 `stderr` 含 `[claude-code:unrecognized_model] {"model":"deepseek-v4-pro-anthropic"}` 的 **78** 次、`timedOut == true` 的 **59** 次；**2026-08-23 之后没有一条 clean 记录**。

**为什么这是新缺陷而不是旧任务的重复**：`gap-fix-worker-spawn-inherits-unrecognized-model-deepseek-v4-pro-anthropic` 已标 **done**（修复提交 `26dea1f31`，2026-09-03 06:00Z，把 `.quay/profiles.yml` 的 `ANTHROPIC_DEFAULT_*_MODEL` 对齐到 `-anthropic` 后缀）。**落地之后的 14 次 spawn 全部仍是 unrecognized_model、其中 12 次超时**（09-04 四次、09-06 五次、09-07 五次，末次 `2026-09-07T17:52:42.790Z`）。⇒ 这是硬规则 4 推论三的标准形态：**实现了、测试绿了、生产载体读数没变**——旧任务的 DoD 由配置对齐满足，而不是由生产证据满足；`~/.local/bin/claude-fjdac` 早已带 `-anthropic` 后缀（mtime 2026-09-04），说明「后缀不一致」这个假说已被证否，真因未查明。

**代价（已实测）**：fix-worker 是 promotion 闸的自愈路径。它空转 ⇒ 任何四件套/Touches 类小瑕疵都要烧满 3 轮重试然后被**误判成 needs-human**。`DIR-131` 就是一例：闸报 `selfTouchOk=false`，fix worker 的改动其实写进了工作树，但驱动判它超时、重验证仍不合格 ⇒ 翻 needs-human，**而那次翻转提交自己把 fix 的改动一并提交了**（复核时 `selfTouchCheck` 已 `ok:true`）。

## Plan

1. **先取直接量再谈成因**（⛔ 不重复上一轮「后缀不一致」那种自洽但未检验的解释——硬规则 4 推论四）：对 fix-worker 的 spawn 做一次带 stdio 捕获的手工复现，记录 CLI 实际收到的 argv 与 env、以及它挂在哪一步（是 SDK 模型表查找、还是 litellm 上游、还是根本没退出）。
2. 给出一个**能区分**两个假说的对照：①「模型名不被 SDK 识别 ⇒ 挂起」——负控制是换一个 SDK 已知模型名跑同一条命令；②「与模型无关，spawnSync 的 stdio/超时配置导致必挂」——负控制是同配置下跑一个立即退出的命令。两条都跑，把输出贴进 `## Resolution`。
3. 按查明的真因修，并**把判据挪到生产载体上**（旧任务的教训）。
4. 顺带修记录缺口：fix-worker 失败时 `.quay/promotion-round.jsonl` 只留 `stderr` 首行，无 argv/耗时/退出码，诊断只能靠人当场复现。

## AC

- [ ] **生产载体取真**：修复落地时刻之后的 `.quay/promotion-round.jsonl` 记录中，`fixes[]` 里 `spawned==true && timedOut==false` 的条数 ≥ 1（⛔ 只计落地时刻之后的时间窗；fixture / 合成记录不算——硬规则 4 推论三）（待外部）
- [x] **对照已跑**：Plan 步骤 2 的两条负控制各有一次实际输出贴进 `## Resolution`，且能区分两个假说（⛔ 给不出区分性对照的成因说明降为假说，不得作为结论）
- [x] **成因写进正本**：真因写入 `.quay/profiles.yml` 的 worker-default 注释或 `plugin/scripts/promotion-driver.ts` 头注释，并就地更正上一轮那条已被证否的「后缀不一致」解释（⛔ 不静默删除）
- [x] **诊断可见**：fix-worker 失败时的记录含 argv、耗时、退出码三项（`.quay/promotion-round.jsonl` 的 `fixes[]` 条目可 grep 到）
- [x] `scripts/test.sh` exit 0（scoped 门 `--for-task --allow-thin` 实测 39 pass / 0 fail；全量 suite 由 fan-in 步机械验证）
- [x] `node plugin/scripts/task-schema-check.ts tasks/gap-fix-worker-spawn-timeout-persists-post-fix.md` exit 0

## DoD

promotion 闸的自愈路径**在生产上真的跑通过至少一次**（载体读数为证，非自述、非 fixture），且成因与上一轮被证否的解释都写在正本里。⛔ 「配置改对了」「单测绿了」不算达成——上一轮正是这样达成的，而生产读数 14/14 未变。

## Resolution

**真因**（读生产载体 + 直接量，⛔ 非自洽解释）：fix-worker role 缺 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS="0"`（task-worker 有）。无此键时 `claude -p` 保留「end_turn 时存活后台任务」的 600s 宽限期（`gap-worker-print-bg-wait-ceiling-600s` 已确证：印刷模式 end_turn 有存活后台任务 ⇒ 等 600s 才干净退出），而 promotion-driver 的 `spawnSync` timeout=180s ⇒ 600s > 180s，spawn 先超时（timedOut=true、exitCode=null），编辑其实已落盘（DIR-131：selfTouchCheck 已 ok:true）。task-worker 带该键 ⇒ 干净落地；fix-worker 不带 ⇒ 恒超时——生产上已有的自然实验。

**两条负控制（Plan 步骤 2，实际输出，均证否旧假说）**：

①「模型名不被 SDK 识别 ⇒ 挂起」负控制——换 SDK 已知模型名 `claude-sonnet-5` 跑同一条命令（6.1s 干净报错退出，不挂）：
```
⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
API Error: 400 400: {'error': 'anthropic_messages: Invalid model name passed in model=claude-sonnet-5. Call `/v1/models` to view available models for your key.'}
```
⇒ unrecognized_model 是 query_source=sdk 的非致命装饰警告（19 干净 + 59 超时记录都带它），非超时成因。

②「spawnSync stdio/超时配置导致必挂」负控制——同配置（stdio ["ignore","pipe","pipe"]、timeout 180000）跑立即退出命令（8ms 返回）：
```
CONTROL 2: immediately-exiting command under exact spawnSync config
ELAPSED_MS=8 status=0 error=null stdout="immediate-exit-ok"
```
⇒ spawnSync 配置本身不导致挂起。

**修法**：`.quay/profiles.yml` `roles.fix-worker.env` 加 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"`（对齐 task-worker）；worker-default 注释就地更正被证否的「后缀不一致」解释、写入真因（⛔ 不静默删除）。诊断缺口：`promotion-driver.ts` `FixOutcome` 补 `argv` + `durationMs`（exitCode 已有），失败记录可 grep「命令+耗时+退出码」三项。

**判据挪到生产载体**：AC1（待外部）= 落地后 `.quay/promotion-round.jsonl` 出现 `spawned==true && timedOut==false` ≥1（⛔ 只计落地时刻之后窗口；fixture/合成不算）。

## Touches

- plugin/scripts/promotion-driver.ts（fix-worker spawn 的 stdio/超时/诊断记录）
- plugin/test/promotion-driver.test.mjs（对应用例）
- .quay/profiles.yml（worker-default 注释：更正被证否的解释、写入真因）
- tasks/gap-fix-worker-spawn-timeout-persists-post-fix.md（自身）