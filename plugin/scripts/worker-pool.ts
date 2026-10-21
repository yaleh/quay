#!/usr/bin/env node
// worker-pool.ts — WorkerPool：常驻 worker 池的 retry/backoff 状态的【唯一拥有者】。
// (tasks/gap-worker-pool-owns-retry-backoff-state；GOAL-909 / AC-914；DIR-133 裁定下 R2 第一刀.)
//
// WHY THIS FILE EXISTS：这两类状态此前是 `runResidentLoop` 的两个闭包局部变量
//   （`const retryState: RetryState = …` / `const backoffState = newQuickDeathBackoffState()`），
//   转移散在 onWorkerFinished 闭包里直接读写 Map/Set。AC-914 明确把「把同样的闭包变量换个文件
//   继续以模块级变量存在」判为【不达成】⇒ 本文件用 `export class WorkerPool` 以 ES 私有字段
//   （`#retryState` / `#backoffState`）拥有状态，⛔ 不导出任何模块级状态容器；外部只能经方法转移
//   （`Object.keys(new WorkerPool())` 里看不到这两个字段 ⇒ 结构上无法从外部持有）。
//
// 单一真相源（⛔ 不复制实现）：
//   · 重试上限 / needs-human / 排除集 = `driver-filters.ts` 的
//     `advanceRetryCap` / `applyNeedsHumanTransition` / `reconcileNeedsHumanWithDisk` /
//     `computeDispatchExclusion`（GOAL-035 / GOAL-036 已收敛的纯函数，本文件只做状态持有 + 委托）。
//   · 快速死亡退避（配置 / 成因分类 / 签名 / 状态 / 转移）原住在 worker-driver.ts；AC-914 要求状态与
//     转移同归 WorkerPool，故整簇迁到本文件。worker-driver.ts 仍 re-export 旧名字 ⇒ 既有消费者
//     （plugin/test/helpers/*、plugin/test/worker-driver-*.test.mjs）的 import 面逐字不变。
//   ⛔ 本文件不得 import worker-driver.ts（会成 import cycle）——故 `/proc` 存活三值词表在本文件以
//     `QuickDeathLiveness` 声明（与 worker-driver.ts 的 `PidLiveness` 同形，结构上可直接互传）。

import { matchEnvironmentFatalSignature } from "./driver-runtime.ts";
import {
  advanceRetryCap,
  applyNeedsHumanTransition,
  computeDispatchExclusion,
  reconcileNeedsHumanWithDisk,
  type NeedsHumanKind,
  type RetryState,
} from "./driver-filters.ts";

/** `/proc` 存活实测取值（三态，⛔ 三者不得两两同形）。
 *  ⛔ 不从 worker-driver.ts import —— 本文件是它的下游，反向依赖会成 import cycle。 */
export type QuickDeathLiveness = "alive" | "exited" | "unknown";

/** 断言签名的【唯一】归一化点（gap-retry-exemption-signature-keeps-volatile-values）。
 *
 *  WHY：签名是「同一缺陷是否复发」的**身份**。签名里只要留下每次运行都变的量（pid / 毫秒 / 端口 /
 *  绝对路径 / 哈希），同一缺陷在**每个任务**上都会得到一个**新**签名 ⇒ 「≥2 个不同任务命中同一签名」
 *  结构上永不成立 ⇒ 这个专为「不相关 flaky 不该压垮受害任务」而造的豁免，对最需要它的那一半失败恒空
 *  （硬规则 4：一个结构上不可能取真的判据不是测量）。实证：同一生产缺陷（`driver-runtime.test.mjs`
 *  AC4）在 3 个任务的 suite log 里给出 3 条互不相同的签名，只因 pid/confirmed_ms 不同。
 *
 *  三分类的取舍：把「每次都会变、且不改变缺陷身份」的**量**折成占位；把**措辞**逐字保留——措辞才是
 *  缺陷身份。⛔ 不折词、不截断、不折长引文：`'change' !== 'full'` 里的引文正是区分「两种不同缺陷」
 *  的内容，折掉它就把「不同」变成「同一」（硬规则 3b 的镜像面：不得把「读不懂」变成「合格」，这里
 *  是不得把「不同缺陷」变成「同一缺陷」）。故本函数**不**复用 `meta-driver.ts:errorSignature`——那个
 *  正本面向「错误聚合」，会截断到 200 字符并折掉长引文，两者是**不同**的身份语义（AC5 已枚举该兄弟点）。
 *
 *  退化的归一化结果（折叠后除占位符外一个字母都不剩，如 `1 !== 2` ⇒ `<n> !== <n>`）**丢掉**，不当作
 *  签名：它在不同缺陷间恒等 ⇒ 留下它等于制造假豁免。全丢掉 ⇒ 调用侧落
 *  `insufficient-data-fallback`（照常计数），fail-closed。 */
export function normalizeAssertionSignature(text: string): string {
  let s = String(text ?? "").replace(/\s+/g, " ").trim();
  // ① 哈希/uuid/sha/commit（先于数字：32 位 sha 会被 ② 拆成一堆 <n>，拆完丢掉「这是个哈希」这一形）。
  //    要求命中里**同时含 a–f 与数字**：纯数字串是量不是哈希，交给 ②；只由 a–f 组成的英文词
  //    （`defaced`/`acceded`）不得被当成哈希抹掉，否则把不同缺陷并成一个签名。
  s = s.replace(/\b[0-9a-f]{7,40}\b/gi, (m) => (/[a-f]/i.test(m) && /\d/.test(m) ? "<hex>" : m));
  // ② 绝对路径（≥2 段）。⚠️ 前导 `/` 必须不在词中间：`AC1/AC2/AC3` 的前导 `/` 前面是 `1`（词字符）
  //    ⇒ 不匹配；路径在文本里总是空格/括号/冒号/= 之后 ⇒ 匹配。段字符类含 `-`（worktree 名 / 任务 id）。
  s = s.replace(/(?<![\w])(?:\/[\w.@+-]+){2,}\/?/g, "<path>");
  // ③ 数字字面量（pid / confirmed_ms / 端口 / 计数 / 行号）。⚠️ 只折【数字 token】——词内数字
  //    （`dr-ac4-short` 的 `4`）**不折**：那是**稳定**标识符的一部分，折掉它会把 `ac4` 与 `ac7` 两个
  //    不同的用例并成同一签名（正是本函数开头禁的「把不同缺陷变成同一缺陷」）。判据 = 数字串前面
  //    不是词字符；`530ms` 这类「数字+单位」仍折（单位文本保留）⇒ 数量变、单位不变 ⇒ 签名不变。
  s = s.replace(/(?<!\w)\d+(?:\.\d+)?/g, "<n>");
  return s.trim();
}
// ── 快速死亡退避（gap-worker-driver-selector-api-error-no-backoff）────────────────────────────
// worker-driver 对 selector API 错误 / fallback 失败的【快速死亡】（<60s 墙钟）无退避——17:22–17:56 两任务
// 54 次「worker exited with code 1」全部 <60s 快速重派，纯烧派发预算（subagent spawn 预算 / 会话累计）。
// 修法（⛔ 不修模型名——那是 a7a507eab 治「为什么 400」；本条治「出错时为什么无退避疯狂重试」，两条独立）：
//   worker <quickDeathMs 连续死亡 ≥backoffThreshold 次 ⇒ 对该任务加指数退避（backoffUntil，⛔ 不立即重派），
//   重派间隔随连续死亡次数指数增长、封顶 maxBackoffMs；退避到上限（maxRetries，复用现有重试上限机制的
//   --max-retries 旋钮）⇒ markNeedsHuman（⛔ 不无限退避）。退避状态按 task 记（⛔ 不全局——一个任务退避
//   不该拖垮别的任务，AC2）。机制常量值不依赖宿主规格（硬规则 4 推论二：quickDeathMs=60s 是提案观测到的
//   「<60s 快速重派」、baseBackoffMs/maxBackoffMs 是【指数退避的几何底/顶】非机器核数/内存上限）。

