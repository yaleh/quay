---
id: gap-touches-relax-config-block-unread-unvalidated
title: loop.touches_relax 配置块既无读取器也无校验器：缺省语义与「显式 off vs 没写」不分、非 off 时
  after_minutes/max_relaxed_inflight 的必填与「无内置回退」、非法值的非零退出与只读，全未落地（GOAL-037
  AC-364 配置面）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-364
---
**type:** execution

## Proposal

**缺口**：GOAL-037 的配置面——`loop.touches_relax` 配置块——**在代码里完全不存在**。`grep -rn "touches_relax\|after_minutes\|max_relaxed_inflight\|never_relax" plugin/ packages/ docs/` 零命中（唯一的 `shared_files` 命中在 `docs/proposals/quay-adaptive-task-packing-and-overlap-concurrency.md`，是另一份方案，与本块无关）。放宽派发（AC-365/366）与自动收紧（AC-367）都**必须先能读到这块配置**；而按 GOAL-037 的立案纪律，`after_minutes` 与 `max_relaxed_inflight` 的合适取值要等 AC-362 的 filter_trace 数据出来才能定，所以**缺失时判配置不合格、不回退到任何内置数值**是硬要求（硬规则 4 推论二：本机等价于不限制的字面值换机后会变成真限制；硬规则 12：不得凭空设前置/阈值）。

**为什么是缺口而不是「以后加」。** 没有这一层，放宽谓词只能靠代码里的字面量阈值，而这正是 GOAL-037 明令禁止的（「阈值全部来自配置，代码里不写字面量，默认关闭」）。本条只做**配置面**：读取 + 校验 + 词表 + 三态区分。⛔ 不做放宽谓词（AC-365）、不接线 worker-driver（AC-366）、不做自动收紧（AC-367）、不碰 `driver-filters.ts`。

**机制现状（读代码得出，非推断）**：
- `loop.<section>` 块的现成读取范式：`plugin/scripts/arch-discovery-routine.ts:285` `readArchDiscoveryConfig(root)` ⇒ `{present, config, error}` —— 文件缺失 / 无 `loop:` / 无该节 ⇒ `present:false`（默认关）；YAML 畸形或坏节 ⇒ `error` 置位（fail-closed）。同族：`plugin/scripts/carrier-retention.ts:127` `readRetentionConfig`（默认 DISABLED）。本条的读取器照此形状，⛔ 不发明第三种。
- 校验的现成范式：`plugin/scripts/arch-discovery-routine.ts` 的 `parseArchDiscoverySection(raw)` ⇒ `{config, error}`（纯函数，逐字段验 + 具名字段 message）；测试范式 `plugin/test/arch-discovery-routine.test.mjs`（fixture root、真读真验、断言 absent 与 explicit-false 不同形）。本条照此。
- 核心 `packages/quay/src/config-validate.ts` **不**覆盖 `loop.arch_discovery`（它只验 `loop` 的 board/gates/execution/audit/concurrency/stop/routines）—— 即本仓库对 `loop.<section>` 子块的既有分工是：**子块自带的读取器/校验器在 plugin 层**，Core 的 `config-validate.ts` 不管它们。本条沿用这一分工，⛔ 不改 `config-validate.ts`（避免 Core↔plugin 方向漂移；`config-key-consumer-check.ts` 的 writer face 是 `quay-init.sh`，本条不写 quay-init，故不触发它）。

<!-- dedup-ref --> 追踪与去重结论（机制去重已做，非症状去重）：同批的 `gap-worker-round-filter-trace-attribution`（AC-362）改 `driver-filters.ts`/`worker-driver.ts` 加 filter_trace；`gap-relaxed-dispatch-ledger-and-merge-cost-report-absent`（AC-363）新建 `relaxed-dispatch-ledger.ts` 账本。本条**不触碰**上述三个文件、不新建载体，Touches 与两者无重叠 ⇒ 判定：**kept separate（独立立案）**，理由：不同的验收对象（配置读取/校验 vs 谓词归因 vs 成本账本），合并会把三个独立 AC 的验收面耦合进一个任务。合并候选检查用现成机件跑过：`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches plugin/scripts/touches-relax-config.ts --touches plugin/scripts/capability-catalog-declarations.json --touches plugin/test/touches-relax-config.test.mjs --json` ⇒ `peers: []`、`mentions: []`。

