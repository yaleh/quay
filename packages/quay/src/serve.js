// quay serve — starts Web + provider host (proposal §9). v0 walking
// skeleton (G5): a crude but real list/detail HTTP view, no framework, no
// styling beyond what's needed to prove the loop. The Core renders
// presentation; the Provider declares semantics only (design §6.3) — this
// file never branches on provider id.

import http from "node:http";
import path from "node:path";
import { loadConfig, activeProvider } from "./config.js";
import { connectProvider } from "./provider-client.js";

function html(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export async function startServer({ port = 4173 } = {}) {
  const cfg = loadConfig();
  const provider = activeProvider(cfg);
  const providerDir = path.resolve(cfg.workspaceRoot, provider.path ?? ".");
  const [command, ...args] = provider.mcp_entry;

  const client = await connectProvider({
    command,
    args,
    cwd: providerDir,
    env: { QUAY_NATIVE_TASKS_DIR: path.resolve(cfg.workspaceRoot, provider.tasks_dir ?? "tasks") },
  });

  const manifest = await client.manifest();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/") {
      const tasks = await client.taskList({});
      const rows = tasks
        .map(
          (t) => html`<tr>
            <td><a href="/task/${t.id}">${escapeHtml(t.id)}</a></td>
            <td>${escapeHtml(t.status)}</td>
            <td>${escapeHtml(t.role)}</td>
            <td>${escapeHtml(t.title)}</td>
          </tr>`
        )
        .join("\n");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html`<!doctype html>
        <html><head><title>Quay — ${escapeHtml(manifest.name)}</title></head>
        <body>
          <h1>Quay — task list (${escapeHtml(manifest.id)} provider)</h1>
          <table border="1" cellpadding="4">
            <tr><th>id</th><th>status</th><th>role</th><th>title</th></tr>
            ${rows}
          </table>
        </body></html>`);
      return;
    }

    const m = /^\/task\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const t = await client.taskGet(id);
      if (!t) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      const buttons = (manifest.action_buttons ?? [])
        .filter((b) => !b.whenStatus || b.whenStatus.includes(t.status))
        .map(
          (b) => html`<form method="post" action="/task/${t.id}/action/${b.id}" style="display:inline">
            <button type="submit">${escapeHtml(b.label)}</button>
          </form>`
        )
        .join("\n");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html`<!doctype html>
        <html><head><title>${escapeHtml(t.id)}</title></head>
        <body>
          <p><a href="/">&larr; back to list</a></p>
          <h1>${escapeHtml(t.id)}: ${escapeHtml(t.title)} [${escapeHtml(t.status)}]</h1>
          <p>role: ${escapeHtml(t.role)} · labels: ${escapeHtml((t.labels || []).join(", "))}</p>
          <pre>${escapeHtml(t.body)}</pre>
          <div>${buttons}</div>
        </body></html>`);
      return;
    }

    const am = /^\/task\/([^/]+)\/action\/([^/]+)$/.exec(url.pathname);
    if (am && req.method === "POST") {
      const [, id, actionId] = am;
      const { composePayload, deliverTrigger } = await import("./action.js");
      const t = await client.taskGet(decodeURIComponent(id));
      const payloadObj = composePayload({ providerManifest: manifest, task: t, actionId: decodeURIComponent(actionId) });
      const result = await deliverTrigger({
        root: cfg.workspaceRoot,
        channel: `task-${t.id}`,
        payloadObj,
      });
      res.writeHead(302, { Location: `/task/${t.id}` });
      res.end();
      console.log(`[quay serve] action ${actionId} on ${id}:`, result);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  server.listen(port, () => {
    console.log(`quay serve: listening on http://localhost:${port}`);
  });

  return server;
}
