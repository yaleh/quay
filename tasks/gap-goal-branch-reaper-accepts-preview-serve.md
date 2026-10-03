---
id: gap-goal-branch-reaper-accepts-preview-serve
title: 孤儿 serve 回收器认可在自身 root 登记过的 serve——否则 goal 预览实例会被当泄漏杀掉
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

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.10、§9.2 残留 3）：goal 的预览实例是一个以预览 worktree 为 workspace root、后台启动的 `quay serve`。`plugin/scripts/worktree-process-reaper.ts --orphan-serves`（`classifyOrphanServes`）回收「父进程已死（ppid 1）∧ 不是 `--root` 下登记的宿主」的 serve——后台启动的预览 serve 两条都满足，会被回收。

**修法（已落地）**：
1. 新增 `isSelfRegisteredServe(p)`：读【进程自身 cwd 下】的 `.quay/server.json`，登记的 pid 与 `p.pid` 一致 ⇒ 它是「它自己那个 root 的登记宿主」，豁免。carrier 缺失/读不到/登记的是别的 pid 一律担保不了 ⇒ 仍按泄漏回收（⛔ 没有放宽到「cwd 不是主 root 就放过」）。
2. 豁免走独立的 `recognizedServes` 输出（JSON + 文本都报），不与 `serves: []` 同形（硬规则 3b：「判过且豁免」vs「够不着」）。
3. `classifyOrphanServes` 的作用域同时纳入本工作区的 worktree 命名空间（`loop.worktree_root`，经单一解析入口 `resolveWorktreeNamespace` 解析，⛔ 不是字面量）——预览 worktree 是主检出的**兄弟目录**，不加这一条它在回收器眼里根本不存在。其它仓库照旧够不着（2026-09-17 实测：无作用域的版本杀掉了线上 Web UI）。

## AC

- [x] `plugin/test/worktree-process-reaper.test.mjs` 新增用例，以注入的进程表与临时目录断言 `classifyOrphanServes`：① ppid 1、cwd = 预览目录、该目录 `.quay/server.json` pid 一致 ⇒ 不在回收集；② 同上但 pid 不一致 ⇒ 在回收集；③ 该目录无 carrier ⇒ 在回收集；④ 主 root 登记宿主的既有判定不变。（新增 3 个用例：`isSelfRegisteredServe` 单测、`classifyOrphanServes — 预览 serve：①…④`、`classifyOrphanServes — 命名空间…`；既有 22 个用例全绿）
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 在本机对当前进程跑一次 `--orphan-serves --root <主检出> --list`，改动前后输出的回收集一致（此时还不存在预览 serve）；前后输出贴进 Evidence。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-reaper-accepts-preview-serve` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## Evidence

**AC1 — 新增判定（`plugin/test/worktree-process-reaper.test.mjs`，26 个用例全绿）**

```
✔ isSelfRegisteredServe — 只认「自身 cwd 下 .quay/server.json 登记的正是这个 pid」
✔ classifyOrphanServes — 预览 serve：①登记一致⇒豁免 ②pid 不一致⇒回收 ③无 carrier⇒回收 ④主 root 既有判定不变
✔ classifyOrphanServes — 命名空间（主检出之外的兄弟目录）内的预览 serve 同样自证豁免；无担保者照旧回收
```

① 断言 `r.serves === []` 且 `r.recognizedServes === [201]`（豁免必须是**被识别**，不是够不着）；②`server.json` 写成 `{pid:999}` ⇒ `r.serves === [201]`；③ 删掉 carrier ⇒ `r.serves === [201]`；④ `mk(100, root)`（pid===reg.pid）不回收、`mk(101, root)` 回收 ⇒ `serves === [101]`。

**AC2 — 取假（cp 备份，⛔ 未用 `git checkout --`）**

```
$ cp plugin/scripts/worktree-process-reaper.ts .quay/ac328/reaper.before.ts      # 备份 md5 5006512bc70fd40c5093525a9f3666c3
$ (临时删掉 classifyOrphanServes 里的 isSelfRegisteredServe 豁免分支)
$ node --no-warnings --experimental-strip-types --test plugin/test/worktree-process-reaper.test.mjs   # exit=1
✖ classifyOrphanServes — 预览 serve：①登记一致⇒豁免 ②pid 不一致⇒回收 ③无 carrier⇒回收 ④主 root 既有判定不变
  AssertionError [ERR_ASSERTION]: 自证的预览 host 不得被回收
    actual: [ 201 ]    expected: []
✖ classifyOrphanServes — 命名空间（主检出之外的兄弟目录）内的预览 serve 同样自证豁免；无担保者照旧回收
  AssertionError: 命名空间内无担保者回收；其它仓库够不着 ⇒ 绝不动
    actual: [ 201, 202 ]    expected: [ 202 ]
✖ CLI --orphan-serves — 命名空间里的预览 root 自证 ⇒ 豁免并计入 recognizedServes；同命名空间内无担保者仍回收
  AssertionError: 只有命名空间内无担保的那一个在回收集
    actual: [ 201, 202 ]    expected: [ 202 ]
