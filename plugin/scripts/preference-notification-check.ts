// preference-notification-check.ts — AC57 通知面检查器（tasks/gap-ac57-preference-change-notification）。
//
// AC57 义务（phase-goal 逐字）：倾向变更的通知**不得包含倾向内容本身**，只说「倾向变了，去重读」+ 指纹。
// AC57 理由（SPEC §4.1）：消息 compact 后不可重读、无单一正本、无法验证用的是哪一版——三条失败模式
// 已在当日实证（最有价值的 A19 规格幸存是因为 outer 抄进了任务体，不是因为消息还在）。
// AC57 能取假（manager 7e7aa61b 补，AC49 判据1 标准）：拿一条真实的倾向变更通知回放——若它携带了
// 倾向内容本身（而非仅"变了+去重读+指纹"）⇒ 必须报红。
//
// 可核载体（发送侧留痕，落地方设计，SPEC §7 不规定）：`orchestration/preference-notification-log.md`
// —— git 可见（抗 compact、跨会话重启存活）。发送者（manager）每次 SendMessage 倾向变更通知时，
// 把通知的【确切文本】逐字追加到该文件的「## 留痕记录」段。通知是消息不是文件 ⇒ 留痕日志是让通知
// 可核的载体。检查器读取该日志，验证：
//   (a) 日志的「## 通知模板」段正确记录了 AC57 模板（含通知语 + 指纹占位）；
//   (b) 「## 留痕记录」段内的每一条通知记录：含通知语 + 指纹（且指纹 == 当前倾向文件的 git blob
//       hash——「通知引用的是 AC54 文件的指纹」，DoD 对接），且**不含任何倾向内容行**（泄漏 ⇒ 红）。
//
// 检查器是 CHECKER 不是 WRITER：它只读通知日志与倾向文件，从不写它们。
//
// Run:
//   node --experimental-strip-types plugin/scripts/preference-notification-check.ts [--root <dir>] [--json]
//   node --experimental-strip-types plugin/scripts/preference-notification-check.ts --file <path> [--root <dir>] [--json]
//   node --experimental-strip-types plugin/scripts/preference-notification-check.ts --text <str> [--root <dir>] [--json]
//     (--file/--text: 检查一个显式通知样本——负控制 fixture 用；--root 仍提供倾向文件做泄漏基线与指纹)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ── AC57 contract constants ──────────────────────────────────────────────────────────────────────────────

/** The mandatory notice phrase — a notification MUST say this (AC57: 「倾向变了，去重读」). */
export const NOTICE_PHRASE = "倾向变了，去重读";

/** The notification log's repo-relative path (the send-side trace carrier). */
export const NOTIFICATION_LOG_REL = "orchestration/preference-notification-log.md";

/** The preference file's repo-relative path (AC54 file — the fingerprint's subject, DoD 对接). */
export const PREFERENCE_FILE_REL = "orchestration/dispatch-preference.md";

/** A git blob hash is 40 hex (sha1) or 64 hex (sha256) — the fingerprint token a notification must carry. */
export const FINGERPRINT_RE = /\b[0-9a-f]{40}\b|\b[0-9a-f]{64}\b/g;

/** A preference-content line shorter than this (non-ws chars) is not treated as a distinctive leak token. */
export const LEAK_LINE_MIN_CHARS = 12;

/** Section headings inside the notification log (exact `## ` lines). */
export const LOG_TEMPLATE_SECTION = "## 通知模板";
export const LOG_RECORDS_SECTION = "## 留痕记录";

/** The template section MUST document a `指纹：` placeholder line (the fingerprint the sender fills in). */
export const FINGERPRINT_LABEL = "指纹：";

// ── fingerprint helpers ────────────────────────────────────────────────────────────────────────────────

/** git blob hash of a file's content — replicate `git hash-object` (sha1 of "blob <len>\0" + bytes). */
export function gitBlobHash(content: string | Buffer): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

/** Compute the expected fingerprint for the preference file under `root`. */
export function expectedFingerprint(root: string, preferenceRel: string = PREFERENCE_FILE_REL): string {
  return gitBlobHash(fs.readFileSync(path.join(root, preferenceRel)));
}

// ── leak baseline ─────────────────────────────────────────────────────────────────────────────────────

