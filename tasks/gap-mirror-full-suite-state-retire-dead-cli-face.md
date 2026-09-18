---
id: gap-mirror-full-suite-state-retire-dead-cli-face
title: mirror-full-suite-state.ts 的模块面是活的、CLI
  入口面已死——退入口留模块；并纠正「pre-verified-round-record.ts 同形」这一误判（其 CLI 在
  fan-in-execute.js:496 仍被真调用）
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**结论先行**：`plugin/scripts/mirror-full-suite-state.ts` **不能整体退役**——它的**模块面是活的**；死的是它的 **CLI 入口面**（`main()` `:186` + 直接入口守卫 `:255`）。这两件事必须分开说，否则一动就出事。

### （一）模块面是活的（现场核实）

- `plugin/scripts/worker-driver.ts:231-232`：
  > （复用 `mirror-full-suite-state.ts` 的 build/write/skip 单一实现，⛔ 不另写一份 state shape）。
  > `import { buildMirrorState, writeMirrorState, shouldSkipMirrorWrite, readCurrentState } from "./mirror-full-suite-state.ts";`
- 调用点 `worker-driver.ts:4940`（`mirrorMechanicalFanInSuiteState({…})`，机械 fan-in 的 suite 终态镜像写，定义在 `:5094`）。
- 产物被**下游 fail-closed 消费**：`/tests` 页读 `full-suite-state.json`；ff 闸 `packages/quay/src/fan-in/ff-merge.ts:421 readGreenMirrorCommit` 在 capture 缺失时回退读它（`:441`），要求 `state === "green"` ∧ `taskId` 匹配 ∧ `commit` 为 40-hex，否则返回 `""` ⇒ 闸 fail-closed（`:447` 另有 `git merge-base --is-ancestor` 祖先校验）。

**⇒ 模块一行都不能删。**

### （二）死的是 CLI 入口面（现场核实）

- 文件内有完整的 CLI：`const usage` `:172`、`export function main(argv)` `:186`、`if (isDirectEntry(import.meta, undefined, "mirror-full-suite-state"))` `:255`。
- **它没有活调用者**。本任务立案时对 `plugin/scripts/*.ts` 中含 `isDirectEntry(import.meta` 的 **125 个脚本**逐个做「是否有非注释的真调用者」扫描：`mirror-full-suite-state.ts` 的 invoked-by 集合为**空**。
- 据 `plugin/workflows/fan-in-execute.js:796-802` 的留痕，它的调用者是**已删除的 step 4.5 `# mirror-state-block`**——与 `gap-mirror-measure-history-retire-dead-writer` **同一根因、同一删除动作**。

### （三）⚠️ 一条必须先纠正的前提（否则会误删活代码）

立此项时有一个自然推断：「`pre-verified-round-record.ts` 完全同形，一并退」。**实测为假，且方向相反**：

- `plugin/workflows/fan-in-execute.js:496` **仍在真调用它的 CLI**——
  ```sh
  if ! node --experimental-strip-types ${worktree}/plugin/scripts/pre-verified-round-record.ts \
    --task-id ${task} --run-id ${runId} … --preverified 0 --state red \
    --root ${worktree} --suite-log "$suite_log_file" …
  ```
  （红桶 suite 的 `verification-round` 入账路径；写在 `if [ "$full_suite_ran" = "true" ] && [ "$suite_exit" != "0" ]` 分支内。）
- 它的 `isDirectEntry` 守卫在 `:1056`、`main` 在 `:995`，**都是活的**。

**⇒ 这是硬规则 5b 的反向形态**：不是"修好一个漏了兄弟"，而是**"看到一个死了，就推断同族都死了"**。所以本任务的**兄弟集必须靠测量得出，不得靠形态推断**。

### （四）兄弟集的实测读数（立案时；供 AC1 复核）

125 个带直接入口守卫的脚本中，**16 个**在"非注释真调用者"意义下为孤岛：

```
claim-task.ts          derive-touches-heuristic.ts   mirror-full-suite-state.ts   mirror-measure-history.ts
outer-driver.ts        packaging-hygiene-check.ts    phase-declare.ts             quay-deliver.ts
red-window-triage.ts   server-partial-stop-verify.ts suite-bucket-attribution.ts  suite-bucket-hub-list.ts
suite-driver.ts        suite-lock-slots.ts           supervisor-preempt-candidates.ts  touches-parser.ts
```

⛔ 但**这 16 个不能一律当"死 CLI"**：其中多数是**纯库**（`touches-parser.ts` / `suite-lock-slots.ts` / `suite-bucket-attribution.ts` / `derive-touches-heuristic.ts` …），它们的直接入口守卫是**防御性的**、从来就不是给人跑的入口。判据须区分二者（见 Contract）。

## Contract

**判别式（本任务的核心产出）**——判为「死 CLI 入口面」须**同时**满足：

