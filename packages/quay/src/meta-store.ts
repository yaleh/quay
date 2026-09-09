// quay Core: meta store — META records, the FOURTH sibling kind (adr-store → document-store →
// goal-store → meta-store). tasks/gap-meta-records-should-be-a-first-class-store-kind-not-a-task-label.
//
// A meta record is a SEPARATE object kind from tasks (a Provider's own store), ADRs
// (adr-store.ts), goals (goal-store.ts), and documents (document-store.ts): it is a MESSAGE
// SENT TO the meta-driver, whose ANSWER is embedded on the SAME record (问与答同一对象) —
// lifecycle proposed→answered, never todo→done (tasks), never proposed→accepted (ADRs), never
// draft→active→achieved (goals), never draft→active→retired (documents). It reuses the SAME
// generic frontmatter/lock/filename-resolution mechanics as its three siblings via
// frontmatter-store-base.ts — mechanics are shared, schemas are not (the base header's
// "shared MECHANICS, independent SCHEMAS" rule; this is the fourth application).
//
// The kind's load-bearing fields (the admission test — why it cannot collapse into any prior kind):
//   1. `handler` = "meta-driver" — the ONLY kind whose record is SEMI-PROCESSED by a driver's
//      semantics. A task is IMPLEMENTED by a worker (todo→ready→done); a goal's criterion is RUN
//      by the goal-driver (draft→active→achieved); an ADR is ADJUDICATED by a human
//      (proposed→accepted); a document is a method artifact. A message is none of these — it is
//      ANSWERED, and the answer lives on the record itself.
//   2. `status` ∈ proposed→answered — decisions don't get answered, ACs don't get answered, tasks
//      have no reply field; only a message does. `answered` is NOT `done`/`achieved`/`accepted`.
//   3. `reply` — the answer is EMBEDDED on the same record. This is what makes the meta-driver's
//      output git-visible WITHOUT a per-round append (no commit flood: the record is written only
//      when the reply CHANGES, and a byte-identical rewrite is restored to HEAD, never committed).
//
// Meta view-model: { id, title, status, handler, reply, body, updatedAt }.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFrontmatter,
  serializeFrontmatter,
  fileNameForId as sharedFileNameForId,
  withFileLock,
  slugify,
} from "./frontmatter-store-base.ts";
import { commitStoreWrite, resolveGitRoot, type CommitOutcome } from "./store-commit.ts";

export const VALID_META_STATUSES = ["proposed", "answered"];

const META_ID_RE = /^META-\d{3,}$/;

// Frontmatter keys the view-model owns explicitly; everything else is preserved verbatim.
const OWNED_KEYS = new Set(["id", "title", "status", "handler", "reply"]);

interface MetaFrontmatter {
  [key: string]: unknown;
  id?: string;
  title?: string;
  status?: string;
  handler?: string;
  reply?: string;
}

interface MetaFilter {
  status?: string;
}

interface MetaViewModel {
  id: unknown;
  title: unknown;
  status: unknown;
  handler: unknown;
  reply: unknown;
  body: string;
  updatedAt?: number;
}

/**
 * COMMIT-AFTER-WRITE: commit a meta file to git immediately after writeFileSync, via the shared
 * primitive `commitStoreWrite` — ⛔ no git plumbing here (the five store files' `git commit` has
 * exactly one home: store-commit.ts). A write whose content is BYTE-IDENTICAL to HEAD (the
 * meta-driver re-answering a record with the same reply) is restored to HEAD and returns
 * "unchanged" WITHOUT committing — that is the commit-flood guard (AC6): unchanged content across
 * N rounds produces ZERO commits, and a real content change produces exactly one. Repo-less roots
 * (unit-test temp dirs) are a no-op ("not-in-git", not a throw). This wrapper declares the meta
 * kind's default (SPEC §4 declaration table): `propagate: "none"` — a meta write rides the branch
 * it lands on.
 */