/** Strip markdown syntax + whitespace so a leaked line survives line-wrap / emphasis drift. */
export function normalizeLeakLine(line: string): string {
  return line.replace(/[\s\-*_>`#[\]()|]/g, "");
}

/**
 * The preference file's DISTINCTIVE content lines — the leak baseline. A notification that carries any
 * of these lines (normalized) is carrying 倾向内容本身 ⇒ RED. Headings / blockquotes / rules / pure
 * list markers are structure, not content, so they are excluded.
 */
export function preferenceContentLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (/^#/.test(line)) continue; // headings
    if (/^>/.test(line)) continue; // blockquotes
    if (/^-{3,}$/.test(line)) continue; // horizontal rules
    if (!/[一-鿿]/.test(line)) continue; // must carry CJK content (the preference file is Chinese prose)
    const norm = normalizeLeakLine(line);
    if (norm.length >= LEAK_LINE_MIN_CHARS) out.push(norm);
  }
  return out;
}

// ── notification judgment ─────────────────────────────────────────────────────────────────────────────

export interface NotificationVerdict {
  ok: boolean;
  notice: boolean;
  fingerprints: string[];
  fingerprintMatchesReal: boolean;
  leakLines: string[];
  why: string;
}

/**
 * Judge ONE notification text against the AC57 contract. Pure — no I/O.
 *
 * @param notification        the notification text (the exact SendMessage payload / a log record).
 * @param preferenceText      the preference file's text — source of the leak baseline.
 * @param expectedFingerprint the current preference file's git blob hash — the fingerprint a
 *                            notification must carry (DoD: "通知引用的是 AC54 文件的指纹").
 */
export function checkNotificationText(
  notification: string,
  preferenceText: string,
  expectedFingerprint: string,
): NotificationVerdict {
  const notice = notification.includes(NOTICE_PHRASE);
  const fingerprints = notification.match(FINGERPRINT_RE) ?? [];
  const fingerprintMatchesReal = fingerprints.includes(expectedFingerprint);
  const normNotification = normalizeLeakLine(notification);
  const leakLines = preferenceContentLines(preferenceText).filter((line) => normNotification.includes(line));

  const ok = notice && fingerprintMatchesReal && leakLines.length === 0;
  const reasons: string[] = [];
  if (!notice) reasons.push("missing notice phrase (「倾向变了，去重读」)");
  if (!fingerprintMatchesReal) {
    if (fingerprints.length === 0) reasons.push("no fingerprint token");
    else reasons.push(`fingerprint ${fingerprints.join("/")} does not match the preference file's current git blob hash (${expectedFingerprint})`);
  }
  if (leakLines.length > 0) reasons.push(`leaks preference content (${leakLines.length} content line(s) present)`);

  return { ok, notice, fingerprints, fingerprintMatchesReal, leakLines, why: reasons.join("; ") || "ok" };
}

// ── notification-log parsing (the send-side trace carrier) ─────────────────────────────────────────────

export interface LogRecord {
  heading: string;
  text: string;
}

/**
 * Extract records from the log's `## 留痕记录` section. A record is the block under a `### <heading>`
 * line, running to the next `### `/`## ` heading or EOF. The record's notification text is that block
 * MINUS the heading line. Returns [] when the records section is absent (no records yet).
 */
export function parseNotificationRecords(logText: string): LogRecord[] {
  const lines = logText.split(/\r?\n/);
  const records: LogRecord[] = [];
  let inRecords = false;
  let current: { heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed)) {
      // section boundary — entering/exiting the records section
      if (trimmed === LOG_RECORDS_SECTION) {
        inRecords = true;
        current = null;
        continue;
      }
      if (inRecords) {
        // a `## ` heading inside/after the records section ends it
        inRecords = false;
        current = null;
        continue;
      }
      continue;
    }
    if (inRecords && /^###\s+/.test(trimmed)) {
      if (current) records.push({ heading: current.heading, text: current.body.join("\n").trim() });
      current = { heading: trimmed, body: [] };
      continue;
    }
    if (inRecords && current) {
      current.body.push(line);
    }
  }
  if (current) records.push({ heading: current.heading, text: current.body.join("\n").trim() });
  return records;
}

export interface LogVerdict {
  ok: boolean;
  fileExists: boolean;
  templateSectionOk: boolean;
  recordsSectionOk: boolean;
  recordCount: number;
  recordVerdicts: NotificationVerdict[];
  why: string;
}

/**
 * Judge the REAL notification log (send-side trace carrier) under `root`. Verifies:
 *   (a) the log exists and its `## 通知模板` section documents the notice phrase + a `指纹：` line;
 *   (b) the `## 留痕记录` section exists and every record passes checkNotificationText.
 */
