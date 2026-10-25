// driver-vocab.ts — the driver verb + kind vocabulary (gap-driver-cli-help-hides-four-of-six-kinds).
//
// ⛔ 住在 core-root（GOAL-033/AC-350）：core（`driver-control.ts`、`serve.ts`）与 CLI（`cli/help.ts` /
// `cli/driver.ts` / `cli/server.ts`）**共同消费**这张控制面词表，放在 `cli/` 会制造 core → cli 边
// （宿主 serve.ts 是 core，却要 import cli/ 里的服务名清单）。ownership 随真实消费者走，⛔ 不是整理。
//
// WHY THIS MODULE EXISTS（⛔ 不是"为了整齐"）：`quay driver` 的 verb/kind 词表要在三处用户可见的
// 帮助文本里出现（`quay --help` 顶层用法行、`quay driver --help` 的用法行与 `--kind` 旗标说明），
// 修前它们各自手抄一份、取值互不一致（2/4/5/6 四种）⇒ 用户唯一看得到的 `<promotion|worker>` 让
// outer/quality/meta/goal 四个**已实现**的 driver kind 在产品表层等于不存在（硬规则 3b 形态：
// 能力缺失与能力未暴露同形）。现在帮助文本一律插值本模块的两个常量（见 cli/driver.ts 与
// cli/help.ts），⛔ 不再有第二份副本；不变式由 plugin/scripts/enum-surface-parity-check.ts 的面
// `cli-driver-kinds` / `cli-driver-help-kind` / `cli-driver-usage-verbs` 机械守着。
//
// ⛔ 为什么独立成叶模块（而不是留在 cli/driver.ts 里让 help.ts import 它）：help.ts 被 bin/quay.ts
// **静态** import（每次 CLI 调用都会加载），而 cli/driver.ts 的传递闭包含 config.ts / plugin-root.ts
// 等重依赖——实测把 KINDS 留在 driver.ts 会让 `quay --help` 从 0.25s 涨到 0.67s（每次调用都付）。
// 本模块零 import ⇒ 加载成本可忽略。⚠️ 与"能不能少写一个文件"无关，是 help 路径的实测成本。

/** `quay driver <verb>` 的全部 verb。
 *
 *  ⚠️ `log` / `live` 与其余六个 verb 的**类别不同**：那六个是 supervisor kernel 的**控制面**动词
 *  （start/stop/drain/resume/status/restart 都要落到常驻进程上），`log` 与 `live` 是**只读**的——
 *  它们不 spawn kernel、也不碰任何控制态。`log` 读 driver 的**记录载体**；`live` 读**当前在飞 worker
 *  集合**（`.quay/worker-*.jsonl` + host-global `/proc`，经 observation.readLive，⛔ 不是第二份扫描）。
 *  两者仍在此表里，是因为用户找它们的位置就是 `quay driver`（人 2026-09-20 的裁定把「driver 应当记录的
 *  日志」的可达面点名在 quay cli/mcp/web 上）；cli/driver.ts 在委派 kernel 之前截住它们
 *  （见那里的 `runDriverLog` / `runDriverLive`）。 */
export const VERBS = ["start", "stop", "drain", "resume", "status", "restart", "log", "live"];

// ⛔ 白名单必须与 kernel 的 DRIVER_KINDS 一致（suite 已按人 2026-09-07 裁定退役移除）。导出供
// goal-driver.test.mjs 断言两者集合相等（gap-goal-driver-mechanical-ring AC6），并作为帮助文本
// 的 kind 真源。⚠️ 它是 kernel 那张表的【已机械比对过的镜像】，⛔ 不是新的事实来源
// （enum-surface-parity-check 的 authority `driver-kind` 指向 driver-runtime.ts:DRIVER_KINDS）。
export const KINDS = ["promotion", "worker", "outer", "quality", "meta", "goal"];

