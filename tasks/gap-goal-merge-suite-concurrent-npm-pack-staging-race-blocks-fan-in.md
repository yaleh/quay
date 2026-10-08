---
id: gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in
title: goal 并入的全量 suite 下两个测试在与真实 npm-pack staging 并发时必红，两次 GOAL-030 并入尝试均复现
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**现象**（实测，`.quay/gate-events.jsonl` 两条 `gate: "goal-merge-result"` 记录，`item_id: "GOAL-030"`，id `53293e46-...`/`ba3bd963-...`，时间戳 `14:19:42`/`14:52:50`）：`quay goal merge GOAL-030` 的两次尝试（一次首次请求 `f2b2a22b`，一次人工显式重试 `46d1f55b`）在 §4.7 的全量 suite 步骤均红，**两次失败的测试名与原因逐字相同**：

```
✖ walk→read race: a listed .sh that vanishes before its read is SKIPPED and REPORTED, never a crash
  (npm-pack staging rm -rf's packages/quay/plugin/ mid-suite)   [plugin/test/adr016-screen-use-check.test.mjs]
✖ AC2 — fast-mode-telemetry.ts has ONE physical copy; plugin/scripts/ is authoritative,
  experiments/ is a symlink re-export                           [plugin/test/fast-mode-telemetry.test.mjs 同族]
```

**已排除「GOAL-030 内容冲突」**：两次失败都报在 `step: "suite"`（不是 `merge-conflict`）；我独立在 `/tmp/goal030-merge-repro` 用 `git worktree add --detach develop && git merge --no-ff goal/GOAL-030` 复现了同一棵合并树——`git merge` 零冲突，合并提交 `8c787c161`（parents `39e3a147d 8c8973dfa`）干净生成。

**已排除「这是内容/逻辑 bug」**：在这棵复现出来的合并树上，单独跑 `node --experimental-strip-types --test plugin/test/adr016-screen-use-check.test.mjs`——**19/19 全绿**，包括那条在两次生产并入尝试里都红的「walk→read race」测试。同一棵树、同一份代码，单文件隔离跑通过，说明失败不是合并内容引入的逻辑缺陷。

**⇒ 结论：这是全量 suite 并发执行下的环境伪影**，不是内容冲突。该测试自己的名字就点明了触发条件——「npm-pack staging rm -rf's packages/quay/plugin/ mid-suite」——这是本仓库真实发生过的现象（测试原本就是为它写的），而该测试的断言是**严格 `assert.deepEqual`**（`plugin/test/adr016-screen-use-check.test.mjs:155-166`）：只 mock 了一个指定受害文件的 `readFileSync` 抛 ENOENT，断言 `scan.unreadable` **恰好等于**只含那一条的数组。全量 suite 并发跑时，如果真有一个做实际 npm-pack staging 的测试文件同时在对 `packages/quay/plugin/` 做 `rm -rf`/重建，会让这条测试自己的真实（未 mock）文件系统扫描也撞到一个**额外的、非预期的** ENOENT（或反过来，受害文件没来得及被 mock 命中前先被真实删除），讲真实数组撞上严格等值断言就会红——这与两次生产事件的失败模式完全吻合（同一测试、同一原因，仅因并发时机而间歇出现）。

`fast-mode-telemetry.ts` 的 symlink/物理拷贝不变式测试很可能是同一次并发扰动的另一受害者（同一 suite 窗口内，若某并发进程短暂改写了 `plugin/scripts/`/`experiments/` 下的相关路径，这条不变式检查也会被拖带进去一起红）——未独立复现到 100% 确证，留给执行者核实。

**影响面**：任何 `quay goal merge` 的全量 suite 步骤都会被这类并发噪声间歇性拖红——不是 GOAL-030 专属，会堵住任何 goal 分支的并入（人工重试在赌运气，不稳健）。

