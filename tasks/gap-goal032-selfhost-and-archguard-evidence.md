---
id: gap-goal032-selfhost-and-archguard-evidence
title: GOAL-032 ②：分支自举模块身份证明 + ArchGuard before/after 证据（duplicate group /
  canonical count / consumer convergence）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal032-verdict-parser-kernel-extraction
goal_ac: AC-348
---
**type:** execution

## Proposal

GOAL-032 的第二块：在任务①落地之后，在本 goal 的分支/worktree 上产出 AC-348 所需的证据。本次改动是纯函数重构（无新 driver/事件载体），因此**不复用 GOAL-030 的驱动进程沙盒级自举探针**（规模不匹配，GOAL-030 自己的 body 已写明"分支自举身份证明的规模应对应该 goal 的实际风险"）——改用规模相应缩小的**模块解析身份**核验：证明回归测试实际加载的是本分支 worktree 内的文件，不是主检出的旧副本。

## Plan

1. **模块解析身份证据**（`.quay/goal-032-evidence/selfhost-identity.json`）：在本任务的 worktree 内，写一小段探针——用 `import.meta.resolve` 或等价手段解析 `kernel/verdict-parse.ts`/`criterion-fidelity.ts`/`goal-driver.ts` 三者的 realpath，与当前 worktree 根目录比较，落盘 `{resolved: {...三个 realpath...}, worktreeRoot: <realpath>, allMatch: <boolean>}`。三者 realpath 都必须含子串 `goal-GOAL-032`（worktree 目录命名约定）。
2. **ArchGuard before/after 证据**（`.quay/goal-032-evidence/archguard-before-after.json`）：
   - before：对 `develop` 当前检出跑 ArchGuard `detect_duplicates`（确认该组仍命中，`duplicateGroupPresent: true`）+ `get_dependencies`/`get_package_metrics`（`criterion-fidelity.ts`/`goal-driver.ts` 各自 canonical 定义站点数 = 2，互不调用，`canonicalDefinitionCount` 此处指"两份独立实现"的计数口径，before 应为 2）。
   - after：对本 worktree（已含任务①的改动）跑同一组查询——`duplicateGroupPresent: false`（原重复组消失）、`canonicalDefinitionCount: 1`（kernel 一份实现）。
   - `consumerConvergenceEvidence`：至少两条，分别是 `criterion-fidelity.ts` 与 `goal-driver.ts` 调用 `parseBinaryVerdict` 的真实文本片段（grep 结果，不是推断）。
   - 落盘为 `{before: {...}, after: {...}, consumerConvergenceEvidence: [...]}`。
3. **import-graph-check 棘轮**：跑 `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json`，确认 `verdict.ok === true`（AC-347 已有的护栏在这里再核一遍，发现新回归就早发现）。
4. **语义层记录（facts / declared rules / judgment 三层分离，⛔ 不合并成一张表）**：在本任务的 Evidence 里分别记录——facts（ArchGuard 原始读数）、declared rules（kernel 边界检查器 `import-graph-check.ts` 的 pass/fail，非语义判断）、judgment（本任务对"这是否真收敛、不是搬壳"的结论陈述，引用任务①的负对照证据）。不要求跑 `archguard:arch-layer-review` skill（本次改动规模小，三层记录可由任务体直接承载，不强制走该 skill——若实现者判断跑一次更有说服力，可选择性跑，不作为 AC 硬性要求）。

## Acceptance Criteria

- [x] `.quay/goal-032-evidence/selfhost-identity.json` 存在，`allMatch === true` 且三个 realpath 均含子串 `goal-GOAL-032`
- [x] `.quay/goal-032-evidence/archguard-before-after.json` 存在，`before.duplicateGroupPresent === true`、`after.duplicateGroupPresent === false`、`after.canonicalDefinitionCount === 1`、`consumerConvergenceEvidence` 长度 ≥2
- [x] `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `verdict.ok === true`
- [x] facts/declaredRules/judgment 三层分离记录已写入本任务 `## Evidence`，三者不合并成一张表
- [x] 以上证据文件均已 `git add` 纳入本任务的提交（`.quay/` 若被 gitignore，改落盘到会被提交的路径，并同步更新 AC-348 criterion 里的路径引用——参照 GOAL-031 ②的先例处理方式）

## Definition of Done

两份证据文件落地且内容达标——`selfhost-identity.json` 的 `allMatch === true`、`archguard-before-after.json` 的 before/after 口径与 `consumerConvergenceEvidence` 均符合本任务 AC 的判定，AC-348 的判据能读到这些文件并判定为真。

## Evidence

实施形态：worktree `/data/home/yale/work/quay-worktrees/gap-goal032-selfhost-and-archguard-evidence`（分支 `task/gap-goal032-selfhost-and-archguard-evidence`，从 `goal/GOAL-032` @ `73640b18e` 开出；`dispatch-worktree-setup.sh --base goal/GOAL-032` 已 provision）。证据由 `scripts/goal-032-selfhost-probe.mjs` 一条命令生成（**exit 非 0 即"读数形状不对"，不会写出"已产出"**——探针把 before/after 的期望形状（组 true→false、计数 2→1、证据条数 ≥2）做成自己的退出码，不是事后另写断言）。实现提交：`97e2ad981`。

