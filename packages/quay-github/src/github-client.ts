// Thin wrapper over `gh api` (CLI-first, matching quay-native's own design
// ethos — design §1; DESIGN.md §2). Reads real issues from a GitHub
// repository and maps them onto the canonical view-model (DESIGN.md §3).

import { execFileSync } from "node:child_process";
import { TASK_STATUS, isTaskStatus, type Task } from "../../quay/src/abi.ts";

const STATUS_LABEL_RE = /^status:(.+)$/;
const LANE_LABEL_RE = /^lane:(.+)$/;

// Precedence order for the "multiple status:* labels on one issue" case
// (DESIGN.md §3 bug fix — iteration-4 independent audit bug #3). GitHub
// gives no ordering guarantee across labels, so a defined, documented rule
// is required rather than silent last-write-wins. Rule: the *most advanced*
// lifecycle stage wins (done > needs-human > ready > todo), on the theory
// that a human who left a stale earlier-stage label while adding a newer
// one almost always means the newer, more-advanced one. This is applied
// only among the open-issue labels; issue.state == "closed" still
// unconditionally forces "done" regardless of any label (unchanged rule).
const STATUS_PRECEDENCE: readonly string[] = [TASK_STATUS.DONE, TASK_STATUS.NEEDS_HUMAN, TASK_STATUS.READY, TASK_STATUS.TODO];

// GitHub task-list checkbox syntax referencing another issue in the SAME
// repo, e.g. "- [ ] #12" or "- [x] #12". This is the closest thing GitHub
// has to a lightweight, git-visible parent/child convention that does not
// require the separate (preview-gated, org-level) sub-issues REST API
// (DESIGN.md §3/§4 bug fix — iteration-4 independent audit bug #1). Scope
// is deliberately minimal (G5): body-text checkbox references only, no
// GraphQL sub-issue API integration.
const CHILD_CHECKBOX_RE = /^\s*-\s*\[[ xX]\]\s*#(\d+)\s*$/gm;

// DIR-041 (M57): the sentinel id a caller passes to `task_write` to mean
// "create a NEW issue" rather than "edit an existing one" -- see
// `create()`'s own header comment below for the full rationale. Exported so
// mcp-server.ts's task_write handler and tests both reference this ONE
// source instead of re-typing the literal string ("gh-new") in more than
// one place.
export const CREATE_SENTINEL_ID = "gh-new";

// DIR-037 (M55): live-verified against a REAL foreign repo (yaleh/archguard,
// 44+ open issues) — `gh api`'s response for a repo with many/large issues
// overflows Node's `child_process.execFileSync` DEFAULT `maxBuffer` (1 MiB),
// throwing `Error: spawnSync gh ENOBUFS`. quay's own tiny backlog never
// triggers this; any real-world foreign repo does immediately (Finding,
// tasks/DIR-037.md). Single-sourced fix: EVERY `gh api` call goes through
// this ONE helper (`execGh`), which sets a generous `maxBuffer` — no
// per-call-site patching. 64 MiB comfortably covers a full-history
// `--paginate`-free single-page fetch (`fetchAllIssues`'s own
// `DEFAULT_MAX_ISSUES`/pageIssues cap already bounds page COUNT; this bounds
// the BYTE size of any one page's response) while still failing loudly
// (a plain thrown Error) rather than hanging forever on a truly pathological
// response. Override via QUAY_GITHUB_MAX_BUFFER (bytes) for a caller that
// knowingly needs more.
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024; // 64 MiB

function ghApiMaxBuffer(): number {
  const override = Number(process.env.QUAY_GITHUB_MAX_BUFFER);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_MAX_BUFFER;
}

/** THE single choke point for every `gh api ...` subprocess call in this
 * module (DIR-037/M55) — sets `maxBuffer` so a real foreign repo's larger
 * response does not overflow Node's 1 MiB execFileSync default (ENOBUFS).
 * `ghApiJson`/`ghApiRun` are thin callers; do not call `execFileSync("gh",
 * ...)` anywhere else in this file — route through here instead. */
function execGh(args: string[]): string {
  return execFileSync("gh", ["api", ...args], {
    encoding: "utf8",
    maxBuffer: ghApiMaxBuffer(),
  });
}

export function ghApiJson(args: string[]): unknown {
  const out = execGh(args);
  return JSON.parse(out);
}

export function ghApiRun(args: string[]): unknown {
  // Same subprocess convention as ghApiJson, but for calls whose return
  // value we don't need to parse (e.g. PATCH with no interesting body use,
  // or calls made purely for a side effect). Still returns parsed JSON when
  // the API gives one, for callers that want to inspect it.
  const out = execGh(args);
  return out ? JSON.parse(out) : null;
}

/** Extract child issue numbers referenced via task-list checkboxes in an
 * issue body (e.g. "- [ ] #12"). Returns an array of "gh-<n>" ids, in the
 * order they appear, de-duplicated. */