## Plan

1. **新模块 `plugin/scripts/touches-relax-config.ts`**（纯库 + `isDirectEntry` CLI，尾部与 `arch-discovery-routine.ts` / `duration-report.ts` 同形）：
   - `TOUCHES_RELAX_MODES = ["off", "shadow", "live"]` **导出**（词表单一来源，⛔ 别处不写字面量数组）。`TOUCHES_RELAX_SECTION = "touches_relax"` 导出。
   - `readTouchesRelaxConfig(root)` ⇒ `{present: boolean, section: unknown|null, error: string|null}`：`.quay/config.yml` 缺失 / 无 `loop:` / 无 `touches_relax` ⇒ `present:false`（**默认关**）；YAML 畸形 ⇒ `error` 置位 fail-closed；`loop:` 非 mapping ⇒ `error`。
   - `parseTouchesRelaxSection(raw)` ⇒ `{ ok: true, config } | { ok: false, issues: [{field, message}] }`（纯函数）：见第 2 步。
   - `loadTouchesRelaxConfig(root)` ⇒ **三态可分**（硬规则 3b）：`{ state: "absent"|"off"|"shadow"|"live", mode: "off"|"shadow"|"live", config: {...}|null, issues, error }`。⛔ `state:"absent"`（没写）与 `state:"off"`（显式写了 off）**必须不同形**，且 `mode` 在两者都读作 `"off"`（缺省语义）；⛔ 两者都**不得**因缺省而产出 `issues`（缺省合法）。
   - **CLI**（`--validate [--root <dir>] [--json]`）：退出码 `0` = 合格 · `1` = 不合格（逐条打印具名字段）· `2` = 用法错误。**只读**：⛔ 任何路径都不得写 `.quay/config.yml`（原文件字节不变）。
2. **校验语义（`parseTouchesRelaxSection`）**：
   - `mode` 缺失 ⇒ **合法**，缺省 `"off"`（读取层记 `state:"absent"`；若节存在但无 `mode` 键，读作 off 但 `state:"off"` —— 由读取层区分）。`mode` 非字符串或不在 `TOUCHES_RELAX_MODES` ⇒ issue（field `loop.touches_relax.mode`）。
   - `mode ∈ {shadow, live}` ⇒ `after_minutes` **必须显式给出**：缺失 ⇒ issue 且 message **点名 `after_minutes`**；同时 `max_relaxed_inflight` **必须显式给出**：缺失 ⇒ issue 且 message **点名 `max_relaxed_inflight`**。⛔ **不得回退到任何内置数值** —— 不给 `after_minutes` 预置 default、不给 `max_relaxed_inflight` 预置 default；缺任一项即 `ok:false`。
   - `after_minutes` 出现时：必须为有限正数（`> 0`）⇒ 否则 issue（「非正数」含 0、负数、`NaN`、非数值）。
   - `max_relaxed_inflight` 出现时：必须为整数且 `>= 0` ⇒ 否则 issue（非整数/负数/非数值）。
   - `mode === "off"`（或缺失）⇒ ⛔ **不要求** `after_minutes`/`max_relaxed_inflight`；但给了非法值仍报 issue（不因 off 而跳过形状校验）。
   - `shared_files`、`never_relax`：**数组**（元素为非空字符串，路径或 glob）；缺失 ⇒ 缺省 **`[]`**（空列表，合法）；出现但非字符串数组 ⇒ issue。
   - 未知键：⛔ 本条不引入「拒绝未知键」（避免超出 AC）；只校验上述字段。
