// quay serve — starts Web + provider host (proposal §9). v0 walking
// skeleton (G5): a crude but real list/detail HTTP view, no framework, no
// styling beyond what's needed to prove the loop. The Core renders
// presentation; the Provider declares semantics only (design §6.3) — this
// file never branches on provider id.
//
// M100 (ARCH-M93-003): route handler bodies extracted to serve-handlers.ts.
// startServer is now a thin dispatcher (~40 lines). All rendering helpers
// and handler logic live in serve-handlers.ts; this file holds only setup
// and server lifecycle.

import http, { type Server } from "node:http";
import path from "node:path";
import { loadConfig, activeProvider } from "./config.ts";
import { connectProvider, type ProviderClient } from "./provider-client.ts";
import { resolveProviderEnv } from "./provider-env.ts";
import { handleAllRoutes } from "./serve-handlers.ts";

// Re-export rendering helpers so external consumers (tests, etc.) can still
// import them from serve.ts if needed. These now live in serve-handlers.ts.
export {
  html,
  escapeHtml,
  stripHeadings,
  pageStyles,
  renderMarkdown,
  inlineMarkdown,
  relativeTime,
  isSafeRelativeRedirect,
} from "./serve-handlers.ts";

export interface StartServerOptions {
  port?: number;
  /** Host to bind to. Defaults to "0.0.0.0" (all interfaces). */
  host?: string;
}

export async function startServer({ port = 4173, host = "0.0.0.0" }: StartServerOptions = {}): Promise<Server & { client: ProviderClient }> {
  const cfg = loadConfig();
  const provider = activeProvider(cfg, undefined);
  const providerDir = path.resolve(cfg.workspaceRoot, provider.path ?? ".");
  const [command, ...args] = provider.mcp_entry;

  const client = await connectProvider({
    command,
    args,
    cwd: providerDir,
    // QN-045 (closes DESIGN.md §4.4's asymmetry): previously this built a
    // single-key env object from `provider.tasks_dir` directly, ignoring
    // `provider.env` entirely — the CLI/MCP legs resolved env the other way
    // (via resolveProviderEnv(cfg, provider), reading only `provider.env`).
    // A workspace config setting `tasks_dir` and `env` to different values
    // would silently serve a different task store to the Web UI than to the
    // CLI/MCP legs. Now all three bindings share the one resolution path.
    env: resolveProviderEnv(cfg, provider),
  });

  const manifest = await client.manifest();

  // M26-adversarial-eval finding M26-F2 (Phase A audit): this request
  // handler had no top-level try/catch. Combined with provider-client.js's
  // taskList() previously swallowing Provider errors into an empty array,
  // failures were invisible; now that taskList() (and any other client.*
  // call) can throw on a real Provider failure (malformed task file
  // crashing the store, or a live rate-limit/network failure), an unhandled
  // throw inside this async handler would leave the request hanging (no
  // res.end() ever called) rather than degrading safely. This wrapper
  // ensures ANY thrown error from the request-handling logic below (not
  // just the taskList() case) results in a clean 500 response instead of a
  // hung connection or an uncaught rejection that could take the whole
  // server down.
  const server = http.createServer(async (req, res) => {
    try {
      await handleAllRoutes(req, res, client, manifest, cfg);
    } catch (err) {
      console.error(`[quay serve] request handler error (${req.method} ${req.url}):`, (err as Error).stack || String(err));
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("internal server error");
      } else {
        res.end();
      }
    }
  });

  // QX-038 (experiment 4, iteration 11): DIR-005 item 5 — bind explicitly to 0.0.0.0
  // (all interfaces) instead of relying on Node's implicit default, and update the log
  // line to reflect the actual binding. Previously `server.listen(port)` with no host
  // bound all interfaces (0.0.0.0) by default, but the log line claimed `localhost`,
  // misleading the G7 precondition check ("reachable on 0.0.0.0, not localhost-only")
  // into reading it as a localhost-only binding when it was not.
  //
  // Port-collision fix (gap-serve-family-port-collision, 2026-08-12): two
  // startServer lifecycle defects made the pid-derived test-port scheme necessary:
  // (a) this function resolved BEFORE the bind completed — a caller could not read
  // `server.address().port` back, so tests could not use the kernel-assigned
  // ephemeral port (`port: 0`); (b) there was no 'error' handler, so a bind failure
  // (EADDRINUSE) crashed the process with an unhandled 'error' event instead of a
  // clean rejection. Both are fixed here: the promise resolves only once the
  // 'listening' event fires (so `server.address().port` is valid immediately after
  // `await startServer({ port: 0 })`), and a persistent 'error' handler turns bind
  // failures into logged rejections. An explicit, user-supplied `port` is still
  // honored exactly — `port: 0` is only the internal/test convention for asking the
  // kernel to pick an ephemeral port.
  server.on("error", (err) => {
    console.error(`[quay serve] server error:`, (err as Error).stack || String(err));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = addr && typeof addr === "object" ? addr.port : port;
      console.log(`quay serve: listening on http://${host}:${actualPort}`);
    });
  });

  // QN-031 (iteration 21): expose the underlying provider client so a caller
  // (notably an automated test) can shut down the MCP child process cleanly
  // instead of leaving it running after http.Server.close(). This is a pure
  // addition (a new property on the returned object) — no existing caller's
  // behavior changes, since nothing previously read `server.client`.
  (server as Server & { client: ProviderClient }).client = client;
  return server as Server & { client: ProviderClient };
}
