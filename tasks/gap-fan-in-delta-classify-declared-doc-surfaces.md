---
id: gap-fan-in-delta-classify-declared-doc-surfaces
title: fan-in delta 分类在第三方 worktree 里找 quay 的检查注册表：改读显式声明的 loop.doc_surfaces
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-318
---
## Proposal

**机制**：机械 fan-in 第 4 步（`plugin/scripts/worker-fan-in.ts:1325/1341`）调用 `select-static-checks-for-touches.ts --classify-delta --root <worktree>`，在**目标项目的 worktree** 里查找 quay 自己的检查注册表 `runner-static-gate.ts`（候选 `plugin/scripts/…` 或 `scripts/…`，`select-static-checks-for-touches.ts:81-98`）。上游 `caeca6f9c`（2026-09-20）只给 **ff-merge 证书闸**加了插件根目录候选（`packages/quay/src/fan-in/ff-merge.ts` `classifyRootCandidates`），fan-in 第 4 步仍然只看 worktree ⇒ 第三方项目 exit 2 ⇒ `__CLASSIFY_FAILED__` ⇒ 一律跑全量 suite。

更根本的问题：注册表是 **quay 自己的检查器清单**，它的对象路径全是 quay 的。拿它去判断第三方项目的某个路径「有没有检查器读它」没有意义；分类结果实际上退化为只看 `DOC_SURFACES` 前缀（`select-static-checks-for-touches.ts:267`，`tasks/ goals/ docs/ adr/ .quay/ …`，也是 quay 的布局）。

**生产读数（claudecodeui）**：fan-in 日志 177 次 delta 判定中 11 次 `classify failed → run suite (fail-closed)`。项目随后**把 quay 的注册表副本提交进自己的仓库**（claudecodeui `f7604c68`「supply plugin/scripts/runner-static-gate.ts so fan-in can classify its delta」）才恢复分类——这是在模仿 quay 形态，不是修复。

**修法（方向）**：
1. 第三方项目的 doc/code 分类读 `.quay/config.yml` 中显式声明的 `loop.doc_surfaces`（路径前缀列表）；未声明时用一个与布局无关的保守缺省（只有 `tasks/`、`goals/`、`.quay/` 这类 quay 自己写入的面算 doc），⛔ 不查 quay 注册表。
2. 本仓库（quay 自身）继续用注册表判定；「是不是本仓库」的判断不得靠文件是否存在（由 `gap-repo-shape-inferred-from-test-sh-existence` 统一提供）。
3. fan-in 第 4 步与 ff-merge 证书闸共用同一个分类入口（硬规则 5b：同一判定只有一份实现）。
4. quay-init 写出 `loop.doc_surfaces` 的缺省值，并在 `plugin/skills/init/SKILL.md` 说明。

<!-- dedup-ref -->相关：`gap-classify-delta-registry-path-layout-aware`（done，`caeca6f9c`）修了证书闸那半；本任务修 fan-in 第 4 步并去掉对 quay 注册表的依赖。本任务是 GOAL-027 / AC-318 的承载 task。

## 实现（落地形态，与 Proposal 的差异都记在这里）

- **分类入口**：`select-static-checks-for-touches.ts` 新增 `resolveDocSurfaceDecision(root)` —— 三态、⛔ 不是布尔：
  `registry`（该树携带 quay 检查注册表 ⇒ 注册表判定，**本仓库走这条**）/ `declared`（无注册表但 `.quay/config.yml` 声明了 `loop.doc_surfaces` ⇒ 声明的前缀 + `tasks/`）/ `conservative-default`（都没有 ⇒ 只有 `tasks/`、`goals/`、`.quay/` 算 doc）。导出 `classifyDeltaPaths(root, paths)` 作为**唯一**分类入口。