export function extractChildRefs(body: string | null | undefined): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(CHILD_CHECKBOX_RE)) {
    const id = `gh-${m[1]}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** DESIGN.md §3 — GitHub Issue -> canonical task view-model.
 * @param {object} issue the raw gh api issue object
 * @param {Map<string,string[]>|null} parentIndex optional precomputed map of
 *   childId -> [parentIds] built by the caller from a full issue list (used
 *   to populate `parent`, since GitHub has no native reverse-link and this
 *   Provider derives it from other issues' checkbox lists). When omitted
 *   (e.g. single-issue `get()` without a full list), `parent` is left null
 *   -- a known, documented single-issue-lookup limitation (see DESIGN.md §3).
 */
export function issueToViewModel(issue: Record<string, unknown>, parentIndex: Map<string, string[]> | null = null): Task {
  const rawLabels = (issue.labels as Array<string | { name: string }> | undefined) ?? [];
  const labelNames = rawLabels.map((l) =>
    typeof l === "string" ? l : l.name
  );

  const statusLabelsFound: string[] = [];
  let lane: string | null = null;
  const otherLabels: string[] = [];

  for (const name of labelNames) {
    const statusMatch = STATUS_LABEL_RE.exec(name);
    const laneMatch = LANE_LABEL_RE.exec(name);
    if (statusMatch) {
      statusLabelsFound.push(statusMatch[1]);
    } else if (laneMatch) {
      lane = laneMatch[1];
    } else {
      otherLabels.push(name);
    }
  }

  let status: Task["status"] = TASK_STATUS.TODO;
  if (statusLabelsFound.length === 1) {
    status = statusLabelsFound[0] as Task["status"];
  } else if (statusLabelsFound.length > 1) {
    // Multiple status:* labels present -- apply the documented precedence
    // rule rather than last-write-wins. Unrecognized label values (not in
    // STATUS_PRECEDENCE) are treated as lowest precedence, in the order
    // encountered, below all recognized ones.
    const ranked = [...statusLabelsFound].sort((a, b) => {
      const ai = STATUS_PRECEDENCE.indexOf(a);
      const bi = STATUS_PRECEDENCE.indexOf(b);
      const ra = ai === -1 ? STATUS_PRECEDENCE.length : ai;
      const rb = bi === -1 ? STATUS_PRECEDENCE.length : bi;
      return ra - rb;
    });
    status = ranked[0] as Task["status"];
  }

  // issue.state == "closed" always wins -> done, regardless of any
  // status:* label left on a closed issue (DESIGN.md §3).
  if (issue.state === "closed") {
    status = TASK_STATUS.DONE;
  }

  // Parse-boundary guard (gap-abi-status-lifecycle-vocab-scattered-no-named-type):
  // a `status:*` label whose value is outside the five-word lifecycle vocab is
  // REJECTED — fail closed to `todo` rather than silently casting an illegal
  // label value into a legal-looking `Task.status`.
  if (!isTaskStatus(status)) {
    status = TASK_STATUS.TODO;
  }

  const body = (issue.body as string | null | undefined) ?? "";
  const children = extractChildRefs(body);
  const issueNumber = issue.number as number;
  const parents = parentIndex?.get(`gh-${issueNumber}`) ?? [];
  // Canonical view-model's `parent` is singular (design §7.1); if more than
  // one open issue's checkbox list references this issue, that is itself a
  // data-quality problem in the source repo, not something this Provider
  // should silently paper over. Documented rule: first parent found wins,
  // and the ambiguity is surfaced via `extra.multipleParents`.
  const parent = parents.length > 0 ? parents[0] : null;

  const extra: Record<string, unknown> = {
    number: issueNumber,
    html_url: issue.html_url,
    user: (issue.user as { login?: string } | null | undefined)?.login ?? null,
    state: issue.state,
    ...(parents.length > 1 ? { multipleParents: parents } : {}),
    ...(lane !== null ? { lane } : {}),
  };

  return {
    id: `gh-${issueNumber}`,
    title: issue.title as string,
    status,
    role: children.length > 0 ? "compound" : "primitive", // derived, same convention as native (design §2)
    labels: otherLabels,
    parent,
    children,
    body,
    extra,
  };
}

// M12-abi-parent-write: pure body-text mutation for the checkbox-in-body
// convention (charter Done-when 1). Given a body and a DESIRED set of child
// ids (gh-<n> strings), returns a new body string with exactly one
// checkbox line per desired child -- adding lines for newly-added children
// (as unchecked, "- [ ] #<n>") and removing lines for children no longer
// desired -- while PRESERVING the existing checked ([x]/[X]) state of any
// checkbox line that is kept. Lines for ids not in CHILD_CHECKBOX_RE's
// shape (i.e. everything else in the body) are left untouched, in their
// original position; new lines are appended after the last existing
// checkbox line (or at the end of the body, with a blank-line separator,
// if the body has no checkbox lines yet).
export function setChildCheckboxes(body: string | null | undefined, desiredChildIds: string[]): string {
  const src = body || "";
  const desired = new Set(desiredChildIds);

  // Pass 1: scan existing checkbox lines, recording their checked state and
  // whether each is still desired. De-duplicate on first occurrence, same
  // as extractChildRefs.
  const existingState = new Map<string, boolean>(); // id -> checked (bool)
  let lastCheckboxLineEnd = -1;
  const lineRe = /^([ \t]*-\s*\[([ xX])\]\s*#(\d+)\s*)$/gm;
  for (const m of src.matchAll(lineRe)) {
    const id = `gh-${m[3]}`;
    if (!existingState.has(id)) existingState.set(id, /[xX]/.test(m[2]));
    lastCheckboxLineEnd = m.index + m[0].length;
  }

  // Pass 2: rewrite the body, dropping checkbox lines for ids no longer
  // desired, preserving checked-state for ids that are kept, and preserving
  // every other line verbatim.
  const lines = src.split("\n");
  const outLines: string[] = [];
  for (const line of lines) {
    const m = /^([ \t]*)-\s*\[([ xX])\]\s*#(\d+)\s*$/.exec(line);
    if (m) {
      const id = `gh-${m[3]}`;
      if (desired.has(id)) {
        outLines.push(line); // keep verbatim (preserves checked state + indent)
      }
      // else: drop this line (child removed)
      continue;
    }
    outLines.push(line);
  }

  let out = outLines.join("\n");

  // Append lines for newly-desired children not already present.
  const toAdd = [...desired].filter((id) => !existingState.has(id));
  if (toAdd.length > 0) {
    const hadAnyCheckbox = lastCheckboxLineEnd !== -1;
    const sep = out.length === 0 ? "" : out.endsWith("\n") ? "" : "\n";
    const prefix = !hadAnyCheckbox && out.trim().length > 0 ? "\n" : "";
    const newLines = toAdd
      .map((id) => `- [ ] #${id.replace(/^gh-/, "")}`)
      .join("\n");
    out = `${out}${sep}${prefix}${newLines}\n`;
  }

  return out;
}