/** 快速死亡退避配置。quickDeathMs/backoffThreshold/baseBackoffMs/maxBackoffMs 是机制常量（非宿主
 *  规格阈值），退避上限（markNeedsHuman 阈值）复用现有 --max-retries（backoffMaxRetries 由调用方传
 *  maxRetries，⛔ 不再新设一个数值旋钮——plan item 3「复用现有重试上限机制」）。 */
export interface QuickDeathBackoffConfig {
  /** 墙钟 < 此值（ms）判为「快速死亡」。 */
  quickDeathMs: number;
  /** 连续快速死亡 ≥ 此次数才开始退避（M，AC1「连续死亡 ≥M 次后」）。 */
  backoffThreshold: number;
  /** 第一次退避的等待 ms（指数底数）。 */
  baseBackoffMs: number;
  /** 退避等待上限 ms（指数增长封顶——plan item 1「退避上限可配置」）。 */
  maxBackoffMs: number;
}

export const QUICK_DEATH_BACKOFF_DEFAULT: QuickDeathBackoffConfig = {
  quickDeathMs: 60_000,
  backoffThreshold: 1,
  baseBackoffMs: 30_000,
  maxBackoffMs: 300_000,
};

/** 快速死亡终态：worker 没跑完就死（failed 退出非零 / spawn-failed 起不来 / killed 被信号杀）。
 *  exited-not-landed 是「跑完没落地」（自有重试上限机制）、timed-out 是「超时被杀保留 worktree」
 *  （自有语义），两者都不算「快速死亡」——⛔ 与既有机制重叠计数（同一条失败路径进两个桶）。 */
const QUICK_DEATH_FINAL_STATES: ReadonlySet<string> = new Set(["failed", "spawn-failed", "killed"]);

/** 是否「快速死亡」：终态属快速死亡类 ∧ 墙钟 < quickDeathMs。
 *  liveness（可选）：孤儿 finalize 的 /proc 存活实测取值。⛔ 只有【测到已退出】("exited") 才算死亡；
 *  "unknown"（没测成）与 "alive"（worker 还活着）都不是测量出来的死亡 ⇒ ⛔ 不烧重试预算
 *  （硬规则 4：一个没测量出来的死亡不是测量；硬规则 3：三个取值不得两两同形）。
 *  缺省 undefined = 无该字段（普通 worker 终态）⇒ 沿用原有语义，⛔ 行为不变。 */
export function isQuickDeath(
  finalState: string,
  wallClockMs: number,
  cfg: QuickDeathBackoffConfig = QUICK_DEATH_BACKOFF_DEFAULT,
  liveness: QuickDeathLiveness | null | undefined = undefined,
): boolean {
  if (liveness === "unknown" || liveness === "alive") return false;
  return QUICK_DEATH_FINAL_STATES.has(finalState) && wallClockMs < cfg.quickDeathMs;
}

// ── 快速死亡【成因】分类（gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human）
// 根因：上面的快速死亡退避把【一切】<quickDeathMs 的非零退出计入同一个桶（QUICK_DEATH_FINAL_STATES），
//   连续 ≥backoffMaxRetries 次即标 needs-human 终态。但账号级限流在【性质上不同】：瞬时的、外部的、
//   自愈的，且错误文本自带失效时刻。它被计入同一个桶 ⇒ 任务被永久停摆（终态不自愈），而真相是「等一会儿」。
// 实测（2026-09-13，第三方项目 quay-fleet，第一手载体 .quay/worker-outcome.jsonl）：连续三条记录的
//   selector_reason 逐字相同——`selector worker returned no valid pick (exit 1, got "You've hit your
//   session limit · resets 11:30am (UTC)"); fallback to first shuffled candidate`，对应 wall_clock_ms =
//   4643 / 7685 / 5106（三次都 <60s ⇒ 三次都计入上限）⇒ 任务 fleet-agent-sessions-screen-endpoint 被机械
//   翻 needs-human，成因类记成 human-adjudication（"需要人裁决"，而真相是"等 17 分钟"）。
//   ⚠️ 这段是 2026-09-13 的事实记录：其中的「成因类」字段已于 2026-09-20 整套退役
//   （gap-retire-needs-human-cause-enumeration）——本分类器（下面的 classifyQuickDeathCause）保留，
//   它只决定重试计数与注记文字，⛔ 不再是任何 frontmatter 字段。
// ⛔ 关键点：driver 【已经握着能区分的证据】——限流原文完整落在 selector_reason 字段里并落了盘。
//   不是"看不出来"，是"看出来了但不分类"。
// 判据来源（⛔ 不新增探测面、⛔ 不做语义判断）：只用 driver 已捕获的 selector_reason 文本做【字面子串】
//   匹配（硬规则 2 按位置判定；硬规则 3 枚举不布尔；硬规则 3b 三个取值两两不同形）。
// 负控制（也解释它为何一直没被发现）：quay 自己的 .quay/worker-outcome.jsonl 实测 1889 条记录、含
//   "session limit" 的 0 条——quay 的 worker 经 ANTHROPIC_DEFAULT_*_MODEL 走别的后端，不消耗 Anthropic
//   账号额度 ⇒ 本缺陷只在 worker 使用 Anthropic 账号的第三方项目上暴露，本仓库的生产数据不会自然产生样本。

/** 快速死亡成因（可枚举四态，两两不同形）：
 *   - "environment-fatal"：命中【环境级】签名（模型名/密钥/launcher/网关不可用，见 driver-runtime.ts 的
 *     ENVIRONMENT_FATAL_SIGNATURES），或窗口内 ≥2 个【不同任务】以同一签名快速死亡 ⇒ 这是【所有 worker
 *     必然同样失败】的环境故障，⛔ 不是任务自身缺陷：动作是 **driver 自己 halt**（写控制态 halted），
 *     ⛔ 不翻转任何任务状态、⛔ 不计入任务的快速死亡计数
 *     （gap-worker-quick-death-environment-fatal-halts-driver；生产实例 claudecodeui 2026-09-20）。
 *   - "transient-external"：已捕获的文本命中【账号级限流/配额】签名 ⇒ 瞬时、外部、自愈 ⇒
 *     ⛔ 不计入 backoffMaxRetries 连续计数（否则终态停摆，正是本缺陷），改为退避重试。
 *   - "ordinary"：文本【读得懂】且不命中 ⇒ 普通快速死亡 ⇒ 沿用既有语义（计入连续计数，到上限转 needs-human）。
 *   - "unclassifiable"：文本缺失/读不懂（两个判定面都是 null / 非字符串 / 全空白）⇒ 第三个取值。⛔ 既不
 *     与 "transient-external" 同形（那会把读不懂静默当成自愈、让它无限重派），也不与 "ordinary" 同形
 *     （那会把读不懂静默当成任务自身缺陷）。判别式上按 ordinary 计（fail-safe 不无限重派），
 *     但【取值本身】可区分——这正是硬规则 3b：读不懂不得与任一合格态同形。 */
export type QuickDeathCause = "environment-fatal" | "transient-external" | "ordinary" | "unclassifiable";

