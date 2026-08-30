// serve-tests.ts — /tests + /tests/file route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readTests, type TestsResult, type TestRunRecord } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, pad2, obsNote } from "./serve-render.ts";

// ── /tests load curve — server-rendered SVG of the suite-load timeseries (gap-test-detail-load-timeseries) ──
//
// plugin/scripts/suite-load-sampler.ts appends one JSON line per sample — {t, loadavg, cpu_stall,
// mem_avail} — to .quay/suite-load-<runId>.jsonl while a suite runs (and stops the moment the suite
// ends). The curve plotted here is the loadavg (1m) series over the suite's elapsed time; cpu_stall
// and mem_avail ride the same samples but are not plotted (a load curve is the 1-minute load). Built
// by STRING CONCATENATION — no template engine, no new dependency, and no <script> anywhere (zero
// client JS, the same invariant as the git-history SVG). Marks carry token-derived CSS classes
// (git-svg-* / load-svg-line) — ZERO hardcoded hex.

export interface SuiteLoadSample {
  t: number; // epoch ms
  loadavg: number | null; // /proc/loadavg 1m
  cpu_stall: number | null; // /proc/pressure/cpu some avg10 %
  mem_avail: number | null; // /proc/meminfo MemAvailable, MB
}

/** Read one suite-load timeseries file; malformed lines are skipped, valid samples sorted by t. */
export function readSuiteLoadSamples(root: string, runId: string): SuiteLoadSample[] {
  const file = path.join(root, ".quay", `suite-load-${runId}.jsonl`);
  const samples: SuiteLoadSample[] = [];
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (!o || typeof o !== "object") continue;
      const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const t = num(o.t);
      if (t == null) continue; // a sample without a timestamp is unusable for a time series
      samples.push({ t, loadavg: num(o.loadavg), cpu_stall: num(o.cpu_stall), mem_avail: num(o.mem_avail) });
    } catch {
      // skip malformed line (never throw — the page degrades to no-curve, not a 500)
    }
  }
  return samples.sort((a, b) => a.t - b.t);
}

/**
 * Clip suite-load samples to an inclusive [startMs, endMs] window (epoch ms) — the SHARED time-window
 * filter used by BOTH the /tests round page and /tests/file (gap-tests-round-load-curve-time-window-
 * clip AC2). A page must not show samples outside the window it declares; each caller passes its own
 * [start, end] (the round's declared window, or the file's perFile start/end) and this drops the rest.
 */
export function clipSuiteLoadSamplesToWindow(samples: SuiteLoadSample[], startMs: number, endMs: number): SuiteLoadSample[] {
  return samples.filter((s) => s.t >= startMs && s.t <= endMs);
}

// The /tests page is a HISTORY surface: it reads ONLY the data-plane ledger (verification-round.jsonl)
// + per-runId telemetry (suite-load-<runId>.jsonl, keyed by the ledger's own runId). The control-plane
// single-state file full-suite-state.json (gate signal; the D7 mirror writes only green; scope-annotated)
// is deliberately NOT read here — a worktree red must not flip the main signal, and a history page must
// not show a live/current state it cannot source from the record.
function isPlottableSample(s: SuiteLoadSample): s is SuiteLoadSample & { loadavg: number } {
  return s.loadavg != null && Number.isFinite(s.loadavg);
}

/**
 * Render the suite-run loadavg curve as a pure, dependency-free SVG string. Returns "" when there
 * are no plottable samples (the page then omits the section). Deterministic on its input.
 */
