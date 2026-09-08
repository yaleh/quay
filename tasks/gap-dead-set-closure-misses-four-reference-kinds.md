---
id: gap-dead-set-closure-misses-four-reference-kinds
title: 死集闭包只认调用形式、漏认四类引用（bash source/. 内建、活测试钉存在性、config.yml gate
  注册、wrapper→委托模块），82 名单仍混活脚本致 AC158 二次自锁
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**问题**：`plugin/scripts/registry-bare-filename-scan.ts` 的 §12e 传递闭包只枚举【调用形式】（`node|bash|sh|tsx <path>`、`${repo_root}/` 插值、`path.join(__dirname,"<name>")`、`$SCRIPT_DIR/<name>`），漏认另外**四类引用种类**，导致重算后的 `after.dead`（当前 82）仍混入在生产使用的活脚本。AC158 执行批次一的负控制（其 Plan 步骤 1）**连续两轮**都在派发之后才拦下，每次烧掉一个完整派发周期。

**当前的假绿（实测，2026-09-08）**：`node --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts --check` ⇒ `exit 0`、打印 `PASS: bare-filename scan found 8 referenced script(s); … none in dead set (after=82)` —— **而 `suite-slot-lib.sh` 就在那 82 里**。闸之所以绿，是因为收集器只找到 8 个被引用脚本（只覆盖裸文件名那一类）。**这正是硬规则 3b 的形态：一个恒绿的闸比没有闸更贵。**

四类漏认（逐条已独立核实，非转述）：
① **bash `source` / `.` 内建** —— `suite-slot-lib.sh` 在 82 内，而 `scripts/test.sh:465` 每轮 `source "${repo_root}/plugin/scripts/suite-slot-lib.sh"`（bash 侧 suite 槽路径的单一定义点），另被 `suite-driver.ts` / `worker-driver.ts` / `full-suite-runner.ts` / `suite-slot-ssot-check.ts` / `suite-lock-slots.ts` 及 8+ 活测试引用 ⇒ 移走则**下一次 suite 自身 source 失败**。
② **活测试钉存在性** —— `plugin/test/plugin-packaging.test.mjs`（`@test-group product`，默认 suite 必跑，实测 16 处引用）以 DIR-070-B/C 断言 10 个脚本存在：`anti-gaming-guard.{ts,sh}` / `loadbearing-test-gate.{ts,sh}` / `drivable-workspace-check.sh` / `audit-independence-check.{ts,sh}` / `vmeta-lag-check.{ts,sh}` / `it0-enforcement-with-design-check.sh` —— **10/10 全在 82 内** ⇒ 移走即红。
③ **`.quay/config.yml` gate 注册** —— 6 个死集脚本被注册为 gate 的 `script:` 路径（实测 `:50` `vmeta-lag-check.sh`、`:70` `anti-gaming-guard.sh`、`:81` `build-evidence-gate.ts`）⇒ 移走留悬空路径。
④ **wrapper → 委托模块不对称** —— `drivable-workspace-check.sh` 与 `it0-enforcement-with-design-check.sh` 在 82 内、其委托的 `.ts` 模块不在 ⇒ wrapper 活着却没了模块入口。

**关键结构发现（决定修法）**：**执法点已经存在且正确** —— `registry-bare-filename-scan.ts:888` 已有 `result.referencedScripts.filter(s => afterDead.has(s))` ⇒ 命中即 `RED` 的 fail-closed 闸。缺的**不是控制，是收集器**：`referencedScripts` 只由【调用形式】填充。⇒ 修法是把四类引用补进**收集器**，既有 `:888` 闸自动覆盖它们；**⛔ 不新造第二个闸**（双判据必然漂移）。

**为何不再做单形式补丁**：这是同一形状的第二次——上一次 `gap-dead-set-closure-repo-root-call-form-false-positive`（done）补了 `#` 注释屏蔽 + `__dirname` + `$SCRIPT_DIR` 三种。闭包一直在枚举「怎么调它」，而缺陷一直出在「**还有什么算引用它**」。故本任务按**引用种类**补全，并给每类各钉一个已知为真样本（硬规则 2 的零计数配套动作）。

**关联**：`gap-ac158-execute-archive-batch-one`（needs-human，被本任务阻塞，将以 depends_on 指向本任务）、`gap-dead-set-closure-repo-root-call-form-false-positive`（done，上一轮同形）、`gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure`（done，同形状但载体是 quay-init 铺设集派生，**不同机制、非重复**）。