/** 账号级限流/配额签名（【字面子串】，大小写归一后匹配；⛔ 无语义判断、⛔ 不调模型、⛔ 不新增探测面）。
 *  以 2026-09-13 quay-fleet 第一手样本 "You've hit your session limit · resets 11:30am (UTC)" 为准，
 *  并覆盖同族（API 速率限制 / 配额耗尽）的常见字面形态。⛔ 宁窄勿宽：每多一条签名，就多一条它能取假
 *  的反例要举（本条的反例 = "worker exited with code 1" 不命中）。 */
const TRANSIENT_EXTERNAL_SIGNATURES: readonly string[] = [
  "session limit", // 实测：You've hit your session limit · resets 11:30am (UTC)
  "rate limit",
  "rate_limit",
  "usage limit",
  "quota exceeded",
  "exceeded your current quota",
  "too many requests",
];

/** worker stderr 尾部捕获上限（字节）。⛔ 只留【末尾】——错误分类要的是最后一条致命错的原文，不是
 *  整段日志（几百 MB 的构建输出里翻签名会让判定面变成第二个日志存储）。机制常量，⛔ 不读宿主规格。 */
export const WORKER_STDERR_TAIL_MAX_BYTES = 4096;

/** 跨任务关联窗口（ms）：同一签名在【不同任务】上出现的最小时间跨度内 ⇒ 判 environment-fatal。
 *  机制常量（与 quickDeathMs 同族：观测到的「同一轮派发窗口」量级），⛔ 不是宿主规格阈值。 */
export const ENV_FATAL_FANOUT_WINDOW_MS = 600_000;

/** 一次分类的完整结果（硬规则 3：枚举，不布尔——`signature`/`evidence` 取 null 表示【没命中】，
 *  ⛔ 不与「命中某条」共用取值）。 */
export interface QuickDeathClassification {
  cause: QuickDeathCause;
  /** 命中的环境级签名名；⛔ null = 未命中（≠ 命中了某条）。 */
  signature: string | null;
  /** 判定所依据的【原文摘录】（停机原因里要附的「签名原文」）；⛔ null = 无依据可摘。 */
  evidence: string | null;
}

/** 两个判定面（selector_reason 与 worker stderr 尾部）里，哪一处【读得懂】：非空字符串。
 *  ⛔ 读不懂的输入不参与匹配，但它的存在也不能让整体判成「读不懂」（另一个面可能读得懂）。 */
function readableTexts(...inputs: Array<string | null | undefined>): string[] {
  return inputs.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

/** 快速死亡成因分类（纯函数，判定面 = selector_reason + worker stderr 尾部）。
 *  只对 driver 已捕获的文本做【字面】匹配（硬规则 2 按位置判定）——⛔ 不读文件、⛔ 不看进程、⛔ 不调模型。
 *  优先级：环境级签名 ⇒ environment-fatal（停 driver 是最保守动作，故先判）> 限流类 ⇒ transient-external
 *  > 其余 ⇒ ordinary。
 *  输入【两个面都】读不懂（null / 非字符串 / 全空白）⇒ "unclassifiable"（⛔ 不与任一合格态同形，硬规则 3b）；
 *  只要有一面读得懂，结论就是读得懂的那一面的结论。
 *  环境级匹配走 `matchEnvironmentFatalSignature`（driver-runtime.ts 的单一真相源——启动冒烟用的是同一份
 *  清单，⛔ 不在此另写一份）。 */
export function classifyQuickDeathEvidence(
  selectorReason: string | null | undefined,
  stderrTail: string | null | undefined = undefined,
): QuickDeathClassification {
  const texts = readableTexts(selectorReason, stderrTail);
  if (texts.length === 0) return { cause: "unclassifiable", signature: null, evidence: null };
  for (const text of texts) {
    const m = matchEnvironmentFatalSignature(text);
    if (m != null) return { cause: "environment-fatal", signature: m.signature, evidence: m.evidence };
  }
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const sig of TRANSIENT_EXTERNAL_SIGNATURES) {
      if (lower.includes(sig)) return { cause: "transient-external", signature: null, evidence: null };
    }
  }
  return { cause: "ordinary", signature: null, evidence: null };
}

/** 成因取值（`classifyQuickDeathEvidence` 的薄封装，保持既有调用面/返回词表不变）。 */
export function classifyQuickDeathCause(
  selectorReason: string | null | undefined,
  stderrTail: string | null | undefined = undefined,
): QuickDeathCause {
  return classifyQuickDeathEvidence(selectorReason, stderrTail).cause;
}

/** 一次快速死亡的【签名指纹】——用于跨任务关联（item 2）：窗口内 ≥2 个【不同任务】以同一签名快速死亡
 *  ⇒ 同样判 environment-fatal（即使签名不在清单里）。
 *  取末尾一行（致命错通常最后落出），归一化**复用全仓唯一的签名归一化点** `normalizeAssertionSignature`
 *  （⛔ 不手搓第二份「哪些字符算易变量」的清单：两份清单必然漂移，且 s04 的结构判据盯着这件事）。
 *  它的语义正好是本场景要的——把每次都会变的**量**（pid / 毫秒 / 端口 / 路径 / 哈希）折成占位，把**措辞**
 *  逐字保留（措辞才是身份）；跨任务比较时不同任务的 pid/路径不该把同一个错拆成不同签名。
 *  ⛔ 不额外小写化：现有签名面（retry 豁免）也不小写，且不折能让「不同大小写的两个错」保持不同 ⇒ 更窄。
 *  两面都读不懂 ⇒ null（硬规则 6：缺值 = 未查，⛔ 不伪造成某个签名——一个空指纹会让所有读不懂的快速
 *  死亡互相「关联」）。退化指纹（折叠后除占位符外一个字母都不剩，如 `1 !== 2` ⇒ `<n> !== <n>`）同判：
 *  它在不同缺陷间恒等，留下它等于把所有数字型失败互相关联（判据同 assertionSignaturesFromSuiteLog）。 */
export function quickDeathSignature(
  selectorReason: string | null | undefined,
  stderrTail: string | null | undefined = undefined,
): { fingerprint: string; raw: string } | null {
  // stderr 尾部优先（它才是 worker 的原话），selector_reason 兜底。
  const texts = readableTexts(stderrTail, selectorReason);
  if (texts.length === 0) return null;
  const lines = texts[0].split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const raw = lines.length > 0 ? lines[lines.length - 1] : texts[0].trim();
  if (raw.length === 0) return null;
  const fingerprint = normalizeAssertionSignature(raw);
  if (fingerprint.length === 0) return null;
  // ⚠️ 必须先把占位符形态泛型剥掉再找字母——`<n>` 自己含字母 `n`（同 assertionSignaturesFromSuiteLog
  // 实测踩到过的那个坑）。
  if (!/\p{L}/u.test(fingerprint.replace(/<[a-z]+>/g, ""))) return null;
  return { fingerprint, raw: raw.slice(0, 400) };
}

/** 从已捕获文本里解析账号限流的【重置时刻】（UTC）——错误文本自带，⛔ 不猜、⛔ 不新增探测面。
 *  支持 `resets 11:30am (UTC)` / `resets 3pm (UTC)` / `resets 11:30 (UTC)`（24h）。返回 epoch ms：
 *  当天该 UTC 时刻；【已过 ⇒ 次日同时刻】（日额度重置语义，⛔ 不回退到"立刻重试"）。
 *  解析不出 ⇒ null（硬规则 6：缺值 = 未查，⛔ 不伪造成某个时刻）——调用方据此【回落指数退避】，
 *  ⛔ 不得静默当成"立刻重试"，也 ⛔ 不得静默当成 needs-human。 */
