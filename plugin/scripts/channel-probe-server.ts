#!/usr/bin/env node
// channel-probe-server.ts — 官方 Channels 通道的最小探针（任务 Plan 8 的产物）。
//
// 任务：tasks/gap-quay-server-lightweight-peer-identity-spike.md
//
// ⛔ 纯 Node、无 LLM 循环、⛔ 不 spawn claude。它就是一个普通 MCP server（over stdio），
//    额外声明 `capabilities.experimental['claude/channel'] = {}` —— 据官方 reference
//    （https://code.claude.com/docs/en/channels-reference）"Presence registers the notification
//    listener"。事件注入走 `notifications/claude/channel`；会话回话走本 server 暴露的 tool。
//
// 两半：
//   ① stdio 侧：MCP server（Claude Code 起它），暴露 `reply` / `ingest` 两个 tool，调用逐次落盘。
//   ② HTTP 侧：127.0.0.1 上的本地 listener，供【外部进程】POST 一条含唯一 nonce 的事件
//      （AC8 的判据要求由【外部进程】推，⛔ 不是目标会话自己）→ 转成 channel notification。
//
// 用法：
//   channel-probe-server.ts --evidence <path> [--http-port 8799] [--source quay-channel-probe]
//   channel-probe-server.ts --selfcheck          # 不开 HTTP，只做一次 stdio MCP 握手自检
//
// 退出码：0 = 正常；1 = 参数错；2 = HTTP 端口绑定失败。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// one (below) is now a one-line arity adapter over the shared `flagValue`; its algorithm was one of
// the ~73 hand-written copies of the indexOf+next-arg idiom in plugin/scripts
// (.quay/routine-findings.jsonl finding `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { flagValue } from "./gate-script-base.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// ── 常量 ──────────────────────────────────────────────────────────────────────────────────────────

export const CHANNEL_CAPABILITY_KEY = "claude/channel";
export const CHANNEL_NOTIFICATION_METHOD = "notifications/claude/channel";
export const DEFAULT_SOURCE = "quay-channel-probe";
export const DEFAULT_HTTP_PORT = 8799;
export const DEFAULT_EVIDENCE = ".quay/channel-probe-evidence.jsonl";

/** tool 名（`reply` 与官方 reference 的示例同名；`ingest` 用于 AC9 的第二标识）。 */
export const TOOL_REPLY = "reply";
export const TOOL_INGEST = "ingest";

// ── 纯函数区（单测对象：plugin/test/channel-probe-server.test.mjs） ──────────────────────────────

/**
 * 构造 server capabilities。`experimental['claude/channel'] = {}` 是【唯一】让 Claude Code 注册
 * 通知监听的开关（官方 reference 原话：presence of this key registers the channel listener）。
 */
export function buildCapabilities(): Record<string, unknown> {
  return {
    experimental: { [CHANNEL_CAPABILITY_KEY]: {} },
    tools: {},
  };
}

/** 构造一条 channel notification（`content` 是 tag 正文；`meta` 的每个键变成 tag 属性）。 */
export function buildChannelNotification(
  content: string,
  meta: Record<string, string> = {},
): { method: string; params: { content: string; meta: Record<string, string> } } {
  return { method: CHANNEL_NOTIFICATION_METHOD, params: { content, meta } };
}

/**
 * 解析外部进程 POST 的 body。要求 JSON 对象 ∧ content 为非空字符串。
 * 非法 ⇒ null（⛔ 不返回一个空 content 的通知——那会与「推了一条空事件」同形）。
 */
export function parsePushBody(raw: string): { content: string; meta: Record<string, string> } | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.content !== "string" || r.content.trim().length === 0) return null;
  const meta: Record<string, string> = {};
  if (r.meta && typeof r.meta === "object" && !Array.isArray(r.meta)) {
    for (const [k, v] of Object.entries(r.meta as Record<string, unknown>)) {
      // 官方 reference：meta 的键必须是标识符（字母/数字/下划线），含连字符的会被静默丢弃。
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === "string") meta[k] = v;
    }
  }
  return { content: r.content, meta };
}

/** 两个 tool 的声明（`reply` 带 nonce/text；`ingest` 带 nonce/note）。 */
export function buildToolList(): Array<Record<string, unknown>> {
  return [
    {
      name: TOOL_REPLY,
      description: "Reply back through the channel. Pass back the nonce from the <channel> tag verbatim.",
      inputSchema: {
        type: "object",
        properties: {
          nonce: { type: "string", description: "The nonce attribute of the <channel> event being answered" },
          text: { type: "string", description: "The reply text" },
        },
        required: ["nonce"],
      },
    },
    {
      name: TOOL_INGEST,
      description: "Record an inbound acknowledgement from the session. Pass the nonce from the <channel> tag verbatim.",
      inputSchema: {
        type: "object",
        properties: {
          nonce: { type: "string", description: "The nonce attribute of the <channel> event being acknowledged" },
          note: { type: "string", description: "Optional free-form note" },
        },
        required: ["nonce"],
      },
    },
  ];
}

/** tool 调用的证据行（AC9 要求「证据文件含该调用的唯一标识」= nonce）。 */
export function buildToolEvidence(
  toolName: string,
  args: Record<string, unknown>,
  nowMs: number = Date.now(),
): Record<string, unknown> {
  return {
    ts: new Date(nowMs).toISOString(),
    tsMs: nowMs,
    kind: "tool_call",
    tool: toolName,
    nonce: typeof args.nonce === "string" ? args.nonce : null,
    args,
  };
}