- **`--classify-delta` 与 `--bootstrap-orchestration` 移到「需要注册表」的判据之前**：这两个模式本就能在无注册表时作答（前者有声明面兜底，后者只读 fan-in 编排文件集）。其余模式（scoped 选择 / `--list` / `--check-touches` 注册表核对）**仍然**缺注册表即 exit 2（⛔ 不把「没有注册表」伪装成「空注册表 ⇒ 无选中」）。
- **Proposal 点 2 的「是不是本仓库」**：本任务 **没有** 引入新的仓形判据。判据是**注册表是否在那棵树上**——它不回答「这是谁」，只回答「quay 的检查器清单适不适用于这棵树」。⛔ 刻意不按 `scripts/test.sh` 是否存在推断（那是 `gap-repo-shape-inferred-from-test-sh-existence` 的统一提供面，与本题正交）。
- **Proposal 点 3**：ff-merge 证书闸改为**只对 `root`**（delta 所相对的那棵树）分类——`classifyRootCandidates` 的插件根 + `..` 跳数候选整组删除。原因不只是冗余：`--root` 同时是分类器读 `.quay/config.yml` 的那棵树，用插件根替换它＝拿 quay 的检查器清单去判一个外国项目的 delta，正是生产里「提交注册表副本才能过」的根因。
- **Proposal 点 4**：`loop.doc_surfaces` 的交付分两处、一个值：新装写者在 `quay-init.sh` 的 heredoc（shell 无法 import TS ⇒ 该文件注释里既有的「镜像」约定）；版本级默认值在 `packages/quay/src/init.ts` 的 `LOOP_VERSION_DEFAULTS`，由**注释保留式** reconcile（`quay init --reconcile` / MCP `init`）补进已存在的 config。⛔ 刻意**不**塞进 `ensureLoopConfig`（那一步的写者是 `pyYamlDump`，会整篇重排、**丢用户注释**——实测 2 例既有测试正是钉这条）。

### 第二轮收口（2026-09-24：分类器一旦对无注册表作答，三处既有契约被砸掉，逐个修）

- **仪器探针**：`probeClassifier` 原以 `--classify-delta` 的 exit code 为读数（「exit 0 ⇔ 这棵树带注册表」）。该等价性正是本任务取消的东西 ⇒ 探针会对**每个** root 读 `evaluated:true`，一个结构上无法取假的量（硬规则 4）。改为消费分类器新增的 `--classify-delta --resolution`（一行 JSON：`mode` / `registryPath` / `registryCandidates` / `docSurfaces`），`evaluated ⇔ mode === "registry"`；两种降级模式在 `detail` 里可见，候选表由分类器自报（硬规则 5b：此处不复制路径表）。解析出的 kernel 早于该 flag 时（版本错位：`resolvePluginRoot()` 优先主检出）保留 exit-code 读法，并在 `detail` 里言明用的是哪套契约。
- **证书闸的插件根替换被撤销之后**，`gap-classify-delta-registry-path-layout-aware` 那条「删掉打包注册表 ⇒ fail closed」控制的前提失效。它改为钉该任务真正该钉、且**可取假**的新语义：quay 的注册表**不参与**外来项目的判定（mode 恒 `conservative-default`，有无打包注册表都一样）；安全半边照旧（code delta 仍被拒，判词点名真实路径）。
- **`gap-fan-in-cert-flip-commit-identity-inert` AC3**：其「真分类器在无注册表项目上无法作答」的前提与 (a) 的 `NOT-EVALUATED` 断言属同一被取代契约。前提改钉 registry-free 本身（读分类器自报的 `mode`，⛔ 不由 exit code 反推）；(a) 移到独立夹具上（保 (b) 仍是真正的「首次即落地」）——关掉身份短路 ⇒ 分类器自行判惰性放行，且⛔ 不得冒认身份判词；(c) 的 source delta 仍被拒。
- **两处测试对环境的隐式依赖**：ff-merge 的 converge / quotepath-sibling 两例原先不传 `--scripts-dir`，于是 `defaultScriptsDir()` 走 Core `resolvePluginRoot()` 的**主检出**分支——判定结果取决于主检出恰好带着哪个分类器（实测：主检出旧分类器判不了无注册表夹具 ⇒ 被测树这两例假红）。改为与本文件 shim 同一规矩：钉到被测树自己的 `plugin/scripts`。
- **⛔ 本任务不承载 suite 环境泄漏的修复（一个结论只有一个写者）**：上一轮 9 个失败文件里 7 个是**环境产物**——`driver-anchor` 环境泄漏的 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 被 suite 继承（本机实测 anchor `/proc/2391720/environ` 带它）。它有**自己的承载任务** `gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env`（本轮查证：其分支已含修复提交 `e1a1f1b1b`、worktree 干净、`<branch>..develop` = 0 ⇒ 随时可 ff）。本任务一度在 `scripts/test.sh` 入口落过同一行，**已 revert**：同一行两个写者必然冲突，且它落在别的任务的 Touches 内。该路径在本轮 `## Touches` 里**已声明但不触及**（仓库既有的允许形态）。