export function parseRateLimitResetAtMs(text: string | null | undefined, nowMs: number): number | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const m = /\bresets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(utc\)/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] != null ? Number(m[2]) : 0;
  const meridiem = m[3] ? m[3].toLowerCase() : null;
  if (!Number.isInteger(hour) || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  const now = new Date(nowMs);
  let at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0);
  // 已过（含恰在此刻）⇒ 次日同时刻。⛔ 不返回一个已过去的时刻（那会让 isBackedOff 立刻为假 =
  // 静默退化成"立刻重试"，正是 plan item 3 禁的那一种）。
  if (at <= nowMs) at += 24 * 60 * 60 * 1000;
  return at;
}

/** 指数退避等待：baseBackoffMs * 2^(consecutive - backoffThreshold)，封顶 maxBackoffMs（⛔ 不无限增长）。 */
export function backoffDelayMs(
  consecutive: number,
  cfg: QuickDeathBackoffConfig = QUICK_DEATH_BACKOFF_DEFAULT,
): number {
  const exp = Math.max(0, consecutive - cfg.backoffThreshold);
  return Math.min(cfg.maxBackoffMs, cfg.baseBackoffMs * 2 ** exp);
}

/** 快速死亡退避状态（按 task 记，⛔ 不全局）。跨轮存活于常驻循环内（⛔ 不落盘，与 RetryState 同寿命）。 */
export interface QuickDeathBackoffState {
  /** task id → 连续【普通】快速死亡次数（计入 backoffMaxRetries 上限）。 */
  counts: Map<string, number>;
  /** task id → 连续【transient-external】快速死亡次数。⛔ 与 counts 【分开】记——混在一个 Map 里会让
   *  一段限流把计数顶到上限，随后一次普通快速死亡立刻误触 needs-human（成因维度丢失）。本计数只用来
   *  驱动「解析不出重置时刻」时的指数退避回落增长。 */
  transientCounts: Map<string, number>;
  /** task id → 退避到此时刻（epoch ms）。now < until 期间不重派该 task。 */
  backoffUntil: Map<string, number>;
  /** 签名指纹 → 最近一次以该指纹快速死亡的任务与时刻（跨任务关联，item 2）。⛔ 与 counts 分开记——
   *  它记的是「这个签名见过谁」，不是「某个任务死了几次」。 */
  signatureSeen: Map<string, { task: string; atMs: number; raw: string }>;
}

/** 新建一个退避状态。 */
export function newQuickDeathBackoffState(): QuickDeathBackoffState {
  return { counts: new Map(), transientCounts: new Map(), backoffUntil: new Map(), signatureSeen: new Map() };
}

/** 该 task 此刻是否在退避中（backoffUntil 未到）。 */
export function isBackedOff(state: QuickDeathBackoffState, taskId: string, nowMs: number): boolean {
  const until = state.backoffUntil.get(taskId);
  return until != null && nowMs < until;
}

/** 记录一次 worker 终态对退避状态的影响（纯逻辑，可单测）：
 *   非快速死亡（worker 活过 quickDeathMs，或 completed/exited-not-landed/timed-out）⇒ 复位连续计数
 *   （「连续」断链，⛔ 不把慢速失败算进快速死亡序列）。
 *   快速死亡 ⇒ 连续计数 +1；≥backoffMaxRetries ⇒ newlyNeedsHuman（⛔ 不设 backoffUntil——转 needs-human
 *   由 notNeedsHuman/retryExhausted 过滤负责停止重派，不再退避）；否则 ≥backoffThreshold ⇒ 设 backoffUntil。
 *  @returns { quickDeath, backedOff, newlyNeedsHuman }
 *  liveness（可选）：孤儿 finalize 的 /proc 存活实测取值，语义同 isQuickDeath。实测为
 *  "unknown"/"alive" 时**不动状态**（既不 +1 也不复位）：unknown 对计数是零信息，既不该算一次死亡
 *  （那会烧预算），也不该打断一次**已测量**的连续死亡序列（那会让交错注入 unknown 洗白真实streak）。
 *  ⛔ 与「非快速死亡 ⇒ 复位」那条分支刻意不同形——硬规则 3：第三个取值不得与前两者任一同形。
 *  成因分流（gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human）：
 *    selectorReason 判为 "transient-external" ⇒ ⛔ 【不计入】state.counts（因此 ⛔ 永不 newlyNeedsHuman，
 *    终态不自愈正是本缺陷），改记 state.transientCounts 并设 backoffUntil = 文本自带的重置时刻
 *    （解析不出 ⇒ 回落指数退避，⛔ 不是"立刻重试"）。连续计数【不动】：既不 +1（那不是任务自身缺陷），
 *    也不复位（那会让交错注入的限流洗白普通连续序列）——与 liveness === "unknown" 分支同族，
 *    硬规则 3b 的第三个取值形态。
 *    selectorReason 判为 "unclassifiable" ⇒ 取值如实为 "unclassifiable"（读者可区分），判别式上按普通
 *    快速死亡计（fail-safe：读不懂不无限重派）。
 *    liveness === "unknown"/"alive" 或 非快速死亡 ⇒ 两个连续计数一并复位（「连续」断链）。
 *  环境级分流（gap-worker-quick-death-environment-fatal-halts-driver）：
 *    两个判定面（selector_reason + worker stderr 尾部）命中 environment-fatal 签名，或【窗口内 ≥2 个
 *    不同任务以同一签名快速死亡】⇒ cause = "environment-fatal"。此时**该任务的状态一个字节都不动**：
 *    ⛔ 不进 counts（计数未增加，AC2）⇒ ⛔ 永不 newlyNeedsHuman，⛔ 不设 backoffUntil（该停的是 driver，
 *    不是这一个任务——逐任务退避仍会把池子逐个 park）。停机动作由调用方按 cause 承担（写控制态 halted）。
 *  @returns { quickDeath, backedOff, newlyNeedsHuman, cause, backoffUntil, signature, evidence }
 *    cause：本次的成因取值（非快速死亡 / 未评估 ⇒ null，缺值 ≠ 某个取值，硬规则 6）。
 *    backoffUntil：本次实际设下的退避时刻（未退避 ⇒ null），供调用方/载体观测。
 *    signature / evidence：环境级命中的签名名与原文摘录（供停机原因）；未命中 ⇒ null。 */
