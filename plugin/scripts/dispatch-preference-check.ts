// dispatch-preference-check.ts — AC54 判据1/判据2 检查器（tasks/gap-ac54-dispatch-preference-file）。
//
// The dispatch-preference file (orchestration/dispatch-preference.md) is the single git-visible
// source of "who inner should dispatch first" (SPEC-dispatch-ordering-semantic-2026-08-13 §4.4).
// The mechanism answers "CAN we dispatch"; inner answers "WHO first"; this file carries the
// semantic tendency inner selects by. AC54 判据1: the file must be git-visible (NOT under the
// gitignored .quay/) AND carry all three sections — 默认段 (default, effective when manager is
// absent) / 覆盖段 (override, current preference when manager is present) / 维护者字段 (who updates).
// AC54 判据2 (falsifiable, negative control by the implementer): deleting ANY one section ⇒ this
// checker must go RED. A checker that has never gone red on a missing-section sample doesn't count.
//
// Why all three (SPEC §4.4): without the default + maintainer sections, once the manager disappears
// the file becomes an orphan — content survives, nobody updates it, and inner still dispatches by
// it. That is exactly "written things outliving their premise".
//
// A CHECKER, not a writer: it reads the preference file and reports PASS/RED. It never writes to the
// preference file. The AC55 fingerprint source (git blob hash of this file) is computed by AC55's
// dispatch-record writer via `git hash-object` — this checker only guarantees the three-section shape
// that fingerprint points at.
//
// Run:
//   node --experimental-strip-types plugin/scripts/dispatch-preference-check.ts [--root <dir>] [--json]
//   node --experimental-strip-types plugin/scripts/dispatch-preference-check.ts --file <path> [--json]
//     (--file: check an explicit sample — used by the negative-control fixtures, one section deleted)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

// The preference file's repo-relative path (implementation surface's call; SPEC §7 doesn't prescribe).
export const PREFERENCE_FILE_REL = "orchestration/dispatch-preference.md";

// The three required section headings (exact line, no suffix — the file's own shape choice).
export const DEFAULT_SECTION = "默认段";
export const OVERRIDE_SECTION = "覆盖段";
export const MAINTAINER_SECTION = "维护者字段";
export const REQUIRED_SECTIONS = [DEFAULT_SECTION, OVERRIDE_SECTION, MAINTAINER_SECTION];

// A section must carry at least this many non-whitespace chars of content after its heading, or it
// is treated as ABSENT (an empty heading must not read as a present section — the empty-vs-absent
// conflation would let "delete the content, keep the heading" slip through RED).
export const SECTION_MIN_CONTENT_CHARS = 10;

/** Find the line index of an exact `## <key>` heading (case-sensitive, whole line). */
export function findHeadingLine(text: string, key: string): number {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `## ${key}`) return i;
  }
  return -1;
}

/**
 * Extract a section's content: the text between its `## <key>` heading and the next `## ` heading
 * (or EOF). Returns null when the heading is absent. Non-whitespace char count < the min bar is
 * reported as `empty` by checkSection.
 */
export function extractSectionContent(text: string, key: string): { content: string; headingLine: number } | null {
  const line = findHeadingLine(text, key);
  if (line === -1) return null;
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = line + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return { content: out.join("\n"), headingLine: line };
}

export interface SectionVerdict {
  section: string;
  ok: boolean;
  why: "heading-absent" | "content-too-thin" | "ok";
  contentChars: number;
}

export interface PreferenceCheckResult {
  ok: boolean;
  fileExists: boolean;
  filePath: string;
  sections: SectionVerdict[];
  missing: string[];
}

/**
 * Judge a preference-file text against the three-section contract. Pure — no I/O.
 * A section is ok only when its heading is present AND its content is at least
 * SECTION_MIN_CONTENT_CHARS non-whitespace chars. Any section missing/thin ⇒ ok:false.
 */
export function checkPreferenceText(text: string, filePath: string): PreferenceCheckResult {
  const sections: SectionVerdict[] = [];
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
      contentChars: chars,
    });
  }
  const missing = sections.filter((s) => !s.ok).map((s) => s.section);
  return { ok: missing.length === 0, fileExists: true, filePath, sections, missing };
}

/** Resolve the preference file path: --file wins; otherwise <root>/orchestration/dispatch-preference.md. */
export function resolvePreferencePath(root: string, fileOverride?: string): string {
  if (fileOverride) return path.resolve(root, fileOverride);
  return path.join(root, PREFERENCE_FILE_REL);
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  let fileOverride: string | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = path.resolve(argv[++i] ?? ".");
    } else if (a === "--file") {
      fileOverride = argv[++i];
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "dispatch-preference-check — AC54 倾向文件三段检查\n" +
          "  --root <dir>    repo root (default: script dir ../..)\n" +
          "  --file <path>   explicit sample path (negative-control fixtures; overrides root)\n" +
          "  --json          machine-readable output\n" +
          "exit 0 = all three sections present; exit 1 = any missing/thin (RED)",
      );
      return 0;
    } else {
      console.error(`dispatch-preference-check: unknown argument: ${a}`);
      return 2;
    }
  }

  const filePath = resolvePreferencePath(root, fileOverride);
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    const result: PreferenceCheckResult = {
      ok: false,
      fileExists: false,
      filePath,
      sections: REQUIRED_SECTIONS.map((s) => ({ section: s, ok: false, why: "heading-absent", contentChars: 0 })),
      missing: [...REQUIRED_SECTIONS],
    };
    if (json) {
      console.log(JSON.stringify(result, null, 2));
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

// Direct entry guard (gate-script-base convention): run main() only when this module is the entry point.
// ⛔ 必须走共享机制，⛔ 不手搓 file-identity 比较：`realpath(argv[1]) === import.meta.url` 在【被打包进
// 别的入口】时对每个 inlined 模块都为真（它们共享 bundle 的 import.meta.url），于是本模块的 main()
// 会在别的工具启动时抢跑（实测：它是 goal-driver / meta-driver 两个 dist bundle 里第一个为真的守卫，
// 使这两个例程型 driver 每轮只跑本模块就 exit 0，supervisor 因此每 5s 重启一次，
// drivers.yml 声明的 interval_ms 从未进入节奏）——gap-drivers-yml-interval-not-honored-for-routine-kinds。
if (isDirectEntry(import.meta, undefined, "dispatch-preference-check")) {
  process.exitCode = main(process.argv.slice(2));
}
