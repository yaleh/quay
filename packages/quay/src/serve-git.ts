// serve-git.ts — /git-history route handler + git graph layout, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readGitHistory, type GitHistoryCommit, type GitHistoryResult } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, pad2 } from "./serve-render.ts";

export interface GitHistoryBranch {
  ref: string;
  commits: Array<{ hash: string; t: number; parents: number; subject: string }>;
  firstT: number;
  lastT: number;
}

/**
 * Group commits into per-branch lanes, ordered by most-recent landing time (desc) then name.
 * readGitHistory already re-attributed shared/mainline-reachable commits to the mainline ref
 * (gap-git-history-branch-summary-wrong-numbers), so a task branch's lane here holds exactly its
 * own (exclusive) commits — `git log develop..<branch>` — never the shared ancestry.
 */
export function groupCommitsByBranch(commits: GitHistoryCommit[]): GitHistoryBranch[] {
  const byRef = new Map<string, GitHistoryBranch>();
  for (const c of commits) {
    let b = byRef.get(c.ref);
    if (!b) {
      b = { ref: c.ref, commits: [], firstT: c.t, lastT: c.t };
      byRef.set(c.ref, b);
    }
    b.commits.push(c);
    if (c.t < b.firstT) b.firstT = c.t;
    if (c.t > b.lastT) b.lastT = c.t;
  }
  // Within a lane, render commits oldest→newest (left→right along the interval line). git log
  // yields newest-first, but element order is only cosmetic; ascending keeps the segment + points
  // in reading order and makes the x-axis mapping deterministic to test.
  for (const b of byRef.values()) b.commits.sort((a, c) => a.t - c.t || a.hash.localeCompare(c.hash));
  return [...byRef.values()].sort((a, b) => b.lastT - a.lastT || a.ref.localeCompare(b.ref));
}

/**
 * A `task/<id>` branch ref maps to task id `<id>` (the /task/<id> detail page already exists);
 * a non-task ref (develop / master / integration / verify/…) has no task id and stays plain text.
 * gap-git-history-clickable-branches-window: branch names on the chart + summary link out to the
 * task that produced them.
 */
export function taskIdFromBranchRef(ref: string): string | null {
  if (!ref.startsWith("task/")) return null;
  const id = ref.slice("task/".length);
  return id.length > 0 ? id : null;
}

function isoTime(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}


export interface GitGraphBranchLane {
  ref: string;
  commits: Array<{ hash: string; t: number; parents: number; subject: string }>;
  /** Trunk commit hash the branch forked from (null = fork predates the active window). */
  fork: string | null;
  /** Trunk commit hash the branch merged back into (null = not yet merged within the window). */
  merge: string | null;
  firstT: number;
  lastT: number;
  /** AC2: branches are collapsed by default — the client shows count + span until expanded. */
  collapsed: true;
}

export interface GitGraphLayout {
  trunk: { ref: string; commits: Array<{ hash: string; t: number; parents: number; subject: string }> };
  branches: GitGraphBranchLane[];
  commitCount: number;
  mergeCount: number;
}

/**
 * Compute the vertical graph structure: a trunk (the first-parent chain from HEAD) + one lateral
 * lane per branch that forks from and merges back into the trunk. PURE and deterministic on its
 * input — AC1 (vertical trunk + fork/merge edges) is tested on this output, before any SVG is drawn.
 */
export function layoutGitGraph(history: GitHistoryResult): GitGraphLayout | null {
  if (history.status !== "ok" || history.commits.length === 0) return null;
  const byHash = new Map(history.commits.map((c) => [c.hash, c]));
  // Trunk = first-parent chain from HEAD (the mainline that receives the fan-in merges). When HEAD
  // is unresolvable, fall back to the newest commit — the layout still yields a vertical trunk.
  let cur: string | null = history.head ?? pickHead(history);
  const trunkHashes: string[] = [];
  const seen = new Set<string>();
  while (cur && byHash.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    trunkHashes.push(cur);
    cur = byHash.get(cur)!.parentHashes[0] ?? null;
  }
  const trunkSet = new Set(trunkHashes);
  const toCommit = (h: string): { hash: string; t: number; parents: number; subject: string } => {
    const c = byHash.get(h)!;
    return { hash: c.hash, t: c.t, parents: c.parents, subject: c.subject };
  };
  const trunk = {
    ref: branchNameOf(history, history.head ?? trunkHashes[0] ?? ""),
    commits: trunkHashes.map(toCommit).reverse(), // oldest → newest
  };

  const branches: GitGraphBranchLane[] = [];
  for (const hash of trunkHashes) {
    const c = byHash.get(hash)!;
    if (c.parentHashes.length < 2) continue; // not a merge — no branch lands here
    // Each non-first parent is a branch tip merged in. Walk its first-parent chain back to the first
    // trunk commit (the fork point); the commits in between are that branch's own commits.
    for (const p of c.parentHashes.slice(1)) {
      const lane: Array<{ hash: string; t: number; parents: number; subject: string }> = [];
      let curP: string | null = p;
      let fork: string | null = null;
      const visited = new Set<string>();
      while (curP && byHash.has(curP) && !trunkSet.has(curP) && !visited.has(curP)) {
        visited.add(curP);
        const pc = byHash.get(curP)!;
        lane.push({ hash: pc.hash, t: pc.t, parents: pc.parents, subject: pc.subject });
        curP = pc.parentHashes[0] ?? null;
      }
      if (curP && trunkSet.has(curP)) fork = curP;
      if (lane.length === 0) continue;
      lane.reverse(); // oldest → newest
      const ts = lane.map((x) => x.t);
      branches.push({
        ref: branchNameOf(history, p),
        commits: lane,
        fork,
        merge: hash,
        firstT: Math.min(...ts),
        lastT: Math.max(...ts),
        collapsed: true,
      });
    }
  }
  const mergeCount = history.commits.filter((c) => c.parents > 1).length;
  return { trunk, branches, commitCount: history.commits.length, mergeCount };
}

