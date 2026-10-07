---
id: gap-cli-task-list-json-body-coupled-to-json-flag
title: quay task list --json 把「要 JSON 格式」和「要每条 body」耦合死，没有「全量计数 + 不读 body」的投影
status: done
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
- `packages/quay/test/build-dist-smoke.test.mjs`
- `tasks/gap-cli-task-list-json-body-coupled-to-json-flag.md`

## AC
- [x] 复现基线：本仓库同一 store 上 `task list`（非 --json，省读路径）vs `task list --json`（全量 body）的真实耗时对照（已有基线：0.422s vs ~3.4s），把读数贴进完成记录。
- [x] 新 flag 加上后：`task list --json --no-body`（或实现选定的实际 flag 名）对本仓库真实 store 的实测耗时接近非 --json 的省读路径量级（不是接近全量 body 路径），把真实耗时贴进完成记录。
- [x] 新 flag 输出是合法 JSON 数组，每条任务对象不含 `body` 字段，且数组长度 == 全量任务数（不截断、不分页）——用本仓库真实 store 验证 `.length` 与 `task list --json | python3 -c '...'` 的全量计数一致。
- [x] 未传新 flag 时 `task list --json` 的既有行为（body 齐全、字段形状）零回归：`node --experimental-strip-types --test packages/quay/test/cli.test.mjs` 退出 0。
- [x] 新增用例断言：传新 flag 时 `client.taskList` 收到的 filter 里 `includeBody:false`（用注入的假 provider/client 捕获调用参数断言，不是读输出猜）。
- [x] `bash scripts/test.sh --for-task gap-cli-task-list-json-body-coupled-to-json-flag` 退出 0，且执行了 ≥1 个测试文件。

该轴仍暗，理由：本任务改动范围限于单个 CLI 命令文件新增一个输出开关 flag，复用已存在的 Provider `includeBody:false`
路径，不新增模块、不新增包间依赖、不改变调用图结构，L_D/L_G（依赖结构/重复抽象）轴对此类单文件 flag 新增不提供信号。

## DoD
真实落地：在本仓库自己的真实 store 上，新 flag 组合（`--json` + 省读）给出全量计数且不读 body、实测耗时明显低于当前
`--json` 全量 body 路径的基线，该读数是实跑量出来的，不是依据代码推断。

## Evidence
**实现**：给 `task list` 增加 `--no-body`。`packages/quay/src/cli/task-list.ts` 的 `wantBodiesInOutput` 由
`wantsJson === true` 改为 `wantsJson === true && flags["no-body"] === undefined`，于是 `--json --no-body` 走既有的
`providerFilter.includeBody = false` 下推路径（与表格视图/web board 同一份 frontmatter-only 投影），返回的仍是**全量**
数组（不截断、不分页）；不传该 flag 时 `--json` 行为不变。`cli/help.ts` 的 task-list 用法行与选项说明同步加上 `--no-body`。

**真实读数**（本仓库真实 store，2591 个任务；跑的是本任务 worktree 的代码，`--root /data/home/yale/work/quay`；best-of-3）：

| 命令 | 耗时 | 输出字节 | 每条含 body |
|---|---|---|---|
| `task list`（表格，includeBody:false） | 0.587s | — | 否 |
| `task list --json`（全量 body） | 3.370s | 26,584,809 | 是 |
| `task list --json --no-body`（新） | 0.496s | 1,428,739 | 否 |

- **AC1 基线对照**：0.587s（省读路径）vs 3.370s（全量 body）——与本任务 Proposal 记录的 0.422s vs ~3.4s 同一量级，
  `--json` 全量 body 路径复现出 ~3.4s。
- **AC2 新 flag 量级**：`task list --json --no-body` = 0.496s，贴近非 --json 省读路径（0.587s），远低于全量 body 路径
  （3.370s），约 6.8×。
- **AC3 全量计数/形状**：`task list --json --no-body` 解析为合法 JSON 数组，`len=2591`、`any_body=False`；同 store
  `task list --json` 亦 `len=2591`、`any_body=True`——全量计数一致，新 flag 只省读、不截断。
- **AC4 零回归**：`node --experimental-strip-types --test packages/quay/test/cli.test.mjs` 退出 0（tests 1 / pass 1 /
  fail 0）；同一命令下新增的 block33 case (b) 断言 `--json`（无 flag）每条仍 `"body" in t` 全 true。
- **AC5 注入断言**：`cli.test.mjs` 新增 block33，用注入的假 Provider MCP server（把收到的 `task_list` 参数落盘），断言
  `--json --no-body` 时 `aArgs[0].includeBody === false`——断言的是**下推的调用参数**，不是读输出猜。该假 Provider 同时
  按 `includeBody` 决定是否剥 body，使「调用参数」与「输出形状」两条断言互相印证。
