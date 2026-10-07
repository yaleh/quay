---
id: gap-cli-task-list-json-body-coupled-to-json-flag
title: quay task list --json 把「要 JSON 格式」和「要每条 body」耦合死，没有「全量计数 + 不读 body」的投影
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**背景（另一会话在 claudecodeui 侧核实，本会话复核确认）**：claudecodeui 的 Quay 面板实际调用是裸
`['task','list','--json']`（`server/modules/quay/quay.service.ts:755`），**不传** `--page-size`，也不传 `--sort`。它的
`summarizeTasks()`（同文件 359-378 行）只需要每条任务的 `id`/`title`/`status`/`updatedAt`，靠 `value.length` 和逐条
`status` 统计出 `total`/`byStatus`/`ready`/`needsHuman`/`done`，**从不读 body**。

**现有能力已经证明可行、只是没对外露出**：`packages/quay/src/cli/task-list.ts` 第 66 行
`const wantBodiesInOutput = wantsJson === true;` 把"要 JSON 输出格式"和"要每条任务的 body"硬耦合——只要有 `--json` 就
一定读全部 body，没有任何办法绕开。而非 `--json` 路径（第 101-104 行 `needBodies = wantBodiesInOutput ||
searchQuery !== null`，为 false 时 `client.taskList({ status, includeBody: false })`）已经证明这条省读路径真实可用、
而且快：本仓库实测（2589 任务）——

```
time (.quay/plugin/bin/quay task list | wc -l)          # 0.422s（非 --json，走 includeBody:false）
time (.quay/plugin/bin/quay task list --json | wc -c)    # ~3.4s（--json，强制全量 body）
```

同一个 store，省读路径快了近 8 倍——这不是推测的收益，是已经在生产代码里跑着的另一条路径的真实对照读数。缺的只是
「JSON 输出格式」+「省读（不要 body）」这个组合：今天只有「文本输出格式 + 省读」和「JSON 输出格式 + 全量 body」两种
组合，没有第三种。

<!-- dedup-ref -->本任务 Touches 与 `gap-cli-task-list-page-size-post-hoc-slice-not-pushed-down`（进行中）重叠同一个
文件（`cli/task-list.ts`），按该任务的「Touches 重叠自然序列化」惯例，本任务应在其落地（develop 上有该任务的提交）之后
再派发，不是并行改同一文件；两者是独立能力（一个是 page/pageSize 下推，一个是 body 省读开关），不是重复，不互相阻塞
对方的 AC。

**修法方向**：给 `task list` 加一个显式 flag（例如 `--no-body`，具体命名以实现时惯例为准）使
`wantBodiesInOutput` 在传了 `--json` 时也能被它压成 false（当前第 66 行是 `wantsJson === true` 的硬编码，改成
`wantsJson === true && !noBodyFlag`），不传该 flag 时现有行为（`--json` 总是带 body）零回归。省读窗口内不截断——
返回全量数组（不分页），每条任务仍带 `id`/`status`/`title`/`updatedAt` 等 frontmatter 字段，只是不带 `body`，这样
`summarizeTasks()` 式的"数全量 + 统计 byStatus"类调用方既能拿到完整计数、又不用付 body 解析/序列化的代价。

**消费方后续（claudecodeui 侧，仅记录供其跟进，不在本任务范围内处理）**：本任务落地后，claudecodeui 若要吃到这个收益，
需要把 `quay.service.ts:755` 的调用改成带上新 flag；该改动不在本任务范围，由 claudecodeui 自己的会话判断是否跟进。

## Touches
- `packages/quay/src/cli/task-list.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/test/cli.test.mjs`
- `tasks/gap-cli-task-list-json-body-coupled-to-json-flag.md`

## AC
- [ ] 复现基线：本仓库同一 store 上 `task list`（非 --json，省读路径）vs `task list --json`（全量 body）的真实耗时对照（已有基线：0.422s vs ~3.4s），把读数贴进完成记录。
- [ ] 新 flag 加上后：`task list --json --no-body`（或实现选定的实际 flag 名）对本仓库真实 store 的实测耗时接近非 --json 的省读路径量级（不是接近全量 body 路径），把真实耗时贴进完成记录。
- [ ] 新 flag 输出是合法 JSON 数组，每条任务对象不含 `body` 字段，且数组长度 == 全量任务数（不截断、不分页）——用本仓库真实 store 验证 `.length` 与 `task list --json | python3 -c '...'` 的全量计数一致。
- [ ] 未传新 flag 时 `task list --json` 的既有行为（body 齐全、字段形状）零回归：`node --experimental-strip-types --test packages/quay/test/cli.test.mjs` 退出 0。
- [ ] 新增用例断言：传新 flag 时 `client.taskList` 收到的 filter 里 `includeBody:false`（用注入的假 provider/client 捕获调用参数断言，不是读输出猜）。
- [ ] `bash scripts/test.sh --for-task gap-cli-task-list-json-body-coupled-to-json-flag` 退出 0，且执行了 ≥1 个测试文件。

该轴仍暗，理由：本任务改动范围限于单个 CLI 命令文件新增一个输出开关 flag，复用已存在的 Provider `includeBody:false`
路径，不新增模块、不新增包间依赖、不改变调用图结构，L_D/L_G（依赖结构/重复抽象）轴对此类单文件 flag 新增不提供信号。

## DoD
真实落地：在本仓库自己的真实 store 上，新 flag 组合（`--json` + 省读）给出全量计数且不读 body、实测耗时明显低于当前
`--json` 全量 body 路径的基线，该读数是实跑量出来的，不是依据代码推断。
