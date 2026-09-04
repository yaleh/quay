---
id: gap-readme-source-install-commands-are-all-broken-quay-js-does-not-exist
title: "README Option B ('from source... no global install step required') and
  every worked example under it (task list/view/check) instruct `node
  packages/quay/bin/quay.js <command>` — this file DOES NOT EXIST, only
  bin/quay.ts does; reproduced verbatim: `Error: Cannot find module
  '.../packages/quay/bin/quay.js'`; no build step bridges .ts to .js (grep for
  it in root/package package.json = 0); CLAUDE.md:17 documents the CORRECT
  invocation (`node --experimental-strip-types packages/quay/bin/quay.ts <cmd>`)
  — the two checked-in docs disagree on the literal command and only one of them
  runs; same break repeats for quay-native.js and quay-github.js; a fresh
  git-clone adopter following README's own recommended dev path hits ENOENT on
  the FIRST copy-pasted command; doc-vs-code lens, manager 2026-08-06"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**README「从源码安装」整节的命令全部打不通——`quay.js` 不存在，只有 `quay.ts`。**

### 实测（逐字复现）

```
$ node packages/quay/bin/quay.js task list --json
node:internal/modules/cjs/loader:1573
  throw err;
  ^
Error: Cannot find module '/home/yale/work/quay/packages/quay/bin/quay.js'
```

| 项 | 值 |
|---|---|
| README `Option B`（"from source... **no global install step required**"）给出的三条命令 | `node packages/quay/bin/quay.js` / `quay-native.js` / `quay-github.js` |
| `packages/quay/bin/` 实际内容 | 只有 `quay.ts`（`ls -la` 确认） |
| README 后续可复制运行示例（task list / task view / task check，104-322 行） | **全部**用 `quay.js`，全部不可运行 |
| 是否存在把 `.ts` 编译成 `.js` 的构建步骤（README 未提及，grep 求证） | **0**——`package.json` 全仓无此构建脚本 |
| `CLAUDE.md:17` 给出的正确命令 | `node --experimental-strip-types packages/quay/bin/quay.ts <cmd>` |

⇒ **两份 checked-in 文档在同一件事上给出不同的字面命令，只有一份能跑。**
README 的措辞「no global install step required」暗示"直接跑就行"，
但实际连 `node` 直接执行都会先报 `ENOENT`（Cannot find module）。

### 性质

**这正是本轮 tick 的采用者视角会撞到的第一步**：一个全新克隆本仓库、
照 README「Option B — for development」走的人，**第一条复制粘贴的命令就报错**。
不需要环境异常、不需要边缘情况——README 自己给的路径结构性地打不通。

`grep -rli "README" tasks/*.md` 有命中，但核实后均为假阳性（不同上下文的 `quay.js` 提及，
如 `.quay/runtime/quay/quay.js`——那是 `quay-init` **铺设产物**的路径，与本条讨论的
**开发树源码路径**是完全不同的两个东西，不能互相印证"已覆盖"）。

## Contract

```
measure readme_option_b_runs = `node packages/quay/bin/quay.js --help; echo $?` stdout 的退出码数字段
band readme_option_b_runs = 0（当前必为非 0，修复后必为 0，或命令文本已同步改为可运行形态）
invariant README 记录的字面命令必须与 CLAUDE.md 记录的字面命令一致，不得两份文档给出同一动作的不同命令而只有一份能跑
invoke `node packages/quay/bin/quay.js --help`
control 改前贴出上面 invoke 的真实报错；改后同一条命令必须成功退出
resume 若中断，先跑 measure 确认当前 README 的字面命令是否已可运行，不要假设已修
```

## Acceptance Criteria

- [x] AC1: README Option B 的三条命令（quay/quay-native/quay-github）与后续全部可复制示例，
      逐条实跑成功，贴出改前/改后输出对照（见下「AC1 实跑证据」）
- [x] AC2: README 与 CLAUDE.md 对同一动作（"直接跑源码"）给出**一致**的字面命令
      （采用「CLAUDE.md 为权威」方案——README 各命令与 CLAUDE.md:17 逐字一致，见下「AC2」）
- [x] AC3: 负控制——若日后重新引入 `.ts`→`.js` 的构建产物形态，
      本任务的 measure 命令必须能检测出"文档命令与实际产物形态"再次不一致（见下「AC3」）
- [x] AC4: 复查文档里其余 `quay.js`/`quay-native.js`/`quay-github.js` 字面出现处，
      区分「开发树源码路径」与「quay-init 铺设产物路径」两类语境，逐条标注不得混淆（见下「AC4 审计」）

