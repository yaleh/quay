---
id: gap-ac911-src-root-forwarding-shim-deletion
title: AC-911 src 根 FORWARDING shim 12→2：删 10 个内部 shim、全部消费方改指 core/，并加「已删 shim
  复活=违规」棘轮
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-911
---
## Proposal

**机械事实（立案当轮实测，cwd=git 根）**：`packages/quay/src/*.ts` 根下 12 个文件首部带 `FORWARDING re-export` 注释，正文只有一行 `export * from "./core/<name>.ts";`（abi.ts / config.ts 留作公开 ABI 面，其余 10 个是 `gap-src-root-gate-cycle-break` 迁移留下的内部缝）。AC-911 现在的读数是 **12**：

```
$ grep -rln 'FORWARDING re-export' packages/quay/src/*.ts | wc -l
12
```

**这 10 个 shim 的消费方不止 import（实测分类，全部已落进 `## Touches`）**：

1. **静态 import / re-export**：75 个代码文件——`packages/quay/src` 内部（serve-*/cli/meta-store/observation/…）、`packages/quay-native`（深相对路径 `../../quay/src/<x>.ts`，以及裸子路径 `quay/adr-store` / `quay/document-store` / `quay/contract-validator`）、`plugin/scripts`（driver-runtime / worker-driver / worker-fan-in / criterion-failure-attribution-check / measure-trend-check / worktree-process-reaper / anti-drift-touches-check / target-identity-literal-check）、以及 `packages/quay/test` + `plugin/test` 的测试。
2. **动态 import**：`plugin/scripts/fast-mode-telemetry.ts:117` 的 `() => import("../../packages/quay/src/worktree-namespace.ts")`。
3. **从不走 import 的路径字面量**：把 shim 当 **CLI 入口 spawn** 的测试——`packages/quay/test/goal-store.test.mjs` 约 20 处 `new URL("../src/goal-store.ts", import.meta.url).pathname`、`goal-criterion-timeout-resolution.test.mjs`、`goal-born-draft-zero-ac-gate.test.mjs`、`plugin/test/goal-driver-s07.test.mjs`、`goal-activation-requires-ac.test.mjs`、`goal-create-as-active-requires-ac.test.mjs`、`criterion-fidelity-gate.test.mjs`、`criterion-fidelity-default-wiring.test.mjs`、`helpers/goal-driver-harness.mjs`、`goal-driver-criterion-worktree.test.mjs`；以及真树存在性断言 `fs.existsSync(<real>/packages/quay/src/goal-store.ts)`（`plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs:133`）。`core/goal-store.ts` 本身是可用 CLI（`isDirectEntry` 以 `argv[1].endsWith("goal-store.ts")` 判定，实测 `node --experimental-strip-types packages/quay/src/core/goal-store.ts list --root <tmp>` exit 0），因此这些 spawn 改路径即可，行为不变。
4. **包 exports 映射**：`packages/quay/package.json` 的 `./adr-store` / `./document-store` / `./contract-validator` 三个子路径 target 直指将被删除的文件。`packages/quay/test/package-json-bin.test.mjs` 只要求 target 匹配 `^\./src/.*\.ts$` 且不含 `dist`，所以改到 `./src/core/...` 仍合规，⛔ 不得指向 `dist/`（该测试的注释记录了「repoint 到 dist = 已否决设计」）。
5. **goal criterion 文本**：31 个 `goals/AC-*.md` 的 `criterion` 里出现这些路径；它们**全部**是 achieved/retired/superseded，且所属 GOAL 全部 achieved。`inAchievedReverifyScope` = 活跃 GOAL ∨ `longTerm`，本仓库零 `longTerm: true` ⇒ 这些判据**不会被重新求值**。但其中被 `packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` 的「quoted whole-token `.ts` path literal」机械类点名的（预期 **AC-196 / AC-216 / AC-347**）必须同批重锚；AC-196 另有一条 verbatim 夹具（`packages/quay/test/ac196-criterion-four-state-vocabulary.test.mjs:104` 的 `fs.copyFileSync(path.join(REPO, rel), dst)`）会直接物化已删 shim ⇒ 必然变红。

