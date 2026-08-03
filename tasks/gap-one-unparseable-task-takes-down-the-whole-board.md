---
id: gap-one-unparseable-task-takes-down-the-whole-board
title: "One task with unparseable frontmatter 500s the whole board — the per-task tolerance sits downstream of the throw"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

**线上故障（人 2026-08-03 在浏览器上撞到）**：`/` 返回 **500**，而 `/live` `/journal` `/adr` 全部 200。
根因是 **一个任务的 frontmatter 解析失败**——`title:` 未加引号而标题含 `## Contract`，
YAML 里**空格后的 `#` 是注释起始**，于是 title 被截断成 `The`，
第二行的缩进续行失去可续对象 ⇒ `All mapping items must start at the same column`。
管理者已止血（只加双引号、内容一字未动），全库 **605 个任务真实解析失败数 0**。

**⇒ 605 分之 1 让整个任务板不可用。**

### 为什么上一次的修复挡不住这次（外层实测，这是本任务的全部理由）

`gap-serve-task-list-dies-on-one-malformed-task` 已经做过「畸形任务降级为可见占位行」——
**但它在错误的层**：

```
packages/quay/src/provider-client.ts  taskList()
  if (r.isError) throw new Error(...)        ← 整个 task_list 调用在这里抛出
packages/quay/src/store.ts / serve-handlers.ts
  fallbackId / isMissingIdTask / .malformed-row   ← 上一次的容错在这里，在抛出之【后】
```

**⇒ provider 层一抛，下游逐任务容错根本没机会跑。**

**并且那个 `throw` 是有意的、且不应简单撤销**——它的注释写明了理由：
更早的实现把 `isError` 静默强转成空数组，于是列表页显示「0 个任务」而**不报任何错**，
**同时隐藏了真实失败与其余所有合法任务**。所以本任务**不是把 throw 改回吞掉**。

### 外层实测的危害面：不是「一个坏标题」，是 44% 的标题只是碰巧被引起来了

用**真解析器**（`yaml.parse`，不是形状启发式）扫全部 605 个任务的 frontmatter：

```
parsed: 605   parse-FAILURES: 0                    ← 止血后确认
titles containing " #" or ": " : 265               ← 44%
```

**265 个标题里含 `#` 或 `: `，它们今天没炸只是因为写入者当时加了引号。**
**危害不罕见，罕见的只是那一次没加引号。**

**方法论提醒（管理者自己踩到并写下来的）**：它先用「只看顶格行形状」的粗查得出坏任务数 **0**，
**是错的**；换成真的 `yaml.parse` 才查出那 1 个。**判断数据合法性要用真解析器，不要用形状启发式。**

## Contract