/** Fallback trunk root when HEAD is unresolvable: the newest commit in the window. */
function pickHead(history: GitHistoryResult): string | null {
  let best: GitHistoryCommit | null = null;
  for (const c of history.commits) if (!best || c.t > best.t) best = c;
  return best ? best.hash : null;
}

/** Branch name for a tip commit: the active ref pointing at it, else the `--source` ref, else short hash. */
function branchNameOf(history: GitHistoryResult, hash: string): string {
  for (const [name, tip] of Object.entries(history.heads ?? {})) {
    if (tip === hash) return name;
  }
  return history.commits.find((c) => c.hash === hash)?.ref ?? hash.slice(0, 7);
}

// ── D3 inlining (the third-party library the retired 「零客户端 JS」 invariant now permits) ──
// d3.min.js is inlined the SAME way as the Modernist CSS (webui-modernist.css): the dist bundle
// carries it on globalThis.__WEBUI_D3_JS__ (build-dist.mjs), and the dev tree reads it from
// node_modules. d3.min.js is a trusted, audited vendor asset that contains no "</script" sequence,
// so inlining it verbatim into a <script> element is safe.

const __webuiD3Global = globalThis as unknown as { __WEBUI_D3_JS__?: string };

/** Resolve d3.min.js's path by walking up from this module (dev-tree fallback; the dist bundle uses
 *  the inlined globalThis.__WEBUI_D3_JS__ and never reaches here). No `createRequire` — the dist
 *  banner already imports it, and a second import would be a duplicate-identifier SyntaxError. */
function d3MinJsPath(): string | null {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 16; i++) {
      const candidate = path.join(dir, "node_modules", "d3", "dist", "d3.min.js");
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}