**两个 worktree 陷阱（不知道就会拿到假绿）**：

- **bare specifier 读主检出**：任务 worktree 的 `node_modules` 是指向主检出 `node_modules` 的符号链接，而 `node_modules/quay -> ../packages/quay` 相对主检出解析 ⇒ worktree 里 `import "quay/adr-store"` 读的是**主检出**的 `package.json` 与源码。bare-specifier 测试绿**不是** worktree 改动生效的证据。exports 是否可用，改为直接读 **worktree 的** `packages/quay/package.json` + `fs.existsSync(path.join("packages/quay", target))` 判定。
- **tsc 覆盖 quay-native 深路径**：根 `tsconfig.json` 的 `include` 覆盖 `packages/**/src/**/*.ts`，所以 `packages/quay-native/src/*.ts` 的深相对 import 在 `npx tsc --noEmit` 下被检查；只扫 `packages/quay/src` 的消费方清单会漏掉它。

**机制方向**：删除 10 个转发面 → 每个模块在图上只剩一条到达路径（`core/<name>.ts`）；`abi.ts` / `config.ts` 保持公开面；用 `import-graph-check` 加一条**位置判定**的棘轮，禁止已删路径复活（文件重现，或任何 `import`/`export … from` 指向该路径）。

<!-- dedup-ref -->
**去重与粒度**：全库 `goal_ac: AC-911` 零命中；机制关键词（shim / `FORWARDING re-export` / src-root）检索没有 open 任务。相关但不同机制：`gap-src-root-gate-cycle-break`（done）是这 12 个 shim 的**成因**（它把实现下沉 `core/` 并留下转发面），本任务删除其中 10 个转发面。`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches … --json` 的 `peers: []`。决定：**separate**（独立验收 = AC-911 的计数判据）。

**非目标**：`abi.ts` / `config.ts` 不动；`packages/quay/src/core/**` 的实现不改；除机械判据点名的 3 条外，achieved goal criterion 的历史文本不改写（理由：不在复验域，见上）；`plugin/test/*` 里把这些路径当**合成夹具数据**的地方不动（`architecture-decision-memory.test.mjs`、`routine-file-gate.test.mjs`、`kernel-sibling-resolution-check.test.mjs` 的 fixture、`plugin/test/fixtures/criterion-fidelity/*.ts` 等——它们不读真文件）；`docs/**` 历史记录不改写；`packages/quay/dist/**`、`plugin/vendor/**` 是未跟踪的构建产物，不在此任务内重建。

## Plan