export function renderLoadCurveSvg(samples: SuiteLoadSample[]): string {
  const pts = samples.filter(isPlottableSample);
  if (pts.length === 0) return "";
  const M = { top: 24, right: 24, bottom: 44, left: 48 };
  const W = 940;
  const H = 240;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const ts = pts.map((s) => s.t);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const durSec = Math.max((t1 - t0) / 1000, 1); // single-sample still a finite plot
  const X = (t: number): number => M.left + ((t - t0) / 1000 / durSec) * plotW;

  const loads = pts.map((s) => s.loadavg);
  const yMaxRaw = Math.max(...loads);
  const yMax = yMaxRaw > 0 ? yMaxRaw * 1.15 : 1;
  const Y = (v: number): number => M.top + plotH - (v / yMax) * plotH;

  const xSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  let xStep = xSteps[xSteps.length - 1];
  const xStepRaw = durSec / 5;
  for (const s of xSteps) {
    if (s >= xStepRaw) { xStep = s; break; }
  }
  const xTicks: Array<{ x: number; label: string }> = [];
  for (let v = 0; v <= durSec; v += xStep) {
    xTicks.push({ x: X(t0 + v * 1000), label: v === 0 ? "0s" : `${v}s` });
  }
  const yTicks: Array<{ y: number; label: string }> = [];
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i;
    yTicks.push({ y: Y(v), label: v.toFixed(1) });
  }

  const grid = [
    ...xTicks.map((tk) => `<line class="git-svg-grid" x1="${tk.x.toFixed(1)}" y1="${M.top}" x2="${tk.x.toFixed(1)}" y2="${H - M.bottom}" stroke-width="1" /><text class="git-svg-muted" x="${tk.x.toFixed(1)}" y="${H - M.bottom + 16}" font-size="10" text-anchor="middle">${escapeHtml(tk.label)}</text>`),
    ...yTicks.map((tk) => `<line class="git-svg-grid" x1="${M.left}" y1="${tk.y.toFixed(1)}" x2="${W - M.right}" y2="${tk.y.toFixed(1)}" stroke-width="1" /><text class="git-svg-muted" x="${(M.left - 6).toFixed(1)}" y="${(tk.y + 3).toFixed(1)}" font-size="10" text-anchor="end">${escapeHtml(tk.label)}</text>`),
  ].join("");
  const polyline = `<polyline class="load-svg-line" points="${pts.map((s) => `${X(s.t).toFixed(1)},${Y(s.loadavg).toFixed(1)}`).join(" ")}" />`;
  const points = pts.map((s) => {
    const d = new Date(s.t);
    const hhmmss = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return `<circle class="git-svg-commit" cx="${X(s.t).toFixed(1)}" cy="${Y(s.loadavg).toFixed(1)}" r="2.5"><title>${hhmmss} · loadavg ${s.loadavg}</title></circle>`;
  }).join("");

  return `<svg class="git-svg-surface" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Suite-run loadavg curve" style="max-width:100%;height:auto;border:1px solid var(--color-neutral-200);border-radius:6px;font-family:system-ui,-apple-system,sans-serif;">
${grid}
${polyline}
${points}
<text class="git-svg-ink" x="${M.left}" y="${M.top - 6}" font-size="11">loadavg (1m) · suite 运行期采样</text>
</svg>`;
}

// ── /tests ─────────────────────────────────────────────────────────────────────────────────────────

function runStatusClass(state: string | null): string {
  if (state === "green" || state === "pass") return "verdict-pass";
  if (state === "red" || state === "fail" || state === "running") return "verdict-fail";
  return "";
}

/** "2026-08-23T01:00:00.000Z" → "01:00Z" (UTC HH:MM, the proposal's 「03:14Z」 form). "" on bad input. */
function shortUtcTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}Z` : "";
}

/** "round #478 · 03:14Z" for a run record; time-only when `round` is absent; "" for no record. */
function roundLabel(r: TestRunRecord | null | undefined): string {
  if (!r) return "";
  const parts: string[] = [];
  if (r.round != null) parts.push(`round #${r.round}`);
  const t = shortUtcTime(r.startedAt);
  if (t) parts.push(t);
  return parts.join(" · ");
}

/**
 * A round's declared [startedAt, startedAt+durationMs] window as epoch ms — the bounds the load curve
 * must clip to (gap-tests-round-load-curve-time-window-clip). null when the window is uncomputable
 * (legacy/incomplete row: no startedAt or no durationMs) — the page then keeps the samples UNCLIPPED
 * rather than fabricate a window it can't know (and rather than drop a still-running run's curve).
 */
function roundTimeWindowMs(r: TestRunRecord | null | undefined): { start: number; end: number } | null {
  if (!r) return null;
  if (typeof r.startedAt !== "string" || typeof r.durationMs !== "number") return null;
  const start = Date.parse(r.startedAt);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + r.durationMs };
}

/**
 * gap-test-detail-perfile-duration-failed AC2 — render the per-file duration table for one round.
 * Sorted by duration DESC (server-side — zero client JS, same style as the git-history SVG), failed
 * files marked with the existing `verdict-fail` class (red). Empty/absent perFile ⇒ "" (no fabricated
 * table). Pure on its input, so the sort + fail-marking contract is unit-testable directly.
 */
export function renderPerFileTable(
  perFile: { file: string; durationMs: number; passed: boolean }[] | null | undefined,
): string {
  if (!perFile || perFile.length === 0) return "";
  const sorted = [...perFile].sort((a, b) => b.durationMs - a.durationMs);
  // gap-webui-test-file-detail-page AC3 — the file cell is a link to the single-file detail page
  // (path is the repo-rel path, URL-encoded into the query param; the handler decodes it back).
  const rows = sorted.map((f) => html`<tr>
    <td><a href="/tests/file?path=${encodeURIComponent(f.file)}"><code>${escapeHtml(f.file)}</code></a></td>
    <td>${escapeHtml(String(Math.round(f.durationMs)))} ms</td>
    <td class="${f.passed ? "" : "verdict-fail"}" style="${f.passed ? "" : "font-weight:700"}">${f.passed ? "passed" : "failed"}</td>
  </tr>`).join("\n");
  return html`<details open style="margin-top:1rem">
    <summary style="cursor:pointer;font-weight:600">perFile 耗时明细（耗时降序 · 失败标红）</summary>
    <table style="margin-top:0.5rem">
      <tr><th>file</th><th>duration</th><th>result</th></tr>
      ${rows}
    </table>
  </details>`;
}

/** A per-file entry that carries BOTH timeline timestamps (end + back-computed start). */
type TimedPerFile = {
  file: string;
  durationMs: number;
  passed: boolean;
  startedAtMs: number;
  endedAtMs: number;
};

