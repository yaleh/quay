// plugin/scripts/driver-shared.ts — 两驱动（worker / promotion）共用的资源门 + 控制面载体（AC150-3）。
// (tasks/gap-ac150-promotion-driver-resource-gate-control-plane)
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC150-3）：promotion-driver 与 worker-driver 跑在同一台
// 机器上，二者的【资源门判定】与【halt 判定】必须是同一份实现（函数级复用，⛔ 非复制粘贴）。
// 下一阶段 AC151 做的是架构分层（把共性上收），本条只做到【先共用】：把 worker-driver.ts 里已有的
// resourceGateCheck / 控制态（read/write/halt）/ 身份闸 / serveControlPlane 抽到本文件，两驱动 import。
//
// 单一真相源（继承 worker-driver.ts SPEC §5 阶段 3 退役清单）：
//   控制态文件 = <root>/.quay/<kind>-control.json（worker → worker-control.json；promotion →
//   promotion-control.json）。每个 kind 一个文件（halting worker 不影响 promotion，反之亦然），
//   ⛔ 但读/写/判停的逻辑只有本文件一份——文件路径是【参数】（rel），不是第二份实现。
//   读失败 fail-closed（读失败/解析失败 ⇒ halted=true，硬规则 3b：读不懂 ≠ 合格）。
//   `.halt` 文件机制对【驱动】退役 —— 驱动不读 `.halt`（单一真相源 = 本控制态）。

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
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

// ── 资源门（AC150-1）：起 LLM worker / fix worker 前经同一个资源门判定 ──────────────────────────────

/** 判停条件之二：resource-gate 是否报 WAIT（AC3）。cmd 覆盖是测试缝；缺省 = 本仓库 resource-gate.sh
 *  `--for full-suite --json`。exit 0 = GO，非 0 = WAIT（读不懂/读失败 ⇒ fail-closed WAIT，硬规则 3b）。 */
export function resourceGateCheck(root: string, cmd: string[] | null): { go: boolean; reason: string } {
  const argv = cmd ?? ["bash", path.join(root, "plugin", "scripts", "resource-gate.sh"), "--for", "full-suite", "--json"];
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8", timeout: 20_000, maxBuffer: 1 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return { go: false, reason: `resource-gate spawn failed (${msg}) — fail-closed` };
  }
  if (r.error) return { go: false, reason: `resource-gate failed (${String(r.error.message || r.error)}) — fail-closed` };
  const stdout = String(r.stdout ?? "").trim();
  if (r.status === 0) {
    try {
      const j = JSON.parse(stdout);
      if (j && typeof j.verdict === "string") {
        return { go: j.verdict === "GO", reason: j.reason || `resource-gate verdict ${j.verdict}` };
      }
    } catch {
      /* not JSON — use exit code */
    }
    return { go: true, reason: stdout ? stdout.slice(0, 200) : "resource-gate GO" };
  }
  return { go: false, reason: stdout ? stdout.slice(0, 200) : `resource-gate WAIT (exit ${r.status})` };
}

// ── MCP 控制面（HTTP/SSE）：halt / setPreference / forceDispatch ────────────────────────────────────

/** serveControlPlane 返回的句柄（url 可观测，close 停服）。 */
export interface ControlPlaneHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

/**
 * 起 MCP 控制面（HTTP/SSE，streamable HTTP——同时支持 POST JSON-RPC 与 GET SSE）。暴露三操作
 * halt / setPreference / forceDispatch，全部走【身份闸】resolveCaller（AC2 header 或 tool 参数、
 * AC3 无身份拒）。SDK 与 zod 惰性 import（仅 --serve 路径加载，派发环/纯函数零 SDK 依赖）。
 * `rel` = 控制态文件路径（缺省 worker 的 CONTROL_STATE_REL）；`name` = MCP server 名（缺省 driver-control）。
 */