1. **机械枚举（先分类再动手）**：`for m in adr-store branch-model contract-validator criterion-fidelity document-store frontmatter-store-base goal-store plugin-root store-commit worktree-namespace; do grep -rn --include='*.ts' --include='*.mjs' --include='*.js' -E "from ['\"][^'\"]*$m(\.ts)?['\"]" packages plugin scripts; done` 去掉 `/core/` 命中；再补三类 grep：动态 `import(`、`new URL(...)` / `path.join(...src...)` 字面量、`package.json` exports。`## Touches` 已是本轮实测并集（103 项），实现时若发现新消费方，**先用 `task_write` 把该文件加进 Touches 再改它**（`anti-drift-touches-check` 读 worktree 的任务副本；改动落 `author` 时按需先 `git merge --no-edit develop` 进 worktree）。
2. **改指 core/（imports）**：静态 import / `export … from` / 动态 import 的 specifier 一律 `src/<name>.ts` → `src/core/<name>.ts`（相对形式按所在目录调整）。三类路径形态都要覆盖：`./x.ts` (src 根)、`../x.ts` (子目录)、`../../packages/quay/src/x.ts` 与 `../../quay/src/x.ts` (plugin/scripts 与 quay-native)，以及裸子路径 `quay/adr-store`（见步骤 4，specifier 本身不改）。
3. **改指 core/（路径字面量）**：把所有**真读/真 spawn** 的路径字面量改到 `core/`——重点 `packages/quay/test/goal-store.test.mjs`（约 20 处 `new URL`）、`goal-criterion-timeout-resolution.test.mjs`、`goal-born-draft-zero-ac-gate.test.mjs`、`plugin-root.test.mjs`、`plugin/test/goal-driver-s07.test.mjs`、`goal-activation-requires-ac.test.mjs`、`goal-create-as-active-requires-ac.test.mjs`、`criterion-fidelity-gate.test.mjs`、`criterion-fidelity-default-wiring.test.mjs`、`helpers/goal-driver-harness.mjs`、`goal-driver-criterion-worktree.test.mjs`、`driver-resolves-code-root-separate-from-workspace.test.mjs`。⛔ `driver-resolves-code-root…` 只需改**对着真仓库**的断言/解析（:133 附近）；它自己 `fs.writeFileSync` 出来的合成树里用 `"goal-store.ts"` 作 rel 是布局夹具，可保留。`goal-store.test.mjs:583-585` 对 `packages/quay-native/src/goal-store.ts` 的断言要继续成立，但转发目标改成 `quay/src/core/goal-store.ts`。
4. **exports map**：`packages/quay/package.json` 的 `./adr-store` / `./document-store` / `./contract-validator` target 改为 `./src/core/<name>.ts`；键集合不变（`package-json-bin.test.mjs` 双向钉住），⛔ 不指向 `dist/`。
5. **重锚被机械判据点名的 goal criterion**（用 goal-store CLI 在 **worktree 根**上写，`--root`/cwd 指向 worktree，勿经 MCP——MCP 落主检出）：
   - `goals/AC-216-*.md`：Python 一行里的 `"packages/quay/src/goal-store.ts"` → `"packages/quay/src/core/goal-store.ts"`，其余不动。
   - `goals/AC-347-*.md`：把「src 根转发面存在且转发」的断言重锚到**规范模块** `packages/quay/src/core/criterion-fidelity.ts`；保留 `kernel/verdict-parse.ts` 提供 `parseBinaryVerdict`、两个旧函数是薄包装的结构保证。`expect:` 里过期的「src root still forwards」叙述同批更新。
   - `goals/AC-196-*.md`：删掉「① src 根 import surface 存在且转发」这一维（GOAL-907 退役该中间态），保留 ② 规范模块存在 ③ 四态词表从 `CommitOutcome` 声明块读出 ④ 已退休 boolean helper 计数为 0；`expect:` 同步。
   - 同批改 `packages/quay/test/ac196-criterion-four-state-vocabulary.test.mjs`：删 `SHIM` 常量与它的 `copyFileSync`，原「forwarding surface stops forwarding」负控制替换为**另一种结构性负控制**（如规范模块缺失/改名），保证仍有 ≥4 条彼此可区分的 `CAUSE=` 断言，⛔ 不靠减少负控制来变绿。
   - 以 `node --experimental-strip-types --test packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` 的重跑结果为准：它点名谁就重锚谁（预期即上面 3 条）。未点名的 achieved criterion 保持历史文本（不在复验域，见 Proposal 第 5 点）。