function commitMetaFile(metaDir: string, fileName: string, id: string, action: string): CommitOutcome {
  const root = resolveGitRoot(metaDir);
  return commitStoreWrite({
    relPath: root ? path.relative(root, path.join(metaDir, fileName)) : `meta/${fileName}`,
    kind: "meta",
    id,
    action,
    root,
    propagate: "none",
  }).outcome;
}

/**
 * @param {string} metaDir absolute path to the meta directory (sibling of tasks/, goals/, adr/)
 */
export function createMetaStore(metaDir: string) {
  fs.mkdirSync(metaDir, { recursive: true });

  function assertSafeId(id: string) {
    if (typeof id !== "string" || !META_ID_RE.test(id)) {
      throw new Error(`invalid meta id ${JSON.stringify(id)}: must match META-NNN (>=3 digits)`);
    }
    return id;
  }

  function assertSafeStatus(status: string | undefined) {
    if (status !== undefined && !VALID_META_STATUSES.includes(status)) {
      throw new Error(`invalid meta status "${status}" — must be one of ${VALID_META_STATUSES.join(", ")}`);
    }
  }

  function fileNameForId(id: string) {
    return sharedFileNameForId(metaDir, id);
  }

  function toViewModel(frontmatter: MetaFrontmatter, body: string, updatedAt?: number): MetaViewModel {
    const vm: MetaViewModel = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      handler: frontmatter.handler ?? "meta-driver",
      reply: frontmatter.reply ?? null,
      body,
    };
    if (updatedAt !== undefined) vm.updatedAt = updatedAt;
    return vm;
  }

  function get(id: string) {
    assertSafeId(id);
    const file = fileNameForId(id);
    if (!file) return null;
    const p = path.join(metaDir, file);
    const { frontmatter, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
    let updatedAt: number | undefined;
    try {
      updatedAt = fs.statSync(p).mtimeMs;
    } catch { /* omit */ }
    return toViewModel(frontmatter as MetaFrontmatter, body, updatedAt);
  }

  function list(filter: MetaFilter = {}) {
    return fs
      .readdirSync(metaDir)
      .filter((f) => f.endsWith(".md") && f.startsWith("META-"))
      .map((f) => {
        const p = path.join(metaDir, f);
        const { frontmatter, body } = parseFrontmatter(fs.readFileSync(p, "utf8"));
        return toViewModel(frontmatter as MetaFrontmatter, body, fs.statSync(p).mtimeMs);
      })
      .filter((m) => (filter.status ? m.status === filter.status : true))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  function write(id: string, { title, status, handler, reply, body }: {
    title?: string;
    status?: string;
    handler?: string;
    reply?: string;
    body?: string;
  }) {
    assertSafeId(id);
    assertSafeStatus(status);
    return withFileLock(metaDir, id, () => {
      const existingFile = fileNameForId(id);
      let frontmatter: MetaFrontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parseFrontmatter(fs.readFileSync(path.join(metaDir, existingFile), "utf8"));
        frontmatter = { ...parsed.frontmatter } as MetaFrontmatter;
        existingBody = parsed.body;
      }
      frontmatter.id = id;
      if (title !== undefined) frontmatter.title = title;
      const prevStatus = typeof frontmatter.status === "string" ? frontmatter.status : undefined;
      frontmatter.status = status ?? frontmatter.status ?? "proposed";
      frontmatter.handler = handler ?? frontmatter.handler ?? "meta-driver";
      if (reply !== undefined) frontmatter.reply = reply;
      const ordered: MetaFrontmatter = {};
      for (const k of ["id", "title", "status", "handler", "reply"]) {
        if (frontmatter[k] !== undefined) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS.has(k)) ordered[k] = frontmatter[k];
      }
      const finalBody = body !== undefined ? body : existingBody;
      const fileName = existingFile ?? `${id}-${slugify(title, "meta")}.md`;
      fs.writeFileSync(path.join(metaDir, fileName), serializeFrontmatter(ordered, finalBody), "utf8");
      // Action semantics (gap-store-commit-action-and-actor AC1): create / status flip / field
      // update are distinguishable in the commit subject — never fixed prose.
      const action = !existingFile
        ? "create"
        : (prevStatus !== undefined && prevStatus !== frontmatter.status ? `status ${prevStatus}→${frontmatter.status}` : "update");
      const outcome = commitMetaFile(metaDir, fileName, id, action);
      if (outcome === "failed") {
        // The disk write succeeded but the git commit genuinely FAILED — surface on stderr so the
        // failure is observable, not silent (硬规则 3b). "unchanged"/"not-in-git" are expected no-ops.
        console.error(`meta-store: commit of "${id}" failed — the file was written to disk but is not on any branch's history`);
      }
      return get(id);
    });
  }

  return { list, get, write };
}

