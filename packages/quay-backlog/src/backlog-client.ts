// quay-backlog — a READ-ONLY Provider ABI client over a Backlog.md board
// (https://github.com/MrLesk/Backlog.md-style local task store: markdown
// files with YAML frontmatter under `<board>/backlog/tasks/*.md`). Built
// for DIR-039 (B): archguard runs exactly this kind of board at
// `/home/yale/work/archguard/backlog/tasks/*.md`, alongside its GitHub
// issues (mapped by quay-github, DIR-039 (A)) — this module is the second,
// heterogeneous source adapter DIR-039 asks for, proving the Provider ABI
// transfers to a THIRD, structurally different backend (mirrors how
// quay-github itself proved the ABI transfers away from quay-native,
// packages/quay-github/DESIGN.md).
//
// Frontmatter shape observed on the real board (confirmed by reading every
// file under archguard's backlog/tasks/ during this milestone):
//   id: TASK-<n>            (mapped 1:1 onto the view-model id, no prefix
//                             rewrite needed — TASK-N is already a clean,
//                             quay-native-style id)
//   title: <string>
//   status: 'Done' | 'Basic: Done' | 'Epic: Done' | 'Basic: Backlog' | ...
//                            (free-form Backlog.md status/lane label —
//                             mapped onto quay's 4-state model below)
//   labels: [<string>, ...]
//   dependencies: [<TASK-id>, ...]   (NOT mapped onto parent/children —
//                             see mapStatus's own doc comment: a dependency
//                             graph is not a parent/child containment
//                             relation; forcing it into `parent`/`children`
//                             would misrepresent the source data, so this
//                             is a deliberate, stated scope boundary (G5),
//                             not a silently dropped field — dependencies
//                             are preserved verbatim in `extra.dependencies`)
//   ordinal: <number>
// Body: one or more `## <Section>` headings wrapped in HTML comments
//   (`<!-- SECTION:X:BEGIN -->` / `...:END -->`) — passed through to the
//   view-model's `body` VERBATIM (no re-templating into quay's own
//   Proposal/Plan/AC/DoD convention — that would be lossy invention, not a
//   faithful read adapter; DIR-039's own AC only requires title/status/body
//   round-trip fidelity, not a schema rewrite).

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Task } from "../../quay/src/abi.ts";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * Map a Backlog.md free-form status string onto quay's task-status model
 * (todo/ready/done/needs-human/superseded — design §3 + the superseded
 * terminal added 2026-08-12). Backlog.md statuses observed in the wild are
 * lane-prefixed free text ("Basic: Backlog", "Epic: Done", bare "Done",
 * etc.) — there is no fixed enum to switch on. Rule (stated, not silently
 * guessed): the string "Done" appearing anywhere in the status
 * (case-insensitive) maps to quay's terminal `done`; everything else
 * (Backlog, In Progress, To Do, Blocked, ...) maps to `todo` — the single
 * non-terminal state that is always a safe, conservative default (a task
 * mapped to `todo` can still be advanced through quay's normal lifecycle;
 * a wrongly-terminal mapping would silently hide real remaining work).
 * `superseded` is intentionally NOT produced here: Backlog.md has no lane
 * for voided work, so an ambiguous line must not be silently made terminal.
 */
export function mapStatus(rawStatus: unknown): "todo" | "done" {
  if (typeof rawStatus !== "string") return "todo";
  return /done/i.test(rawStatus) ? "done" : "todo";
}

function parseTaskFile(raw: string, sourcePath: string): Task {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) {
    throw new Error(`malformed Backlog.md task file (missing YAML frontmatter): ${sourcePath}`);
  }
  const frontmatter = (YAML.parse(m[1]) ?? {}) as Record<string, unknown>;
  const body = m[2] ?? "";
  if (!frontmatter.id) {
    throw new Error(`Backlog.md task file has no frontmatter id: ${sourcePath}`);
  }
  return {
    id: String(frontmatter.id),
    title: typeof frontmatter.title === "string" ? frontmatter.title : String(frontmatter.title ?? ""),
    status: mapStatus(frontmatter.status),
    labels: Array.isArray(frontmatter.labels) ? (frontmatter.labels as string[]) : [],
    parent: null, // Backlog.md has no parent/child containment concept (see header note)
    children: [],
    role: "primitive",
    extra: {
      backlogRawStatus: frontmatter.status ?? null,
      dependencies: Array.isArray(frontmatter.dependencies) ? frontmatter.dependencies : [],
      ordinal: frontmatter.ordinal ?? null,
      sourcePath,
    },
    body,
  };
}

/**
 * @param {string} boardDir absolute path to the Backlog.md board's tasks
 *   directory (e.g. archguard's `backlog/tasks`)
 */
export function createBacklogClient(boardDir: string) {
  function listFiles(): string[] {
    if (!fs.existsSync(boardDir)) return [];
    return fs
      .readdirSync(boardDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(boardDir, f));
  }

  /** Read + parse every task file. Duplicate frontmatter ids (a real,
   * observed data quirk on archguard's own board — two files both declare
   * `id: TASK-1`) are NOT silently deduplicated or overwritten: both are
   * returned, so a caller (e.g. the migrate importer) can see and decide
   * how to handle the collision, rather than this read layer quietly
   * discarding one. */
  function readAll(): Task[] {
    return listFiles().map((filePath) => {
      const raw = fs.readFileSync(filePath, "utf8");
      return parseTaskFile(raw, filePath);
    });
  }

  function list({ status, label }: { status?: string; label?: string } = {}): Task[] {
    return readAll()
      .filter((t) => (status ? t.status === status : true))
      .filter((t) => (label ? t.labels.includes(label) : true));
  }

  /** Get one task by id. If more than one file declares the same id (the
   * TASK-1 collision noted above), returns the FIRST match in directory
   * listing order — a deterministic, documented (not silently arbitrary)
   * choice; `list()` above is the one that surfaces every file, including
   * a collision's other member(s). */
  function get(id: string): Task | null {
    return readAll().find((t) => t.id === id) ?? null;
  }

  function check(id: string): Record<string, unknown> {
    const t = get(id);
    if (!t) return { id, ok: false, reason: "not found" };
    // Read-only provider: there is no gate to run against a Backlog.md
    // task -- it is not part of this Provider's contract (capabilities.gate:
    // false in provider.yml). Report a clear, honest "not supported" rather
    // than fabricating a pass/fail against a check this Provider does not
    // implement.
    return { id, gate: "none", ok: false, reason: "quay-backlog is read-only; no gate is implemented" };
  }

  return { list, get, check };
}
