// quay Core: ADR (Architecture Decision Record) store — a SEPARATE object kind
// from tasks (a Provider's own store, e.g. quay-native's store.js). An ADR is
// NOT a task: it has a DECISION lifecycle (proposed→accepted→superseded/
// deprecated, or rejected), never todo→done; it has NO parent/children/role;
// its id is a flat global ADR-NNN. A task is one-shot (executed once, then
// done); an ADR is a standing decision continuously applied.
//
// This store is deliberately independent of any task store (no shared task
// vocabulary): the ~5 lines of frontmatter parse/serialize are trivial, not
// load-bearing logic. It is a generic filesystem-frontmatter store with no
// dependency on a Provider's internals, so it lives in Core (`quay`), not a
// Provider package — a Provider that wants it (e.g. quay-native's own CLI/MCP
// verbs) imports it back as a declared dependency, never the reverse. The
// generic frontmatter/lock/filename plumbing IS shared, via
// frontmatter-store-base.js, with the sibling document-store.js — only the
// SCHEMA (valid statuses, owned frontmatter keys, view-model shape) stays
// independent per kind; see that module's header comment for why.
//
// ADR view-model: { id, title, status, date, supersedes, supersededBy, tags, body, updatedAt }
// Reserved (round-tripped verbatim, not yet consumed — next-pass enforcement):
//   applies-to (scope globs), enforcement (named quay gate `adr-<id>`).

import fs from "node:fs";
import path from "node:path";
import {
  parseFrontmatter,
  serializeFrontmatter,
  fileNameForId as sharedFileNameForId,
  withFileLock,
  slugify,
  makeAssertSafeStatus,
} from "./frontmatter-store-base.ts";
import { commitStoreWrite, resolveGitRoot, type CommitOutcome } from "./store-commit.ts";

export const VALID_ADR_STATUSES = ["proposed", "accepted", "superseded", "deprecated", "rejected"];

const ADR_ID_RE = /^ADR-\d{3,}$/;

// Frontmatter keys the view-model owns explicitly; everything else in the
// frontmatter (applies-to, enforcement, any future field) is preserved verbatim.
const OWNED_KEYS = new Set(["id", "title", "status", "date", "supersedes", "superseded-by", "tags"]);

interface AdrFrontmatter {
  [key: string]: unknown;
  id?: string;
  title?: string;
  status?: string;
  date?: string | null;
  supersedes?: string[];
  "superseded-by"?: string[];
  tags?: string[];
  "applies-to"?: string[];
  enforcement?: unknown;
}

interface AdrFilter {
  status?: string;
  tag?: string;
  appliesTo?: string;
}

interface AdrViewModel {
  id: unknown;
  title: unknown;
  status: unknown;
  date: unknown;
  supersedes: unknown;
  supersededBy: unknown;
  tags: unknown[];
  appliesTo: unknown;
  enforcement: unknown;
  body: string;
  updatedAt?: number;
}

/**
 * @param {string} adrDir absolute path to the ADR directory (sibling of tasks/)
 */
