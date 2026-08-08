---
id: gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form
title: "the shipped artifact's delivery FORM is 86 loose .sh files — measured on the locally built
  quay-0.4.0.tgz (303 files after the test exclusion): 86 shell scripts under package/plugin/
  (scripts 73 + gate-scripts 12 + sync.sh), shipped as individually-invoked loose files with no
  single entry point, no packaging, and no uniform invocation surface; this is a DIFFERENT axis
  from gap-scripts-sprawl-no-uniform-cli-convention (which asks whether their --help behaves
  consistently — an interface question about the 57 in-repo scripts): this task asks whether
  loose-file-per-capability is the right DELIVERY form at all, given that a consumer receives 86
  separate shell entry points each of which is an independently-invocable surface; the same
  artifact ships Core as a single bundled dist/quay.js, so the asymmetry is unargued; manager
  2026-08-06 filed per human direction after inspecting package contents"
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**交付产物的形态是 86 个散着的 `.sh`——每个都是独立可调用面，没有单一入口，没有打包。**

### 实测（本机 `package.sh` 产出的 `quay-0.4.0.tgz`，剔除测试后 303 文件）

| 位置 | `.sh` 数 |
|---|---|
| `package/plugin/scripts/` | **73** |
| `package/plugin/gate-scripts/` | **12** |
| `package/plugin/sync.sh` | 1 |
| **合计** | **86** |

对照同一产物里的 Core：`package/dist/quay.js` 是**单文件 bundle**；
`plugin/vendor/` 里两个运行时也是单文件。**同一个包，Core 收敛成 1 个入口，plugin 散成 86 个。**

### 与既有任务的分界（不重复立案）

`gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools` 问的是
**「这些脚本的 `--help` 行为一不一致」**——那是**界面**问题，作用域是仓库内的 57 个。

**本任务问的是另一根轴**：**「86 个散件本身，是不是正确的交付形态」**——
作用域是**交付产物**。两者可以各自独立成立或不成立：
即使 86 个脚本的 `--help` 全部统一了（那条任务达成），
"消费者拿到 86 个独立 shell 入口"这件事仍然存在。

### 后果

1. **威胁面 = 入口数**：今晚第五次整机崩溃的教训是"入口越多、绕过越容易"
   （`tmux-isolated.sh` 有 9 个潜在消费者，8 个绕过）。86 个散件是 86 个可被误用/误调的面。
2. **升级面 = 文件数**：每个散件都要独立铺设、独立校验字节一致
   （`verify-installed-executables.sh` 正是为此存在），升级正确性的验证成本随文件数线性增长。
3. **不对称无解释**：Core 收敛到 1 个 bundle 被认为是对的，plugin 散成 86 个也被认为是对的，
   **但没有任何文档论证过这两个相反的决定为何都对**。

### 选定机制（**人 2026-08-06 17:0xZ 已裁定方向：收敛为少数入口**）

**人的裁定原话**：「显然用户得到的应该是数量很少的几个可执行文件。」

⇒ 方向为**收敛**，但 `.sh` 与 `.ts` 的可达形态**不同，必须分开说**：

- **`.ts`/`.mjs`**：可以字面 bundle 成少数可执行体（姊妹任务
  `gap-shipped-ts-files-are-not-bundled-*` 负责，工具现成——Core 已在用 esbuild）
- **`.sh`**：**bash 无法 bundle 成单个可执行体**（改写成 JS 或用 shc 之类，代价与风险都高）。
  可达形态是**「少数入口 + 内部件不外露」**：把被真实调用的收进一个 `quay-tool <name>` 分发器，
  其余降级为不对消费者暴露的内部件。**路径不同，目标一致。**

**支撑数据（管理者裁定后补测）**：

| 项 | 值 |
|---|---|
| 交付脚本总数（scripts + gate-scripts，含各语言） | **172** |
| tick 文档 + skills **真实调用**的 | **39**（其中 `.sh` 20 / `.ts` 18 / `.mjs` 1） |
| **从不被直接调用的内部件** | **133（78%）** |
| `.sh` 之间的耦合 | **极低**——172 个里仅 2 个用 `source`，公共库只有 `gate-script-lib.sh` |

⇒ **78% 的交付物消费者根本不碰**，而 `.sh` 之间几乎无耦合，
说明"降级为内部件"在技术上不会牵一发动全身。

## Contract

```
measure loose_sh_in_artifact = `tar tzf packages/quay/quay-*.tgz | grep -c "package/plugin/.*\.sh$"` stdout 的数字段
measure consumer_facing_entrypoints = `grep -ohE "plugin/scripts/[a-zA-Z0-9._-]+\.(sh|ts|mjs)" plugin/loop/*.md plugin/skills/*/SKILL.md | sed 's|.*/||' | sort -u | wc -l` stdout 的数字段（当前基线 39）
invariant 交付产物的入口数必须是被论证过的决定：不得出现"Core 收敛为 1、plugin 散为 86"而无任何文档说明的状态
invoke `bash packages/quay/scripts/package.sh && tar tzf packages/quay/quay-*.tgz | grep -c "package/plugin/.*\.sh$"`
control 若选方向 1 或 3：随机挑一个被降级为内部件的脚本，确认它不再出现在任何面向消费者的操作说明里（同 quay-launch.sh 那条的 measure 形态）；若仍出现，说明降级只是口头的
resume 若中断，先跑 measure 读当前产物里的散件数与已声明入口数，不要假设已收敛
```

