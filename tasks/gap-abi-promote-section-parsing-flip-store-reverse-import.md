---
id: gap-abi-promote-section-parsing-flip-store-reverse-import
title: ABI 缺口：extractSection/parseFrontmatterCompletely/countAcCheckboxes
  是纯函数却只活在机制层 task-schema.ts——上收到产品层，翻转 store.ts:18 唯一一条产品层反向 import 机制层的 src
  级依赖
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

`docs/proposals/archguard-generation-era-primitives.md` §2.6 报出仓库的结构核心问题：

```
packages/quay-native/src/store.ts:18
  import { parseFrontmatterCompletely } from "../../../plugin/scripts/task-schema.ts";
```

"任务 frontmatter 的权威解析"这份正本住在机制层，产品层是它的消费者——依赖方向是反的。文档称这是
"`packages/**` → 机制层唯一的 src 级硬 import"。本次立案时现场核实：这条 import **仍然存在**，未变。

**本次立案时进一步核实了三个具体函数的实现，纠正了一处容易混淆的地方（记录在案，避免下游任务
误解范围）**：文档 §2.6 表格里"应上收到产品层"的 ①`extractSection` ②`countAcCheckboxes`，与
`store.ts:18` 反向 import 的目标 `parseFrontmatterCompletely`，是**三个不同的函数**（前两个做
"从任务体切片段落"/"数 AC 复选框"，第三个是纯 YAML frontmatter 解析），文档把它们放在同一节讨论
容易读成"翻转 `store.ts:18` = 完成了 ①②的上收"——两者相关但不是一回事，本任务把三个都纳入范围，
但把它们当三个独立的迁移对象处理，不假设修一个就等于修了另一个。

现场读码确认三者都是**纯函数、零耦合于所在文件其余的 780 行内容**，技术上迁移风险很低：
- `parseFrontmatterCompletely`（`task-schema.ts:127-129`）：`return (parseYaml(frontmatterRaw) ?? {})`，
  就是一行对 `yaml` 包 `parse()` 的包装；
- `extractSection`（`task-schema.ts:83-93`）：11 行，纯字符串正则切片，无外部状态；
- `countAcCheckboxes`（`task-status-drift-check.ts:117-136`）：纯函数，对一段文本正则计数。

现场核实消费者：`extractSection` 当前 16 个文件 import（文档测量时 23，数字会随开发漂移）；
`countAcCheckboxes` 当前 3 个文件（`task-status-drift-check.ts` 自身、`slot-refill.ts`、
`ready-pool-check.ts`）；`parseFrontmatterCompletely` 是 `store.ts` 自己在用（`parseTask`/
`readDependsOn`/`store.parse` 全部委托它）。

`packages/quay/src/abi.ts` 现场核实只有 54 行，纯 TypeScript 接口声明、无运行时代码——三个函数
不应该塞进这个文件本身，应放在紧邻它的新模块（供 `packages/quay` 与 `packages/quay-native` 共用）。

**⚠️ 范围诚实声明（避免过度宣称）**：文档 §2.6 明确指出应上收产品层的通用能力共 6 项（①-⑥），
本任务只覆盖①②（extractSection/countAcCheckboxes）+ `parseFrontmatterCompletely` 这一条具体的
反向 import，**不等价于机制层整体自举完成**——文档原文："即使翻转 `store.ts:18`，机制层依然迁不
过去，因为 ABI 表达不了它们中任何一个需要的东西"，指的正是③-⑥（shape-aware 四件套判定/批量状态写/
workspace-root 参数化/`depends_on` 一等公民）仍然缺失。本任务完成后不得被当成"自举差距已解决"的
证据。

## AC

- [x] AC1（基线）：现场核实并贴出 `packages/quay-native/src/store.ts:18` 当前的反向 import 内容
      （命令 + 输出），作为改动前基线
- [x] AC2：在产品层新增一个模块（`packages/quay/src/` 下，紧邻 `abi.ts`，具体文件名由实现决定）
      承载 `extractSection`、`parseFrontmatterCompletely`、`countAcCheckboxes` 三个函数的权威实现
      ——原样迁移逻辑，不改行为；用它们各自现有的单测（`plugin/test/mechanism-count.test.mjs`、
      `plugin/test/ready-pool-check.test.mjs`、`plugin/test/workflow-invariant-ownership.test.mjs`、
      `plugin/test/slot-refill.test.mjs`、`plugin/test/task-status-drift-check.test.mjs` 等）作为
      "迁移不改变行为"的回归证据
- [x] AC3：`packages/quay-native/src/store.ts:18` 改为从产品层新位置 import，不再指向
      `../../../plugin/scripts/task-schema.ts`；`grep -n "plugin/scripts" packages/quay-native/src/store.ts`
      命中数须为 0（贴出命令与输出）