/** Narrow a perFile entry to one plottable on the timeline (both timestamps present, end > start). */
function hasTimestamps(
  f: { file: string; durationMs: number; passed: boolean; startedAtMs?: number; endedAtMs?: number },
): f is TimedPerFile {
  return typeof f.startedAtMs === "number" && typeof f.endedAtMs === "number" && f.endedAtMs > f.startedAtMs;
}

/** Truncate a path label to fit the gantt left margin; the full path rides in the <title>. */
function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return "…" + s.slice(s.length - (max - 1));
}

// ── bucket attribution (gap-webui-bucket-color-distinction) ─────────────────────────────────────
//
// SINGLE-SOURCE-OF-TRUTH NOTE (gap-bucket-second-truth-source-page-recompute): the file→bucket
// attribution is NO LONGER re-derived here. The dispatch side (plugin/scripts/suite-bucket-select.ts)
// computes `effectiveBucketSet` for every suite file (reattribution override → static closure →
// mirror fold, source recorded) and writes it to `.quay/suite-bucket-effective.jsonl`; this page
// READS that artifact only. Core cannot import plugin/ (packages/quay/src has zero plugin/ imports),
// so the shared judgment travels through the artifact, not through an import — the same
// dispatch-computes / disk-carries / page-reads pattern as verification-round.jsonl. A missing or
// unreadable artifact (or a file absent from it) returns UNRESOLVED (empty set) — the page degrades
// to a muted bar, never a 500 and never a divergent judgment.

type Bucket = "P" | "S" | "M";

const BUCKET_ORDER: readonly Bucket[] = ["P", "S", "M"];

/** The single-truth-source artifact the dispatch side writes (mirror of suite-bucket-select.ts). */
const EFFECTIVE_PATH = ".quay/suite-bucket-effective.jsonl";

/** Normalize a file reference to the artifact's repo-relative key form (forward slashes, strip ./). */
function normalizeFileRef(p: string): string {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Read the dispatch-written effective bucket attribution (file → bucket set). Absent/unparseable
 * artifact ⇒ empty map (the page degrades to UNRESOLVED, never throws — hard rule 3b: a read failure
 * must not look like a bucket). Malformed lines are skipped.
 */
function readBucketEffective(root: string): Map<string, Set<Bucket>> {
  const map = new Map<string, Set<Bucket>>();
  let text: string;
  try {
    text = readFileSync(path.join(root, EFFECTIVE_PATH), "utf8");
  } catch {
    return map;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as { file?: string; buckets?: unknown[] };
      if (!o || typeof o.file !== "string" || !Array.isArray(o.buckets)) continue;
      const set = new Set<Bucket>();
      for (const b of o.buckets) if (b === "P" || b === "S" || b === "M") set.add(b);
      map.set(o.file, set);
    } catch {
      // malformed line — skip (the artifact is a data file; one bad line must not kill the page)
    }
  }
  return map;
}

/** The bucket set of one test file, read from the dispatch-written single-truth-source artifact. */
export function bucketSetOfFile(fileRef: string, root: string | null | undefined): Set<Bucket> {
  if (!root) return new Set();
  return readBucketEffective(root).get(normalizeFileRef(fileRef)) ?? new Set();
}

/** Canonical bucket string: `P | S | M | P+S | P+M | S+M | P+S+M | UNRESOLVED` (same as attribution). */
function canonicalBuckets(buckets: Set<Bucket>): string {
  if (buckets.size === 0) return "UNRESOLVED";
  return BUCKET_ORDER.filter((b) => buckets.has(b)).join("+");
}

/** The colour key: singleton → its own; any combo → "multi"; unresolved → "unresolved". */
function bucketColorKey(canonical: string): string {
  if (canonical === "UNRESOLVED") return "unresolved";
  if (canonical.includes("+")) return "multi";
  return canonical; // "P" | "S" | "M"
}

/** Legend label for a canonical bucket string. */
function bucketLabel(canonical: string): string {
  if (canonical === "UNRESOLVED") return "未解析";
  if (canonical.includes("+")) return "多桶";
  if (canonical === "P") return "P 产品";
  if (canonical === "S") return "S 套件";
  return "M 机件";
}

/**
 * gap-test-detail-timeline AC2 — render the per-file timeline (one horizontal bar per file, positioned
 * by its start/end epoch-ms) as a pure, dependency-free server-rendered SVG string. Sorted by start
 * time ASC (a chronological timeline, distinct from the duration table's DESC). Only files carrying
 * BOTH `startedAtMs` and `endedAtMs` are plotted; absent/legacy perFile ⇒ "" (no fabricated chart).
 * Marks carry token-derived CSS classes (git-svg-* / gantt-svg-*), ZERO hardcoded hex, zero client JS.
 */
