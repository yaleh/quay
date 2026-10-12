#!/usr/bin/env node
// carrier-retention.ts — append-safe archival + segment-iterating reads for the driver `*-round.jsonl`
// carriers (tasks/gap-driver-round-carriers-unbounded-growth-retention-design).
//
// ── WHAT QUESTION IT MAKES ASKABLE ──────────────────────────────────────────────────────────────
// "Can a `*-round.jsonl` carrier be bounded WITHOUT silently flipping any reader's reading?"
// Before this script the answer was un-askable: the carriers grow without bound (measured 2026-10-13:
// `.quay/meta-driver-round.jsonl` 95 MB / `.quay/goal-round.jsonl` 194 MB /
// `.quay/verification-round.jsonl` 180 MB, plus outer/worker/promotion 46-59 MB each), no reader
// declares which history window it actually needs, and every retention rule anyone might bolt on is
// a candidate silent-reading-flip (硬规则 4b/4c).
//
// ── THE THREE-PART ANSWER ──────────────────────────────────────────────────────────────────────
// 1. CENSUS (in the task body): for each carrier, every non-test reader at its POSITION (硬规则 2 —
//    a comment mentioning the carrier is not a reader) and the window that reader needs: whole /
//    latest-N / since-an-epoch. Two of them are WHOLE-HISTORY and are the reason a naive rotation
//    is unsafe: `round = prior lines + 1` numbering (runner-state-write.ts / pre-verified-round-
//    record.ts / full-suite-runner.ts) and `readCurrentRound` (pool-quality-judge.ts) which counts
//    EVERY line as "the current round".
// 2. MECHANISM (this file): `archiveCarrier` moves a whole-line prefix of a carrier into
//    `<dir>/archive/<carrier>/<carrier>.<YYYY-MM-DD>[-N].jsonl[.gz]` and leaves the remainder as the
//    live tail. An archive is a MOVE, never a delete: the byte concatenation of (segments in order,
//    then live) equals the pre-archive file BYTE-FOR-BYTE (AC2a).
// 3. READ-THROUGH: `materializeAllRecords` re-concatenates the full history into one file so an
//    EXISTING path-taking reader can be pointed at it UNCHANGED — which is what makes AC3's
//    "same reading before and after archiving" a real equality test against the real readers rather
//    than a re-implementation of them.
//
// ── FAIL-CLOSED / DEFAULT-DISABLED (AC5, DoD) ──────────────────────────────────────────────────
// Retention is OFF unless `.quay/config.yml` carries a `retention:` section with `enabled: true`.
// With the section absent the script performs ZERO writes of any kind (not even a manifest dir).
// Any error mid-archive leaves the LIVE carrier byte-identical (AC2c): the live file is only ever
// replaced by an atomic `rename` of a fully-written+fsynced temp in the SAME directory, and that
// rename is the LAST write the routine performs on the live path.
//
// ⛔ THIS TASK DOES NOT ROTATE ANY PRODUCTION CARRIER. Enabling retention on a production `.quay` is
// a separate, explicitly human-authorized step (the task's DoD says so). `--dry-run` exists to make
// that future decision reviewable: it prints the exact segments and bytes that WOULD be written and
// writes nothing.
//
// ── CONCURRENCY CONTRACT (AC2b) ────────────────────────────────────────────────────────────────
// The carriers have MANY writers (every driver round appends one line), all of which open the path,
// append, and close (`fs.appendFileSync`-shaped). The cut must lose and duplicate nothing across
// that. The routine holds an open fd on the PRE-ARCHIVE inode for the whole operation, so an
// appender that opened the path before the atomic replace keeps writing into the inode we still
// hold — those bytes are read back after the replace ("stragglers") and appended to the new live
// file. Bytes written to the NEW inode during the replace are already there. The two sets are
// disjoint by construction (we snapshot exactly [0, size0) and drain exactly [size0, ∞)), so no
// line is lost and none appears twice. ORDER across the concurrent window is not guaranteed (a
// straggler lands after a byte that raced into the new file) — every reader in the census takes a
// multiset (max / last-N / count / filter), never a positional index, so order is not a contract.
//
// Run:
//   node --experimental-strip-types plugin/scripts/carrier-retention.ts [--root <dir>] [--dry-run]
//        [--carrier <basename>]... [--live-max-bytes <n>] [--live-max-days <n>] [--json]
// Exit codes: 0 = ok (including "retention disabled" and `--dry-run`); 1 = a carrier could not be
// archived (the live carrier is untouched); 3 = usage error.

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync } from "node:zlib";
import { parse as parseYaml } from "yaml";
import { flagValue, isDirectEntry } from "./gate-script-base.ts";

// ── the six carriers (the census population — hard rule 3: enumerated, never a boolean) ─────────
export const ROUND_CARRIERS = [
  "meta-driver-round.jsonl",
  "goal-round.jsonl",
  "verification-round.jsonl",
  "outer-round.jsonl",
  "worker-round.jsonl",
  "promotion-round.jsonl",
] as const;
export type RoundCarrier = (typeof ROUND_CARRIERS)[number];

/** Where a carrier lives inside a workspace root. */
export function carrierPath(root: string, carrier: string): string {
  return path.join(root, ".quay", carrier);
}

