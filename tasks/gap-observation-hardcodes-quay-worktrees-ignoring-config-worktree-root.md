---
id: gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root
title: 第三方项目 dashboard 的「在飞」显示的是别的项目的任务——observation 硬编码 quay-worktrees
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（实测）**：第三方项目 quay-fleet（tasks/ 为空，零任务派发）的 `/dashboard` 与 `/live`
显示 **「在飞 2 / 上限 5」**，两条都是 **quay 自己的任务**：
`gap-suite-wallclock-budgets-literals-depend-on-host-capacity · 实现中 · 25m12s`、
`gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak · 实现中 · 14m12s`。

**根因（定位到函数）**：`packages/quay/src/observation.ts` 的 `taskWorktreeOpen()`：

```ts
const namespace = path.join(path.dirname(path.resolve(root)), "quay-worktrees");
```

它**硬编码 `quay-worktrees` 这个目录名**，无视 `.quay/config.yml` 的 `loop.worktree_root`。

**实测三个读数**：
```
quay-fleet config    loop.worktree_root: /home/yale/work/quay-fleet/../quay-fleet-worktrees
observation 推导出                       /home/yale/work/quay-worktrees      ← quay 自己的
该目录实际内容                            14 个 worktree（全部是 quay 的任务）
quay-fleet 自己的 worktree 目录            不存在（尚无派发，符合预期）
```

**该函数的 fail-closed 设计本身是对的**——它的注释写明「namespace 不存在 ⇒ 返回 null，
never a positive 'released' signal from a source that could not be observed」。
**坏的是它的前提假设**：它假定 `<parent-of-root>/quay-worktrees` 要么属于本项目、要么不存在。
同一个父目录下并存多个项目时（`/home/yale/work/quay` 与 `/home/yale/work/quay-fleet`），
这个假设破裂——namespace 存在，于是它不 fail-closed，而是**用别的项目的目录回答本项目的问题**。

**「写用 config、读用硬编码」**：多处代码与注释引用 `loop.worktree_root` 作为 worktree 落点
（`inner-blocked-signal.ts:33,294`、`test-isolation-check.ts:415,432,1262`），
即**写侧读 config**；而本函数读侧硬编码。两侧不一致。
⇒ 后果：**派发本身是安全的**（建在 config 指定的目录），**但 dashboard/live 的在飞显示永远指向别的项目**。

**同族硬编码字面量还在别处**（本任务应一并收口，硬规则 5b：修一个不等于只有一个）：
`plugin/scripts/fast-mode-telemetry.ts`（:232 :258 :287 :320 :487 :506，6 处）、
`plugin/scripts/measure-trend-check.ts`（:100 :110，2 处）。

**查重（立案时，按机制）**：`taskWorktreeOpen` 命中 2 条，均 done、均非本机制——
`gap-live-ghost-superseded-task-workflow-events-start`（inFlight 缺 status 过滤）与
`gap-serve-board-test-workspace-couples-to-shared-tmp-quay-worktrees`（测试隔离；
它逐字裁定「`taskWorktreeOpen` 的 `dirname(root)` 语义是对的，⛔ 不要为了迁就测试去改生产判定」——
**那条裁定的语境是测试 fixture 建在裸 `/tmp` 下，不涉及第三方项目的 `loop.worktree_root`**，
故与本条不冲突，但改动时须保证它的两个取假控制仍绿）。

## Plan

1. `taskWorktreeOpen()` 改为读 `.quay/config.yml` 的 `loop.worktree_root`（解析 `..` 后规范化），
   仅在 config 缺该键时才回落到 `<parent-of-root>/quay-worktrees`，且回落时必须留一条可见痕迹
   （不得静默回落——静默回落正是本缺陷的形态）。
2. 同一份解析落成**单一入口**（如 `resolveWorktreeNamespace(root)`），
   `fast-mode-telemetry.ts` 与 `measure-trend-check.ts` 的 8 处字面量一并改为调用它。
3. 加静态检查：`packages/quay/src` 与 `plugin/scripts` 下不得再出现字面量 `"quay-worktrees"`
   （除该单一入口内部的回落分支）。

## 根因更正（实现时实测；硬规则 4 推论四：一个能解释现象的说法不等于被检验的结论）