/** 会话 instructions —— 官方 reference 明说这是「告诉 Claude 该期待什么、要不要回话、用哪个 tool」。 */
export function buildInstructions(source: string): string {
  return [
    `Events from this channel arrive as <channel source="${source}" nonce="..."> ... </channel>.`,
    `Each event carries a unique nonce attribute.`,
    `For EVERY event you receive, you MUST do both of these, in order:`,
    `  1. call the \`${TOOL_REPLY}\` tool with { nonce: <the exact nonce string>, text: "ack" }`,
    `  2. call the \`${TOOL_INGEST}\` tool with { nonce: <the exact nonce string>, note: "ack" }`,
    `Copy the nonce character-for-character; do not invent or shorten it.`,
  ].join(" ");
}

export function appendEvidence(evidencePath: string, entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.appendFileSync(evidencePath, JSON.stringify(entry) + "\n");
  } catch {
    // best-effort：证据落盘失败不能杀掉 server（否则「server 在跑」这个事实也一起消失）
  }
}

// ── server 主体 ───────────────────────────────────────────────────────────────────────────────────

interface Opts {
  evidencePath: string;
  httpPort: number;
  source: string;
  enableHttp: boolean;
}

export async function runChannelServer(opts: Opts): Promise<void> {
  const mcp = new Server(
    { name: opts.source, version: "0.0.1" },
    { capabilities: buildCapabilities() as never, instructions: buildInstructions(opts.source) },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: buildToolList() as never }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    appendEvidence(opts.evidencePath, buildToolEvidence(name, args));
    return { content: [{ type: "text", text: `recorded ${name} nonce=${String(args.nonce ?? "")}` }] };
  });

  // ① stdio 侧：Claude Code 以 stdio 起本进程
  await mcp.connect(new StdioServerTransport());
  appendEvidence(opts.evidencePath, {
    ts: new Date().toISOString(), kind: "mcp_connected", source: opts.source,
    capabilities: buildCapabilities(), pid: process.pid,
  });

  // ② HTTP 侧：外部进程推事件
  if (opts.enableHttp) {
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, source: opts.source, pid: process.pid }));
        return;
      }
      if (req.method !== "POST" || req.url !== "/push") {
        res.writeHead(404); res.end("not found"); return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = parsePushBody(raw);
        if (parsed == null) {
          appendEvidence(opts.evidencePath, {
            ts: new Date().toISOString(), kind: "http_push_rejected", raw: raw.slice(0, 500),
          });
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason: "invalid body (need {content:string, meta?:object})" }));
          return;
        }
        const note = buildChannelNotification(parsed.content, parsed.meta);
        appendEvidence(opts.evidencePath, {
          ts: new Date().toISOString(), kind: "http_push_accepted",
          content: parsed.content, meta: parsed.meta, notification: note,
        });
        mcp.notification(note as never)
          .then(() => {
            appendEvidence(opts.evidencePath, {
              ts: new Date().toISOString(), kind: "notification_sent", method: note.method,
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, notified: true }));
          })
          .catch((e: unknown) => {
            appendEvidence(opts.evidencePath, {
              ts: new Date().toISOString(), kind: "notification_error",
              error: e instanceof Error ? e.message : String(e),
            });
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, reason: String(e) }));
          });
      });
    });
    server.on("error", (e: NodeJS.ErrnoException) => {
      appendEvidence(opts.evidencePath, { ts: new Date().toISOString(), kind: "http_listen_error", error: e.message, code: e.code });
      process.exit(2);
    });
    server.listen(opts.httpPort, "127.0.0.1", () => {
      appendEvidence(opts.evidencePath, {
        ts: new Date().toISOString(), kind: "http_listening", port: opts.httpPort, pid: process.pid,
      });
      process.stderr.write(`channel-probe-server: http listener on 127.0.0.1:${opts.httpPort} (pid ${process.pid})\n`);
    });
  }
}

// ── selfcheck：不开 HTTP，只做一次 stdio 侧的能力声明自检（不含 Claude Code 也能跑） ────────────────

export function selfcheck(): void {
  const caps = buildCapabilities();
  const exp = (caps.experimental ?? {}) as Record<string, unknown>;
  const ok = Object.prototype.hasOwnProperty.call(exp, CHANNEL_CAPABILITY_KEY);
  const note = buildChannelNotification("probe", { nonce: "selfcheck" });
  console.log(JSON.stringify({
    selfcheck: ok ? "PASS" : "FAIL",
    channelCapabilityDeclared: ok,
    capabilities: caps,
    notificationMethod: note.method,
    tools: buildToolList().map((t) => t.name),
  }, null, 1));
  process.exit(ok ? 0 : 1);
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: channel-probe-server.ts [--selfcheck] | [--evidence P] [--http-port N] [--source S] [--no-http]");
    process.exit(0);
  }
  if (argv.includes("--selfcheck")) { selfcheck(); return; }
  /** Arity-1 adapter over the shared `flagValue`: the `--` prefix is this call site's own spelling. */
  const one = (k: string): string | undefined => flagValue(argv, `--${k}`);
  void runChannelServer({
    evidencePath: path.resolve(one("evidence") ?? DEFAULT_EVIDENCE),
    httpPort: Number(one("http-port") ?? DEFAULT_HTTP_PORT),
    source: one("source") ?? DEFAULT_SOURCE,
    enableHttp: !argv.includes("--no-http"),
  });
}

const isDirect = (() => {
  const a1 = process.argv[1];
  if (!a1) return false;
  try { return path.resolve(a1) === path.resolve(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isDirect) main();