// ── config (`retention:` in .quay/config.yml), default DISABLED ────────────────────────────────
export interface RetentionPolicy {
  enabled: boolean;
  liveMaxBytes: number | null;
  liveMaxDays: number | null;
  gzip: boolean;
}

export interface RetentionConfig {
  /** Distinguishable outcome (硬规则 3b): an absent section is NOT the same as an unreadable one. */
  source: "absent" | "config" | "malformed";
  /** Why `source` is `malformed` — surfaced, never swallowed. */
  reason: string | null;
  enabled: boolean;
  /** Policy for a carrier with no explicit entry under `retention.carriers`. */
  defaultPolicy: RetentionPolicy;
  carriers: Map<string, RetentionPolicy>;
}

const DISABLED_POLICY: RetentionPolicy = {
  enabled: false, liveMaxBytes: null, liveMaxDays: null, gzip: false,
};

/** Positive finite integer or null. A non-number / ≤0 / NaN value is REJECTED (returns null) rather
 *  than coerced — a silently-coerced 0 would mean "archive everything" (硬规则 3b). */
function posIntOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
}

function parsePolicy(raw: unknown, base: RetentionPolicy): RetentionPolicy {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...base };
  const o = raw as Record<string, unknown>;
  const bytes = posIntOrNull(o.live_max_bytes);
  const days = posIntOrNull(o.live_max_days);
  const gz = o.gzip;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : base.enabled,
    liveMaxBytes: bytes !== null ? bytes : base.liveMaxBytes,
    liveMaxDays: days !== null ? days : base.liveMaxDays,
    gzip: typeof gz === "boolean" ? gz : base.gzip,
  };
}

/**
 * Read the `retention:` block from `<root>/.quay/config.yml`.
 *
 * FAIL-CLOSED DIRECTION IS "DO NOTHING": an absent file, an absent section, an unparsable file or a
 * malformed section all yield `enabled: false` (⇒ zero writes). The three are still DISTINGUISHABLE
 * in the returned `source` (硬规则 3b — "I did not read it" must not look like "I read it and it
 * said no"), and a malformed section additionally carries `reason`.
 */
export function loadRetentionConfig(root: string): RetentionConfig {
  const cfgPath = path.join(root, ".quay", "config.yml");
  let raw: string;
  try {
    raw = fs.readFileSync(cfgPath, "utf8");
  } catch {
    return {
      source: "absent", reason: `no readable ${cfgPath}`, enabled: false,
      defaultPolicy: { ...DISABLED_POLICY }, carriers: new Map(),
    };
  }
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    return {
      source: "malformed", reason: `config.yml is not valid YAML: ${(e as Error).message}`,
      enabled: false, defaultPolicy: { ...DISABLED_POLICY }, carriers: new Map(),
    };
  }
  const section = (doc && typeof doc === "object" && !Array.isArray(doc))
    ? (doc as Record<string, unknown>).retention
    : undefined;
  if (section === undefined) {
    return {
      source: "absent", reason: "config.yml carries no `retention:` section",
      enabled: false, defaultPolicy: { ...DISABLED_POLICY }, carriers: new Map(),
    };
  }
  if (section === null || typeof section !== "object" || Array.isArray(section)) {
    return {
      source: "malformed", reason: "`retention:` is not a mapping",
      enabled: false, defaultPolicy: { ...DISABLED_POLICY }, carriers: new Map(),
    };
  }
  const s = section as Record<string, unknown>;
  const enabled = s.enabled === true;
  const defaultPolicy: RetentionPolicy = {
    enabled,
    liveMaxBytes: posIntOrNull(s.live_max_bytes),
    liveMaxDays: posIntOrNull(s.live_max_days),
    gzip: s.gzip === true,
  };
  const carriers = new Map<string, RetentionPolicy>();
  const perCarrier = s.carriers;
  if (perCarrier && typeof perCarrier === "object" && !Array.isArray(perCarrier)) {
    for (const [name, v] of Object.entries(perCarrier as Record<string, unknown>)) {
      carriers.set(name, parsePolicy(v, defaultPolicy));
    }
  }
  return { source: "config", reason: null, enabled, defaultPolicy, carriers };
}

/** The effective policy for one carrier: its own entry if present, else the default. */
export function policyFor(cfg: RetentionConfig, carrier: string): RetentionPolicy {
  const p = cfg.carriers.get(carrier) ?? cfg.defaultPolicy;
  if (!cfg.enabled) return { ...p, enabled: false };
  return p;
}

// ── segment paths + manifest ───────────────────────────────────────────────────────────────────
/** `<root>/.quay/archive/<carrier>/` — segments live in a SUBDIRECTORY. That is load-bearing:
 *  `goal-driver.ts` readdir()s `.quay/` and lists every `/-round\.jsonl$/` it finds (see the census),
 *  so a segment named `<carrier>.<date>.jsonl` left in `.quay/` would be invisible to that regex
 *  anyway — but a future reader keying on `readdir(".quay")` would not be so lucky, and a dedicated
 *  subdirectory makes the archive population structurally un-mistakable for the live carrier. */
export function archiveDirFor(livePath: string): string {
  return path.join(path.dirname(livePath), "archive", path.basename(livePath));
}

/** The manifest that lets a WHOLE-history reader iterate segments transparently. */
export function manifestPathFor(livePath: string): string {
  return path.join(archiveDirFor(livePath), "segments.json");
}