立案时的因果链（`taskWorktreeOpen` → 在飞显示指向别的项目）**经测量被证否**：
`taskWorktreeOpen` 只做**移除**（`readLive` 里 `filter(... !== false)`，幽灵清理），
结构上不可能**新增**外来任务；quay-fleet 既无 `.workflow-events/`、其
`worker-round.jsonl` 的 `in_flight_tasks` 又是 `[]`，故它对一个空列表做过滤。

**区分性对照（一条命令）**：`readLive(root)` 对两个 root 返回**完全相同**的五条任务
（`/home/yale/work/quay` 与 `/home/yale/work/quay-fleet` 逐条一致），而 `taskWorktreeOpen`
在 quay-fleet 上作用于空集 ⇒ 症状与它无关。

**真实机制**：`readLive` 的 **/proc worker 扫描是 HOST-GLOBAL 的**，唯一闸门是
`workerDriverActive(root)`——它说的是「本工作区**有**driver」，**不是**「这些进程**属于**本工作区」。
quay-fleet 的 driver 在跑 ⇒ 扫描照跑 ⇒ 把 quay 的 5 个 worker 当成自己的「在飞」。
⇒ 同族、同载体、方向相反的一半（硬规则 5b）。**已一并修**：

* `readLiveWorkerProcesses(procDir, { root })`：按 worker **自己声明的** `Repo root: <path>`
  （worker-driver.ts 机器生成的 dispatch prompt）直接量归属；无可归属标记者**排除**（fail-closed
  向「不是我的」），且进程信号本就只是 driver 自己 carrier（round `in_flight_tasks` / outcome）的
  补充，降级为 carrier 视图而非凭空消失。
* 两处调用点均收口：`observation.ts readLive` 与 `serve-task.ts taskRunsBlock`（同形兄弟点）。

## Acceptance Criteria

- [x] AC1（负控制，改前必须红）：构造两个相邻项目 A、B 共父目录，A 的 worktree 命名空间非空、
      B 的 config `loop.worktree_root` 指向自己的空目录；改前 `taskWorktreeOpen(B, <A的任务id>)`
      返回 `true`（用 A 的目录回答 B），改后返回 `false`。
      实测：`packages/quay/test/observation-worktree-namespace.test.mjs` 第一条用例**逐字断言了
      「改前红」**（`fs.existsSync(<parent-of-B>/quay-worktrees/TASK-A) === true`）再断言改后 `false`，
      且带非空转对照（A 读自己的 namespace 仍 `true`）。
- [x] AC2：B 的 config 缺 `loop.worktree_root` 时回落，且回落这一事实可被观测（stderr 或返回的
      诊断字段），不得静默。
      实测：`resolveWorktreeNamespace` 返回 `source:"fallback"` + `diagnostic`；`taskWorktreeOpen`
      另把该诊断写 stderr（**每 namespace 每进程一次**，避免每次渲染刷屏），
      「config 文件缺失」与「有 config 但缺键」两种成因诊断文本不同。
- [x] AC3：`grep -rn '"quay-worktrees"' packages/quay/src plugin/scripts` 的命中数 ≤ 1
      （只剩单一入口内的回落分支）——静态检查器 + 双向控制（把一处改回字面量必须红）。
      实测：命中数 = 1（`packages/quay/src/worktree-namespace.ts:46` 的
      `DEFAULT_WORKTREE_NAMESPACE_NAME` 声明）；新检查器
      `plugin/scripts/worktree-namespace-literal-check.ts` 的测试含**三条 RED fixture**
      （第二处字面量红 / plugin 侧字面量红 / 唯一命中不在 resolver 声明处红），证明它会咬。
      ⚠️ 检查器自身**不含**该字面量（它搜 `JSON.stringify(DEFAULT_WORKTREE_NAMESPACE_NAME)`），
      否则它会把自己算成第二处。
- [ ] AC4：全量 `scripts/test.sh` 绿（待外部）

## Definition of Done

在真实第三方项目 /home/yale/work/quay-fleet 上（非 fixture），`/dashboard` 与 `/live`
的「在飞」计数为 0（该项目确无派发），且页面上不出现任何 quay 自己的任务 id。
fixture 满足不算数（硬规则 4 推论三）。

**已实测（2026-09-13，本任务 worktree 的实现 + 真实项目为输入，非 fixture）**：
用**真实 handler**（`renderLivePage` / `renderLiveCard`）渲染真实项目：