**执行更正（2026-10-08，实测推翻 Finding 里的两处推断）**：①「触发源是 `packages/quay/plugin/`」**被证伪**——该路径已由 `isGeneratedMirrorPath`（2026-10-04 落地）从扫描面剔除，真实的 `package.sh` staging 并发跑 100 轮 **0 红**；真正能复现的是**同族的 `packages/quay/plugin-staging-<pid>-<n>/`**（前缀不匹配）。②「另一受害者是 `plugin/test/fast-mode-telemetry.test.mjs`」**查无此文件**——那条测试在 **`plugin/test/loop-shipping.test.mjs`**，其失败机制是**另一条**（`walkCorpus` 的无保护 `readdirSync` 抛 ENOENT），不是同一扰动的拖带。两条实测读数与负控制见下方 AC。

## Acceptance Criteria

- [x] 在 `/tmp/goal030-merge-repro`（或新建的等效复现树）上，并发跑一次真实的 npm-pack 打包/staging 操作与 `plugin/test/adr016-screen-use-check.test.mjs` 同时执行，复现该测试红（确认根因，而不是停留在"很可能"）
  —— **等效复现树**：`/tmp/goal030-merge-repro`（`git worktree add --detach develop` + `git merge --no-ff goal/GOAL-030`，零冲突，合并树 SHA `62d71a97a`）。**真实 `package.sh` 形态（`rm -rf packages/quay/plugin` + `cp -R plugin/. …` + `rm -rf …/test`）并发 100 轮 —— 0 红**：该路径已被 `isGeneratedMirrorPath` 过滤（2026-10-04 commit `2eb718072`），Finding 的触发源推断**被证伪**。
  同族的 `packages/quay/plugin-staging-<pid>-<n>/`（一个整份 plugin 副本，创建后被 `rm -rf`）与测试并发 —— **117/120 轮红**，失败文本与生产逐字同形：`AssertionError: the vanished file must be RETURNED, not swallowed`，`actual` 里除受害文件外多出 `plugin-staging-*/scripts/*.sh` 的 ENOENT 行。
  根因确认（按位置，非关键词）：`plugin/scripts/adr016-screen-use-check.ts:122` `GENERATED_MIRROR_PREFIXES = ["packages/quay/plugin"]` + `:130` `norm.startsWith(\`${p}/\`)` —— 只覆盖 `packages/quay/plugin/`，**不覆盖 `packages/quay/plugin-staging-…`**（`plugin-` 后不是 `/`）；而同族机件 `walkCorpus` **按名跳过两者**（`loop-shipping-exclusion-data.mjs#stagingDirPrefix`）= 硬规则 5b 的同一缺陷两处落地。⇒ 「数组恰好只有一条」这个断言面在并发扰动下必红。
  ⛔ 未把 `plugin-staging-*` 加进 checker 的过滤面：无 AC 要求，且当前**无存活生产者**（造它的测试 `quay-init-laydown-dist-closure.test.mjs` 已归档，`scripts/test.sh` 的 glob 非递归不进 `archive/`）——那样做是为一棵不存在的树改生产扫描面。按 AC2 放宽断言即可覆盖**整类**扰动（不止这一个成员）。
- [x] 若确认是严格 `assert.deepEqual` 对并发噪声不宽容：修复方向——断言改为"受害文件那一条必须存在"而不是"数组恰好只有这一条"（如 `assert.ok(scan.unreadable.some(e => e.rel === victim && e.reason === "ENOENT"))`），同时保留对"受害文件确实被跳过而非崩溃"这一核心语义的覆盖；⛔ 不要把断言弱到连受害文件本身都不检查
  —— 落地为 `assertVanishedFileReported(scan, victim)`（谓词=受害文件那一条必须存在，**容忍**无关的瞬时行），并在测试里写明「为何不钉整数组」。**未削弱的语义**：`scan.violations.length === 0`、`verdict.state === "verified"`、以及 verdict 必须**点名** skip（`/\d+ 个文件在 walk→read 之间消失/`，只去掉钉死的计数 `1` —— 几份文件消失是活树的读数，不是这条性质）。
