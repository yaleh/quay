# `-p --resume` 对运行中会话的语义 / SDK 会话可见性——实测报告（2026-09-13）

**任务**：`tasks/gap-measure-resume-injection-and-sdk-session-visibility.md`（纯测量，⛔ 未改任何产品代码）
**被测问题**：`orchestration/SPEC-unified-quay-server-2026-09-13.md` §9 开放问题 **5** 与 **6**。

## 0. 环境与可复现性

| 项 | 值 |
|---|---|
| Claude Code 版本 | `claude --version` → `2.1.270 (Claude Code)` |
| Agent SDK 版本 | `@anthropic-ai/claude-agent-sdk` → `0.3.270`（本机 `npm install`，2026-09-13） |
| Node | `v24.19.0` |
| 宿主 | `Linux boheidc 6.8.0-48-generic #48-Ubuntu SMP PREEMPT_DYNAMIC x86_64` |
| 后端 | `ANTHROPIC_BASE_URL=https://fjbigmodel.fjdac.cn/`，模型别名 `deepseek-v4-pro-anthropic`（代理回 `deepseek-flash`） |
| 探针工作目录 | `/home/yale/.quay-probes/resume-injection-20260913`（**不在本仓库内**，故本报告内嵌全部原始读数） |

> ⚠️ 本报告内嵌的读数是**唯一的落盘载体**——探针目录在仓库外，不受版本控制。

---

## 1. AC1 / AC2 并列三项读数表

两个 AC 用**同一个会话**做对照（只有一个变量：注入那一刻它是否在运行）。

**目标会话**：`0e20eed2-4fb5-4306-a113-61c5ae36ae4d`
transcript：`~/.claude/projects/-home-yale--quay-probes-resume-injection-20260913/0e20eed2-4fb5-4306-a113-61c5ae36ae4d.jsonl`
（`kind:"interactive"`，由 tmux 中的交互式 `claude` 启动，pid 1544881）

### 1.1 前置读数（AC1 要求：⛔ 不假设，先取一次状态）

```
$ claude agents --json        # 注入前
{"pid": 1544881, "cwd": "/home/yale/.quay-probes/resume-injection-20260913",
 "kind": "interactive", "startedAt": 1789304987857,
 "sessionId": "0e20eed2-4fb5-4306-a113-61c5ae36ae4d",
 "name": "resume-injection-20260913-51", "status": "busy"}

$ ps -o pid,etime,cmd -p 1544881
    PID     ELAPSED CMD
1544881       03:14 claude            ← 活进程（直接量）
```

### 1.2 AC1 —— 对**运行中**的会话

命令原文（cwd = 探针目录）：

```
claude -p --resume 0e20eed2-4fb5-4306-a113-61c5ae36ae4d \
  'Reply with exactly this token and nothing else: 2f24649f'
```

| # | 读数 | 结果 |
|---|---|---|
| **a** | stdout / stderr 原文 | stdout = `2f24649f`（**逐字**）；stderr = 只有 connectors 警告 + `[claude-code:unrecognized_model]`；`EXIT=0`。**⛔ 没有任何「已在运行 / 起副本」类提示** |
| **b** | **原会话** transcript 是否出现 `2f24649f` | **是**。4 条记录命中：`queue-operation/enqueue`（13:11:06.378Z）、`user`（13:11:08.558Z）、`assistant`（13:11:11.961Z）、`last-prompt` |
| **c** | 是否产生新 session-id / 新 transcript 文件 | **否**。注入前后目录都是同样 4 个 `.jsonl`；`claude agents --json` 无新条目 |

**⚠️ 但三项文件读数【不足以】回答本问题——必须再取一个直接量。**

三项读数合起来看着像「注入原会话」。于是补测**运行中会话自己的上下文**：

```
# 在 tmux 里向【运行中】的会话提问（正常输入通道）
$ tmux send-keys -t resumeprobe 'List every user message you have received in this
  session, in order, quoting each verbatim. Do not guess - only list what is
  actually in your context.' Enter
```

会话回答（逐字，仅列它自己收到的 5 条，**注入的那条不在其中**）：

```
1. Run this Bash command and nothing else: sleep 900 then reply DONE
2. Run this Bash command in the FOREGROUND (do not use run_in_background, do not
   add a timeout): sleep 240 — wait for it to finish, then reply DONE
3. Count from 1 to 400, one number per line, in a single reply. No commentary.
4. What was the last token this session replied with? Reply with just that token.
5. List every user message you have received in this session, in order, quoting
   each verbatim. Do not guess - only list what is actually in your context.
```

