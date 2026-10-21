---
id: gap-ac912-criterion-discriminates-shim-deletion
title: AC-912 判据的可证伪性载体：只抹头注释的树必须 AC-911 绿 / AC-912 红（逐字执行 shipped criterion + 区分性负控）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-912
---
## Proposal

**机械事实（2026-10-21，cwd=git 根，本轮实测）**：

1. 10 个具名内部 shim **已经真的从树里删除**（`fb1c1a240` "refactor(core): delete 10 src-root forwarding shims; repoint all consumers to src/core (AC-911)"；任务 `gap-ac911-src-root-forwarding-shim-deletion` 已 done）。今天 `packages/quay/src` 根只有 `abi.ts` / `config.ts` 带 `FORWARDING re-export` 头注释，10 个具名文件全部 `test -e` 为假。
2. AC-912 的 criterion 逐字在真树跑：`OK: 10 internal shims deleted`，exit 0（cwd=git 根）。
3. **AC-912 的区分力今天只在会话里手跑过一次，仓库里没有任何载体**。把 10 个文件按删除前的形态恢复（`export * from "./core/<name>.ts";`，**不带头注释**）、`abi.ts`/`config.ts` 原样保留，得到一棵「只抹注释、文件仍在原处继续转发」的树（实测 `header-bearing=2`）：
   - AC-911 的 criterion 逐字跑 ⇒ **exit 0**，`OK: src-root shim count = 2`（绿）；
   - AC-912 的 criterion 逐字跑 ⇒ **exit 1**，`internal shims still present: adr-store branch-model contract-validator criterion-fidelity document-store frontmatter-store-base goal-store plugin-root store-commit worktree-namespace`（红，逐名 10 个）。
   这正是 AC-912 `expect` 声称的区分（「在 AC-911 下却已绿」），但没有任何测试/棘轮把它固化——它目前只是散文。
4. 全库 `goal_ac: AC-912` 零命中；机制关键词（src-root / `FORWARDING re-export` / shim / 负控 / 可证伪）检索无同机制 open 任务。`plugin/scripts/import-graph-check.ts` 的 `RETIRED_SRC_ROOT_SHIMS` 棘轮（`plugin/test/import-graph-check.test.mjs`）测的是**复活**（文件重现 / 活 import），它不执行 AC-911/AC-912 的 criterion 文本，也不覆盖「只抹注释」的 AC-911-绿/AC-912-红 区分。

<!-- dedup-ref -->
**相关但不同机制（traceability）**：`gap-ac911-src-root-forwarding-shim-deletion`（done）负责删文件并加复活棘轮；`gap-goal907-add-exit-conditions`（done）负责把退出条件②写进 GOAL body。本任务只固化 AC-912 criterion 的**可证伪性载体**，不删任何文件、不改 AC/GOAL 状态、不退役 AC-911（是否退役 AC-911 仍是人的决定，见 AC-912 的 origin）。

**为什么立案**：AC-912 现已 active，但没有任何任务声明 `goal_ac: AC-912`，而它的 expect 里最要紧的一句（只删注释的树在 AC-912 下仍红、在 AC-911 下已绿）只以散文存在。按硬规则 4（散文会被改写掉），并用仓库既有先例 `packages/quay/test/ac354-negative-control-falsifiable.test.mjs`（逐字提取 shipped criterion 并双向执行），它需要自己的耐久载体。

## Plan