// ── GOAL-017/AC-254（SPEC §6.9 阶段 B）：服务清单也住在这里，理由与上面完全相同 ────────────────────
//
// 服务名要在**三处用户可见的帮助文本**里出现（`quay --help` 的用法行、`quay server --help` 的
// 用法行与 services 行），而 `cli/serve` 那条路径的传递闭包带 config/provider/serve-handlers ——
// 把清单留在 serve.ts 会让 `quay --help` 每次调用付那份加载成本（driver-vocab.ts 的头注释记着
// 同一个实测：0.25s → 0.67s）。本模块零 import ⇒ 成为**单一实现 + 零加载成本**的那个落点。
//
// ⛔ 这里是**唯一**的服务清单：`packages/quay/src/serve/serve.ts`（宿主）与 `packages/quay/src/cli/server.ts`
// （四个动词）都从这里 import，⛔ 不各写一份（SPEC §6.8 单一实现；两份 = 假）。
//
// `DRIVER_SERVICE_KINDS` 与上面的 `KINDS` 是同一集合 —— 服务名 `driver:<kind>` 的 kind 段由它构造。
// `peer` 是 SPEC §6.9 清单里唯一的**尚不存在**的服务（阶段 D），故刻意不在此列：把它写进来会让
// `--only peer` 通过解析然后在没有任何实现的地方静默假成功。
// ── `.quay/live-state.json`（gap-live-state-small-carrier-for-subsecond-inflight-read）──────────
//
// 两个值都同时被 **help.ts**（每次 CLI 调用静态加载）与 observation.ts（读面）消费 ⇒ 与上面
// VERBS/KINDS 同一个理由住在本叶模块：⛔ 在帮助文本里手抄相位词表或阈值 = 第二个定义点，两边漂移
// 时没有任何检查发现（用户看到的帮助会与读面实际接受的取值不同形）。

/** `.quay/live-state.json` 的**唯一命名点**（仓库相对路径 + wire schema）。写侧
 *  `plugin/scripts/worker-driver.ts` 与读侧 `observation.readLiveState` 都从这里 import ⇒ 两侧**结构上
 *  不可能**对同一个文件用不同名字（那正是 carrier 常量要防的漂移）。住在本叶模块的理由：写侧在
 *  plugin/ 树内、读侧在 packages/quay/src/，两棵树都不能安全地把对方整棵拉进来；这里是唯一同时
 *  零依赖、又被两侧允许 import 的落点。载体登记见 docs/carrier-registry.json（`live-state.json`）。 */
export const LIVE_STATE_REL = ".quay/live-state.json";
/** Wire schema。⛔ 值不同 = 读不懂（读侧报 unreadable），⛔ 不静默适配。 */
export const LIVE_STATE_SCHEMA = "quay-live-state/v1";

/** `.quay/live-state.json` 的 staleness 阈值（毫秒）。**导出值，不是猜的**：worker driver 的 round
 *  心跳周期被它自己的 reconcile 地板（`drivers.yml` worker.reconcile_interval_secs = 300 s，在飞
 *  worker 存在时一轮最长可睡这么久）上界约束 ⇒ 阈值取「地板 + 一个 interval」= 6 min。⛔ 阈值低于
 *  reconcile 地板会把健康 driver 的快照报成 stale（那会让 stale 这个取值失去信息量）。 */
export const LIVE_STATE_STALE_MS = 360_000;

/** driver 能**如实观测**的相位词表：spawn 成功（implementing）、子进程退出（fan-in）、终态计算完成
 *  （条目移出快照）。⛔ driver 不知道 worker 内部子相位（例如 suite 正在跑），本词表不得扩张成一个
 *  「猜」出来的枚举。写作侧 = plugin/scripts/worker-driver.ts，读侧 = observation.readLiveState。 */
export const LIVE_STATE_PHASES = ["implementing", "fan-in", "awaiting-land"] as const;
export type WorkerLivePhase = (typeof LIVE_STATE_PHASES)[number];

export const HOSTED_SERVICE_NAMES = ["web", "control"];
export const DRIVER_SERVICE_KINDS = KINDS.slice();
export const ALL_SERVICE_NAMES = [
  ...HOSTED_SERVICE_NAMES,
  ...DRIVER_SERVICE_KINDS.map((k) => `driver:${k}`),
];