ℹ tests 26   ℹ pass 23   ℹ fail 3
```

（回退后 201 号预览 serve 落进回收集 = 本任务要修的那个缺陷。）

```
$ cp .quay/ac328/reaper.before.ts plugin/scripts/worktree-process-reaper.ts      # 恢复
$ md5sum plugin/scripts/worktree-process-reaper.ts .quay/ac328/reaper.before.ts
5006512bc70fd40c5093525a9f3666c3  plugin/scripts/worktree-process-reaper.ts
5006512bc70fd40c5093525a9f3666c3  .quay/ac328/reaper.before.ts
$ node --no-warnings --experimental-strip-types --test plugin/test/worktree-process-reaper.test.mjs   # exit=0
ℹ tests 26   ℹ pass 26   ℹ fail 0
```

**AC3 — 本机实跑，改动前后回收集一致（此时尚无预览 serve）**

```
$ node --experimental-strip-types <主检出>/plugin/scripts/worktree-process-reaper.ts \
    --orphan-serves --root /data/home/yale/work/quay --list            # 改动前
worktree-process-reaper: orphan-serves — 0 leaked serve host(s) [dry-run] (registered live host pid=1769873)

$ node --experimental-strip-types <本 worktree>/plugin/scripts/worktree-process-reaper.ts \
    --orphan-serves --root /data/home/yale/work/quay --list            # 改动后
worktree-process-reaper: orphan-serves — 0 leaked serve host(s) [dry-run] (registered live host pid=1769873; 0 self-registered host(s) spared)
```

`--json` 对照（同一 `--root`）：改动前 `{found:0, pids:[], serveNotEvaluated:false, reg.pid:1769873}`；改动后 `{found:0, pids:[], serveNotEvaluated:false, reg.pid:1769873, recognizedServes:[]}` ⇒ **回收集一致**（都是空集），登记宿主 pid 不变，新增字段没有改变既有判定。

**AC4 — scoped 门退出 0 且非 thin**

```
$ bash scripts/test.sh --for-task gap-goal-branch-reaper-accepts-preview-serve    # exit=0
ℹ tests 26   ℹ pass 26   ℹ fail 0        （日志内 "test-selection-thin" / "selected 0 test files" 命中数 = 0）

$ bash scripts/test.sh --for-task gap-goal-branch-reaper-accepts-preview-serve --paths-only
plugin/test/worktree-process-reaper.test.mjs        （selector exit 0 ⇒ 非 thin）
```

被执行的测试文件名：**`plugin/test/worktree-process-reaper.test.mjs`**。另：`node_modules/.bin/tsc --noEmit -p tsconfig.json` exit 0（新增跨包 import `packages/quay/src/worktree-namespace.ts` 通过类型检查）；scoped 静态层 `worktree-namespace-literal-check: PASS — 1 double-quoted "quay-worktrees", at packages/quay/src/worktree-namespace.ts:46`（未新增字面量）。

**AC4 附带（fan-in suite 的 true cause，非本任务 diff）— 修一个 develop 全宽的静态红**

上一轮 fan-in 在 `step=suite` 退出（`# fail 45`），真因不是本任务的新用例：全量 suite 的静态层 `spec-declaration-point-check` exit=1 —— `orchestration/SPEC-goal-branch-2026-10-03.md`（develop commit `d4b7ca1c2` 只加了 464 行 SPEC，未登记）缺登记于它的两个声明点（`plugin/skills/manager/SKILL.md` 索引 + `plugin/skills/init/SKILL.md` 的 `<!-- reference-doc -->` 块）。该红在 develop 与主检出上**同样复现**（`git show develop:plugin/skills/manager/SKILL.md | grep SPEC-goal-branch-2026-10-03` 空），与本任务 diff 无关、且无人认领（无任务 Touches 这两个文件），会阻塞**所有**任务的 fan-in。按 check 的要求补齐两处登记：

```
$ node --experimental-strip-types plugin/scripts/spec-declaration-point-check.ts
PASS: all 46 orchestration/SPEC-*.md declared at each of 2 declaration points    # exit 0（修复前 exit 1）

$ node --no-warnings --experimental-strip-types --test plugin/test/spec-declaration-point-check.test.mjs   # 9/9 pass
$ node --no-warnings --experimental-strip-types --test plugin/test/manager-layer-shipping.test.mjs          # 7/7 pass（AC6「manager 索引覆盖每个 on-disk SPEC」修复前同样红）
```

改动落在本任务 Touches 之外 ⇒ `plugin/skills/manager/SKILL.md` 与 `plugin/skills/init/SKILL.md` 已登记进 `## Touches`（fan-in 的 anti-drift 逐步核对 `git diff` 实际文件 vs 声明面）。

## DoD

真实落地判据：goal 预览实例的 serve 能在后台存活，而泄漏的测试 serve 仍被回收。生产读数由 GOAL-028 的 AC-328（live-probe AC 在预览实例上 pass 之后才并入）在第一个试点 goal 上取得。

## Touches

- plugin/scripts/worktree-process-reaper.ts
- plugin/test/worktree-process-reaper.test.mjs
- plugin/skills/manager/SKILL.md
- plugin/skills/init/SKILL.md
- tasks/gap-goal-branch-reaper-accepts-preview-serve.md