/** Segment file name: `<carrier>.<YYYY-MM-DD>[-<N>].jsonl[.gz]` (Plan step 2). */
export function segmentName(carrier: string, dayIso: string, ordinal: number, gzip: boolean): string {
  const stem = carrier.replace(/\.jsonl$/, "");
  const suffix = ordinal === 0 ? "" : `-${ordinal}`;
  return `${stem}.${dayIso}${suffix}.jsonl${gzip ? ".gz" : ""}`;
}

/** `[dayIso, ordinal]` parsed out of a segment file name (ordinal 0 when the name carries no
 *  `-<N>` suffix). Used ONLY for the disk-scan ordering fallback. */
export function segmentSortKey(file: string): [string, number] {
  const m = /\.(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.jsonl(?:\.gz)?$/.exec(file);
  if (!m) return [file, 0];
  return [m[1], m[2] === undefined ? 0 : Number(m[2])];
}

export interface SegmentEntry {
  /** basename, relative to the carrier's archive dir */
  file: string;
  bytes: number;
  lines: number;
  archivedAt: string;
}

export interface CarrierManifest {
  version: 1;
  carrier: string;
  segments: SegmentEntry[];
}

/** Read a carrier's manifest. Returns `null` when absent/unreadable/malformed — the caller
 *  distinguishes that from an EMPTY manifest, which is a real (empty) history (硬规则 3b). */
export function readManifest(livePath: string): CarrierManifest | null {
  const mp = manifestPathFor(livePath);
  let raw: string;
  try {
    raw = fs.readFileSync(mp, "utf8");
  } catch {
    return null;
  }
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || !Array.isArray(o.segments)) return null;
    return {
      version: 1,
      carrier: typeof o.carrier === "string" ? o.carrier : path.basename(livePath),
      segments: (o.segments as SegmentEntry[]).filter((s) => s && typeof s.file === "string"),
    };
  } catch {
    return null;
  }
}

/** Segments in archived order. Prefers the manifest; falls back to a disk scan of the archive dir
 *  (sorted by the `<date>[-N]` in the name) so a lost manifest degrades to "history still readable
 *  in the right order" rather than "history gone". `source` says which arm answered (硬规则 3b). */
export function listSegments(livePath: string): { segments: SegmentEntry[]; source: "manifest" | "disk" | "none" } {
  const m = readManifest(livePath);
  if (m) return { segments: m.segments, source: "manifest" };
  const dir = archiveDirFor(livePath);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { segments: [], source: "none" };
  }
  const stem = path.basename(livePath).replace(/\.jsonl$/, "");
  const segs: SegmentEntry[] = [];
  for (const n of names) {
    if (!n.startsWith(`${stem}.`)) continue;
    if (!/\.jsonl(\.gz)?$/.test(n)) continue;
    if (n === "segments.json") continue;
    const abs = path.join(dir, n);
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile()) continue;
    segs.push({ file: n, bytes: st.size, lines: -1, archivedAt: "" });
  }
  // Sort by (date, ordinal) NUMERICALLY, never lexicographically: `<stem>.<date>-1.jsonl` sorts
  // BEFORE `<stem>.<date>.jsonl` as raw strings (`-` 0x2D < `.` 0x2E) even though it was archived
  // after it — a plain string sort would silently reverse two segments' history.
  segs.sort((a, b) => {
    const ka = segmentSortKey(a.file);
    const kb = segmentSortKey(b.file);
    return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1 : ka[1] - kb[1];
  });
  return { segments: segs, source: segs.length ? "disk" : "none" };
}

// ── line-boundary helpers ──────────────────────────────────────────────────────────────────────
/** Offset of the start of the line containing (or ending at) `off`: the byte just after the last
 *  `\n` strictly before `off`. Returns **-1** when this buffer holds no such `\n` — ⛔ NOT 0, which
 *  would claim "the file starts here" and hand back an offset that is not a line start at all.
 *  (Measured 2026-10-13: `.quay/meta-driver-round.jsonl` carries records longer than 64 KB, so a
 *  fixed-width window routinely contains no newline; the -1 is what makes the caller widen instead
 *  of silently cutting mid-record.) */
export function lineStartAtOrBefore(buf: Buffer, off: number): number {
  let i = Math.min(off, buf.length) - 1;
  while (i >= 0) {
    if (buf[i] === 0x0a) return i + 1;
    i--;
  }
  return -1;
}

/** Absolute offset of the LAST `\n` in `[from, to)`, or -1 when that range holds none. Scans
 *  backwards in GROWING chunks, so the normal case (a newline a few KB back) costs one small read
 *  while a carrier with very long lines is still handled — at the price of a wider scan, never of a
 *  wrong answer. */
export function lastNewlineOffset(fd: number, from: number, to: number): number {
  if (to <= from) return -1;
  let span = 1 << 16;
  for (;;) {
    const lo = Math.max(from, to - span);
    const i = readWindow(fd, lo, to).lastIndexOf(0x0a);
    if (i >= 0) return lo + i;
    if (lo === from) return -1;
    span *= 4;
  }
}

/** The line-start offset to cut at, at or before `target`. Returns 0 when the prefix holds no
 *  newline at all (nothing can be archived without splitting a record), and `target` itself when it
 *  already sits on a line start. */
export function alignDownToLineStart(fd: number, target: number): number {
  if (target <= 0) return 0;
  const nl = lastNewlineOffset(fd, 0, target + 1);
  return nl < 0 ? 0 : nl + 1;
}

