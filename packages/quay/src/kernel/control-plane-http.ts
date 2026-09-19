// control-plane-http.ts — the MCP control plane (HTTP/SSE transport + the three control tools:
// halt / setPreference / forceDispatch).
// (tasks/gap-arch-reverse-edges-zero; moved down from plugin/scripts/driver-shared.ts — see
//  kernel/control-state.ts for the full §8-①b decision record and the three measurements behind it)
//
// WHY IT IS A KERNEL MODULE: `packages/quay/src/serve.ts` hosts this server IN-PROCESS (GOAL-017 /
// AC-251, SPEC-unified-quay-server §7 stage A2: "web (serve) + control 合入一个进程"), so the
// product layer is a first-class consumer of it, and it must reach it without a `packages/**` →
// `plugin/**` reverse edge. Everything the server needs is in `./control-state.ts` + node builtins;
// the driver runtime (resource gate, spawnSync, the ~40 unrelated driver exports that stay in
// driver-shared.ts) is NOT in this module's closure — measured, not assumed.
//
// The mechanism side is unchanged: `plugin/scripts/driver-shared.ts` re-exports this module, so
// `driver-runtime.ts`'s own control-plane start (`serveControlPlane` with an explicit `rel` for its
// kind) keeps its import site. That is a FORWARD edge (`plugin/` → `packages/`), the sanctioned
// direction. The SDK (`@modelcontextprotocol/sdk/*`) and `zod` stay LAZY (`await import(...)`
// inside the function) — the dispatch loop and every pure function carry zero SDK dependency.
//
// Kernel boundary: nothing outside `kernel/` except bare specifiers (node:*, npm). Checked by
// `plugin/scripts/import-graph-check.ts` (the conditional fourth rule: `kernelChecked`).

import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  CONTROL_STATE_REL,
  CONTROL_HEADER,
  CONTROL_HEADER_NAME,
  applyForceDispatch,
  applyHalt,
  applyPreference,
  headerValue,
  readControlState,
  resolveCaller,
  writeControlState,
} from "./control-state.ts";

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
        // 显式字面量比较（⛔ 不是 `!res.ok`）：本仓库 tsconfig 是 `strict:false`（无 strictNullChecks），
        // 该设置下【取反不触发判别联合收窄】⇒ `res.reason` 编不过。本模块（连同 control-state.ts）在
        // AC-251 之前不住 packages/，从不进 root tsconfig 的 program；搬进 `kernel/` 之后它按构造就是
        // 产品源码的一部分，三处同形的一并改为 `=== false`（行为等价，只是让类型收窄成立）。
        if (res.ok === false) return reject(res.reason);
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
        if (res.ok === false) return reject(res.reason);
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
        if (res.ok === false) return reject(res.reason);
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
