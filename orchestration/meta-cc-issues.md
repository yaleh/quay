# meta-cc 问题报告（2026-08-02，外层实测）

**背景**：外层需要「查内层会话到底跑没跑某条命令」。这本该是 meta-cc 的强项，实测后改用了自写的
transcript 解析器（`orchestration/watch/inner-forensics.mjs`）。按 CLAUDE.md「report/fix issues
rather than working around them」，把不用它的理由如实列出。

**环境**：`~/.local/bin/meta-cc-mcp` v1.0.0（`initialize` 返回 `{"name":"meta-cc-mcp","version":"1.0.0"}`），
17 个 tool。

---

## 1. `jq_filter` 被忽略（阻断性）

三次不同的过滤器返回**逐字节相同**的前 N 条原始记录：

```
jq_filter: .[] | select(.input.command? // "" | contains("quay-wt-costmodel")) | {t,cmd}
jq_filter: [.[] | select(.isSidechain == true)] | length
jq_filter: .[] | .timestamp                       ← 决定性：这个不可能返回原记录
```

第三个是判据：`.[] | .timestamp` 只能产出字符串，而返回的仍是带 `message`/`usage`/`parentUuid`
的完整记录。**过滤器没有被应用。**

**后果**：无法做定向查询。`query_tools` 全量是 10,868 条、每条约 2KB —— 拉 ~20MB 回来在客户端过滤，
比直接读 transcript 更差。这是外层最终自写解析器的**唯一决定性原因**。

## 2. 文档的输出 schema 与实际返回不符

`query_tools` 的描述里写：

```
输出 schema: error, input, output, status, timestamp, tool_name, uuid
示例: .[] | select(.tool_name == "Bash" and .status == "error")
```

实际返回的是**原始会话记录**：`cwd`、`gitBranch`、`isSidechain`、`message.content[]`（工具调用在
这里面，`name`/`input` 是 `message.content[i]` 的字段，不是顶层）、`parentUuid`、`sessionId`、
`session_id`、`usage`、`version`。

按文档写的 jq 必然失配。而由于问题 1，失配时**返回未过滤数据而不是空集**——两个缺陷叠加后，
一个写错的查询看起来像是「查到了东西」。

## 3. `output_format: "tsv"` 被忽略

传 `tsv` 仍返回 `{"data":[...],"mode":"inline"}` 的 JSON。

## 4. `scope: "session"` 的语义存疑

传 `scope: "session"` 返回的记录里 `sessionId` 是当前会话
（`b8dc91a6-…`），但 `session_id` 是另一个更早的会话（`b67a225f-…`）。两个字段名只差一个下划线、
取值不同，且都出现在同一条记录里。不确定哪个是权威，也不确定 `session` 到底限定了什么。

---

## 好用的部分（不要因为上面几条否定它）

- **`inspect_session_files` 直接可用**：给绝对路径就返回 `record_types` 计数与 `time_range`，
  外层靠它一次就确认了内层会话文件的身份与跨度
- **stdio MCP 可从脚本调用**——外层一度以为「没有 CLI 就调不了」，实测错了：
  `initialize` → `notifications/initialized` → `tools/call` 三步，行分隔 JSON-RPC，几十行代码。
  所以**缺 CLI 不是阻断项**，问题 1 才是
- 索引里带 `isSidechain` 字段，说明 subagent 记录很可能已被收录——那正是外层最需要的数据
  （内层把任务派给 subagent，工具调用落在 `<会话 UUID>/subagents/agent-*.jsonl`，
  不在主 transcript 里）

## 一个可能有用的建议

`jq_filter` 修好后，外层的 `inner-forensics.mjs` 可以整体换成 meta-cc 查询。它现在自写的解析器
在一天内出过三个缺陷（窗口、归因方向、漏 subagent），**每个都产出过一份看起来很干脆但错误的结论**。
一个可靠的共享查询层比三个各自重写的解析器有价值得多。

另：`meta-cc query ...` 的普通 CLI 形态仍然会方便很多——不是因为脚本调不了 MCP，而是
`spawn + JSON-RPC 握手` 的样板每个脚本都要抄一遍。