export async function serveControlPlane(opts: {
  root: string;
  host?: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
  rel?: string;
  name?: string;
}): Promise<ControlPlaneHandle> {
  const root = path.resolve(opts.root);
  const host = opts.host ?? "127.0.0.1";
  const env = opts.env ?? process.env;
  const rel = opts.rel ?? CONTROL_STATE_REL;
  const name = opts.name ?? "driver-control";

  const [{ McpServer }, { StreamableHTTPServerTransport }, { isInitializeRequest }, { z }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
    import("@modelcontextprotocol/sdk/types.js"),
    import("zod"),
  ]);

  // 身份闸：resolveCaller 不过 ⇒ 返回 isError 结果；过 ⇒ null。三个工具共用（AC2/AC3 统一）。
  const reject = (reason: string) => ({
    isError: true,
    content: [{ type: "text" as const, text: `rejected: ${reason}` }],
  });
  const ok = (payload: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  });

  // 每个会话一个独立 McpServer（低层 Server 只支持单 transport ⇒ SDK simpleStreamableHttp 示例
  // 也是每会话新建一个 server）。工具注册是纯函数，同一套工具挂到每个会话自己的 server 上。
  const registerControlTools = (server: any) => {
    server.registerTool(
      "halt",
      {
        title: "halt — stop NEW dispatch (never kill in-flight)",
        description:
          "MCP halt (SPEC §5 阶段 3): set halted=true to stop NEW dispatch; in-flight workers are NOT killed " +
          "(same boundary as the retired .halt sentinel). halted=false resumes. Identity is REQUIRED and " +
          `verifiable — pass \`caller\` (tool arg) or the ${CONTROL_HEADER_NAME} header; a call with no identity ` +
          "is rejected (no default identity).",
        inputSchema: {
          halted: z.boolean().optional().describe("true = halt (stop new dispatch); false = resume. Default true."),
          caller: z.string().optional().describe(`Caller identity (e.g. "outer" | "manager"); alternative to the ${CONTROL_HEADER_NAME} header.`),
        },
      },
      async (args: { halted?: boolean; caller?: string }, extra: any) => {
        const header = headerValue(extra?.requestInfo?.headers, CONTROL_HEADER);
        const res = resolveCaller({ toolArg: args.caller, header, env });
        if (!res.ok) return reject(res.reason);
        const state = readControlState(root, env, rel).state;
        const next = applyHalt(state, res.caller, args.halted ?? true);
        writeControlState(root, next, rel);
        return ok({
          halted: next.halted,
          halted_by: next.halted_by,
          halted_at: next.halted_at,
          note: "halt stops NEW dispatch only; in-flight workers are NOT killed",
        });
      },
    );

    server.registerTool(
      "setPreference",
      {
        title: "setPreference — write a selector preference",
        description:
          "MCP control plane (SPEC §5 阶段 3): write a key/value preference the selector loop reads. " +
          "Identity is REQUIRED (caller arg or header); no identity is rejected.",
        inputSchema: {
          key: z.string().describe("Preference key."),
          value: z.string().describe("Preference value."),
          caller: z.string().optional().describe(`Caller identity; alternative to the ${CONTROL_HEADER_NAME} header.`),
        },
      },
      async (args: { key: string; value: string; caller?: string }, extra: any) => {
        const header = headerValue(extra?.requestInfo?.headers, CONTROL_HEADER);
        const res = resolveCaller({ toolArg: args.caller, header, env });
        if (!res.ok) return reject(res.reason);
        const state = readControlState(root, env, rel).state;
        const next = applyPreference(state, args.key, args.value);
        writeControlState(root, next, rel);
        return ok({ preference: next.preference });
      },
    );

    server.registerTool(
      "forceDispatch",
      {
        title: "forceDispatch — record a forced dispatch",
        description:
          "MCP control plane (SPEC §5 阶段 3): record a forced-dispatch request (consumed by the resident " +
          "driver's selector loop). Identity is REQUIRED (caller arg or header); no identity is rejected.",
        inputSchema: {
          task: z.string().describe("Task id to force-dispatch."),
          reason: z.string().optional().describe("Why this task is force-dispatched."),
          caller: z.string().optional().describe(`Caller identity; alternative to the ${CONTROL_HEADER_NAME} header.`),
        },
      },
      async (args: { task: string; reason?: string; caller?: string }, extra: any) => {
        const header = headerValue(extra?.requestInfo?.headers, CONTROL_HEADER);
        const res = resolveCaller({ toolArg: args.caller, header, env });
        if (!res.ok) return reject(res.reason);
        const state = readControlState(root, env, rel).state;
        const next = applyForceDispatch(state, args.task, args.reason ?? null, res.caller);
        writeControlState(root, next, rel);
        return ok({ forced: next.forced });
      },
    );
  };

  // 多会话（stateful）路由：每个会话一个【独立 McpServer + transport】，按 Mcp-Session-Id 分流
  // （SDK simpleStreamableHttp 示例的 canonical 模式）。outer 与 manager 各连各的会话，互不干扰。
  const transports = new Map<string, any>();
  const servers = new Set<any>();

  const newTransport = async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        transports.set(sid, transport);
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && transports.get(sid) === transport) transports.delete(sid);
    };
    const server = new McpServer({ name, version: "0.6.1" });
    registerControlTools(server);
    servers.add(server);
    await server.connect(transport);
    return transport;
  };

  const httpServer = createServer((req, res) => {
    void (async () => {
      try {
        const sessionId = headerValue(req.headers as Record<string, string | string[] | undefined>, "mcp-session-id");
        const method = req.method ?? "GET";
        // GET（SSE 流）/ DELETE（会话终止）：必须带已知 session id。
        if (method === "GET" || method === "DELETE") {
          if (!sessionId || !transports.has(sessionId)) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing session ID" }, id: null }));
            return;
          }
          await transports.get(sessionId)!.handleRequest(req, res);
          return;
        }
        // POST：带已知 session id ⇒ 复用该会话的 transport；否则必须是 initialize（开新会话）。
        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res);
          return;
        }
        const body = await readRequestBody(req);
        let parsed: unknown = null;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch {
          /* fall through to 400 */
        }
        if (!parsed || !isInitializeRequest(parsed)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: no valid session ID provided" }, id: null }));
          return;
        }
        const transport = await newTransport();
        await transport.handleRequest(req, res, parsed);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
        }
      }
    })();
  });
  await new Promise<void>((resolve, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(opts.port ?? 0, host, () => resolve());
  });
  const address = httpServer.address();
  const boundPort = address && typeof address === "object" ? address.port : (opts.port ?? 0);

  return {
    url: `http://${host}:${boundPort}`,
    port: boundPort,
    close: async () => {
      for (const s of [...servers]) {
        try {
          await s.close();
        } catch {
          /* best-effort */
        }
      }
      for (const t of [...transports.values()]) {
        try {
          await t.close();
        } catch {
          /* best-effort session teardown */
        }
      }
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/** 读原始 HTTP 请求体为 UTF-8 字符串（Node 无 express 时 body 需手动读）。 */
export function readRequestBody(req: { on(ev: "data", cb: (chunk: unknown) => void): unknown; on(ev: "end", cb: () => void): unknown; on(ev: "error", cb: (e: unknown) => void): unknown }): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += String(c);
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
