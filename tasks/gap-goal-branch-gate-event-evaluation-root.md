---
id: gap-goal-branch-gate-event-evaluation-root
title: goal gate 事件记录判据在哪棵树上求值——payload 增加 evaluationRoot 与 treeSha
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-328
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §7 辛、§9.2 残留 2，硬规则 4c）：goal gate 事件（`.quay/gate-events.jsonl`，`gate: "goal"`）今天只有 `id/item_id/pipeline_id/gate/actor/verdict/timestamp/payload.reason`（实测 2026-10-03 `AC-272` 事件）。goal 分支方案里 pre-merge AC 要在 goal 的判据 worktree 上求值，「这次 pass 是在哪棵树上得到的」今天读不出来 ⇒ GOAL-028 的 AC-328 在缺这个字段时只能读 exit 3。

**修法（方向）**：所有追加 goal gate 事件的路径在 payload 里加 `evaluationRoot`（判据 cwd 的 **realpath**——本机 `/home/yale` 是符号链接，⛔ 不记未解析路径）与 `treeSha`（该 cwd 下 `git rev-parse HEAD^{tree}`，读不到记 null）。账本位置不变（仍是主 root 的 `.quay/gate-events.jsonl`）。

## AC

- [x] `packages/quay/test/goal-store.test.mjs` 新增用例：在临时 workspace 对一个 AC 跑 `goal gate`，断言追加的事件 `payload.evaluationRoot` 等于 git root 的 realpath、`payload.treeSha` 等于 `git rev-parse HEAD^{tree}`，verdict 与修改前相同。 —— 用例把同一 git 树经**符号链接**传入 `--root`，断言 `evaluationRoot === realpath(root)` 且 `!== link`（非回溯路径不得入账，⛔ 非 `realpath(x)===x` 的空转），`treeSha` 对 `HEAD^{tree}`，`verdict` 仍 `pass`；单跑绿（tests 1 / pass 1）。
- [x] `node --test packages/quay/test/goal-gate-verdict-mapping.test.mjs` 退出 0。 —— `tests 17 / pass 17 / fail 0`（MCP `goal_gate` 台账仍断言 `payload.cause`，新字段是**追加**的）。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。 —— 见 Evidence：回退后 1 红（`evaluationRoot` undefined），`cp` 恢复后 1 绿。
- [x] 5b 邻近扫描：grep 其它追加 `gate: "goal"` 事件的写入点，命中数与前 3 条贴进 Evidence，逐条确认已带上两个字段或写明为何不需要。 —— 全仓命中 **3** 条，**三条全部已带** `evaluationContext`；见 Evidence（⛔ 无一需要「为何不需要」）。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-gate-event-evaluation-root` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。 —— **EXIT=0**；selector 选中 **11** 个测试文件（⛔ **未**加 `--allow-thin` ⇒ 非 thin）、全部执行、`tests 175 / pass 175 / fail 0`；清单见 Evidence。

## DoD

真实落地判据：落地后生产账本里新增的 goal gate 事件带有 evaluationRoot 与 treeSha（可用 `tail .quay/gate-events.jsonl` 直接读到）。GOAL-028 的 AC-328 由此从「载体缺字段 ⇒ exit 3」变为可判。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay-native/src/mcp-server.ts
- packages/quay/test/goal-store.test.mjs
- tasks/gap-goal-branch-gate-event-evaluation-root.md

## Evidence

改动 = Core `packages/quay/src/goal-store.ts` 新增导出 `evaluationContext(root)`（realpath + `git rev-parse HEAD^{tree}`，后者读不到记 **null** —— 是一个**取值**而非缺字段，硬规则 3/3b），并在**三个** `gate:"goal"` 写点记录它；`packages/quay-native/src/mcp-server.ts` 从 Core 导入同一助手（⛔ 不另写一份）。

**AC1 —— 新增用例（绿，经符号链接传入 root）**
```
$ env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --experimental-strip-types --test \
    --test-name-pattern="AC1 — goal gate records" packages/quay/test/goal-store.test.mjs
✔ AC1 — goal gate records payload.evaluationRoot (realpath) and payload.treeSha (HEAD^{tree}) (498ms)
ℹ tests 1   ℹ pass 1   ℹ fail 0
```

**AC2 —— 单文件退出 0**
```
$ env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --experimental-strip-types --test \
    packages/quay/test/goal-gate-verdict-mapping.test.mjs
