import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/serial-fanin-absorb.ts
import fs from "node:fs";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/serial-fanin-absorb.ts
function computeFanIn(startCounter, builds) {
  if (!Number.isInteger(startCounter) || startCounter < 0) {
    throw new Error(`computeFanIn: startCounter must be a non-negative integer (got ${startCounter})`);
  }
  if (!Array.isArray(builds) || builds.length === 0) {
    throw new Error("computeFanIn: empty builds \u2014 nothing to absorb");
  }
  const ids = /* @__PURE__ */ new Set();
  for (const b of builds) {
    if (!b || typeof b.id !== "string" || !b.id) throw new Error("computeFanIn: every build needs a string id");
    if (ids.has(b.id)) throw new Error(`computeFanIn: duplicate build id "${b.id}" \u2014 a batch cannot contain the same milestone twice`);
    ids.add(b.id);
    if (typeof b.dashboardEntry !== "string" || !b.dashboardEntry) {
      throw new Error(`computeFanIn: build "${b.id}" is missing a dashboardEntry \u2014 every absorbed milestone records one`);
    }
  }
  const order = [...builds].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const entries = order.map((b, i) => ({ id: b.id, milestone: startCounter + 1 + i, dashboardEntry: b.dashboardEntry }));
  return { counterBefore: startCounter, counterAfter: startCounter + builds.length, order: order.map((b) => b.id), entries };
}
function verifyMonotonic(plan) {
  if (!plan || !Array.isArray(plan.entries)) return false;
  const n = plan.entries.length;
  if (plan.counterAfter !== plan.counterBefore + n) return false;
  for (let i = 0; i < n; i++) {
    if (plan.entries[i].milestone !== plan.counterBefore + 1 + i) return false;
  }
  return true;
}
function renderDashboardAppend(plan) {
  const lines = ["", `<!-- serial fan-in ABSORB: counter ${plan.counterBefore} \u2192 ${plan.counterAfter} (${plan.entries.length} concurrent builds) -->`];
  for (const e of plan.entries) {
    lines.push(`## M${e.milestone} ABSORB (fan-in) \u2014 ${e.id}`, e.dashboardEntry, "");
  }
  return lines.join("\n");
}
function usage() {
  process.stderr.write("Usage: serial-fanin-absorb.mjs --counter <N> <builds-manifest.json>\n");
}
async function main(argv) {
  const args = argv.slice(2);
  let counter = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--counter") {
      counter = Number(args[++i]);
      continue;
    }
    files.push(args[i]);
  }
  if (counter === null || Number.isNaN(counter) || files.length !== 1) {
    usage();
    return 2;
  }
  if (!fs.existsSync(files[0])) {
    process.stderr.write(`ERROR: manifest not found: ${files[0]}
`);
    return 2;
  }
  let builds;
  try {
    builds = JSON.parse(fs.readFileSync(files[0], "utf8"));
  } catch (e) {
    process.stderr.write(`ERROR: manifest is not valid JSON: ${e.message}
`);
    return 2;
  }
  let plan;
  try {
    plan = computeFanIn(counter, builds);
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}
`);
    return 2;
  }
  if (!verifyMonotonic(plan)) {
    process.stderr.write("ERROR: computed plan failed monotonicity check\n");
    return 2;
  }
  process.stdout.write(`FAN-IN: counter ${plan.counterBefore} \u2192 ${plan.counterAfter}; order: ${plan.order.join(" \u2192 ")}
`);
  process.stdout.write(renderDashboardAppend(plan) + "\n");
  return 0;
}
if (isDirectEntry(import.meta, void 0, "serial-fanin-absorb")) {
  main(process.argv).then((code) => process.exit(code));
}
export {
  computeFanIn,
  main,
  renderDashboardAppend,
  verifyMonotonic
};
