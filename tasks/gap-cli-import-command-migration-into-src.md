---
id: gap-cli-import-command-migration-into-src
title: cli-import 后续期——逐命令实现搬迁进 src/（run() 壳已就位）
status: todo
labels:
  - gap
  - performance
  - product
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（任务 gap-cli-import-refactor-run-shell-architecture :77）**：run()/shell 架构已就位
（`bin/quay.ts` 导出 `run(argv, ctx)`，原 1194 行 main() 整体为 dispatch 体未逐行改写），但
**命令实现仍在 bin/quay.ts 的 dispatch 体内**——`packages/quay/src/` 未改。任务体明写
「架构已就位，逐命令搬迁为后续任务」。

**后续期 = 逐条把命令实现（每个 verb 的 handler）从 bin/quay.ts 的 dispatch 体搬到
`packages/quay/src/` 对应模块**，bin/quay.ts 只剩薄壳（argv→run→exit）。目的：
① 命令逻辑可 import 直测（AC2 的零派生测试扩展到全部命令，不止 4 个纯函数）；
② 减少 bin/quay.ts 单文件体积（当前 1194 行 dispatch 体）；
③ 每搬一条命令，其行为都有 golden-replay 等价证据（AC4 手法复用）。

**为什么逐条**：整批搬迁 = 大 diff + 高冲突风险（vhs 侧 49 双改文件含 bin/quay.ts）。
逐条 = 每次一个小 diff，可独立 scoped 验证，冲突面小。**顺序**：按调用频率 / 测试覆盖缺口。

## Plan

1. 枚举 bin/quay.ts dispatch 体内的命令 handler（parseVerbless 已有 4 纯函数 export 为先例）。
2. 逐条搬到 `packages/quay/src/<command>.ts`，bin/quay.ts 只留 import + dispatch 跳转。
3. 每条搬迁配 golden-replay 等价证据（复用 cli.test.mjs block26 手法）。
4. 逐条 scoped 绿 → 全量绿 → fan-in。

## AC

- [ ] AC1: ≥N 条命令 handler 从 bin/quay.ts 搬进 src/（dispatch 体显著缩小）
- [ ] AC2: 搬迁命令的测试可从 import 直调（零派生），扩展零覆盖缺口
- [ ] AC3: 每条搬迁有 golden-replay 等价证据（无行为漂移）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿
- [ ] AC5: 全量套件绿 + 无回归

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 搬迁清单 + 每条的 golden-replay 证据贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿——外层 verification-round 验证

## Touches

- packages/quay/bin/quay.ts（薄壳化：dispatch 体缩减）
- packages/quay/src/（新搬迁命令模块）
- packages/quay/test/cli.test.mjs（import 直调扩展 + golden-replay）
- tasks/gap-cli-import-command-migration-into-src.md（自身）
