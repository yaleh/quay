---
id: gap-extract-section-heading-interpolated-unescaped-into-regexp
title: extractSection 把 heading 原样拼进 RegExp——含 ( ) | + 的标题被当正则（两份副本相同）；加固并把
  parity 测试扩到全部真实任务文件
status: done
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

- [x] 调用者清单已核对并写入 Evidence：每个 `extractSection(` 非测试调用点标注 字面量 | 动态 | 故意正则，数量与 `grep -rn 'extractSection(' packages/*/src plugin/scripts --include=*.ts | grep -v '\.test\.' | grep -v 'function extractSection'` 的行数一致
- [x] 含元字符标题按字面匹配：`scripts/test.sh plugin/test/task-parsing-parity.test.mjs` exit 0，其中 (a) 类用例在两份实现上都通过
- [x] 真实任务文件差分进入测试：同一命令里 (b) 类用例读取仓库 tasks/*.md（至少 2000 个文件，测试内断言文件数 ≥ 2000 而不是静默跳过），两份实现 0 分叉
- [x] 对既有固定字面量调用点行为不变：改动前后对全部 tasks/*.md × 9 个标准节名的 extractSection 输出的 sha256 相同（改动前先存基线 sha，两个 sha 贴进 Evidence）
- [x] 能取假（负对照）：cp 备份 plugin/scripts/task-schema.ts，临时把其 extractSection 恢复成不转义的版本，重跑 parity 测试必须 exit 非 0；还原后 exit 0；两次 exit 码进 Evidence（⛔ 不用 git checkout 还原）

## DoD

真实落地 = 两份 extractSection 对含元字符标题的行为一致且正确，parity 测试进入常规套件并读真实任务文件；此后任一份副本单独漂移，suite 变红。Evidence 含调用者清单、改动前后 sha、负对照两次 exit 码。若第 1 步发现有故意传正则的调用点，则按第 2 步的 `extractSectionLiteral` 分支落地，并在 Evidence 说明为什么没有改 extractSection 本身。

## Evidence

### AC1 — extractSection 非测试调用点清单（56 行 = 3 注释 + 53 调用点）

命令（与本 AC 内联 grep 一致，改动后于工作树运行）：
`grep -rn 'extractSection(' packages/*/src plugin/scripts --include=*.ts | grep -v '\.test\.' | grep -v 'function extractSection'` → **56 行**。

- **注释（非调用点）3 条**：packages/quay-github/src/github-client.ts:408、plugin/scripts/ready-pool-check.ts:802、plugin/scripts/ready-pool-check.ts:1125
- **字面量 45 条**：plugin/scripts/fan-in-materialize-check.ts:376；plugin/scripts/pool-quality-judge.ts:99；plugin/scripts/proposal-convergence.ts:821,822,823,824,1159,1305,1344,1626,1631,1696,1701,2108；plugin/scripts/task-schema.ts:373,388,445,458,483,534,535,553,565,582,583,601,658；plugin/scripts/prepare-admission-check.ts:598,599,600,619,712,725,859；plugin/scripts/slot-refill.ts:568；plugin/scripts/task-ac-carryover-check.ts:175,190；plugin/scripts/select-tests-for-touches.ts:325,327；plugin/scripts/task-status-drift-check.ts:478,633,638,883,884；plugin/scripts/select-static-checks-for-touches.ts:906；plugin/scripts/worker-driver.ts:2068；plugin/scripts/ready-pool-check.ts:1005,2062
- **字面量（循环变量遍历字面量数组）3 条**：plugin/scripts/pool-quality-judge.ts:104（`["Proposal","Plan","Acceptance Criteria","Definition of Done"]`）；plugin/scripts/prepare-admission-check.ts:557（`["Requested action","Proposal","Finding"]`）；plugin/scripts/prepare-admission-check.ts:618（`["Finding","Requested action","Proposal"]`）
- **动态 2 条**：plugin/scripts/ready-pool-check.ts:708 与 :817 —— 传的是 SHAPE_SECTIONS 注册表 heading（含 `AC (draft)` / `AC（draft）` / `Acceptance Criteria (runnable)` 等带元字符的变体标题）。**改动前**这两个调用点自己先 `escapeRegExp(heading)` 了一次；**改动后** extractSection 内部转义，调用点的预转义已删除（否则双重转义：`escapeRegExp(escapeRegExp("AC (draft)"))` 连反斜杠一起转义，`## AC (draft)` 再也不匹配；实测 `escape-twice → null`）。
- **故意正则 0 条** —— 无任何调用点传 `AC(?:（draft）)?` 这类正则。

⇒ 走 Proposal 第 2 步「没有故意正则的调用点」分支：两份 extractSection 各自在拼 RegExp 前对 heading 做字面转义（Core 用 `./kernel/regex-escape.ts`；plugin 用 `./regex-escape.ts` 入口）。**没有**新增 `extractSectionLiteral`，extractSection 本身语义改为字面匹配。

