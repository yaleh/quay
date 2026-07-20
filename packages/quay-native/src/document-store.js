// quay-native: managed-document store (Stage 2, exp5-M-CRYST-D1 / D1
// "quay DOCUMENT-MANAGEMENT capability"). A "document" is a SEPARATE object
// kind from both tasks (store.js) and ADRs (adr-store.js): it is a managed
// METHOD ARTIFACT (a skill, a methodology doc, a template) with its OWN
// draft→active→retired lifecycle — NOT a decision (adr-store.js's
// proposed→accepted→superseded/deprecated/rejected) and NOT a task (no
// parent/children/role, no todo→done). Reuses the SAME generic frontmatter/
// lock/filename-resolution mechanics as adr-store.js via
// frontmatter-store-base.js (Stage 1) — mechanics are shared, schemas are not
// (mirrors adr-store.js's own ADR/task separation rationale).
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
} from "./frontmatter-store-base.js";

export const VALID_DOCUMENT_STATUSES = ["draft", "active", "retired"];

const DOCUMENT_ID_RE = /^DOC-\d{3,}$/;

// Frontmatter keys the view-model owns explicitly; everything else is
// preserved verbatim (forward-compat, same discipline as adr-store.js).
const OWNED_KEYS = new Set(["id", "title", "status", "kind", "contracts"]);

/**
 * @param {string} docDir absolute path to the managed-documents directory
 */
export function createDocumentStore(docDir) {
  fs.mkdirSync(docDir, { recursive: true });

  function assertSafeId(id) {
    if (typeof id !== "string" || !DOCUMENT_ID_RE.test(id)) {
      throw new Error(`invalid document id ${JSON.stringify(id)}: must match DOC-NNN (>=3 digits)`);
    }
    return id;
  }

  function assertSafeStatus(status) {
    if (status !== undefined && !VALID_DOCUMENT_STATUSES.includes(status)) {
      throw new Error(
        `invalid document status "${status}" — must be one of ${VALID_DOCUMENT_STATUSES.join(", ")}`
      );
    }
  }

  function toViewModel(frontmatter, body, updatedAt) {
    const vm = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      kind: frontmatter.kind,
      contracts: frontmatter.contracts ?? [],
      body,
    };
    if (updatedAt !== undefined) vm.updatedAt = updatedAt;
    return vm;
  }

  function get(id) {
    assertSafeId(id);
    const file = fileNameForId(docDir, id);
    if (!file) return null;
    const p = path.join(docDir, file);
    const { frontmatter, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
    let updatedAt;
    try {
      updatedAt = fs.statSync(p).mtimeMs;
    } catch { /* omit */ }
    return toViewModel(frontmatter, body, updatedAt);
  }

  function list(filter = {}) {
    return fs
      .readdirSync(docDir)
      .filter((f) => f.endsWith(".md") && f.startsWith("DOC-"))
      .map((f) => {
        const { frontmatter, body } = parseFrontmatter(fs.readFileSync(path.join(docDir, f), "utf8"));
        return toViewModel(frontmatter, body, fs.statSync(path.join(docDir, f)).mtimeMs);
      })
      .filter((d) => (filter.status ? d.status === filter.status : true))
      .filter((d) => (filter.kind ? d.kind === filter.kind : true))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  function write(id, { title, status, kind, contracts, body }) {
    assertSafeId(id);
    assertSafeStatus(status);
    return withFileLock(docDir, id, () => {
      const existingFile = fileNameForId(docDir, id);
      let frontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parseFrontmatter(fs.readFileSync(path.join(docDir, existingFile), "utf8"));
        frontmatter = { ...parsed.frontmatter };
        existingBody = parsed.body;
      }
      frontmatter.id = id;
      if (title !== undefined) frontmatter.title = title;
      frontmatter.status = status ?? frontmatter.status ?? "draft";
      if (kind !== undefined) frontmatter.kind = kind;
      if (contracts !== undefined) frontmatter.contracts = contracts;
      const ordered = {};
      for (const k of ["id", "title", "status", "kind", "contracts"]) {
        if (frontmatter[k] !== undefined) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS.has(k)) ordered[k] = frontmatter[k];
      }
      const finalBody = body !== undefined ? body : existingBody;
      const fileName = existingFile ?? `${id}-${slugify(title, "doc")}.md`;
      fs.writeFileSync(path.join(docDir, fileName), serializeFrontmatter(ordered, finalBody), "utf8");
      return get(id);
    });
  }

  return { list, get, write };
}
