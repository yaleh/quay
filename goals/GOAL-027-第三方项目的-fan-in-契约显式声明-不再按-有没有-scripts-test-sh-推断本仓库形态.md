---
id: GOAL-027
title: 第三方项目的 fan-in 契约显式声明——不再按「有没有 scripts/test.sh」推断本仓库形态
status: draft
kind: goal
origin: 立条依据：2026-09-23 对第三方项目
  /data/home/yale/work/claudecodeui（CloudCLI，2026-09-20→09-23，worker-driven
  inner，142 条任务）的驱动过程复盘。人 2026-09-23 裁定：「本仓库形态靠文件是否存在来判断」立为 goal，第 1/2/6 项作为其实例
  task，其余缺陷立独立 task（「按你的意见执行」）。
---
## 背景

quay 的 fan-in / suite 调度判断「目标项目是不是本仓库形态」只有一个依据：worktree 里**有没有 `scripts/test.sh`**（`plugin/scripts/worker-fan-in.ts:64-68` `hasTestSh()`，注释原文「一个目录是否「本仓库形态」（有 scripts/test.sh）」）。一旦第三方项目按 init 的指引交付了自己的 `scripts/test.sh`，quay 就把它**整体当成 quay 仓库**：

- 按 quay 的布局解析 suite 失败归因（`worker-driver.ts:1860` 正则只认 `(packages|plugin|experiments)/…\.test\.mjs`）；
- scoped 门无条件传 `--for-task <id> --allow-thin`（`worker-fan-in.ts:151`），doc-check 调 `--static-checks-doc`（`:177`）；
- delta 分类在 worktree 里找 quay 自己的检查注册表 `plugin/scripts/runner-static-gate.ts`（`worker-fan-in.ts:1325` `--classify-delta --root <worktree>`）。

**生产读数（claudecodeui `.quay/` 载体，2026-09-20→09-23，非推测）：**

| 实例 | 读数 |
|---|---|
| 失败归因 | `worker-round.jsonl` 中 51 次 `retry_exemptions`，**`failingTestFiles` 非空 0 次**；归因不出波及 29 个不同任务，判词写「the suite log names nothing a worker could fix」 |
| delta 分类 | fan-in 日志 177 次 delta 判定中 11 次 `classify failed → run suite (fail-closed)`；之后项目**把 quay 的注册表副本提交进自己的仓库**（claudecodeui `f7604c68`）才能分类 |
| scoped 取零个文件 | 项目 `scripts/test.sh:114` 抄了「取零个文件 ⇒ exit 0」，但抄不到 quay 那一半（「full suite still runs at fan-in」）；只能自造守卫 `suite-scope-check.sh` 来防假绿 |

共性：第三方项目为了过关，被迫**逐项模仿 quay 形态**（perfile 包装、`--static-checks-doc` 桩、注册表副本）。每一处对不上，都表现为**「读不出东西」而不是报错**——正是硬规则 3b 的形状。

**与 GOAL-012 的关系（写明，免得第三次再漏）**：GOAL-012 把 kernel↔target 边界分成 A（kernel sibling）/ B（target 身份字面量）/ C（只在本仓库存在的能力）三域并已 achieved。`hasTestSh()` 正属 **C 域**：它用文件是否存在去推断「C 域能力是否可用」，而第三方项目恰好能**部分满足**这个推断。GOAL-012 的 C 域枚举覆盖的是「直接调用 dev-tree 专属测试基建」，没有覆盖「用文件是否存在当作能力声明」这种形态。AC-227（能力不存在有独立取值）也已 achieved——但本 goal 的缺口是**能力「看起来在」却不是那个能力**，与「不存在」不同形。

## 范围与非目标

范围（每项对应一条 AC）：
① fan-in / suite 调度面上不再按 `scripts/test.sh` 是否存在推断仓库形态，改为读 `.quay/config.yml` `loop:` 里**显式声明**的契约（如 `loop.test_output` / `loop.doc_surfaces` / `loop.scoped_command`；键名由实现 task 定）——**AC-316**（静态枚举）；
② 第三方 suite 失败在生产上能归因到文件——**AC-317**（读第三方生产载体）；
③ 第三方 delta 分类不依赖 quay 的检查注册表，且项目不再需要提交注册表副本——**AC-318**（读第三方生产载体）。

承载 task：AC-316 ← `gap-repo-shape-inferred-from-test-sh-existence`、`gap-scoped-gate-thin-selection-not-same-shape-as-green`；AC-317 ← `gap-suite-failure-attribution-third-party-layout`；AC-318 ← `gap-fan-in-delta-classify-declared-doc-surfaces`。

非目标（⛔ 有意排除，不是遗漏）：
- **quay 仓库自己的 dev-tree 检查器**（`tmp-leak-pairing-check.ts`、`precommit-guard.ts`、`test-group-downgrade-check.ts` 等在找不到 `scripts/test.sh` 时报错的那一批）：它们只在本仓库运行，要求文件存在是正确的，不属于「推断第三方形态」。AC-316 的面因此只取第三方 driver 在 fan-in / suite 调度上实际执行的模块。
- 同一次复盘里的其它缺陷（worker 环境级快速死亡、goal gate 的 verdict 映射、常驻 anchor 版本落后、quay-init 维护者注释泄漏）：机制与仓库形态无关，立为独立 task，不进本 goal。
- 不改 Provider ABI 与公开 CLI/MCP 表面。

## 判据形态

- AC-316 读真实仓库源码（静态枚举），带谓词正控（对已知样本必须命中 2/2），并按代码位置判定（行首注释与行尾 `//` 注释不算命中，硬规则 2）。面文件被改名或拆分时 exit 3（NOT-EVALUATED），⛔ 不当成 0 处。
- AC-317 / AC-318 读**第三方生产载体**（硬规则 4 推论三），目标项目由 `QUAY_THIRD_PARTY_ROOT` 指定，缺省为本机的 claudecodeui。载体不存在或是 quay 自身形态时 exit 3。时间窗**只计实现提交落地 develop 之后**，落地时刻由判据自己用 `git log develop --grep=<task-id>` 取得，⛔ 不写死日期。
- 三条判据落笔当轮均已在真实对象上取过读数：AC-316 exit 1（点名 `worker-fan-in.ts:66/150/177` 等 5 处）；AC-317 exit 1（未落地；落地前基线 51/0）；AC-318 exit 1（claudecodeui 仍提交着注册表副本）。三态都用夹具实跑过：AC-316 负控夹具 exit 0、夹具里加入一处调用 exit 1、面文件缺失 exit 3；AC-317 合成的已归因记录 exit 0、空窗口 exit 3；AC-318 伪造落地时刻后读出成功 166 / 失败 11，exit 1。
- ⚠️ 已知局限：AC-317/318 的时间窗以「quay develop 落地」为起点，但第三方的常驻 driver 可能仍在跑旧版本（本次复盘中 claudecodeui 的 anchor 整整 3 天停在 0.10.0）。这由独立 task `gap-driver-status-loaded-vs-installed-version-drift` 使其可见；在它落地前，判读 AC-317/318 时须先确认第三方 driver 已重启到含修复的版本。

## 退出条件

3 条 AC 全部 achieved：AC-316（fan-in/suite 调度面上按文件存在推断仓库形态的调用点 = 0）；AC-317（落地后第三方生产载体中至少 1 次 suite 红被归因到具体文件）；AC-318（第三方项目不再提交 quay 注册表副本，且落地后 delta 分类失败 = 0 并至少有 1 次成功样本）。