### facts（设备原始读数；不含任何语义判断词）

```json
{
  "identity": {
    "generatedBy": "scripts/goal-032-selfhost-probe.mjs",
    "method": "child node process with cwd = the tree under evaluation; import.meta.resolve(entry) + realpathSync + real import()",
    "evaluatedTree": "/data/home/yale/work/quay-worktrees/goal-GOAL-032 (goal branch's own worktree)",
    "resolved": {
      "packages/quay/src/kernel/verdict-parse.ts": "/data/home/yale/work/quay-worktrees/goal-GOAL-032/packages/quay/src/kernel/verdict-parse.ts",
      "packages/quay/src/criterion-fidelity.ts": "/data/home/yale/work/quay-worktrees/goal-GOAL-032/packages/quay/src/criterion-fidelity.ts",
      "plugin/scripts/goal-driver.ts": "/data/home/yale/work/quay-worktrees/goal-GOAL-032/plugin/scripts/goal-driver.ts"
    },
    "allMatch": true,
    "perEntry": "loaded=true, insideTree=true, hasRequiredSubstring=true (×3)",
    "negativeControl": {
      "treeRoot": "/data/home/yale/work/quay (main checkout)",
      "kernelEntry": "resolveError=ENOENT ... /data/home/yale/work/quay/packages/quay/src/kernel/verdict-parse.ts; loaded=false",
      "otherTwo": "resolve to /data/home/yale/work/quay/... , hasRequiredSubstring=false",
      "allMatch": false
    },
    "alsoReadings": "本任务自己的 worktree 三个 entry 同样 loaded=true / insideTree=true，但目录名是 gap-goal032-... ⇒ hasRequiredSubstring=false ⇒ allMatch=false（这是"必须含 goal-GOAL-032 子串"这条 AC 的直接后果，不是加载失败）"
  },
  "archguard": {
    "instrument": "archguard 0.1.38 detectDuplicates + fingerprintSourceText（/data/home/yale/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard）",
    "sources": ["packages", "plugin/scripts"],
    "options": { "minStatements": 6, "minTokens": 50, "includeTests": false },
    "before": {
      "ref": "develop", "sha": "423670d29c133a454c3a6019d63fb99b3752107f",
      "tree": "git archive develop -- packages plugin/scripts → 抛掷 tmp 目录（不建 worktree、不 checkout、不回写）",
      "scannedFiles": 418, "scannedFunctions": 9370, "totalGroups": 21,
      "duplicateGroupPresent": true,
      "duplicateGroup": { "hash": "0cac7de2dd5ee549", "tokenCount": 197, "statementCount": 12,
        "members": ["packages/quay/src/criterion-fidelity.ts:71-87 parseFidelityVerdict",
                    "plugin/scripts/goal-driver.ts:1142-1161 parseSemanticSufficiencyVerdict"] },
      "canonicalDefinitionCount": 2,
      "canonicalDefinitionFiles": ["packages/quay/src/criterion-fidelity.ts", "plugin/scripts/goal-driver.ts"]
    },
    "after": {
      "tree": "/data/home/yale/work/quay-worktrees/gap-goal032-selfhost-and-archguard-evidence",
      "sha": "73640b18e5658491452700344c412e26350effbd",
      "scannedFiles": 419, "scannedFunctions": 9370, "totalGroups": 20,
      "duplicateGroupPresent": false,
      "canonicalDefinitionAnchor": { "file": "packages/quay/src/kernel/verdict-parse.ts", "name": "parseBinaryVerdict", "hash": "bdba8a3a676ceef3", "tokenCount": 205, "statementCount": 12 },
      "canonicalDefinitionCount": 1,
      "canonicalDefinitionFiles": ["packages/quay/src/kernel/verdict-parse.ts"]
    },
    "consumerConvergenceEvidence": [
      { "file": "packages/quay/src/criterion-fidelity.ts", "line": 77, "text": "return parseBinaryVerdict(stdout, exitCode, \"faithful\", \"vacuous\");" },
      { "file": "plugin/scripts/goal-driver.ts", "line": 1151, "text": "return parseBinaryVerdict(stdout, exitCode, \"covered\", \"insufficient\");" }
    ],
    "canonicalDefinitionCountMethod": "扫面集合中"携带与锚点函数结构指纹相同的函数的【不同文件】数"（fingerprintSourceText —— 与 detectDuplicates 分组同一归一化器）；锚点按 (file, 函数名) 定位：before=parseFidelityVerdict，after=parseBinaryVerdict。计数由仪器给出，不是按名字或人工数的。"
  }
}
```

