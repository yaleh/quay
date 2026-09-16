---
id: gap-readme-positioning-software-engineering-agent
title: README.md 缺 GOAL-021/AC-276 要求的定位陈述：quay = software engineering
  agent，Claude Code = 其基础设施（内蕴，非反向）——判据真跑 exit 1 CAUSE=positioning-missing
status: ready
labels:
  - gap
  - docs
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-276
---
**type:** execution

## Finding

**缺口（直接量，立案当轮实测）**：GOAL-021 的 AC-276 要求 README.md 的前 6000 字符同时给出
「quay 是 software engineering agent」与「Claude Code 是其底层基础设施（内蕴关系）」的定位陈述。
**README 当前两者一个字都没有**，判据真跑 = exit 1。

命令（与 `goal-store gate` 的 `runAcceptance({command: criterion, cwd: root})` 同形，cwd = 主检出）：

```
node --experimental-strip-types --input-type=module -e '…parseFrontmatterCompletely(goals/AC-276-*.md).criterion…' > /tmp/ac276-criterion.sh
bash /tmp/ac276-criterion.sh
```

读数（逐字）：

```
CAUSE=positioning-missing — README.md head (first 6000 chars) does not contain "Software Engineering Agent"
EXIT=1
```

**三条独立读数（同一结论，都是直接量）**：

1. `POS = ["Software Engineering Agent", "software engineering agent"]` 在 `README.md[:6000]` 里
   **0 命中**；`INFRA = ["基础设施", "infrastructure"]` 在 `README.md[:6000]` 里 **0 命中**。
2. `infrastructure|基础设施` 在**整篇 README**（37832 字节）也 **0 命中**（全文件 `re.finditer` 扫，
   0 条）——不是「不在 head」，是整篇都没有这个词。
3. 三条反向措辞正则当前 **0 命中**——本条不需要先改掉任何既有表述，只需要加上定位段落。

**偏移读数（决定新段落能放哪）**：`# quay` @0、`## The three packages` @702、
`## Sample workspace vs. this repo's own backlog` @1767、`## Install` @3554；第 6000 字符落在
`### Using the npm-installed quay with Claude Code` 节体内。⇒ 6000 窗口覆盖「标题 + 三包表 +
sample workspace + install 开头」；**新段落必须落在标题之后 ~700 字符内**——追加到文件末尾读不到。

**现状为什么不算定位陈述**：`README.md` 开头把 quay 定义成 "a provider-agnostic task board: a small
**Core** CLI/MCP client plus a pluggable **Provider ABI**"——那是它**暴露的产品面**（怎么做），
不是它**是什么**（AC-276 要的是后者，且要显式给出「Claude Code 是它的基础设施，⛔ 不是反过来」）。

**去重读数（立案前逐条核，都是直接量）**：

- `grep -rl 'goal_ac: *AC-276' tasks/` ⇒ **0 个文件**；全 `tasks/` 对 `software engineering agent`
  大小写不敏感 grep ⇒ **0 命中**。没有任何在飞任务承接这条 AC。
- 相关但机制不同的已 done 任务：`gap-docs-t2-root-readme-refresh`（README 的版本字面量 / usage 命令数
  / 配置两节 / 断链准确性）与 `gap-docs-t3-webui-doc-and-screenshots`（Web UI 文档 + 截图）。
  两者都不涉及定位陈述，与本条不重叠。
- 当前**没有任何非 done 任务在 `## Touches` 里声明 `README.md`**（逐条核全部 non-done 任务的
  Touches 段）⇒ 无 Touches 锁冲突，本条可派。

## Requested action

在 `README.md` 的 `# quay` 标题之后、`## The three packages` 之前，写入一段**定位陈述**。

三条内容要求，缺一不可：

1. quay 本身就是一个 **software engineering agent**——与 Claude Code / Codex 属同一类别；⛔ 不是
   「一个 task board 框架」「一层协议」「Claude Code 的插件」。
2. **Claude Code 是 quay 的底层基础设施**：quay 运行在它之上，用的是它提供的 LLM 推理、工具调用、
   subagent 派发能力；这个关系是**内蕴的**，类比「OS 之于 Claude Code」。
3. ⛔ 主体不得写反：不得出现「quay 让 / 使 Claude Code 成为 agent」或
   「quay turns/makes/transforms Claude Code into …」这类表述（AC-276 的三条反向正则钉的就是这个）。

