---
id: gap-quay-task-agent-should-read-not-mirror-quay-file-task-dedup
title: quay-task agent 的 prompt 正文静态复述 quay-file-task skill 的去重/形态规则，应改为运行时 Read
  该 skill
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/agents/quay-task.md`（约 23-46 行）在 prompt 正文里**静态硬编码**了一份与 `plugin/skills/quay-file-task/SKILL.md` 几乎同形的规则副本：同样的「按机制而非症状去重、先 `task_list({search:...})` 再 `task_get`」纪律、同样的四种形状模板（finding/proposal/plan/contract）及各自必需 section、同样的「每个 section ≥40 非空白字符」门槛、同样的 `## Touches` 纪律。Grep 可在两个文件里独立确认匹配措辞（"MECHANISM"/"40 non-whitespace"/"Touches"）——这是第二份、在撰写时就被冻成快照的逻辑副本，而正本本应只活在 `plugin/skills/quay-file-task/SKILL.md` 里。

关键点：`plugin/agents/quay-task.md` 自己的 `tools:` allowlist（已确认：`task_list`, `task_get`, `task_write`, `task_check`, `gate_run`, `lifecycle_promote`, `lifecycle_retreat`, `lifecycle_complete`, `lifecycle_adjudicate`, `Read`）**已经包含 `Read`**——也就是说这个 agent 在派发时本就有能力直接读 `plugin/skills/quay-file-task/SKILL.md`，而不必携带一份会在 skill 规则更新、agent 文件未同步更新时静默漂移的静态副本（反之亦然）。

**实际使用权重（非理论/美观问题）**：一次会话历史量化核实发现，`quay-task` subagent 派发路径承担了本仓库约 35% 的真实 `task_write` MCP 调用（跨 main+subagent+workflow session jsonl 找到的 522 次真实 tool_use 调用中有 182 次），且同一 subagent 在本机发现的全部 5 个真正独立的其他 quay 驱动项目（`claudecodeui`, `cantus`, `meta-cc`, `archguard`, `quay-fleet`；各 2-96 次派发）里都在用——因此这项重复是在有意义的真实量级上被反复执行的，不是单纯的结构性瑕疵。

**与既有任务的关系**（dedup 核查记录）：`gap-quay-task-consolidated-subagent`（done）是最初建立该 agent 的任务，其设计讨论里提到「Dedup-by-mechanism（`quay-file-task` 已采用的纪律）用这套工具集本身就能做到」，但并未指出正文把该纪律**复制**进了 prompt 而非**引用**——即当时的设计本身就埋下了本任务要修的那份静态副本，`gap-quay-task-consolidated-subagent` 本身不覆盖这个漂移问题。`gap-ac167-baime-iteration-executor-removal`（done）只是在 plugin.json 里摘除另一个无关 agent（`baime-iteration-executor`）时顺带提到 `quay-task.md`，与本发现的机制无关。核查确认这两个都不是本发现的重复。

## Plan

1. 重读 `plugin/skills/quay-file-task/SKILL.md` 与 `plugin/agents/quay-task.md` 当前正文，列出重叠段落的精确行号范围（去重纪律段、四形状模板段、40 字符门槛段、Touches 纪律段）。
2. 改写 `plugin/agents/quay-task.md` 的对应段落：删除内联的硬编码去重/形状清单，替换为一条明确指令——在任何任务创建派发开始时先 `Read plugin/skills/quay-file-task/SKILL.md`，提取其当前的去重/形状/AC-DoD/Touches 规则并照此执行，而不是依赖本文件里可能过期的快照。
3. **不改动** `tools:` allowlist（必须继续不含 `Bash`/`Write`/`Edit`/`Grep`/`Glob`）——这纯粹是 prompt 正文改写，不是能力/权限变更。
4. 验证行为未退化：针对一个已知的历史重复检测场景重跑该 agent（例如本任务自身的 dedup 核查过程——先 `task_list(search=...)` 按机制词搜索，确认仍能正确识别/排除重复），确认改写后 agent 仍能正确标记重复任务而非漏判或误判。
5. 若 `packages/quay/plugin/agents/quay-task.md`（pack-time 生成的 gitignored 快照）在验证时存在，确认它由 `package.sh` 从同一正本重新生成，不需要手改。

## AC

- [ ] `plugin/agents/quay-task.md` 正文不再包含与 `plugin/skills/quay-file-task/SKILL.md` 重复的四形状模板清单/40-非空白字符门槛/Touches 纪律的逐条复述，而是包含一条显式指令要求运行时 `Read plugin/skills/quay-file-task/SKILL.md` 并据其当前内容执行去重与形状判断
- [ ] `plugin/agents/quay-task.md` 的 `tools:` frontmatter 与改写前逐字相同（仍为 9 个 MCP 任务/生命周期动词 + `Read`，不含 `Bash`/`Write`/`Edit`/`Grep`/`Glob`）
- [ ] 针对一个已知的历史重复检测场景重跑改写后的 agent，确认其仍能正确识别重复任务（给出具体场景与结果作为证据，不是断言）
- [ ] `plugin/skills/quay-file-task/SKILL.md` 本身未被本任务修改（本任务只改 agent 侧的复述，不改正本）

## DoD

`plugin/agents/quay-task.md` 的 prompt 正文里，去重机制、四形状模板、40 字符门槛、Touches 纪律这四类规则不再以静态复述形式存在，而是通过运行时 `Read` `plugin/skills/quay-file-task/SKILL.md` 获取——即该 skill 更新规则后，agent 下一次派发就能读到新规则，不需要再有人手动同步两处文本。`tools:` allowlist 不变。改写后用一个具体的历史重复检测场景验证过行为未退化。⛔ 只是在 prompt 里加一句「参考 quay-file-task」而未删除原有的硬编码清单，不算完成——必须是真正替换（移除重复内容），否则仍是两份副本共存、漂移风险未消除。

## Touches

- plugin/agents/quay-task.md
- plugin/skills/quay-file-task/SKILL.md
- tasks/gap-quay-task-agent-should-read-not-mirror-quay-file-task-dedup.md