// ── Direct-invocation entry (`node packages/quay/src/meta-store.ts`) ──────────────────────────────
// Subcommands (workspace root auto-derived from the script location, or --root <dir>):
//   list [--status <s>]         — list all meta records as JSON
//   get <id>                    — one record as JSON
//   write <id> --title <t> [--status <s>] [--handler <h>] [--reply <r>] [--body <text>]
//   reply <id> --reply <text>   — set status=answered + embed the reply (commit-after-write)
async function main(argv: string[]) {
  const args = argv.slice(2);
  const rootFlagIdx = args.indexOf("--root");
  let root: string | null = null;
  if (rootFlagIdx >= 0) {
    root = args[rootFlagIdx + 1] ?? null;
    args.splice(rootFlagIdx, 2);
  }
  if (!root) {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(dir, ".git"))) { root = dir; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  root = root ?? process.cwd();
  const metaDir = path.join(root, "meta");
  const store = createMetaStore(metaDir);

  const [sub, ...rest] = args;
  switch (sub) {
    case "list": {
      const filter: MetaFilter = {};
      const fi = rest.indexOf("--status");
      if (fi >= 0) filter.status = rest[fi + 1];
      process.stdout.write(JSON.stringify(store.list(filter), null, 2) + "\n");
      return 0;
    }
    case "get": {
      if (rest.length === 0) { console.error("meta-store: get requires <id>"); return 2; }
      const rec = store.get(rest[0]);
      if (!rec) { console.error(`meta-store: no such meta: ${rest[0]}`); return 1; }
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
      return 0;
    }
    case "write": {
      const id = rest[0];
      if (!id) { console.error("meta-store: write requires <id>"); return 2; }
      const opts: Record<string, unknown> = {};
      for (let i = 1; i < rest.length; i++) {
        const k = rest[i];
        if (!k.startsWith("--")) continue;
        const key = k.slice(2);
        const v = rest[i + 1];
        if (key === "title" || key === "status" || key === "handler" || key === "reply" || key === "body") {
          opts[key] = v;
          i++;
        } else {
          console.error(`meta-store: unknown write flag: ${k}`); return 2;
        }
      }
      if (typeof opts.title !== "string" || opts.title.trim() === "") {
        console.error("meta-store: write requires --title <text>");
        return 2;
      }
      const rec = store.write(id, {
        title: opts.title as string,
        status: opts.status as string | undefined,
        handler: opts.handler as string | undefined,
        reply: opts.reply as string | undefined,
        body: opts.body as string | undefined,
      });
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
      return 0;
    }
    case "reply": {
      const id = rest[0];
      if (!id) { console.error("meta-store: reply requires <id>"); return 2; }
      const ri = rest.indexOf("--reply");
      const reply = ri >= 0 ? rest[ri + 1] : undefined;
      if (typeof reply !== "string" || reply.trim() === "") {
        console.error("meta-store: reply requires --reply <text>");
        return 2;
      }
      const rec = store.write(id, { status: "answered", reply });
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
      return 0;
    }
    default: {
      console.error(`meta-store: unknown subcommand ${JSON.stringify(sub)} — expected list|get|write|reply`);
      return 2;
    }
  }
}

// Direct-invocation guard (same bundle-surviving pattern as goal-store.ts's own):
// `.endsWith("meta-store.ts")` matches the source path when invoked directly and is false for
// the bundled dist/quay.js, so a bundled library module never runs its CLI on every `quay` call.
const isMain = process.argv[1] != null && process.argv[1].endsWith("meta-store.ts");
if (isMain) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
