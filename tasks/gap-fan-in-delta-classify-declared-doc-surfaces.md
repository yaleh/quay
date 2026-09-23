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
- packages/quay/test/init.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- plugin/sh-census-baseline.json
- tasks/gap-fan-in-delta-classify-declared-doc-surfaces.md
