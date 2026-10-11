import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/gate-scripts/drain-scheduler.ts
import fs from "node:fs";
import { fileURLToPath } from "node:url";
function parseDisposition(task) {
  if (!task || typeof task !== "object") throw new Error("drain-scheduler: task must be an object");
  if (!task.id || typeof task.id !== "string") throw new Error("drain-scheduler: task missing id");
  if (!task.title && typeof task.title !== "string") throw new Error(`drain-scheduler: ${task.id} missing title`);
  const extra = task.extra || {};
  const dirStatus = extra.dirStatus;
  if (dirStatus !== "pending") {
    return null;
  }
  return { id: task.id, title: task.title || "", extra, labels: task.labels || [] };
}
function classifyDirective(directive) {
  const labels = Array.isArray(directive.labels) ? directive.labels : [];
  const isMissionRedirect = directive.extra?.missionRedirection === true;
  const isHumanSteered = labels.some((l) => String(l).toLowerCase() === "human-steered");
  if (isMissionRedirect || isHumanSteered) {
    return "human-steered";
  }
  return "autonomous";
}
function dueDirectives(tasks) {
  if (!Array.isArray(tasks)) return [];
  const results = [];
  for (const task of tasks) {
    try {
      const d = parseDisposition(task);
      if (d === null) continue;
      const classification = classifyDirective(d);
      results.push({ id: d.id, title: d.title, classification });
    } catch (_e) {
    }
  }
  return results;
}
function usage() {
  process.stderr.write("Usage: drain-scheduler.ts --json [<directives.json>]\n");
}
async function main(argv) {
  const args = argv.slice(2);
  if (args.length < 1) {
    usage();
    return 2;
  }
  let jsonFlag = false;
  let filePath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") {
      jsonFlag = true;
      continue;
    }
    if (args[i] === "--help" || args[i] === "-h") {
      usage();
      return 2;
    }
    filePath = args[i];
  }
  if (!jsonFlag) {
    usage();
    return 2;
  }
  let raw;
  try {
    if (filePath) {
      if (!fs.existsSync(filePath)) {
        process.stderr.write(`ERROR: not found: ${filePath}
`);
        return 2;
      }
      raw = fs.readFileSync(filePath, "utf8");
    } else {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString("utf8");
    }
  } catch (e) {
    process.stderr.write(`ERROR: cannot read input: ${e.message}
`);
    return 2;
  }
  let tasks;
  try {
    tasks = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`ERROR: not valid JSON: ${e.message}
`);
    return 2;
  }
  let due;
  try {
    due = dueDirectives(tasks);
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}
`);
    return 2;
  }
  if (due.length === 0) {
    process.stdout.write("{}\n");
    return 3;
  }
  process.stdout.write(JSON.stringify(due) + "\n");
  return 0;
}
var isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv).then((c) => process.exit(c));
}
export {
  classifyDirective,
  dueDirectives,
  main,
  parseDisposition
};