- [x] AC4：`plugin/scripts/task-schema.ts` 与 `plugin/scripts/task-status-drift-check.ts` 改为从
      产品层新模块 import 这三个函数（正向依赖），不再保留私有实现；现场核实的全部下游消费者
      （`slot-refill.ts`/`ready-pool-check.ts` 等）行为不变
- [x] AC5：`bash scripts/test.sh` 全量绿（全量由主套件门——fan-in 的 suite 步骤——负责；scoped 门已绿），
      尤其覆盖上面列出的既有单测与 `packages/quay-native` 自己的 store 相关测试，证明行为未变
- [x] AC6：现场重新核实"这是 `packages/**/src` 级别唯一一条硬 import `plugin/scripts` 的路径"
      这条文档断言在修复前是否仍然成立（`grep -rn "plugin/scripts" packages/*/src --include='*.ts'`，
      排除测试/模板字符串），并在修复后重跑同一命令确认归零——不得照抄文档旧结论

## DoD

AC1/AC3/AC6 的真实命令输出（反向依赖归零的证据）贴进任务体；全量 suite 绿。任务体须明确注明：
本任务只解决①②两项能力 + `store.ts:18` 这一条具体反向依赖，不等价于机制层整体自举完成（③-⑥ 仍缺，
见文档 §2.6 表），避免被后续任务或报告误用为"自举问题已解决"的证据。

## Execution record

**AC1 基线**（改动前 `store.ts:18` 的反向 import，用 `git show HEAD:` 读改动前内容）：
```
$ git show HEAD:packages/quay-native/src/store.ts | sed -n '18p'
import { parseFrontmatterCompletely } from "../../../plugin/scripts/task-schema.ts";
```

**AC3**（改动后 `grep -n "plugin/scripts" packages/quay-native/src/store.ts` 命中数 = 0）：
```
$ grep -n "plugin/scripts" packages/quay-native/src/store.ts
（无输出，exit 1）
```

**AC6 修复前核实**（全 `packages/*/src` 的硬 import 只有 `store.ts:18` 一条，文档断言成立；`grep -rn
"plugin/scripts" packages/*/src` 的其余命中均为注释/字符串常量/模板字符串，非 import 语句）：
```
$ grep -rnE 'from[[:space:]]+"[^"]*plugin/scripts' packages/*/src --include='*.ts'
packages/quay-native/src/store.ts:18:import { parseFrontmatterCompletely } from "../../../plugin/scripts/task-schema.ts";
```

**AC6 修复后重跑**（同一命令 + 动态 `import()` 形式，均无输出）：
```
$ grep -rnE 'from[[:space:]]+"[^"]*plugin/scripts' packages/*/src --include='*.ts'
（无输出，exit 1）
$ grep -rnE 'import[[:space:]]*\([[:space:]]*"[^"]*plugin/scripts' packages/*/src --include='*.ts'
（无输出，exit 1）
```
→ 硬 import 归零。

**AC5 scoped 门**（全量 `bash scripts/test.sh` 由 fan-in 的 suite 步骤负责——主套件门）：
```
$ bash scripts/test.sh plugin/test/mechanism-count.test.mjs plugin/test/ready-pool-check.test.mjs \
    plugin/test/workflow-invariant-ownership.test.mjs plugin/test/slot-refill.test.mjs \
    plugin/test/task-status-drift-check.test.mjs plugin/test/task-contract-check.test.mjs
→ tests 383 · pass 381 · skipped 2 · fail 0

$ bash scripts/test.sh packages/quay-native/test/store.test.mjs packages/quay-native/test/parse-cache.test.mjs \
    packages/quay-native/test/yaml-frontmatter-colon.test.mjs packages/quay-native/test/live-a-longform-headings.test.mjs
→ tests 17 · pass 17 · fail 0

$ for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done
→ ALL TYPECHECK GREEN
```

**范围诚实声明**（DoD 要求，避免被后续任务/报告误用）：本任务只解决 ①②（`extractSection`/
`countAcCheckboxes`）+ `parseFrontmatterCompletely` 这一条具体反向 import，**不等价于机制层整体自举
完成**——③-⑥（shape-aware 四件套判定 / 批量状态写 / workspace-root 参数化 / `depends_on` 一等公民）
仍缺，见文档 §2.6 表。

## Touches

- packages/quay/src/task-parsing.ts（紧邻 abi.ts 的新迁入模块）
- packages/quay-native/src/store.ts
- plugin/scripts/task-schema.ts
- plugin/scripts/task-status-drift-check.ts
- plugin/test/mechanism-count.test.mjs
- plugin/test/task-status-drift-check.test.mjs
- tasks/gap-abi-promote-section-parsing-flip-store-reverse-import.md