/** Build a childId -> [parentIds] index from a full list of raw issues, by
 * scanning each issue's body for task-list checkbox refs (DESIGN.md §3). */
function buildParentIndex(issues: Array<Record<string, unknown>>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const issue of issues) {
    const parentId = `gh-${issue.number}`;
    for (const childId of extractChildRefs(issue.body as string | null | undefined)) {
      const list = index.get(childId) ?? [];
      list.push(parentId);
      index.set(childId, list);
    }
  }
  return index;
}

// Scale safety net (DESIGN.md §3/§4 bug fix — iteration-4 independent audit
// bug #2): `--paginate` alone will happily walk an unbounded number of pages
// for a large repo, with no cap and no per-page size control. v1 stays
// simple (G5: no caching, no field-selection/GraphQL) but adds a hard
// ceiling so a large real-world repo fails loudly (a clear, documented
// error) rather than silently degrading into a very slow/expensive O(n)
// full-history fetch on every `task list` call. Override via
// QUAY_GITHUB_MAX_ISSUES for a caller that knowingly wants more.
const DEFAULT_MAX_ISSUES = 500;

/**
 * QN-014: the paging/overflow loop, extracted from `createGithubClient` into
 * a standalone, independently-testable, injectable function. `fetchPage(page,
 * perPage)` is the thing that actually talks to `gh api` in production
 * (`createGithubClient`'s real `fetchAllIssues` below), but tests supply a
 * synthetic stand-in so the overflow throw path can be genuinely exercised
 * without needing a real 500+-issue GitHub repository (impractical — this
 * experiment's real repo has 4 issues). Pure paging/cap logic; does not read
 * `process.env` itself (that stays `createGithubClient`'s job).
 *
 * @param {{maxIssues: number, perPage: number, fetchPage: (page:number, perPage:number) => any[]}} opts
 * @returns {any[]} the concatenated issues across all fetched pages
 * @throws if the cap is reached without a natural (short) final page
 */
export function pageIssues({ maxIssues, perPage, fetchPage }: { maxIssues: number; perPage: number; fetchPage: (page: number, perPage: number) => Array<Record<string, unknown>> }): Array<Record<string, unknown>> {
  const maxPages = Math.ceil(maxIssues / perPage);
  const issues: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = fetchPage(page, perPage);
    issues.push(...batch);
    if (batch.length < perPage) break; // last page reached
  }
  if (issues.length >= maxIssues) {
    throw new Error(
      `quay-github: repo has >= ${maxIssues} issues ` +
        `(QUAY_GITHUB_MAX_ISSUES cap reached); v1 has no pagination/` +
        `caching strategy beyond this hard limit (DESIGN.md §3). Raise ` +
        `QUAY_GITHUB_MAX_ISSUES if you know what you are doing, or file ` +
        `a follow-up task for a real paged/streaming task_list API.`
    );
  }
  return issues;
}

// QN-024: minimal data.write (status-only). Given an issue's CURRENT raw
// label name list and the desired canonical `status`, compute the write
// plan: which labels to keep, which `status:*` labels to remove, which new
// `status:*` label (if any) to add, and whether the issue should end up
// open or closed. Pure function, injectable/unit-testable without a live
// `gh api` call (mirrors QN-014's `pageIssues` extraction pattern).
//
// Rules (mirror DESIGN.md §3's read-side mapping, applied in reverse):
// - status === "done": close the issue. Per DESIGN.md §3, `state=="closed"`
//   unconditionally forces status="done" on read regardless of any
//   status:* label -- so no label change is required for this transition;
//   existing status:* labels are left as-is (harmless, since read ignores
//   them once closed).
// - any other status: issue must end up OPEN, and must carry exactly one
//   status:* label, `status:<status>` -- all other existing status:*
//   labels are removed first, to avoid reintroducing the multi-label
//   precedence ambiguity DESIGN.md §3.1 already had to solve for read.
export function computeStatusWrite({ currentLabelNames, status }: { currentLabelNames: string[]; status: string }): { close: boolean; addLabels: string[]; removeLabels: string[] } {
  if (status === TASK_STATUS.DONE) {
    return { close: true, addLabels: [], removeLabels: [] };
  }
  const removeLabels = currentLabelNames.filter((n) => STATUS_LABEL_RE.test(n));
  const desired = `status:${status}`;
  const addLabels = removeLabels.includes(desired) && removeLabels.length === 1
    ? [] // already exactly the desired single label -- nothing to change
    : [desired];
  return {
    close: false,
    addLabels,
    // Only remove labels that are NOT the one we're about to (re-)add, to
    // avoid a pointless remove-then-immediately-re-add round trip.
    removeLabels: removeLabels.filter((n) => n !== desired),
  };
}

