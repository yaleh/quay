// serve-tests.ts — /tests + /tests/file route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, readdirSync, openSync, readSync, closeSync, statSync } from "node:fs";
import path from "node:path";
import { readTests, type TestsResult, type TestRunRecord } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, pad2, obsNote, DEFAULT_PAGE_SIZE, tableWrap } from "./serve-render.ts";
import { renderTimelineBarSvg, DEFAULT_TIMELINE_HOURS, parseTimelineHours } from "./serve-dashboard.ts";

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

// ── gap-tests-load-curve-time-window-fallback — two-level load resolution ─────────────────────
//
// The /tests load lookup used to key ONLY off record.runId (suite-load-<runId>.jsonl). The
// mechanical fan-in path broke that key for a stretch of rounds (#692+): red records carry the
// literal runId "wk-prod-*", green records carry NO runId, while the load file is keyed by the
// runner UUID / fm-* token. gap-mechanical-fan-in-per-suite-runid-unified fixed NEW rounds; this
// fallback recovers the HISTORICAL broken-key rounds by matching on the round's declared
// [startedAt, startedAt+durationMs] time window instead of the (unreliable) id. Two levels:
//   ① runId exact hit — the post-fix rounds, and every pre-#692 round, keep keying directly.
//   ② window fallback — when the runId is absent or maps to no samples, find the load file whose
//      samples fall INSIDE the round's window (matching on sample TIME, not the writer's id).
// The page no longer depends on the writer's id convention — the same principle as the strict-
// history surface (the display reads the data-plane ledger, not the control-plane's internal id).

/**
 * Read a suite-load file's first + last sample timestamp (epoch ms) WITHOUT a full-file read — the
 * per-file min/max index the window fallback matches on (the proposal's 「首末样本时间小索引」, so
 * ~200 files are matched without parsing them all). The sampler appends in monotonically increasing
 * `t` (append-only, one sample per interval), so the first valid line is the min and the last valid
 * line is the max. A torn trailing line (partial write) is skipped by scanning backward. null bounds
 * mean the file has no parseable sample timestamp (empty / all-malformed) and can never match.
 */
function readFileSampleTBounds(file: string): { min: number | null; max: number | null } {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return { min: null, max: null };
  }
  if (size === 0) return { min: null, max: null };

  const parseT = (line: string): number | null => {
    const s = line.trim();
    if (!s) return null;
    try {
      const o = JSON.parse(s);
      const t = o && typeof o === "object" ? (o as { t?: unknown }).t : undefined;
      return typeof t === "number" && Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  };

  // A bounded head/tail chunk read (a sample line is a short single JSON line, so the first line is
  // fully inside the head chunk and the last complete line is fully inside the tail chunk) — never a
  // whole-file read, which is the full-scan this index exists to avoid.
  const readChunk = (position: number, length: number): string => {
    let fd: number | null = null;
    try {
      fd = openSync(file, "r");
      const buf = Buffer.alloc(length);
      const n = readSync(fd, buf, 0, length, position);
      return buf.toString("utf8", 0, Math.max(0, n));
    } catch {
      return "";
    } finally {
      if (fd != null) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
    }
  };

  const headLen = Math.min(size, 4096);
  let min: number | null = null;
  for (const line of readChunk(0, headLen).split(/\r?\n/)) {
    const t = parseT(line);
    if (t != null) { min = t; break; }
  }

  const tailLen = Math.min(size, 16384);
  let max: number | null = null;
  const tailLines = readChunk(size - tailLen, tailLen).split(/\r?\n/);
  for (let i = tailLines.length - 1; i >= 0; i--) {
    const t = parseT(tailLines[i]);
    if (t != null) { max = t; break; }
  }

  return { min, max };
}

/**
 * Window fallback (level ②): find every `.quay/suite-load-*.jsonl` whose sample-time range
 * [minT, maxT] overlaps [startMs, endMs] and return its samples clipped to the window. The overlap
 * test uses the per-file first/last-sample index (readFileSampleTBounds — no full-file read), so
 * only the (typically zero-or-one) matching file is fully parsed. A matching file with no in-window
 * samples contributes nothing. Returns [] when nothing matches or the directory is unreadable — a
 * no-match and a read-failure both degrade to no-curve (never a 500), the same as the exact-hit path.
 */