export function createAdrStore(adrDir: string) {
  fs.mkdirSync(adrDir, { recursive: true });

  function assertSafeId(id: string) {
    if (typeof id !== "string" || !ADR_ID_RE.test(id)) {
      throw new Error(`invalid ADR id ${JSON.stringify(id)}: must match ADR-NNN (>=3 digits)`);
    }
    return id;
  }

  const assertSafeStatus = makeAssertSafeStatus("ADR", VALID_ADR_STATUSES);

  // Files are `ADR-NNN-<slug>.md` but the logical id is `ADR-NNN`. Resolve the
  // on-disk filename for an id by exact or `<id>-` prefix match (the dash
  // delimiter prevents ADR-001 from matching ADR-0011) — shared helper.
  function fileNameForId(id: string) {
    return sharedFileNameForId(adrDir, id);
  }

  function withLock(id: string, fn: () => unknown) {
    return withFileLock(adrDir, id, fn);
  }

  function parse(raw: string) {
    try {
      return parseFrontmatter(raw);
    } catch {
      throw new Error("malformed ADR file: missing YAML frontmatter block");
    }
  }

  function serialize(frontmatter: AdrFrontmatter, body: string) {
    return serializeFrontmatter(frontmatter, body);
  }

  function toViewModel(frontmatter: AdrFrontmatter, body: string, updatedAt?: number): AdrViewModel {
    const vm: AdrViewModel = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      date: frontmatter.date ?? null,
      supersedes: frontmatter.supersedes ?? [],
      supersededBy: frontmatter["superseded-by"] ?? [],
      tags: frontmatter.tags ?? [],
      // Surface the applies-to/enforcement fields reserved above (round-tripped
      // verbatim, previously unconsumed) — the "continuously applied" half.
      // Additive/non-breaking: absent → empty array / undefined, same
      // safe-default shape as supersedes/tags above.
      appliesTo: frontmatter["applies-to"] ?? [],
      enforcement: frontmatter.enforcement,
      body,
    };
    if (updatedAt !== undefined) vm.updatedAt = updatedAt;
    return vm;
  }

  // E3: minimal glob matcher for the `applies-to` consult surface — reuses Node's
  // built-in path.matchesGlob (no new dependency). Match if ANY of the ADR's
  // applies-to globs matches the given path.
  function appliesToMatches(appliesTo: unknown, targetPath: string) {
    if (!Array.isArray(appliesTo) || appliesTo.length === 0) return false;
    return appliesTo.some((glob) => {
      try {
        return (path as unknown as { matchesGlob(p: string, g: string): boolean }).matchesGlob(targetPath, glob);
      } catch {
        return false;
      }
    });
  }

  function get(id: string) {
    assertSafeId(id);
    const file = fileNameForId(id);
    if (!file) return null;
    const p = path.join(adrDir, file);
    const { frontmatter, body } = parse(fs.readFileSync(p, "utf8"));
    let updatedAt: number | undefined;
    try {
      updatedAt = fs.statSync(p).mtimeMs;
    } catch { /* omit */ }
    return toViewModel(frontmatter as AdrFrontmatter, body, updatedAt);
  }

  function list(filter: AdrFilter = {}) {
    return fs
      .readdirSync(adrDir)
      .filter((f) => f.endsWith(".md") && f.startsWith("ADR-"))
      .map((f) => {
        const { frontmatter, body } = parse(fs.readFileSync(path.join(adrDir, f), "utf8"));
        return toViewModel(frontmatter as AdrFrontmatter, body, fs.statSync(path.join(adrDir, f)).mtimeMs);
      })
      .filter((a) => (filter.status ? a.status === filter.status : true))
      .filter((a) => (filter.tag ? (a.tags || []).includes(filter.tag) : true))
      .filter((a) => (filter.appliesTo ? appliesToMatches(a.appliesTo, filter.appliesTo) : true))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  function write(id: string, { title, status, date, supersedes, supersededBy, tags, body }: {
    title?: string;
    status?: string;
    date?: string;
    supersedes?: string[];
    supersededBy?: string[];
    tags?: string[];
    body?: string;
  }) {
    assertSafeId(id);
    assertSafeStatus(status);
    return withLock(id, () => {
      const existingFile = fileNameForId(id);
      let frontmatter: AdrFrontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parse(fs.readFileSync(path.join(adrDir, existingFile), "utf8"));
        frontmatter = { ...parsed.frontmatter } as AdrFrontmatter;
        existingBody = parsed.body;
      }
      // Apply owned fields (preserving any reserved/unknown frontmatter keys).
      frontmatter.id = id;
      if (title !== undefined) frontmatter.title = title;
      const prevStatus = typeof frontmatter.status === "string" ? frontmatter.status : undefined;
      frontmatter.status = status ?? frontmatter.status ?? "proposed";
      if (date !== undefined) frontmatter.date = date;
      if (supersedes !== undefined) frontmatter.supersedes = supersedes;
      if (supersededBy !== undefined) frontmatter["superseded-by"] = supersededBy;
      if (tags !== undefined) frontmatter.tags = tags;
      // Order owned keys first for readable files; keep reserved keys after.
      const ordered: AdrFrontmatter = {};
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
      // Action semantics (gap-store-commit-action-and-actor AC1): create / status flip / field
      // update are distinguishable in the commit subject — never fixed prose.
      const action = !existingFile
        ? "create"
        : (prevStatus !== undefined && prevStatus !== frontmatter.status ? `status ${prevStatus}→${frontmatter.status}` : "update");
      commitAdrFile(adrDir, fileName, id, action);
      return get(id);
    });
  }

  return { list, get, write };
}

/**
 * COMMIT-AFTER-WRITE (SPEC-store-commit-unification §4, 人 2026-09-08 裁定 2): ADRs previously had
 * NO commit path (writes were invisible to git until a session-end sweep). Now delegated to the
 * shared primitive `commitStoreWrite` — ⛔ no git plumbing here. Default `propagate: "none"`: an
 * ADR write rides the branch it lands on.
 */
function commitAdrFile(adrDir: string, fileName: string, id: string, action: string): CommitOutcome {
  const root = resolveGitRoot(adrDir);
  return commitStoreWrite({
    relPath: root ? path.relative(root, path.join(adrDir, fileName)) : `adr/${fileName}`,
    kind: "adr",
    id,
    action,
    root,
    propagate: "none",
  }).outcome;
}