// QN-028: gate capability (task_check equivalent for GitHub-backed tasks).
// Direct port of quay-native's store.js#check()/artifactSections()/
// extractSection() semantics, adapted to operate on an issue's raw body
// text instead of a native task file's body -- same regex shapes, same
// content-length floor, so the two implementations stay structurally
// comparable side by side (design's Provider-independence principle: no
// cross-package import, each Provider ports the semantic itself).
//
// QN-035 (iteration 25, DIR-006): compound/epic (children non-empty) support
// added below (childrenStatus()), porting store.js's own QN-012/QN-016
// childrenStatus() recursion. Ported per DIR-006's explicit rejection of the
// prior "no organic compound issue has appeared" deferral reasoning -- a
// real compound issue pair (gh-<parent>/gh-<child>) was deliberately created
// in yaleh/quay to motivate and live-verify this work (see DESIGN.md §3.5
// and provenance.md's iteration-25 section for the concrete issue numbers
// and live-verification transcript).
const MIN_SECTION_CHARS = 40;

/** Same end-of-string-safe heading-section extractor as store.js's
 * extractSection -- JS has no \Z anchor; `(?![\s\S])` is the correct
 * end-of-string lookahead (native's own QN-005 fix, ported verbatim to
 * avoid reintroducing the same bug in a second implementation). */