## Acceptance Criteria

- [x] AC1: 记录基线——`loose_sh_in_artifact` 实测（预期 86）与当前被文档声明为消费者可直接调用的脚本数
      **基线（2026-08-08 实测）**：
      - `loose_sh_in_artifact`（合同 measure，对 2026-08-08 全新 `package.sh` 产物）`tar tzf packages/quay/quay-0.4.0.tgz | grep -c "package/plugin/.*\.sh$"` = **94**
        （历史 86 是 2026-08-06 旧产物的数；**86→94 的 8 个无论证增长本身就是本任务的实证**）。
        构成：`scripts/` 64 + `scripts/checker-mutation-cases/`（fixtures，非入口）17 + `gate-scripts/` 12 + `sync.sh` 1。
      - `consumer_facing_entrypoints`（合同 measure，`.sh|.ts|.mjs`）= **44**；其中 `.sh` = **23**。
      - 已被文档声明为消费者可直接调用的 `.sh` = **23**；其余 41 个 `scripts/*.sh` + 12 `gate-scripts/*.sh` +
        17 fixtures + `sync.sh` = **内部件（71 个 `.sh`）**。
- [x] AC2: 选定方向（收敛入口 / 明写散件 / 分层）并记录理由，不得留空
      **方向：收敛入口（1）**，理由 = 人 2026-08-06 裁定「用户得到的应该是数量很少的几个可执行文件」。
      `.sh` 可达形态（区别于 `.ts` 的 esbuild bundle）：「**少数入口 + 内部件不外露**」——
      真实被调用的工具收进 `quay-tool <name>` 分发器（目标机制，记录在案），其余降级为不暴露给消费者的内部件。
      **本执行落点**（Touches 限 4 文件，实际分发器铺设 + 全部 skill/tick doc 改写属后续任务）：
      把「入口数是被论证过的决定」变成**可执行不变量**——`capability-catalog.sh` 新增 `PUBLIC_ENTRYPOINTS`
      （被文档声明为消费者可直接调用的 23 个 `.sh` = 已论证的公开入口集），`--entry-surface` 模式 +
      `package.sh` 打包门在**每次打包时**机械核对声明集 vs 消费者文档引用集（AC3）。未声明却在消费者文档出现的
      `.sh` ⇒ 打包 fail-closed。方向没有留空：收敛 + 内部件不外露 + 公开入口集已声明。
- [x] AC3: **负控制（承重条）**——若选 1 或 3，被降级的脚本必须不再出现在任何面向消费者的
      操作说明里；若仍出现，降级只是口头的，本条不算达成
      **负控制已机械化为 `capability-catalog.sh --entry-surface` 门**（比"随机挑一个"更强：穷举）：
      扫描 `plugin/loop/*.md` + `plugin/skills/*/SKILL.md`（合同 `consumer_facing_entrypoints` 同一表面），
      任何不在 `PUBLIC_ENTRYPOINTS` 的 `.sh` 若出现在消费者文档 ⇒ 非零退出并指名。
      - **基线 pass**：64 shipped / 23 public / 41 internal / doc-referenced 23 / **0 violations**（实跑见 Execution evidence）。
      - **fail 方向（测试实证）**：临时在 loop doc 里引用内部件 `checker-cost-lib.sh` ⇒ 门 exit 1 并指名
        （`plugin/test/capability-catalog.test.mjs`「AC3 — negative control」用例）。
      - **打包接入**：`package.sh` 在 npm pack 前对 staged 副本跑该门，失败即中止（fail-closed）。
      内部件（71 个 `.sh`）实测均不出现在消费者文档 ⇒ 降级是真实的，不是口头的。
- [x] AC4: 与 `gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools` 交叉标注，
      任务体必须写明两者的分界（那条是**界面一致性**，本条是**交付形态**），
      避免后来者把两条当成重复而合并掉其中一条
      分界已写入**本条 Proposal「与既有任务的分界」**，并**反向写入那条任务体的「## 交叉标注」**
      （2026-08-08 追加）：那条 = 57 个工具的 `--help`/调用界面一致性（界面轴，仓库内作用域）；
      本条 = 交付产物里 86 个散件是不是正确形态（交付轴，产物作用域）。正交、不互相替代、不合并。