**与 Plan 点名的工具的一处替换（据实记录，不是静默偏离）**：Plan 写的是 `get_dependencies`/`get_package_metrics`，但这两个是**包/类粒度**的读数，量不出 Plan 自己定义的"两份独立实现的计数"这个**函数定义站点**口径；实际改用同一 archguard 构建的结构指纹来数（口径见上）。"互不调用"一条：(before) 那两张副本各自内联，本就没有互相 import；(after) 两条调用链改口调用 kernel 的证据即下方 consumerConvergenceEvidence。

### declaredRules（机械判定的 pass/fail；不是语义判断）

- `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json`（在本 worktree 跑）→ `evaluated: true`、`files: 455`、`edges: 1262`、`valueSccs: []`、`typeSccs: []`、`reverseEdges: []`、`kernelChecked: true`、`kernelViolations: []`、`verdict.ok: true`、`verdict.baselineRaised: []`、`verdict.bootstrap: false`、`verdict.kernelBlocked: false`。基线 `{valueSccs:0, typeSccs:0, reverseEdges:0}` 未回退。
- 该输出的词表里有独立的 `evaluated` 取值 ⇒「查过且零违例」与「没查成」不同形（硬规则 3b）。
- **AC-348 判据本体实跑（两侧对照）**：把 `goals/AC-348-*.md` 的 `criterion` 原文取出，在本 worktree（文件在）以 `bash` 实跑 ⇒ `PASS ...` / `exit 0`；同一段判据在主检出（文件不在）实跑 ⇒ `NOT-EVALUATED: ... not written yet` / `exit 3`。判据不是恒真：它读不到文件时走的是独立取值 3，不是 0。
- ⚠️ `quay goal gate AC-348 --dry-run` 报 `evaluationRoot: /data/home/yale/work/quay-worktrees/goal-GOAL-032` —— 本 goal 是 `branch: true`，AC-348 的求值根是 **goal 分支自己的 worktree**。两份证据随本任务落地到 `goal/GOAL-032` 后即出现在该根下（这也是 §4「分支 worktree 内解析」的同一棵树），落地前该判据应当且只能报 `exit 3`。

### judgment（本任务的结论陈述）

- **这是真收敛（ownership 迁移），不是搬壳。** 判据不是"两处都写了 parseBinaryVerdict 这个名字"，而是：before 的三处读数同时成立——(a) 重复组以结构指纹 0cac7de2dd5ee549 命中、成员恰是那两处；(b) 两份实现的指纹**同一**（197 tokens / 12 statements）；(c) 该指纹在扫描面里出现在 2 个不同文件。after 同一仪器同一形状下：(a) 该组不再存在，(b) 锚点（`kernel/verdict-parse.ts::parseBinaryVerdict`）指纹在扫描面里只出现在 1 个文件。**旧循环整段消失、新正本唯一**——半搬壳（保留旧循环再新增一个调用）会在 (c) 处继续读出 ≥2。
- **身份读数是可证伪的，不是常量。** 同一 specifier、同一子进程手法，cwd 换成主检出时 kernel 那条**根本无法解析**（ENOENT：主检出/kernel 分支上还没有这个文件），另两条解析到主检出路径且不含 `goal-GOAL-032` ⇒ `allMatch=false`。因此 `allMatch=true` 是"在这棵树里真的加载得到"的读数，不是脚本自己拼出来的常量（硬规则 4）。`import()` 本身不启动 driver 轮次：`goal-driver.ts` 底部有 `isDirectEntry` 守卫，非入口 import 只求值声明。
- **范围诚实**：archguard 在同一扫描面上另有 20 个重复组（before 21 / after 20），本任务**一个都没碰**，也不主张它们已收敛——GOAL-032 的范围只此一对 parser。after 里仍有一组涉及 `criterion-fidelity.ts`（`:110-116 regexBodies` × `shipped-shell-reachability.ts::fencedBodies`，hash c85844e3d997）——before 里同样存在，与本对无关，非本任务引入。
- **探针落点偏离 Touches 原文，且是有理由的**：任务 Touches 原写 `plugin/scripts/goal032-selfhost-probe.mjs`，实际落在仓库根 `scripts/goal-032-selfhost-probe.mjs`。`plugin/` 是**发布树**，`publish-dist-branch.sh` 只剥原始 `.ts`，`.mjs` 会随产物发到每个用户的安装里，顶破 `plugin/shipped-set-baseline.json` 记录的 `shipped.files: 264` 体积上限（GOAL-031 实测过同一处的 +1 文件红）。它跟随两个姊妹自举探针（`scripts/branch-selfhost-probe.mjs`、`scripts/goal-031-selfhost-probe.mjs`）落点，不进发布树；Touches 已同步改写。

## Touches

- .quay/goal-032-evidence/selfhost-identity.json (new)
- .quay/goal-032-evidence/archguard-before-after.json (new)
- scripts/goal-032-selfhost-probe.mjs (new —— 原 Touches 写作 plugin/scripts/goal032-selfhost-probe.mjs，实施时移到仓库根 scripts/，理由见 Evidence judgment)
- tasks/gap-goal032-selfhost-and-archguard-evidence.md
