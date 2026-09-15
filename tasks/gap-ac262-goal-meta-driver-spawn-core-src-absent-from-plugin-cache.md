---
id: gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache
title: goal-driver/meta-driver 把 goal-store 当 CLI spawn
  packages/quay/src——plugin cache 里没有那棵源码树（缺的是调用方式，不是代码）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-262
---
**type:** execution

## Proposal

**根因（人 2026-09-15 裁定采用 B2，⛔ 不采用 B1）**：`plugin/scripts/meta-driver.ts:182-196` 的 `goalStoreArgv()` 构造的是**子进程 argv**（`node --experimental-strip-types <goal-store.ts> …`），即 driver 把 goal-store **当 CLI spawn**、消费其 stdout JSON。用到 8 个子命令形态：`list`、`gate <id>`、`write <id> --status`、`check --staleness`、`check --achieved-failing`、`check --stale-pass`、`check --stale-pass --sweep`、`batch`。

**关键事实**：`resolveQuayCodeRoot` / `resolveQuaySrcModule` 的**五个非测试调用点没有一个用 `await import`** ⇒ 这个依赖是**纯进程边界产物，不是代码依赖**。而 plugin cache 里的 `scripts/dist/goal-driver.js` **已经把 goal-store 库完整内联**（`coreSrcAliasPlugin`，`packages/quay/scripts/build-plugin-dist.mjs:358-376`），却仍留着 `path.join(…,"packages","quay","src",…)` 去 spawn 一个那里不存在的文件；`packages/quay/src/goal-store.ts:3042-3043` 的 `main()` 守卫（`process.argv[1].endsWith("goal-store.ts")`）在 bundle 里故意为 false，所以 bundle 自带的 CLI dispatch 不可达。**⇒ 缺的不是代码，是调用方式。**

**当前基线（经 vendored bundle 实测，去掉管道后的真实退出码）**：`goal gate`、`goal check --staleness`、`goal batch` 三者**都 rc=1 且 stderr 含 `unknown goal subcommand: … (try: list, show, write)`**。现有 `packages/quay/src/cli/goal.ts` 仅 103 行，只实现 `list`(:39) / `show|view|get`(:52) / `write|new`(:82)，`:100` 是 unknown 分支。`packages/quay/src/provider-client.ts:65-68` 的 ABI client 已有 `goalList` / `goalGet` / `goalWrite` / `goalGate` —— **`gate` 在 ABI 层已存在，缺的是 CLI 表层 + `check` / `batch`**。

**要做的**：补 `quay goal gate|check|batch` CLI 动词（覆盖 driver 实际用的全部 8 个子命令形态，含 `check` 的四个 flag 变体），然后把 goal-driver / meta-driver 的 argv 构造改为调 vendored bundle 的这些动词，使两个 driver 源码里指向 `packages/quay/src` 的路径构造点归零。

**查重（按机制）**：`gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root`（done）只 scope 了**源树 + shipped-flat 两种布局**，plugin-cache 是第三种、不在其中；`DIR-049:193-211` 指出 plugin cache 无法满足 `readLoopParams` / `bin/quay.js`，但记为 "not urgent: no consumer hits it today"，且都不涉及「补 CLI 动词」这个修法。全店搜 `goal subcommand` 命中 0 ⇒ 本条无既存承接任务。

## Contract

measure goal_cli_verb_exit = `node packages/quay/bin/quay.js goal gate <id>` 及 `goal check --staleness` / `goal batch` 三者的 exit_code 与 stderr_signature 两个读数
band n/a: 退出码 + 字符串签名判据，无数值区间
invariant driver_argv_has_no_packages_src = goal-driver.ts 与 meta-driver.ts 源码里指向 packages/quay/src 的路径构造点计数为 0（按位置扫，注释不算）
invoke `node --experimental-strip-types plugin/scripts/goal-driver.ts --root .`
control 把 argv 构造改回旧形态（spawn packages/quay/src/goal-store.ts）⇒ 两个 driver 测试必须红；改回新形态 ⇒ 绿
resume 真跑一轮 goal-driver 后读 `.quay/goal-round.jsonl` 末轮的 goal-ring state

## Acceptance Criteria

- [ ] AC1：`quay goal gate|check|batch` 三个动词落地，覆盖 driver 实际用的全部 8 个子命令形态（`list` / `gate <id>` / `write <id> --status` / `check --staleness` / `check --achieved-failing` / `check --stale-pass` / `check --stale-pass --sweep` / `batch`）——逐形态实跑，exit 0 且 stdout 是可解析 JSON。负控制（改前必须红）：同三条在改前 rc=1 且 stderr 含 `unknown goal subcommand`。
- [ ] AC2：新动词登记三处——`packages/quay/src/cli/goal.ts` 的派发行、`delivery-manifest.json` 的 capabilities、`packages/quay/src/cli/help.ts`。⛔ `quay <verb> --help` 渲染的是 `cli/help.ts` 那一份、**不是** verb 文件内联那份，只改后者等于没改：判据 = `quay goal --help` 的**真实输出**含三个新动词。
- [ ] AC3：`plugin/scripts/goal-driver.ts` 与 `plugin/scripts/meta-driver.ts` 的 argv 构造改为调 vendored bundle 的 CLI 动词，两文件里指向 `packages/quay/src` 的路径构造点计数为 0（按位置扫源码；注释/散文提及不算命中）。
- [ ] AC4：**生产载体读数**——实现落地后真跑一轮 goal-driver，`.quay/goal-round.jsonl` 里存在**实现落地时刻之后**的轮次，且该轮 goal-ring 的 state 不是 failed（⛔ 单测绿不算；只能被 fixture 满足的判据不是测量，硬规则 4 推论三）。
- [ ] AC5：`plugin/test/goal-driver.test.mjs` 与 `plugin/test/meta-driver.test.mjs` 各有一个用例钉住「argv 不含 `packages/quay/src`」，且把 argv 构造改回旧形态时该用例红（双向控制）。

## Definition of Done

- [ ] AC1–AC5 全勾。三条既有纪律逐条落实：①新 CLI 动词三处登记（派发行 + `delivery-manifest.json` capabilities + help）；②help 正本是 `cli/help.ts`；③AC-262 第三支要求生产载体里有落地之后的轮次且 goal-ring 非 failed ⇒ 落地后必须真跑一轮 goal-driver。
- [ ] 按 inherited-core 的标准 DoD：REAL LANDING 是门槛——AC4 的读数取自主检出的 `.quay/goal-round.jsonl`，不是 fixture 注入的假轮次。
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache` 绿；全量由 fan-in 机械跑。

## Dispatch review

reviewer: human
at: 2026-09-15
changed: 无（B2 方向、8 个子命令清单、三条纪律均按人给定原样落盘）

## Touches

- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/provider-client.ts
- plugin/scripts/goal-driver.ts
- plugin/scripts/meta-driver.ts
- plugin/test/goal-driver.test.mjs
- plugin/test/meta-driver.test.mjs
- delivery-manifest.json
- tasks/gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache.md