```
/home/yale/work/quay-fleet
   namespace: /home/yale/work/quay-fleet-worktrees   source: config
   /live      : 「在飞: 0 / 上限: 5」   页面含 quay 任务 id? false
   /dashboard : 「在飞 0 / 上限 5」     卡片含 quay 任务 id? false
/home/yale/work/quay（对照：拥有者项目不被修坏）
   namespace: /home/yale/work/quay-worktrees        source: config
   /live      : 「在飞: 5 / 上限: 5」   页面含其自身任务 id? true
```

## Evidence

* **改前红（AC1 负控制）**：fixture 把 A 的 namespace 造成历史名 `<parent>/quay-worktrees`，
  于是旧推导 `dirname(B)/quay-worktrees` 正落在 A 的 namespace 内 —— 测试**显式断言该前提为真**
  （改前必红），再断言改后 `false`。
* **typecheck**：`for d in packages/*/; do npx tsc --noEmit -p "$d"; done` 全绿。
* **scoped gate**（`scripts/test.sh --for-task <id> --allow-thin`）：**绿，264/264，0 fail**
  （含 `packages/quay/test/npm-pack-e2e.test.mjs` 9/9）。
* **受影响既有测试**：`packages/quay/test/observation.test.mjs`、`packages/quay/test/serve.test.mjs`、
  `packages/quay/test/serve-task.test.mjs`、`plugin/test/fast-mode-telemetry.test.mjs`、
  `plugin/test/measure-trend-check.test.mjs`、`plugin/test/suite-lpt-order.test.mjs` —— 全绿。
  含 `gap-serve-board-test-workspace-couples-to-shared-tmp-quay-worktrees` 的两个取假控制仍绿。
* **scoped gate 首轮红 → 两处真因（都已修，非放宽判据）**：
  1. `serve-task.test.mjs:121` 断言 `observation.ts` 不含 `git worktree add`（develop 读必须
     只读 object store）。我在 `taskWorktreeOpen` 的 docblock 里**用散文写出了那条命令**⇒ 命中。
     改掉措辞（该 guard 是关键词扫描，散文也必须避开命令写法）。
  2. `npm-pack-e2e` 8/9 红：新 `plugin/scripts/*.ts` 未在 `capability-catalog.sh` 声明
     **它回答什么问题**（AC1c）+ 结晶四字段 ⇒ `capability-catalog.sh --entry-surface` 退出 1
     （**打印 PASS 却退出 1** —— 该模式下 FAIL 文案在 `MODE=table` 分支里，静默失败；
     这是我**先用 `| tail` 读到 rc=0 的假读数**才发现的一次教训，`rc=$?` 取的是 `tail` 的）。
     已按入口闸补齐 QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING / CONSUMER 六行；
     MATCHING 诚实填 **keyword**（它确是字面量扫描 = AC 自身谓词；假阳性面——非引号正则/注释/散文
     用法——被单独放进 advisory 桶，永不导致失败）。
* **兄弟硬编码点清单（硬规则 5b：报出，非全改）**：检查器每次运行打印 advisory 命中数
  （当前 38+ 条，含注释）。其中**仍是真假设**的完整枚举：
  `plugin/scripts/suite-lpt-order.ts:34`（`repoRelKey`，与 `normalizePerFileKey` 同口径；
  **未改**，以免把爆炸半径伸进套件自身调度路径）、
  `packages/quay/src/cli/driver.ts:54` + `cli/help.ts:356`（`driver start` 从 worktree 启动的**拒绝**判定，
  是有意的约定快速路径，其后有通用 linked-worktree 兜底）、
  `plugin/scripts/resource-gate.sh:264`（`ps | grep` 负载量）、
  `plugin/scripts/loop-shipping-exclusion-data.mjs:80`（文档注释）。
* **本任务未做**：全量 suite（fan-in 机械步骤；AC4 已按 `（待外部）` 标记，走外层验收）。

## Touches

- packages/quay/src/worktree-namespace.ts
- packages/quay/src/observation.ts
- packages/quay/src/serve-task.ts
- plugin/scripts/fast-mode-telemetry.ts
- plugin/scripts/measure-trend-check.ts
- plugin/scripts/worktree-namespace-literal-check.ts
- plugin/scripts/capability-catalog.sh
- packages/quay/test/observation-worktree-namespace.test.mjs
- plugin/test/worktree-namespace-literal-check.test.mjs
- tasks/gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root.md（自身）