6. **删除 10 个 shim**：`git rm packages/quay/src/{adr-store,branch-model,contract-validator,criterion-fidelity,document-store,frontmatter-store-base,goal-store,plugin-root,store-commit,worktree-namespace}.ts`。删后立刻跑步骤 9 的第一批检查。
7. **加棘轮**：在 `plugin/scripts/import-graph-check.ts` 增加第五类读数 `retiredSrcRootShims`（常量列表 = 上面 10 条 repo 相对路径）：
   - `retiredShimHits: [{path, line?, kind: "file"|"import"}]`——`kind:"file"` = 该路径重新出现在 `git ls-files`；`kind:"import"` = 任一**真实 import/export 语句**（按位置，复用既有 `buildNonCodeMask`；注释/字符串不算）的 specifier 规范化后等于该路径。
   - `retiredShimsChecked: true`（列表是静态的，不存在「没查」态）；`judge()` 把 `retiredShimHits.length > 0` 并入 `ok`；`--json` 输出该字段；`--selftest` 增加双向用例。
   - `plugin/test/import-graph-check.test.mjs` 增加两条真树夹具：(a) 文件被放回 ⇒ exit 1 且点名；(b) `import x from "./goal-store.ts"` 指向已删路径 ⇒ exit 1；干净夹具 ⇒ exit 0；注释里提到该路径 ⇒ 不报（位置判定）。
8. **同批更新会因删除而失真的声明/探针**：`plugin/scripts/capability-catalog-declarations.json` 里 `worktree-namespace-literal-check.ts` 的两处 `packages/quay/src/worktree-namespace.ts` → `packages/quay/src/core/worktree-namespace.ts`；`scripts/goal-032-selfhost-probe.mjs` 中 `criterion-fidelity` 的 after-tree 锚点 → `packages/quay/src/core/criterion-fidelity.ts`（保留其 before-ref 侧不变）。
9. **验证顺序**：`npx tsc --noEmit` → 逐文件测试（步骤 9 列的命令）→ `scripts/test.sh --for-task <本任务 id> --allow-thin`。全量 suite 由 fan-in 步机械执行。

## AC

- [ ] AC-911 判据逐字 exit 0（cwd=git 根）：`n=$(grep -rln 'FORWARDING re-export' packages/quay/src/*.ts | wc -l); if [ "$n" -ne 2 ]; then echo "src-root shim count is $n (want 2: abi.ts + config.ts)" >&2; exit 1; fi; echo "OK"` —— 并在任务体贴出 `grep -rln …` 的两个文件名（必须恰为 `abi.ts` 与 `config.ts`）
- [ ] 反向（能取假）实跑并贴两次读数：临时把 `packages/quay/src/core/branch-model.ts` 按 shim 形态复制为 `packages/quay/src/branch-model.ts`（首行含 `FORWARDING re-export`）⇒ 同一判据 **exit 1** 且 stderr 为 `src-root shim count is 3 (want 2: abi.ts + config.ts)`；删除该临时文件后同一判据 **exit 0**
- [ ] 10 个被删文件逐个不存在：`for f in adr-store branch-model contract-validator criterion-fidelity document-store frontmatter-store-base goal-store plugin-root store-commit worktree-namespace; do test ! -e "packages/quay/src/$f.ts" || { echo "still exists: $f"; exit 1; }; done` exit 0
- [ ] `npx tsc --noEmit` exit 0（根 tsconfig 覆盖 `packages/**/src/**/*.ts`，含 quay-native 深相对消费方）
- [ ] `node --experimental-strip-types --test packages/quay/test/goal-criterion-import-specifiers-resolve.test.mjs` exit 0（**删除之后**仍绿 ⇒ 被 quoted-path-literal 类点名的 goal criterion 已重锚）
- [ ] `node --experimental-strip-types --test packages/quay/test/ac196-criterion-four-state-vocabulary.test.mjs` exit 0（其 verbatim 夹具不再物化已删 shim，且四态词表/退休 helper 的结构断言未被削弱）
- [ ] 棘轮读数：`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` exit 0，且 JSON 中 `retiredShimHits` 为 `[]`、`retiredShimsChecked` 为 `true`；`node --experimental-strip-types plugin/scripts/import-graph-check.ts --selftest` exit 0
- [ ] 棘轮能取假（双向，贴读数）：`node --experimental-strip-types --test plugin/test/import-graph-check.test.mjs` exit 0，其中新增夹具 (a) 已删 shim 文件重现 ⇒ checker exit 1 且点名该路径，(b) `import … from "./goal-store.ts"` 指向已删路径 ⇒ exit 1，干净树 ⇒ exit 0，仅注释提及 ⇒ 不报
- [ ] exports 目标在 **worktree 内**存在：`node -e 'const fs=require("fs"),p=require("./packages/quay/package.json"); for (const k of ["./adr-store","./document-store","./contract-validator"]) { const t=p.exports[k]; if(!/^\.\/src\/.*\.ts$/.test(t)||!fs.existsSync("packages/quay/"+t.replace(/^\.\//,""))) { console.error(k,t); process.exit(1);} }'` exit 0（⛔ 不以 worktree 里的 bare-specifier import 判定——它解析到主检出）
- [ ] `bash scripts/test.sh --for-task gap-ac911-src-root-forwarding-shim-deletion --allow-thin` exit 0

