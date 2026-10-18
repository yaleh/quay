---
id: gap-ac355-postmerge-reverify-stale-acceptance-runner-pin
title: AC-355 判据因 gate/acceptance-runner.ts 被合法搬迁而 ENOENT 转假：承接 AC-353 在飞
  re-anchor，在 develop 尖端复验结构臂（按导出符号定位）+ 七测试文件双环境全绿，含可证伪负对照
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac353-criterion-pins-moved-acceptance-runner-path
goal_ac: AC-355
---
**type:** execution

## Proposal

**本轮直接量（2026-10-18，不是台账尾巴）**

```
$ node packages/quay/bin/quay.ts goal gate AC-355 --dry-run --json --root /data/home/yale/work/quay
verdict = "fail"
reason  = "acceptance failed (exit 1) — ... ENOENT: no such file or directory, open
           'packages/quay/src/gate/acceptance-runner.ts' ..."
event.payload.treeSha = 9da413776e62e41f11d45800153ac87ce83add9b

$ git merge-base develop HEAD = git rev-parse develop = 529e8ec0e6975f542f64dc0172ea24d6fec7d781
```

⇒ 不是 exit 3（GOAL-034 早已并入 develop），也不是测试臂红：判据在**结构臂**的 `readFileSync` 上抛
ENOENT 后立即 exit 1，后面的七个测试文件根本没跑到。

**成因是合法搬迁，不是 GOAL-034 的保证坏了。** commit `e676d097b`（2026-10-18 09:33:51 +0800，
「gate: extract types.ts + acceptance-runner.ts into gate/shared/（break parent<->child import edges）」）
把 `packages/quay/src/gate/acceptance-runner.ts` 移到 `packages/quay/src/gate/shared/acceptance-runner.ts`。
AC-355 判据的 `need` 数组把该消费者钉成两件事：文件路径 `"gate/acceptance-runner.ts"` 与相对深度
`../kernel/gate-run-options.ts`。**搬迁让两件同时变**（新文件位于更深一层，深度应为 `../../`）。

**保证本身本轮逐条实测仍然成立**（按导出符号定位承载者，再用解析后的路径判 import）：

```
OK   goal-store.ts                      -> ./kernel/gate-run-options.ts
OK   cli/gate.ts                        -> ../kernel/gate-run-options.ts
OK   gate/shared/acceptance-runner.ts   -> ../../kernel/gate-run-options.ts   （原 gate/acceptance-runner.ts）
OK   gate/registry.ts                   -> ../kernel/gate-run-options.ts
OK   gate/config/loader.ts              -> ../../kernel/gate-run-options.ts
OK   gate/config/index.ts               -> ../../kernel/gate-run-options.ts
OK   gate/factories/utils.ts            -> ../../kernel/gate-run-options.ts
OK   gate/factories/goal.ts             -> ../../kernel/gate-run-options.ts
⇒ 8/8 OK；kernel/gate-run-options.ts EXISTS；gate/config/utils.ts / gate/factories/loader.ts 均 ABSENT
```

七个受影响测试文件本轮各跑一次，两个环境都全绿：

```
干净 shell (env -u QUAY_GOAL_ACCEPTANCE_ACTIVE) : ℹ tests 219  ℹ pass 219  ℹ fail 0
QUAY_GOAL_ACCEPTANCE_ACTIVE=1                   : ℹ tests 219  ℹ pass 219  ℹ fail 0
```

**上一轮修复为什么没顶住（本任务的核心教训）。** 两条 done 的 AC-355 任务各只覆盖当时的形态：
`gap-ac355-postmerge-reverify-develop-carries-slice` 在当时的树上验了结构臂 + 测试臂、并明确「判据文本零
改动」（所以它不可能防住之后的合法搬迁）；`gap-ac355-criterion-false-from-goal-acceptance-active-guard`
修的是 driver 求值环境变量 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 污染测试臂。两者都没有触到**判据把内部模块
路径钉成字符串**这一类失效。唯一的防复发器 `packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs`
在其 COVERAGE BOUNDARY 里明确只覆盖 `import(...)` / `require(...)` 字面量，**不覆盖
`fs.readFileSync` 的路径字面量** ⇒ 同一 commit 造成的 AC-353/AC-355 两处 stale 都从它下面漏过
（硬规则 5b：修的人只修被报出来的那一个，兄弟实例留在原地）。

<!-- dedup-ref -->
去重结论：同一机制（判据把已合法搬迁的内部模块路径钉成字符串）的在飞修复是
`gap-ac353-criterion-pins-moved-acceptance-runner-path`（status todo，`goal_ac: AC-353`），其 AC 第 2 条
逐字写了「兄弟判据 AC-355 同步转绿」，且修法是「按导出符号定位 + 新增整 token `.ts` 路径字面量防复发
检查」。本任务**不重复做那次 re-anchor**；本任务持有它的 **post-merge 那一半**：`depends_on` 指向它，
等它在 develop 尖端落地后独立复验 AC-355。若它的落地**未覆盖** AC-355（fallback），本任务才动手改
`goals/AC-355-*.md` 并补齐测试文件对该类字面量的覆盖。两条任务因此是串行而非重复
（`task-granularity-advice` 对本 Touches 报 `peers: []`；同形先例 `gap-ac355-postmerge-reverify-develop-carries-slice`，
同为 self-touch + 读数为交付物的 post-merge 验证任务）。

## Evidence

（filing 轮读数，全部本轮实测，供 worker 复验起点）

**E1. 判据转假的确切形态**（2026-10-18T03:48:27.710Z，`--dry-run`）：

