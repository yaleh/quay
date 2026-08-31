// @test-group engine
// preference-notification-check.test.mjs — AC57 通知面检查器测试
// (tasks/gap-ac57-preference-change-notification).
//
// AC57 义务（phase-goal 逐字）: 倾向变更的通知**不得包含倾向内容本身**，只说「倾向变了，去重读」+ 指纹。
// AC57 能取假（manager 7e7aa61b 补, AC49 判据1 标准）: 拿一条真实的倾向变更通知回放——若它携带了
// 倾向内容本身（而非仅"变了+去重读+指纹"）⇒ 必须报红。
// 可核载体（发送侧留痕, 落地方设计）: orchestration/preference-notification-log.md —— git 可见,
// 发送者把通知的确切文本逐字追加进「## 留痕记录」段; 检查器验证每条记录只含通知语+指纹且不含倾向内容。
//
// This file pins:
//   (a) the pure logic (plugin/scripts/preference-notification-check.ts) — git blob hash replication,
//       leak-baseline extraction, the notification verdict;
//   (b) AC1 — a notification built from the REAL template (notice + real preference fingerprint) is GREEN;
//   (c) AC2/AC3 — the NEGATIVE CONTROL: the same template PLUS a verbatim preference-content line
//       ⇒ MUST exit 1 (RED);
//   (d) the REAL notification log carrier is GREEN (template documented, records — if any — valid).
//
// Run:
//   scripts/test.sh plugin/test/preference-notification-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  NOTICE_PHRASE,
  NOTIFICATION_LOG_REL,
  PREFERENCE_FILE_REL,
  FINGERPRINT_RE,
  LEAK_LINE_MIN_CHARS,
  LOG_TEMPLATE_SECTION,
  LOG_RECORDS_SECTION,
  FINGERPRINT_LABEL,
  gitBlobHash,
  normalizeLeakLine,
  preferenceContentLines,
  checkNotificationText,
  parseNotificationRecords,
  extractSectionBlock,
} from "../scripts/preference-notification-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "preference-notification-check.ts");
const REAL_LOG = path.join(repoRoot, NOTIFICATION_LOG_REL);
const REAL_PREF = path.join(repoRoot, PREFERENCE_FILE_REL);

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("gitBlobHash replicates `git hash-object` for the real preference file", () => {
  const buf = fs.readFileSync(REAL_PREF);
  const nodeHash = gitBlobHash(buf);
  // Cross-check against the git binary (the AC54/AC55 canonical fingerprint source).
  const r = spawnSync("git", ["hash-object", REAL_PREF], { encoding: "utf8" });
  assert.equal(r.status, 0, "git hash-object must succeed");
  assert.equal(nodeHash, r.stdout.trim(), "Node git-blob-hash must match git hash-object");
});

test("NOTICE_PHRASE is the AC57 notice「倾向变了，去重读」", () => {
  assert.equal(NOTICE_PHRASE, "倾向变了，去重读");
});

test("normalizeLeakLine strips markdown syntax + whitespace", () => {
  assert.equal(normalizeLeakLine("- **红窗优先**：存在红色"), "红窗优先：存在红色");
  assert.equal(normalizeLeakLine("`label:gap` 任务优先"), "label:gap任务优先");
});