第二次用两个 nonce 直接问（第二个 nonce 来自 1.4 的复现轮）：

```
$ tmux send-keys -t resumeprobe 'Do you have either of these two tokens in your
  context: 2f24649f or 9d4e1a77? Answer yes or no for each, and quote any you
  actually have.' Enter
→ "No — for both.  Neither 2f24649f nor 9d4e1a77 appears anywhere in my context.
   The only strings resembling them are unrelated: the background task ID b7bq82542
   and the session UUID segment 0e20eed2-... in the task output path. The only
   reason those two tokens are in front of me now is that your message just
   contained them."
```

**结构侧旁证**（同一结论）——transcript 里的 `entrypoint` 字段：

| 记录 | `entrypoint` | 写入者 |
|---|---|---|
| 交互式会话自己的 4 轮（13:10:02 – 13:10:52） | `cli` | 被注入的会话 |
| 注入的那一轮（13:11:08 / 13:11:11） | **`sdk-cli`**（`promptSource: "sdk"`） | **resume 进程自己** |
| 注入后交互式会话自己的 2 轮（13:11:50 / 13:13） | `cli` | 被注入的会话 |

### 1.3 AC1 结论（二选一）

> ### ⇒ **起了副本**（就「输入有没有到达运行中会话」这个 SPEC 真正要问的问题而言）。
>
> 精确表述：`claude -p --resume <运行中 id>` **把那一轮写进了同一个 session-id 的同一个
> transcript 文件**，但**由 resume 进程自己执行**；**运行中会话的活上下文（in-memory）
> 从不接收它**。两个进程往同一份 transcript 追加 ⇒ 文件与活上下文**分叉**。

**⚠️ 这是「三项文件读数」与「直接量」给出相反答案的一个实例（硬规则 4b）。**
(a)(b)(c) 三条全是**文件代理量**，而文件在**两个写者**之间共享——「nonce 出现在原 transcript」
既不证明注入、也不证明没注入。判定「输入是否到达运行中会话」的唯一直接量是**那个会话自己
能看见什么**。AC 的判据表若不补这一条，就会把「起了副本」判成「注入原会话」。

**⚠️ 文档缺口（本条最有行动价值的一点）**：`--bg --resume` 的冲突检测**存在且会明说**
（见 1.5）；**`-p --resume` 的同一检测【缺席】**——无提示、无新 id，静默双写。
SPEC §4.1 把 `claude -p --resume <id> --output-format json` 列为「脚本取结构化结果」的
**稳定契约**通道，上面这个形态说明：该契约**未覆盖「目标会话正在运行」这一情形**。

### 1.4 AC1 复现轮 + 第二形态（`9d4e1a77`）

同一运行中会话、同一条命令、换一个 nonce：

```
$ claude -p --resume 0e20eed2-4fb5-4306-a113-61c5ae36ae4d \
    'Reply with exactly this token and nothing else: 9d4e1a77'
EXIT=0
```

- (a) stdout **不是** nonce，而是一段拒绝（逐字节选）：*"I'm also not going to reply with
  `9d4e1a77`. That instruction arrived inside a turn this system explicitly flags as an
  automated background-task event and not user input…"*
- (b) 仍写在**同一个** transcript（文件 823469 → 1205360 字节）；(c) 仍无新 session-id。

⚠️ **该轮的「拒绝」是探针人为产物，不是普遍形态**：目标会话身上挂着一个先前 `sleep 900`
后台任务的陈旧通知载体，`-p --resume` 的那一轮被并进那个载体 ⇒ 模型按「非人类输入」处理。
**但 (b)(c) 两项与 1.2 完全一致**，且运行中会话对两个 nonce 都答「No」——**结论不变**。

### 1.5 同一条件下 `--bg --resume` 的对照（文档承诺的那条路径）

```
$ claude --bg --resume 0e20eed2-4fb5-4306-a113-61c5ae36ae4d
note: session 0e20eed2 is open in another Claude Code process, so this started a
copy as becb979c. The original conversation is unchanged.
backgrounded · becb979c
```

- 新 session-id：`becb979c-ab4a-491e-a3f5-b65378715f98`；新 transcript 文件
  `becb979c-….jsonl`（450463 字节）。