export function checkNotificationLog(root: string): LogVerdict {
  const logPath = path.join(root, NOTIFICATION_LOG_REL);
  const prefPath = path.join(root, PREFERENCE_FILE_REL);
  const missing: string[] = [];

  let logText: string;
  try {
    logText = fs.readFileSync(logPath, "utf8");
  } catch {
    missing.push(`notification log missing (${NOTIFICATION_LOG_REL})`);
    return {
      ok: false,
      fileExists: false,
      templateSectionOk: false,
      recordsSectionOk: false,
      recordCount: 0,
      recordVerdicts: [],
      why: missing.join("; "),
    };
  }

  let prefText: string;
  try {
    prefText = fs.readFileSync(prefPath, "utf8");
  } catch {
    missing.push(`preference file missing (${PREFERENCE_FILE_REL}) — cannot build the leak baseline`);
  }

  // (a) template section documents the notice + a fingerprint placeholder.
  const templateBlock = extractSectionBlock(logText, LOG_TEMPLATE_SECTION);
  let templateSectionOk = true;
  const templateProblems: string[] = [];
  if (!templateBlock) {
    templateSectionOk = false;
    templateProblems.push(`missing ${LOG_TEMPLATE_SECTION} section`);
  } else {
    if (!templateBlock.includes(NOTICE_PHRASE)) {
      templateSectionOk = false;
      templateProblems.push(`template section does not state the notice phrase (${NOTICE_PHRASE})`);
    }
    if (!templateBlock.includes(FINGERPRINT_LABEL)) {
      templateSectionOk = false;
      templateProblems.push(`template section does not document a ${FINGERPRINT_LABEL} fingerprint line`);
    }
  }
  if (!templateSectionOk) missing.push(`template problem: ${templateProblems.join("; ")}`);

  // (b) records section present + every record passes.
  const recordsSectionOk = logText.includes(LOG_RECORDS_SECTION);
  if (!recordsSectionOk) missing.push(`missing ${LOG_RECORDS_SECTION} section`);

  const records = parseNotificationRecords(logText);
  const recordVerdicts: NotificationVerdict[] = [];
  const badRecords: string[] = [];
  for (const rec of records) {
    const v = checkNotificationText(rec.text, prefText ?? "", expectedFingerprint(root));
    recordVerdicts.push(v);
    if (!v.ok) badRecords.push(`${rec.heading}: ${v.why}`);
  }
  if (badRecords.length > 0) missing.push(`${badRecords.length} record(s) violate AC57: ${badRecords.join(" | ")}`);

  return {
    ok: missing.length === 0,
    fileExists: true,
    templateSectionOk,
    recordsSectionOk,
    recordCount: records.length,
    recordVerdicts,
    why: missing.join("; ") || "ok",
  };
}

/** Extract the text between a `## <key>` heading and the next `## ` heading / EOF. */
export function extractSectionBlock(text: string, key: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === key);
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  let fileOverride: string | undefined;
  let textOverride: string | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = path.resolve(argv[++i] ?? ".");
    } else if (a === "--file") {
      fileOverride = argv[++i];
    } else if (a === "--text") {
      textOverride = argv[++i];
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "preference-notification-check — AC57 通知面检查器（倾向变更通知只通知不承载内容）\n" +
          "  --root <dir>    repo root (default: script dir ../..)\n" +
          "  --file <path>   explicit notification sample file (negative-control fixtures; checks ONLY the sample)\n" +
          "  --text <str>    inline notification sample\n" +
          "  --json          machine-readable output\n" +
          "no --file/--text: checks the REAL notification log (orchestration/preference-notification-log.md)\n" +
          "exit 0 = PASS; exit 1 = RED; exit 2 = usage",
      );
      return 0;
    } else {
      console.error(`preference-notification-check: unknown argument: ${a}`);
      return 2;
    }
  }

  if (fileOverride && textOverride) {
    console.error("preference-notification-check: --file and --text are mutually exclusive");
    return 2;
  }

  if (fileOverride) {
    let text: string;
    try {
      text = fs.readFileSync(path.resolve(root, fileOverride), "utf8");
    } catch (err) {
      console.error(`preference-notification-check: cannot read sample file: ${fileOverride}`);
      return 2;
    }
    return emitVerdict(checkNotificationText(text, readPrefOrEmpty(root), safeFingerprint(root)), json, "notification sample", path.resolve(root, fileOverride));
  }

  if (textOverride !== undefined) {
    return emitVerdict(checkNotificationText(textOverride, readPrefOrEmpty(root), safeFingerprint(root)), json, "notification sample", "--text");
  }

  // Real-log path.
  const v = checkNotificationLog(root);
  if (json) {
    console.log(JSON.stringify(v, null, 2));
  } else if (v.ok) {
    console.log(`PASS: preference-notification log carrier valid (${NOTIFICATION_LOG_REL}) — template ok, ${v.recordCount} record(s), none leak preference content`);
  } else {
    console.error(`RED: preference-notification log carrier invalid: ${v.why}`);
  }
  return v.ok ? 0 : 1;
}

function readPrefOrEmpty(root: string): string {
  try {
    return fs.readFileSync(path.join(root, PREFERENCE_FILE_REL), "utf8");
  } catch {
    return "";
  }
}

function safeFingerprint(root: string): string {
  try {
    return expectedFingerprint(root);
  } catch {
    return "0000000000000000000000000000000000000000";
  }
}

function emitVerdict(v: NotificationVerdict, json: boolean, what: string, where: string): number {
  if (json) {
    console.log(JSON.stringify(v, null, 2));
  } else if (v.ok) {
    console.log(`PASS: ${what} (${where}) — notice + matching fingerprint, no preference content`);
  } else {
    console.error(`RED: ${what} (${where}) — ${v.why}`);
    for (const leak of v.leakLines) console.error(`  leak: …${leak.slice(0, 50)}…`);
  }
  return v.ok ? 0 : 1;
}

// Direct entry guard (gate-script-base convention): run main() only when this module is the entry point.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