## Plan

1. **收集器补四类**（`registry-bare-filename-scan.ts`，与既有 `PATH_REF_RE` / `DIRNAME_JOIN_RE` / `SCRIPT_DIR_REF_RE` 并列）：
   ① `source <path>` 与 `. <path>` 内建（含 `"${repo_root}/plugin/scripts/<name>"` 插值形态与引号形态）；
   ② `plugin/test/**.mjs` 中钉存在性的引用（`existsSync` / 路径字面量断言）；
   ③ `.quay/config.yml` 里 gate 的 `script:` 路径；
   ④ wrapper→委托模块：某 wrapper 被引用时，其委托的同名 `.ts`/`.sh` 兄弟一并计入被引用。
2. **每类各钉一个已知为真样本**（仿既有 `KNOWN_SAMPLE` / `KNOWN_SAMPLE_CARRIER` 的做法）：①`suite-slot-lib.sh`←`scripts/test.sh`；②`loadbearing-test-gate.ts`←`plugin/test/plugin-packaging.test.mjs`；③`anti-gaming-guard.sh`←`.quay/config.yml`；④`drivable-workspace-check.sh`→其委托 `.ts`。**样本 0 命中 ⇒ 判谓词写错，报红；⛔ 不得判「无此类引用」**（硬规则 2）。
3. **在合并后的树上重跑生成器**重算 `docs/analysis/dead-set-recomputed.json`（⛔ 不手工编辑 JSON——当前该文件的 `generatedAt` 仍是 `2026-09-07T14:38:19`、与 83 那版逐字相同，正是手工摘改留下的旧 provenance），并同步 SPEC §12e 两条机读行 `- 扫描前死集: N` / `- 扫描后死集: N`。
4. 跑既有 `--check` 闸确认新名单与四类引用零交集。

## AC

- [x] AC1 四类样本全部命中：`node --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts --check` exit 0，且 stdout 逐条打印四个已知为真样本各自的命中载体（任一样本 0 命中 ⇒ 报红退出非 0，**不得静默判「无此类引用」**）
- [x] AC2 负控制（能取假，且今天就能取假）：在**修复前的 82 名单**上跑 `--check` ⇒ **exit 非 0** 且 stderr 含 `suite-slot-lib.sh`（当前实测为 `exit 0` + `PASS … none in dead set (after=82)` 的假绿，故本条能区分修没修）
- [x] AC3 新名单零交集：重算后 `docs/analysis/dead-set-recomputed.json` 的 `after.dead` ∩ {`suite-slot-lib.sh`, DIR-070 所钉十名, `.quay/config.yml` 注册六名} == ∅（python3 一条可查，打印交集内容而非只打印计数）
- [x] AC4 SPEC 同源：`grep '^- 扫描后死集: ' orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` 取出的数字 == 重算后的 `after.deadCount`
- [x] AC5 产物 provenance 已刷新：重算后 `docs/analysis/dead-set-recomputed.json` 的 `generatedAt` 严格晚于本任务实现落地时刻（⛔ 手工改 JSON 会留旧 `generatedAt`，本条据此取假）
- [x] AC6 `node plugin/scripts/task-schema-check.ts tasks/gap-dead-set-closure-misses-four-reference-kinds.md` exit 0
- [ ] AC7 全量 `scripts/test.sh` exit 0（待外部）

## DoD

四类引用进入 `referencedScripts` 收集器、由既有 `:888` fail-closed 闸自动覆盖（**不新增第二个闸**）；在合并后的树上**重跑生成器**产出新的 `after.dead`，其与四类引用的交集为空，且 SPEC §12e 机读行与之同数；AC158 的负控制（其 Plan 步骤 1）在新名单上跑一遍**不再报出活脚本**。

⛔ 只补一两类 / ⛔ 手工编辑 JSON 绕过重跑（`generatedAt` 未刷新即判未达成）/ ⛔ 新造第二个闸而不复用 `:888` / ⛔ 某类样本 0 命中却判「无此类引用」—— 均**不算达成**。

## Touches

- plugin/scripts/registry-bare-filename-scan.ts
- plugin/test/registry-bare-filename-scan.test.mjs
- plugin/scripts/checker-mutation-cases/registry-bare-filename-scan.sh
- docs/analysis/dead-set-recomputed.json
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- tasks/gap-dead-set-closure-misses-four-reference-kinds.md