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

function ghApiRun(args) {
  // Same subprocess convention as ghApiJson, but for calls whose return
  // value we don't need to parse (e.g. PATCH with no interesting body use,
  // or calls made purely for a side effect). Still returns parsed JSON when
  // the API gives one, for callers that want to inspect it.
  const out = execFileSync("gh", ["api", ...args], { encoding: "utf8" });
  return out ? JSON.parse(out) : null;
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
export function computeStatusWrite({ currentLabelNames, status }) {
  if (status === "done") {
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
// Scope discipline (G5): primitive (non-compound) tasks only -- this
// experiment has never had a real compound GitHub-backed task (children
// has always been empty for every real issue used so far), so no
// children-recursion (native's QN-012/QN-016 childrenStatus) is ported
// here. `done` status is an unconditional terminal pass for a primitive,
// matching native's own check()'s done-branch degrade-to-leaf behavior.
const MIN_SECTION_CHARS = 40;

/** Same end-of-string-safe heading-section extractor as store.js's
 * extractSection -- JS has no \Z anchor; `(?![\s\S])` is the correct
 * end-of-string lookahead (native's own QN-005 fix, ported verbatim to
 * avoid reintroducing the same bug in a second implementation). */
function extractGateSection(body, headings) {
  for (const h of headings) {
    const re = new RegExp(`^##\\s+${h}\\b([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im");
    const m = re.exec(body || "");
    if (m) return m[1];
  }
  return "";
}

function gateArtifactSections(body) {
  const has = (heading) => {
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

/**
 * QN-028: the gate-check equivalent of native's store.js#check(), for a
 * GitHub-backed task. Given the task's already-derived view-model `status`
 * and its raw issue `body`, returns the same `{gate, ok, reason, acTotal,
 * acChecked}` shape native's check() returns for todo/ready/done, primitive
 * tasks only (no children-recursion -- see file header note above).
 *
 * @param {{id: string, status: string, body: string}} task
 */
export function checkGate(task) {
  const { id, status, body } = task;
  const artifacts = gateArtifactSections(body);
  const allArtifactsPresent = Object.values(artifacts).every(Boolean);

  if (status === "todo") {
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

  if (status === "ready") {
    const acSection = extractGateSection(body, ["AC", "Acceptance Criteria"]);
    const checkboxes = acSection.match(/- \[[ xX]\]/g) || [];
    const checked = acSection.match(/- \[[xX]\]/g) || [];
    const acOk = checkboxes.length > 0 && checked.length === checkboxes.length;
    return {
      id,
      gate: "execute->done",
      ok: acOk,
      acTotal: checkboxes.length,
      acChecked: checked.length,
      reason: acOk
        ? "all AC checkboxes checked; eligible to move to done"
        : `${checked.length}/${checkboxes.length} AC checkboxes checked`,
    };
  }

  if (status === "done") {
    // Primitive-only scope (G5, see file header note): no children
    // re-verification (unlike native's compound-aware done branch).
    return { id, gate: "none", ok: true, reason: "terminal" };
  }

  if (status === "needs-human") {
    return { id, gate: "none", ok: false, reason: "soft stop; human action required" };
  }

  return { id, gate: "unknown", ok: false, reason: `unrecognized status ${status}` };
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

  // QN-024: data.write (status-only, minimal v1 write surface — G5, no
  // title/body/labels/parent/children writes). Reopens/closes the issue
  // and replaces status:* label(s) per computeStatusWrite's pure decision
  // logic above, then returns the fresh view-model (single-issue lookup,
  // so `parent` is left null per the existing get() limitation).
  function setStatus(id, status) {
    const m = /^gh-(\d+)$/.exec(id);
    if (!m) throw new Error(`quay-github: invalid task id for setStatus: ${id}`);
    const number = m[1];
    const issue = ghApiJson([`repos/${owner}/${repo}/issues/${number}`]);
    const currentLabelNames = (issue.labels ?? []).map((l) =>
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

  // QN-028: gate capability -- `check(id)` fetches the task (a single-issue
  // get(), so `parent` is left null per the existing get() limitation --
  // irrelevant to gate-checking, which only reads `status`/`body`) and
  // applies the pure checkGate() function above. Returns the same shape
  // native's own `check()` returns; `{id, ok:false, reason:"not found"}`
  // if the task does not exist, matching store.js's own not-found shape.
  function check(id) {
    const task = get(id);
    if (!task) return { id, ok: false, reason: "not found" };
    return checkGate(task);
  }

  return { list, get, setStatus, check };
}