export function recordQuickDeathBackoff(
  state: QuickDeathBackoffState,
  taskId: string,
  finalState: string,
  wallClockMs: number,
  nowMs: number,
  backoffMaxRetries: number,
  cfg: QuickDeathBackoffConfig = QUICK_DEATH_BACKOFF_DEFAULT,
  liveness: QuickDeathLiveness | null | undefined = undefined,
  selectorReason: string | null | undefined = undefined,
  stderrTail: string | null | undefined = undefined,
  envFatalWindowMs: number = ENV_FATAL_FANOUT_WINDOW_MS,
): {
  quickDeath: boolean;
  backedOff: boolean;
  newlyNeedsHuman: boolean;
  cause: QuickDeathCause | null;
  backoffUntil: number | null;
  /** 命中的环境级签名名（⛔ null = 未命中 ≠ 命中某条）；跨任务关联命中的填 `cross-task:<fingerprint>`。 */
  signature: string | null;
  /** 判定依据的原文摘录（停机原因里要附的「签名原文」）；⛔ null = 无依据。 */
  evidence: string | null;
} {
  if (liveness === "unknown" || liveness === "alive") {
    return { quickDeath: false, backedOff: false, newlyNeedsHuman: false, cause: null, backoffUntil: null, signature: null, evidence: null };
  }
  if (!isQuickDeath(finalState, wallClockMs, cfg, liveness)) {
    state.counts.delete(taskId);
    state.transientCounts.delete(taskId);
    state.backoffUntil.delete(taskId);
    return { quickDeath: false, backedOff: false, newlyNeedsHuman: false, cause: null, backoffUntil: null, signature: null, evidence: null };
  }
  const cls = classifyQuickDeathEvidence(selectorReason, stderrTail);
  if (cls.cause === "environment-fatal") {
    // 环境级故障：⛔ 不进 state.counts（⛔ 不计入任务的快速死亡计数，⛔ 永不 newlyNeedsHuman）、
    // ⛔ 不设 backoffUntil（该停的是 driver，不是这一个任务——逐任务退避仍会逐个 park 整个池子）。
    // 只记一次签名观测（供后续同签名的跨任务关联）。动作（halt driver）由调用方按 cause 承担。
    const sig = quickDeathSignature(selectorReason, stderrTail);
    if (sig != null) state.signatureSeen.set(sig.fingerprint, { task: taskId, atMs: nowMs, raw: sig.raw });
    return {
      quickDeath: true, backedOff: false, newlyNeedsHuman: false, cause: cls.cause, backoffUntil: null,
      signature: cls.signature, evidence: cls.evidence ?? sig?.raw ?? null,
    };
  }
  if (cls.cause === "transient-external") {
    const cause = cls.cause;
    // 瞬时外部（账号级限流/配额）：⛔ 不进 state.counts ⇒ ⛔ 永不 newlyNeedsHuman（终态不自愈正是本缺陷）。
    // state.counts 也【不复位】——「连续普通快速死亡」序列不被限流打断，也不被限流洗白（同 unknown 分支）。
    const tn = (state.transientCounts.get(taskId) ?? 0) + 1;
    state.transientCounts.set(taskId, tn);
    // 退避时刻优先取错误文本自带的重置时刻（已知 ⇒ 不必猜）；解析不出 ⇒ 回落指数退避（⛔ 不是"立刻重试"）。
    const until = parseRateLimitResetAtMs(selectorReason, nowMs) ?? nowMs + backoffDelayMs(tn, cfg);
    const backedOff = tn >= cfg.backoffThreshold;
    if (backedOff) state.backoffUntil.set(taskId, until);
    return { quickDeath: true, backedOff, newlyNeedsHuman: false, cause, backoffUntil: backedOff ? until : null, signature: null, evidence: null };
  }
  // ── 跨任务关联（item 2）：窗口内 ≥2 个【不同任务】以同一签名快速死亡 ⇒ 同样判 environment-fatal ──
  // 判据是「同一签名 ∧ 不同任务 ∧ 窗口内」三者同时成立（缺一不判）：同一任务重复死是任务级缺陷（本条
  // 缺陷正是把环境级故障错当任务级），没有签名（读不懂）无从关联，超过窗口就不再是「同一个环境」。
  // ⛔ 只在【不命中】环境级/限流签名时做——限流类两任务同签名是预期形态（各等各的重置时刻），把它判成
  // 环境级会让 AC1④ 的 transient-external 语义回归。⛔ 判为 environment-fatal 后【不进 counts】。
  const sig = quickDeathSignature(selectorReason, stderrTail);
  if (sig != null) {
    const prev = state.signatureSeen.get(sig.fingerprint);
    if (prev != null && prev.task !== taskId && nowMs - prev.atMs <= envFatalWindowMs) {
      state.signatureSeen.set(sig.fingerprint, { task: taskId, atMs: nowMs, raw: sig.raw });
      return {
        quickDeath: true, backedOff: false, newlyNeedsHuman: false, cause: "environment-fatal", backoffUntil: null,
        signature: `cross-task:${sig.fingerprint}`, evidence: sig.raw,
      };
    }
    state.signatureSeen.set(sig.fingerprint, { task: taskId, atMs: nowMs, raw: sig.raw });
  }
  // ordinary / unclassifiable 共用既有判别式（fail-safe：读不懂不无限重派），但 cause 取值如实可区分。
  const cause = cls.cause;
  const n = (state.counts.get(taskId) ?? 0) + 1;
  state.counts.set(taskId, n);
  if (n >= backoffMaxRetries) {
    state.backoffUntil.delete(taskId);
    return { quickDeath: true, backedOff: false, newlyNeedsHuman: true, cause, backoffUntil: null, signature: null, evidence: null };
  }
  const backedOff = n >= cfg.backoffThreshold;
  const until = backedOff ? nowMs + backoffDelayMs(n, cfg) : null;
  if (until != null) state.backoffUntil.set(taskId, until);
  return { quickDeath: true, backedOff, newlyNeedsHuman: false, cause, backoffUntil: until, signature: null, evidence: null };
}


// ── WorkerPool ────────────────────────────────────────────────────────────────────────────────

/** `recordQuickDeathBackoff` 除 `state` 外的参数（⛔ 不手抄签名——从纯函数本身取尾部元组）。 */
export type QuickDeathInput =
  Parameters<typeof recordQuickDeathBackoff> extends [QuickDeathBackoffState, ...infer Rest] ? Rest : never;

/** `applyNeedsHumanTransition` 除 `state` 外的参数（同上）。 */
export type NeedsHumanInput =
  Parameters<typeof applyNeedsHumanTransition> extends [RetryState, ...infer Rest] ? Rest : never;

// ── 结局处理扩展点（AC-915 / GOAL-909；DIR-133 裁定 2）────────────────────────────────────────────
//
// WHY：结局状态机此前散在 `runResidentLoop` 的 `onWorkerFinished` 闭包里，逐层 if/else 直接改
//   retry/backoff 状态 ⇒ 新增一种结局或决策种类必须改中心文件。本条把分派改成【注册表】：
//   每个处理单元自带 `matches(event)` 与 `plan(event)`（返回**声明式**转移），`WorkerPool` 按注册
//   顺序应用命中单元的转移。现有各分支成为用**同一注册面**注册的内置单元。
//   ⛔ 判据不以「新增文件存在」为达成：`plugin/test/worker-pool-extension-point.test.mjs` 只 import
//   本文件，从外部注册一个中心文件从未见过的合成单元并断言其转移被应用（GOAL-909 / AC-915）。
// ⛔ 边界：处理单元**不持有、不直接改写** `#retryState` / `#backoffState` —— 只能经 `plan()` 声明
//   转移，由 `applyTransition()` 统一落到私有状态。⛔ 也不把派发决策（running / coldInflight /
//   stopReason）卷进来：那是另一个关注点，停在参数边界上（GOAL-909 停止扩大范围的信号）。

/** 一次 worker 终态的【归一化事件】——由 worker-driver 构造，处理单元只读。
 *  ⛔ 处理单元不得读盘、不得持有状态：判定所需的证据（决策种类 / 判词 / 快速死亡记账结果 /
 *  既存红死锁读数）都在事件里，构造事件的读盘与判定留在调用侧。 */
export interface WorkerOutcomeEvent {
  /** 本次终态所属任务。 */
  taskId: string;
  /** `FINAL_STATES` 的取值（completed / exited-not-landed / failed / …）。 */
  finalState: string;
  /** exited-not-landed 的归一化判定；⛔ 非该终态 ⇒ null（缺值 ≠ 「未评估」）。 */
  exitedNotLanded: ExitedNotLandedOutcome | null;
  /** 快速死亡记账结果（`recordQuickDeath` 的返回）；⛔ 未评估 ⇒ null（缺值 ≠ 「不是快速死亡」）。 */
  quickDeath: QuickDeathRecord | null;
  /** 本轮重试上限（转移声明用；⛔ 是参数，不是状态）。 */
  maxRetries: number;
  /** 快速死亡墙钟阈值（needs-human 注记要写出的量，与既有文案逐字一致）。 */
  quickDeathMs: number;
}