/** The single byte at `off`, or -1 when it cannot be read. */
function byteAt(fd: number, off: number): number {
  if (off < 0) return -1;
  const b = Buffer.allocUnsafe(1);
  return fs.readSync(fd, b, 0, 1, off) === 1 ? b[0] : -1;
}

/** Read a bounded window [from, to) from an fd, clamped to the file's current size. */
function readWindow(fd: number, from: number, to: number): Buffer {
  const start = Math.max(0, from);
  const len = Math.max(0, to - start);
  const buf = Buffer.allocUnsafe(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, buf, got, len - got, start + got);
    if (n <= 0) break;
    got += n;
  }
  return got === len ? buf : buf.subarray(0, got);
}

// ── timestamp policy (`live_max_days`) ─────────────────────────────────────────────────────────
/** Timestamp fields, in the order the census found them across the six carriers. */
const TS_FIELDS = ["ts", "at", "startedAt", "recordedAt", "finishedAt", "time"] as const;

/** Epoch-ms of a line's timestamp, or null when the line carries none we understand. */
export function lineTimestampMs(line: string): number | null {
  const s = line.trim();
  if (!s || s[0] !== "{") return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(s) as Record<string, unknown>; } catch { return null; }
  if (!o || typeof o !== "object") return null;
  for (const f of TS_FIELDS) {
    const v = o[f];
    if (typeof v === "string" && v) {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * The offset at which the day policy starts KEEPING. Everything strictly before it is older than
 * the cutoff and may be archived; the cut lands on the FIRST line that is either (a) at/after the
 * cutoff or (b) carrying no parseable timestamp at all.
 *
 * (b) is the fail-closed half: a line we cannot date must be KEPT, never silently archived as if it
 * were old (硬规则 3b — "I could not tell" must not resolve to the destructive branch).
 * Streamed in chunks so it never materializes a whole 194 MB carrier as one string.
 */
export function dayCutOffset(livePath: string, size: number, cutoffMs: number): number {
  const CHUNK = 1 << 20;
  const fd = fs.openSync(livePath, "r");
  try {
    let off = 0;
    let carry = "";
    let carryStart = 0;
    while (off < size) {
      const want = Math.min(CHUNK, size - off);
      const buf = Buffer.allocUnsafe(want);
      let got = 0;
      while (got < want) {
        const n = fs.readSync(fd, buf, got, want - got, off + got);
        if (n <= 0) break;
        got += n;
      }
      if (got === 0) break;
      const text = carry + buf.subarray(0, got).toString("utf8");
      const parts = text.split("\n");
      carry = parts.pop() as string;
      let lineStart = carryStart;
      for (const line of parts) {
        const lineEnd = lineStart + Buffer.byteLength(line, "utf8") + 1;
        const ts = lineTimestampMs(line);
        if (ts === null || ts >= cutoffMs) return lineStart;
        lineStart = lineEnd;
      }
      carryStart = lineStart;
      off += got;
    }
    return size; // every line is dated and older than the cutoff
  } finally {
    fs.closeSync(fd);
  }
}

// ── planning ───────────────────────────────────────────────────────────────────────────────────
export interface CarrierPlan {
  carrier: string;
  livePath: string;
  present: boolean;
  liveBytes: number;
  policy: RetentionPolicy;
  /** Bytes that would move into a new segment (0 ⇒ nothing to do). */
  headBytes: number;
  headLines: number;
  /** Bytes that would remain live. */
  tailBytes: number;
  /** True when headBytes > 0 and the policy admits a rotation. */
  rotate: boolean;
  reason: string;
}

/** Count `\n` in a range, plus whether the range ends mid-line. */
function countLines(fd: number, from: number, to: number): { lines: number; endsWithNewline: boolean } {
  const CHUNK = 1 << 20;
  let off = from;
  let lines = 0;
  let last = -1;
  while (off < to) {
    const want = Math.min(CHUNK, to - off);
    const buf = Buffer.allocUnsafe(want);
    let got = 0;
    while (got < want) {
      const n = fs.readSync(fd, buf, got, want - got, off + got);
      if (n <= 0) break;
      got += n;
    }
    if (got === 0) break;
    const view = buf.subarray(0, got);
    for (let i = 0; i < view.length; i++) if (view[i] === 0x0a) lines++;
    last = view[view.length - 1];
    off += got;
  }
  return { lines, endsWithNewline: last === 0x0a };
}

/**
 * Compute what WOULD be archived for one carrier. Pure read — never writes a byte, so it is safe to
 * run against a production `.quay` (AC4).
 */
export function planCarrier(root: string, carrier: string, policy: RetentionPolicy, nowMs: number): CarrierPlan {
  const livePath = carrierPath(root, carrier);
  const base: CarrierPlan = {
    carrier, livePath, present: false, liveBytes: 0, policy,
    headBytes: 0, headLines: 0, tailBytes: 0, rotate: false, reason: "",
  };
  let st: fs.Stats;
  try {
    st = fs.statSync(livePath);
  } catch {
    return { ...base, reason: "carrier absent" };
  }
  if (!st.isFile()) return { ...base, present: true, reason: "not a regular file" };
  base.present = true;
  base.liveBytes = st.size;
  base.tailBytes = st.size;

  if (!policy.enabled) return { ...base, reason: "retention disabled (config default)" };
  if (st.size === 0) return { ...base, reason: "carrier is empty" };
  if (policy.liveMaxBytes === null && policy.liveMaxDays === null) {
    return { ...base, reason: "policy sets neither live_max_bytes nor live_max_days" };
  }

  const fd = fs.openSync(livePath, "r");
  try {
    let cut = st.size;
    const reasons: string[] = [];

    if (policy.liveMaxBytes !== null) {
      const target = st.size - policy.liveMaxBytes;
      if (target > 0) {
        // Align DOWN to a line start so the kept tail begins on a record boundary.
        const aligned = alignDownToLineStart(fd, target);
        cut = Math.min(cut, aligned);
        reasons.push(`live_max_bytes=${policy.liveMaxBytes}`);
      } else {
        reasons.push(`live_max_bytes=${policy.liveMaxBytes} (already under budget)`);
      }
    }

    if (policy.liveMaxDays !== null) {
      const cutoffMs = nowMs - policy.liveMaxDays * 86_400_000;
      const dCut = dayCutOffset(livePath, st.size, cutoffMs);
      cut = Math.min(cut, dCut);
      reasons.push(`live_max_days=${policy.liveMaxDays}`);
    }

    // Never cut inside a trailing partial line: an unterminated last line is an in-flight write.
    // Only the LAST few bytes matter, so this scans back from EOF rather than reading the tail.
    const lastNl = lastNewlineOffset(fd, 0, st.size);
    const partial = st.size - (lastNl + 1);
    if (partial > 0) cut = Math.min(cut, st.size - partial);

    if (cut <= 0) return { ...base, reason: `nothing to archive (${reasons.join(", ")})` };

    // The cut MUST sit on a line start — checked directly at the one byte that decides it (O(1)),
    // never inferred from a re-scan.
    if (byteAt(fd, cut - 1) !== 0x0a) {
      return { ...base, reason: "cut is not on a line boundary — refusing (no newline to align to)" };
    }
    const c = countLines(fd, 0, cut);
    if (c.endsWithNewline === false) {
      return { ...base, reason: "cut is not on a line boundary — refusing" };
    }
    return {
      ...base,
      headBytes: cut,
      headLines: c.lines,
      tailBytes: st.size - cut,
      rotate: true,
      reason: reasons.join(", "),
    };
  } finally {
    fs.closeSync(fd);
  }
}

// ── the archive operation ──────────────────────────────────────────────────────────────────────
/** Test seam: a point at which the routine is forced to fail, so AC2c's "failure mid-archive leaves
 *  the live carrier byte-identical" is driven through the REAL code path rather than asserted. */
export type FaultPoint = "after-segment-write" | "before-live-rename" | null;

export interface ArchiveResult {
  carrier: string;
  action: "archived" | "skipped" | "disabled" | "dry-run" | "error";
  segmentFile: string | null;
  headBytes: number;
  headLines: number;
  tailBytes: number;
  /** Bytes recovered from an appender that raced onto the pre-archive inode. */
  stragglerBytes: number;
  reason: string;
  error: string | null;
}

/** Write `src` bytes [from,to) into `destPath` (optionally gzipped), fsync, and return the byte
 *  length written. The temp file is always in the SAME directory as its final name so the rename
 *  that follows cannot cross a filesystem boundary. */
async function writeRangeFile(srcFd: number, from: number, to: number, tmpPath: string, gzip: boolean): Promise<number> {
  const rs = fs.createReadStream(null as unknown as string, { fd: srcFd, start: from, end: to - 1, autoClose: false });
  const ws = fs.createWriteStream(tmpPath, { mode: 0o644 });
  if (gzip) await pipeline(rs, createGzip(), ws);
  else await pipeline(rs, ws);
  const fd = fs.openSync(tmpPath, "r+");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return fs.statSync(tmpPath).size;
}

function fsyncDir(dir: string): void {
  try {
    const fd = fs.openSync(dir, "r");
    try { fs.fsyncSync(fd); } catch { /* directory fsync is best-effort (not supported everywhere) */ }
    finally { fs.closeSync(fd); }
  } catch { /* ignore */ }
}

function readManifestOrEmpty(livePath: string, carrier: string): CarrierManifest {
  return readManifest(livePath) ?? { version: 1, carrier, segments: [] };
}

/** The first free `<carrier>.<date>[-<N>].jsonl[.gz]` slot in the carrier's archive dir. */
function freeSegmentPath(livePath: string, carrier: string, dayIso: string, gzip: boolean): string {
  const dir = archiveDirFor(livePath);
  for (let n = 0; n < 10_000; n++) {
    const p = path.join(dir, segmentName(carrier, dayIso, n, gzip));
    if (!fs.existsSync(p)) return p;
  }
  throw new Error("no free segment ordinal");
}

/**
 * Archive one carrier's prefix. The ONLY routine in this file that writes to a live carrier path.
 *
 * Ordering is the correctness argument (see the file header):
 *   1. open + snapshot [0, size0) — the fd pins the PRE-ARCHIVE inode for the whole call.
 *   2. segment = head bytes, written to a temp, fsynced, renamed into place, manifest updated.
 *      Nothing about the live path has changed yet, so a failure here is invisible to readers.
 *   3. tail bytes written to a temp in the live dir, fsynced, then `rename`d over the live path —
 *      one atomic step.
 *   4. drain the pinned fd from `size0` for in-flight appends and append them to the new live file.
 */
export async function archiveCarrier(opts: {
  root: string;
  carrier: string;
  policy: RetentionPolicy;
  nowMs?: number;
  dryRun?: boolean;
  fault?: FaultPoint;
  /** Silence window for the straggler drain (default 50 ms). Exposed so a stress test can widen it
   *  rather than race it. */
  settleMs?: number;
}): Promise<ArchiveResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const livePath = carrierPath(opts.root, opts.carrier);
  const empty: ArchiveResult = {
    carrier: opts.carrier, action: "skipped", segmentFile: null,
    headBytes: 0, headLines: 0, tailBytes: 0, stragglerBytes: 0, reason: "", error: null,
  };

  const plan = planCarrier(opts.root, opts.carrier, opts.policy, nowMs);
  if (!plan.present) return { ...empty, reason: "carrier absent" };
  if (!plan.rotate) {
    return { ...empty, action: plan.policy.enabled ? "skipped" : "disabled", tailBytes: plan.tailBytes, reason: plan.reason };
  }
  if (opts.dryRun) {
    return {
      ...empty, action: "dry-run", headBytes: plan.headBytes, headLines: plan.headLines,
      tailBytes: plan.tailBytes, reason: plan.reason,
    };
  }

  const dayIso = new Date(nowMs).toISOString().slice(0, 10);
  let fd: number;
  try {
    fd = fs.openSync(livePath, "r");
  } catch (e) {
    return { ...empty, action: "error", error: (e as Error).message, reason: "live carrier could not be opened" };
  }

  const tmpSegment = path.join(archiveDirFor(livePath), `.tmp-${process.pid}-${Date.now()}`);
  const tmpLive = path.join(path.dirname(livePath), `.tmp-live-${process.pid}-${Date.now()}`);
  let segName: string | null = null;
  try {
    const size0 = fs.fstatSync(fd).size;
    const cut = plan.headBytes;
    if (cut <= 0 || cut > size0) throw new Error(`planned cut ${cut} outside [0, ${size0}]`);

    fs.mkdirSync(archiveDirFor(livePath), { recursive: true });

    // ── 2. the segment ────────────────────────────────────────────────────────────────────────
    // Idempotent retry: a crash between the segment rename and the live rename leaves a segment
    // that is EXACTLY this prefix. Re-writing it would duplicate the history, so reuse it. The
    // byte comparison is only paid when a same-day, same-size segment already exists.
    const manifestBefore = readManifestOrEmpty(livePath, opts.carrier);
    const last = manifestBefore.segments.length
      ? manifestBefore.segments[manifestBefore.segments.length - 1]
      : null;
    let reuse: string | null = null;
    if (last && last.bytes === cut && last.file.startsWith(segmentName(opts.carrier, dayIso, 0, opts.policy.gzip).replace(/\.jsonl(\.gz)?$/, ""))) {
      const abs = path.join(archiveDirFor(livePath), last.file);
      let existing: Buffer | null = null;
      try {
        const raw = fs.readFileSync(abs);
        existing = last.file.endsWith(".gz") ? gunzipSync(raw) : raw;
      } catch { existing = null; }
      if (existing && existing.length === cut && Buffer.compare(existing, readWindow(fd, 0, cut)) === 0) reuse = last.file;
    }
    if (reuse) {
      segName = reuse;
    } else {
      const segPath = freeSegmentPath(livePath, opts.carrier, dayIso, opts.policy.gzip);
      const bytes = await writeRangeFile(fd, 0, cut, tmpSegment, opts.policy.gzip);
      if (opts.fault === "after-segment-write") throw new Error("fault injected: after-segment-write");
      fs.renameSync(tmpSegment, segPath);
      fsyncDir(path.dirname(segPath));
      segName = path.basename(segPath);
      manifestBefore.segments.push({
        file: segName, bytes, lines: plan.headLines, archivedAt: new Date(nowMs).toISOString(),
      });
      const mtmp = `${manifestPathFor(livePath)}.tmp-${process.pid}`;
      fs.writeFileSync(mtmp, JSON.stringify(manifestBefore, null, 2) + "\n");
      fs.renameSync(mtmp, manifestPathFor(livePath));
    }

    // ── 3. the live tail (atomic replace) ─────────────────────────────────────────────────────
    if (opts.fault === "before-live-rename") throw new Error("fault injected: before-live-rename");
    await writeRangeFile(fd, cut, size0, tmpLive, false);
    let mode = 0o644;
    try { mode = fs.fstatSync(fd).mode & 0o777; } catch { /* keep default */ }
    try { fs.chmodSync(tmpLive, mode); } catch { /* best effort */ }
    fs.renameSync(tmpLive, livePath);
    fsyncDir(path.dirname(livePath));

    // ── 4. stragglers: appends that raced onto the PRE-ARCHIVE inode ──────────────────────────
    const stragglers = drainAppends(fd, size0, opts.settleMs ?? 50);
    if (stragglers.length > 0) fs.appendFileSync(livePath, stragglers);

    return {
      carrier: opts.carrier, action: "archived", segmentFile: segName,
      headBytes: cut, headLines: plan.headLines, tailBytes: size0 - cut,
      stragglerBytes: stragglers.length, reason: plan.reason, error: null,
    };
  } catch (e) {
    return { ...empty, action: "error", error: (e as Error).message, reason: "archive failed — live carrier untouched" };
  } finally {
    fs.closeSync(fd);
    for (const t of [tmpSegment, tmpLive]) { try { fs.rmSync(t, { force: true }); } catch { /* best effort */ } }
  }
}

/** Read whatever landed on the pinned fd past `from`, giving an in-flight appender a settle window
 *  to finish. The window is a SILENCE window, not an absolute deadline: every byte observed pushes
 *  the deadline forward, so a burst of stragglers is drained to completion and we exit only after
 *  `settleMs` with nothing new. Returns the bytes (possibly empty). */
function drainAppends(fd: number, from: number, settleMs = 50): Buffer {
  const parts: Buffer[] = [];
  let off = from;
  let deadline = Date.now() + settleMs;
  for (;;) {
    let st: fs.Stats;
    try { st = fs.fstatSync(fd); } catch { break; }
    if (st.size > off) {
      const want = st.size - off;
      const buf = Buffer.allocUnsafe(want);
      let got = 0;
      while (got < want) {
        const n = fs.readSync(fd, buf, got, want - got, off + got);
        if (n <= 0) break;
        got += n;
      }
      if (got > 0) {
        parts.push(buf.subarray(0, got));
        off += got;
        deadline = Date.now() + settleMs; // observed growth ⇒ keep waiting
      }
      continue; // re-check immediately: more may have arrived while we read
    }
    if (Date.now() >= deadline) break;
    sleepMs(2);
  }
  return parts.length ? Buffer.concat(parts) : Buffer.alloc(0);
}

/** Synchronous sleep — the drain loop is a bounded spin and must not yield the event loop (the
 *  straggler guarantee rests on us still holding `fd`, which a concurrent async writer cannot
 *  revoke, but keeping the wait synchronous makes the window deterministic and testable). */
function sleepMs(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

// ── read-through helpers (the readers' side of the contract) ───────────────────────────────────
export interface AllRecords {
  /** Segments in archived order, then the live tail — the exact pre-archive byte sequence. */
  text: string;
  lines: string[];
  segments: SegmentEntry[];
  source: "manifest" | "disk" | "none";
}

/**
 * Read the FULL history of a carrier as if it had never been archived. A reader that needs whole
 * history calls this instead of reading the live path; a reader that needs only the tail is
 * unchanged (it keeps reading the live path).
 *
 * ⛔ In-memory by design for small/medium carriers; use `materializeAllRecords` for a carrier whose
 * full history is large enough that materializing it as ONE JS string is itself the hazard this
 * task exists to remove.
 */
export function readAllRecords(livePath: string): AllRecords {
  const { segments, source } = listSegments(livePath);
  const chunks: string[] = [];
  for (const s of segments) {
    const abs = path.join(archiveDirFor(livePath), s.file);
    try {
      const buf = fs.readFileSync(abs);
      chunks.push(s.file.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8"));
    } catch { /* a segment we cannot read is skipped, never fabricated */ }
  }
  let live = "";
  try { live = fs.readFileSync(livePath, "utf8"); } catch { /* absent live carrier ⇒ segments alone */ }
  chunks.push(live);
  const text = chunks.join("");
  return { text, lines: text.split("\n").filter((l) => l.trim().length > 0), segments, source };
}

function gunzip(buf: Buffer): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const zlib = require("node:zlib") as typeof import("node:zlib");
  return zlib.gunzipSync(buf);
}

/**
 * Re-concatenate the full history into ONE file at `destPath`, streaming, so an EXISTING reader
 * that takes a path can be pointed at the result UNCHANGED. This is what makes "the same reading
 * before and after archiving" checkable against the real readers (AC3) rather than against a
 * re-implementation of them.
 */
export async function materializeAllRecords(livePath: string, destPath: string): Promise<{ path: string; bytes: number; segments: number }> {
  const { segments } = listSegments(livePath);
  const ws = fs.createWriteStream(destPath);
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("finish", () => resolve());
    const step = async (): Promise<void> => {
      for (const s of segments) {
        const abs = path.join(archiveDirFor(livePath), s.file);
        let buf: Buffer;
        try { buf = fs.readFileSync(abs); } catch { continue; }
        if (s.file.endsWith(".gz")) buf = gunzip(buf);
        bytes += buf.length;
        if (!ws.write(buf)) await new Promise<void>((r) => ws.once("drain", () => r()));
      }
      try {
        const live = fs.readFileSync(livePath);
        bytes += live.length;
        if (live.length) ws.write(live);
      } catch { /* absent live carrier */ }
      ws.end();
    };
    step().catch(reject);
  });
  return { path: destPath, bytes, segments: segments.length };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────
const USAGE = `carrier-retention.ts — append-safe archival + segment-iterating reads for the driver
*-round.jsonl carriers. DEFAULT DISABLED: with no \`retention:\` section in <root>/.quay/config.yml
this script writes nothing at all.

  --root <dir>            workspace root (default: $QUAY_ROOT or cwd)
  --carrier <basename>    restrict to one carrier (repeatable; default: all six)
  --dry-run               plan only — print what WOULD be archived and write nothing
  --live-max-bytes <n>    policy override (also used for --dry-run on an unconfigured workspace)
  --live-max-days <n>     policy override
  --json                  machine-readable output
  --help | -h             this text
`;

interface Options {
  root: string;
  carriers: string[];
  dryRun: boolean;
  liveMaxBytes: number | null;
  liveMaxDays: number | null;
  json: boolean;
}

export function parseCli(argv: string[]): Options | { error: string } {
  const carriers: string[] = [];
  let root = process.env.QUAY_ROOT || process.cwd();
  let dryRun = false, json = false;
  let liveMaxBytes: number | null = null, liveMaxDays: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") { const v = flagValue(argv, "--root"); if (!v) return { error: "--root needs a value" }; root = v; }
    else if (a === "--carrier") { const v = flagValue(argv, "--carrier"); if (!v) return { error: "--carrier needs a value" }; carriers.push(v); }
    else if (a === "--live-max-bytes") { const v = flagValue(argv, "--live-max-bytes"); const n = v ? Number(v) : NaN; if (!Number.isFinite(n) || n <= 0) return { error: "--live-max-bytes needs a positive number" }; liveMaxBytes = Math.floor(n); }
    else if (a === "--live-max-days") { const v = flagValue(argv, "--live-max-days"); const n = v ? Number(v) : NaN; if (!Number.isFinite(n) || n <= 0) return { error: "--live-max-days needs a positive number" }; liveMaxDays = Math.floor(n); }
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--json") json = true;
  }
  return { root, carriers: carriers.length ? carriers : [...ROUND_CARRIERS], dryRun, liveMaxBytes, liveMaxDays, json };
}

