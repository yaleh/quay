---
id: gap-extract-section-heading-interpolated-unescaped-into-regexp
title: extractSection 把 heading 原样拼进 RegExp——含 ( ) | + 的标题被当正则（两份副本相同）；加固并把
  parity 测试扩到全部真实任务文件
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

背景（读数见任务 gap-status-flip-history-and-parser-diff-readings）：packages/quay/src/task-parsing.ts 与 plugin/scripts/task-schema.ts 各有一份 `extractSection(fullText, heading)`（有意保留的副本：plugin 打包时不带 packages/，无法静态 import；靠 plugin/test/task-parsing-parity.test.mjs 钉死一致）。两份都用 `new RegExp(\`^(##+)\\s*${heading}\\s*$\`, "im")`，把 heading 原样当正则：含 `( ) | + ? . * [ ]` 的标题被当成元字符（实测 `"Plan (draft)"`、`"A+B"` 返回 null，含不平衡括号会抛错）。在 2507 个真实任务文件上两份行为零分叉（所以 parity 测试不报），但 parity 测试只有 1 份手写样本、5 条用例，没读过真实任务。生产调用者多数传固定字面量，所以目前是潜在问题；`plugin/scripts/prepare-admission-check.ts:557` 是 `.map((h) => extractSection(taskBody, h))`，h 的来源未核对。

<!-- dedup-ref -->
相关但机制不同：gap-abi-promote-section-parsing-flip-store-reverse-import（已 done，上收三个函数）。

做法（**先查调用者，再改**）：
1. 先 grep 全部 `extractSection(` 调用点（packages/*/src 与 plugin/scripts，非测试），逐个核对第二个参数是固定字面量还是动态值/故意写的正则（例如形如 `AC(?:（draft）)?` 的写法）。把清单（调用点:行号 → 字面量 | 动态 | 故意正则）写进 Evidence。
2. 若**没有**故意传正则的调用点：两份都对 heading 做字面转义后再拼（Core 用 packages/quay/src/kernel/regex-escape.ts；plugin 用已存在的 plugin/scripts/regex-escape.ts 入口，二者在 plugin 侧的既有用法见该文件头注释）。若**有**故意正则的调用点：不要改 extractSection 的语义，改为新增 `extractSectionLiteral` 并只把动态来源的调用点迁过去，故意正则的保持不动。
3. 扩 parity 测试：plugin/test/task-parsing-parity.test.mjs 增加两类用例——(a) 含元字符的标题（`Plan (draft)`、`A+B`、`Gap 4: \`|batch| = 0\``、不平衡括号）在两份实现上都返回字面匹配结果且不抛错且二者相同；(b) 对仓库全部 tasks/*.md 做差分：每个文件的 9 个标准节名 + 文件里全部 ##/### 标题，两份实现输出逐项相同（真实任务文件，不是夹具）。

## AC

- [ ] 调用者清单已核对并写入 Evidence：每个 `extractSection(` 非测试调用点标注 字面量 | 动态 | 故意正则，数量与 `grep -rn 'extractSection(' packages/*/src plugin/scripts --include=*.ts | grep -v '\.test\.' | grep -v 'function extractSection'` 的行数一致
- [ ] 含元字符标题按字面匹配：`scripts/test.sh plugin/test/task-parsing-parity.test.mjs` exit 0，其中 (a) 类用例在两份实现上都通过
- [ ] 真实任务文件差分进入测试：同一命令里 (b) 类用例读取仓库 tasks/*.md（至少 2000 个文件，测试内断言文件数 ≥ 2000 而不是静默跳过），两份实现 0 分叉
- [ ] 对既有固定字面量调用点行为不变：改动前后对全部 tasks/*.md × 9 个标准节名的 extractSection 输出的 sha256 相同（改动前先存基线 sha，两个 sha 贴进 Evidence）
- [ ] 能取假（负对照）：cp 备份 plugin/scripts/task-schema.ts，临时把其 extractSection 恢复成不转义的版本，重跑 parity 测试必须 exit 非 0；还原后 exit 0；两次 exit 码进 Evidence（⛔ 不用 git checkout 还原）

## DoD

真实落地 = 两份 extractSection 对含元字符标题的行为一致且正确，parity 测试进入常规套件并读真实任务文件；此后任一份副本单独漂移，suite 变红。Evidence 含调用者清单、改动前后 sha、负对照两次 exit 码。若第 1 步发现有故意传正则的调用点，则按第 2 步的 `extractSectionLiteral` 分支落地，并在 Evidence 说明为什么没有改 extractSection 本身。

## Touches

- tasks/gap-extract-section-heading-interpolated-unescaped-into-regexp.md
- packages/quay/src/task-parsing.ts
- plugin/scripts/task-schema.ts
- plugin/test/task-parsing-parity.test.mjs