/** exited-not-landed 的归一化判定（判定在调用侧完成；单元只据此声明转移）。 */
export interface ExitedNotLandedOutcome {
  /** `false` ⇒ 该终态【未评估】（ff-not-fast-forward：continue-cycle 重派，⛔ 不计数）。
   *  ⛔ 与「评估了、结论是某个种类」不同形（硬规则 3b）。 */
  evaluated: boolean;
  /** 决策种类；`evaluated=false` ⇒ null。 */
  decisionKind: "stop-terminal" | "count-and-retry" | null;
  /** `decideExitedNotLandedAction` 的判词（机读面：处理单元据此渲染 needs-human 文案）。 */
  decisionReason: string | null;
  /** 归因读到的失败测试文件（判词措辞由它复算，⛔ 不是写死「一个也没归因出来」）。 */
  failingTestFiles: string[];
  /** 既存红死锁读数（仅 `decisionKind === "count-and-retry"` 时计算；`kind === "stop-terminal"`
   *  ⇒ 电路断路器停派）。 */
  deadlock: { kind: "stop-terminal" | "continue"; consecutive: number; diagnostic: string | null } | null;
  /** `unrelated-flaky-exempt` ⇒ ⛔ 不推进重试上限（既有豁免）。 */
  retryExempt: boolean;
  /** 归因判词（`RetryExemptionJudgment.verdict`）；`evaluated=false` ⇒ null。 */
  exemptionVerdict: string | null;
  /** 归因依据文本（`suite-oom` 注记要把它写进去）。 */
  exemptionReason: string | null;
}

/** `recordQuickDeathBackoff` 的返回形状（处理单元消费的字段子集，⛔ 不另造一份语义）。 */
export interface QuickDeathRecord {
  quickDeath: boolean;
  backedOff: boolean;
  newlyNeedsHuman: boolean;
  cause: QuickDeathCause | null;
  backoffUntil: number | null;
  signature: string | null;
  evidence: string | null;
}

/** needs-human 终态声明：`applyTransition` 负责 latch（+ 给了 root 时落盘）。 */
export interface NeedsHumanDeclaration {
  taskId: string;
  reason: string;
  kind: NeedsHumanKind;
  /** 把重试预算记满（stop-terminal / 电路断路器路径的既有语义）。 */
  countsOverride?: number;
  /** 已 latch 的 id 不再重复执行磁盘承诺（stop-terminal / 电路断路器路径的既有守卫）。 */
  skipIfLatched?: boolean;
}

/** 声明式状态转移（⛔ 处理单元不得直接改写私有字段——一律经这里）。 */
export interface OutcomeTransition {
  /** needs-human 终态（latch + 可选磁盘落盘）。 */
  needsHuman?: NeedsHumanDeclaration[];
  /** 推进失败上限；达上限的 id 自动转 needs-human（判别语义沿用 `advanceRetryCap`）。 */
  retryAdvance?: { taskIds: string[]; maxRetries: number; reason: string; kind: NeedsHumanKind };
  /** 快速死亡退避时刻（幂等；计数/签名观测由 `recordQuickDeath` 先行记好）。 */
  backoff?: { taskId: string; untilMs: number };
  /** 停机声明（⛔ pool 不执行：写控制态是调用方的事；报告里带出，由调用方落盘）。 */
  halt?: { reason: string };
}

/** 一个结局处理单元：`matches` 决定是否命中，`plan` 声明要应用的转移。 */
export interface OutcomeHandlerUnit {
  /** 稳定 id（重复注册 ⇒ 显式报错，⛔ 不静默覆盖）。 */
  id: string;
  matches(event: WorkerOutcomeEvent): boolean;
  plan(event: WorkerOutcomeEvent): OutcomeTransition;
}

/** `applyTransition` 的落地读数。 */
export interface OutcomeTransitionResult {
  /** needs-human 落地的返回（与 `applyNeedsHumanTransition` 同形，⛔ 不丢返回值）。 */
  needsHumanResults: Array<{ id: string; ok: boolean; reason: string; committed: boolean }>;
  /** 本轮 `advanceRetryCap` 新标记的 id。 */
  retryAdvanced: string[];
}

/** 一次分派里每个【命中】单元的报告。无命中 ⇒ `dispatchOutcome` 返回 `[]`。 */
export interface OutcomeDispatchReport extends OutcomeTransitionResult {
  id: string;
  /** 该单元声明的转移是否真的落到了池状态（转录 no-op ⇒ false）。 */
  applied: boolean;
  transition: OutcomeTransition;
}

/** 内置处理单元 id（词表正本；`builtinOutcomeHandlerIds()` 返回的是【实际注册】的集合，⛔ 不是本常量的
 *  副本——两者分离才能取假：「声明了但没注册」在读数上可区分）。 */
export const BUILTIN_OUTCOME_HANDLER_IDS = [
  "exited-not-landed-baseline-red-deadlock",
  "exited-not-landed-stop-terminal",
  "exited-not-landed-count-and-retry",
  "quick-death-backoff",
  "environment-fatal-halt",
  "needs-human-terminal",
] as const;

/** stop-terminal 落 needs-human 的**完整判词**（`## Needs-Human` 小标题下的那条，⛔ 不是 `## Round` 里的诊断）。
 *
 *  gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red（AC4）：旧实现在这里
 *  写死「失败无法归因」，与同一句末尾 `${decision.reason}` 里 `parser attributed N failing file(s)`
 *  直接矛盾——**同一句话里**一边说归因不出、一边说读到了 N 个文件。措辞必须由 `failingTestFiles` 的
 *  条数复算（与 `suiteAttributionEvidence` 同一条纪律：判词只报判定器【读到了什么】）。
 *  ⛔ 纯函数：出参只由入参决定（Needs-Human 文案是验收面，必须可单测、可贴渲染文本）。
 *  ⚠️ 形态迁到本文件（AC-915）：内置 stop-terminal 处理单元要用它，而本文件 ⛔ 不得 import
 *  worker-driver.ts（import cycle）；worker-driver.ts 原样 re-export 旧名字，消费者 import 面不变。 */
export function exitedNotLandedStopNote(
  decision: { reason: string },
  exemption: { failingTestFiles?: string[] },
): string {
  const attributed = exemption.failingTestFiles ?? [];
  // 归因到 ≥1 个文件 ⇒ 真态是「读到了，但没能判为既存红 / 没能落地」。⛔ 这一段【逐字不得出现】「无法归因」
  // ——AC4 的判据是「渲染文本不再包含该词」，连「⛔ 不是『无法归因』」这种否定式引用也算命中（判据按
  // 字面量查，不按语义查：硬规则 2「按位置判定，不按关键词」在这里反过来用——要证明「不在场」，就不能
  // 把那个词写进文本里当注脚）。
  const head = attributed.length >= 1
    ? `exited-not-landed：suite 红已归因到 ${attributed.length} 个失败文件（${attributed.slice(0, 3).join(", ")}${attributed.length > 3 ? ` 等 ${attributed.length} 个` : ""}）——` +
      `这些红点没能被判为既存红（基线比较 / 落地未通过）⇒ 停止重派，⛔ 不再拿新会话撞同一堵墙`
    : `exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙`;
  return `${head}：${decision.reason}`;
}