3. **测试 `plugin/test/touches-relax-config.test.mjs`**（首行 `// @test-group engine`；纯 fs + 纯函数，无子进程、无 wall-clock 等待 ⇒ 55s 上限应有余量，实测值写进 Evidence）：
   - **真实读取器/校验器 + fixture `.quay/config.yml`**：在 `fs.mkdtempSync` 出的 fixture root 写真实 `.quay/config.yml` 字节，调**真的** `readTouchesRelaxConfig` / `parseTouchesRelaxSection` / `loadTouchesRelaxConfig`（照 `plugin/test/arch-discovery-routine.test.mjs` 的手法）；⛔ 断言不得依赖测试内自造的判定逻辑。fixture root 登记进 `TMP_ROOTS`，顶层 `after()` 统一删（`tmp-leak-pairing-check` 要求）。
   - 覆盖 (a)–(e) 逐项，并对 (e) 做两次**真红**负控制（见 AC6）。
4. **静态面（一个新增 `plugin/scripts/*.ts` 会被一组不 import 你的仓级契约判）**：
   - **能力目录**：新脚本必须在 `plugin/scripts/capability-catalog-declarations.json` 成组声明六表（QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING / CONSUMER；键是 **basename**，⛔ 不是带目录的路径）。⛔ 漏声明 ⇒ `bash plugin/scripts/capability-catalog.sh --summary` 报 unclassified 且 exit 1。声明值内⛔ 不得有反引号或 `$(`。⚠️ **CONSUMER 值里若写出 `node …<name>.ts` 形状**，`build-plugin-dist.mjs` 的 `INVOCATION_RE` 会把本模块变成**发布包的一个 bundle entry**（实测 283→284 files、体积上限转红）—— 按需决定，别无意中加上；⚠️ cadence 若声明「按需」，`rhythm-consumer-check` 判据2 要求**必须有 CONSUMER 行**。
   - **载体现状核对**：⛔ 本条**不新增载体**（不写 jsonl）⇒ 不加 `docs/carrier-registry.json` 条目、不改 `.gitignore`。
   - **注册/铺层面**：`select-static-checks-for-touches.ts` 的 `NEW_SCRIPT_REGISTRATION_REQUIRED` 只要求把 `plugin/scripts/capability-catalog-declarations.json` 列进 Touches（已列）；铺层集合由 `init.ts` 的 `deriveLoopScripts` **机械派生**、无需手改。落笔后跑一次 `config-wiring-check.ts` / `config-key-consumer-check.ts` 贴读数，确认新块未改判。
   - **不越界**：⛔ 不改 `packages/quay/src/config-validate.ts`、`quay-init.sh`、`driver-filters.ts`、`worker-driver.ts`；⛔ 不在 quay 自己的 `.quay/config.yml` 里加 `touches_relax` 块（GOAL-037：「不在 quay 自身启用」）。

## Acceptance Criteria

