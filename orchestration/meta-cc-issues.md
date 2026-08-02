# meta-cc 问题报告

**报告方**：quay 双层持续开发的外层编排会话。
**用途场景**：外层需要核实内层开发会话「到底跑没跑某条命令」。此前靠自己重跑一遍（8 分钟 + 8 路
满载，还会把内层的 timeout 余量压成 flaky），改用 meta-cc 查 transcript 后是秒级、零干扰。

**最后复测**：2026-08-02，升级后重连版本。

---

## 未决

### 1. 文档字段名与实际返回不符：`session_id` vs `sessionId`

`query_session_content` 的工具描述写：

> `role=tool outputs: {timestamp, session_id, turn, ...block fields}`

实际返回的键（`jq_filter: .[0] | keys`）：

```json
["caller","id","input","name","sessionId","timestamp","turn","type"]
```

是 **`sessionId`**（驼峰），不是 `session_id`。

**为什么值得修**：按文档写 `.session_id` 得到的是**空值而不是报错**。在 `output_format: "tsv"` 下
表现为一整列空白，很容易被当成「这些记录恰好没有 session」。复现：

```
role=tool, block_type=tool_use, tool_name=Bash, contains=<任意>,
jq_filter: .[] | {t: .timestamp, s: .session_id, turn: .turn},
output_format: tsv
→ 表头 s t turn，s 列全空
```

### 2. `caller` 字段未文档化，且语义似乎未实现

`role=tool` 的返回里有 `caller`，工具描述未提及。实测（2026-08-02，窗口 15:40Z 起）：

- 全部非 null 值去重后**只有一个**：`{"type":"direct"}`
- `caller: null` 同时出现在主会话与 subagent 会话里：
  `include_subagents:false` 时仍有 33 条 null（`3bbd3095` 24 条、`82ecfb6a` 9 条）

也就是说 `caller` **与「是否来自 subagent」不相关**。若它的本意是标记调用来源，目前没有起到作用；
若它另有含义，文档里没有。

**为什么值得修**：一个未文档化且看起来像判据的字段，会被使用者拿来当判据。外层就差点用它来区分
「内层在等自己派的 subagent」和「内层在等裁定」——这两者外部观察无法区分，是一个真实的待解问题
（见下方「这个场景为什么重要」）。

### 3.（不是缺陷，建议文档化）默认 `scope: "project"` 会混入调用方自己的会话

外层最常用的查询是「内层跑了什么」。实测：不传 `session_id` 时，返回的前 8 条**全是外层自己的
命令**——因为 project scope 覆盖同一项目下的所有会话，包括提问者本身。

结果看起来完全正常，只是回答了另一个问题。**正确用法是传 `session_id`**，`contains` 单独用会串。
建议在 `scope` 的描述里点明这一点，或在 `session_id` 的描述里加一句「跨会话核实场景应优先使用」。

---

## 已验证修复（升级前报告过，现已复测通过）

| # | 原问题 | 复测 |
|---|---|---|
| 1 | `jq_filter` 被忽略 | **已修**。`.[] \| .timestamp` 返回纯时间戳数组；升级前同样的过滤器返回完整记录 |
| 2 | `output_format: "tsv"` 被忽略 | **已修**。`#` 前缀 envelope 注释 + 表头 + 制表符行 |
| 3 | `scope: "session"` 返回别的会话 | **已修**。新增 `session_id` 参数，且文档明确了它与 `scope` 的区别；实测只返回该会话记录 |
| 4 | 文档输出 schema 与实际不符 | **大部分已修**，残留见未决 #1 |

### 交叉验证

同一问题——「内层会话自 2026-08-02T12:29:10Z 起跑了几次全量套件」——meta-cc 与外层自写的
`orchestration/watch/inner-forensics.mjs` 给出 **7 条、时刻逐条一致**：

```
13:01:35  14:19:40  14:38:51  14:50:58  15:11:03  15:18:59  15:29:25
```

两个独立实现吻合，双方都可信。

### 最有价值的改进：`include_subagents` 默认 true

Claude Code 的开发会话会把任务派给 subagent，**subagent 的工具调用不在主 transcript 里**
（它们在 `<会话 UUID>/subagents/agent-*.jsonl`）。外层自写的解析器最初漏了这一层，导致一份吞吐
成本分解**算错**：把「subagent 在干活、主会话安静」判成了「内层在等外层裁定」，空转报成 49%，
实际是 14%。

meta-cc 默认收录，一次就对。实测差距：同一查询含 subagent **223 条**、不含 **15 条**。

---

## 这个场景为什么重要（供判断优先级）

外层每 20 分钟要独立核实内层的一项声称。可靠的 transcript 查询把这件事从「重跑一遍，8 分钟且抢
CPU」变成「查一次，秒级且零干扰」。已接进外层 tick 的固定步骤。

目前仍未解决、且 meta-cc 有可能解决的一个问题：**外部观察无法区分「内层在等自己派的 subagent」
与「内层停下在等裁定」**——两者 transcript 尾部形态相同（最后一条是无 tool_use 的 assistant
消息），遥测在两种情况下也都显示任务在飞。外层现在只能做成两级信号（90 秒 / 600 秒不同阈值）并
如实标注不确定。

若 meta-cc 能给出「某会话此刻是否有未返回的 subagent 调用」，这个歧义就消失了。`caller` 字段
（未决 #2）看起来是朝这个方向去的。

---

## 一个便利性建议（不阻断）

只安装了 `meta-cc-mcp`（stdio MCP server），没有普通 CLI。**脚本能调 MCP**——
`initialize` → `notifications/initialized` → `tools/call`，行分隔 JSON-RPC，几十行代码，已实测通过，
所以缺 CLI**不是阻断项**。但 Monitor 这类 shell 脚本每个都要抄一遍 spawn + 握手的样板；
一个 `meta-cc query ...` 形态会让这类外层工具直接复用查询能力，而不必各自重写解析器。

外层自写的那个解析器一天之内出过三个缺陷（窗口错、归因方向错、漏 subagent），
**每个都产出过一份看起来很干脆但错误的结论**。一个可靠的共享查询层比三个各自重写的解析器有价值
得多——这也是上面几条值得修的根本理由。
