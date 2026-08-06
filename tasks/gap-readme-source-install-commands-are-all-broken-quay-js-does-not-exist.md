---
id: gap-readme-source-install-commands-are-all-broken-quay-js-does-not-exist
title: "README Option B ('from source... no global install step required') and every worked example
  under it (task list/view/check) instruct `node packages/quay/bin/quay.js <command>` — this file
  DOES NOT EXIST, only bin/quay.ts does; reproduced verbatim: `Error: Cannot find module
  '.../packages/quay/bin/quay.js'`; no build step bridges .ts to .js (grep for it in root/package
  package.json = 0); CLAUDE.md:17 documents the CORRECT invocation
  (`node --experimental-strip-types packages/quay/bin/quay.ts <cmd>`) — the two checked-in docs
  disagree on the literal command and only one of them runs; same break repeats for quay-native.js
  and quay-github.js; a fresh git-clone adopter following README's own recommended dev path hits
  ENOENT on the FIRST copy-pasted command; doc-vs-code lens, manager 2026-08-06"
status: todo
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
measure readme_option_b_runs = `node packages/quay/bin/quay.js --help` 退出码（0=可运行）
band readme_option_b_runs = 0（当前必为非 0，修复后必为 0，或命令文本已同步改为可运行形态）
invariant README 记录的字面命令必须与 CLAUDE.md 记录的字面命令一致，或明确说明差异原因；
  不得两份文档给出同一动作的不同命令而只有一份能跑
invoke `node packages/quay/bin/quay.js --help`
control 改前贴出上面 invoke 的真实报错；改后同一条命令必须成功退出
resume 若中断，先跑 measure 确认当前 README 的字面命令是否已可运行，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: README Option B 的三条命令（quay/quay-native/quay-github）与后续全部可复制示例，
      逐条实跑成功，贴出改前/改后输出对照
- [ ] AC2: README 与 CLAUDE.md 对同一动作（"直接跑源码"）给出**一致**的字面命令
      （或者一个只保留精简指引、明确指向另一个作为权威来源，不得两份都给出会分叉的完整命令）
- [ ] AC3: 负控制——若日后重新引入 `.ts`→`.js` 的构建产物形态，
      本任务的 measure 命令必须能检测出"文档命令与实际产物形态"再次不一致
- [ ] AC4: 复查文档里其余 `quay.js`/`quay-native.js`/`quay-github.js` 字面出现处，
      区分「开发树源码路径」与「quay-init 铺设产物路径」两类语境，逐条标注不得混淆

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- README.md
- CLAUDE.md（若采用"以 CLAUDE.md 为权威"方案）