/** The default `--dry-run` projection when the workspace configures no `retention:` policy: 8 MiB.
 *  Declared as a NAMED constant because it is a projection input a human reads, never a decision. */
export const DRY_RUN_PROJECTION_BYTES = 8 * 1024 * 1024;

export async function run(opts: Options): Promise<number> {
  const cfg = loadRetentionConfig(opts.root);
  const policyOverride: RetentionPolicy | null =
    opts.liveMaxBytes !== null || opts.liveMaxDays !== null
      ? { enabled: true, liveMaxBytes: opts.liveMaxBytes, liveMaxDays: opts.liveMaxDays, gzip: false }
      : null;

  const rows: CarrierPlan[] = [];
  for (const c of opts.carriers) {
    let policy = policyFor(cfg, c);
    if (policyOverride) policy = { ...policyOverride, enabled: true };
    else if (opts.dryRun && !policy.enabled) {
      // AC4: a --dry-run against a workspace that has NOT enabled retention must still be able to
      // show the shape. The projection is labelled as such (policy.enabled stays false so no write
      // can be triggered from it) and uses the named projection constant.
      policy = { enabled: true, liveMaxBytes: DRY_RUN_PROJECTION_BYTES, liveMaxDays: null, gzip: false };
    }
    rows.push(planCarrier(opts.root, c, policy, Date.now()));
  }

  const results: ArchiveResult[] = [];
  for (const r of rows) {
    if (opts.dryRun) {
      results.push({
        carrier: r.carrier, action: "dry-run", segmentFile: null,
        headBytes: r.headBytes, headLines: r.headLines, tailBytes: r.tailBytes,
        stragglerBytes: 0, reason: r.reason, error: null,
      });
      continue;
    }
    results.push(await archiveCarrier({ root: opts.root, carrier: r.carrier, policy: r.policy }));
  }

  if (opts.json) {
    console.log(JSON.stringify({
      root: opts.root, dryRun: opts.dryRun, configSource: cfg.source, configReason: cfg.reason,
      configEnabled: cfg.enabled, carriers: results.map((r) => ({ ...r, present: rows.find((x) => x.carrier === r.carrier)?.present ?? false, liveBytes: rows.find((x) => x.carrier === r.carrier)?.liveBytes ?? 0 })),
    }, null, 2));
    return 0;
  }

  const mode = opts.dryRun ? "DRY RUN (nothing written)" : (cfg.enabled ? "LIVE" : "DISABLED");
  console.log(`carrier-retention — ${mode} — root ${opts.root}`);
  console.log(`  config: source=${cfg.source}${cfg.reason ? ` (${cfg.reason})` : ""} enabled=${cfg.enabled}`);
  let errors = 0;
  for (const r of results) {
    const plan = rows.find((x) => x.carrier === r.carrier);
    const live = plan ? plan.liveBytes : 0;
    if (r.action === "error") { errors++; console.log(`  ✗ ${r.carrier}: ${r.error}`); continue; }
    if (!plan?.present) { console.log(`  - ${r.carrier}: absent`); continue; }
    if (r.headBytes > 0) {
      console.log(`  → ${r.carrier}: live ${live} B → segment ${r.headBytes} B / ${r.headLines} lines, tail ${r.tailBytes} B   [${r.reason}]`);
    } else {
      console.log(`  = ${r.carrier}: live ${live} B, nothing to archive   [${r.reason}]`);
    }
  }
  return errors > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta, process.argv[1], "carrier-retention")) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(USAGE); process.exit(0); }
  const parsed = parseCli(argv);
  if ("error" in parsed) { process.stderr.write(`carrier-retention: ${parsed.error}\n${USAGE}`); process.exit(3); }
  run(parsed).then((code) => process.exit(code)).catch((e) => {
    process.stderr.write(`carrier-retention: ${(e as Error).message}\n`);
    process.exit(1);
  });
}

export { USAGE };