## AC

- [x] `node --test plugin/test/fan-in-execute-paths-s01.test.mjs plugin/test/third-party-capability-degradation.test.mjs` 退出 0，新增用例：一个**不含** `runner-static-gate.ts` 的第三方 worktree 夹具（带 `loop.doc_surfaces: ["docs/", "tasks/"]`）上，delta `["docs/a.md","tasks/t.md"]` 判 doc-only，`["server/x.ts"]` 判 code，两者都**不是** `__CLASSIFY_FAILED__`。
- [x] 负控：未声明 `loop.doc_surfaces` 的第三方夹具上，`docs/a.md` 判 code（保守缺省），且分类有结论（非 `__CLASSIFY_FAILED__`）；quay 自身仓库的既有分类用例不回归。
- [x] `node --experimental-strip-types plugin/scripts/config-key-consumer-check.ts --json` 退出 0，且 `doc_surfaces` 的状态为 `has-consumer`。
- [x] `bash scripts/test.sh --for-task gap-fan-in-delta-classify-declared-doc-surfaces` 退出 0，且执行了 ≥1 个测试文件。

## 判定读数（实现完成当轮实测，worktree 内，merge develop@258e132ef 之后）

- **AC1**：`node --no-warnings --test plugin/test/fan-in-execute-paths-s01.test.mjs plugin/test/third-party-capability-degradation.test.mjs` → `tests 22 / pass 22 / fail 0`，exit 0。新增三条用例：
  ① 声明面（`loop.doc_surfaces: ["docs/","tasks/"]`、**不含**注册表）：`docs/a.md tasks/t.md` → 输出空（doc-only）、`server/x.ts` → 输出该路径（code），两条都 exit 0，且经 `classifyDeltaOutcome`（worker-fan-in 自己的三态映射，测试直接 import，⛔ 不另写 `status === 0`）判定 **≠ `CLASSIFY_FAILED`**；
  ② 负控（同一个夹具去掉声明）：`docs/a.md` → **code**（保守缺省），`server/x.ts` → code，`tasks/t.md` → doc，exit 0，同样 ≠ `CLASSIFY_FAILED`（⛔ 旧实现在这里 exit 2）；
  ③ 反向负控（本仓库自身，携带注册表）：`orchestration/manager-tick-core.md` 仍是 **code**（被 tick-core-static-check 读），纯文档面仍是 doc。