function extractGateSection(body: string | null | undefined, headings: string[]): string {
  for (const h of headings) {
    const re = new RegExp(`^##\\s+${h}\\b([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im");
    const m = re.exec(body || "");
    if (m) return m[1];
  }
  return "";
}

function gateArtifactSections(body: string | null | undefined): { proposal: boolean; plan: boolean; ac: boolean; dod: boolean } {
  const has = (heading: string) => {
    if (!new RegExp(`^##\\s+${heading}\\b`, "im").test(body || "")) return false;
    const content = extractGateSection(body, [heading]);
    const nonWhitespaceLen = content.replace(/\s/g, "").length;
    return nonWhitespaceLen >= MIN_SECTION_CHARS;
  };
  return {
    proposal: has("Proposal"),
    plan: has("Plan"),
    ac: has("AC") || has("Acceptance Criteria"),
    dod: has("DoD") || has("Definition of Done"),
  };
}

interface ChildStatusEntry {
  id: string;
  status: string;
  childrenStatus?: ChildStatusEntry[];
}

interface TaskLike {
  id: string;
  role: string;
  children: string[];
  status?: string;
}

/**
 * QN-035 (iteration 25, DIR-006): recursive children-status rollup for a
 * compound (epic) GitHub-backed task -- direct port of store.js's own
 * `childrenStatus()` (QN-012/QN-016), adapted to fetch each child live via
 * an injected `getTask(childId)` function instead of a local file-store
 * `get()` (mirrors the `pageIssues`/`fetchPage` injection pattern already
 * established in this file -- pure recursion logic, callers supply the
 * actual I/O).
 *
 * Same semantics as native's version:
 * - each child is reported `{id, status}` (or, if itself compound,
 *   `{id, status, childrenStatus: [...grandchildren]}`);
 * - a child that no longer exists (deleted issue, bad reference) is
 *   reported `{id, status: "missing"}`;
 * - a child that reappears within its own ancestry (a cyclic parent/child
 *   graph) is reported `{id, status: "missing"}` too -- a data-integrity
 *   bug this gate must not crash or hang on;
 * - a compound child whose own status is "done" but whose subtree is NOT
 *   entirely "done" is reported as "stale-done", not "done" -- the same
 *   rollup native's own fix (iteration 6/7) established, so a `done` label
 *   later contradicted by a reverted grandchild is surfaced, not
 *   silently trusted.
 *
 * @param {{id: string, role: string, children: string[]}} task
 * @param {(childId: string) => ({id:string, status:string, role:string, children:string[]}|null)} getTask
 * @param {Set<string>} visited ids seen earlier in the current walk (cycle guard)
 */
export function childrenStatus(task: TaskLike, getTask: (childId: string) => TaskLike | null, visited: Set<string> = new Set()): ChildStatusEntry[] {
  if (visited.has(task.id)) {
    // Should not normally be reached (callers guard before recursing), kept
    // as a defensive no-op-safe fallback, matching store.js's own comment.
    return [];
  }
  const nextVisited = new Set(visited);
  nextVisited.add(task.id);
  return (task.children || []).map((childId) => {
    if (nextVisited.has(childId)) {
      return { id: childId, status: "missing" };
    }
    const child = getTask(childId);
    if (!child) return { id: childId, status: "missing" };
    if (child.role === "compound") {
      const grandkids = childrenStatus(child, getTask, nextVisited);
      const subtreeOk = grandkids.every((g) => g.status === TASK_STATUS.DONE);
      const status = child.status === TASK_STATUS.DONE && !subtreeOk ? "stale-done" : (child.status ?? TASK_STATUS.TODO);
      return { id: childId, status, childrenStatus: grandkids };
    }
    return { id: childId, status: child.status ?? TASK_STATUS.TODO };
  });
}

/**
 * QN-028: the gate-check equivalent of native's store.js#check(), for a
 * GitHub-backed task. Given the task's already-derived view-model `status`
 * and its raw issue `body`, returns the same `{gate, ok, reason, acTotal,
 * acChecked}` shape native's check() returns for todo/ready/done.
 *
 * QN-035 (iteration 25, DIR-006): compound (epic) tasks are now supported --
 * `ready`/`done` branches call the injected `getChildTask` fetcher (via
 * `childrenStatus()` above) to require every child already `done`, mirroring
 * store.js's own QN-012 compound-aware gate exactly. Primitive tasks
 * (`role !== "compound"`, i.e. `children` empty) are entirely unaffected --
 * `childrenStatus` degrades to `[]` and `.every(...)` over an empty array is
 * vacuously true, the same degrade-to-leaf guarantee native's own gate uses.
 *
 * @param {{id: string, status: string, body: string, role?: string, children?: string[]}} task
 * @param {(childId: string) => object|null} [getChildTask] required only
 *   when `task.role === "compound"` (children non-empty); a primitive task's
 *   gate check never calls it, so callers of the primitive-only path (every
 *   existing call site before this iteration) are unaffected and require no
 *   change.
 */
export function checkGate(task: { id: string; status: string; body?: string | null; role?: string; children?: string[] }, getChildTask?: (childId: string) => TaskLike | null): Record<string, unknown> {
  const { id, status, body, role, children } = task;
  const artifacts = gateArtifactSections(body);
  const allArtifactsPresent = Object.values(artifacts).every(Boolean);

  if (status === TASK_STATUS.TODO) {
    const gate = "author->ready";
    const acSection = extractGateSection(body, ["AC", "Acceptance Criteria"]);
    const acCheckboxes = acSection.match(/- \[[ xX]\]/g) || [];
    const acChecked = acSection.match(/- \[[xX]\]/g) || [];
    const acHasCheckbox = acCheckboxes.length > 0;
    if (allArtifactsPresent && !acHasCheckbox) {
      return { id, gate, ok: false, artifacts, reason: "AC section has no checkboxes" };
    }
    const acAllChecked = acHasCheckbox && acChecked.length === acCheckboxes.length;
    if (allArtifactsPresent && acHasCheckbox && !acAllChecked) {
      return {
        id,
        gate,
        ok: false,
        artifacts,
        acTotal: acCheckboxes.length,
        acChecked: acChecked.length,
        reason: `${acChecked.length}/${acCheckboxes.length} AC checkboxes checked`,
      };
    }
    const ok = allArtifactsPresent && acAllChecked;
    return {
      id,
      gate,
      ok,
      artifacts,
      reason: ok
        ? "all four artifacts present; eligible to move to ready"
        : "missing artifacts: " +
          Object.entries(artifacts)
            .filter(([, v]) => !v)
            .map(([k]) => k)
            .join(", "),
    };
  }

  if (status === TASK_STATUS.READY) {
    const acSection = extractGateSection(body, ["AC", "Acceptance Criteria"]);
    const checkboxes = acSection.match(/- \[[ xX]\]/g) || [];
    const checked = acSection.match(/- \[[xX]\]/g) || [];
    const acOk = checkboxes.length > 0 && checked.length === checkboxes.length;

    // QN-035 (DIR-006): for a compound (epic) task, the execute->done gate
    // must ALSO require every child to already be `done` -- direct port of
    // store.js's own QN-012 fix (see file header note). Primitive tasks
    // (children.length === 0 / role !== "compound") are unaffected:
    // childrenStatus is `[]` and `.every(...)` over an empty array is
    // vacuously true.
    const isCompound = role === "compound" && (children || []).length > 0;
    const taskLike: TaskLike = { id, role: role ?? "primitive", children: children ?? [], status };
    const kids = isCompound ? childrenStatus(taskLike, getChildTask ?? (() => null)) : [];
    const childrenOk = kids.every((c) => c.status === TASK_STATUS.DONE);
    const ok = acOk && childrenOk;
    const badChildren = kids.filter((c) => c.status !== TASK_STATUS.DONE);
    let reason: string;
    if (!acOk) {
      reason = `${checked.length}/${checkboxes.length} AC checkboxes checked`;
    } else if (!childrenOk) {
      reason =
        "AC checkboxes complete, but not all children are done: " +
        badChildren.map((c) => `${c.id} (${c.status})`).join(", ");
    } else {
      reason = "all AC checkboxes checked; eligible to move to done";
    }
    const result: Record<string, unknown> = {
      id,
      gate: "execute->done",
      ok,
      acTotal: checkboxes.length,
      acChecked: checked.length,
      reason,
    };
    if (isCompound) result.childrenStatus = kids;
    return result;
  }

  if (status === TASK_STATUS.DONE) {
    // QN-035 (DIR-006): a `done` compound (epic) task's gate check must
    // actually re-verify that its children are still `done`, rather than
    // unconditionally rubber-stamping `ok: true` -- direct port of
    // store.js's own QN-012 fix (see file header note). Primitive tasks
    // are unaffected -- degrades to the original unconditional behavior.
    const isCompound = role === "compound" && (children || []).length > 0;
    const taskLike: TaskLike = { id, role: role ?? "primitive", children: children ?? [], status };
    const kids = isCompound ? childrenStatus(taskLike, getChildTask ?? (() => null)) : [];
    const childrenOk = kids.every((c) => c.status === TASK_STATUS.DONE);
    if (isCompound && !childrenOk) {
      const badChildren = kids.filter((c) => c.status !== TASK_STATUS.DONE);
      return {
        id,
        gate: "none",
        ok: false,
        reason:
          "compound task marked done, but not all children are done: " +
          badChildren.map((c) => `${c.id} (${c.status})`).join(", "),
        childrenStatus: kids,
      };
    }
    const result: Record<string, unknown> = { id, gate: "none", ok: true, reason: "terminal" };
    if (isCompound) result.childrenStatus = kids;
    return result;
  }

  if (status === TASK_STATUS.NEEDS_HUMAN) {
    return { id, gate: "none", ok: false, reason: "soft stop; human action required" };
  }

  return { id, gate: "unknown", ok: false, reason: `unrecognized status ${status}` };
}

/**
 * @param {{owner: string, repo: string}} opts
 */
export function createGithubClient({ owner, repo }: { owner: string; repo: string }) {
  const maxIssues = Number(process.env.QUAY_GITHUB_MAX_ISSUES) || DEFAULT_MAX_ISSUES;

  function fetchAllIssues(): Array<Record<string, unknown>> {
    // Request the max per-page size (100) to minimize round-trips, and cap
    // total pages fetched so a single `task list` call cannot silently
    // balloon into an unbounded crawl of a very large repo's full history.
    // QN-014: the actual paging/overflow logic now lives in the standalone,
    // independently-tested `pageIssues` above — this is a thin wrapper
    // supplying the real `gh api`-calling fetchPage, provably unchanged live
    // behavior from before the refactor.
    const perPage = 100;
    return pageIssues({
      maxIssues,
      perPage,
      fetchPage: (page, pp) =>
        ghApiJson([
          `repos/${owner}/${repo}/issues`,
          "-X",
          "GET",
          "-f",
          "state=all",
          "-f",
          `per_page=${pp}`,
          "-f",
          `page=${page}`,
        ]) as Array<Record<string, unknown>>,
    });
  }

  function list({ status, label }: { status?: string; label?: string } = {}): Task[] {
    const rawIssues = fetchAllIssues().filter((i) => !i.pull_request); // exclude PRs, which the issues API also returns
    const parentIndex = buildParentIndex(rawIssues);
    let tasks = rawIssues.map((issue) => issueToViewModel(issue, parentIndex));
    if (status) tasks = tasks.filter((t) => t.status === status);
    if (label) tasks = tasks.filter((t) => (t.labels || []).includes(label));
    return tasks;
  }

  function get(id: string): Task | null {
    const m = /^gh-(\d+)$/.exec(id);
    if (!m) return null;
    const number = m[1];
    let issue: Record<string, unknown>;
    try {
      issue = ghApiJson([`repos/${owner}/${repo}/issues/${number}`]) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (issue.pull_request) return null; // PRs are not tasks
    // PR-ABI-002 fix (M09-gh-write): single-issue lookup now also resolves
    // `parent`, by reusing the SAME fetchAllIssues()+buildParentIndex() pair
    // list() already uses -- accepting the extra API-call cost (a full repo
    // issue fetch) for read-side correctness/symmetry with list(), per the
    // gap-list entry's own suggested fix. Previously this path unconditionally
    // left `parent` null (see git history / capability-matrix.md's prior
    // write-up) -- that asymmetry is what this fix closes.
    const parentIndex = buildParentIndex(fetchAllIssues());
    return issueToViewModel(issue, parentIndex);
  }

  // QN-024: data.write (status-only, minimal v1 write surface — G5, no
  // title/body/labels/parent/children writes). Reopens/closes the issue
  // and replaces status:* label(s) per computeStatusWrite's pure decision
  // logic above, then returns the fresh view-model (single-issue lookup,
  // so `parent` is left null per the existing get() limitation).
  function setStatus(id: string, status: string): Task | null {
    const m = /^gh-(\d+)$/.exec(id);
    if (!m) throw new Error(`quay-github: invalid task id for setStatus: ${id}`);
    const number = m[1];
    const issue = ghApiJson([`repos/${owner}/${repo}/issues/${number}`]) as Record<string, unknown>;
    const rawLabels = (issue.labels as Array<string | { name: string }> | undefined) ?? [];
    const currentLabelNames = rawLabels.map((l) =>
      typeof l === "string" ? l : l.name
    );
    const plan = computeStatusWrite({ currentLabelNames, status });

    if (plan.close) {
      ghApiRun([
        `repos/${owner}/${repo}/issues/${number}`,
        "-X",
        "PATCH",
        "-f",
        "state=closed",
      ]);
    } else {
      // Ensure open (idempotent -- reopening an already-open issue is a
      // harmless no-op per the GitHub API).
      ghApiRun([
        `repos/${owner}/${repo}/issues/${number}`,
        "-X",
        "PATCH",
        "-f",
        "state=open",
      ]);
      for (const label of plan.removeLabels) {
        // Deleting a label that isn't present 404s -- swallow, since our
        // plan was computed from a live read moments ago but another
        // writer could have raced us; a missing label to remove is not
        // itself an error worth failing the whole write for.
        try {
          ghApiRun([
            `repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`,
            "-X",
            "DELETE",
          ]);
        } catch {
          /* already absent -- fine */
        }
      }
      for (const label of plan.addLabels) {
        ghApiRun([
          `repos/${owner}/${repo}/issues/${number}/labels`,
          "-X",
          "POST",
          "-f",
          `labels[]=${label}`,
        ]);
      }
    }

    return get(id);
  }

  // DIR-041 (M57): real issue CREATE, closing the last remaining gap in
  // quay-github's write surface (title/body/status/labels/parent/children
  // were already implemented -- see writeFields/writeRelations/setStatus
  // above; this file's own history had drifted the "read-only v1" framing
  // well past its actual capability). POSTs a new issue with the given
  // title (required -- GitHub issues cannot exist without one) and,
  // optionally, body + labels; `status`/`parent`/`children` are intentionally
  // NOT accepted here (mirrors writeFields's own status-write-is-a-separate-
  // concern discipline) -- a caller wanting a non-default initial status or
  // relations issues a FOLLOW-UP setStatus/writeRelations call against the
  // real id this function returns, exactly the two-step shape Core's own
  // `task create` CLI verb already uses when it forwards extra fields
  // through the SAME generic task_write patch object (see bin/quay.js's
  // `task create` handler: it always sends the full merged patch in one
  // task_write call; this Provider's mcp-server.ts task_write handler
  // below performs that same two-step decomposition server-side so ONE
  // client-visible task_write call, with `id: "gh-new"` PLUS status/labels/
  // parent/children fields all present, still lands correctly).
  function create({ title, body, labels }: { title?: string; body?: string; labels?: string[] } = {}): Task | null {
    if (typeof title !== "string" || title.trim() === "") {
      throw new Error(
        "quay-github: create requires a non-empty title (GitHub issues cannot exist without one)"
      );
    }
    const postFields: Record<string, string> = { title };
    if (body !== undefined) postFields.body = body;
    const issue = ghApiJson([
      `repos/${owner}/${repo}/issues`,
      "-X",
      "POST",
      ...Object.entries(postFields).flatMap(([k, v]) => ["-f", `${k}=${v}`]),
      ...(labels ?? []).map((label) => ["-f", `labels[]=${label}`]).flat(),
    ]) as Record<string, unknown>;
    return get(`gh-${issue.number}`);
  }

  // M09-gh-write (PR-ABI-001, real write): title/body/labels write. Applies
  // whichever of `title`/`body`/`labels` are present in `fields` via `gh api
  // ... -X PATCH` (title/body, same PATCH-on-self endpoint setStatus already
  // uses for state) and the existing add/remove-label endpoints (generalized
  // beyond just status:*/lane:* labels -- `labels` here means the full
  // desired list of NON-status/lane "other" labels, i.e. the same field
  // issueToViewModel calls `labels` in the view-model; status:*/lane:*
  // labels already carrying separate semantics are left untouched by this
  // path, mirroring computeStatusWrite's own label-surgery discipline of
  // touching only the labels relevant to the field being written).
  // `status` is intentionally NOT accepted here -- callers wanting a status
  // change use setStatus/computeStatusWrite's own open/close+status:*-label
  // semantics; mixing the two write paths in one function would reintroduce
  // exactly the kind of implicit precedence ambiguity DESIGN.md §3.1 already
  // had to solve once for read.
  function writeFields(id: string, fields: { title?: string; body?: string; labels?: string[] }): Task | null {
    const m = /^gh-(\d+)$/.exec(id);
    if (!m) throw new Error(`quay-github: invalid task id for writeFields: ${id}`);
    const number = m[1];

    const patchFields: Record<string, string> = {};
    if (Object.prototype.hasOwnProperty.call(fields, "title")) {
      patchFields.title = fields.title!;
    }
    if (Object.prototype.hasOwnProperty.call(fields, "body")) {
      patchFields.body = fields.body!;
    }
    if (Object.keys(patchFields).length > 0) {
      ghApiRun([
        `repos/${owner}/${repo}/issues/${number}`,
        "-X",
        "PATCH",
        ...Object.entries(patchFields).flatMap(([k, v]) => ["-f", `${k}=${v}`]),
      ]);
    }

    if (Object.prototype.hasOwnProperty.call(fields, "labels")) {
      const issue = ghApiJson([`repos/${owner}/${repo}/issues/${number}`]) as Record<string, unknown>;
      const rawLabels = (issue.labels as Array<string | { name: string }> | undefined) ?? [];
      const currentLabelNames = rawLabels.map((l) =>
        typeof l === "string" ? l : l.name
      );
      // Only touch "other" (non-status:*/non-lane:*) labels -- status/lane
      // labels carry separate semantics owned by setStatus, not this path.
      const currentOther = currentLabelNames.filter(
        (n) => !STATUS_LABEL_RE.test(n) && !LANE_LABEL_RE.test(n)
      );
      const desiredOther = fields.labels ?? [];
      const toRemove = currentOther.filter((n) => !desiredOther.includes(n));
      const toAdd = desiredOther.filter((n) => !currentOther.includes(n));
      for (const label of toRemove) {
        try {
          ghApiRun([
            `repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`,
            "-X",
            "DELETE",
          ]);
        } catch {
          /* already absent -- fine, same race-tolerance as setStatus */
        }
      }
      if (toAdd.length > 0) {
        ghApiRun([
          `repos/${owner}/${repo}/issues/${number}/labels`,
          "-X",
          "POST",
          ...toAdd.map((label) => ["-f", `labels[]=${label}`]).flat(),
        ]);
      }
    }

    return get(id);
  }

  // Fetch one issue's raw body by number (helper shared by writeRelations
  // below -- separate from the view-model-returning get() since this needs
  // the raw body text to feed setChildCheckboxes, not the derived model).
  function fetchRawBody(number: string): string {
    const issue = ghApiJson([`repos/${owner}/${repo}/issues/${number}`]) as Record<string, unknown>;
    return (issue.body as string | null | undefined) ?? "";
  }

  function patchBody(number: string, newBody: string): void {
    ghApiRun([
      `repos/${owner}/${repo}/issues/${number}`,
      "-X",
      "PATCH",
      "-f",
      `body=${newBody}`,
    ]);
  }

  // M12-abi-parent-write: parent/children WRITE (charter Done-when 1-2).
  // GitHub has no native parent-link field -- both fields are implemented
  // via cross-issue body-text checkbox mutation (setChildCheckboxes above),
  // per the write-semantics this milestone's iteration report states
  // explicitly:
  //
  //   - Writing `children: [...]` on task X mutates X's OWN body to contain
  //     exactly those checkbox lines (adds missing, removes extras),
  //     preserving [x] state for kept children. This is a single-issue
  //     write (X's body only).
  //   - Writing `parent: <id>` on task X mutates the TARGET parent's body
  //     to add a checkbox line referencing X (a cross-issue write), and
  //     REMOVES the checkbox line referencing X from every OTHER issue
  //     that currently lists X as a child (reassignment) -- found by
  //     re-deriving the parent index from a full issue fetch, mirroring
  //     get()'s own PR-ABI-002 buildParentIndex() reuse. Writing
  //     `parent: null` removes X from every issue currently referencing it
  //     as a child, without adding it anywhere.
  //   - If both `parent` and `children` are supplied in the same call, they
  //     are applied independently (children first, then parent) -- there is
  //     no interaction between the two (a task's own children live in its
  //     own body; its parent link lives in some OTHER issue's body).
  function writeRelations(id: string, fields: { parent?: string | null; children?: string[] }): Task | null {
    const m = /^gh-(\d+)$/.exec(id);
    if (!m) throw new Error(`quay-github: invalid task id for writeRelations: ${id}`);
    const number = m[1];

    if (Object.prototype.hasOwnProperty.call(fields, "children")) {
      const currentBody = fetchRawBody(number);
      const newBody = setChildCheckboxes(currentBody, fields.children ?? []);
      if (newBody !== currentBody) {
        patchBody(number, newBody);
      }
    }

    if (Object.prototype.hasOwnProperty.call(fields, "parent")) {
      const newParentId = fields.parent; // string gh-<n>, or null/undefined to unset
      const allIssues = fetchAllIssues();
      const parentIndex = buildParentIndex(allIssues);
      const currentParents = parentIndex.get(id) ?? [];

      // Remove this task's checkbox line from every CURRENT parent that is
      // not the new target (reassignment / unset case).
      for (const oldParentId of currentParents) {
        if (newParentId && oldParentId === newParentId) continue; // already correctly parented there
        const oldParentMatch = /^gh-(\d+)$/.exec(oldParentId);
        if (!oldParentMatch) continue;
        const oldParentIssue = allIssues.find(
          (i) => String(i.number) === oldParentMatch[1]
        );
        const oldParentBody = (oldParentIssue?.body as string | null | undefined) ?? "";
        const oldParentChildren = extractChildRefs(oldParentBody).filter((c) => c !== id);
        const newOldParentBody = setChildCheckboxes(oldParentBody, oldParentChildren);
        if (newOldParentBody !== oldParentBody) {
          patchBody(oldParentMatch[1], newOldParentBody);
        }
      }

      // Add this task's checkbox line to the new target parent, if any and
      // not already present there.
      if (newParentId) {
        const newParentMatch = /^gh-(\d+)$/.exec(newParentId);
        if (!newParentMatch) {
          throw new Error(`quay-github: invalid parent id: ${newParentId}`);
        }
        const newParentIssue = allIssues.find(
          (i) => String(i.number) === newParentMatch[1]
        );
        const newParentBody = (newParentIssue?.body as string | null | undefined) ?? "";
        const newParentChildren = extractChildRefs(newParentBody);
        if (!newParentChildren.includes(id)) {
          const updatedNewParentBody = setChildCheckboxes(newParentBody, [
            ...newParentChildren,
            id,
          ]);
          patchBody(newParentMatch[1], updatedNewParentBody);
        }
      }
    }

    return get(id);
  }

  // QN-028: gate capability -- `check(id)` fetches the task (a single-issue
  // get(), so `parent` is left null per the existing get() limitation --
  // irrelevant to gate-checking, which only reads `status`/`body`) and
  // applies the pure checkGate() function above. Returns the same shape
  // native's own `check()` returns; `{id, ok:false, reason:"not found"}`
  // if the task does not exist, matching store.js's own not-found shape.
  function check(id: string): Record<string, unknown> {
    const task = get(id);
    if (!task) return { id, ok: false, reason: "not found" };
    // QN-035 (DIR-006): supply `get` itself as the child-fetcher -- a
    // compound task's gate check recursively live-fetches each child issue
    // via the same single-issue `get()` this client already exposes. Cheap
    // for primitive tasks (role !== "compound"): checkGate() never calls
    // this fetcher unless task.children is non-empty.
    return checkGate(task, get);
  }

  return { list, get, setStatus, writeFields, writeRelations, check, create };
}