1. 文件含 `isDirectEntry(import.meta, …)` 守卫，**且**含一个真正的参数解析入口（`usage` 字符串 / `main(argv)`）；**且**
2. 该入口在所有非注释位置**零真调用者**（排除自身、自身测试、`capability-catalog.sh`、`select-static-checks-for-touches.ts`、`archive/`）；**且**
3. **有测试以子进程方式 spawn 它**（`spawnSync("node", [ … scripts/<name>.ts … ])`）——这是"它曾经是给人/给编排跑的入口"的物证。

**只满足 1+2 而 3 不满足者 ⇒ 判为「库上的防御性守卫」，不属本任务范围**（不得删除，可另立观察项）。

**处置（对判为死面的文件）＝ 退入口、留模块**：

- 删除 `usage` 常量 + `main()` + `isDirectEntry` 守卫，以及**仅为入口所用**的 import（如 `gate-script-base.ts` 的 `isDirectEntry` / `helpExit`——须确认模块面不再需要）。
- **保留**全部 `export`（`buildMirrorState` / `writeMirrorState` / `shouldSkipMirrorWrite` / `readCurrentState`）与文件头注释。
- 把该文件在 `select-static-checks-for-touches.ts` 的 `FAN_IN_ORCHESTRATION_FILES` 条目与 `capability-catalog.sh` 的对应行**改为如实描述**（"模块库，无 CLI 入口"）。⛔ **不得留一条声称存在调用者的「谁按」行**——那正是 `gap-mirror-measure-history-retire-dead-writer` 里 `:1946` 的缺陷形态。
- **它的测试须同步改造**：`plugin/test/mirror-full-suite-state.test.mjs:123` 用 `spawnSync` 跑 CLI（用例名 "AC1 — a running on-disk state makes the CLI mirror SKIP"）。退掉入口后该用例改为**进程内调用**（import `writeMirrorState` / `shouldSkipMirrorWrite`）或删除。⛔ 不得留一条 spawn 已删入口的用例（会让套件红），**更不得**把它改成"断言文件不存在"这种恒真/恒假断言（硬规则 3b）。

**⛔ 明确不在范围**：

- 模块本体任何 `export` 的行为。
- `pre-verified-round-record.ts`（**`:496` 活调用**，见（三））。
- 16 个孤岛中判为"防御性守卫"的那些。

## AC

- [ ] AC1（兄弟集测量，先做）：复现上述扫描（对含 `isDirectEntry(import.meta` 的脚本逐个查真调用者），把 16 个孤岛**逐个**按 Contract 的三条判别式分类为「死 CLI 入口面 / 库上的防御性守卫」，**贴出每个的判定证据**（守卫行号 + 入口行号 + 是否有 spawn 它的测试 + 真调用者 grep 输出）。⛔ 不得只贴结论。
- [ ] AC2（负控制，硬规则 4 推论四）：对**至少一个**判为"防御性守卫"的样本（建议 `touches-parser.ts`——它确实是纯库）给出"若它其实是死入口，结论会不同"的对照读数，即说明它为何落到另一格；贴命令与输出。
- [ ] AC3：`pre-verified-round-record.ts` **不动**，并在任务体记明理由 + `fan-in-execute.js:496` 的调用现场（防止后来者"顺手把同族删干净"）。跑 `node --test plugin/test/pre-verified-round-record.test.mjs` 仍绿。
- [ ] AC4：`mirror-full-suite-state.ts` 退入口留模块——删 `usage` / `main()` / `isDirectEntry` 守卫及入口专用 import；4 个 `export` 保持签名不变。贴 `git diff`。
- [ ] AC5：`plugin/test/mirror-full-suite-state.test.mjs:123` 的 spawn 用例改为进程内调用或删除；**删后不得留下恒真/恒假断言**。跑 `node --test plugin/test/mirror-full-suite-state.test.mjs` 绿。
- [ ] AC6：`capability-catalog.sh` + `select-static-checks-for-touches.ts` 中该文件的登记/清单行改为"模块库，无 CLI 入口"的如实描述；跑 `node --test plugin/test/capability-catalog.test.mjs plugin/test/select-static-checks-for-touches.test.mjs` 绿。
- [ ] AC7：`bash scripts/test.sh` 全量绿；命令与结果贴进任务体。

## DoD

- **退入口**：`grep -c 'isDirectEntry\|export function main' plugin/scripts/mirror-full-suite-state.ts` → **0**。
- **留模块**：`grep -cE '^export function (buildMirrorState|writeMirrorState|shouldSkipMirrorWrite|readCurrentState)' plugin/scripts/mirror-full-suite-state.ts` → **4**。
- **无残留 spawn**：`grep -c 'spawnSync' plugin/test/mirror-full-suite-state.test.mjs` → **0**。
- **反例对照**：`node --test plugin/test/pre-verified-round-record.test.mjs` 仍绿（证明"退一个"没有波及活着的同族）。
- `bash scripts/test.sh` 一次真实全量绿的命令与结果贴进任务体。

## Touches

- plugin/scripts/mirror-full-suite-state.ts（退 CLI 入口面，留模块）
- plugin/test/mirror-full-suite-state.test.mjs
- plugin/scripts/capability-catalog.sh
- plugin/scripts/select-static-checks-for-touches.ts
- tasks/gap-mirror-full-suite-state-retire-dead-cli-face.md