export function renderPerFileTimelineSvg(
  perFile: { file: string; durationMs: number; passed: boolean; startedAtMs?: number; endedAtMs?: number }[] | null | undefined,
  root?: string | null,
): string {
  if (!perFile || perFile.length === 0) return "";
  const rows = perFile.filter(hasTimestamps).sort((a, b) => a.startedAtMs - b.startedAtMs);
  if (rows.length === 0) return "";

  // gap-webui-bucket-color-distinction AC2 — attribute each file to its bucket set (read once from the
  // dispatch-written single-truth-source artifact) so bars are HUE-coloured by bucket, not pass/fail.
  const effective = root ? readBucketEffective(root) : new Map<string, Set<Bucket>>();
  const attributed = rows.map((f) => {
    const canonical = canonicalBuckets(effective.get(normalizeFileRef(f.file)) ?? new Set());
    return { ...f, key: bucketColorKey(canonical), label: bucketLabel(canonical) };
  });

  const M = { top: 24, right: 24, bottom: 64, left: 340 };
  const W = 960;
  const rowH = 14;
  const rowGap = 5;
  const H = M.top + rows.length * (rowH + rowGap) + M.bottom;
  const plotW = W - M.left - M.right;

  const t0 = Math.min(...rows.map((f) => f.startedAtMs));
  const t1 = Math.max(...rows.map((f) => f.endedAtMs));
  const span = Math.max(t1 - t0, 1);
  const X = (t: number): number => M.left + ((t - t0) / span) * plotW;

  const bars = attributed
    .map((f, i) => {
      const y = M.top + i * (rowH + rowGap);
      const x = X(f.startedAtMs);
      const w = Math.max(X(f.endedAtMs) - x, 1);
      // HUE = bucket, SHADE = pass/fail (the fail step reuses gantt-svg-bar-fail as a darker modifier
      // of the same bucket family — see pageStyles' .gantt-bucket-* rules).
      const cls = `gantt-bucket-${f.key}${f.passed ? "" : " gantt-svg-bar-fail"}`;
      const end = new Date(f.endedAtMs);
      const endHhmmss = `${pad2(end.getHours())}:${pad2(end.getMinutes())}:${pad2(end.getSeconds())}`;
      return `<g>
<text class="git-svg-ink" x="${(M.left - 8).toFixed(1)}" y="${(y + rowH - 2).toFixed(1)}" font-size="10" text-anchor="end"><a href="/tests/file?path=${encodeURIComponent(f.file)}">${escapeHtml(truncateLabel(f.file, 52))}</a></text>
<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${rowH}" rx="2"><title>${escapeHtml(f.file)} · ${Math.round(f.durationMs)} ms · ${f.label} · 结束 ${endHhmmss}</title></rect>
</g>`;
    })
    .join("\n");

  // gap-webui-bucket-color-distinction AC3 — legend explaining each bucket colour (only the buckets
  // actually present, in canonical order). Token-derived classes, zero hardcoded hex, zero client JS.
  const legendOrder = ["P", "S", "M", "multi", "unresolved"] as const;
  const presentKeys = new Set(attributed.map((f) => f.key));
  const legendY = H - M.bottom + 34;
  const legendItems = legendOrder
    .filter((k) => presentKeys.has(k))
    .map((k) => ({ key: k, label: attributed.find((f) => f.key === k)!.label }))
    .map((it, i) => {
      const lx = M.left + i * 92;
      return `<rect class="gantt-bucket-${it.key}" x="${lx}" y="${legendY}" width="10" height="10" rx="2"></rect><text class="git-svg-muted" x="${lx + 15}" y="${legendY + 9}" font-size="10">${escapeHtml(it.label)}</text>`;
    })
    .join("");
  const legend = legendItems
    ? `<g class="gantt-svg-legend"><text class="git-svg-muted" x="${M.left}" y="${legendY - 4}" font-size="10">图例：</text></g>${legendItems}`
    : "";

  const durSec = span / 1000;
  const xSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  let xStep = xSteps[xSteps.length - 1];
  const xStepRaw = durSec / 5;
  for (const s of xSteps) {
    if (s >= xStepRaw) {
      xStep = s;
      break;
    }
  }
  const xTicks: string[] = [];
  for (let v = 0; v <= durSec; v += xStep) {
    const t = t0 + v * 1000;
    const d = new Date(t);
    const hhmmss = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    xTicks.push(`<line class="git-svg-grid" x1="${X(t).toFixed(1)}" y1="${M.top}" x2="${X(t).toFixed(1)}" y2="${H - M.bottom}" stroke-width="1" /><text class="git-svg-muted" x="${X(t).toFixed(1)}" y="${H - M.bottom + 16}" font-size="10" text-anchor="middle">${hhmmss}</text>`);
  }

  return `<svg class="git-svg-surface" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Per-file test timeline (gantt)" style="max-width:100%;height:auto;border:1px solid var(--color-neutral-200);border-radius:6px;font-family:system-ui,-apple-system,sans-serif;">
${xTicks.join("\n")}
${bars}
${legend}
<text class="git-svg-ink" x="${M.left}" y="${(M.top - 6).toFixed(1)}" font-size="11">测试时间线（每文件起止时刻 · 按开始时刻升序 · 按 bucket 着色）</text>
</svg>`;
}