- **AC2**：负控即 AC1 的 ②③；`plugin/test/fan-in-execute-paths-s01.test.mjs` 既有的「quay 自身仓库」分类用例（含取假一/取假二：`orchestration/manager-tick-core.md`、`plugin/loop/*`、非 ASCII 的 `goals/` 前缀边界）全部照跑通过。
- **AC3**：`node --experimental-strip-types plugin/scripts/config-key-consumer-check.ts --json` → exit 0，`{"keys_total":6,"no_consumer_to_wire":0,"states":{"has-consumer":6,…}}`，`entries[0] = {"key":"doc_surfaces","state":"has-consumer","consumers":4}`。写者面从 `quay-init.sh` 的 heredoc 机械提取（新装写者），消费者面 4 个文件。
- **AC4**：`bash scripts/test.sh --for-task gap-fan-in-delta-classify-declared-doc-surfaces` → exit 0，`tests 189 / pass 189 / fail 0`（真跑了 189 个用例，含本次 Touches 的两个测试文件与全部 change-tier 静态检查）；生产形态（driver fan-in 用的 `--allow-thin`）同读数 exit 0。
- **附：一次真回归（本任务自己引入、被 scoped 门抓住，已修）**：`plugin/skills/init/SKILL.md` 里把注册表写成路径前缀形态 `plugin/scripts/runner-static-gate.ts`，会被 `packages/quay/scripts/build-plugin-dist.mjs` 的 `MD_PATH_PREFIXED_RE` 当成「调用点」⇒ 该 bash 脚本（故意命名 `.ts`）被拉进 bundle 条目 ⇒ esbuild 解析报错 ⇒ `package.sh` 失败 ⇒ `npm-pack-e2e` 11 例全红。实测 `deriveEntries`：修复前 108 条（含 `scripts/runner-static-gate.ts`），改成裸 basename 后 107 条、无该条目；修复提交 `865b768ec`。

## 判定读数 · 第二轮（2026-09-24，承接上表；merge develop@993893614 之后，worktree 内）

上一轮的读数在**分类器开始对无注册表作答**之前取得，故上表仍有效但不足以描述落地形态；本轮的读数为准。

- **探针三态实测**（直接调用 `probeInstruments`，单变量 = root）：registry-free root ⇒ `evaluated:false`、`detail` 含 `mode=conservative-default` 与分类器自报的候选路径；带注册表的 root（本 worktree 自身）⇒ `evaluated:true`、`detail` 含 `mode=registry` 与 `exit=0`；空 scripts dir ⇒ `evaluated:false`、`NOT RESOLVABLE`。⇒ `evaluated` 两种取值都取得到（⛔ 不是常量）。
- **AC1 复验**：`node --no-warnings --test plugin/test/fan-in-execute-paths-s01.test.mjs plugin/test/third-party-capability-degradation.test.mjs` → `tests 22 / pass 22 / fail 0`，exit 0。
- **AC3 复验**：`node --no-warnings --experimental-strip-types plugin/scripts/config-key-consumer-check.ts --json` → exit 0，`doc_surfaces` = `has-consumer`（本轮 `consumers:3`；上表的 4 是重构前的读数，两者都满足 AC3 的判据）。
- **AC4 复验**：`bash scripts/test.sh --for-task gap-fan-in-delta-classify-declared-doc-surfaces --allow-thin`（merge develop@993893614 之后）→ exit 0，`tests 249 / pass 249 / fail 0`；无 `STATIC_CHECK_FAILED`。
- **本轮修动的测试文件**（均 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE`；develop 基线读数用于归因对照）：`plugin/test/fan-in-ff-merge.test.mjs` → `tests 54 / pass 54 / fail 0`（develop 同文件基线 54/54；本轮开始时本树 49/54，5 条红**全部**归因于本任务）；`plugin/test/worker-driver.test.mjs` → `tests 109 / pass 109 / fail 0`（基线 109/109；开始时 108/109）。
- **分类器相关其余文件**：`select-static-checks-for-touches` / `installed-layout-sibling-resolvability` / `fan-in-execute-paths-s04` / `fan-in-driver-mechanical-orchestration` → `tests 50 / pass 50 / fail 0`。
- **本任务 Touches 四文件**（`fan-in-execute-paths-s01` / `third-party-capability-degradation` / `quay-init-characterization` / `packages/quay/test/init.test.mjs`）→ `tests 73 / pass 73 / fail 0`。
- **上一轮 suite 红的归因（7/9 是环境，本任务不承载其修复）**：`driver-anchor` 环境泄漏的 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 被 suite 继承。单变量读数（带闸 / 不带闸的失败行数）：`packages/quay/test/goal-store.test.mjs` 17/0、`goal-driver-s02` 11/0、`-s04` 11/0、`-s10` 9/0、`-s13` 7/0、`goal-invariants-standing` 7/0、`-s12` 3/0（一律「带它 exit 1、不带 exit 0」）。
  该修复的承载任务是 `gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env`（本轮查证其分支已含修复提交 `e1a1f1b1b`、worktree 干净、`<branch>..develop` = 0）⇒ **本任务不重复实现**，只在 `## Touches` 保留 `scripts/test.sh` 为「已声明但不触及」。⇒ 本任务落地时该变量是否缺席取决于该任务是否先落地，与本任务 delta 无关（属于本任务的两条已修：`fan-in-ff-merge` 与 `worker-driver`）。