用词硬要求（判据按**字面**匹配，不是语义理解）：段内必须含逐字串 **`Software Engineering Agent`**
（或 `software engineering agent`），以及 **`infrastructure`**（或中文 **`基础设施`**）。
位置硬要求：整段落在 `README.md` 的**前 6000 字符**内。
形态硬要求：它是**真实散文陈述**（≥150 非空白字符、明确提到 Claude Code），⛔ 不是把两个关键词塞进
一行充数——AC5 钉这个。

另外新增一个仓内守卫测试（AC4）：它跑的是 AC-276 的 **criterion 本身**（从 `goals/AC-276-*.md` 读出），
⛔ 不另抄一份等价谓词——抄一份就是「同一内容存在两处即漂移」。

## Acceptance Criteria

- [ ] AC1: AC-276 的 criterion 逐字判定通过。取法：用仓库自己的 `parseFrontmatterCompletely`
      (`plugin/scripts/task-schema.ts`) 解析 `goals/AC-276-*.md` 的 frontmatter 取 `criterion`，
      以 `bash -c <criterion>`、cwd = 主检出运行（与 `goal-store` 的
      `runAcceptance({command: criterion, cwd: root})` 同形）⇒ **exit 0 且 stderr 为空**。
      证据形态：命令 + 完整输出 + `echo EXIT=$?`。⛔ 不是「另写一份等价谓词跑绿」。
- [ ] AC2（负控制——证明 AC1 的绿不是判据恒绿）: 把**同一个** criterion 在一个临时目录里对一份
      **不含定位词**的 `README.md` 跑（cwd = 该临时目录）⇒ **exit 1 且 stderr 含
      `CAUSE=positioning-missing`**。两条读数并排贴出（AC1 的 exit 0 与 AC2 的 exit 1）——
      判据在本产物上确实能取两个值。
- [ ] AC3: 全 README（⛔ 不限前 6000 字符）对三条反向正则 **0 命中**：用与 criterion 中
      `NEG_PATTERNS` 逐字相同的三条正则（`re.IGNORECASE`）扫 `open("README.md").read()`，
      打印命中数 = 0。
- [ ] AC4: 新增守卫测试 `plugin/test/readme-positioning-criterion.test.mjs` 跑绿：
      `node --no-warnings --experimental-strip-types --test plugin/test/readme-positioning-criterion.test.mjs`
      ⇒ exit 0。该测试从 `goals/AC-276-*.md` 读出 criterion（⛔ 不抄副本），对仓库根的 `README.md`
      跑 ⇒ 断言 exit 0；并**自带一条负控制**：在临时目录放一份不含定位词的 `README.md`，跑同一
      criterion ⇒ 断言 exit 1 且 stderr 带 `CAUSE=positioning-missing`（测试自己就能证伪，不靠人读）。
- [ ] AC5（反关键词充数）: 定位段落的形态读数：取 `# quay` 之后的**第一个 `##` 标题之前**的文本，
      该区间非空白字符数 ≥150 且其中出现 `Claude Code`；并打印 `README.md[:6000]` 中
      `Software Engineering Agent`（大小写不敏感）与 `infrastructure|基础设施` 的命中偏移。
      证据形态：一条命令 + 输出。

## Definition of Done

- [ ] README.md 的定位段落已落进仓库**权威基线**：`git show develop:README.md` 的前 6000 字符里能取到
      `Software Engineering Agent` 与 `infrastructure|基础设施`，且 AC-276 的 criterion 对该内容判 pass。
- [ ] 它在 **goal driver 的真实读取面**上成立——criterion 的 cwd 是主检出工作树，所以必须在主检出
      跑 `bash -c <criterion>` ⇒ exit 0（⛔ 不是只在任务 worktree 里绿、主检出读不到）。
- [ ] 守卫测试 `plugin/test/readme-positioning-criterion.test.mjs` 已在 `develop` 上存在且在该处跑绿。
- [ ] 判准遵循 **inherited-core** 的 REAL LANDING 口径（DIR-026 Reading A）：证据钉在**产物本身**
      （README.md 真的被 criterion 读取并判 pass，AC1/AC2 两条读数分开可证伪），⛔ 不是「文件里能
      grep 到这两个词」这类静态存在性断言。

## Touches

- README.md
- plugin/test/readme-positioning-criterion.test.mjs (new)
- tasks/gap-readme-positioning-software-engineering-agent.md（自身）