function renderTestsPage(
  tests: TestsResult,
  root: string,
  samples: SuiteLoadSample[] = [],
  selected: TestRunRecord | null = null,
  roundRequested: number | null = null,
): string {
  const latest = tests.runs[0] ?? null;
  // gap-webui-round-detail-page — `selected` is the round the page focuses on when /tests?round=N
  // names one (null on the default page, which keeps the pre-existing latest-run focus). The banner,
  // load-curve label, and timeline/table then all reference THAT round instead of the newest.
  const focus = selected;
  // gap-web-tests-three-sections-round-drift — the load curve keys off the LATEST ledger round's own
  // runId (tests.runs[0]), so the three sections each name the round they reference and stay trivially
  // consistent (no full-suite-state.json mapping). A still-running round has no ledger record yet, so
  // the default page shows the newest COMPLETED round and never a live "运行中" label.
  const loadLabel = focus ? roundLabel(focus) : roundLabel(latest);
  const bannerRun = focus ?? latest;
  const latestBanner = bannerRun
    ? html`<div style="border:1px solid var(--color-divider);background:var(--color-surface);padding:1rem;margin-bottom:1.5rem">
        <div style="font-weight:700;font-size:1rem"><span class="${runStatusClass(bannerRun.state)}">${escapeHtml(bannerRun.state ?? "unknown")}</span>${bannerRun.scope ? ` · ${escapeHtml(bannerRun.scope)}` : ""}</div>
        <p class="meta" style="margin:0.25rem 0">startedAt: ${escapeHtml(bannerRun.startedAt ?? "—")} · duration: ${bannerRun.durationMs != null ? `${escapeHtml(String(Math.round(bannerRun.durationMs / 1000)))}s` : "—"}${bannerRun.commit ? ` · commit <code>${escapeHtml(bannerRun.commit.slice(0, 8))}</code>` : ""}${bannerRun.runner ? ` · runner ${escapeHtml(bannerRun.runner)}` : ""}${bannerRun.buckets ? ` · buckets ${escapeHtml(bannerRun.buckets)}` : ""}</p>
        <p class="meta" style="margin:0">tests ${bannerRun.tests ?? "—"} · pass ${bannerRun.pass ?? "—"} · fail ${bannerRun.fail ?? "—"} · cancelled ${bannerRun.cancelled ?? "—"}</p>
      </div>`
    : "";
  // gap-webui-round-detail-page — name the focused round so a /tests?round=N page is self-describing,
  // and say so plainly when the requested round isn't in the record (never silently show the latest
  // as if the param had worked — 硬规则 3b: a "read the input failed" result must not look like success).
  const focusNote = focus
    ? html`<p class="meta" style="margin:0.75rem 0;color:var(--color-accent-800);font-weight:600">正在查看 ${roundLabel(focus)} 的详情（时间线 / 负载曲线 / perFile 均来自该轮）。</p>`
    : "";
  const notFoundNote = roundRequested != null && focus == null
    ? html`<p class="meta" style="margin:0.75rem 0;color:var(--color-accent-800);font-weight:600">未找到 round #${escapeHtml(String(roundRequested))} — 验证轮记录中无该轮次，以下显示最新一轮。</p>`
    : "";
  const historyRows = tests.runs.map((r, i) => html`<tr>
    <td>${r.round != null ? html`<a href="/tests?round=${r.round}">#${escapeHtml(String(r.round))}</a>${i === 0 ? ` <span style="color:var(--color-neutral-700);font-weight:600">← 最新</span>` : ""}` : "—"}</td>
    <td>${r.startedAt ? escapeHtml(r.startedAt) : "—"}</td>
    <td class="${runStatusClass(r.state)}" style="font-weight:700">${escapeHtml(r.state ?? "—")}</td>
    <td>${r.pass ?? "—"}/${r.fail ?? "—"}/${r.cancelled ?? "—"}</td>
    <td>${r.durationMs != null ? `${escapeHtml(String(Math.round(r.durationMs / 1000)))}s` : "—"}</td>
    <td>${r.scope ? escapeHtml(r.scope) : "—"}</td>
    <td>${r.buckets ? escapeHtml(r.buckets) : "—"}</td>
    <td>${r.commit ? html`<a href="/git-history?commit=${encodeURIComponent(r.commit)}"><code>${escapeHtml(r.commit.slice(0, 8))}</code></a>` : "—"}</td>
  </tr>`).join("\n");
  const failedRun = tests.runs.find((r) => r.fail != null && r.fail > 0 && r.failures && r.failures.length > 0);
  const failureDetails = failedRun
    ? html`<details style="margin-top:1rem">
        <summary style="cursor:pointer;font-weight:600">#${escapeHtml(String(failedRun.round))} 失败用例明细（点击展开）</summary>
        <ul style="padding-left:1.5rem;font-size:0.85rem;line-height:1.7;color:var(--color-accent-800)">
          ${failedRun.failures!.map((f) => html`<li>${escapeHtml(f)}</li>`).join("")}
        </ul>
      </details>`
    : "";
  const loadCurveSvg = renderLoadCurveSvg(samples);
  const loadCurve = loadCurveSvg
    ? html`<h2>负载曲线${loadLabel ? `（${loadLabel}）` : ""}</h2>
        <p class="meta">数据源：<code>.quay/suite-load-&lt;runId&gt;.jsonl</code>（suite 运行期采样，结束即停）</p>
        ${loadCurveSvg}`
    : "";
  // gap-test-detail-perfile-duration-failed AC2 — render the per-file table for the newest run that
  // actually carries perFile data (legacy rows have no perFile field → skipped, never fabricated).
  // gap-webui-round-detail-page — when a round is selected, its OWN perFile drives the timeline +
  // table (an empty/absent perFile → no timeline/table, exactly that round's truth — never a silent
  // fallback to another round). Default mode keeps the pre-existing "newest run with perFile".
  const perFileRun = focus
    ? (focus.perFile && focus.perFile.length > 0 ? focus : null)
    : tests.runs.find((r) => r.perFile && r.perFile.length > 0);
  const perFileTable = perFileRun ? renderPerFileTable(perFileRun.perFile) : "";
  // gap-test-detail-timeline AC2 — render the per-file timeline (gantt) for that same run. The chart
  // omits itself (⇒ "") when the run's perFile entries carry no timestamps (legacy/absent field).
  const perFileTimelineSvg = perFileRun ? renderPerFileTimelineSvg(perFileRun.perFile, root) : "";
  // gap-web-tests-three-sections-round-drift AC2 — the find() above silently falls back to an
  // EARLIER run when the newest run carries no perFile (red / static-check-early-fail / reporter
  // stopped before perFile). Surface that fallback instead of hiding it: name both the latest run
  // and the run actually shown. (No fallback notice in focus mode — the selected round is shown as-is,
  // not "falling back" from a different round.)
  const timelineFallback = !focus && perFileRun != null && latest != null && perFileRun !== latest;
  const perFileTimeline = perFileTimelineSvg
    ? html`<h2>测试时间线${perFileRun ? `（${roundLabel(perFileRun)}）` : ""}</h2>
        ${timelineFallback ? html`<p class="meta" style="margin:0.25rem 0;color:var(--color-accent-800);font-weight:600">⚠️ 最新一轮无 perFile 数据${latest ? `（${roundLabel(latest)}）` : ""}，以下回退显示${perFileRun ? ` ${roundLabel(perFileRun)}` : ""}。</p>` : ""}
        <p class="meta">数据源：<code>.quay/verification-round.jsonl</code> perFile 起止时刻（reporter 结束时刻 + duration 反推起始）</p>
        ${perFileTimelineSvg}`
    : "";
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay tests — verification rounds">${modernistStyles()}${pageStyles()}<title>Tests — 验证轮记录</title></head>
    <body>${renderMobileChrome("tests", "tests")}${renderSiteNav("tests")}<main>
      <h1>Tests — 验证轮记录</h1>
      <p class="meta">数据源：<code>.quay/verification-round.jsonl</code>（每轮 suite 完成时追加，红绿皆入账）</p>
      ${obsNote(tests.status, tests.reason)}
      ${focusNote}
      ${notFoundNote}
      ${latestBanner}
      ${loadCurve}
      ${perFileTimeline}
      ${tests.runs.length > 0 ? html`<h2>历史运行（新→旧）</h2>
      <table>
        <tr><th>round</th><th>startedAt</th><th>state</th><th>pass/fail/cancel</th><th>duration</th><th>scope</th><th>buckets</th><th>commit</th></tr>
        ${historyRows}
      </table>` : ""}
      ${failureDetails}
      ${perFileTable}
    </main></body></html>`;
}

export async function handleTests(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  url: URL,
): Promise<void> {
  let tests: TestsResult;
  try {
    tests = readTests(cfg.workspaceRoot);
  } catch (err) {
    tests = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, runs: [] };
  }
  // gap-webui-round-detail-page AC1 — /tests?round=N names a specific round; its OWN runId feeds the
  // load curve (absent runId → no curve, the same data-source degradation as the default page). A
  // non-numeric / non-matching round is treated as "not requested" / "not found" (never fabricated).
  const roundParam = url.searchParams.get("round");
  const roundNum = roundParam != null && /^\d+$/.test(roundParam.trim()) ? Number(roundParam.trim()) : null;
  const selected = roundNum != null ? tests.runs.find((r) => r.round === roundNum) ?? null : null;
  // gap-tests-round-load-curve-time-window-clip — clip the load curve to the focused round's declared
  // [startedAt, startedAt+durationMs] window (the SAME helper as /tests/file). An uncomputable window
  // (a latest/selected round without durationMs — legacy/standalone rows) keeps the samples unclipped
  // rather than fabricate a window or drop the curve.
  const samples = ((): SuiteLoadSample[] => {
    if (selected) {
      if (!selected.runId) return [];
      const raw = readSuiteLoadSamples(cfg.workspaceRoot, selected.runId);
      const w = roundTimeWindowMs(selected);
      return w ? clipSuiteLoadSamplesToWindow(raw, w.start, w.end) : raw;
    }
    const latest = tests.runs[0] ?? null;
    if (latest?.runId) {
      const raw = readSuiteLoadSamples(cfg.workspaceRoot, latest.runId);
      const w = roundTimeWindowMs(latest);
      return w ? clipSuiteLoadSamplesToWindow(raw, w.start, w.end) : raw;
    }
    return [];
  })();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderTestsPage(tests, cfg.workspaceRoot, samples, selected, roundNum));
}

