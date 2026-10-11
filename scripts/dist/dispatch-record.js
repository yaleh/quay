import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/dispatch-record.ts
import fs2 from "node:fs";
import path3 from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/dispatch-preference-check.ts
import fs from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
var PREFERENCE_FILE_REL = "orchestration/dispatch-preference.md";
var DEFAULT_SECTION = "\u9ED8\u8BA4\u6BB5";
var OVERRIDE_SECTION = "\u8986\u76D6\u6BB5";
var MAINTAINER_SECTION = "\u7EF4\u62A4\u8005\u5B57\u6BB5";
var REQUIRED_SECTIONS = [DEFAULT_SECTION, OVERRIDE_SECTION, MAINTAINER_SECTION];
var SECTION_MIN_CONTENT_CHARS = 10;
function findHeadingLine(text, key) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `## ${key}`) return i;
  }
  return -1;
}
function extractSectionContent(text, key) {
  const line = findHeadingLine(text, key);
  if (line === -1) return null;
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = line + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return { content: out.join("\n"), headingLine: line };
}
function checkPreferenceText(text, filePath) {
  const sections = [];
  for (const key of REQUIRED_SECTIONS) {
    const found = extractSectionContent(text, key);
    if (!found) {
      sections.push({ section: key, ok: false, why: "heading-absent", contentChars: 0 });
      continue;
    }
    const chars = found.content.replace(/\s+/g, "").length;
    sections.push({
      section: key,
      ok: chars >= SECTION_MIN_CONTENT_CHARS,
      why: chars >= SECTION_MIN_CONTENT_CHARS ? "ok" : "content-too-thin",
      contentChars: chars
    });
  }
  const missing = sections.filter((s) => !s.ok).map((s) => s.section);
  return { ok: missing.length === 0, fileExists: true, filePath, sections, missing };
}
function resolvePreferencePath(root, fileOverride) {
  if (fileOverride) return path2.resolve(root, fileOverride);
  return path2.join(root, PREFERENCE_FILE_REL);
}
function main(argv) {
  let root = path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "..", "..");
  let fileOverride;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = path2.resolve(argv[++i] ?? ".");
    } else if (a === "--file") {
      fileOverride = argv[++i];
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "dispatch-preference-check \u2014 AC54 \u503E\u5411\u6587\u4EF6\u4E09\u6BB5\u68C0\u67E5\n  --root <dir>    repo root (default: script dir ../..)\n  --file <path>   explicit sample path (negative-control fixtures; overrides root)\n  --json          machine-readable output\nexit 0 = all three sections present; exit 1 = any missing/thin (RED)"
      );
      return 0;
    } else {
      console.error(`dispatch-preference-check: unknown argument: ${a}`);
      return 2;
    }
  }
  const filePath = resolvePreferencePath(root, fileOverride);
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    const result2 = {
      ok: false,
      fileExists: false,
      filePath,
      sections: REQUIRED_SECTIONS.map((s) => ({ section: s, ok: false, why: "heading-absent", contentChars: 0 })),
      missing: [...REQUIRED_SECTIONS]
    };
    if (json) {
      console.log(JSON.stringify(result2, null, 2));
    } else {
      console.error(`RED: preference file not found: ${filePath}`);
      console.error(`  missing sections: ${REQUIRED_SECTIONS.join(", ")}`);
    }
    return 1;
  }
  const result = checkPreferenceText(text, filePath);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`PASS: dispatch-preference file has all three sections: ${REQUIRED_SECTIONS.join(" / ")} (${filePath})`);
  } else {
    console.error(`RED: dispatch-preference file is missing/thin sections: ${result.missing.join(", ")} (${filePath})`);
    for (const s of result.sections) {
      if (!s.ok) console.error(`  - ${s.section}: ${s.why} (contentChars=${s.contentChars})`);
    }
  }
  return result.ok ? 0 : 1;
}
if (isDirectEntry(import.meta, void 0, "dispatch-preference-check")) {
  process.exitCode = main(process.argv.slice(2));
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/dispatch-record.ts
var RECORD_FILE_REL = "orchestration/dispatch-record.jsonl";
var MIN_REASON_CHARS = 8;
var FINGERPRINT_RE = /^[0-9a-f]{40}$/i;
function computePreferenceFingerprint(root) {
  const prefPath = path3.join(root, PREFERENCE_FILE_REL);
  if (!fs2.existsSync(prefPath)) return null;
  try {
    const out = execFileSync("git", ["hash-object", PREFERENCE_FILE_REL], {
      cwd: root,
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const hash = out.trim();
    return FINGERPRINT_RE.test(hash) ? hash : null;
  } catch {
    return null;
  }
}
function makeRecord({
  taskId,
  reason,
  fingerprint,
  ts = (/* @__PURE__ */ new Date()).toISOString(),
  preferenceFile = PREFERENCE_FILE_REL
}) {
  return { ts, taskId, preferenceFile, preferenceFingerprint: fingerprint, reason };
}
function reasonIsSubstantive(reason) {
  return typeof reason === "string" && reason.replace(/\s+/g, "").length >= MIN_REASON_CHARS;
}
function appendRecord(root, record) {
  const file = path3.join(root, RECORD_FILE_REL);
  fs2.mkdirSync(path3.dirname(file), { recursive: true });
  fs2.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  return file;
}
function main2(argv) {
  let root = path3.resolve(path3.dirname(fileURLToPath2(import.meta.url)), "..", "..");
  let taskId;
  let reason;
  let add = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = path3.resolve(argv[++i] ?? ".");
    } else if (a === "--add") {
      add = true;
    } else if (a === "--task-id") {
      taskId = argv[++i];
    } else if (a === "--reason") {
      reason = argv[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(
        'dispatch-record \u2014 AC55 \u6D3E\u53D1\u8BB0\u5F55\u5199\u5165\u70B9\uFF08\u6307\u7EB9 + \u4E00\u53E5\u7406\u7531\uFF09\n  --add --task-id <id> --reason "<\u4E00\u53E5\u4E3A\u4EC0\u4E48\u9009\u5B83>" [--root <dir>]\nexit 0 = appended; exit 1 = reason missing/thin (fail-closed); exit 2 = usage'
      );
      return 0;
    } else {
      console.error(`dispatch-record: unknown argument: ${a}`);
      return 2;
    }
  }
  if (!add) {
    console.error("dispatch-record: missing --add (this is the dispatch-record WRITER)");
    return 2;
  }
  if (!taskId || !taskId.trim()) {
    console.error("dispatch-record: --task-id is required");
    return 2;
  }
  if (!reasonIsSubstantive(reason)) {
    console.error(
      `RED: dispatch-record fail-closed \u2014 --reason is missing or below ${MIN_REASON_CHARS} non-whitespace chars. A dispatch record must carry a one-sentence \u4E3A\u4EC0\u4E48\u9009\u5B83 (SPEC \xA77: only WHAT was chosen, no per-non-choice reason).`
    );
    return 1;
  }
  const fingerprint = computePreferenceFingerprint(root);
  if (fingerprint === null) {
    console.error(
      `dispatch-record: WARNING \u2014 could not fingerprint ${PREFERENCE_FILE_REL} at ${root} (file absent or git unavailable); record appended with preferenceFingerprint:null and the dispatch-record-fingerprint-reason-check will go RED on it.`
    );
  }
  const record = makeRecord({ taskId: taskId.trim(), reason: reason.trim(), fingerprint });
  const file = appendRecord(root, record);
  console.log(
    `PASS: dispatch record appended (taskId=${record.taskId}, fingerprint=${record.preferenceFingerprint ?? "null"}, file=${file})`
  );
  return 0;
}
if (isDirectEntry(import.meta, void 0, "dispatch-record")) {
  process.exitCode = main2(process.argv.slice(2));
}
export {
  FINGERPRINT_RE,
  MIN_REASON_CHARS,
  RECORD_FILE_REL,
  appendRecord,
  computePreferenceFingerprint,
  main2 as main,
  makeRecord,
  reasonIsSubstantive
};
