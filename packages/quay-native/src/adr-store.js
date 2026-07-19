// quay-native: ADR (Architecture Decision Record) store — a SEPARATE object kind
// from tasks (store.js). An ADR is NOT a task: it has a DECISION lifecycle
// (proposed→accepted→superseded/deprecated, or rejected), never todo→done; it has
// NO parent/children/role; its id is a flat global ADR-NNN. A task is one-shot
// (executed once, then done); an ADR is a standing decision continuously applied.
//
// This store is deliberately independent of store.js (no shared task vocabulary):
// the ~5 lines of frontmatter parse/serialize are trivial, not load-bearing logic,
// and keeping the two stores separate is the whole point of the ADR/task split.
//
// ADR view-model: { id, title, status, date, supersedes, supersededBy, tags, body, updatedAt }
// Reserved (round-tripped verbatim, not yet consumed — next-pass enforcement):
//   applies-to (scope globs), enforcement (named quay gate `adr-<id>`).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const VALID_ADR_STATUSES = ["proposed", "accepted", "superseded", "deprecated", "rejected"];

const ADR_ID_RE = /^ADR-\d{3,}$/;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// Frontmatter keys the view-model owns explicitly; everything else in the
// frontmatter (applies-to, enforcement, any future field) is preserved verbatim.
const OWNED_KEYS = new Set(["id", "title", "status", "date", "supersedes", "superseded-by", "tags"]);

function slugify(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "adr";
}

/**
 * @param {string} adrDir absolute path to the ADR directory (sibling of tasks/)
 */
export function createAdrStore(adrDir) {
  fs.mkdirSync(adrDir, { recursive: true });

  function assertSafeId(id) {
    if (typeof id !== "string" || !ADR_ID_RE.test(id)) {
      throw new Error(`invalid ADR id ${JSON.stringify(id)}: must match ADR-NNN (>=3 digits)`);
    }
    return id;
  }

  function assertSafeStatus(status) {
    if (status !== undefined && !VALID_ADR_STATUSES.includes(status)) {
      throw new Error(`invalid ADR status "${status}" — must be one of ${VALID_ADR_STATUSES.join(", ")}`);
    }
  }

  // Files are `ADR-NNN-<slug>.md` but the logical id is `ADR-NNN`. Resolve the
  // on-disk filename for an id by exact or `<id>-` prefix match (the dash
  // delimiter prevents ADR-001 from matching ADR-0011).
  function fileNameForId(id) {
    const files = fs.readdirSync(adrDir).filter((f) => f.endsWith(".md"));
    return files.find((f) => f === `${id}.md` || f.startsWith(`${id}-`)) ?? null;
  }

  function lockPathFor(id) {
    return path.join(adrDir, `${id}.lock`);
  }

  const STALE_LOCK_MS = 5000;
  const LOCK_TIMEOUT_MS = 3000;

  function withLock(id, fn) {
    const lockPath = lockPathFor(id);
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
        if (Date.now() > deadline) throw new Error(`timed out acquiring ADR lock for ${id}`);
      }
    }
    try {
      return fn();
    } finally {
      fs.rmSync(lockPath, { force: true });
    }
  }

  function parse(raw) {
    const m = FRONTMATTER_RE.exec(raw);
    if (!m) throw new Error("malformed ADR file: missing YAML frontmatter block");
    return { frontmatter: YAML.parse(m[1]) ?? {}, body: m[2] ?? "" };
  }

  function serialize(frontmatter, body) {
    return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n${body}`;
  }

  function toViewModel(frontmatter, body, updatedAt) {
    const vm = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      date: frontmatter.date ?? null,
      supersedes: frontmatter.supersedes ?? [],
      supersededBy: frontmatter["superseded-by"] ?? [],
      tags: frontmatter.tags ?? [],
      body,
    };
    if (updatedAt !== undefined) vm.updatedAt = updatedAt;
    return vm;
  }

  function get(id) {
    assertSafeId(id);
    const file = fileNameForId(id);
    if (!file) return null;
    const p = path.join(adrDir, file);
    const { frontmatter, body } = parse(fs.readFileSync(p, "utf8"));
    let updatedAt;
    try {
      updatedAt = fs.statSync(p).mtimeMs;
    } catch { /* omit */ }
    return toViewModel(frontmatter, body, updatedAt);
  }

  function list(filter = {}) {
    return fs
      .readdirSync(adrDir)
      .filter((f) => f.endsWith(".md") && f.startsWith("ADR-"))
      .map((f) => {
        const { frontmatter, body } = parse(fs.readFileSync(path.join(adrDir, f), "utf8"));
        return toViewModel(frontmatter, body, fs.statSync(path.join(adrDir, f)).mtimeMs);
      })
      .filter((a) => (filter.status ? a.status === filter.status : true))
      .filter((a) => (filter.tag ? (a.tags || []).includes(filter.tag) : true))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  function write(id, { title, status, date, supersedes, supersededBy, tags, body }) {
    assertSafeId(id);
    assertSafeStatus(status);
    return withLock(id, () => {
      const existingFile = fileNameForId(id);
      let frontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parse(fs.readFileSync(path.join(adrDir, existingFile), "utf8"));
        frontmatter = { ...parsed.frontmatter };
        existingBody = parsed.body;
      }
      // Apply owned fields (preserving any reserved/unknown frontmatter keys).
      frontmatter.id = id;
      if (title !== undefined) frontmatter.title = title;
      frontmatter.status = status ?? frontmatter.status ?? "proposed";
      if (date !== undefined) frontmatter.date = date;
      if (supersedes !== undefined) frontmatter.supersedes = supersedes;
      if (supersededBy !== undefined) frontmatter["superseded-by"] = supersededBy;
      if (tags !== undefined) frontmatter.tags = tags;
      // Order owned keys first for readable files; keep reserved keys after.
      const ordered = {};
      for (const k of ["id", "title", "status", "date", "supersedes", "superseded-by", "tags"]) {
        if (frontmatter[k] !== undefined) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS.has(k)) ordered[k] = frontmatter[k];
      }
      const finalBody = body !== undefined ? body : existingBody;
      // Keep the existing filename on edit (no orphan); derive a slug on create.
      const fileName = existingFile ?? `${id}-${slugify(title)}.md`;
      fs.writeFileSync(path.join(adrDir, fileName), serialize(ordered, finalBody), "utf8");
      return get(id);
    });
  }

  return { list, get, write };
}