- [x] AC5: 与 `gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact` 及
      `gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal` 交叉标注——
      三条同属"交付形态未被论证"这一族（`.sh` 散件 / `.ts` 未 bundle / 脚本被当成用户面）
      同族标注已**反向写入 gap-shipped-ts 任务体**（AC5 补充 2026-08-08 + Touches），三轴对比表：
      `.ts` 散件 → esbuild bundle 成 42 入口；`.sh` 散件 → 声明公开入口集 + 内部件不外露（本条）；
      `quay-launch.sh` → 收窄为 skill 内部实现。本条 Proposal 与 `PUBLIC_ENTRYPOINTS` 注释同时引用
      gap-quay-launch-sh，标注其降级候选身份。

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（见下「## Execution evidence」）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**留给外层 verify**（fast-mode 判绿三条件在批量合边界；
      本任务执行指令明确 scoped 门，不跑完整套件）

## Execution evidence

```
# AC1 基线（2026-08-08 全新 build）
$ bash packages/quay/scripts/package.sh        # 见下方 AC3 门输出
$ tar tzf packages/quay/quay-0.4.0.tgz | grep -c "package/plugin/.*\.sh$"      # loose_sh_in_artifact
94
$ tar tzf packages/quay/quay-0.4.0.tgz | grep "package/plugin/.*\.sh$" | sed 's|/[^/]*$||' | sort | uniq -c
      1 package/plugin
     12 package/plugin/gate-scripts
     64 package/plugin/scripts
     17 package/plugin/scripts/checker-mutation-cases

$ grep -ohE "plugin/scripts/[a-zA-Z0-9._-]+\.(sh|ts|mjs)" plugin/loop/*.md plugin/skills/*/SKILL.md | sed 's|.*/||' | sort -u | wc -l   # consumer_facing_entrypoints
44
$ grep -ohE "plugin/scripts/[a-zA-Z0-9._-]+\.sh" plugin/loop/*.md plugin/skills/*/SKILL.md | sed 's|.*/||' | sort -u | wc -l               # .sh 子集
23

# AC2/AC3 门（capability-catalog.sh --entry-surface）
$ bash plugin/scripts/capability-catalog.sh --entry-surface
delivery form (.sh): 64 shipped | 23 declared consumer-facing | 41 internal
consumer-facing docs reference 23 distinct .sh
AC3 gate: every consumer-doc-referenced .sh is a declared public entry point → PASS
exit 0

$ bash plugin/scripts/capability-catalog.sh --entry-surface --json
{
  "sh_shipped": 64,
  "public_sh": 23,
  "internal_sh": 41,
  "doc_referenced_sh": 23,
  "violations": [],
  "ok": true
}

# AC3 fail 方向（测试实证，临时把内部件写进消费者文档 ⇒ 门非零退出并指名）
$ bash <tmp>/plugin/scripts/capability-catalog.sh --entry-surface   # <tmp> 内 loop/tick.md 引用 checker-cost-lib.sh
FAIL (AC3): 1 internal .sh script(s) are referenced by consumer-facing docs — the demotion is verbal, not real:
  checker-cost-lib.sh
exit 1

# AC3 打包接入（package.sh 在 npm pack 前对 staged 副本跑门）
$ bash packages/quay/scripts/package.sh
Checking the .sh delivery form on the staged copy (declared entry surface vs consumer docs)...
delivery form (.sh): 64 shipped | 23 declared consumer-facing | 41 internal
consumer-facing docs reference 23 distinct .sh
AC3 gate: every consumer-doc-referenced .sh is a declared public entry point → PASS
Delivery form measured: 94 loose .sh staged | consumer-facing surface declared + gated (AC3)
Staged: …/plugin (277 files)
Artifact: …/quay-0.4.0.tgz

# 顺带修复：gap-sweeptmp 提交（7db422e6）引入的 observer-registry-check.sh 未进 QUESTION 表，
# 使 catalog 基线 AC1c 门红（1 unclassified）；本执行补上声明 → 0 unclassified。
$ bash plugin/scripts/capability-catalog.sh --summary
capability-catalog: 162 scripts | 162 declared | 0 unclassified | 157 ship

# 测试（plugin/test/capability-catalog.test.mjs，含 4 个新增 entry-surface 用例）
$ node --test plugin/test/capability-catalog.test.mjs
tests 12 | pass 12 | fail 0 | cancelled 0
```

## Touches
- packages/quay/scripts/package.sh（打包门：staged 副本上跑 capability-catalog.sh --entry-surface，fail-closed）
- plugin/scripts/capability-catalog.sh（PUBLIC_ENTRYPOINTS 声明 + --entry-surface 门 + JSON surface 字段 +
  修复 observer-registry-check.sh 未声明缺口）
- plugin/test/capability-catalog.test.mjs（新增 4 个 entry-surface/AC3 用例——capability-catalog.sh 的既有测试宿主）
- tasks/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools.md（交叉标注：分界）
- tasks/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact.md（交叉标注：同族不同轴）

## Dispatch review

reviewer: none
at: 2026-08-06T17:0xZ
changed: 尚未派发/审阅（人裁定"这两条都应当建任务"后由管理者代笔立案）
