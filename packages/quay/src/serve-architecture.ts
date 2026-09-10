// serve-architecture.ts — /architecture route handler, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readArchitecture, type ArchitectureResult } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, obsNote } from "./serve-render.ts";

// ── /architecture ──────────────────────────────────────────────────────────────────────────────────

interface ArchNode { label: string; x: number; y: number; w: number; h: number; highlight: "dev" | "recent" | "plain" | "stale"; fill: string; stroke: string }

function renderArchitecturePage(arch: ArchitectureResult): string {
  // Fixed diagram layout; node highlights derive from git facts (recent commits / open worktrees).
  const names = arch.components.map((c) => c.name);
  const nodeDefs: Array<{ name: string; x: number; y: number; w: number; h: number }> = [
    { name: "quay (Core)", x: 30, y: 20, w: 130, h: 44 },
    { name: "web-ui", x: 30, y: 130, w: 130, h: 44 },
    { name: "provider-abi", x: 190, y: 75, w: 130, h: 44 },
    { name: "quay-native", x: 350, y: 20, w: 120, h: 44 },
    { name: "quay-github", x: 350, y: 130, w: 120, h: 44 },
  ];
  // map design-node names → package dir names for git facts.
  const pkgByName = new Map(arch.components.map((c) => [c.name, c]));
  const recentNames = new Set(arch.components.filter((c) => c.recentCommits > 0).map((c) => c.name));
  const highlightFor = (n: string): "dev" | "recent" | "plain" | "stale" => {
    // quay (Core) is the package that owns the Web UI; quay-native/quay-github are providers.
    const pkg = n === "quay (Core)" ? pkgByName.get("quay") : pkgByName.get(n);
    if (arch.inDevelopment && n === "quay (Core)") return "dev";
    if (pkg && recentNames.has(pkg.name)) return "recent";
    if (n === "quay-github") return "stale"; // GitHub provider has had no recent write-path work (design note)
    return "plain";
  };
  const fillStroke: Record<string, [string, string]> = {
    dev: ["var(--color-accent-100)", "var(--color-accent)"],
    recent: ["var(--color-accent-100)", "var(--color-accent-700)"],
    stale: ["var(--color-neutral-200)", "var(--color-neutral-700)"],
    plain: ["var(--color-surface)", "var(--color-neutral-400)"],
  };
  const nodes: ArchNode[] = nodeDefs.map((d) => {
    const hl = highlightFor(d.name);
    const [fill, stroke] = fillStroke[hl];
    return { ...d, label: d.name, highlight: hl, x: d.x, y: d.y, w: d.w, h: d.h, fill, stroke };
  });
  const edges = [
    { x1: 95, y1: 64, x2: 95, y2: 130 },
    { x1: 95, y1: 88, x2: 190, y2: 97 },
    { x1: 255, y1: 97, x2: 350, y2: 42 },
    { x1: 255, y1: 97, x2: 350, y2: 152 },
  ];
  const svg = html`<svg viewBox="0 0 500 220" width="100%" style="background:var(--color-bg);border:1px solid var(--color-divider);border-radius:6px;max-width:100%">
    ${edges.map((e) => html`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" style="stroke:var(--color-neutral-400)" stroke-width="1.5"></line>`).join("")}
    ${nodes.map((n) => html`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" style="fill:${n.fill};stroke:${n.stroke}" stroke-width="2" rx="4"></rect>`).join("")}
    ${nodes.map((n) => html`<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2}" font-size="11" text-anchor="middle" dominant-baseline="middle" style="fill:var(--color-text)">${escapeHtml(n.label)}</text>`).join("")}
  </svg>`;
  const componentTable = arch.components.length > 0 ? html`<h2>组件最近变更（git 可证，近 ${7} 天）</h2>
    <table>
      <tr><th>组件</th><th>路径</th><th>近 7 天提交</th><th>末次提交</th></tr>
      ${arch.components.map((c) => html`<tr>
        <td>${escapeHtml(c.name)}</td>
        <td><code>${escapeHtml(c.path)}</code></td>
        <td>${c.recentCommits}</td>
        <td>${c.lastCommitAt != null ? escapeHtml(new Date(c.lastCommitAt * 1000).toISOString().slice(0, 16)) : "—"}</td>
      </tr>`).join("\n")}
    </table>` : "";
  const legend = html`<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;font-size:0.75rem;color:var(--color-neutral-700)">
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--color-accent-100);border:2px solid var(--color-accent)"></span> 正在开发</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--color-accent-100);border:2px solid var(--color-accent-700)"></span> 最近变更</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--color-neutral-200);border:2px solid var(--color-neutral-700)"></span> 已标记问题</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--color-surface);border:2px solid var(--color-neutral-400)"></span> 稳定</span>
  </div>`;
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay architecture — system component map">${modernistStyles()}${pageStyles()}<title>Architecture — 系统组件图</title></head>
    <body>${renderMobileChrome("architecture", "architecture")}${renderSiteNav("architecture")}<main id="main">
      <h1>Architecture — 系统组件图</h1>
      <p class="meta">数据源：<code>packages/*</code>（git log 提交事实）· <code>git worktree list</code>（在飞开发）</p>
      ${obsNote(arch.status, arch.reason)}
      ${arch.status === "ok" ? legend : ""}
      ${arch.status === "ok" ? svg : ""}
      ${componentTable}
    </main></body></html>`;
}

export async function handleArchitecture(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let arch: ArchitectureResult;
  try {
    arch = readArchitecture(cfg.workspaceRoot);
  } catch (err) {
    arch = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, components: [], inDevelopment: false };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderArchitecturePage(arch));
}
