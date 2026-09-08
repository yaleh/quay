// quay Core: shared frontmatter-store-base helper.
//
// Factored out of adr-store.js so a NEW sibling kind (document-store.js) can
// reuse the same parse/serialize/lockfile/filename-resolution mechanics
// WITHOUT coupling the two kinds' schemas together — each store still owns
// its own frontmatter keys, valid-status set, and view-model shape; only the
// generic "read/write a <id>[-<slug>].md file with a lockfile, safely" plumbing
// lives here. This mirrors adr-store.js's own header comment rationale for
// why ADR/task stores stay separate: shared MECHANICS, independent SCHEMAS.
//
// Every function here takes its target directory as an explicit parameter —
// no hardcoded `adr/`/`docs-managed/` path — so it is safely reusable by any
// number of sibling stores.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * Parse a raw file's `---\n<yaml>\n---\n<body>` shape.
 * @param {string} raw
 * @returns {{ frontmatter: object, body: string }}
 */
export function parseFrontmatter(raw) {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) throw new Error("malformed file: missing YAML frontmatter block");
  return { frontmatter: YAML.parse(m[1]) ?? {}, body: m[2] ?? "" };
}

/**
 * Serialize frontmatter + body back to the `---\n<yaml>\n---\n<body>` shape.
 * @param {object} frontmatter
 * @param {string} body
 * @returns {string}
 */
export function serializeFrontmatter(frontmatter, body) {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n${body}`;
}

/**
 * Lowercase, collapse non-alphanumeric runs to '-', trim leading/trailing '-',
 * cap at 60 chars; falls back to `fallback` (default "adr") when the title is
 * empty/undefined so callers never emit a blank slug segment.
 *
 * gap-frontmatter-slugify-drops-non-ascii: "alphanumeric" is Unicode-aware
 * ([\p{L}\p{N}\p{M}], CJK included) — the old `[^a-z0-9]+` class treated EVERY
 * non-ASCII letter as a separator, so a mostly-Chinese title collapsed to its
 * stray ASCII fragments (a 40-char title became "store-kind"). Only genuinely
 * non-word characters (path separators, control chars, whitespace, punctuation,
 * '.') now collapse to '-'; length stays capped at 60 chars (≤ 240 UTF-8 bytes,
 * safely under the 255-byte filename limit).
 * @param {string} title
 * @param {string} [fallback]
 * @returns {string}
 */
export function slugify(title, fallback = "adr") {
  return (
    String(title || "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/^-+|-+$/g, "") || fallback
  );
}

/**
 * Resolve the on-disk filename for a logical id within `dir`. Files are
 * `<id>-<slug>.md` but the logical id is `<id>`; matches `<id>.md` exactly or
 * `<id>-` as a prefix (the dash delimiter prevents e.g. `X-001` matching a
 * `X-0011-*.md` file). Returns null when no file matches.
 * @param {string} dir
 * @param {string} id
 * @returns {string|null}
 */
export function fileNameForId(dir, id) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files.find((f) => f === `${id}.md` || f.startsWith(`${id}-`)) ?? null;
}

const STALE_LOCK_MS = 5000;
const LOCK_TIMEOUT_MS = 3000;

/**
 * Run `fn` while holding an exclusive per-id lockfile inside `dir`
 * (`<dir>/<id>.lock`), recovering a stale lock (older than STALE_LOCK_MS) and
 * always releasing the lock afterward, even if `fn` throws.
 * @param {string} dir
 * @param {string} id
 * @param {() => any} fn
 * @returns {any}
 */
export function withFileLock(dir, id, fn) {
  const lockPath = path.join(dir, `${id}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out acquiring lock for ${id} in ${dir}`);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}
