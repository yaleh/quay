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
status: ready
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

- [ ] AC1: 记录基线——`loose_sh_in_artifact` 实测（预期 86）与当前被文档声明为消费者可直接调用的脚本数
- [ ] AC2: 选定方向（收敛入口 / 明写散件 / 分层）并记录理由，不得留空
- [ ] AC3: **负控制（承重条）**——若选 1 或 3，被降级的脚本必须不再出现在任何面向消费者的
      操作说明里；若仍出现，降级只是口头的，本条不算达成
- [ ] AC4: 与 `gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools` 交叉标注，
      任务体必须写明两者的分界（那条是**界面一致性**，本条是**交付形态**），
      避免后来者把两条当成重复而合并掉其中一条
- [ ] AC5: 与 `gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact` 及
      `gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal` 交叉标注——
      三条同属"交付形态未被论证"这一族（`.sh` 散件 / `.ts` 未 bundle / 脚本被当成用户面）

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- packages/quay/scripts/package.sh
- plugin/scripts/capability-catalog.sh
- tasks/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools.md（交叉标注）
- tasks/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-06T17:0xZ
changed: 尚未派发/审阅（人裁定"这两条都应当建任务"后由管理者代笔立案）