```
measure list_status = `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/` 的 HTTP 状态码字段
measure parsed_tasks = `node -e '<yaml.parse over tasks/>'` 输出的成功解析计数字段
measure reported_bad = `curl -s http://127.0.0.1:4173/ | grep -c malformed-row` 输出的解析失败行数字段
band list_status = 200
invariant 一个坏任务只坏它自己那一行；解析失败必须被【报出】而不是被吞掉（不得回退成静默空列表）
invoke `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173`
control 注入一个 frontmatter 故意坏掉的任务 ⇒ `/` 仍 200、其余任务照常列出、坏的那个显式成行；删掉它 ⇒ 恢复原样
resume 先让 provider 层返回「能解析的 + 解析失败清单」，再让渲染层把后者画成可见行
```

## Chosen mechanism

**把「全有或全无」挪走，而不是把错误吞掉。**

1. **provider 的 `task_list` 改为部分成功**：返回**能解析的任务** + **一份机器可读的解析失败清单**
   （文件名 + 解析器原始报错）。**这是本任务的关键改动位置**——
   在 `provider-client.ts` 抛出之前，让「一个坏任务」不再等价于「整次调用失败」。
2. **渲染层把失败清单画成可见行**（复用 `gap-serve-task-list-dies-on-one-malformed-task` 已有的
   `.malformed-row` 样式与占位行形状，**不要另造一套**）。
3. **保住上一次修复的意图**：`isError` 仍然抛（真正的调用失败必须响亮）；
   **新增的是「部分成功」这条路径**，不是把 throw 删掉。**AC5 就是防这条被改错的负控制。**

**不做**：不改任何任务文件的内容（止血已完成，且内容不是缺陷）；
不把解析失败静默计入「0 个任务」（那正是更早那次被修掉的行为）；
不在本任务里做写入侧的校验——**那是姊妹任务 [[gap-task-write-accepts-a-title-that-breaks-its-own-frontmatter]]**。

## Acceptance Criteria

- [x] AC1: `task_list` 在有 1 个不可解析任务时**返回其余全部任务** + 解析失败清单（含文件名与解析器报错）
- [x] AC2: **主判据**——注入 1 个坏 frontmatter 任务后 `/` 返回 **200**（实跑输出贴任务体）
- [x] AC3: 坏任务在页面上**显式成行**（复用 `.malformed-row`），能看出是哪个文件、为什么坏
- [x] AC4: **双向负控制**——注入 ⇒ 200 且列出 N−1 正常行 + 1 坏行；删除 ⇒ 恢复 N 行、无坏行。两个方向都贴
- [x] AC5: **防回退负控制**——真正的 `task_list` 调用失败（如 provider 不可达）**仍然抛**、
      **不得**退化成静默空列表（这是更早那次修复的意图，必须保住）
- [x] AC6: 全库真解析扫描仍为 0 失败；**扫描用 `yaml.parse`，不得用形状启发式**（管理者踩过）
- [x] AC7: 测试用 `node:test`、带 `// @test-group product`（这是用户可见的 web 契约）

## Definition of Done

- [x] AC4 与 AC5 的实跑输出都贴进任务体——
      **只证明「坏任务不再 500」而不证明「真失败仍然响亮」，是把一个静默换成另一个静默**
- [~] 完整套件连跑 2 次全绿——**如实标注：仅 1 次全量绿**（协调方 batch5 run4，**2115 tests /
      2095 pass / 0 fail / 0 cancelled**，`/tmp/batch5-fanin-fullsuite4.log`，2026-08-03；含本任务
      合并代码）。非连跑 2 次；scoped `node --test` 覆盖所有受影响文件，全绿
- [x] 任务体记录：这次的触发者是**外层写的一个任务标题**（`## Contract` 出现在 title 里），
      **写这种标题是自然的，缺陷在于系统允许它在写入时通过、在渲染时炸**

## Touches

- packages/quay/src/provider-client.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/test/serve.test.mjs
- packages/quay-native/src/mcp-server.ts

## Dispatch review

reviewer: outer
at: 2026-08-03T15:35:00Z
changed: 管理者已止血并把两层缺陷交给外层。**外层核实了「上一次的修复为什么挡不住这次」并定位到层**：
`provider-client.ts` 的 `taskList()` 对 `isError` **有意抛出**（注释写明：更早的静默空数组
把真实失败与全部合法任务一起藏了），而上一次的逐任务容错在 `store.ts`/`serve-handlers.ts`，
**在抛出之后** ⇒ **provider 一抛，下游容错没机会跑**。
**因此本任务的关键改动位置不是渲染层，是 provider 的 `task_list` 返回「部分成功 + 失败清单」**。
**并把「不许改回吞掉」写成 AC5 的负控制**——否则这次修复会把更早那次修掉的静默又请回来。
**外层用真解析器量了危害面**：全库 605 个 frontmatter，`yaml.parse` **0 失败**（确认止血），
但 **265 个标题（44%）含 `#` 或 `: `**——**它们今天没炸只是因为当时加了引号**，
危害不罕见、罕见的只是那一次没加。
**方法论一并写进 AC6**：判断数据合法性用真解析器；管理者先用形状粗查得出 0，是错的。
**写入侧不在本任务**：拆给姊妹任务，两者不同包、可并发。

## 本执行（worktree `task/gap-one-unparseable-task-takes-down-the-whole-board`）

### 改动位置（层对了：provider 的 task_list 返回部分成功，throw 未删）

- `packages/quay-native/src/store.ts`：新增 `listWithMalformed()` —— 逐文件 walk，解析失败被**收集**
  成 `{file, error}` 清单而不是让整次 `list()` 抛掉；`list()` 本身**仍抛**（CLI 表面保持响亮错误，
  DIR-001 安全降级），容错只加在 ABI 表面。
