---
id: gap-meta-driver-no-steering-channel-focus-unreachable
title: 常驻 meta-driver 无任何可用的人工转向通道——--focus 既不被 driverArgvForKind
  透传，且即使透传也是进程级常量并使 :505 每轮强制判读，永久废掉变化检测闸
status: done
labels:
  - gap
  - meta-driver
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/meta-driver.test.mjs
---
## Finding

**结论**：人给常驻 meta-driver 提具体要求，**当前没有任何可用通道**。`--focus` 看起来是那个通道（帮助文本 `:1379` 明写「本轮的人给的方向」），但它在**两个独立的地方**结构上不可用——修好任一个都不够。

### 一、两条独立的证否（按位置读）

**① 根本传不进去。** `plugin/scripts/driver-runtime.ts:381-393` 的 `driverArgvForKind` 组装的是**固定 argv**：

```
const args = ["--root", root];
if (opts.cap) args.push(spec.capFlag, opts.cap);
if (spec.hasInterval && opts.interval) args.push("--interval", opts.interval);
if (spec.hasReconcile && opts.reconcileInterval) args.push("--reconcile-interval", opts.reconcileInterval);
args.push("--pid-file", opts.pidFile, "--run-id", opts.runId);
```

`opts` 的类型里没有 focus，**也没有任何扩展点**。⇒ `quay driver start --kind meta` 起的进程恒无 `--focus`。

**② 即使传进去了也是错的形态，且会引爆成本。** `meta-driver.ts:1414` 在**启动时**解析一次 `--focus`，`:1452` 把它塞进 `metaDriverRoutines(root, {..., focus})` ⇒ **它是进程生命期内的常量**：改要求必须重启驱动，而重启会丢掉在飞轮次。更糟的是 `:505`：

```
if (args.focus) return { judge: true, reason: "focus given by human" };
```

⇒ **只要 focus 非空就每轮强制判读**，`readingsDigest` 变化检测闸与 `JUDGE_FLOOR_MS_DEFAULT`（24h 地板）**双双被绕过**。常驻 + 非空 focus = 每轮无条件派一次 LLM 判读。本会话已实测过同族事故的量级：一次 resident 配置错误造成 35 分钟内 23 轮 / 约 550 次 criterion spawn。

⊢ ② 是硬规则③b 的形态：`--focus` 这个参数**存在、有帮助文本、语义看起来正确**，让人以为通道有了——「一个看起来覆盖了的选项」比「没有该功能」更贵。

### 二、正确形态已有成熟先例，就在本仓库（硬规则①：用机件，不手搓）

`orchestration/dispatch-preference.md` 是 manager 给**常驻 worker-driver** 提要求的正本，且已解决本条的每一个问题：

- **每轮读、非启动时读**：`plugin/scripts/driver-runtime.ts:736` 把它的内容读进选择 prompt（`"Before choosing, read orchestration/dispatch-preference.md — its 覆盖段 carries the current priority (manager-maintained)."`）⇒ 改文件即刻生效，**无需重启**。
- **git 可见、不在 gitignored 的 `.quay/` 下**：文件头注释自陈理由——「可 diff、抗 compact、跨会话重启存活」。
- **结构被机械保证**：三段（默认段 / 覆盖段 / 维护者字段），缺任一段即红，由 `plugin/scripts/dispatch-preference-check.ts` 强制（`PREFERENCE_FILE_REL`，`SECTION_MIN_CONTENT_CHARS` 防占位符充数）。
- **它自己还带着本项目最贵的一条纪律**：覆盖段明写「⛔ 本条【不列任务 id】」——因为谓词形会**自动到期**，而列 id 的散文承诺是**惰性过期且与「从未设过优先级」同形**（硬规则⑨）。

⇒ 本条不发明新机制，**照抄这个形态**。`dispatch-preference-check.ts` 已支持 `--file <path>`（`:23` 用法、`:110` 路径解析「--file wins」），故**零新脚本、零三闸注册**（不新增 `plugin/scripts/*.ts` ⇒ 不触发 outline + capability-catalog + laydown 三闸）。

### 三、触发条件必须换成「变了」，⛔ 不是「非空」

`:505` 的 `if (args.focus)` 是为**一次性 CLI 调用**设计的，搬到常驻场景直接变成每轮强制判读。文件形态的正确触发是：**把覆盖段内容纳入 `readingsDigest`**——内容变了 ⇒ 摘要变 ⇒ 判读一次；内容不变 ⇒ 摘要不变 ⇒ 不判。这与既有闸同源，不新增旁路。

⚠️ **注意与另一条约束的区别**：`staleSecs`/记录数**不得**进摘要（每轮都变 ⇒ 摘要恒不相等）；而覆盖段内容**只在人编辑时变**，进摘要正是它该有的行为。两者不矛盾，判据须分别断言。

**方向倾向（供执行者判断，非强制）**：新增 `orchestration/meta-driver-focus.md`（三段式），`collectReadings` 每轮读其覆盖段填入 `readings.focus`，覆盖段内容进 `readingsDigest`，`:505` 的强制判读分支改为仅在 CLI `--focus` 显式给出时生效（保留一次性人工干跑的用法）。⛔ **不接受**：把 focus 塞进 `.quay/` 下的控制 JSON（gitignored ⇒ 不可 diff、不抗 compact，先例文件头注释已逐字否掉这条路）；⛔ 新增 driver kind 或新增周期性检查器（SPEC §5.1）。

## AC

