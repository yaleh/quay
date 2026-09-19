// control-state.ts — the control-state carrier + the caller-identity gate: the ONE implementation
// of "halt / setPreference / forceDispatch" state and of "who is allowed to ask".
// (tasks/gap-arch-reverse-edges-zero; moved down from plugin/scripts/driver-shared.ts)
//
// WHY IT EXISTS (inherited verbatim from the file it came from — AC150-3): promotion-driver and
// worker-driver run on one machine, so their halt judgment must be the same implementation
// (function-level reuse, ⛔ not copy-paste). Single source of truth:
//   控制态文件 = <root>/.quay/<kind>-control.json（worker → worker-control.json；promotion →
//   promotion-control.json）。每个 kind 一个文件（halting worker 不影响 promotion，反之亦然），
//   ⛔ 但读/写/判停的逻辑只有本文件一份——文件路径是【参数】(rel)，不是第二份实现。
//   读失败 fail-closed（读失败/解析失败 ⇒ halted=true，硬规则 3b：读不懂 ≠ 合格）。
//   `.halt` 文件机制对【驱动】退役 —— 驱动不读 `.halt`（单一真相源 = 本控制态）。
//
// ── WHY THESE MOVE TO `kernel/` AND `serveControlPlane` GOES WITH THEM ───────────────────────────
// DECISION (§8-①b of SPEC-architecture-consolidation-ts-and-shell-2026-09-19, the SPEC's ONE
// unsettled fork — recorded here and in the commit message because it was left to the implementer
// on purpose). Options were "inject `serveControlPlane` into serve.ts" vs "move it down". Chosen:
// MOVE DOWN. Measurements behind the choice:
//   (1) INJECTION HAS NO INJECTOR. `startServer()`'s only caller in the whole repo is
//       `packages/quay/src/cli/serve.ts` — itself under `packages/**`, so it cannot supply a plugin
//       implementation any more than `serve.ts` can. Injection would therefore mean the MCP control
//       plane silently never starts in the product (GOAL-017/AC-251's whole point is that `quay
//       serve` hosts web+control under ONE pid), a behavioral regression no check in this repo
//       would catch.
//   (2) A RUNTIME-RESOLVED DEFAULT WOULD BREAK SELF-CONTAINMENT, which is what AC4 of this task
//       actually measures. Resolving `plugin/scripts/driver-shared.ts` by a computed path at
//       runtime (the `ff-merge.ts` spawn idiom) would leave the dist bundle depending on a `.ts`
//       file that only exists in a dev checkout — i.e. it would satisfy the import-graph checker
//       by construction while making the PRODUCT less standalone. The task explicitly warns
//       against trading "an edge the import graph can read" for "an edge that does not resolve in
//       the consumer".
//   (3) "DRAGGING DRIVER SEMANTICS INTO L0" IS FALSIFIED BY THE CLOSURE, MEASURED. `serveControlPlane`'s
//       transitive closure is {this file, ./control-plane-http.ts, ./write-json-atomic.ts} +
//       `node:fs` / `node:path` / `node:http` / `node:crypto`. It does NOT reach the driver runtime:
//       `resourceGateCheck`, `resolveResourceGateScript`, `spawnSync` and `fileURLToPath` all stay
//       behind in driver-shared.ts, untouched. What moves is the control-STATE + identity-gate +
//       MCP-hosting domain — which `packages/quay/src/serve.ts` has hosted in-process since stage A2
//       (AC-251), i.e. it is by then a shared primitive, which is exactly L0's definition.
// The mechanism side keeps every import site: `plugin/scripts/driver-shared.ts` re-exports this
// module, so `driver-runtime.ts`, `worker-driver.ts`, `promotion-driver.ts` and the test harnesses
// are unchanged. That is a FORWARD edge (`plugin/` → `packages/`), the sanctioned direction.
//
// Kernel boundary: nothing outside `kernel/` except bare specifiers (node:*). Checked by
// `plugin/scripts/import-graph-check.ts` (the conditional fourth rule: `kernelChecked`).

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./write-json-atomic.ts";