- **`sh-census-check`**：`embeddedInterpreterLines=7687 ≤ 7687`、`duplicateCopies=0`，PASS（⛔ 未改 `plugin/sh-census-baseline.json`，未抬棘轮）。
- **⚠️ 一处仍未闭合的设计结论（诚实记录）**：证书闸改为只按 `root` 分类后，`gap-classify-delta-registry-path-layout-aware` 的插件根替换在**新分类器下已不可达**（`root` 总能有结论）⇒ 该机制对**外来项目**事实上退役，其测试的三条断言已按新语义重钉并在注释里标明「SUBJECT SUPERSEDED」。**quay 自身树**仍走注册表判定（`REGISTRY_REL_CANDIDATES` 的两个布局候选未动，故已安装 quay 判**自己**的树不受影响）。
- **⛔ 本轮未跑全量 suite**：按 worker 协议，全量 suite 由 worker-driver 的机械 fan-in 执行，不在本回合内；上表与本表都只记本回合**实跑**的读数。

## DoD

真实落地判据：GOAL-027 / AC-318 的判据在 claudecodeui 上读出 exit 0。这要求：该项目删除提交进去的 `plugin/scripts/runner-static-gate.ts` 副本、在 `.quay/config.yml` 声明 `loop.doc_surfaces`、driver 重启到含修复的版本，之后其 fan-in 日志里至少出现 1 次 delta 判定且 `classify failed` 为 0。完成记录写明删除副本的提交与 driver 重启时刻。

**⛔ 本 DoD 未完成，且本任务内不可能完成（诚实记录，不是省略）**：AC-318 的判据②要求「**落地 develop 之后**」的 delta 判定窗口——即以提及本任务 id 的 develop 提交时刻为下界（`git log develop --grep=… --format=%cI | tail -1`）。该下界只在 fan-in ff 之后才存在，**先于本任务 landing 的任何第三方动作都落在窗口之外**，且此刻（driver 仍跑旧代码）删副本会让该项目的分类**更差**（旧代码缺注册表即 exit 2）。因此这三步只能在落地后由后续轮次执行：① `git -C /data/home/yale/work/claudecodeui rm plugin/scripts/runner-static-gate.ts` 并提交；② 在其 `.quay/config.yml` 的 `loop:` 下声明 `loop.doc_surfaces`（本机 quay-init 升级路径现在会经 `quay init --reconcile` 补缺省值）；③ 重启其 driver 到含本修复的版本；④ 读其 `.quay/fan-in-*.log` 的 `"step":"delta"` 记录：≥1 条且 `classify failed` 为 0。本机实测该判据当前为 exit 1（`CAUSE=第三方项目仍提交着 quay 的检查注册表副本`），与本任务立条时一致。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/select-static-checks-for-touches.ts
- packages/quay/src/fan-in/ff-merge.ts
- plugin/scripts/quay-init.sh
- packages/quay/src/init.ts
- plugin/skills/init/SKILL.md
- plugin/test/fan-in-execute-paths-s01.test.mjs
- plugin/test/third-party-capability-degradation.test.mjs
- plugin/test/quay-init-characterization.test.mjs
- plugin/test/fan-in-ff-merge.test.mjs
- packages/quay/test/init.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- plugin/sh-census-baseline.json
- tasks/gap-fan-in-delta-classify-declared-doc-surfaces.md