/** 停机原因文本（含【签名原文】——`worker-control.json` 的原因里要能读到它）。
 *  `backoff` 是 `recordQuickDeathBackoff` 的环境级返回值：signature 给出签名名（含跨任务关联的
 *  `cross-task:<指纹>` 形态），evidence 给出原文摘录。⛔ 两者缺一 ⇒ 如实写「未捕获原文」，⛔ 不编造。
 *  ⚠️ 形态迁到本文件（AC-915），理由同 `exitedNotLandedStopNote`。 */
export function environmentFatalHaltReason(backoff: {
  signature: string | null;
  evidence: string | null;
  cause: QuickDeathCause | null;
}): string {
  const sig = backoff.signature ?? "unknown";
  const ev = backoff.evidence != null && backoff.evidence.length > 0 ? backoff.evidence : "(未捕获原文)";
  return (
    `worker-driver halted: environment-fatal — 所有 worker 会以同一方式失败（不是任务自身缺陷）。` +
    `签名: ${sig}；签名原文: ${ev}。` +
    `⛔ 未翻转任何任务状态、⛔ 未计入任务的快速死亡计数。修复环境后: quay driver resume --kind worker`
  );
}

/** 内置处理单元：现有各分支的原语义，用同一注册面注册（⛔ 不走后门）。
 *  ⚠️ 顺序即优先级：电路断路器（deadlock）先于普通 stop-terminal，再才是 count-and-retry；
 *  三者的 `matches` 谓词互斥，顺序只是让读数稳定可复现。 */
function builtinOutcomeHandlers(): OutcomeHandlerUnit[] {
  return [
    {
      id: "exited-not-landed-baseline-red-deadlock",
      matches: (e) =>
        e.exitedNotLanded?.evaluated === true && e.exitedNotLanded.deadlock?.kind === "stop-terminal",
      plan: (e) => {
        const d = e.exitedNotLanded!.deadlock!;
        return {
          needsHuman: [{
            taskId: e.taskId,
            reason:
              `${d.diagnostic ?? "既存红死锁"} — 停止自动重派（电路断路器：同一既存红签名连续 ${d.consecutive} 轮未变）。` +
              `⛔ 判据未放宽：本次新增 / 断言文本变化的红点仍然硬红（既存红等价豁免只覆盖「不变差」的方向）。`,
            kind: "stop-terminal",
            countsOverride: e.maxRetries,
            skipIfLatched: true,
          }],
        };
      },
    },
    {
      id: "exited-not-landed-stop-terminal",
      matches: (e) =>
        e.exitedNotLanded?.evaluated === true && e.exitedNotLanded.decisionKind === "stop-terminal",
      plan: (e) => ({
        needsHuman: [{
          taskId: e.taskId,
          reason: exitedNotLandedStopNote(
            { reason: e.exitedNotLanded!.decisionReason ?? "" },
            { failingTestFiles: e.exitedNotLanded!.failingTestFiles },
          ),
          kind: "stop-terminal",
          countsOverride: e.maxRetries,
          skipIfLatched: true,
        }],
      }),
    },
    {
      id: "exited-not-landed-count-and-retry",
      matches: (e) =>
        e.exitedNotLanded?.evaluated === true &&
        e.exitedNotLanded.decisionKind === "count-and-retry" &&
        e.exitedNotLanded.deadlock?.kind !== "stop-terminal" &&
        !e.exitedNotLanded.retryExempt,
      plan: (e) => {
        const enl = e.exitedNotLanded!;
        // gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable：OOM 归因的停派注记必须写明
        // 峰值/上限/相位（真因是可核的读数），⛔ 与普通「重试上限」同形。
        const reason = enl.exemptionVerdict === "suite-oom"
          ? `worker-driver 连续 ${e.maxRetries} 次 exited-not-landed 未落地（重试上限）；本轮 suite 红已归因于 cgroup OOM：${enl.exemptionReason ?? ""}`
          : `worker-driver 连续 ${e.maxRetries} 次 exited-not-landed 未落地（重试上限）`;
        return { retryAdvance: { taskIds: [e.taskId], maxRetries: e.maxRetries, reason, kind: "retry-cap" } };
      },
    },
    {
      id: "quick-death-backoff",
      matches: (e) => e.quickDeath?.quickDeath === true,
      plan: (e) =>
        e.quickDeath?.backoffUntil != null
          ? { backoff: { taskId: e.taskId, untilMs: e.quickDeath.backoffUntil } }
          : {},
    },
    {
      id: "environment-fatal-halt",
      matches: (e) => e.quickDeath?.cause === "environment-fatal",
      plan: (e) => ({ halt: { reason: environmentFatalHaltReason(e.quickDeath!) } }),
    },
    {
      id: "needs-human-terminal",
      matches: (e) => e.quickDeath?.newlyNeedsHuman === true,
      plan: (e) => ({
        needsHuman: [{
          taskId: e.taskId,
          reason:
            `worker-driver 连续 ${e.maxRetries} 次 <${e.quickDeathMs}ms 快速死亡（退避上限）` +
            `；快速死亡分类：${e.quickDeath!.cause ?? "unclassifiable"}`,
          kind: "quick-death-backoff",
        }],
      }),
    },
  ];
}

/** 把内置处理单元注册到某个池上（构造函数调用；也导出给显式重建的调用方）。 */
export function registerBuiltinOutcomeHandlers(pool: WorkerPool): void {
  for (const unit of builtinOutcomeHandlers()) pool.registerBuiltinOutcomeHandler(unit);
}

/**
 * 常驻 worker 池的状态拥有者。
 *
 *   状态（⛔ 不导出、⛔ 不可从外部持有）：
 *     `#retryState`   — 连续失败计数（counts）+ needs-human latch（needsHuman）
 *     `#backoffState` — 快速死亡连续计数 / 退避时刻 / 跨任务签名观测
 *   转移（唯一入口）：`advanceRetryCap` / `applyNeedsHumanTransition` / `reconcileNeedsHumanWithDisk` /
 *   `recordQuickDeath`。读面：`needsHuman` / `isBackedOff` / `consecutiveQuickDeaths` /
 *   `consecutiveTransientDeaths` / `dispatchExclusion`。
 *   ⛔ 调用方不得拿回状态容器本身（那会让「类拥有状态」退化成「类只是个桶」——AC-914 的取假面）。
 */
export class WorkerPool {
  #retryState: RetryState = { counts: new Map(), needsHuman: new Set() };
  #backoffState: QuickDeathBackoffState = newQuickDeathBackoffState();
  /** 结局处理单元注册表（注册顺序 = 分派顺序）。 */
  #outcomeHandlers: OutcomeHandlerUnit[] = [];
  /** 【实际注册】的内置单元 id（⛔ 不是 `BUILTIN_OUTCOME_HANDLER_IDS` 的副本——「声明了但没注册」可区分）。 */
  #builtinHandlerIds: string[] = [];

  /** 注册内置单元：走与外部完全相同的注册面（⛔ 不走后门），额外记入内置 id 读数面。 */
  registerBuiltinOutcomeHandler(unit: OutcomeHandlerUnit): () => void {
    const unregister = this.registerOutcomeHandler(unit);
    this.#builtinHandlerIds.push(unit.id);
    return unregister;
  }