/** The D3 library source to inline into the /git-history page ("" when unavailable). */
function gitGraphLibJs(): string {
  if (__webuiD3Global.__WEBUI_D3_JS__ !== undefined) return __webuiD3Global.__WEBUI_D3_JS__;
  const p = d3MinJsPath();
  if (!p) return "";
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** The client-side D3 renderer. Collapse/expand is toggled client-side; branches start COLLAPSED
 *  (AC2). Written without template literals / `${` / hex / `</script` so it inlines verbatim. */
export function gitGraphClientScript(): string {
  return `(function () {
  var mount = document.getElementById("git-graph");
  var dataEl = document.getElementById("git-graph-data");
  if (!mount || !dataEl || typeof d3 === "undefined") { return; }
  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!data || !data.trunk || !data.trunk.commits.length) { return; }

  var rowH = 26, trunkX = 170, laneGap = 26, nodeR = 4, mergeR = 5, padY = 24;
  var trunk = data.trunk;
  var branches = data.branches || [];

  // global row = commit order by landing time (the vertical axis is commit landing order).
  var all = trunk.commits.slice();
  branches.forEach(function (b) { all = all.concat(b.commits); });
  all.sort(function (a, b) {
    if (a.t !== b.t) { return a.t - b.t; }
    return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
  });
  var rowOf = {};
  all.forEach(function (c, i) { rowOf[c.hash] = i; });

  var expanded = {};
  branches.forEach(function (b) { if (b.collapsed !== true) { expanded[b.ref] = true; } });

  function y(row) { return padY + row * rowH; }

  function spanText(b) {
    var s = b.lastT - b.firstT;
    if (s <= 0) { return "0m"; }
    if (s >= 86400) { return Math.round(s / 86400) + "d"; }
    if (s >= 3600) { return Math.round(s / 3600) + "h"; }
    return Math.round(s / 60) + "m";
  }

  // lane x assignment: alternate left/right of the trunk so lanes never overlap.
  var lanes = [];
  var left = 0, right = 0;
  branches.forEach(function (b) {
    var side = left <= right ? "left" : "right";
    var depth = side === "left" ? left : right;
    if (side === "left") { left += 1; } else { right += 1; }
    lanes.push({ b: b, x: side === "left" ? trunkX - (depth + 1) * laneGap : trunkX + (depth + 1) * laneGap });
  });

  function render() {
    var svg = d3.select(mount).select("svg");
    if (svg.empty()) {
      svg = d3.select(mount).append("svg").attr("class", "git-svg-surface").attr("role", "img")
        .attr("aria-label", "Git commit vertical timeline: trunk + branch fork/merge lanes");
    }
    svg.selectAll("*").remove();
    var maxDepth = Math.max(left, right);
    var width = Math.max(trunkX + (maxDepth + 1) * laneGap + 260, 360);
    var height = y(all.length - 1) + padY;
    // gap-webui-git-history-svg-unreadable: draw the viewBox at its NATIVE width/height (1:1) so the
    // text stays readable — the old width=100% + max-height:75vh + default preserveAspectRatio meet
    // squashed a tall viewBox (924x15570) to ~91px wide (meet scales to the shortest edge). The
    // #git-graph container scrolls horizontally when the native width exceeds the viewport.
    svg.attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width).attr("height", height)
      .attr("style", "border:1px solid var(--color-neutral-200);border-radius:6px;font-family:system-ui,-apple-system,sans-serif");
    var g = svg.append("g");

    // trunk vertical spine
    var trunkRows = trunk.commits.map(function (c) { return rowOf[c.hash]; });
    var tMin = Math.min.apply(null, trunkRows);
    var tMax = Math.max.apply(null, trunkRows);
    g.append("line").attr("class", "git-svg-grid")
      .attr("x1", trunkX).attr("x2", trunkX).attr("y1", y(tMin)).attr("y2", y(tMax));

    // trunk commits (diamond = merge)
    trunk.commits.forEach(function (c) {
      var yy = y(rowOf[c.hash]);
      var node;
      if (c.parents > 1) {
        node = g.append("rect").attr("class", "git-svg-merge")
          .attr("x", trunkX - mergeR).attr("y", yy - mergeR)
          .attr("width", mergeR * 2).attr("height", mergeR * 2)
          .attr("transform", "rotate(45 " + trunkX + " " + yy + ")");
      } else {
        node = g.append("circle").attr("class", "git-svg-commit")
          .attr("cx", trunkX).attr("cy", yy).attr("r", nodeR);
      }
      node.append("title").text(c.hash + " · " + c.subject);
      g.append("text").attr("class", "git-svg-ink")
        .attr("x", trunkX + 12).attr("y", yy + 4).attr("font-size", 11)
        .text(c.hash.slice(0, 7) + " " + c.subject);
    });

    // branch lanes: fork/merge connectors + collapsed-by-default commit summaries
    lanes.forEach(function (lane) {
      var b = lane.b;
      var forkRow = b.fork ? rowOf[b.fork] : null;
      var mergeRow = b.merge ? rowOf[b.merge] : null;
      var topRow = rowOf[b.commits[0].hash];
      var botRow = rowOf[b.commits[b.commits.length - 1].hash];
      var laneTop = forkRow != null ? forkRow : topRow;
      var laneBot = mergeRow != null ? mergeRow : botRow;

      g.append("line").attr("class", "git-svg-grid")
        .attr("x1", lane.x).attr("x2", lane.x).attr("y1", y(laneTop)).attr("y2", y(laneBot));
      if (forkRow != null) {
        g.append("line").attr("class", "git-svg-grid")
          .attr("x1", trunkX).attr("x2", lane.x).attr("y1", y(forkRow)).attr("y2", y(forkRow));
      }
      if (mergeRow != null) {
        g.append("line").attr("class", "git-svg-grid")
          .attr("x1", lane.x).attr("x2", trunkX).attr("y1", y(mergeRow)).attr("y2", y(mergeRow));
      }

      g.append("text").attr("class", "git-svg-ink")
        .attr("x", lane.x).attr("y", y(laneTop) - 8).attr("font-size", 10).attr("text-anchor", "middle")
        .text(b.ref);

      if (expanded[b.ref] !== true) {
        var midY = (y(laneTop) + y(laneBot)) / 2;
        var grp = g.append("g").style("cursor", "pointer")
          .on("click", function () { expanded[b.ref] = true; render(); });
        grp.append("circle").attr("class", "git-svg-commit").attr("cx", lane.x).attr("cy", midY).attr("r", nodeR);
        grp.append("text").attr("class", "git-svg-ink").attr("x", lane.x + 8).attr("y", midY + 4).attr("font-size", 11)
          .text(b.commits.length + " commits · " + spanText(b) + "（点击展开）");
        grp.append("title").text("点击展开 " + b.ref + " 的 " + b.commits.length + " 条提交");
      } else {
        b.commits.forEach(function (c) {
          var yy = y(rowOf[c.hash]);
          var node = g.append("circle").attr("class", "git-svg-commit").attr("cx", lane.x).attr("cy", yy).attr("r", nodeR);
          node.append("title").text(c.hash + " · " + c.subject);
          g.append("text").attr("class", "git-svg-muted").attr("x", lane.x + 8).attr("y", yy + 4).attr("font-size", 10)
            .text(c.hash.slice(0, 7) + " " + c.subject);
        });
        var grp2 = g.append("g").style("cursor", "pointer")
          .on("click", function () { expanded[b.ref] = false; render(); });
        grp2.append("text").attr("class", "git-svg-ink").attr("x", lane.x + 8).attr("y", y(laneBot) - 6).attr("font-size", 10)
          .text("▲ 折叠 " + b.ref);
        grp2.append("title").text("点击折叠 " + b.ref);
      }
    });
  }

  render();
})();`;
}

/**
 * Render the full /git-history HTML page. The graph is CLIENT-rendered from the embedded JSON via
 * the inlined D3 library (the retired 「零客户端 JS」 invariant — see docs/webui-guide.md). The page
 * still carries a server-rendered summary table (an accessible, JS-free view of branch count/span).
 */
function renderGitHistoryPage(history: GitHistoryResult): string {
  const statusNote = history.status === "error"
    ? html`<p class="meta"><strong>读失败</strong> — ${escapeHtml(history.reason || "")}</p>`
    : history.status === "empty"
      ? html`<p class="meta"><strong>无数据</strong> — ${escapeHtml(history.reason || "")}</p>`
      : "";
  const layout = history.status === "ok" ? layoutGitGraph(history) : null;
  const nCommits = history.commits.length;
  const branches = history.status === "ok" ? groupCommitsByBranch(history.commits) : [];
  const mergeCount = history.commits.filter((c) => c.parents > 1).length;

  const graph = layout ? html`<div id="git-graph" aria-label="Git 纵向时间轴" style="overflow-x:auto"></div>` : "";
  // The data JSON is embedded with `<` escaped to \u003c so a commit subject can never break out of
  // the <script> element. d3 + the client renderer are emitted only when there is a graph to draw.
  const dataScript = layout ? html`<script type="application/json" id="git-graph-data">${JSON.stringify(layout).replace(/</g, "\\u003c")}</script>` : "";
  const libScript = layout ? html`<script>${gitGraphLibJs()}</script>` : "";
  const clientScript = layout ? html`<script>${gitGraphClientScript()}</script>` : "";

  const summaryRows = branches.map((b) => {
    const taskId = taskIdFromBranchRef(b.ref);
    const name = taskId
      ? html`<a href="/task/${encodeURIComponent(taskId)}">${escapeHtml(b.ref)}</a>`
      : escapeHtml(b.ref);
    return html`<tr>
      <td>${name}</td>
      <td>${escapeHtml(isoTime(b.firstT))}</td>
      <td>${escapeHtml(isoTime(b.lastT))}</td>
      <td>${b.commits.length}</td>
      <td>${b.commits.filter((c) => c.parents > 1).length}</td>
    </tr>`;
  }).join("\n");
  const summaryTable = branches.length > 0 ? html`<h2>分支汇总（git 可证的事实，非工时）</h2>
    <table>
      <tr><th>分支</th><th>首提交落地</th><th>末提交落地</th><th>提交数</th><th>合并数</th></tr>
      ${summaryRows}
    </table>` : "";

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay git history — vertical commit timeline (third-party library, client-rendered)">${modernistStyles()}${pageStyles()}<title>Git history — vertical commit timeline</title></head>
    <body>${renderMobileChrome("git", "git history")}${renderSiteNav("git")}<main>
      <h1>Git History — 提交纵向时间轴</h1>
      <p class="meta"><strong>纵轴 = 提交落地顺序（git commit time），不是工时/持续时间。</strong> develop 竖直主干 + task 分支从主干分出（fork）/合入（merge）的连线；task 分支默认折叠（只显提交数与时间跨度，点击展开逐条）。菱形 = 合并提交（fan-in 落地事件）。当前窗口：最近 ${nCommits} 条提交、${mergeCount} 个合并（跨所有本地分支）。</p>
      ${statusNote}
      ${graph}
      ${dataScript}
      ${libScript}
      ${clientScript}
      ${summaryTable}
    </main></body></html>`;
}

export async function handleGitHistory(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let history: GitHistoryResult;
  try {
    history = readGitHistory(cfg.workspaceRoot);
  } catch (err) {
    history = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, commits: [], head: null, heads: {} };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderGitHistoryPage(history));
}