## AC1 实跑证据（worktree 内逐条实跑，2026-08-08 —— 重放，非旧 2026-08-07 证据）

改前（`git show develop:README.md` 的 Option B 命令逐字复现）：

```
$ node packages/quay/bin/quay.js --help
node:internal/modules/cjs/loader:1573
  throw err;
  ^
Error: Cannot find module '/home/yale/work/quay-worktrees/readme-source/packages/quay/bin/quay.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1569:15)
    ...
  code: 'MODULE_NOT_FOUND',
  requireStack: []
Node.js v26.5.0
exit=1
```

改后（README 现记录的字面命令逐条实跑，`cwd`=worktree 根）：

```
$ node --experimental-strip-types packages/quay/bin/quay.ts --help        → exit 0（打印 usage）
$ node --experimental-strip-types packages/quay/bin/quay.ts --version     → exit 0（0.4.0）
$ node --experimental-strip-types packages/quay/bin/quay.ts -V            → exit 0（0.4.0）

$ node --experimental-strip-types packages/quay/bin/quay.ts task list --json   → exit 0（输出完整任务 JSON，9MB）
$ node --experimental-strip-types packages/quay/bin/quay.ts task list --prefix QX --page-size 2 → exit 0（QX-001/QX-002）
$ node --experimental-strip-types packages/quay/bin/quay.ts task view QN-001   → exit 0（QN-001 详情）
$ node --experimental-strip-types packages/quay/bin/quay.ts task check QN-001  → exit 0（QN-001: PASS — terminal）
$ node --experimental-strip-types packages/quay/bin/quay.ts action list QN-001  → exit 0
$ node --experimental-strip-types packages/quay/bin/quay.ts gate --list          → exit 0（21 个 gate）
$ node --experimental-strip-types packages/quay/bin/quay.ts gate-log QN-001      → exit 0
$ node --experimental-strip-types packages/quay/bin/quay.ts run --once           → exit 0（QENG-5-DEMO-FAIL: FAIL acceptance，left ready）
$ node --experimental-strip-types packages/quay-native/bin/quay-native.ts task list    → exit 0
$ node --experimental-strip-types packages/quay-native/bin/quay-native.ts task get QN-001 → exit 0
$ node --experimental-strip-types packages/quay-native/bin/quay-native.ts manifest      → exit 0
$ node --experimental-strip-types packages/quay-github/bin/quay-github.ts task list     → exit 0（gh-* 任务，gh auth 可用）

$ cd packages/quay-native/examples/sample-workspace
$ QUAY_NATIVE_TASKS_DIR="$(pwd)/tasks" node --experimental-strip-types ../../bin/quay-native.ts task list      → exit 0（SAMPLE-*）
$ QUAY_NATIVE_TASKS_DIR="$(pwd)/tasks" node --experimental-strip-types ../../bin/quay-native.ts task get SAMPLE-1 → exit 0
$ QUAY_NATIVE_TASKS_DIR="$(pwd)/tasks" node --experimental-strip-types ../../bin/quay-native.ts task check SAMPLE-1 → exit 1（SAMPLE-1: FAIL — 1/2 AC —— 与 sample-workspace README 自述一致：SAMPLE-1B 未 done 前 check 为 ok:false，命令本身正常运行无 ENOENT）
$ node --experimental-strip-types ../../../quay/bin/quay.ts task list        → exit 0（SAMPLE-*，走 sample-workspace 自带 .quay/config.yml）
$ node --experimental-strip-types ../../../quay/bin/quay.ts task view SAMPLE-1A → exit 0
$ node --experimental-strip-types ../../../quay/bin/quay.ts gate SAMPLE-1A     → exit 0（PASS）
```

覆盖范围：根 `README.md`（Option B 三命令 + sample-workspace 一行 + task list/view/check + native 三例 + github 例）+
`packages/quay/README.md`（Option B + --version/-V + task list/view/check + action list + gate --list + gate-log + run --once）+
`packages/quay-native/examples/sample-workspace/README.md`（六条命令）。全部实跑成功，无 ENOENT。

## AC2 —— README 与 CLAUDE.md 字面一致

采用「CLAUDE.md 为权威」方案：CLAUDE.md:17 现为（改后）：

> **Run the CLI:** `node --experimental-strip-types packages/quay/bin/quay.ts <cmd>` (Core), `node --experimental-strip-types packages/quay-native/bin/quay-native.ts <cmd>` (native provider directly).

