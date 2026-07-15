// Thin wrapper over `gh api` (CLI-first, matching quay-native's own design
// ethos — design §1; DESIGN.md §2). Reads real issues from a GitHub
// repository and maps them onto the canonical view-model (DESIGN.md §3).

import { execFileSync } from "node:child_process";

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
const STATUS_PRECEDENCE = ["done", "needs-human", "ready", "todo"];

// GitHub task-list checkbox syntax referencing another issue in the SAME
// repo, e.g. "- [ ] #12" or "- [x] #12". This is the closest thing GitHub
// has to a lightweight, git-visible parent/child convention that does not
// require the separate (preview-gated, org-level) sub-issues REST API
// (DESIGN.md §3/§4 bug fix — iteration-4 independent audit bug #1). Scope
// is deliberately minimal (G5): body-text checkbox references only, no
// GraphQL sub-issue API integration.
const CHILD_CHECKBOX_RE = /^\s*-\s*\[[ xX]\]\s*#(\d+)\s*$/gm;

function ghApiJson(args) {
  const out = execFileSync("gh", ["api", ...args], { encoding: "utf8" });
  return JSON.parse(out);
}

/** Extract child issue numbers referenced via task-list checkboxes in an
 * issue body (e.g. "- [ ] #12"). Returns an array of "gh-<n>" ids, in the
 * order they appear, de-duplicated. */
function extractChildRefs(body) {
  if (!body) return [];
  const seen = new Set();
  const out = [];
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
export function issueToViewModel(issue, parentIndex = null) {
  const labelNames = (issue.labels ?? []).map((l) =>
    typeof l === "string" ? l : l.name
  );

  const statusLabelsFound = [];
  let lane = null;
  const otherLabels = [];

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

  let status = "todo";
  if (statusLabelsFound.length === 1) {
    status = statusLabelsFound[0];
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
    status = ranked[0];
  }

  // issue.state == "closed" always wins -> done, regardless of any
  // status:* label left on a closed issue (DESIGN.md §3).
  if (issue.state === "closed") {
    status = "done";
  }

  const children = extractChildRefs(issue.body);
  const parents = parentIndex?.get(`gh-${issue.number}`) ?? [];
  // Canonical view-model's `parent` is singular (design §7.1); if more than
  // one open issue's checkbox list references this issue, that is itself a
  // data-quality problem in the source repo, not something this Provider
  // should silently paper over. Documented rule: first parent found wins,
  // and the ambiguity is surfaced via `extra.multipleParents`.
  const parent = parents.length > 0 ? parents[0] : null;

  return {
    id: `gh-${issue.number}`,
    title: issue.title,
    status,
    lane,
    labels: otherLabels,
    parent,
    children,
    role: children.length > 0 ? "compound" : "primitive", // derived, same convention as native (design §2)
    extra: {
      number: issue.number,
      html_url: issue.html_url,
      user: issue.user?.login ?? null,
      state: issue.state,
      ...(parents.length > 1 ? { multipleParents: parents } : {}),
    },
    body: issue.body ?? "",
  };
}

/** Build a childId -> [parentIds] index from a full list of raw issues, by
 * scanning each issue's body for task-list checkbox refs (DESIGN.md §3). */
function buildParentIndex(issues) {
  const index = new Map();
  for (const issue of issues) {
    const parentId = `gh-${issue.number}`;
    for (const childId of extractChildRefs(issue.body)) {
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
export function pageIssues({ maxIssues, perPage, fetchPage }) {
  const maxPages = Math.ceil(maxIssues / perPage);
  const issues = [];
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

/**
 * @param {{owner: string, repo: string}} opts
 */
export function createGithubClient({ owner, repo }) {
  const maxIssues = Number(process.env.QUAY_GITHUB_MAX_ISSUES) || DEFAULT_MAX_ISSUES;

  function fetchAllIssues() {
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
        ]),
    });
  }

  function list({ status, label } = {}) {
    const rawIssues = fetchAllIssues().filter((i) => !i.pull_request); // exclude PRs, which the issues API also returns
    const parentIndex = buildParentIndex(rawIssues);
    let tasks = rawIssues.map((issue) => issueToViewModel(issue, parentIndex));
    if (status) tasks = tasks.filter((t) => t.status === status);
    if (label) tasks = tasks.filter((t) => (t.labels || []).includes(label));
    return tasks;
  }

  function get(id) {
    const m = /^gh-(\d+)$/.exec(id);
    if (!m) return null;
    const number = m[1];
    let issue;
    try {
      issue = ghApiJson([`repos/${owner}/${repo}/issues/${number}`]);
    } catch {
      return null;
    }
    if (issue.pull_request) return null; // PRs are not tasks
    // Single-issue lookup cannot cheaply compute `parent` (would require
    // scanning every other issue's body) -- documented limitation, `parent`
    // is left null in this path. `children` is still populated (it only
    // needs this issue's own body). Callers that need `parent` reliably
    // populated should use `list()` (DESIGN.md §3).
    return issueToViewModel(issue, null);
  }

  return { list, get };
}