**5b（同一载体的同族点，一并修）**：
- plugin/scripts/task-schema.ts `extractSectionFenceAware`（同文件同一条 `new RegExp(\`^(##+)\\s*${heading}\\s*$\`)` 内插）也已转义；当前调用者只传字面量（"Contract"/"Dispatch review"/"Acceptance Criteria"/"Definition of Done"）⇒ 无行为变化。
- plugin/scripts/ready-pool-check.ts `readFrontField`（`new RegExp(\`^${key}:...\`)` 内插 frontmatter key）也已转义；当前调用者只传 "parent"/"status"/"role" ⇒ 无行为变化。（这条同时让该模块继续使用 `escapeRegExp`，与 store.ts 记录的 single-judge contract 一致。）

### AC2 — 含元字符标题按字面匹配

- (a) 用例 `extractSection — metacharacter headings match literally on BOTH copies and never throw (case a)`：两份实现对 `Plan (draft)` / `A+B` / ``Gap 4: `|batch| = 0` `` / 不平衡括号 `Bad (unbalanced` / `a.b*c?d^e$f` 都返回字面匹配结果、都不抛错、且二者相同；并带 raw-interpolation 负对照（未转义的正则匹配不到 `## Plan (draft)`）。整个文件 `node --experimental-strip-types --test plugin/test/task-parsing-parity.test.mjs` → **8/8 pass, exit 0**。
- 驱动的 scoped 门：`bash scripts/test.sh --for-task gap-extract-section-heading-interpolated-unescaped-into-regexp --allow-thin` → **exit 0**（scoped static tier，未跑全量 static 层）。
- ⚠️ **诚实读数**：AC 字面命令 `bash scripts/test.sh plugin/test/task-parsing-parity.test.mjs`（显式文件 = 全量 static 层）→ **exit 1，唯一红的检查是 `spec-declaration-point-check`**。这是 **develop 顶端既有的红**，非本改动引入：用 `git archive develop` 的干净树复现同一条 FAIL（`orchestration/SPEC-goal-branch-2026-10-03.md` 未在 plugin/skills/{init,manager}/SKILL.md 的声明点声明），且 develop 相对本分支的 delta 全是 tasks/goals 文档（`git diff --name-only HEAD..develop -- plugin packages scripts` 为空）。本 AC 关的 parity 断言（含 (a) 类）无一条失败。

### AC3 — 真实任务文件差分进入测试（同一命令内）

- (b) 用例 `extractSection — 0 divergence across every real task file's headings (≥2000 files, case b)` 读仓库 `tasks/*.md`，**测试内断言 `files.length >= 2000`（实测 2512，不是静默跳过）**，对每个文件的 9 个标准节名 + 文件内全部 `##`..`######` 标题逐项比较两份实现输出 → **0 分叉**。该用例实测耗时约 354ms。

### AC4 — 既有固定字面量调用点行为不变（sha256 前后相同）

度量：对全部 `tasks/*.md`（2512）× 9 个标准节名（Proposal / Plan / Acceptance Criteria / Definition of Done / Finding / Requested action / Touches / Resolution / Test-Files），把 `[file, heading, JSON.stringify(extractSection(body, heading))]` 依次喂进一个 sha256（用 product 侧 copy）。

- BEFORE：files=2512 sha256=`0b35930a5403de539cefd6c82fa329f8955bfb4d3143222c32b336d69862a86f`
- AFTER ：files=2512 sha256=`0b35930a5403de539cefd6c82fa329f8955bfb4d3143222c32b336d69862a86f`（**相同**）

### AC5 — 能取假（负对照，cp 备份还原，未用 git checkout）

1. `cp plugin/scripts/task-schema.ts /tmp/task-schema.ts.ac5bak`
2. 只把 **extractSection** 那一处 `${escapeRegExp(heading)}` 还原为 `${heading}`（fenceAware 与 task-schema.ts:218 既有的转义保持不动）→ `node --experimental-strip-types --test plugin/test/task-parsing-parity.test.mjs` → **exit 1**
3. `cp /tmp/task-schema.ts.ac5bak plugin/scripts/task-schema.ts` 还原 → 同一命令 → **exit 0**

### Touches 扩一条（说明）

`plugin/scripts/ready-pool-check.ts` 加入 Touches：extractSection 改为内部转义后，该模块两处调用点的预转义变成双重转义（会让 `## AC (draft)` / `## AC（draft）` / `## Acceptance Criteria (runnable)` 一类注册表标题不再被识别，plugin/test/ready-pool-check-s04.test.mjs 会红），删除它是本次修改的**必要后果**，不是旁支。

## Touches

- tasks/gap-extract-section-heading-interpolated-unescaped-into-regexp.md
- packages/quay/src/task-parsing.ts
- plugin/scripts/task-schema.ts
- plugin/test/task-parsing-parity.test.mjs
- plugin/scripts/ready-pool-check.ts
