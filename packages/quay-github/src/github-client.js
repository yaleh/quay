// Thin wrapper over `gh api` (CLI-first, matching quay-native's own design
// ethos — design §1; DESIGN.md §2). Reads real issues from a GitHub
// repository and maps them onto the canonical view-model (DESIGN.md §3).

import { execFileSync } from "node:child_process";

const STATUS_LABEL_RE = /^status:(.+)$/;
const LANE_LABEL_RE = /^lane:(.+)$/;

function ghApiJson(args) {
  const out = execFileSync("gh", ["api", ...args], { encoding: "utf8" });
  return JSON.parse(out);
}

/** DESIGN.md §3 — GitHub Issue -> canonical task view-model. */
export function issueToViewModel(issue) {
  const labelNames = (issue.labels ?? []).map((l) =>
    typeof l === "string" ? l : l.name
  );

  let status = "todo";
  let lane = null;
  const otherLabels = [];

  for (const name of labelNames) {
    const statusMatch = STATUS_LABEL_RE.exec(name);
    const laneMatch = LANE_LABEL_RE.exec(name);
    if (statusMatch) {
      status = statusMatch[1];
    } else if (laneMatch) {
      lane = laneMatch[1];
    } else {
      otherLabels.push(name);
    }
  }

  // issue.state == "closed" always wins -> done, regardless of any
  // status:* label left on a closed issue (DESIGN.md §3).
  if (issue.state === "closed") {
    status = "done";
  }

  return {
    id: `gh-${issue.number}`,
    title: issue.title,
    status,
    lane,
    labels: otherLabels,
    parent: null, // not implemented in v1 (DESIGN.md §3, §4 — known gap)
    children: [], // not implemented in v1
    role: "primitive", // derived, same convention as native (design §2); v1 has no children mapping so always primitive
    extra: {
      number: issue.number,
      html_url: issue.html_url,
      user: issue.user?.login ?? null,
      state: issue.state,
    },
    body: issue.body ?? "",
  };
}

/**
 * @param {{owner: string, repo: string}} opts
 */
export function createGithubClient({ owner, repo }) {
  function list({ status, label } = {}) {
    // gh api paginates; v1 keeps it simple (single page, --paginate for
    // completeness — this repo has few issues, no gold-plating needed yet).
    const issues = ghApiJson([
      `repos/${owner}/${repo}/issues`,
      "-X",
      "GET",
      "-f",
      "state=all",
      "--paginate",
    ]);
    let tasks = issues
      .filter((i) => !i.pull_request) // exclude PRs, which the issues API also returns
      .map(issueToViewModel);
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
    return issueToViewModel(issue);
  }

  return { list, get };
}