// ── 常量 ───────────────────────────────────────────────────────────────────────────────────────────

/** worker 控制态文件的仓库相对路径（gitignored 运行时状态，worker-outcome.jsonl 同族）。单一真相源。 */
export const CONTROL_STATE_REL = ".quay/worker-control.json";

/** promotion 控制态文件的仓库相对路径（AC150-2：promotion 可被运行期 halt；同族，独立文件——
 *  halting worker 不杀 promotion、反之亦然）。 */
export const PROMOTION_CONTROL_STATE_REL = ".quay/promotion-control.json";

/** known-callers 定义点（读 QUAY_CONTROL_CALLERS，逗号分隔；缺省 outer,manager）。 */
export const CONTROL_CALLERS_ENV = "QUAY_CONTROL_CALLERS";

/** 缺省 known-callers（SPEC §5 阶段 3：调用方是 outer 或 manager；身份可核 = 成员在此集合内）。 */
export const DEFAULT_CALLERS = ["outer", "manager"] as const;

/** 身份 header 的【小写】键（HTTP header 名大小写不敏感，Node 统一小写）。 */
export const CONTROL_HEADER = "mcp-caller-id";

/** 身份 header 的展示名（文档/错误消息用）。 */
export const CONTROL_HEADER_NAME = "Mcp-Caller-Id";

// ── 控制态（单一真相源）：控制态 + 身份 + halt 派发闸 ──────────────────────────────────────────────

/** 一条强制派发记录（forceDispatch 落盘，驻留驱动的 selector 环消费）。 */
export interface ForcedDispatch {
  task: string;
  reason: string | null;
  caller: string;
  at: string;
}

/** 控制态（单一真相源）。halted = 停止【新】派发（不杀在飞）；preference = selector 倾向存储。 */
export interface ControlState {
  schemaVersion: 1;
  halted: boolean;
  halted_by: string | null;
  halted_at: string | null;
  preference: Record<string, string>;
  forced: ForcedDispatch[];
}

export function defaultControlState(): ControlState {
  return { schemaVersion: 1, halted: false, halted_by: null, halted_at: null, preference: {}, forced: [] };
}

/** 把任意解析结果合并为 ControlState（缺失字段取缺省，不信任输入形状）。 */
export function mergeControlState(parsed: unknown): ControlState {
  const d = defaultControlState();
  if (!parsed || typeof parsed !== "object") return d;
  const p = parsed as Record<string, unknown>;
  return {
    schemaVersion: 1,
    halted: typeof p.halted === "boolean" ? p.halted : d.halted,
    halted_by: typeof p.halted_by === "string" ? p.halted_by : null,
    halted_at: typeof p.halted_at === "string" ? p.halted_at : null,
    preference:
      p.preference && typeof p.preference === "object" && !Array.isArray(p.preference)
        ? { ...(p.preference as Record<string, string>) }
        : {},
    forced: Array.isArray(p.forced)
      ? (p.forced as unknown[]).filter((f): f is ForcedDispatch => !!f && typeof f === "object")
      : [],
  };
}

/**
 * 读控制态（单一真相源）。缺失 ⇒ 缺省（未 halt）；任何【读失败/解析失败】⇒ fail-closed（halted=true，
 * 硬规则 3b：读不懂 ≠ 合格，绝不伪装成「未 halt」）。返回 { state, parseError }。
 * `rel` = 控制态文件路径（缺省 worker 的 CONTROL_STATE_REL；promotion 传 PROMOTION_CONTROL_STATE_REL）。
 */
export function readControlState(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  rel: string = CONTROL_STATE_REL,
): { state: ControlState; parseError: string | null } {
  const file = path.join(root, rel);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
    if (code === "ENOENT") return { state: defaultControlState(), parseError: null };
    return { state: { ...defaultControlState(), halted: true }, parseError: `could not read control state at ${file}` };
  }
  try {
    return { state: mergeControlState(JSON.parse(text)), parseError: null };
  } catch {
    return { state: { ...defaultControlState(), halted: true }, parseError: `unparseable control state at ${file}` };
  }
}

