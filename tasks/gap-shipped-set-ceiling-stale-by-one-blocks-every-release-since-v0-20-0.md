---
id: gap-shipped-set-ceiling-stale-by-one-blocks-every-release-since-v0-20-0
title: shipped-set 体积上限停在 286，真实产物已是 287：v0.20.0、v0.21.0 的 release.yml 都被
  shipped-set-clean 拦下，按产物自身读数重新锚定
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：v0.21.0 发布事故（2026-10-20）。同一条断言在 v0.20.0（2026-10-16，run 38883031015）和 v0.21.0（2026-10-20，run 39449799348）上给出逐字相同的失败：`shipped-set-clean FAIL — files 287 > ceiling 286 (exceeds by 1)`，13 条断言 12 过 1 败。

**实测（2026-10-20/21）**：
- 两次构建产物的文件清单逐字相同（均 287 个），且本机用 release.yml step 5 的同一条命令（`bash plugin/scripts/publish-dist-branch.sh --branch <scratch>`，不带 `--push`）构建再 `git archive` 得到的也是 287 个，`shipped-set-rules.ts --check <dir> --size-ceiling` exit 1，与 CI 一致；
- 上次干净通过的 v0.19.0 是 266 个，之后增加 21 个：8 个 `scripts/dist/*.js` bundle（`deletion-closure-check`、`enum-surface-parity-check`、`experiment-manifest`、`guard-lineage-check`、`import-graph-check`、`judgment-consumer-check`、`suite-bucket-select`、`suite-load-sampler`）与 13 个 `docs/analysis/*`（架构分析与发现工具及其 prompt），无删除；
- 开发专用内容轴 `{"files":0,"bytes":0,"shLines":0}` 通过，所以这是**基线过期**，不是产物里混进了不该有的东西；`shLines` 与基线一致（7345），`bytes` 只报告不判（`SIZE_GATED_AXES = ["files","shLines"]`）；
- 当前 develop 上 `plugin/shipped-set-baseline.json` 的 `shipped` 仍是 `{"files":286,"bytes":61456361,"shLines":7345}`。

**机制**：体积上限在 10-14 被有意从每次推送的套件搬到发布门（`plugin/test/shipped-set.test.mjs` 注释：the guarantee moved to the release gate, it was not dropped），所以 fan-in 不会拦它，切版并推 tag 之后才第一次执行；而发布流程里没有任何一步负责重新锚定。release.yml 检出的是 `inputs.tag`，基线文件按 `findUp(moduleDir(), …)` 从该 tag 自己的树里读，所以只有在**切版之前**把新基线放进 develop 才对下一个 tag 生效。

**做法（规定的 CLI，不手改 JSON）**：
1. 在 worktree 里合并最新 develop，用 release.yml step 5 的同一条命令构建真实产物，`git archive` 到临时目录；
2. `node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --check <dir> --size-ceiling`，记录 before（预期 exit 1；以实测数字为准）；
3. `node --experimental-strip-types plugin/scripts/shipped-set-rules.ts --reanchor <dir> --why "<说明>"`；
4. 再跑一次 `--check <dir> --size-ceiling`，记录 after（要求 exit 0）。

**留意**：
- `_reanchorLog` 的 `why` 是手写文字，曾出现过文字里的数字与实际写入的数字不一致（"281 → 284 … +4" 而 281+4=285）导致下一次 fan-in 红灯，所以 `why` 里的前后文件数必须与同一条记录里机器写入的值逐一相等；
- 构建产物会往 worktree 里写 `plugin/scripts/dist/`、`plugin/gate-scripts/dist/`、`plugin/docs` 等，这些会让三个按整棵树扫描的静态检查变红（`task-file-bypass-check`、`worktree-namespace-literal-check`、`serve-binding-literal-check`）；取完证据后必须 `rm -rf` 这些目录与临时分支再跑 scoped gate，并在 Evidence 里写明已删除；
- 文件数上限是**精确值**：如果在本任务落地与下一次切版之间又有 shipped 文件进入 develop，需要用同样步骤再锚定一次，这正是另一条预检任务要让它在切版之前可见的原因；本任务不负责预检。

## AC

- [ ] AC0（before）：按上述步骤 1–2 构建真实产物并跑 `--check <dir> --size-ceiling`，把命令、exit 码与完整输出贴进 `## Evidence`
- [ ] AC1：按步骤 3 跑 `--reanchor <dir> --why "<说明>"`，把完整输出贴进 `## Evidence`
- [ ] AC2（after）：按步骤 4 对同一份产物目录再跑 `--check <dir> --size-ceiling`，exit 0，输出贴进 `## Evidence`
- [ ] AC3（改动面受控）：`git diff <合并后的 develop> -- plugin/shipped-set-baseline.json` 只包含 `shipped.files`、`shipped.bytes` 的变化与 `_reanchorLog` 末尾新增的恰好一条记录；顶层 `files`、`bytes`、`shLines` 仍为 0，`shipped.shLines` 仍为 7345；把 diff 贴进 `## Evidence`
- [ ] AC4（文字与数字一致）：新增 `_reanchorLog` 记录的 `why` 同时写出重新锚定前后的文件数，且这两个数与同一条记录里机器写入的前后值逐一相等，用一条一行脚本核对并把脚本与输出贴进 `## Evidence`
- [ ] AC5（不留构建残渣）：取完证据后已删除构建产物目录与临时分支，`git status --porcelain` 只剩 `plugin/shipped-set-baseline.json` 与本任务文件，scoped gate 通过；在 `## Evidence` 写明删除了哪些目录
- [ ] AC6（读生产载体）：下一次真实 release run 的 `verify-plugin-channel` 里 `shipped-set-clean` 为 PASS，贴 run id 与该行日志（待外部）

## DoD

真实落地：develop 上的 `plugin/shipped-set-baseline.json` 记录的 `shipped.files` 等于按 release.yml 同一条命令构建出的真实产物的文件数，`--check --size-ceiling` 在这份产物上 exit 0，且 `_reanchorLog` 里的说明与数字一致。⛔ 不得为使检查变绿而手改 JSON，也不得放宽 `SIZE_GATED_AXES`，也不得改动开发专用内容那三条轴。

## Touches

- plugin/shipped-set-baseline.json
- tasks/gap-shipped-set-ceiling-stale-by-one-blocks-every-release-since-v0-20-0.md