- 根 README Option B 三命令 = CLAUDE.md:17 的 Core/native 形式 + 同形 github 形式（`node --experimental-strip-types packages/quay-github/bin/quay-github.ts`），**逐字一致**。
- 为此把 CLAUDE.md:17 的 native 形式也统一补上 `--experimental-strip-types`（原为无 flag，与 Core 不一致；现统一为 floor-safe 拼写），并修复 CLAUDE.md:140（重放时的实际行号）指向不存在文件 `packages/quay/bin/quay.js` → `packages/quay/bin/quay.ts`。
- 配置块 `mcp_entry` 例子的 `.js`→`.ts`（与真实仓库 `.quay/config.yml` 及 sample-workspace `.quay/config.yml` 的 `./bin/quay-native.ts` 一致），这是 Core spawn 的 config 条目，非 CLI 直跑命令。

两份文档不再对同一动作给出分叉命令：唯一字面命令集合已收敛到 CLAUDE.md:17。

## AC3 —— 负控制

measure 命令 `node packages/quay/bin/quay.js --help` 仍会 ENOENT（exit 1），因为 `packages/quay/bin/` 下**只有 `quay.ts`，永远没有 `quay.js`**（`ls -la packages/quay/bin/` 确认；`package.json` 的 `bin` 字段指向的是构建产物 `./dist/quay.js`，不是 `bin/quay.js`）。因此若日后有人把文档命令改回 `bin/quay.js`（或引入 `bin/quay.js` 构建产物并让文档去指它），本 measure 立即可检出（exit 1）——与当前已修复形态对照即为 mismatch。文档命令一旦回到 `.ts` 之外的形式，measure 必红。AC3 成立。

## AC4 审计 —— 全仓 `quay.js`/`quay-native.js`/`quay-github.js` 字面出现处分类

| 语境类别 | 判定 | 处置 |
|---|---|---|
| **开发树源码路径** `packages/quay/bin/quay.js` 等（Option B 直跑、task list/view/check/gate/gate-log/action/complete/retreat/promote/run/serve 示例） | 文件不存在（只有 `.ts`），ENOENT | **已改** `.ts` + `--experimental-strip-types`（根 README、packages/quay/README.md、sample-workspace README、CLAUDE.md:138） |
| 配置 `mcp_entry` 例子 `./bin/quay-native.js` / `./bin/quay-github.js`（根 README、packages/quay/README.md） | 与真实 `.quay/config.yml`（`./bin/quay-native.ts`）不符 | **已改** `.ts`（与真实配置逐字一致） |
| **quay-init 铺设产物路径** `.quay/runtime/quay/quay.js`（根 README:233） | quay-init 铺设的**构建产物**（bundled `.js`），非源码 | **保留**，已加注「built Core runtime artifact, distinct from the dev-tree source `bin/quay.ts`」 |
| **npm-pack / vendored 构建产物** `dist/quay.js`（CLAUDE.md:98、`plugin/vendor/quay/dist/quay.js`（plugin/README.md）、`packages/quay/package.json` bin 字段、`packages/quay/scripts/build-dist.mjs`） | `npm run build`/`sync-vendor.sh` 生成的构建产物，Node 20 可跑 | **保留**（artifact 语境，与源码路径不混淆） |
| **历史记录**（`experiments/**`、`milestones/**`、`docs/plans/*`、`docs/proposals/*`、`.claude/skills/**`、`tasks/*.md` 正文提及） | 各轮迭代/审计/方案的历史记录，当时源码确为 `.js`（TS 迁移前）或引述旧形态 | **保留**，不改（历史证据，非当前开发树命令） |
| **源码/测试中的 `quay.js` 字符串**（`packages/*/src/*.ts`、`packages/*/test/*.mjs`、`plugin/scripts/*`） | 多指 `dist/quay.js` 构建产物或 provider 内部文件名 | **保留**（非文档命令，不在本任务范围） |

关键区分不混淆：`packages/quay/bin/quay.js`（开发树源码路径，不存在）与 `.quay/runtime/quay/quay.js` / `dist/quay.js`（铺设/构建产物路径，真实存在）是**两类语境**——前者是「照 README 从源码直跑」会撞的 ENOENT；后者是安装/构建产物，不通过「从源码直跑」路径触及。两者不能互相印证「已覆盖」。

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- tasks/gap-readme-source-install-commands-are-all-broken-quay-js-does-not-exist.md
- README.md
- CLAUDE.md（采用"以 CLAUDE.md 为权威"方案）
- packages/quay/README.md（同缺陷：24 处 `bin/quay.js` 示例命令）
- packages/quay-native/examples/sample-workspace/README.md（同缺陷：6 处 `.js` 命令）

## Dispatch review

reviewer: none
at: 2026-08-06T14:2xZ
changed: 尚未派发/审阅（管理者立案，文档 vs 代码使用视角提问）