/** 写控制态（原子：经 writeJsonAtomic 写 .tmp 再 rename，避免派发环读到半截）。返回落盘路径。 */
export function writeControlState(root: string, state: ControlState, rel: string = CONTROL_STATE_REL): string {
  const file = path.join(root, rel);
  writeJsonAtomic(file, state);
  return file;
}

/** halt 闸（AC1）：派发环在 spawn 前读它。halted=true ⇒ 停止【新】派发（不杀在飞）。fail-closed。 */
export function isHalted(root: string, env: NodeJS.ProcessEnv = process.env, rel: string = CONTROL_STATE_REL): boolean {
  return readControlState(root, env, rel).state.halted;
}

/** halt 操作（AC1 语义）：只翻 halted/halted_by/halted_at，不触碰任何在飞 worker。 */
export function applyHalt(
  state: ControlState,
  caller: string,
  halted = true,
  nowIso = new Date().toISOString(),
): ControlState {
  return { ...state, halted, halted_by: halted ? caller : null, halted_at: halted ? nowIso : null };
}

/** setPreference 操作：写 preference[k]=v（selector 的倾向存储）。 */
export function applyPreference(state: ControlState, key: string, value: string): ControlState {
  return { ...state, preference: { ...state.preference, [key]: value } };
}

/** forceDispatch 操作：append 一条强制派发记录（驻留驱动的 selector 环消费）。 */
export function applyForceDispatch(
  state: ControlState,
  task: string,
  reason: string | null,
  caller: string,
  nowIso = new Date().toISOString(),
): ControlState {
  return { ...state, forced: [...state.forced, { task, reason, caller, at: nowIso }] };
}

// ── 身份（AC2/AC3）：显式传 + 可核 + 无身份拒 ───────────────────────────────────────────────────────

/** known-callers（可核 = 调用方必须在此集合内）。读 CONTROL_CALLERS_ENV，缺省 DEFAULT_CALLERS。 */
export function knownCallers(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env[CONTROL_CALLERS_ENV];
  const list = raw && raw.trim() ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [...DEFAULT_CALLERS];
  return new Set(list);
}

export type CallerResolution =
  | { ok: true; caller: string }
  | { ok: false; reason: string; code: "no-caller" | "unknown-caller" };

/**
 * 身份解析（AC2/AC3 核心）：tool 参数 `caller` 优先，其次 header `Mcp-Caller-Id`；两者皆缺 ⇒ 拒
 * （⛔ 不得按默认身份放行）；不在 knownCallers ⇒ 拒（unknown-caller）。Mcp-Session-Id 完全不参与。
 */
export function resolveCaller(opts: {
  toolArg?: string | null | undefined;
  header?: string | null | undefined;
  env?: NodeJS.ProcessEnv;
}): CallerResolution {
  const raw = (opts.toolArg ?? "").trim() || (opts.header ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      code: "no-caller",
      reason: `no caller identity — pass the \`caller\` tool arg or the ${CONTROL_HEADER_NAME} header (⛔ no default identity)`,
    };
  }
  const callers = knownCallers(opts.env);
  if (!callers.has(raw)) {
    return {
      ok: false,
      code: "unknown-caller",
      reason: `unknown caller "${raw}" (known callers: ${[...callers].sort().join(", ")})`,
    };
  }
  return { ok: true, caller: raw };
}

/** 从 requestInfo.headers 取一个 header（兼容 string / string[] / Headers.get 三种形态）。 */
export function headerValue(
  headers: Record<string, string | string[] | undefined> | { get(name: string): string | null } | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  if (typeof (headers as { get?: (n: string) => string | null }).get === "function") {
    return (headers as { get(n: string): string | null }).get(name);
  }
  const v = (headers as Record<string, string | string[] | undefined>)[name];
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : String(v);
}
