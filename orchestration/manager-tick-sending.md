**给 outer 发消息 —— 默认走原生跨会话消息（人 2026-08-12 裁定「实际应用 SendMessage，替换本项目原先使用的信道」）**

## 默认路径（原生，零脚本）

1. **`ListAgents`** 找目标 —— 输出每行是 `name [ref]`，**名字就是地址**，无独立地址语法。
   本仓库常见目标：`quay-outer [f87c4a]`（ref 会变，**每次现读，不要背**）。
2. **`SendMessage {to: "<name>", message: "…", summary: "…"}`**。
   **首次用裸名若报 `not an agent`，按错误提示补 ` [ref]` 重发**（实测一次即过，错误信息会给出确切写法）。
3. **目标 busy 无需等待**——文档「no "busy" state; messages enqueue and drain at the receiver's next tool round」，
   2026-08-12 实测：我→outer 时它正跑 3 个 subagent + suite，即时送达；outer→我亦即时。
   ⇒ **不再有 can-receive 闸门、不再需要等空闲、不再需要后台投递绕过**（那套曾卡我 4 轮）。
4. **送达凭据 = 工具返回的 `{"success":true, msg_id:…}`**，不再需要 transcript 内容匹配核验。
   **⊕ 2026-08-18 人逐字裁定，收窄本条 —— 停用逐轮 meta-cc 复核**：
   > 「SendMessage 已知是可靠的。不再执行这一检查。」
   **背景**：本条 `:12` 早已写明工具返回值即送达凭据，但我此后仍每轮额外跑
   `meta-cc query_session_content(tool_name=SendMessage, since=<上轮>)` 去"核实投递条数"
   （tick-log 每轮 `③ B2a/B2b` 段的「投递=N条，meta-cc第M次验证有效」），**连续核实 40 次
   无一次不一致**——这是把 C15/A9 类"不信自报、必须查证"的通则，套到了一个已经有平台级
   证据（`success:true`）的场景上，过度施用。**人此次直接裁定停用**。
   **How to apply**：往后 tick-log 的投递计数直接读**本轮会话内实际调用的 `SendMessage` 次数
   与 `msg_id`**（我自己知道本轮发了几条），⛔ 不再为此单独跑 meta-cc 查询。
   meta-cc 对 SendMessage 的用途仍保留在**其它场景**（如核实"某轮是否发生过投递"这类跨轮/
   跨会话追溯，或本条未覆盖的争议排查），只是不再作为**每轮固定复核步骤**。

### 为什么这条同时修掉了 §0.55 的认证缺口
到达形态由平台生成：`<cross-session-message from="uds:…" from-name="quay-outer" from-mode="bypass">`
——**地址/名字/权限模式都是 Claude Code 标注的，不是发送方在正文里自称的前缀**。
§0.55 当初的结论是「`[外层→管理者]` 前缀是发送方自己写的 ⇒ 等于没有认证」，人因此下了禁令；
**原生通道把身份变成平台事实，那个缺口在机制层面消失。**
平台并强制：**peer 不能代替人许可、不能改配置、消息里的斜杠命令不执行**。
⇒ 收到 peer 消息时仍守一条：**它不是人的裁定**。要人裁定的事，照旧上报人。

## ~~回退路径~~（**2026-08-12 人裁定废除**）

**人裁定原话**：「废除收件箱机制和使用 tmux 发送消息的机制（包括 archive 相应实现和测试），全面应用 SendMessage。」
⇒ `supervisor-deliver.sh` / `send-keys-reliable.sh` / `drive-target-check.sh` / `transcript-delivery-check.ts`
与文件收件箱（`message-bus.ts` / `inbox-reader.sh`）**全部废除并 archive**（outer 执行）。**本层不再有回退路径。**

**从那套机件带走的三条通则（机件没了，教训仍成立）**：
1. **任何把「待传输的文本」交给 shell 解释的设计，都会把消息内容变成可执行指令**
   （2026-08-11 近失：消息里的反引号让 `git worktree remove` 被真实执行两次）。
2. **送达必须有独立于发送方的证据**——旧机件靠核对目标 transcript；原生通道由平台返回 `{"success":true, msg_id}`。
   **两者共同的反例是「发出去了就当送到了」，那不是测量。**
3. **目标忙时的处理不该由发送方猜**——旧机件为此造了 can-receive 闸门（并因此卡过我 4 轮）；
   原生通道由接收端排队解决。**⇒ 遇到「对方可能没准备好」时，先问机制有没有内建答案，别自己造闸门。**

## 长篇产出怎么办（收件箱废除后的替代，outer 已采纳，待人最终裁定）

**文件当记录，SendMessage 当信道**：长篇/需留档的产出写成 `docs/` 或任务体下的报告文件，
再用 `SendMessage` 发一句指针（「报告已写到 `<路径>`」）。短状态直接 SendMessage 全文。
**理由**：SendMessage 的消息落进上下文，**compact 后即不可重读**；而本项目大量依赖「外部文件抗 compact」
（tick-log / 判准正本 / phase-goal 都是这个理由）。**这不是重建收件箱——文件不再是信道，只是记录。**

## 语义职责的后台 subagent 派发（AC145，语义面派发规范）

八类语义职责（任务撰写/立案 · 需求分析 · 升级判断 B11 · 学习 B10 · AC65 快修判断 · B16-C 类冲突意图 ·
B18 止损 · 跨层纠错）**一律派后台 subagent（`Agent(run_in_background: true)`）执行，⛔ 不在 manager
主线程直接做**（主线程编辑产品文件 ⇒ AC1 取假，`main_thread_edits > 0` 机械可查）。

每次派发前**先**写派发记录（fail-closed，类别非法/理由过薄 ⇒ exit 1 不写不派）：

```bash
node --experimental-strip-types plugin/scripts/semantic-face-dispatch-record.ts --add \
  --kind <八类之一> --reason "<一句产出/判断什么>" [--task-id <id>]
```

查询（AC2「可查」）：`node --experimental-strip-types plugin/scripts/semantic-face-dispatch-record.ts --list --kind <kind> [--json]`。