- [x] `orchestration/meta-driver-focus.md` 存在且三段齐全（默认段 / 覆盖段 / 维护者字段），由 `dispatch-preference-check.ts --file <该路径>` 判定 exit 0；删掉任一段 ⇒ exit 非 0（负控制，两个方向都断言）。
- [x] 每轮读、非启动时读：断言 `collectReadings` 在**不重启进程**的前提下，覆盖段内容改变后下一次调用取到的 `focus` 随之改变（⛔ 不得用「传 --focus 参数」冒充——判据须穿过读文件这一层，硬规则 4c）。
- [x] 触发条件是「变了」而非「非空」：断言①覆盖段内容不变时 `readingsDigest` **不变**（⇒ 不判读）；②覆盖段内容改变时 `readingsDigest` **改变**（⇒ 判读一次）。两条都要，缺一即无法区分「每轮强制判读」与「按变化判读」。
- [x] `:505` 的每轮强制判读不再对文件形态生效：断言在覆盖段非空且**未变化**的轮次，`shouldJudge` 返回不判读（⛔ 这条是成本护栏，必须能取假）；同时保留 CLI `--focus` 显式给出时的一次性强制判读行为不回归。
- [x] probe 规格写明覆盖段如何被使用，且写明与 dispatch-preference 同源的纪律：⛔ 覆盖段不列具体对象 id（谓词形自动到期，列 id 的散文承诺惰性过期且与「从未设过」同形）。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），三条负控制（缺段 / 摘要不变 / 摘要变）均实跑确认能取假。
- [x] **生产载体证据（非 fixture）**：改动落地后，在**真实运行的**常驻 meta-driver 上做一次端到端验证——编辑覆盖段，贴出「下一轮真实记录里 focus 内容已更新且发生了一次判读」的输出；随后**不再编辑**，贴出「其后至少一轮未因 focus 而判读」的输出。两半都要（硬规则④推论三：只证明能产出不算已产出）。
- [x] ⛔ 未新增 `plugin/scripts/*.ts`（不触发 outline + capability-catalog + laydown 三闸）；⛔ 未新增 driver kind、未新增周期性检查器（SPEC §5.1）。
- [x] ⛔ 未把 focus 放进 gitignored 的 `.quay/`；文件在 git 可见路径下，可 diff。
- [x] `driverArgvForKind` 未改动——**文件形态已使 argv 透传多余**（判断：不需要改，理由见 ## Evidence 末段）：常驻的人给方向通道是 `orchestration/meta-driver-focus.md`（`collectReadings` 每轮现读，不经过 argv）；`--focus` 保留为一次性人工干跑（`--once`）的显式参数，本就由人直接跑 CLI 传参、不经 `driverArgvForKind`。

## Evidence

### 判据实跑（DoD 三条负控制，⛔ 贴输出非转述）

- **AC 单测**：`node --experimental-strip-types --test plugin/test/meta-driver.test.mjs` → `pass 84 / fail 0`
  （新增 5 条：readFocusFile「每轮读，非启动时读」/「文件缺失 ⇒ null」/「覆盖段标题缺失 ⇒ null」、
  `readingsDigest` focus 进出摘要、`shouldJudge` 成本护栏）。
- **AC1 结构检查**：`node --experimental-strip-types --test plugin/test/dispatch-preference-check.test.mjs` → `pass 14 / fail 0`
  （新增 4 条：focus 文件 `--file` exit 0 + 删默认段/覆盖段/维护者字段各 exit 1）。
- **负控制①缺段（能取假）**：`dispatch-preference-check.ts --file <focus 副本删掉覆盖段>` → `exit 1`（RED，stderr 指名「覆盖段」）；删默认段/维护者字段同理 exit 1。
- **负控制②摘要不变（能取假）**：单测断言 `readingsDigest({focus:'方向 A'}) === readingsDigest({focus:'方向 A'})`。
- **负控制③摘要变（能取假）**：单测断言 `readingsDigest({focus:'方向 A'}) !== readingsDigest({focus:'方向 B'})`。

### 生产载体端到端（非 fixture：真实 goal store 3 active goal + 真实 focus 文件）

- 编辑前 round：`focus = "…暂无具体人工方向…"`，`digest = d0085be4cd58d0c7`。
- 编辑覆盖段为「优先关注 syncHealth 失败与 driver 停摆」。
- 编辑后 round：`focus = "…优先关注 syncHealth 失败与 driver 停摆…"`，`digest = f13635d2274d6712`（变了 ⇒ 判读一次）。
- 随后不再编辑，seed `.quay/meta-driver-state.json` 为 `f13635d2274d6712` → `--once` → `semantic: skipped-unchanged`，
  `skipReason: unchanged since 2026-09-07T09:25:39.379Z`（未因 focus 判读）。两半都拿到。

### driverArgvForKind（DoD 第 5 条，判断：不改）

未改动 `driver-runtime.ts` 的 `driverArgvForKind`。**理由：文件形态已使 argv 透传多余。**
常驻的人给方向通道是 `orchestration/meta-driver-focus.md`——`collectReadings` 每轮现读其覆盖段填入
`readings.focus`（不经过 argv、无需重启）；`--focus` 保留为一次性人工干跑（`--once`）的显式参数，
那个用法本就由人直接跑 CLI 传参，不经 `driverArgvForKind`。故无需给 `driverArgvForKind` 加 per-kind
focus 旗标（那正是 SPEC §7 在说的那种成本）。两种可接受、静默跳过不可接受——此处明确选了「不改」并写明理由。

## Touches

- `orchestration/meta-driver-focus.md`
- `plugin/scripts/meta-driver.ts`
- `plugin/scripts/dispatch-preference-check.ts`
- `plugin/probes/meta-driver.md`
- `plugin/test/meta-driver.test.mjs`
- `plugin/test/dispatch-preference-check.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-meta-driver-no-steering-channel-focus-unreachable.md`