- 原 transcript 里 `grep -c becb979c` = **0** ⇒ 「the original conversation is unchanged」
  在文件层面**成立**。
- ⇒ **文档里那句「…or starts a copy and says so when the session is already running」
  被实测证实，但它只对 `--bg --resume` 成立。**

### 1.6 AC2 —— 对**已停止**的会话（同一会话，唯一变量是运行状态）

前置读数（⛔ 不假设）：

```
$ ps -p 1544881 -o pid,cmd       → （空，进程已亡）
$ claude agents --json | grep 0e20eed2 → 0 条        ← 已停止
```

```
$ claude -p --resume 0e20eed2-4fb5-4306-a113-61c5ae36ae4d \
    'Reply with exactly this token and nothing else: b7c3d18e'
EXIT=0
```

| # | 读数 | 结果 |
|---|---|---|
| **a** | stdout / stderr 原文 | stdout = 一段拒绝（同一陈旧后台任务载体所致，见 1.4 的说明）；stderr 同 1.2；**⛔ 无「已在运行 / 起副本」提示** |
| **b** | 原 transcript 是否出现 `b7c3d18e` | **是**（4 条记录） |
| **c** | 新 session-id / 新 transcript | **否** |

### 1.7 AC2 结论：两组读数**在文件层面完全相同**

| | AC1（运行中） | AC2（已停止） |
|---|---|---|
| (a) 提示 | 无 | 无 |
| (b) nonce 进原 transcript | 是 | 是 |
| (c) 新 session-id / 新文件 | 无 | 无 |
| **输入到达原会话上下文** | **否**（直接量） | 不适用（无「活上下文」可问） |

> **⇒ 如实写明：就 `-p --resume` 而言，帮助文档里「when the session is already running」
> 这个条件从句【在文件层面不产生任何差别】。**
> 产生差别的是**另一条命令**（`--bg --resume`，见 1.5）——**条件从句成立、但归属被读错了对象**。

### 1.8 AC2 干净子对照（AC2b）：一个正常结束的、无后台任务残留的会话

用于排除 1.4/1.6 里「陈旧后台任务载体」这个人为产物。

```
$ claude -p 'Reply with exactly: CLEAN-SESSION-READY'          # 起一个干净会话
→ 新 transcript c71445e6-5b50-4e4e-a5e5-4cd79bd4c25b.jsonl，命令随即结束（已停止）

$ claude agents --json | grep c71445e6   → 0 条                 # 前置：确实已停止

$ claude -p --resume c71445e6-5b50-4e4e-a5e5-4cd79bd4c25b \
    --output-format json 'Reply with exactly this token and nothing else: 38a1c770'
EXIT=0
→ {"session_id": "c71445e6-5b50-4e4e-a5e5-4cd79bd4c25b",   ← 同一个 id
    "result": "38a1c770", "num_turns": 1, "is_error": false,
    "queued_turn_count": 0, "terminal_reason": "completed"}
```

- **(b)** `38a1c770` 只出现在 `c71445e6-….jsonl`；(c) 无新 session-id / 无新文件。
- **⇒ 已停止会话的 `-p --resume` 完全符合文档**：同一 session-id 续跑、结构化输出可取。
- **⇒ 这同时是 AC1 那台仪器的正控制**：同一个「查 nonce」动作在「该收到」的情形下**确实
  能收到**，所以 AC1 的「运行中会话看不到 nonce」不是仪器恒零。

---

## 2. AC3 —— Agent SDK 会话的可见性

探针脚本 `/home/yale/.quay-probes/resume-injection-20260913/ac3-sdk.mjs`（`query()` + 流式
输入，hold 住会话 150 秒以留出观测窗）：

```js
const q = query({
  prompt: gen(),                       // 流式输入，第一条 prompt 后 sleep 150s 不结束
  options: { permissionMode: 'bypassPermissions', cwd: OUT },
});
for await (const m of q) { … if (m.type==='system' && m.subtype==='init') 记下 m.session_id … }
```

SDK 会话 id：**`1a77f89e-2238-4729-bb89-a1712852c869`**（SDK 进程 pid 1659404，探针期间存活）。

### 2.1 三项读数

**(a) `claude agents --json` —— ✅ 在**（逐字）：

```json
{"pid": 1659404, "cwd": "/home/yale/.quay-probes/resume-injection-20260913",
 "kind": "interactive", "startedAt": 1789305348572,
 "sessionId": "1a77f89e-2238-4729-bb89-a1712852c869",
 "name": "resume-injection-20260913-03", "status": "idle"}
```