ℹ tests 17   ℹ pass 17   ℹ fail 0
```

**AC3 —— 取假（`cp` 备份回退核心改动，⛔ 不用 `git checkout --`）**
- 备份：`cp packages/quay/src/goal-store.ts /tmp/goal-store.ts.bak` → md5 `0ed64fecd2e112b6b7b93a622d082caa`。
- 回退 CLI 写点的 `...evaluationContext(root)` 后实跑，**1 红**：
```
✖ AC1 — goal gate records payload.evaluationRoot (realpath) and payload.treeSha (HEAD^{tree})
  AssertionError [ERR_ASSERTION]: evaluationRoot must be the criterion cwd's realpath
  actual: undefined   expected: '/tmp/goal-store-git-eval-root-IVnLxK'
ℹ tests 1   ℹ pass 0   ℹ fail 1
```
- `cp /tmp/goal-store.ts.bak packages/quay/src/goal-store.ts` 恢复（md5 回到 `0ed64fecd2e112b6b7b93a622d082caa`）后实跑，**1 绿**：
```
✔ AC1 — goal gate records payload.evaluationRoot (realpath) and payload.treeSha (HEAD^{tree}) (498ms)
ℹ tests 1   ℹ pass 1   ℹ fail 0
```

**AC4 —— 5b 邻近扫描（按位置：`gate:"goal"` 作为【对象键】，⛔ 不数注释/正文里的提及）**
```
$ grep -rn '^\s*gate: *"goal",' --include=*.ts --include=*.mjs --include=*.js . \
    | grep -v node_modules | grep -v plugin/vendor/ | grep -v '/dist/'
packages/quay-native/src/mcp-server.ts:540:        gate: "goal",
packages/quay/src/goal-store.ts:2154:          gate: "goal",
packages/quay/src/goal-store.ts:3312:        gate: "goal",
count = 3        # 全文 20 处「gate: "goal"」提及，其余 17 处是注释/正文，按位置判定不计
```
逐条：
1. `packages/quay/src/goal-store.ts:2154` —— 有界轮转 sweep 写点 → 已带 `...evaluationContext(root)`（`goal-store.ts:2173`；此处 `root` 就是喂给 `runAcceptance` 的 cwd）。
2. `packages/quay/src/goal-store.ts:3312` —— CLI `goal gate` 写点（goal-driver 的**生产路径**）→ 已带（`goal-store.ts:3319`）。
3. `packages/quay-native/src/mcp-server.ts:540` —— MCP `goal_gate` 写点 → 已带（`mcp-server.ts:547`，共享 `evaluationContext`）。
`packages/*/src` 之外无第四处**真实写点**；`plugin/vendor/*/dist/*.js` 的命中是上面两个源的**构建产物**，⛔ 非独立写点。⇒ **三个写点全部带字段，无一需要「为何不需要」**。

**AC5 —— scoped gate（`--for-task`，⛔ 未加 `--allow-thin` ⇒ 非 thin）**
```
$ bash scripts/test.sh --for-task gap-goal-branch-gate-event-evaluation-root    # EXIT=0
... ℹ tests 175   ℹ pass 175   ℹ fail 0
```
被执行的测试文件 = selector（`select-tests-for-touches.ts --paths-only`）选中的 **11** 条，全部真跑：
```
packages/quay-backlog/test/mcp-server.test.mjs
packages/quay-github/test/mcp-server.test.mjs
packages/quay/test/adr-gate.test.mjs
packages/quay/test/adr-store.test.mjs
packages/quay/test/build-dist.test.mjs
packages/quay/test/cli-adr.test.mjs
packages/quay/test/goal-store.test.mjs        ← 含本任务新增 AC1 用例（✔ AC1 — goal gate records …）
packages/quay/test/mcp-adr.test.mjs
packages/quay/test/mcp-server.test.mjs
packages/quay/test/npm-pack-e2e.test.mjs
plugin/test/plugin-packaging.test.mjs
```
（先前在裸 `node --test` 下因泄漏 env 而红的 `I5 …` / `AC-242 successor …` 数条，在此**全绿**。）

**AC1/2/3 的环境注记（防后人误诊）**：worker 会话自身 shell 带 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`（goal-store 的重入哨兵）。直接 `node --test packages/quay/test/goal-store.test.mjs` 会红 **8** 条（I5 ×3 / `AC4 负控制` / `AC-242 successor` ×4）——`env -u` 后 **78/78 绿**；且这同一组 8 条在**pristine develop** 上以**完全相同的形态**红（77 tests / 8 fail）⇒ 与本 delta 无关。`scripts/test.sh` 入口已 `unset` 该变量（`gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env`，已 done），故 AC5 的 scoped gate 不受影响。

**DoD（落地后读数）**：本 delta 尚未落地，故生产账本 `tail` 还读不到新字段；`evaluationContext` 已在真实 git-rooted workspace 上经 `goal gate` 端到端产出（AC1），落地后 goal-driver 每次 `goal gate` 即写入。