function readSuiteLoadSamplesByWindow(root: string, startMs: number, endMs: number): SuiteLoadSample[] {
  const dir = path.join(root, ".quay");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith("suite-load-") && f.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  const out: SuiteLoadSample[] = [];
  for (const f of files) {
    const { min, max } = readFileSampleTBounds(path.join(dir, f));
    if (min == null || max == null) continue;
    if (max < startMs || min > endMs) continue; // the file's samples fall entirely outside the window
    const runId = f.slice("suite-load-".length, f.length - ".jsonl".length);
    out.push(...clipSuiteLoadSamplesToWindow(readSuiteLoadSamples(root, runId), startMs, endMs));
  }
  return out;
}

/**
 * Two-level load resolution (the fallback task's core): ① record.runId exact hit (post-fix rounds);
 * ② window fallback (historical broken-key rounds) when the runId is absent or maps to no samples.
 * `window` is the round's (or file's) declared [start, end] in epoch ms; when null (legacy: no
 * durationMs) only the exact-hit path runs — the fallback has no window to match on.
 */
function resolveSuiteLoadSamples(
  root: string,
  runId: string | null | undefined,
  window: { start: number; end: number } | null,
): SuiteLoadSample[] {
  // ① exact hit (priority): the ledger's own runId — post-fix rounds key here and win over any
  //    window overlap (AC2: 「runId 精确命中的轮照常出曲线（优先于窗口回退）」).
  if (runId) {
    const raw = readSuiteLoadSamples(root, runId);
    if (raw.length > 0) return window ? clipSuiteLoadSamplesToWindow(raw, window.start, window.end) : raw;
  }
  // ② window fallback: only meaningful when a window is computable (a round/file without durationMs
  //    has no window to match on — AC3's legacy tolerance).
  if (window) return readSuiteLoadSamplesByWindow(root, window.start, window.end);
  return [];
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

// ── 最近测试记录分段时间轴（复用 dashboard 图件）────────────────────────────────────────────────────
//
// gap-webui-tests-page-missing-rounds-timeline-bar: /dashboard 的「测试」卡里有一条「过去 N 小时」
// 红绿分段时间轴（serve-dashboard.ts 的 renderTimelineBarSvg，export），但其消费者只有 dashboard
// 一处 —— /tests 作为 verification-round.jsonl 的正主页面反而没有（页面上只有 loadavg curve 与
// per-file gantt 两个 svg）。本段在 /tests 顶部复用该 export（import，不复制渲染逻辑），数据取
// tests.runs（与 dashboard 同源），分段颜色按 state red/green，窗口档位与 dashboard 一致
// （1h·3h·6h·12h，parseTimelineHours 另允许 1..24 的更长档）。

/** 测试轮 state → 与 dashboard testsCard 相同的颜色 token（green → positive，red → accent，其它 →
 *  neutral）。serve-dashboard.ts 的 stateColorToken 是模块私有（非 export），故此处按同一三元复刻
 *  这 3 行「颜色映射」——复刻的是映射不是渲染逻辑，渲染仍走 import 的 renderTimelineBarSvg（AC2
 *  断言 serve-tests.ts 里 0 个同名 function 定义，即不复制渲染函数）。 */
function timelineColorToken(state: string | null): string {
  return state === "green" ? "--color-positive-700" : state === "red" ? "--color-accent-800" : "--color-neutral-400";
}

/** tests.runs → 每轮一段 [startedAt, startedAt+durationMs]，颜色按 state。与 dashboard
 *  renderTestsCard 内的同款 map 逐字一致（AC4 的「同一份数据」：同源 verification-round.jsonl、
 *  同一套 start/end 换算，不是各算各的）。startedAt 不可解析 / durationMs 缺失的轮 → NaN（随后被
 *  renderTimelineBarSvg 的窗口过滤跳过，绝不臆造位置）。 */
export function buildTestsTimelineSegments(runs: TestRunRecord[]): Array<{ startMs: number; endMs: number; colorVar: string }> {
  return runs.map((r) => {
    const startMs = r.startedAt != null ? Date.parse(r.startedAt) : NaN;
    const endMs = Number.isFinite(startMs) && r.durationMs != null ? startMs + r.durationMs : NaN;
    return { startMs, endMs, colorVar: timelineColorToken(r.state) };
  });
}

/** 窗口终点 = 最近一次「可解析 startedAt + durationMs」的结束时刻（与 dashboard 同锚点：不是
 *  wall-clock now，而是最近一次真实事件结束 —— 循环停摆超过窗口时 bar 仍锚在最近事件上，不整段
 *  空掉）。无可用轮 → null（调用方回退到 nowMs，绝不 NaN）。 */
export function latestRoundEndMs(runs: TestRunRecord[]): number | null {
  let windowEndMs: number | null = null;
  for (const r of runs) {
    const startMs = r.startedAt != null ? Date.parse(r.startedAt) : NaN;
    if (!Number.isFinite(startMs) || r.durationMs == null) continue;
    const endMs = startMs + r.durationMs;
    if (windowEndMs == null || endMs > windowEndMs) windowEndMs = endMs;
  }
  return windowEndMs;
}

/** /tests 的最近测试记录分段 bar —— 复用 dashboard 的 renderTimelineBarSvg（import），输入
 *  tests.runs、hours 窗口、nowMs 兜底（windowEnd 不可计算时）。返回 "" 表示无分段（页面省略该节，
 *  绝不 500）。 */
export function renderTestsTimelineBar(runs: TestRunRecord[], hours: number, nowMs: number): string {
  return renderTimelineBarSvg(buildTestsTimelineSegments(runs), hours, latestRoundEndMs(runs) ?? nowMs);
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
    <td class="clamp" title="${escapeHtml(f.file)}"><a href="/tests/file?path=${encodeURIComponent(f.file)}"><code>${escapeHtml(f.file)}</code></a></td>
    <td>${escapeHtml(String(Math.round(f.durationMs)))} ms</td>
    <td class="${f.passed ? "" : "verdict-fail"}" style="${f.passed ? "" : "font-weight:700"}">${f.passed ? "passed" : "failed"}</td>
  </tr>`).join("\n");
  return html`<details open style="margin-top:1rem">
    <summary style="cursor:pointer;font-weight:600">perFile 耗时明细（耗时降序 · 失败标红）</summary>
    ${tableWrap(html`<table style="margin-top:0.5rem">
      <tr><th>file</th><th>duration</th><th>result</th></tr>
      ${rows}
    </table>`)}
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
 * gap-webui-tests-page-unpaginated-tables — a full-suite timeline is hundreds of 14px bars (measured
 * 119,381 bytes of SVG for 288 files), which dominates /tests's default response the same way the two
 * unpaginated tables did. TIMELINE_MAX_BARS now names the DEFAULT gantt page size (still ~50 bars) —
 * the byte budget survives, but gap-webui-tests-page-timeline-gantt-truncated replaced the old "cap to
 * the SLOWEST 50" with a chronological server-side slice, so every timed file is reachable by paging.
 */
const TIMELINE_MAX_BARS = 50;

/** The gantt's pagination state (page already clamped), computed over the TIMED entries only. */
export interface TimelinePaging {
  page: number;
  totalPages: number;
  totalRows: number;
  pageSize: number;
}

/**
 * gap-test-detail-timeline AC2 — render the per-file timeline (one horizontal bar per file, positioned
 * by its start/end epoch-ms) as a pure, dependency-free server-rendered SVG string. Sorted by start
 * time ASC (a chronological timeline, distinct from the duration table's DESC). Only files carrying
 * BOTH `startedAtMs` and `endedAtMs` are plotted; absent/legacy perFile ⇒ "" (no fabricated chart).
 * gap-webui-tests-page-timeline-gantt-truncated — `paging` slices the chronological axis server-side
 * (page `paging.page` of `paging.totalPages`, `paging.pageSize` per page) instead of the old "slowest
 * 50 then re-sort"; the title states the current page's row range so no file is silently invisible.
 * Marks carry token-derived CSS classes (git-svg-* / gantt-svg-*), ZERO hardcoded hex, zero client JS.
 */
export function renderPerFileTimelineSvg(
  perFile: { file: string; durationMs: number; passed: boolean; startedAtMs?: number; endedAtMs?: number }[] | null | undefined,
  root?: string | null,
  paging?: TimelinePaging,
): string {
  if (!perFile || perFile.length === 0) return "";
  const timed = perFile.filter(hasTimestamps);
  if (timed.length === 0) return "";
  // gap-webui-tests-page-timeline-gantt-truncated — a chronological window (start-time ASC, then this
  // page's slice), replacing "slowest 50 then re-sort". A missing `paging` (legacy direct callers) is
  // page 1 of the default page size — the same ≤ TIMELINE_MAX_BARS bars, but now the EARLIEST-starting
  // ones rather than the slowest, so paging to the end exposes the whole axis. Never mutates the
  // caller's array (filter → slice → sort).
  const pageSize = paging?.pageSize ?? TIMELINE_MAX_BARS;
  const totalRows = paging?.totalRows ?? timed.length;
  const totalPages = Math.max(1, paging?.totalPages ?? Math.ceil(totalRows / pageSize));
  const page = Math.min(Math.max(1, paging?.page ?? 1), totalPages);
  const offset = (page - 1) * pageSize;
  const rows = timed
    .slice()
    .sort((a, b) => a.startedAtMs - b.startedAtMs)
    .slice(offset, offset + pageSize);

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

  // gap-webui-tests-page-timeline-gantt-truncated AC5 — name the current page's row range ("第 X/Y 页 ·
  // 本页 A–B / 共 N 个文件") instead of the old "仅显示最慢 N/M" (which implied the rest were gone).
  const title = `测试时间线（每文件起止时刻 · 第 ${page}/${totalPages} 页 · 本页 ${offset + 1}–${offset + rows.length} / 共 ${totalRows} 个文件 · 按开始时刻升序 · 按 bucket 着色）`;

  return `<svg class="git-svg-surface" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Per-file test timeline (gantt)" style="max-width:100%;height:auto;border:1px solid var(--color-neutral-200);border-radius:6px;font-family:system-ui,-apple-system,sans-serif;">
${xTicks.join("\n")}
${bars}
${legend}
<text class="git-svg-ink" x="${M.left}" y="${(M.top - 6).toFixed(1)}" font-size="11">${title}</text>
</svg>`;
}

// ── gap-webui-tests-page-unpaginated-tables — server-side pagination for the two /tests tables ──
//
// The two list tables on /tests (历史运行 history + perFile 耗时明细) previously flattened EVERY row
// (1267 + 571 → a 665,105-byte page, 114,161 px tall). The pagination primitives already existed in
// serve-render.ts (DEFAULT_PAGE_SIZE, consumed by /tasks via buildHref and /board via
// buildBoardHref) but were never wired here — the 硬规则 5b instance: gap-webui-board-no-pagination
// built the mechanism correctly and wired exactly ONE page. This wires BOTH tables to the SAME
// server-side slice: history keys off ?page / ?pageSize, perFile off ?perFilePage / ?perFilePageSize
// (separate namespaces so the two independent datasets paginate independently). Zero client JS —
// plain <a href> links, the same as /board and /tasks.

/** One table's pagination state, with `page` already clamped to [1, totalPages]. */
interface PagingState {
  page: number;
  totalPages: number;
  totalRows: number;
  pageSize: number;
  pageSizeInvalid: boolean;
}

/** The full /tests query state carried through every pagination link (focus round + all three datasets —
 *  history, perFile table, gantt — + the timeline window). `hours`/`ganttPage`/`ganttPageSize` are
 *  optional so pre-existing direct callers (and the unpaginated-tables test) render the defaults. */
interface TestsQueryState {
  round: number | null;
  page: number;
  pageSize: number;
  perFilePage: number;
  perFilePageSize: number;
  ganttPage?: number;
  ganttPageSize?: number;
  hours?: number | null;
}

/** Build a /tests href preserving the focus round + all three datasets' pagination + the timeline
 *  window, overriding the given fields. */
export function buildTestsHref(q: TestsQueryState): string {
  const params = new URLSearchParams();
  if (q.round != null) params.set("round", String(q.round));
  if (q.page > 1) params.set("page", String(q.page));
  if (q.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(q.pageSize));
  if (q.perFilePage > 1) params.set("perFilePage", String(q.perFilePage));
  if (q.perFilePageSize !== DEFAULT_PAGE_SIZE) params.set("perFilePageSize", String(q.perFilePageSize));
  if (q.ganttPage != null && q.ganttPage > 1) params.set("ganttPage", String(q.ganttPage));
  if (q.ganttPageSize != null && q.ganttPageSize !== TIMELINE_MAX_BARS) params.set("ganttPageSize", String(q.ganttPageSize));
  if (q.hours != null && q.hours !== DEFAULT_TIMELINE_HOURS) params.set("hours", String(q.hours));
  const qs = params.toString();
  return qs ? `/tests?${qs}` : "/tests";
}

/**
 * The shared "Page size: 20 50 100 250" + "Page N of M (N rows)" + « Previous / Next » nav, mirroring
 * /board (gap-webui-board-no-pagination). `href(pg, size)` builds the link in the owning table's param
 * namespace (history → page/pageSize; perFile → perFilePage/perFilePageSize); a null `pg` means "reset
 * to page 1" (the page-size links drop the page param). Pure — no DOM, no client JS.
 */
function renderPagingNav(paging: PagingState, href: (pg: number | null, size: number) => string): string {
  const options = [20, 50, 100, 250];
  const sizeNav = html`<p class="meta">Page size:
    ${options.map((sz) => sz === paging.pageSize
      ? html`<strong>${sz}</strong>`
      : html`<a href="${href(null, sz)}">${sz}</a>`).join(" ")}
    ${paging.pageSizeInvalid ? html`<span class="error-banner" role="alert" style="display:inline;margin-left:0.5rem">Invalid pageSize value ignored; showing default (${DEFAULT_PAGE_SIZE}).</span>` : ""}
  </p>`;
  const pageNav = paging.totalPages > 1
    ? html`<p class="meta">
        ${paging.page > 1
          ? html`<a href="${href(paging.page - 1, paging.pageSize)}">&laquo; Previous</a>`
          : html`<span class="page-nav-disabled">&laquo; Previous</span>`}
        &nbsp; Page ${paging.page} of ${paging.totalPages} (${paging.totalRows} rows) &nbsp;
        ${paging.page < paging.totalPages
          ? html`<a href="${href(paging.page + 1, paging.pageSize)}">Next &raquo;</a>`
          : html`<span class="page-nav-disabled">Next &raquo;</span>`}
      </p>`
    : html`<p class="meta">Page 1 of ${paging.totalPages} (${paging.totalRows} rows)</p>`;
  return sizeNav + pageNav;
}

/** The raw (unclamped) /tests pagination request values, parsed in handleTests. Optional so direct
 *  renderTestsPage callers render a single default page (never a crash, same as renderBoardPage). */
interface TestsPagingOpts {
  page?: number;
  pageSize?: number;
  pageSizeInvalid?: boolean;
  perFilePage?: number;
  perFilePageSize?: number;
  perFilePageSizeInvalid?: boolean;
  ganttPage?: number;
  ganttPageSize?: number;
  ganttPageSizeInvalid?: boolean;
}

function renderTestsPage(
  tests: TestsResult,
  root: string,
  samples: SuiteLoadSample[] = [],
  selected: TestRunRecord | null = null,
  roundRequested: number | null = null,
  opts: TestsPagingOpts = {},
  hours: number = DEFAULT_TIMELINE_HOURS,
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
  // gap-webui-tests-page-unpaginated-tables — slice the history table server-side (default 20 rows).
  // The slice is a window into tests.runs (newest-first); the « ← 最新 » marker keys off the GLOBAL
  // index (historyOffset + i === 0) so page 2's first row is never mislabeled "最新".
  const historyPageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const historyPageSizeInvalid = opts.pageSizeInvalid ?? false;
  const historyTotalRows = tests.runs.length;
  const historyTotalPages = Math.max(1, Math.ceil(historyTotalRows / historyPageSize));
  const historyPage = Math.min(Math.max(1, opts.page ?? 1), historyTotalPages);
  const historyOffset = (historyPage - 1) * historyPageSize;
  const historySlice = tests.runs.slice(historyOffset, historyOffset + historyPageSize);
  const historyRows = historySlice.map((r, i) => html`<tr>
    <td>${r.round != null ? html`<a href="/tests?round=${r.round}">#${escapeHtml(String(r.round))}</a>${historyOffset + i === 0 ? ` <span style="color:var(--color-neutral-700);font-weight:600">← 最新</span>` : ""}` : "—"}</td>
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
  // gap-webui-tests-page-unpaginated-tables — slice the perFile table server-side (default 20 rows),
  // its OWN namespace (?perFilePage / ?perFilePageSize) so it paginates independently of the history
  // table.
  const perFilePageSize = opts.perFilePageSize ?? DEFAULT_PAGE_SIZE;
  const perFilePageSizeInvalid = opts.perFilePageSizeInvalid ?? false;
  const perFileTotalRows = perFileRun ? perFileRun.perFile.length : 0;
  const perFileTotalPages = Math.max(1, Math.ceil(perFileTotalRows / perFilePageSize));
  const perFilePage = Math.min(Math.max(1, opts.perFilePage ?? 1), perFileTotalPages);
  const perFileOffset = (perFilePage - 1) * perFilePageSize;
  const perFileSlice = perFileRun ? perFileRun.perFile.slice(perFileOffset, perFileOffset + perFilePageSize) : null;
  const perFileTable = perFileSlice && perFileSlice.length > 0 ? renderPerFileTable(perFileSlice) : "";
  // gap-webui-tests-page-timeline-gantt-truncated — paginate the gantt (a chart, not a list) over the
  // TIMED entries only (the chart plots only those), its OWN namespace (?ganttPage / ?ganttPageSize).
  // Default pageSize stays TIMELINE_MAX_BARS (50) so the byte budget the unpaginated-tables task solved
  // is preserved; the SLICE is by start-time ASC, so paging to the end exposes the whole time axis.
  const ganttTimed = perFileRun ? perFileRun.perFile.filter(hasTimestamps) : [];
  const ganttPageSize = opts.ganttPageSize ?? TIMELINE_MAX_BARS;
  const ganttPageSizeInvalid = opts.ganttPageSizeInvalid ?? false;
  const ganttTotalRows = ganttTimed.length;
  const ganttTotalPages = Math.max(1, Math.ceil(ganttTotalRows / ganttPageSize));
  const ganttPage = Math.min(Math.max(1, opts.ganttPage ?? 1), ganttTotalPages);
  // gap-test-detail-timeline AC2 — render the per-file timeline (gantt) for that same run. The chart
  // omits itself (⇒ "") when the run's perFile entries carry no timestamps (legacy/absent field).
  const perFileTimelineSvg = perFileRun
    ? renderPerFileTimelineSvg(perFileRun.perFile, root, { page: ganttPage, totalPages: ganttTotalPages, totalRows: ganttTotalRows, pageSize: ganttPageSize })
    : "";
  // gap-web-tests-three-sections-round-drift AC2 — the find() above silently falls back to an
  // EARLIER run when the newest run carries no perFile (red / static-check-early-fail / reporter
  // stopped before perFile). Surface that fallback instead of hiding it: name both the latest run
  // and the run actually shown. (No fallback notice in focus mode — the selected round is shown as-is,
  // not "falling back" from a different round.)
  const timelineFallback = !focus && perFileRun != null && latest != null && perFileRun !== latest;
  // gap-webui-tests-page-timeline-gantt-truncated — the gantt's own nav (?ganttPage/?ganttPageSize),
  // rendered inside the timeline section right below the chart so it can't be confused with the
  // history/perFile navs.
  const ganttNav = perFileTimelineSvg
    ? renderPagingNav(
        { page: ganttPage, totalPages: ganttTotalPages, totalRows: ganttTotalRows, pageSize: ganttPageSize, pageSizeInvalid: ganttPageSizeInvalid },
        (pg, sz) => buildTestsHref({ round: roundRequested, page: historyPage, pageSize: historyPageSize, perFilePage, perFilePageSize, ganttPage: pg ?? 1, ganttPageSize: sz, hours }),
      )
    : "";
  const perFileTimeline = perFileTimelineSvg
    ? html`<h2>测试时间线${perFileRun ? `（${roundLabel(perFileRun)}）` : ""}</h2>
        ${timelineFallback ? html`<p class="meta" style="margin:0.25rem 0;color:var(--color-accent-800);font-weight:600">⚠️ 最新一轮无 perFile 数据${latest ? `（${roundLabel(latest)}）` : ""}，以下回退显示${perFileRun ? ` ${roundLabel(perFileRun)}` : ""}。</p>` : ""}
        <p class="meta">数据源：<code>.quay/verification-round.jsonl</code> perFile 起止时刻（reporter 结束时刻 + duration 反推起始）</p>
        ${perFileTimelineSvg}
        ${ganttNav}`
    : "";
  // gap-webui-tests-page-unpaginated-tables — the two table navs (each preserving the focus round AND
  // the OTHER datasets' pages so cross-dataset state never resets on a single-dataset navigation).
  const historyNav = tests.runs.length > 0
    ? renderPagingNav(
        { page: historyPage, totalPages: historyTotalPages, totalRows: historyTotalRows, pageSize: historyPageSize, pageSizeInvalid: historyPageSizeInvalid },
        (pg, sz) => buildTestsHref({ round: roundRequested, page: pg ?? 1, pageSize: sz, perFilePage, perFilePageSize, ganttPage, ganttPageSize, hours }),
      )
    : "";
  const perFileNav = perFileTable
    ? renderPagingNav(
        { page: perFilePage, totalPages: perFileTotalPages, totalRows: perFileTotalRows, pageSize: perFilePageSize, pageSizeInvalid: perFilePageSizeInvalid },
        (pg, sz) => buildTestsHref({ round: roundRequested, page: historyPage, pageSize: historyPageSize, perFilePage: pg ?? 1, perFilePageSize: sz, ganttPage, ganttPageSize, hours }),
      )
    : "";
  // gap-webui-tests-page-missing-rounds-timeline-bar — 最近测试记录分段时间轴（复用 dashboard 的
  // renderTimelineBarSvg）。放在 suite 状态摘要（latestBanner）之下、负载曲线之上。窗口档位与
  // dashboard 一致（1h·3h·6h·12h，页面重载链接）；?hours= 另可设 1..24 的更长档（parseTimelineHours）。
  const roundsTimelineBar = renderTestsTimelineBar(tests.runs, hours, Date.now());
  const hourLinks = [1, 3, 6, 12]
    .map((n) => html`<a href="/tests?hours=${n}" style="color:var(--color-accent);text-decoration:none;${n === hours ? "font-weight:700" : ""}">${n}h</a>`)
    .join(" · ");
  const roundsTimeline = roundsTimelineBar
    ? html`<h2>最近测试记录分段时间轴</h2>
        <p class="meta">数据源：<code>.quay/verification-round.jsonl</code>（每轮一段，红=red · 绿=green，锚定最近一轮结束时刻）</p>
        <p class="meta">时间轴窗口（过去 ${hours}h）：${hourLinks}</p>
        ${roundsTimelineBar}`
    : "";
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay tests — verification rounds">${modernistStyles()}${pageStyles()}<title>Tests — 验证轮记录</title></head>
    <body>${renderMobileChrome("tests", "tests")}${renderSiteNav("tests")}<main id="main">
      <h1>Tests — 验证轮记录</h1>
      <p class="meta">数据源：<code>.quay/verification-round.jsonl</code>（每轮 suite 完成时追加，红绿皆入账）</p>
      ${obsNote(tests.status, tests.reason)}
      ${focusNote}
      ${notFoundNote}
      ${latestBanner}
      ${roundsTimeline}
      ${loadCurve}
      ${perFileTimeline}
      ${tests.runs.length > 0 ? html`<h2>历史运行（新→旧）</h2>
      ${historyNav}
      ${tableWrap(html`<table>
        <tr><th>round</th><th>startedAt</th><th>state</th><th>pass/fail/cancel</th><th>duration</th><th>scope</th><th>buckets</th><th>commit</th></tr>
        ${historyRows}
      </table>`)}` : ""}
      ${failureDetails}
      ${perFileTable}
      ${perFileNav}
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
    // gap-tests-load-curve-time-window-fallback — two-level resolution (runId exact hit → window
    // fallback), applied to BOTH the selected round and the default latest round.
    if (selected) {
      return resolveSuiteLoadSamples(cfg.workspaceRoot, selected.runId, roundTimeWindowMs(selected));
    }
    const latest = tests.runs[0] ?? null;
    return resolveSuiteLoadSamples(cfg.workspaceRoot, latest?.runId, roundTimeWindowMs(latest));
  })();
  // gap-webui-tests-page-unpaginated-tables — parse the three pagination namespaces (?page / ?pageSize for
  // history, ?perFilePage / ?perFilePageSize for the perFile table, ?ganttPage / ?ganttPageSize for the
  // timeline chart), mirroring /board's QW-007 pattern: 1-based page (default 1), pageSize (default
  // DEFAULT_PAGE_SIZE / TIMELINE_MAX_BARS); invalid values fall back to defaults with a visible "invalid
  // value ignored" note (never a 500, never a silently-wrong page).
  const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const pageSizeParam = parseInt(url.searchParams.get("pageSize") || "", 10);
  const pageSizeInvalid = url.searchParams.has("pageSize") && (!Number.isFinite(pageSizeParam) || pageSizeParam < 1);
  const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam >= 1 ? pageSizeParam : DEFAULT_PAGE_SIZE;
  const perFilePageParam = parseInt(url.searchParams.get("perFilePage") || "1", 10);
  const perFilePage = Number.isFinite(perFilePageParam) && perFilePageParam >= 1 ? perFilePageParam : 1;
  const perFilePageSizeParam = parseInt(url.searchParams.get("perFilePageSize") || "", 10);
  const perFilePageSizeInvalid = url.searchParams.has("perFilePageSize") && (!Number.isFinite(perFilePageSizeParam) || perFilePageSizeParam < 1);
  const perFilePageSize = Number.isFinite(perFilePageSizeParam) && perFilePageSizeParam >= 1 ? perFilePageSizeParam : DEFAULT_PAGE_SIZE;
  const ganttPageParam = parseInt(url.searchParams.get("ganttPage") || "1", 10);
  const ganttPage = Number.isFinite(ganttPageParam) && ganttPageParam >= 1 ? ganttPageParam : 1;
  const ganttPageSizeParam = parseInt(url.searchParams.get("ganttPageSize") || "", 10);
  const ganttPageSizeInvalid = url.searchParams.has("ganttPageSize") && (!Number.isFinite(ganttPageSizeParam) || ganttPageSizeParam < 1);
  const ganttPageSize = Number.isFinite(ganttPageSizeParam) && ganttPageSizeParam >= 1 ? ganttPageSizeParam : TIMELINE_MAX_BARS;
  // gap-webui-tests-page-missing-rounds-timeline-bar — read the timeline window off ?hours=（与 dashboard
  // 同一 parseTimelineHours：非法/超界回退默认 3，绝不 500）。
  const hours = parseTimelineHours(url.searchParams.get("hours"));
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderTestsPage(tests, cfg.workspaceRoot, samples, selected, roundNum, {
    page, pageSize, pageSizeInvalid, perFilePage, perFilePageSize, perFilePageSizeInvalid, ganttPage, ganttPageSize, ganttPageSizeInvalid,
  }, hours));
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
  return tableWrap(`<table>
    <tr><th>round</th><th>startedAt</th><th>duration</th><th>result</th></tr>
    ${rows}
  </table>`);
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
    if (!r.perFile) continue;
    const entry = r.perFile.find((f) => f.file === filePath);
    if (!entry) continue;
    const start = entry.startedAtMs;
    const end = entry.endedAtMs;
    if (typeof start !== "number" || typeof end !== "number") continue;
    // gap-tests-load-curve-time-window-fallback — the file page reuses the SAME two-level resolution
    // (runId exact hit → window fallback) with the file's [startedAtMs, endedAtMs] window, so a
    // broken-key round (no/wrong runId) whose load file overlaps the file's run window still renders.
    const samples = resolveSuiteLoadSamples(root, r.runId, { start, end });
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
    <body>${renderMobileChrome("tests", "tests")}${renderSiteNav("tests")}<main id="main">
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