// ── /tests/file — single-file cross-round detail page (gap-webui-test-file-detail-page) ──────────
//
// /tests shows the SUITE's view (round history + one round's perFile table/timeline). A single test
// file's own record spans ROUNDS: the same file appears in many verification-round rows' perFile
// arrays, each carrying its own durationMs + passed. This page collects that per-file history ACROSS
// rounds and renders ① a durationMs trend chart (one bar per round, oldest→newest, fail-shaded),
// ② a pass/fail history table, and ③ (data-source-dependent) the load-curve fragment clipped to the
// file's run window for the newest round that carried both timestamps and suite-load samples. All
// server-rendered SVG/HTML — zero client JS, token-derived colours (reuses gantt-svg-bar /
// gantt-svg-bar-fail / git-svg-*). The load curve is a DATA-SOURCE dependency (gap-suite-load-
// sampler-bypassed-by-fan-in-execute must land first or the sampler produces no samples); the rest
// of the page renders regardless (DoD: 「负载曲线是数据源依赖项」).

/** One round's observation of a single file (its perFile entry joined with the round's identity). */
export interface FileRoundPoint {
  round: number | null;
  startedAt: string | null;
  durationMs: number;
  passed: boolean;
  runState: string | null;
}

/**
 * Collect one file's perFile entries ACROSS every round that carried it. `runs` is newest-first
 * (readTests reversed); the returned array is OLDEST-first so the trend chart + history table read
 * left-to-right / top-to-bottom chronologically. A round contributes at most one point (perFile is a
 * set of files); rounds without the file are skipped (never a fabricated 0-duration point).
 */
