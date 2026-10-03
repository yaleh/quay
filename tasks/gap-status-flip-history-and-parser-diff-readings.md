---
id: gap-status-flip-history-and-parser-diff-readings
title: 取证读数：git 历史状态翻转对照 TRANSITIONS（17.7% 表外，缺的是 needs-human/superseded 边）+ 两份
  Task 解析器在全部任务文件上零分叉
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** finding

## Finding

2026-10-03 对本仓库做的两项只读取证（前置 1），读数如下；复跑方法在末尾。**本任务是读数的存档，不改任何代码。**

### 读数 1：git 历史里的状态翻转 × gate/lifecycle.ts `TRANSITIONS`

范围：10348 个提交（2026-07-15 起）、5183 次 tasks/*.md frontmatter `status:` 翻转（只取 diff 行号 ≤ 40 的变更以避开正文）、2309 个任务文件。表内 4265 次（82.3%），表外 918 次（17.7%）。

表内：ready→done 2168、todo→ready 1639、done→ready 327、needs-human→todo 94、ready→todo 37。
表外：todo→done 374、ready→needs-human 215、needs-human→ready 111、needs-human→done 56、todo→needs-human 48、todo/ready/needs-human→superseded 共 76、其余 38（done→todo 9、旧状态 in-progress/in_progress 共 16、superseded→ready 4、done→needs-human 7、done→superseded 2）。

时间分布决定解读：todo→done 374 次里 371 次在 2026-08 中旬之前（早期历史），之后只有 3 次；2026-09-20 以后总共 22 次表外翻转，全部涉及 needs-human 或 superseded（ready→needs-human 13、needs-human→ready 5、ready→superseded 3、needs-human→done 1），三个核心状态（todo/ready/done）之间没有违规。

结论：不是「生产在违反转移表」，而是「表缺了 needs-human / superseded 的入边与出边」。因此「状态翻转统一查表」之前必须先补表，否则会拒绝掉生产上最常见的 needs-human 流转。

口径与局限：同一提交内 todo→ready→done 连翻两次只显示成一次 todo→done，fan-in 提交里的 26 次 todo→done 可能是这种情况（未逐条核对）；创建时 status 因早期 frontmatter 含自由文本无法可靠解析，不报创建分布；仅 tasks/*.md，不含 goals/、adr/。自检：提交信息含「promotion-driver 机械晋升」的 958 个提交里 956 个解析出 todo→ready（谓词对已知真样本命中）。

### 读数 2：Core 与 plugin 两份 Task 解析器差分

对象：packages/quay/src/task-parsing.ts ↔ plugin/scripts/task-schema.ts 的 extractSection / parseFrontmatterCompletely / countAcCheckboxes，外加 plugin/scripts/task-status-drift-check.ts 里的第二个 countAcCheckboxes。读数：2507 个 tasks/*.md；extractSection 32376 次调用（每个文件的 9 个标准节名 + 文件里全部 ##/### 标题）；countAcCheckboxes 2393 次；分叉数 0 / 0 / 0 / 0（自检：注入不同输入时差分谓词报不同）。

这两份是有意保留的副本（plugin 打包时不带 packages/ 目录，无法静态 import；task-parsing.ts 头注释已写明，靠 plugin/test/task-parsing-parity.test.mjs 钉死一致）。但该 parity 测试只用 1 份手写样本、5 条用例，没读过真实任务；本次差分补上了它缺的那一半。

附带发现（两份相同，故 parity 不报）：extractSection(text, heading) 把 heading 原样拼进 new RegExp，heading 含 ( ) | + ? 等字符时被当成正则（"Plan (draft)"、"A+B" 返回 null，含不平衡括号会抛错）。生产调用者传固定字面量，所以是潜在问题；prepare-admission-check.ts:557 是 .map((h) => extractSection(taskBody, h))，h 来源未核对。

### 复跑

状态翻转回放：git log --no-merges --reverse -p -U0 --no-renames --format='@@C %H %ct %s' -- 'tasks/*.md' > /tmp/log.txt，再喂给一个按 hunk 行号 ≤ 40 配对 -status/+status 的解析脚本。解析器差分：在 node --experimental-strip-types 下同时 import 两份实现，对 tasks/*.md 逐文件、逐标题比较 JSON 化输出。两个脚本当前位于 worktree .claude/worktrees/layers-yml-draft/docs/rup/（preflight-status-flip-replay.mjs、preflight-parser-diff.mjs、preflight-forensics.md，均未提交、不在 develop）；本任务不依赖它们存在，Finding 中的读数是自足的存档。

后续立案（依据本读数）：gap-transitions-table-lacks-needs-human-and-superseded-edges、gap-extract-section-heading-interpolated-unescaped-into-regexp、gap-carrier-registry-declaration-with-unregistered-red-check、gap-characterization-baseline-serve-routes-and-concurrent-writes。

## AC

- [x] 读数 1 已存档：`grep -c 'todo→done' tasks/gap-status-flip-history-and-parser-diff-readings.md` 输出 ≥ 1，且正文含「表内 4265」「表外 918」两个数字
- [x] 读数 2 已存档：`grep -c '分叉数 0 / 0 / 0 / 0' tasks/gap-status-flip-history-and-parser-diff-readings.md` 输出 ≥ 1
- [x] 两项读数都带自检说明（已知真样本命中 / 注入不同输入报不同）：`grep -c '自检' tasks/gap-status-flip-history-and-parser-diff-readings.md` 输出 ≥ 2

## DoD

读数已作为任务体存入任务库、可被 `quay task get` 读回，不再只存在于未提交的 worktree 文件里；四个依据本读数的后续任务各自引用本任务 id 作为证据来源。本任务不改任何源码，所以不跑 suite；真实落地 = 读数进入了生产载体（任务库）。

## Touches

- tasks/gap-status-flip-history-and-parser-diff-readings.md