- [ ] AC1 — 测试落地且通过（AC-364 判据面逐字）：`timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-config.test.mjs` **exit 0**，文件首行带 `// @test-group engine`。附实际命令、输出尾部与实测耗时（秒）。
- [ ] AC2 — (a) 缺省与三态可分：fixture 无 `touches_relax` 块 ⇒ 读取器 `mode === "off"` 且 `state === "absent"`；fixture **显式** `mode: off` ⇒ `mode === "off"` 且 `state === "off"`；两者 `state` **不同形**（`strictEqual` 双向断言），且两者都无 `issues`。附两段 fixture 字节与读数字段。
- [ ] AC3 — (b) 非 off 的必填 + 点名 + 无回退：`mode: shadow` 且缺 `after_minutes` ⇒ `ok:false` 且 issues 里存在 field 含 `after_minutes` 的条目；`mode: live` 且缺 `max_relaxed_inflight` ⇒ 同理点名 `max_relaxed_inflight`；**`config` 里不得出现被回退填入的 `after_minutes`/`max_relaxed_inflight`**（显式断言这两键在 `ok:false` 时不被赋任何内置数值 —— `undefined`，⛔ 不是 30/5/1 之类字面量）。附三段 fixture 与校验结果。
- [ ] AC4 — (c) 列表缺省为空：缺 `shared_files`/`never_relax` ⇒ 读出的两者 `deepEqual []`；给出字符串数组 ⇒ 逐元素保留（含一个 glob 如 `**/*.test.mjs`）。附判定与 config 逐字。
- [ ] AC5 — (d) 非法值非零退出且只读：三种非法各一次 —— `mode: aggressive`（不在词表）、`after_minutes: 0` 与 `-1`（非正数）、`max_relaxed_inflight: 1.5`（非整数）⇒ ① `parseTouchesRelaxSection` `ok:false` 且具名 issue；② 模块 CLI `--validate --root <fixture>` **非零退出**（实际 `spawnSync` 运行，附退出码）；③ 运行前后 fixture `.quay/config.yml` **字节哈希相同**（一个字节没写）。附三次调用、CLI 退出码、哈希前后值。
- [ ] AC6 — (e) 取假形态（两次真红，留痕，⛔ 注入不得留在落地代码里）：① 把缺省从 `"off"` 改成 `"live"` ⇒ 本测试变红；② 给 `after_minutes` 一个内置默认值（如缺失时回填 30）⇒ 本测试变红。各附非零退出码 + 失败断言原文；恢复后 `git status` 净、落地 diff 与该测试最终内容一致。
- [ ] AC7 — 静态面与不越界：① `bash plugin/scripts/capability-catalog.sh --summary` 报 `0 unclassified`（新脚本已在 declarations 六表成组声明）；② `bash scripts/test.sh plugin/test/config-key-consumer-check.test.mjs` 与 `config-wiring-check` 相关检查 **exit 0**（附读数，证明新块未改判）；③ `git diff --stat -- packages/quay/src/config-validate.ts plugin/scripts/driver-filters.ts plugin/scripts/worker-driver.ts plugin/scripts/quay-init.sh` **空**；④ `git diff -- .quay/config.yml` **空**（不在 quay 自身启用）。附四条命令、退出码与输出。

## Definition of Done

真实落地 = **由生产读取器/校验器对 fixture `.quay/config.yml` 字节读出的判别读数**，不是测试内自造判定、也不是「单测绿了」。四者逐一对上：① 新测试落地并 exit 0（AC1）；② 三态可分（absent vs explicit-off）与「非 off 必填、缺失点名字段、无内置回退」的读数逐字贴出（AC2/AC3）；③ 两种取假注入各真红一次（AC6，附红输出）；④ 静态面绿（AC7 四条命令 + 退出码）。全部新增测试在 `bash scripts/test.sh --for-task gap-touches-relax-config-block-unread-unvalidated` 下绿。

**如实写明（⛔ 不作为省略的理由）**：本 AC 的判据面是**夹具读数** —— GOAL-037 立案文本的「已知缺口」已承认本 goal 的 AC 都不读生产载体（生产读数需人在目标项目启用 shadow/live 并重启 driver，是人工步骤）。因此本条的落地证明止于「夹具 `.quay/config.yml` 读取/校验读数」；生产消费（AC-365/366 的谓词读这块配置、driver 接线）由后续 AC 承担。⛔ 同时：AC-364 的判据面（测试存在且 55s 内绿）**单独不具备判别力** —— 它区分不了「真校验」与「恒真断言」；判别力由 AC6 的两次注入红提供，故 AC6 不得省略、不得只在文字上声称跑过。

## Touches

- plugin/scripts/touches-relax-config.ts (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/touches-relax-config.test.mjs (new)
- tasks/gap-touches-relax-config-block-unread-unvalidated.md