- **AC6 scoped 门**：按本仓库 `.quay/config.yml` 的 `loop.scoped_command`（即驱动 fan-in 实际执行的形态）
  `bash scripts/test.sh --for-task gap-cli-task-list-json-body-coupled-to-json-flag --allow-thin` 退出 0，`cli.test.mjs`
  在内实际执行（≥1 个测试文件）；已写 scoped-gate 缓存。⚠️ 不带 `--allow-thin` 的裸形态退出 1，原因是本任务 Touches 中只有
  能按 basename 配对到测试的条数不足一半（选择器判定 thin）——这是 Touches 形状的属性，不是测试失败（测试本身照跑照过），
  也正是驱动侧 `scoped_command` 带 `--allow-thin` 的原因。

**落地阻断的修复（境外 suite 红，2026-10-07）**：fan-in 的 suite 步红在
`packages/quay/test/build-dist-smoke.test.mjs:122`（`(b) serve --port + HTTP GET returns 200`：`GET /tasks` 实测 404）。
根因**不在本任务 delta**（本任务只改 `cli/*.ts` + `cli.test.mjs`），而是该用例自身的端口选择缺陷在共享宿主上撞车：

- 该用例用 `18000 + Math.floor(Math.random() * 1500)` 选一个**固定随机端口** P，再 `spawn(bundle, serve --port P)`
  （host 默认 `0.0.0.0`，`stdio:"ignore"`）。宿主的 18000–19500 区间里**确有其它的监听者**（实测 `ss -ltn` 命中
  18772/18774/18968/19167 等非本仓进程）。撞上时本方子进程绑定 `0.0.0.0:P` 抛 `EADDRINUSE` 静默退出（stdio 被 ignore，
  无任何诊断），而 `httpGet(127.0.0.1:P, "/tasks")` 连到的是**别人的监听者**，它返回 404 —— 一条伪装成「serve 坏了」的假读数。
- **判据（404 只可能来自外来监听者）**：`serve-handlers.ts` 里 `/tasks` 由 `handleTaskList` 处理，该 handler **没有任何
  404 出口**；全文件唯一的 `404` 是路径匹配链末尾的 fall-through。所以本方 server 对 `/tasks` 不可能回 404。
- **对照（若根因判断为假则结果会不同）**：独立复现——先起一个占用 127.0.0.1:P 的外来 server（`/tasks` 回 404），再以
  `0.0.0.0:P` 绑定本方 server，实测 `EADDRINUSE`，随后 `GET 127.0.0.1:P/tasks -> 404`，与观测到的失败逐字一致。

**修法**：改用内核分配端口 `--port 0`（与 prod/launcher 同一条契约），端口从子进程自己打印的
`quay serve: listening on http://<host>:<port>` 行解析——内核不会把一个**在用**的端口发出来，撞车在结构上不可能；`stdio`
改为 pipe，子进程**提前退出会被显式诊断**（不再伪装成一条 HTTP 读数）。另把断言从「状态码 200」加强为「200 **且** 页面上
有本工作区种子任务 `SMOKE1`」——200 本身可被任一 quay serve 满足，只有内容能证明读的是**我们自己**的 server。实测：
`node --test packages/quay/test/build-dist-smoke.test.mjs` 4/4 pass（`(b)` 由 630ms 降到 ~250ms）。


**本轮（2026-10-07）suite 红的归因**：fan-in suite 红在境外文件 `packages/quay/test/server-status-web-control-same-pid.test.mjs:189` —— `res.json.status` 实测 `degraded`、期望 `running`。判为**非本任务 delta** 的宿主抖动，依据三条：①该文件不在本任务 Touches/diff 内，develop 也没改过它（**非 branch-lag**——`git diff develop...HEAD -- <该文件>` 为空）；②单跑该文件 14/14 pass，且 **6 份并发副本 6/6 pass**（0 red），无负载相关复现；③本任务连续三轮 fan-in suite 各红在**三个不同**的单文件（relation-sync → build-dist-smoke → server-status-web-control），前两个单跑同样全绿，且第二个（build-dist-smoke）已作为真实缺陷修掉。机制旁证：该文件自己的注释写着它**在本进程内**托管 server，故探针（`PROBE_TIMEOUT_MS=4000`）被饿死即读成 `degraded`。cgroup 排除内存因素：`run-u79887.scope` MemoryMax=16G / peak=12.2G / `memory.events max=0` / memory.pressure 三项 psi 皆 0。本轮四文件 delta 单测逐条复验：`cli.test.mjs` pass 1/fail 0、`build-dist-smoke.test.mjs` 4/4，真 store 实测 `--json --no-body` len=2591/anyBody=false vs `--json` len=2591/anyBody=true。