## DoD

`packages/quay/src` 根下的 `FORWARDING re-export` 文件由 12 个降为 **2** 个（`abi.ts` + `config.ts`），其余 10 个文件**真的被删除**（`git ls-files` 里不再有它们），并且**所有**此前的消费方——静态/动态 import、把 shim 当 CLI 入口 spawn 的测试、`packages/quay/package.json` 的三个子路径、以及被机械判据点名的 goal criterion——都改指 `packages/quay/src/core/<name>.ts`；`npx tsc --noEmit` 与 scoped gate 全绿，全量 suite 由 fan-in 步跑绿。`import-graph-check` 新增的 `retiredSrcRootShims` 棘轮在**真树**上读数为 0，并在夹具注入下 exit 1（能取假，不是回声）。`goal-driver` 下一轮把 AC-911 的 verdict 由 fail 翻 pass（读 `.quay/goal-round.jsonl` 该 AC 的 verdict）。

⛔ 不算达成：只删文件而留下任何一个指向已删路径的 import/spawn；靠把 `package-json-bin.test.mjs` 的 `^\./src/.*\.ts$` 放宽或把 exports 指向 `dist/` 来变绿；棘轮只由测试内的重实现断言、未读真树；AC-196 的四态/退休-helper 结构保证被顺手削弱；把 achieved goal criterion 全部改写一遍（非目标）。

## Touches