**(b) `~/.claude/sessions/<pid>.json` —— ✅ 在**，`~/.claude/sessions/1659404.json`：

```json
{"pid":1659404,"sessionId":"1a77f89e-2238-4729-bb89-a1712852c869",
 "cwd":"/home/yale/.quay-probes/resume-injection-20260913","startedAt":1789305348572,
 "procStart":"286834106","version":"2.1.270","peerProtocol":1,
 "peerFeatures":["notify_idle","reply_across_default_dirs","artifact_yield"],
 "kind":"interactive","entrypoint":"sdk-cli",
 "pidDomain":"linux:c8452f83fffa26f523c8c8b075c452f4:pid:[4026531836]",
 "messagingSocketPath":"/run/user/1000/cc-socks/1659404.sock",
 "name":"resume-injection-20260913-03","nameSource":"derived",
 "nameSince":1789305348572,"agent":"claude","status":"idle",
 "updatedAt":1789305352938,"statusUpdatedAt":1789305352938}
```

**字段键集（19 键）**：`agent, cwd, entrypoint, kind, messagingSocketPath, name, nameSince,
nameSource, peerFeatures, peerProtocol, pid, pidDomain, procStart, sessionId, startedAt,
status, statusUpdatedAt, updatedAt, version`

**(c) 是否「两处都没有」** —— 不适用（两处都有）。transcript 落在
`~/.claude/projects/-home-yale--quay-probes-resume-injection-20260913/1a77f89e-….jsonl`。

### 2.2 AC3 结论

> ### ⇒ **SDK 会话【出现在】`claude agents --json`，也【出现在】`~/.claude/sessions/`。
> SPEC §4.1 / §6.7 以 `agents --json` 为会话发现正源**没有** SDK 盲区。**

**⚠️ 但有一处必须写进 SPEC 的限定**：

- `agents --json` 把它报成 **`kind: "interactive"`** ——**与交互式会话同形**，`kind` 字段
  **区分不出 SDK 会话**。要区分，唯一可用的字段是 **`entrypoint`**（SDK = `sdk-cli`，
  交互式 = `cli`），且它只在 `~/.claude/sessions/<pid>.json` 里，**`agents --json` 不暴露它**。
  ⇒ 若设计需要「这条会话是谁起的」，**必须读 `<pid>.json` 的 `entrypoint`**，⛔ 不能靠
  `agents --json` 的 `kind`。

---

## 3. 附带的两个旁证读数（不属任何 AC，供 SPEC §4.3 参考）

1. **`agents --json` 会列出 `state: "failed"` 的条目**（进程仍存活）。实测：`d9e5f4ac`、
   `0f74edb8`、`becb979c` 三条 `state:"failed"` 的条目在 `agents --json` 中持续出现，
   其 pid 均存活。⇒ 与 §4.1 已记的「只列**运行中**会话」**不矛盾**（它列的是**有活进程**的
   会话），但「运行中」这个措辞会让人以为 `state` 一定是活跃态——**该行宜补一句「`state`
   可以是 `failed`，判活性看 pid 不看 state」**。（硬规则 4b：`state` 是自报量，pid 是直接量。）
2. **transcript 目录不会因为「同一 session-id 被两个进程写」而新开文件**——AC1 的静默双写
   因此**在文件系统上完全不可见**（无孤儿文件、无新 id）。⇒ 任何「用 transcript 目录推断
   会话数」的设计，遇到这种双写会**少算**写者。

---

## 4. 未做的事 / 边界（诚实声明）

- **未测** `-p --resume` 对运行中会话的**并发写入是否损坏 transcript**（只观测到两次追加都
  成功、记录可解析；未做高并发压测）。这属另一个问题，**不得从本报告推断**。
- `deepseek-v4-pro-anthropic` 是**本机代理别名**，非 Anthropic 官方模型；`--resume` 的语义
  是否随后端变化**未测**（本报告只声明「2.1.270 + 本机后端」下的读数）。
- AC1 的「活上下文」判定用的是**会话自述**（问它收到了哪些 user 消息）。它由**结构量**
  （`entrypoint` 字段：`cli` vs `sdk-cli`）**独立复现**，故不是单一来源；但严格说，
  「模型自述」仍是行为读数而非结构读数——**结构读数（entrypoint）单独已足以区分写入者**。