test("preferenceContentLines — extracts only substantive CJK content lines (no headings/blockquotes/rules)", () => {
  const text = [
    "# header",
    "> a blockquote",
    "---",
    "## 默认段",
    "manager 不在时生效（inner/outer 独立运行时回落到这一段）。",
    "- **红窗优先**：存在红色（失败）继承/未收敛红窗时，优先派发与其直接相关的任务。",
    "",
    "## 覆盖段",
    "manager 在时的当前倾向（本阶段优先）。",
  ].join("\n");
  const lines = preferenceContentLines(text);
  assert.ok(lines.length >= 3, `expected ≥3 substantive lines, got ${lines.length}: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => l.includes("红窗优先")), "must include the 红窗优先 policy line");
  assert.ok(lines.every((l) => l.length >= LEAK_LINE_MIN_CHARS));
});

test("checkNotificationText — a template-built notification (notice + real fingerprint) is OK", () => {
  const prefText = fs.readFileSync(REAL_PREF, "utf8");
  const fp = gitBlobHash(fs.readFileSync(REAL_PREF));
  const notification = `倾向变了，去重读\n重读正本：orchestration/dispatch-preference.md\n指纹：${fp}`;
  const v = checkNotificationText(notification, prefText, fp);
  assert.equal(v.ok, true, `must be OK:\n${JSON.stringify(v, null, 2)}`);
  assert.equal(v.notice, true);
  assert.equal(v.fingerprintMatchesReal, true);
  assert.deepEqual(v.leakLines, []);
});

test("checkNotificationText — missing the notice phrase ⇒ NOT ok", () => {
  const fp = gitBlobHash(fs.readFileSync(REAL_PREF));
  const v = checkNotificationText(`倾向已变化，请重新阅读\n指纹：${fp}`, "## 默认段\n内容。", fp);
  assert.equal(v.ok, false);
  assert.equal(v.notice, false);
});

test("checkNotificationText — a verbatim preference line in the notification ⇒ RED (leak)", () => {
  const prefText = fs.readFileSync(REAL_PREF, "utf8");
  const fp = gitBlobHash(fs.readFileSync(REAL_PREF));
  // The negative-control shape AC57 requires: the real template PLUS a verbatim content line.
  const notification = [
    NOTICE_PHRASE,
    "重读正本：orchestration/dispatch-preference.md",
    `指纹：${fp}`,
    "补充：红窗优先：存在红色（失败）继承/未收敛红窗时，优先派发与其直接相关的任务。",
  ].join("\n");
  const v = checkNotificationText(notification, prefText, fp);
  assert.equal(v.ok, false, "a notification carrying preference content must NOT be ok");
  assert.ok(v.leakLines.length >= 1, "must name at least one leaked content line");
});

test("parseNotificationRecords — extracts blocks under ### headings in the records section only", () => {
  const text = [
    "## 通知模板",
    NOTICE_PHRASE,
    `指纹：${FINGERPRINT_LABEL}placeholder`,
    "## 留痕记录",
    "### 2026-08-14T00:00:00Z → inner",
    NOTICE_PHRASE,
    "指纹：deadbeef",
    "### 2026-08-14T01:00:00Z → outer",
    NOTICE_PHRASE,
    "指纹：cafebabe",
    "",
  ].join("\n");
  const records = parseNotificationRecords(text);
  assert.equal(records.length, 2);
  assert.equal(records[0].heading, "### 2026-08-14T00:00:00Z → inner");
  assert.match(records[0].text, new RegExp(NOTICE_PHRASE));
  assert.match(records[0].text, /指纹：deadbeef/);
});

test("extractSectionBlock — returns the text under a ## heading up to the next ## / EOF", () => {
  const text = `## 通知模板\n\n${NOTICE_PHRASE}\n\n## 留痕记录\nnothing`;
  const block = extractSectionBlock(text, LOG_TEMPLATE_SECTION);
  assert.ok(block);
  assert.match(block, new RegExp(NOTICE_PHRASE));
  assert.doesNotMatch(block, /nothing/);
});

// ── real carrier (AC1 + real-log green) ────────────────────────────────────────────────────────────────

test("AC1 — the REAL template notification (notice + real fingerprint, no content) is GREEN", () => {
  const fp = gitBlobHash(fs.readFileSync(REAL_PREF));
  const notification = `${NOTICE_PHRASE}\n重读正本：${PREFERENCE_FILE_REL}\n指纹：${fp}`;
  const v = checkNotificationText(notification, fs.readFileSync(REAL_PREF, "utf8"), fp);
  assert.equal(v.ok, true, `the real template must pass:\n${JSON.stringify(v, null, 2)}`);
});

test("AC57 carrier — the REAL notification log is GREEN (template documented, records valid)", () => {
  assert.ok(fs.existsSync(REAL_LOG), `notification log must exist at ${NOTIFICATION_LOG_REL}`);
  assert.ok(!NOTIFICATION_LOG_REL.startsWith(".quay/"), "carrier must be git-visible (not under .quay/)");
  const logText = fs.readFileSync(REAL_LOG, "utf8");
  // (a) template section documents the notice + a fingerprint label
  const templateBlock = extractSectionBlock(logText, LOG_TEMPLATE_SECTION);
  assert.ok(templateBlock, `log must have ${LOG_TEMPLATE_SECTION}`);
  assert.match(templateBlock, new RegExp(NOTICE_PHRASE), "template section must state the notice phrase");
  assert.match(templateBlock, new RegExp(FINGERPRINT_LABEL), "template section must document a 指纹： line");
  // (b) records section present; every record passes checkNotificationText
  assert.ok(logText.includes(LOG_RECORDS_SECTION), `log must have ${LOG_RECORDS_SECTION}`);
  const records = parseNotificationRecords(logText);
  const fp = gitBlobHash(fs.readFileSync(REAL_PREF));
  const prefText = fs.readFileSync(REAL_PREF, "utf8");
  for (const rec of records) {
    const v = checkNotificationText(rec.text, prefText, fp);
    assert.equal(v.ok, true, `record ${rec.heading} must be AC57-clean:\n${JSON.stringify(v, null, 2)}`);
  }
});

// ── negative control (AC2/AC3 — the falsifiable half) ─────────────────────────────────────────────────

function runCheckCli(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, ...args], { encoding: "utf8" });
}