- [x] `fast-mode-telemetry.ts` 的物理拷贝/符号链接不变式测试同样核实是否对并发噪声敏感，若是按同一原则修复
  —— ⚠️ Finding 点名错文件：该不变式检查在 **`plugin/test/loop-shipping.test.mjs`**（`plugin/test/fast-mode-telemetry.test.mjs` 不存在；生产日志里的测试名属于 loop-shipping.test.mjs:252）。**实测敏感**：`walkCorpus` 的 `fs.readdirSync(d, {withFileTypes:true})` 无 try/catch，被父目录列出、又在其自身 read 之前被删的目录会抛 ENOENT，把**当时正在走的任何一条** loop-shipping 测试拖红 —— 并发造 `<repoRoot>/tmp/<fixture>/…`（run-identity/stage-receipt selftest 的真实形态）**11/40 轮红**，报 `ENOENT … scandir '<root>/tmp/<fixture>/N'`（生产日志里那条 AC2 测试名正是列表中的一条）。
  修复（三条，全部对齐**先落地的兄弟机件** adr016 的 `SKIP_DIRS` —— 硬规则 5b）：① `walkCorpus` 按名跳过 repo-root `tmp/`（`git ls-files` 实测：任何 `tmp/` 目录下 **0** 个已签入文件，剪掉不丢东西）；② `readdirSync` 容忍 **仅 ENOENT**（EACCES/EIO 仍抛 —— 硬规则 3b）；③ 拷贝扫描的 `lstat` 收进 `physicalTelemetryCopies()`，同样**仅**容忍 ENOENT（"恰好一份物理拷贝"仍是精确 `deepEqual`，只放宽读取）。
- [x] 修复后：在同一棵复现合并树上单文件跑绿（回归验证不变坏），且不引入新的宽容度缺口（即故意传一个"受害文件本身没被正确跳过"的坏结果，断言仍必须红——取假）
  —— 两个文件在 `/tmp/goal030-merge-repro` 上单文件跑绿：adr016 **20/20**、loop-shipping **24/24**。**取假负控制（确定性，不依赖时序）**：adr016 新增 `walk→read race negative control` —— 吞掉 ENOENT（空数组）⇒ **红**、只报别人的行 ⇒ **红**、受害文件在场且并列一条无关行 ⇒ 绿；loop-shipping 新增 readdir 双向控制（mock 子树 ENOENT ⇒ 跳过且兄弟仍被收集；mock EACCES ⇒ 仍抛）+ tmp/ skip 的承载性负控制（移出 `tmp/` 后同一文件**被**收集）+ 三个既有旁路控制新增「非空走通锚点」（一个普通兄弟文件**必须**被收集，防 skip 变空转）。
  **回归**：同样的负载下重跑 —— adr016 **0/120**（修前 117/120）、loop-shipping **0/40**（修前 11/40）。
- [x] `scripts/test.sh` 全量跑绿（本任务落地的真正验收口径）
  —— 在真实合并树 `/tmp/goal030-merge-repro`（develop + goal/GOAL-030）上施加本修复后跑全量 `bash scripts/test.sh`：**两条目标测试全绿**。唯一红是**宿主型环境红**（与 delta 无关）：`plugin/test/driver-anchor-memory-envelope.test.mjs` AC4 `real-cgroup negative control` —— 断言时 shell 已在 `quay-anchor-quay-1791446000678.scope` 内（驱动的 anchor cgroup），即**未施加本修复的同树全量跑也红同一条**（两次对照：修前 1 红、修后 1 红，同 id 同断言）。
- [x] 本任务落地（develop 上）后，`quay goal merge GOAL-030 --reason "..."` 的下一次尝试（或已有待执行请求的自动重试）在 suite 步骤不再复现这两条失败
  —— worker 不跑 goal merge（fan-in 由 worker-driver 机械执行）。落地前能给的最强证据已给：把本修复施加到**真实合并树**上跑全量 suite，两条失败不再出现（上一条）。**未验证的那一半写明**：真正的"落地后那一次"只能由 fan-in / 下一个 goal merge 观察——worker 阶段给不出该读数。

## Definition of Done

两条测试对全量 suite 并发执行下的真实环境噪声具备容忍度（在不放弃其核心断言语义的前提下），`scripts/test.sh` 全绿，且验证过 GOAL-030（或任一其它 goal 分支）的并入不再被这类并发伪影间歇性挡住。

## Touches

- plugin/test/adr016-screen-use-check.test.mjs
- plugin/test/loop-shipping.test.mjs
- tasks/gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in.md