- `packages/quay-native/src/mcp-server.ts`：`task_list` 工具返回 `structuredContent: { tasks, malformed }`。
- `packages/quay/src/provider-client.ts`：`taskList()` 返回 `{ tasks, malformed }`；`isError` **仍然抛**（AC5）。
- `packages/quay/src/serve-handlers.ts`：把 `malformed` 清单画成可见的 `.malformed-row` 行
  （复用既有样式与 colspan=7 占位行，未另造一套）。
- `packages/quay/src/mcp-handlers.ts` / `bin/quay.ts` / `gate/driver.ts` / `migrate.ts`：
  消费新返回形状；CLI 把不可解析文件报在 stderr（--json 保持可解析）。

### invoke 入口路径实跑（契约消费者证据）

本任务的 `invoke` 命令入口路径是 `packages/quay/bin/quay.ts`。AC2/AC4/AC5 的 HTTP 往返全部由它承载：

```
node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4173
```

（`GET /` 的注入/删除双向往返与 AC5 的 500 负控制均经该进程；见下方 AC4/AC5 输出。）

### AC4 实跑输出（双向负控制，真实 HTTP）

```
AC4 inject:  GET / -> 200 | </tr> rows: 4 | malformed-row: 1 | GOOD-1: true | GOOD-2: true | UNPARSE-1.md: true | 解析失败: true
AC4 remove:  GET / -> 200 | </tr> rows: 3 | malformed-row: 0 | GOOD-1: true | GOOD-2: true
```

注入方向：1 个坏 frontmatter（`title: The ## Contract` + 续行，`yaml.parse` 报
`All mapping items must start at the same column`）→ `/` **200**，N−1（2 个）正常任务照常列出 +
1 个 `.malformed-row` 坏行（行内可见文件名 `UNPARSE-1.md` 与「解析失败」）。删除方向：删掉坏文件 →
`/` 仍 **200**，3 行、无坏行、2 个好任务原样。

### AC5 实跑输出（防回退负控制：真失败仍然响亮）

```
AC5 genuine: GET / -> 500 | body starts: "internal server error"
```

运行中把 tasks 目录从 provider 脚下删掉（store 本身不可用 = 真正的调用级失败）→
provider `task_list` isError → Core `taskList()` **抛** → `/` **500**，**不是**静默的「200 + 0 个任务」。
Core 级同一场景：`client.taskList({})` **rejects**（`MCP error -32000: Connection closed`），不是 resolve 成 `[]`。

### AC6 实跑输出（真 yaml.parse 全库扫描）

```
[AC6] scanned 607 task files: 0 parse failures; 269 titles contain '#' or ': '
```

（外层止血时量得 605/0/265；本执行在 worktree 上扫得 607/0/269 —— 数字随新增任务漂移，
**0 失败**这一判据稳定。判断合法性用的是真 `yaml.parse`，不是「只看顶格行形状」的启发式——
管理者先粗查得 0 是错的，真解析器才查出那 1 个。）

### 本执行验证（scoped，未自启全量套件）

`node --test` 覆盖全部受影响文件，全绿：
- `packages/quay/test/unparseable-frontmatter.test.mjs`（本任务新测试，node:test + `@test-group product`，
  AC1-AC7）：6/6 pass
- `packages/quay/test/serve.test.mjs`、`serve-adversarial-eval.test.mjs`（M26-F4 / ADV-001/002 断言从
  「坏 frontmatter ⇒ 500」改为「⇒ 200 + 可见坏行」）、`mcp-server.test.mjs`、`cli.test.mjs`、
  `cli-migrate.test.mjs`、`core-three-way-symmetry.test.mjs`、`driver.test.mjs`、`migrate.test.mjs`、
  `task-check/gate/lifecycle/migrate-single-source`：全绿
- `packages/quay-native/test/`（store 层）：`yaml-frontmatter-colon`、`adversarial-eval`、`relation-sync`、
  `create-validation`、`cas-write`、`edit-validation`：全绿
- `tsc --noEmit`：exit 0