```
verdict="fail"  cause=null
reason="acceptance failed (exit 1) — node:fs:483 ... Error: ENOENT: no such file or directory,
        open 'packages/quay/src/gate/acceptance-runner.ts' ..."
evaluationRoot="/data/home/yale/work/quay"  treeSha="9da413776e62e41f11d45800153ac87ce83add9b"
```

**E2. 搬迁提交**：`git log -1 e676d097b` ⇒ `2026-10-18 09:33:51 +0800 gate: extract types.ts +
acceptance-runner.ts into gate/shared/ (break parent<->child import edges)`。
`find packages/quay/src -name '*acceptance*'` ⇒ 只有 `packages/quay/src/gate/shared/acceptance-runner.ts`。

**E3. 结构臂按实际路径重跑 8/8 OK**（见 Proposal 的表；消费者 import 行原文可由
`grep -n 'gate-run-options' <八个文件>` 复现，例如
`packages/quay/src/gate/shared/acceptance-runner.ts:30: import { shQuote, DEFAULT_ACCEPTANCE_TIMEOUT_MS }
from "../../kernel/gate-run-options.ts";`）。

**E4. 七测试文件双环境读数**：两行 `ℹ tests 219 / pass 219 / fail 0`（干净 shell 与
`QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 各一次；本任务 filing 轮实测）。

**E5. 树的一致性**：`git rev-parse --abbrev-ref HEAD` = `author`；
`git merge-base develop HEAD` == `git rev-parse develop` == `529e8ec0e6975f542f64dc0172ea24d6fec7d781`
⇒ 共享检出即 develop 尖端，E1 的读数就是 develop 尖端的读数。

## AC

- [ ] AC-355 判据在 develop 尖端转绿：`node packages/quay/bin/quay.ts goal gate AC-355 --dry-run --json --root /data/home/yale/work/quay` 的 `verdict` 为 `pass`（exit 0，不是 exit 1 CAUSE=*，也不是 exit 3 NOT-EVALUATED）；stdout 原文与 `event.payload.treeSha` 进 Evidence；同时 `git merge-base develop HEAD` == `git rev-parse develop`。
- [ ] 七测试文件双环境实测：干净 shell（`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE`）与 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 各跑一次 `gate-config-loader/gate/goal-store/acceptance/acceptance-env/gate-diagnostics/gate-ergonomics` 七个文件，两次都 `ℹ fail 0`；逐字贴两次的 `ℹ tests / pass / fail` 三行。
- [ ] re-anchor 生效且不再钉路径：`grep -nE 'gate/acceptance-runner\.ts|gate/shared/acceptance-runner\.ts' goals/AC-355-*.md` 在消费者路径断言中零命中，承载者由导出符号定位（贴 `grep -rn 'export function runAcceptance' packages/quay/src` 读数）；若 peer 落地后仍命中 ⇒ 本任务执行 fallback 改 `goals/AC-355-*.md` 并按同一判据复验。
- [ ] 可证伪负对照：在 scratch worktree（`git worktree add --detach <path> develop` + `dispatch-worktree-setup.sh`）中把 `packages/quay/src/gate/shared/acceptance-runner.ts` 里指向 `../../kernel/gate-run-options.ts` 的 import 注释掉（不提交）⇒ 判据 exit 1 且 CAUSE 点名该角色；`git checkout --` 恢复 ⇒ exit 0。两次命令 + 逐字读数贴 Evidence（证明 re-anchor 后的判据不是恒真、也不把注释当命中）。
- [ ] 防复发器独立绿：`node --no-warnings --experimental-strip-types --test packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` ⇒ `fail 0`；其负对照 fixture（`QUAY_GOALS_ROOT` 指向含缺失 `gate/acceptance-runner.ts` 的判据）独立重跑必红并点名该字面量。两条读数贴 Evidence。
- [ ] 台账留痕：filing 之后 `.quay/gate-events.jsonl` 新增 `item_id=AC-355` / `verdict=pass` 事件（贴 timestamp）；`node packages/quay/bin/quay.ts goal show AC-355 --json` 的 `evidence.verdict` = `pass`。
- [ ] 不越界：`git diff --name-only develop...HEAD -- packages/quay/src` 输出为空；允许写入面只有 `goals/AC-355-*.md`（仅 fallback 臂）、`packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` 与本任务体；未重启任何 driver / `serve`。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本被改过」，而是：

1. **对象**：develop 尖端上的 AC-355 判据**从共享检出原文执行**得到 `verdict: "pass"` + exit 0（贴 stdout 与 `treeSha`），且 `.quay/gate-events.jsonl` 有对应的 `verdict=pass` 事件 —— `--dry-run` 输出本身不算台账。
2. **第二来源**：七个受影响测试文件在**两个**环境（干净 shell / driver 求值环境变量）各实测 `fail 0` —— 单跑一次干净 shell 不算，这正是前述 done 任务未保住的形态。
3. **可证伪**：scratch worktree 的三态（as-is 绿 / 注释 import 红并点名 CAUSE / 恢复后绿）读数如实留痕 —— 证明 re-anchor 后的判据是真实测量，既不恒真也不空转（硬规则 4 / 4c）。
4. **防复发**：`goal-criterion-import-specifiers-resolve.test.mjs` 对整 token `.ts` 路径字面量这一类生效（绿 + 负数 fixture 红并点名），不是只覆盖 `import(...)` 字面量。
5. **不越界**：`packages/quay/src` 零改动；写入面限于 `goals/AC-355-*.md`（仅 fallback）、该测试文件与任务体；未重启 driver / `serve`。
6. 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-355-post-merge-生产验证-develop-尖端持有本刀全部结构改动-七个受影响测试文件回归全绿.md`
- `packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs`
- `tasks/gap-ac355-postmerge-reverify-stale-acceptance-runner-pin.md`