export function collectFileHistory(runs: TestRunRecord[], filePath: string): FileRoundPoint[] {
  const points: FileRoundPoint[] = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (!r.perFile || r.perFile.length === 0) continue;
    const entry = r.perFile.find((f) => f.file === filePath);
    if (!entry) continue;
    points.push({
      round: r.round,
      startedAt: r.startedAt,
      durationMs: entry.durationMs,
      passed: entry.passed,
      runState: r.state,
    });
  }
  return points;
}

/**
 * The durationMs trend chart for one file across rounds: a bar per round (x axis), height ∝
 * durationMs, passed bars reuse gantt-svg-bar (accent) and failed bars gantt-svg-bar-fail (darker) —
 * the SAME fail-vs-pass token language as the timeline. Returns "" with <2 points (a one-round
 * "trend" is not a cross-round trend — AC2's falsifiability guard: 「只有单轮 ⇒ 假」).
 */
export function renderFileDurationTrendSvg(points: FileRoundPoint[]): string {
  if (points.length < 2) return "";
  const M = { top: 24, right: 24, bottom: 48, left: 64 };
  const W = 960;
  const H = 240;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const maxMs = Math.max(...points.map((p) => p.durationMs), 1);
  const yMax = maxMs * 1.15;
  const Y = (ms: number): number => M.top + plotH - (ms / yMax) * plotH;
  const step = plotW / points.length;
  const barW = Math.min(step - 12, 80);
  const X = (i: number): number => M.left + step * i + step / 2;

  const bars = points
    .map((p, i) => {
      const x = X(i) - barW / 2;
      const y = Y(p.durationMs);
      const h = Math.max(M.top + plotH - y, 1);
      const cls = p.passed ? "gantt-svg-bar" : "gantt-svg-bar-fail";
      const label = p.round != null ? `#${p.round}` : shortUtcTime(p.startedAt);
      const secs = (p.durationMs / 1000).toFixed(1);
      return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${escapeHtml(label)} · ${secs}s · ${p.passed ? "passed" : "failed"}</title></rect>
<text class="git-svg-ink" x="${X(i).toFixed(1)}" y="${(H - M.bottom + 16).toFixed(1)}" font-size="10" text-anchor="middle">${escapeHtml(label)}</text>`;
    })
    .join("\n");

  const yTicks: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const ms = (yMax / 4) * i;
    yTicks.push(`<line class="git-svg-grid" x1="${M.left}" y1="${Y(ms).toFixed(1)}" x2="${(W - M.right).toFixed(1)}" y2="${Y(ms).toFixed(1)}" stroke-width="1" /><text class="git-svg-muted" x="${(M.left - 6).toFixed(1)}" y="${(Y(ms) + 3).toFixed(1)}" font-size="10" text-anchor="end">${(ms / 1000).toFixed(0)}s</text>`);
  }

  return `<svg class="git-svg-surface" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Single-file duration trend across rounds" style="max-width:100%;height:auto;border:1px solid var(--color-neutral-200);border-radius:6px;font-family:system-ui,-apple-system,sans-serif;">
${yTicks.join("\n")}
${bars}
<text class="git-svg-ink" x="${M.left}" y="${(M.top - 6).toFixed(1)}" font-size="11">durationMs 趋势（每轮一根柱 · 失败标红 · 按轮次升序）</text>
</svg>`;
}

/** The pass/fail history table for one file across rounds (oldest→newest). Empty ⇒ "" (no table). */
export function renderFileHistoryTable(points: FileRoundPoint[]): string {
  if (points.length === 0) return "";
  const rows = points
    .map((p) => `<tr>
    <td>${p.round != null ? `#${p.round}` : "—"}</td>
    <td>${p.startedAt ? escapeHtml(p.startedAt) : "—"}</td>
    <td>${escapeHtml(String(Math.round(p.durationMs)))} ms</td>
    <td class="${p.passed ? "" : "verdict-fail"}" style="${p.passed ? "" : "font-weight:700"}">${p.passed ? "passed" : "failed"}</td>
  </tr>`)
    .join("\n");
  return `<table>
    <tr><th>round</th><th>startedAt</th><th>duration</th><th>result</th></tr>
    ${rows}
  </table>`;
}

/**
 * The newest round that carried BOTH the file (with timestamps) AND a runId, with its suite-load
 * samples clipped to the file's [start, end] window — the 「运行期间负载曲线片段」 (a fragment, not
 * the whole suite curve). Returns null when no such round exists (legacy rows / no runId); returns a
 * non-null object with possibly-empty samples when the round exists but the sampler produced no
 * points inside the window (the caller then renders the data-source-dependency note).
 */
function fileLoadFragment(
  root: string,
  runs: TestRunRecord[],
  filePath: string,
): { samples: SuiteLoadSample[]; label: string } | null {
  for (const r of runs) {
    if (!r.runId || !r.perFile) continue;
    const entry = r.perFile.find((f) => f.file === filePath);
    if (!entry) continue;
    const start = entry.startedAtMs;
    const end = entry.endedAtMs;
    if (typeof start !== "number" || typeof end !== "number") continue;
    const samples = clipSuiteLoadSamplesToWindow(readSuiteLoadSamples(root, r.runId), start, end);
    return { samples, label: roundLabel(r) };
  }
  return null;
}

function renderFileDetailPage(
  filePath: string,
  tests: TestsResult,
  fragment: { samples: SuiteLoadSample[]; label: string } | null,
): string {
  const history = collectFileHistory(tests.runs, filePath);
  const trendSvg = renderFileDurationTrendSvg(history);
  const historyTable = renderFileHistoryTable(history);
  const notFound = history.length === 0;

  const trend = trendSvg
    ? html`<h2>durationMs 趋势（跨 ${history.length} 轮）</h2>
        <p class="meta">数据源：<code>.quay/verification-round.jsonl</code> perFile（同一文件跨多轮聚合）</p>
        ${trendSvg}`
    : history.length === 1
      ? html`<p class="meta" style="color:var(--color-accent-800);font-weight:600">⚠️ 该文件仅出现在 1 轮 — 无跨多轮趋势（AC2 的「只有单轮 ⇒ 假」守卫）。</p>`
      : "";

  const fragmentSvg = fragment ? renderLoadCurveSvg(fragment.samples) : "";
  const loadFragment = fragment
    ? html`<h2>运行期间负载曲线片段${fragment.label ? `（${escapeHtml(fragment.label)}）` : ""}</h2>
        <p class="meta">数据源：<code>.quay/suite-load-&lt;runId&gt;.jsonl</code>（裁剪到该文件起止窗口）</p>
        ${fragmentSvg || html`<p class="meta">该文件起止窗口内无采样点 — 负载曲线是数据源依赖项（sampler-bypass 修复后显示）。</p>`}`
    : "";

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay test file — single-file cross-round history">${modernistStyles()}${pageStyles()}<title>Test file — ${escapeHtml(filePath)}</title></head>
    <body>${renderMobileChrome("tests", "tests")}${renderSiteNav("tests")}<main>
      <h1>测试文件 — <code>${escapeHtml(filePath)}</code></h1>
      <p class="meta"><a href="/tests">← 返回 Tests</a></p>
      ${obsNote(tests.status, tests.reason)}
      ${notFound ? html`<p class="meta"><strong>未找到</strong> — 该路径未出现在任何验证轮的 perFile 记录中。</p>` : ""}
      ${trend}
      ${historyTable ? html`<h2>pass/fail 历史（${history.length} 轮 · 旧→新）</h2>${historyTable}` : ""}
      ${loadFragment}
    </main></body></html>`;
}

export async function handleTestsFile(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  url: URL,
): Promise<void> {
  const filePath = url.searchParams.get("path") ?? "";
  let tests: TestsResult;
  try {
    tests = readTests(cfg.workspaceRoot);
  } catch (err) {
    tests = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, runs: [] };
  }
  const fragment = fileLoadFragment(cfg.workspaceRoot, tests.runs, filePath);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderFileDetailPage(filePath, tests, fragment));
}