1. 新增 `packages/quay/test/ac912-criterion-discriminates-shim-deletion.test.mjs`（`// @test-group product`），**被测对象是 shipped criterion 文本，不是它的复写**：从 `goals/AC-912-*.md` 与 `goals/AC-911-*.md` 的 YAML frontmatter 读回 `criterion` 字符串（按 id 前缀定位文件；文件缺失 ⇒ 断言失败，不跳过）。同时断言提取文本逐字含 AC-912 的 `for m in adr-store … worktree-namespace` 列表与 AC-911 的 `grep -rln 'FORWARDING re-export'`，防止未来判据被改成别的形状后测试空转。
2. **Arm A（生产载体）**：在真树 `REPO` 上执行 AC-912 的 shipped criterion ⇒ exit 0 且 stdout 含 `OK: 10 internal shims deleted`；同时 `fs.existsSync` 对 10 个 `packages/quay/src/<name>.ts` 逐个为 false。这条保证绿读数来自**真树**，不是夹具（硬规则 4 推论三）。
3. **Arm B（区分性负控，本任务核心）**：在 `mkdtemp` 的 scratch root 里建 `packages/quay/src/`：10 个 `<name>.ts` 写成删除前的转发形态（`export * from "./core/<name>.ts";`，**无** `FORWARDING re-export` 头注释——不依赖历史 commit，避免 `fb1c1a240^` 这类可被 shallow/改写影响的锚），`abi.ts`/`config.ts` 从真树复制（保留头注释）。断言同一次运行内：头注释文件数=2；AC-911 shipped criterion exit 0（读数 `src-root shim count = 2`）；AC-912 shipped criterion exit 1，且 stderr 逐名 10 个、顺序固定。
4. **Arm C（空转守卫 / mutation）**：对提取出的 AC-912 criterion 文本做一处定向 mutation——从 `for m in …` 列表移除 `adr-store`——断言 mutated 文本与 shipped 的 sha256 不同；在只含 `packages/quay/src/adr-store.ts` 的 scratch root 上，shipped criterion exit 1 并点名 `adr-store`，mutated criterion exit 0。⇒ 提取/执行环节失效时不能与「通过」同形（硬规则 3b）。
5. 跑 `node --experimental-strip-types --test packages/quay/test/ac912-criterion-discriminates-shim-deletion.test.mjs`，再跑 scoped gate。不改 `packages/quay/src`，不改两个 goal record 的 criterion（除非 Arm B 真的揭示判据本身有缺陷——那种情况在任务体记录缺陷并修 criterion，而不是绕过）。

## AC

- [x] AC1 新测试文件存在且 `node --experimental-strip-types --test packages/quay/test/ac912-criterion-discriminates-shim-deletion.test.mjs` exit 0；测试从 `goals/AC-912-*.md` 与 `goals/AC-911-*.md` 的 frontmatter **逐字**读回 criterion（缺失即失败，不跳过），并断言两份文本分别含 10 名列表与 `grep -rln 'FORWARDING re-export'`
- [x] AC2（生产载体）同一测试在真树 `REPO` 上执行 AC-912 shipped criterion，断言 exit 0、stdout 含 `OK: 10 internal shims deleted`，且 10 个 `packages/quay/src/<name>.ts` 的 `fs.existsSync` 全为 false（绿读数来自生产树，不是夹具）
- [x] AC3（区分性负控）同一测试构造只抹头注释的 scratch 树（10 个无头注释的转发文件 + 完整的 abi/config），断言头注释文件数=2、AC-911 shipped criterion exit 0（读数 2）、AC-912 shipped criterion exit 1 且 stderr 逐名 10 个；两条读数在同一次运行里同时成立
- [x] AC4（空转守卫）同一测试对 AC-912 criterion 做定向 mutation（从 `for m in …` 移除 `adr-store`），断言 sha256 改变；在只含 `adr-store.ts` 的 scratch 树上 shipped 判据 exit 1 点名 `adr-store`、mutated 判据 exit 0
- [x] AC5 `bash scripts/test.sh --for-task gap-ac912-criterion-discriminates-shim-deletion --allow-thin` exit 0（scoped gate，实测读数贴进任务体）

## DoD

`packages/quay/test/ac912-criterion-discriminates-shim-deletion.test.mjs` 真的落在树里，并且**执行的是 `goals/AC-912-*.md` / `goals/AC-911-*.md` 里 shipped 的 criterion 文本**：真树读数 exit 0；只抹头注释的树读数 AC-911 exit 0（2）/ AC-912 exit 1（逐名 10 个）——两者在同一次运行里同时成立。用手工改 `goals/AC-912-*.md` 的 criterion（例如从列表删掉 `adr-store`）后测试**实际变红**、恢复后变绿，这个双向操作跑过一次并记录 sha256/exit（DIR-026 Reading A：对象是判据文本本身，真的被操作过，不是「测试存在」）。`npx tsc --noEmit` 与 scoped gate 全绿；fan-in 步骤跑全量 suite。不改 `packages/quay/src`、不改 AC-911/AC-912 的 status、不退役 AC-911。

⛔ 不算达成：在测试里把判据重新实现一遍（回声，不是测量 shipped 文本）；只在 scratch 树上断言而真树读数缺席；把两棵树的期望写成布尔常量而不实际执行 criterion；把 AC-911 的判据复制成测试内常量而不从 goal record 读回。

## Evidence

**实现**：`packages/quay/test/ac912-criterion-discriminates-shim-deletion.test.mjs`（commit `032980cdf`，`// @test-group product`，4 个 `node:test` test）。被测对象是从 `goals/AC-91{1,2}-*.md` frontmatter 解析回的 `criterion` 字符串，用 `/bin/sh -c <text>` 在目标 cwd 执行——**测试内没有任何判据复写**；判据文本与期望都由 goal record 决定。

