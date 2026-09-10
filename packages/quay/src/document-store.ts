// quay Core: managed-document store ("quay DOCUMENT-MANAGEMENT capability").
// A "document" is a SEPARATE object kind from both tasks (a Provider's own
// store) and ADRs (adr-store.js): it is a managed METHOD ARTIFACT (a skill, a
// methodology doc, a template) with its OWN draft→active→retired lifecycle —
// NOT a decision (adr-store.js's proposed→accepted→superseded/deprecated/
// rejected) and NOT a task (no parent/children/role, no todo→done). Reuses the
// SAME generic frontmatter/lock/filename-resolution mechanics as adr-store.js
// via frontmatter-store-base.js — mechanics are shared, schemas are not
// (mirrors adr-store.js's own ADR/task separation rationale). Lives in Core
// (`quay`), not a Provider package, for the same reason as adr-store.js —
// see that module's header comment.
//
// The load-bearing NEW capability this store adds: a `contracts` field — a
// list of self-verifying assertions `{ target: "self", type: "grep"|
// "not-grep", pattern, description }` — round-tripped verbatim here (this
// store does not itself evaluate them; contract-validator.js, Stage 3, does).
//
// Document view-model: { id, title, status, kind, contracts, body, updatedAt }

import fs from "node:fs";
import path from "node:path";
import {
  parseFrontmatter,
  serializeFrontmatter,
  fileNameForId,
  withFileLock,
  slugify,
} from "./frontmatter-store-base.ts";
import { commitStoreWrite, resolveGitRoot, type CommitOutcome } from "./store-commit.ts";

export const VALID_DOCUMENT_STATUSES = ["draft", "active", "retired"];

const DOCUMENT_ID_RE = /^DOC-\d{3,}$/;

// Frontmatter keys the view-model owns explicitly; everything else is
// preserved verbatim (forward-compat, same discipline as adr-store.js).
const OWNED_KEYS = new Set(["id", "title", "status", "kind", "contracts"]);

interface DocFrontmatter {
  [key: string]: unknown;
  id?: string;
  title?: string;
  status?: string;
  kind?: string;
  contracts?: unknown[];
}

interface DocFilter {
  status?: string;
  kind?: string;
}

interface DocViewModel {
  id: unknown;
  title: unknown;
  status: unknown;
  kind: unknown;
  contracts: unknown[];
  body: string;
  updatedAt?: number;
}

/**
 * @param {string} docDir absolute path to the managed-documents directory
 */
export function createDocumentStore(docDir: string) {
  fs.mkdirSync(docDir, { recursive: true });

  function assertSafeId(id: string) {
    if (typeof id !== "string" || !DOCUMENT_ID_RE.test(id)) {
      throw new Error(`invalid document id ${JSON.stringify(id)}: must match DOC-NNN (>=3 digits)`);
    }
    return id;
  }

  function assertSafeStatus(status: string | undefined) {
    if (status !== undefined && !VALID_DOCUMENT_STATUSES.includes(status)) {
      throw new Error(
        `invalid document status "${status}" — must be one of ${VALID_DOCUMENT_STATUSES.join(", ")}`
      );
    }
  }

  function toViewModel(frontmatter: DocFrontmatter, body: string, updatedAt?: number): DocViewModel {
    const vm: DocViewModel = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      kind: frontmatter.kind,
      contracts: (frontmatter.contracts as unknown[]) ?? [],
      body,
    };
    if (updatedAt !== undefined) vm.updatedAt = updatedAt;
    return vm;
  }

  function get(id: string) {
    assertSafeId(id);
    const file = fileNameForId(docDir, id);
    if (!file) return null;
    const p = path.join(docDir, file);
    const { frontmatter, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
    let updatedAt: number | undefined;
    try {
      updatedAt = fs.statSync(p).mtimeMs;
    } catch { /* omit */ }
    return toViewModel(frontmatter as DocFrontmatter, body, updatedAt);
  }

  function list(filter: DocFilter = {}) {
    return fs
      .readdirSync(docDir)
      .filter((f) => f.endsWith(".md") && f.startsWith("DOC-"))
      .map((f) => {
        const { frontmatter, body } = parseFrontmatter(fs.readFileSync(path.join(docDir, f), "utf8"));
        return toViewModel(frontmatter as DocFrontmatter, body, fs.statSync(path.join(docDir, f)).mtimeMs);
      })
      .filter((d) => (filter.status ? d.status === filter.status : true))
      .filter((d) => (filter.kind ? d.kind === filter.kind : true))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  function write(id: string, { title, status, kind, contracts, body }: {
    title?: string;
    status?: string;
    kind?: string;
    contracts?: unknown[];
    body?: string;
  }) {
    assertSafeId(id);
    assertSafeStatus(status);
    return withFileLock(docDir, id, () => {
      const existingFile = fileNameForId(docDir, id);
      let frontmatter: DocFrontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parseFrontmatter(fs.readFileSync(path.join(docDir, existingFile), "utf8"));
        frontmatter = { ...parsed.frontmatter } as DocFrontmatter;
        existingBody = parsed.body;
      }
      frontmatter.id = id;
      if (title !== undefined) frontmatter.title = title;
      const prevStatus = typeof frontmatter.status === "string" ? frontmatter.status : undefined;
      frontmatter.status = status ?? frontmatter.status ?? "draft";
      if (kind !== undefined) frontmatter.kind = kind;
      if (contracts !== undefined) frontmatter.contracts = contracts;
      const ordered: DocFrontmatter = {};
      for (const k of ["id", "title", "status", "kind", "contracts"]) {
        if (frontmatter[k] !== undefined) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS.has(k)) ordered[k] = frontmatter[k];
      }
      const finalBody = body !== undefined ? body : existingBody;
      const fileName = existingFile ?? `${id}-${slugify(title, "doc")}.md`;
      fs.writeFileSync(path.join(docDir, fileName), serializeFrontmatter(ordered, finalBody), "utf8");
      // Action semantics (gap-store-commit-action-and-actor AC1): create / status flip / field
      // update are distinguishable in the commit subject — never fixed prose.
      const action = !existingFile
        ? "create"
        : (prevStatus !== undefined && prevStatus !== frontmatter.status ? `status ${prevStatus}→${frontmatter.status}` : "update");
      commitDocFile(docDir, fileName, id, action);
      return get(id);
    });
  }

  return { list, get, write };
}

/**
 * COMMIT-AFTER-WRITE (SPEC-store-commit-unification §4, 人 2026-09-08 裁定 2): docs-managed
 * previously had NO commit path (writes were invisible to git until a session-end sweep). Now
 * delegated to the shared primitive `commitStoreWrite` — ⛔ no git plumbing here. Default
 * `propagate: "none"`: a docs-managed write rides the branch it lands on.
 */
function commitDocFile(docDir: string, fileName: string, id: string, action: string): CommitOutcome {
  const root = resolveGitRoot(docDir);
  return commitStoreWrite({
    relPath: root ? path.relative(root, path.join(docDir, fileName)) : `docs-managed/${fileName}`,
    kind: "docs-managed",
    id,
    action,
    root,
    propagate: "none",
  }).outcome;
}