test("AC3 — negative control: real template + verbatim preference line ⇒ checker RED (exit 1)", () => {
  const fp = gitBlobHash(fs.readFileSync(REAL_PREF));
  // A real verbatim content line from the preference file, appended to the real template.
  const leakedNotification = [
    NOTICE_PHRASE,
    "重读正本：orchestration/dispatch-preference.md",
    `指纹：${fp}`,
    "补充：红窗优先：存在红色（失败）继承/未收敛红窗时，优先派发与其直接相关的任务。",
  ].join("\n");
  const r = runCheckCli(["--root", repoRoot, "--text", leakedNotification]);
  assert.equal(r.status, 1, `checker must exit 1 on a content-leaking notification:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /leak|红窗优先/, "RED output must name the leak");
});

test("AC2 — the SAME template WITHOUT the leaked line is GREEN (proves the red is the leak, not the shape)", () => {
  const fp = gitBlobHash(fs.readFileSync(REAL_PREF));
  const clean = [NOTICE_PHRASE, "重读正本：orchestration/dispatch-preference.md", `指纹：${fp}`].join("\n");
  const r = runCheckCli(["--root", repoRoot, "--text", clean]);
  assert.equal(r.status, 0, `clean template must exit 0:\n${r.stdout}\n${r.stderr}`);
});

test("AC2 — a sample file with a leaked preference line ⇒ checker RED (--file path)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pref-notif-neg-"));
  // tmp-leak-pairing-check (gap-tmp-leak-...): every mkdtempSync MUST be paired with a cleanup.
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fp = gitBlobHash(fs.readFileSync(REAL_PREF));
  const leaked = [
    NOTICE_PHRASE,
    "重读正本：orchestration/dispatch-preference.md",
    `指纹：${fp}`,
    "泄露：manager 在时的当前倾向（本阶段优先）。",
  ].join("\n");
  const file = path.join(dir, "leaked.md");
  fs.writeFileSync(file, leaked, "utf8");
  const r = runCheckCli(["--root", repoRoot, "--file", file]);
  assert.equal(r.status, 1, `checker must exit 1 on a leaked --file sample:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /leak|当前倾向/, "RED output must name the leak");
});