**AC1** 裸跑：exit 0，`ℹ tests 4 / ℹ pass 4 / ℹ fail 0`。第一个 test 断言 AC-912 文本含 `for m in adr-store branch-model … worktree-namespace; do`（**10 名齐全、顺序固定**）、`[ -e "packages/quay/src/$m.ts" ]`、`OK: 10 internal shims deleted`；AC-911 文本含 `grep -rln 'FORWARDING re-export' packages/quay/src/*.ts`、`OK: src-root shim count = 2`；两者 sha256 互异。goal 文件缺失 / `criterion` 非字符串 ⇒ `assert` 失败（不 skip —— 硬规则 3b）。

**AC2（arm A，生产载体）** 在 `REPO`（本 worktree）跑 shipped AC-912 ⇒ exit **0**，stdout `OK: 10 internal shims deleted`；`fs.existsSync` 对 10 个 `packages/quay/src/<name>.ts` 全 **false**，且 `abi.ts`/`config.ts` 仍在。

**AC3（arm B，区分性负控）** `mkdtemp` scratch root：10 个无头注释转发文件 + 从真树复制的 `abi.ts`/`config.ts`。同一次 test 内实测：

- 头注释文件数（直接读盘，不经 AC-911）= **2**
- shipped AC-911 ⇒ exit **0**，stdout `OK: src-root shim count = 2`
- shipped AC-912 ⇒ exit **1**，stderr 逐字为 `internal shims still present: adr-store branch-model contract-validator criterion-fidelity document-store frontmatter-store-base goal-store plugin-root store-commit worktree-namespace`

**AC4（arm C，空转守卫）** mutation = `for m in adr-store ` → `for m in `（anchor 命中数断言 =1；改后 sha256 不同）。只含 `packages/quay/src/adr-store.ts` 的 scratch root 上：shipped ⇒ exit **1** 且 stderr 恰为 `internal shims still present: adr-store`；mutated ⇒ exit **0** 且 stdout `OK: 10 internal shims deleted`。

**DoD 双向操作（对象是判据文本本身，DIR-026 Reading A）**：

| 步骤 | `goals/AC-912-*.md` sha256 | test exit | 读数 |
|---|---|---|---|
| 原始 | `484804bfbdc6a14e35f6bf61b40fda7410965909c08e610e353caf1bb511963c` | 0 | 4/4 pass |
| 手工从 `for m in` 列表删掉 `adr-store` | `b4f100e20d8a55bdc85b4f3fdcb2c06054953ec35c7c62bb881810b1521ca60c` | 1 | 3/4 fail（arm A 仍绿是对的——真树上那些文件确实不存在；红的是提取形状断言 + arm B + arm C） |
| 从备份恢复 | `484804bfbdc6a14e35f6bf61b40fda7410965909c08e610e353caf1bb511963c`（与原**字节相同**，已 diff 校验） | 0 | 4/4 pass |

**AC5（scoped gate）** `bash scripts/test.sh --for-task gap-ac912-criterion-discriminates-shim-deletion --allow-thin` ⇒ **exit 0**。scoped 静态检查全 PASS：`tmp-leak-pairing-check`（1023 file / 0 unpaired）、`test-framework-policy-check`（1023 glob / 33 exemption，PASS）、`test-isolation-check`（21 条全 baselined）、`checked-in-write-check`（PASS）、`import-graph-check`（valueSccs=0 / typeSccs=0 / reverseEdges=0）、`task-contract-check` / `malformed-task-check` / `touches-one-entry-one-path-check` / `landing-target-check` / `test-group-downgrade-check` 均 PASS；随后本文件 4/4 pass。

**其它**：`npx tsc --noEmit` ⇒ exit 0。anti-drift Touches（`--merge-target develop`）⇒ `ANTI-DRIFT OK: 1 actual file(s), all within declared Touches (3 glob(s))`。未改 `packages/quay/src`、未改 AC-911/AC-912 的 status（AC-911 仍 `achieved`、AC-912 仍 `active`）、未退役 AC-911。

## Touches

- packages/quay/test/ac912-criterion-discriminates-shim-deletion.test.mjs
- goals/AC-912-goal-907-退出条件②-需要自己的可跑判据-10-个具名内部-shim-必须真的从-packages-quay-s.md
- tasks/gap-ac912-criterion-discriminates-shim-deletion.md