- goals/AC-196-not-in-git-unchanged-boolean-0.md
- goals/AC-216-长期保证-ac-的复验域不随-goal-关闭而消失-达成即停止复验会让-上移一层-变成换层藏同一缺陷.md
- goals/AC-347-结构与范围护栏-kernel-verdict-parse-ts-提供-parsebinaryverdict-两个旧函数薄.md
- packages/quay-native/bin/quay-native.ts
- packages/quay-native/src/goal-store.ts
- packages/quay-native/src/mcp-server.ts
- packages/quay-native/src/store.ts
- packages/quay/package.json
- packages/quay/src/adr-store.ts
- packages/quay/src/branch-model.ts
- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/init.ts
- packages/quay/src/cli/manager.ts
- packages/quay/src/contract-validator.ts
- packages/quay/src/criterion-fidelity.ts
- packages/quay/src/document-store.ts
- packages/quay/src/driver-control.ts
- packages/quay/src/fan-in/ff-merge.ts
- packages/quay/src/frontmatter-store-base.ts
- packages/quay/src/goal-merge.ts
- packages/quay/src/goal-preview.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/init.ts
- packages/quay/src/loaded-version.ts
- packages/quay/src/mcp-server.ts
- packages/quay/src/meta-store.ts
- packages/quay/src/observation.ts
- packages/quay/src/plugin-root.ts
- packages/quay/src/serve-doc.ts
- packages/quay/src/serve-render.ts
- packages/quay/src/serve-send.ts
- packages/quay/src/serve-sessions.ts
- packages/quay/src/store-commit.ts
- packages/quay/src/worktree-namespace.ts
- packages/quay/test/ac179-criterion-address-derivation.test.mjs
- packages/quay/test/ac196-criterion-four-state-vocabulary.test.mjs
- packages/quay/test/ac301-criterion-address-derivation.test.mjs
- packages/quay/test/ac326-criterion-branch-discard.test.mjs
- packages/quay/test/adr-gate.test.mjs
- packages/quay/test/adr-store.test.mjs
- packages/quay/test/branch-model.test.mjs
- packages/quay/test/contract-validator.test.mjs
- packages/quay/test/document-gate-fixture.test.mjs
- packages/quay/test/document-gate.test.mjs
- packages/quay/test/document-store.test.mjs
- packages/quay/test/frontmatter-store-base.test.mjs
- packages/quay/test/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs
- packages/quay/test/gap-frontmatter-slugify-drops-non-ascii.test.mjs
- packages/quay/test/gap-goal-list-no-evidence.test.mjs
- packages/quay/test/gap-goal-record-completeness-undefined.test.mjs
- packages/quay/test/gap-goal-status-stale-achieved-after-new-active-criterion-filed.test.mjs
- packages/quay/test/gap-webui-goal-detail-no-entity-links.test.mjs
- packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs
- packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs
- packages/quay/test/goal-born-draft-zero-ac-gate.test.mjs
- packages/quay/test/goal-criterion-timeout-resolution.test.mjs
- packages/quay/test/goal-gate.test.mjs
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/install-config-driven-e2e.test.mjs
- packages/quay/test/observation.test.mjs
- packages/quay/test/observation-worktree-namespace.test.mjs
- packages/quay/test/package-json-bin.test.mjs
- packages/quay/test/plugin-root.test.mjs
- packages/quay/test/store-commit.test.mjs
- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/criterion-failure-attribution-check.ts
- plugin/scripts/driver-runtime.ts
- plugin/scripts/fast-mode-telemetry.ts
- plugin/scripts/import-graph-check.ts
- plugin/scripts/measure-trend-check.ts
- plugin/scripts/target-identity-literal-check.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worktree-process-reaper.ts
- plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs
- plugin/test/ac272-rolling-channel-version-selfproof.test.mjs
- plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs
- plugin/test/active-ac-must-have-criterion.test.mjs
- plugin/test/anti-drift-touches-check.test.mjs
- plugin/test/conformance-target-fixture.test.mjs
- plugin/test/criterion-fidelity-default-wiring.test.mjs
- plugin/test/criterion-fidelity-gate.test.mjs
- plugin/test/criterion-fidelity-historical-case.test.mjs
- plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs
- plugin/test/errexit-abort-silent-exits-zero.test.mjs
- plugin/test/goal-activation-requires-ac.test.mjs
- plugin/test/goal-create-as-active-requires-ac.test.mjs
- plugin/test/goal-driver-criterion-worktree.test.mjs
- plugin/test/goal-driver-s07.test.mjs
- plugin/test/goal-invariants-standing.test.mjs
- plugin/test/goal-needs-human-blocking.test.mjs
- plugin/test/goal-standing-ac-reverify-scope.test.mjs
- plugin/test/goal-store-write-gate-criterion-attribution.test.mjs
- plugin/test/helpers/goal-driver-harness.mjs
- plugin/test/import-graph-check.test.mjs
- plugin/test/meta-driver.test.mjs
- plugin/test/ownership-active-limited-proposal.test.mjs
- plugin/test/worker-driver.test.mjs
- plugin/test/workflow-runner-self-hosted-check.test.mjs
- plugin/test/worktree-namespace-literal-check.test.mjs
- scripts/goal-032-selfhost-probe.mjs
- tasks/gap-ac911-src-root-forwarding-shim-deletion.md