  /** 从【外部】注册一个结局处理单元。返回注销函数（⛔ 必须能被撤销：测试与再配置都依赖它）。
   *  同一 id 重复注册 ⇒ 抛错（⛔ 不静默覆盖：那会让「后注册者生效」变成不可观测的隐式行为）。 */
  registerOutcomeHandler(unit: OutcomeHandlerUnit): () => void {
    if (typeof unit?.id !== "string" || unit.id.length === 0) {
      throw new Error("worker-pool: outcome handler must carry a non-empty string id");
    }
    if (this.#outcomeHandlers.some((h) => h.id === unit.id)) {
      throw new Error(`worker-pool: outcome handler id already registered: ${unit.id}`);
    }
    this.#outcomeHandlers.push(unit);
    return () => {
      const i = this.#outcomeHandlers.findIndex((h) => h === unit);
      if (i >= 0) this.#outcomeHandlers.splice(i, 1);
    };
  }

  /** 当前【已注册】的处理单元 id（注册顺序；只读快照）。 */
  outcomeHandlerIds(): string[] {
    return this.#outcomeHandlers.map((h) => h.id);
  }

  /** 当前已注册的【内置】处理单元 id（读数面：AC7 断言覆盖集合用它，⛔ 不用常量自称）。 */
  builtinOutcomeHandlerIds(): string[] {
    return [...this.#builtinHandlerIds];
  }

  /** 按注册顺序分派一条归一化结局：命中单元的 `plan()` 转移由 `applyTransition` 统一应用。
   *  无命中 ⇒ `[]`（缺值 = 没有单元命中，⛔ 不与「命中了但没生效」同形）。
   *  `opts.root` 给出 ⇒ needs-human 转移落盘（经 `applyNeedsHumanTransition`）；缺省 ⇒ 只落内存 latch
   *  （`new WorkerPool()` 的构造与纯分派因此无磁盘副作用）。 */
  dispatchOutcome(event: WorkerOutcomeEvent, opts: { root?: string } = {}): OutcomeDispatchReport[] {
    const reports: OutcomeDispatchReport[] = [];
    // 快照：处理单元在分派中注册/注销不影响本次分派（顺序确定 ⇒ 读数可复现）。
    for (const unit of [...this.#outcomeHandlers]) {
      if (!unit.matches(event)) continue;
      const transition = unit.plan(event);
      const applied = this.applyTransition(transition, opts);
      reports.push({
        id: unit.id,
        applied:
          applied.needsHumanResults.length > 0 ||
          applied.retryAdvanced.length > 0 ||
          transition.backoff != null ||
          transition.halt != null,
        transition,
        ...applied,
      });
    }
    return reports;
  }

  /** 把声明式转移落到私有状态（⛔ 处理单元不得绕过这里直接改写）。返回落地读数。
   *  · `needsHuman` ⇒ latch；给了 root 时**同时**落盘（经 `applyNeedsHumanTransition`，⛔ 不各写一份）。
   *  · `retryAdvance` ⇒ `advanceRetryCap`；达上限的 id 转 needs-human（kind 由转移声明）。
   *  · `backoff` ⇒ 设退避时刻（幂等；计数/签名观测已由 `recordQuickDeath` 记好）。
   *  · `halt` ⇒ ⛔ 不在此执行（写控制态是调用方的事），报告里带出。 */
  applyTransition(
    transition: OutcomeTransition,
    opts: { root?: string } = {},
  ): OutcomeTransitionResult {
    const needsHumanResults: OutcomeTransitionResult["needsHumanResults"] = [];
    const retryAdvanced: string[] = [];
    const commit = (decl: NeedsHumanDeclaration): void => {
      if (decl.skipIfLatched && this.#retryState.needsHuman.has(decl.taskId)) return;
      if (opts.root != null) {
        const res = applyNeedsHumanTransition(
          this.#retryState,
          opts.root,
          { id: decl.taskId, reason: decl.reason, kind: decl.kind },
          decl.countsOverride !== undefined ? { countsOverride: decl.countsOverride } : {},
        );
        needsHumanResults.push(res);
        return;
      }
      // 无 root：只落内存 latch（⛔ 无磁盘副作用——构造与纯内存分派不得碰盘）。
      if (!this.#retryState.needsHuman.has(decl.taskId)) {
        this.#retryState.needsHuman.add(decl.taskId);
        if (decl.countsOverride !== undefined) this.#retryState.counts.set(decl.taskId, decl.countsOverride);
      }
      needsHumanResults.push({ id: decl.taskId, ok: true, reason: decl.reason, committed: false });
    };
    for (const decl of transition.needsHuman ?? []) commit(decl);
    if (transition.retryAdvance != null) {
      const { taskIds, maxRetries, reason, kind } = transition.retryAdvance;
      retryAdvanced.push(...advanceRetryCap(this.#retryState, taskIds, maxRetries));
      for (const id of retryAdvanced) {
        commit({ taskId: id, reason, kind });
      }
    }
    if (transition.backoff != null) {
      this.#backoffState.backoffUntil.set(transition.backoff.taskId, transition.backoff.untilMs);
    }
    return { needsHumanResults, retryAdvanced };
  }

  constructor() {
    registerBuiltinOutcomeHandlers(this);
  }

  /** 该 task 是否已被 latch 为 needs-human（内存面；磁盘 status 是另一面，两者双保险）。 */
  needsHuman(taskId: string): boolean {
    return this.#retryState.needsHuman.has(taskId);
  }

  /** 推进失败上限：连续失败达 `maxRetries` 的 id 进 needsHuman 并返回（去重——已标过的不重复返回）。 */
  advanceRetryCap(taskIds: string[], maxRetries: number): string[] {
    return advanceRetryCap(this.#retryState, taskIds, maxRetries);
  }

  /** 「标记 needs-human」的唯一转移点：内存 latch（+ 可选预算覆写）与磁盘落盘承诺在这一处配对。 */
  applyNeedsHumanTransition(...args: NeedsHumanInput): ReturnType<typeof applyNeedsHumanTransition> {
    return applyNeedsHumanTransition(this.#retryState, ...args);
  }

  /** 内存 needsHuman 集合随磁盘 status 翻转对账（人翻回 ready/todo ⇒ 清 latch + 清计数）。 */
  reconcileNeedsHumanWithDisk(root: string): string[] {
    return reconcileNeedsHumanWithDisk(this.#retryState, root);
  }

  /** 一轮派发里 {inFlight, retryExhausted} 的单一计算点（GOAL-036）。 */
  dispatchExclusion(
    running: Parameters<typeof computeDispatchExclusion>[0],
    coldInflight: Parameters<typeof computeDispatchExclusion>[1],
  ): ReturnType<typeof computeDispatchExclusion> {
    return computeDispatchExclusion(running, coldInflight, this.#retryState);
  }

  /** 一次 worker 终态对快速死亡退避状态的影响（**唯一记账点**；语义见 `recordQuickDeathBackoff`）。 */
  recordQuickDeath(...args: QuickDeathInput): ReturnType<typeof recordQuickDeathBackoff> {
    return recordQuickDeathBackoff(this.#backoffState, ...args);
  }

  /** 该 task 此刻是否在退避中（`backoffUntil` 未到）。`nowMs` 须由调用方逐候选取【现时刻】。 */
  isBackedOff(taskId: string, nowMs: number): boolean {
    return isBackedOff(this.#backoffState, taskId, nowMs);
  }

  /** 该 task 连续【普通】快速死亡次数（读面；⛔ 不返回可写的 Map）。 */
  consecutiveQuickDeaths(taskId: string): number | undefined {
    return this.#backoffState.counts.get(taskId);
  }

  /** 该 task 连续【transient-external】快速死亡次数（读面；⛔ 与上面分开记，成因维度不丢）。 */
  consecutiveTransientDeaths(taskId: string): number | undefined {
    return this.#backoffState.transientCounts.get(taskId);
  }
}
