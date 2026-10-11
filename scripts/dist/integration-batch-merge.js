#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/integration-batch-merge.ts
import { spawn, spawnSync } from "node:child_process";
import * as fs2 from "node:fs";
import * as os from "node:os";
import * as path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path.join(dir, "plugin")) && fs.existsSync(path.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/integration-batch-merge.ts
var say = (m) => {
  process.stdout.write(m + "\n");
};
var err = (m) => {
  process.stderr.write(m + "\n");
};
var stripNl = (s) => s.replace(/\n+$/, "");
var linesOf = (s) => s.split("\n");
var SELF = fileURLToPath2(import.meta.url);
var HELP_FIRST_LINE = "\u7528\u6CD5: bash integration-batch-merge.sh [\u53C2\u6570\u2026] \u2014 \u8BE6\u89C1\u4E0B\u65B9\u811A\u672C\u5934\u90E8\u7528\u6CD5\u6CE8\u91CA\uFF08--help|-h \u4EC5\u6253\u5370\u7528\u6CD5\uFF0C\u65E0\u526F\u4F5C\u7528\uFF0C\u9000\u51FA 0\uFF09";
function headerCommentLines(limit, stopAtFirstCode) {
  const src = fs2.readFileSync(SELF, "utf8").split("\n");
  const out = [];
  const n = Math.min(limit, src.length);
  for (let i = 1; i < n; i++) {
    const line = src[i];
    if (!/^(#|\/\/)/.test(line)) {
      if (stopAtFirstCode) break;
      continue;
    }
    const stripped = line.replace(/^(#|\/\/) ?/, "");
    if (stripped.startsWith("!")) continue;
    out.push(stripped);
  }
  return out;
}
if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  say(HELP_FIRST_LINE);
  for (const l of headerCommentLines(120, false)) say(l);
  process.exit(0);
}
var SCRIPT_DIR = path2.dirname(SELF);
var repoRoot2 = repoRoot();
function git(...args) {
  return gitAt(repoRoot2, ...args);
}
function gitAt(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: r.status === null ? 127 : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function gitOut(...args) {
  const r = git(...args);
  return r.status === 0 ? stripNl(r.stdout) : "";
}
function runShellMerged(script, args) {
  const r = spawnSync("bash", ["-c", 'exec bash "$0" "$@" 2>&1', script, ...args], { encoding: "utf8" });
  return { status: r.status === null ? 127 : r.status, stdout: r.stdout ?? "", stderr: "" };
}
var argv = process.argv.slice(2);
var developRef = "develop";
var integrationRef = "integration";
var dryRun = 0;
var sync = 0;
var syncPull = 0;
var deliver = 0;
var mergeMode = 0;
var reconcile = 0;
var fanInTask = "";
var runId = "";
var skipFreshnessGate = 0;
var freshnessWindow = 3600;
var suiteStateFile = "";
var skipWorktreeGreenGate = 0;
var sharedPatterns = ["*tick-log.md", "tasks/*.md", "*queue-state*"];
var intAuthoritativePatterns = [];
var reverseEdgeCriterion = "";
var wouldConflicts = [];
function usage() {
  for (const l of headerCommentLines(Number.MAX_SAFE_INTEGER, true)) err(l);
  process.exit(2);
}
{
  let i = 0;
  const nextValue = (flag) => {
    i++;
    if (i >= argv.length) {
      err(`integration-batch-merge: ${flag} requires a value`);
      process.exit(2);
    }
    return argv[i];
  };
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--root") repoRoot2 = nextValue(a);
    else if (a === "--develop") developRef = nextValue(a);
    else if (a === "--integration") integrationRef = nextValue(a);
    else if (a === "--dry-run") dryRun = 1;
    else if (a === "--merge") mergeMode = 1;
    else if (a === "--shared-file") sharedPatterns.push(nextValue(a));
    else if (a === "--integration-authoritative") intAuthoritativePatterns.push(nextValue(a));
    else if (a === "--reverse-edge-criterion") reverseEdgeCriterion = nextValue(a);
    else if (a === "--sync") sync = 1;
    else if (a === "--sync-pull") syncPull = 1;
    else if (a === "--deliver") deliver = 1;
    else if (a === "--reconcile") reconcile = 1;
    else if (a === "--run-id") runId = nextValue(a);
    else if (a === "--skip-freshness-gate") skipFreshnessGate = 1;
    else if (a === "--skip-worktree-green-gate") skipWorktreeGreenGate = 1;
    else if (a === "--freshness-window") freshnessWindow = Number(nextValue(a));
    else if (a === "--suite-state-file") suiteStateFile = nextValue(a);
    else if (a === "--fan-in") fanInTask = nextValue(a);
    else usage();
    i++;
  }
}
if (!fs2.existsSync(path2.join(repoRoot2, ".git"))) {
  err(`integration-batch-merge: not a git repo: ${repoRoot2}`);
  process.exit(2);
}
var globCache = /* @__PURE__ */ new Map();
function globMatch(pattern, value) {
  let re = globCache.get(pattern);
  if (re === void 0) {
    let body = "";
    for (const ch of pattern) {
      if (ch === "*") body += ".*";
      else if (ch === "?") body += ".";
      else body += ch.replace(/[.+^${}()|[\]\\]/, "\\$&");
    }
    re = new RegExp(`^${body}$`);
    globCache.set(pattern, re);
  }
  return re.test(value);
}
function isSharedFile(p) {
  return sharedPatterns.some((pat) => globMatch(pat, p));
}
function isIntegrationAuthoritativeFile(p) {
  return intAuthoritativePatterns.some((pat) => globMatch(pat, p));
}
function stopSessionsUnderWorktree(wt) {
  if (!wt) return;
  const osc = path2.join(SCRIPT_DIR, "orphan-session-check.ts");
  if (!fs2.existsSync(osc)) {
    err(`integration-batch-merge: WARNING orphan-session-check.ts not found at ${osc} \u2014 sessions under ${wt} not stopped (leak risk)`);
    return;
  }
  try {
    spawnSync("node", ["--no-warnings", "--experimental-strip-types", osc, "--kill-workspace", wt], { stdio: "ignore" });
  } catch {
  }
}
function criterionSatisfied(wt, p) {
  const content = gitAt(wt, "show", `:3:${p}`);
  const payload = content.status === 0 ? stripNl(content.stdout) : "";
  const r = spawnSync("bash", [reverseEdgeCriterion, p], { input: payload + "\n", encoding: "utf8" });
  return r.status === 0;
}
function resolveAsOurs(wt, p) {
  if (gitAt(wt, "checkout", "--ours", "--", p).status === 0) {
    gitAt(wt, "add", "--", p);
  } else {
    gitAt(wt, "rm", "-q", "--", p);
  }
}
function resolveAsTheirs(wt, p) {
  if (gitAt(wt, "checkout", "--theirs", "--", p).status === 0) {
    gitAt(wt, "add", "--", p);
  } else {
    gitAt(wt, "rm", "-q", "--", p);
  }
}
function reportDivergence() {
  wouldConflicts = [];
  const devOnly = gitOut("rev-list", "--count", `refs/heads/${integrationRef}..refs/heads/${developRef}`) || "0";
  const intOnly = gitOut("rev-list", "--count", `refs/heads/${developRef}..refs/heads/${integrationRef}`) || "0";
  say("integration-batch-merge: DIVERGENCE \u2014 develop and integration have diverged (NOT a fast-forward)");
  say(`integration-batch-merge:   develop-only commits:     ${devOnly}`);
  say(`integration-batch-merge:   integration-only commits: ${intOnly}`);
  const mt = git("merge-tree", "--write-tree", "--name-only", `refs/heads/${developRef}`, `refs/heads/${integrationRef}`);
  if (mt.status === 1) {
    const rest = linesOf(stripNl(mt.stdout)).slice(1);
    for (const l of rest) {
      if (l === "") break;
      wouldConflicts.push(l);
    }
  }
  if (wouldConflicts.length > 0) {
    say("integration-batch-merge:   would-conflict files:");
    for (const p of wouldConflicts) say(`integration-batch-merge:     ${p}`);
  } else {
    say("integration-batch-merge:   would-conflict files: (none \u2014 changes are file-disjoint)");
  }
}
function reportConflictClassification(paths) {
  const shared = [];
  const intAuth = [];
  const code = [];
  for (const p of paths) {
    if (isIntegrationAuthoritativeFile(p)) intAuth.push(p);
    else if (isSharedFile(p)) shared.push(p);
    else code.push(p);
  }
  say("integration-batch-merge:   conflict classification:");
  say(`integration-batch-merge:     shared (auto-resolve develop-authoritative): ${shared.length}`);
  for (const p of shared) say(`integration-batch-merge:       ${p}`);
  say(`integration-batch-merge:     integration-authoritative (reverse-edge, integration side): ${intAuth.length}`);
  for (const p of intAuth) say(`integration-batch-merge:       ${p}`);
  say(`integration-batch-merge:     code (fail-closed, needs human):             ${code.length}`);
  for (const p of code) say(`integration-batch-merge:       ${p}`);
}
function doSync() {
  if (sync !== 1) return;
  const slc = path2.join(SCRIPT_DIR, "sync-lag-check.sh");
  if (fs2.existsSync(slc)) {
    const r = runShellMerged(slc, ["--root", repoRoot2, "--branch", developRef, "--remote", "origin", "--push"]);
    for (const l of linesOf(stripNl(r.stdout))) say(l);
    if (r.status !== 0) {
      err(`integration-batch-merge: SYNC-PUSH FAILED (exit ${r.status}) \u2014 develop advanced locally but origin/${developRef} NOT updated; the every-tick heartbeat will retry (divergence = human resolution)`);
    } else {
      say("integration-batch-merge: sync-push ok (develop \u2192 origin, same round as the land closure)");
    }
  } else {
    err(`integration-batch-merge: --sync requested but sync-lag-check.sh not found at ${slc}; skipping event-driven push (heartbeat will cover it)`);
  }
}
function doDeliver() {
  if (deliver !== 1) return;
  const dds = path2.join(SCRIPT_DIR, "develop-deliver-tgz.sh");
  if (!fs2.existsSync(dds)) {
    err(`integration-batch-merge: --deliver requested but develop-deliver-tgz.sh not found at ${dds}; skipping`);
    return;
  }
  const deliverLog = path2.join(repoRoot2, ".quay", "deliver-run.log");
  say(`integration-batch-merge: launching detached develop-deliver-tgz.sh (log: ${deliverLog}) \u2014 does NOT block this merge`);
  try {
    const fd = fs2.openSync(deliverLog, "w");
    const child = spawn("setsid", ["bash", dds, "--root", repoRoot2], { detached: true, stdio: ["ignore", fd, fd] });
    child.on("error", () => {
    });
    child.unref();
    fs2.closeSync(fd);
  } catch {
  }
}
function reconcileApplies() {
  const r = git("branch", "--show-current");
  return r.status === 0 && stripNl(r.stdout) === developRef;
}
function reconcileGuard() {
  if (!reconcileApplies()) {
    const r = git("branch", "--show-current");
    const branch = r.status === 0 ? stripNl(r.stdout) : "<detached>";
    say(`integration-batch-merge: reconcile: primary checkout on '${branch}' (not '${developRef}') \u2014 index refresh not needed`);
    return true;
  }
  const porcelain = stripNl(git("status", "--porcelain").stdout);
  if (porcelain !== "") {
    err("integration-batch-merge: reconcile FAIL-CLOSED \u2014 primary checkout has uncommitted/untracked changes; NOT moving any ref");
    err(`integration-batch-merge:   primary checkout: ${repoRoot2}`);
    err(`integration-batch-merge:   branch: ${developRef}`);
    err("integration-batch-merge:   porcelain (resolve these file owners before re-running --reconcile):");
    for (const l of linesOf(porcelain)) err(`integration-batch-merge:     ${l}`);
    return false;
  }
  say("integration-batch-merge: reconcile: primary checkout clean (porcelain empty) \u2014 safe to proceed");
  return true;
}
function reconcileIndex(newTip) {
  if (!reconcileApplies()) {
    const r2 = git("branch", "--show-current");
    const branch = r2.status === 0 ? stripNl(r2.stdout) : "<detached>";
    say(`integration-batch-merge: reconcile: primary checkout on '${branch}' (not '${developRef}') \u2014 index refresh not needed`);
    return true;
  }
  say(`integration-batch-merge: reconcile: git reset --mixed ${newTip} (refresh index only; NEVER --hard; working-tree files untouched)`);
  const r = git("reset", "--mixed", newTip);
  if (r.status !== 0) {
    err(`integration-batch-merge: reconcile: git reset --mixed FAILED (exit ${r.status}); index NOT refreshed \u2014 needs human`);
    return false;
  }
  say(`integration-batch-merge: reconcile: index refreshed to develop tip ${newTip}; working-tree files untouched`);
  return true;
}
function checkObjectGate(mergeTarget2, mergeUsesVerified2) {
  const mb = gitOut("merge-base", mergeTarget2, `refs/heads/${developRef}`);
  if (mb === "") {
    err(`integration-batch-merge: object-gate: no merge-base between ${mergeTarget2} and ${developRef} \u2014 unrelated histories, skipping gate (downstream will fail closed)`);
    say("integration-batch-merge: measure unmerged_develop_files=0");
    return true;
  }
  const diff = git("diff", "--name-only", mb, `refs/heads/${developRef}`);
  const codeFiles = linesOf(diff.stdout).filter((l) => /\.(ts|js|mjs|sh)$/.test(l));
  if (codeFiles.length === 0) {
    say("integration-batch-merge: measure unmerged_develop_files=0");
    return true;
  }
  say(`integration-batch-merge: measure unmerged_develop_files=${codeFiles.length}`);
  say(`integration-batch-merge:   develop-side code files that never entered the tested tree (${mergeTarget2}):`);
  for (const f of codeFiles) say(`integration-batch-merge:     ${f}`);
  if (dryRun === 1) {
    say("integration-batch-merge: DRY-RUN \u2014 object gate WOULD fail closed (no ref moved in dry-run)");
    return true;
  }
  err(`integration-batch-merge: OBJECT-GATE FAIL-CLOSED \u2014 the MERGE RESULT (${mergeTarget2} \u2295 ${developRef}) would ship untested code; nothing moved`);
  if (mergeUsesVerified2 === 1) {
    err(`integration-batch-merge:   tested tree = verified commit ${mergeTarget2} (the point the green suite tested)`);
  } else {
    err(`integration-batch-merge:   tested tree = integration tip (${mergeTarget2})`);
  }
  err(`integration-batch-merge:   fix: fan-in the ${developRef}-side commit into ${integrationRef} (re-test the merged tree), then re-run`);
  return false;
}
function readJsonField(file, key) {
  try {
    const parsed = JSON.parse(fs2.readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object") return "";
    const v = parsed[key];
    if (v === void 0) return "";
    return String(v);
  } catch {
    return "";
  }
}
function pendingIsDocOnly(startedEpoch) {
  let suiteTip = gitOut("rev-list", "-1", `--before=${startedEpoch}`, `refs/heads/${integrationRef}`);
  if (suiteTip === "") {
    suiteTip = stripNl(git("hash-object", "-t", "tree", "/dev/null").stdout);
  }
  const changed = linesOf(git("diff", "--name-only", suiteTip, `refs/heads/${integrationRef}`).stdout).filter((l) => l !== "");
  if (changed.length === 0) return true;
  return changed.every((f) => /\.(md|jsonl)$/.test(f));
}
function checkFreshnessGate(mergeTarget2) {
  if (skipFreshnessGate === 1) {
    say("integration-batch-merge: freshness-gate SKIPPED (--skip-freshness-gate)");
    return true;
  }
  const failClosed = (verdict, measure) => {
    say(measure);
    if (dryRun === 1) {
      say(`integration-batch-merge: DRY-RUN \u2014 freshness gate WOULD fail closed: ${verdict} (no ref moved in dry-run)`);
      return true;
    }
    err(`integration-batch-merge: FRESHNESS-GATE FAIL-CLOSED \u2014 ${verdict}; nothing moved`);
    return false;
  };
  if (!fs2.existsSync(stateFile)) {
    return failClosed(`suite-state file not found at ${stateFile} (no valid green)`, "integration-batch-merge: measure suite_freshness=unknown");
  }
  const state = readJsonField(stateFile, "state");
  if (state !== "green") {
    return failClosed(`suite-state state='${state === "" ? "<missing>" : state}' (batch merge requires state==green)`, "integration-batch-merge: measure suite_freshness=unknown");
  }
  const scope = readJsonField(stateFile, "scope");
  if (scope !== "" && scope !== "main") {
    return failClosed(
      `suite-state scope='${scope}' (batch merge requires a MAIN-sourced green \u2014 a worktree green is deferrable and may not have tested the merge target)`,
      "integration-batch-merge: measure suite_freshness=unknown"
    );
  }
  let startedEpoch = Number.NaN;
  let age = "unparseable";
  try {
    const d = JSON.parse(fs2.readFileSync(stateFile, "utf8"));
    const f = d["finishedAt"];
    if (f === void 0 || f === null) {
      age = "missing";
    } else {
      let ts;
      if (typeof f === "number") {
        ts = f;
      } else {
        ts = Date.parse(String(f).replace("Z", "+00:00")) / 1e3;
        if (Number.isNaN(ts)) {
          age = "unparseable";
          ts = Number.NaN;
        }
      }
      if (!Number.isNaN(ts)) {
        const s = d["startedAt"];
        let st;
        if (typeof s === "number") {
          st = s;
        } else {
          st = s ? Date.parse(String(s).replace("Z", "+00:00")) / 1e3 : ts;
          if (Number.isNaN(st)) st = ts;
        }
        startedEpoch = Math.trunc(st);
        age = Math.trunc(Date.now() / 1e3 - ts);
      }
    }
  } catch {
    age = "unparseable";
  }
  if (age === "missing" || age === "unparseable") {
    return failClosed("suite-state finishedAt missing/unparseable (no valid green)", "integration-batch-merge: measure suite_freshness=unknown");
  }
  if (age > freshnessWindow) {
    return failClosed(`suite green finished ${age}s ago (> window ${freshnessWindow}s) \u2014 STALE`, `integration-batch-merge: measure suite_freshness=${age}`);
  }
  const lastFanin = gitOut("log", "-1", "--format=%ct", mergeTarget2);
  if (lastFanin !== "" && startedEpoch < Number(lastFanin)) {
    if (pendingIsDocOnly(startedEpoch)) {
      say("integration-batch-merge: freshness-gate DOC-ONLY EXEMPT \u2014 the fan-in(s) after the suite started touch only .md/.jsonl (doc-only); the green still covers the test surface \u2014 no re-run needed");
      say(`integration-batch-merge: measure suite_freshness=${age}`);
      return true;
    }
    return failClosed(
      `a fan-in landed on ${integrationRef} after the suite started (last fan-in ${lastFanin}s epoch > suite start ${startedEpoch}s) \u2014 the green did NOT test the pending merge point ${mergeTarget2}`,
      `integration-batch-merge: measure suite_freshness=${age}`
    );
  }
  say(`integration-batch-merge: freshness-gate OK \u2014 fresh green (finished ${age}s ago, window ${freshnessWindow}s; suite start ${startedEpoch}s \u2265 last fan-in ${lastFanin === "" ? "<none>" : lastFanin} at merge point ${mergeTarget2})`);
  say(`integration-batch-merge: measure suite_freshness=${age}`);
  return true;
}
function checkWorktreeGreenGate() {
  if (skipWorktreeGreenGate === 1) {
    say("integration-batch-merge: worktree-green-gate SKIPPED (--skip-worktree-green-gate)");
    return true;
  }
  const roundFile = path2.join(repoRoot2, ".quay", "verification-round.jsonl");
  let has = false;
  try {
    for (const l of linesOf(fs2.readFileSync(roundFile, "utf8"))) {
      if (l.trim() === "") continue;
      const r = JSON.parse(l);
      if (r["scope"] === "worktree" && r["state"] === "green") {
        has = true;
        break;
      }
    }
  } catch {
    has = false;
  }
  if (has) {
    say("integration-batch-merge: worktree-green-gate OK \u2014 \u22651 scope=worktree+state=green round on record");
    say("integration-batch-merge: measure has_worktree_green_round=True");
    return true;
  }
  say("integration-batch-merge: measure has_worktree_green_round=False");
  if (dryRun === 1) {
    say(`integration-batch-merge: DRY-RUN \u2014 worktree-green gate WOULD fail closed: no scope=worktree+state=green round in ${roundFile} (no ref moved in dry-run)`);
    return true;
  }
  err(`integration-batch-merge: WORKTREE-GREEN-GATE FAIL-CLOSED \u2014 no scope=worktree+state=green round in ${roundFile}; the suite-fix subagent never self-tested green in its OWN worktree \u21D2 \u4E0D\u8BB8 merge\uFF08\u4E0D\u81EA\u6D4B\u7EFF\u4E0D\u8BB8\u5408\uFF09; nothing moved`);
  err("integration-batch-merge:   fix: \u5148\u5728\u81EA\u5DF1 worktree \u81EA\u6D4B\u7EFF\uFF1Anode --test <\u6587\u4EF6> \u6216 scoped test.sh\uFF08bash scripts/test.sh --for-task <task-id> --allow-thin\uFF09\uFF0C\u5F97\u5230 scope=worktree+state=green \u8BB0\u5F55\u540E\u518D fan-in");
  err("integration-batch-merge:   \u6CE8\u610F\uFF1Ascoped \u81EA\u6D4B\u82E5\u4E00\u4E2A\u6D4B\u8BD5\u6587\u4EF6\u90FD\u6CA1\u9009\u4E2D\uFF08Touches \u65E0 *.test.*\uFF09\uFF0C\u90A3\u662F\u3010\u6CA1\u6D4B\u3011\uFF0C\u4E0D\u662F\u3010\u6D4B\u7EFF\u3011\u2014\u2014\u8BF7\u6253 SCOPED-THIN \u6807\u8BB0\uFF08\u26D4 \u522B\u628A exit 0 \u5F53\u7EFF\uFF09\uFF0C\u5E76\u8DD1\u4E00\u4E2A\u771F\u80FD\u6D4B\u5230\u4F60\u4EA4\u4ED8\u7269\u7684\u68C0\u67E5");
  return false;
}
if (fanInTask !== "") {
  if (runId === "") {
    err("integration-batch-merge: --fan-in requires --run-id <runId> (the runId from fast-mode-telemetry.ts --task-start)");
    process.exit(2);
  }
  if (/[^A-Za-z0-9._-]/.test(runId)) {
    err(`integration-batch-merge: --run-id "${runId}" is not filename-safe (must match [A-Za-z0-9._-]+, the telemetry runId shape)`);
    process.exit(2);
  }
  if (git("rev-parse", "--verify", "--quiet", `refs/heads/task/${fanInTask}`).status !== 0) {
    err(`integration-batch-merge: fan-in failed \u2014 task branch task/${fanInTask} not found`);
    process.exit(1);
  }
  if (git("merge", "--no-ff", `task/${fanInTask}`, "-m", `merge: fan-in task/${fanInTask} (runId: ${runId})`).status !== 0) {
    git("merge", "--abort");
    err(`integration-batch-merge: fan-in FAILED \u2014 merge of task/${fanInTask} aborted (conflict or error); nothing merged`);
    process.exit(1);
  }
  const fanInSha = stripNl(git("rev-parse", "HEAD").stdout);
  const br = git("branch", "--show-current");
  const fanInTarget = br.status === 0 ? stripNl(br.stdout) : "<detached>";
  say(`integration-batch-merge: fan-in OK \u2014 task/${fanInTask} merged into ${fanInTarget} (commit ${fanInSha}) with runId ${runId}`);
  say("integration-batch-merge: measure fanin_runid_present=true");
  process.exit(0);
}
if (git("rev-parse", "--verify", "--quiet", `refs/heads/${developRef}`).status !== 0) {
  err(`integration-batch-merge: develop ref not found: ${developRef}`);
  process.exit(2);
}
if (git("rev-parse", "--verify", "--quiet", `refs/heads/${integrationRef}`).status !== 0) {
  err(`integration-batch-merge: integration ref not found: ${integrationRef}`);
  process.exit(2);
}
if (syncPull === 1) {
  const slc = path2.join(SCRIPT_DIR, "sync-lag-check.sh");
  if (fs2.existsSync(slc)) {
    const sp = runShellMerged(slc, ["--root", repoRoot2, "--branch", developRef, "--remote", "origin", "--pull"]);
    for (const l of linesOf(stripNl(sp.stdout))) say(l);
    if (sp.status !== 0) {
      err(`integration-batch-merge: --sync-pull downsync FAILED (exit ${sp.status}) \u2014 local ${developRef} and origin/${developRef} diverged or origin unreachable; NOT batch-merging on a diverged base (never a blind --ours/--theirs); nothing moved`);
      process.exit(1);
    }
  } else {
    err(`integration-batch-merge: --sync-pull requested but sync-lag-check.sh not found at ${slc}; skipping downsync (merge base may be stale)`);
  }
}
var developTip = stripNl(git("rev-parse", `refs/heads/${developRef}`).stdout);
var integrationTip = stripNl(git("rev-parse", `refs/heads/${integrationRef}`).stdout);
var stateFile = suiteStateFile !== "" ? suiteStateFile : path2.join(repoRoot2, ".quay", "full-suite-state.json");
var verifiedCommit = "";
var mergeTarget = "";
var mergeUsesVerified = 0;
if (fs2.existsSync(stateFile)) {
  verifiedCommit = readJsonField(stateFile, "verifiedCommit");
}
if (verifiedCommit !== "") {
  if (git("rev-parse", "--verify", "--quiet", `${verifiedCommit}^{commit}`).status === 0 && git("merge-base", "--is-ancestor", `${verifiedCommit}^{commit}`, `refs/heads/${integrationRef}`).status === 0) {
    mergeTarget = stripNl(git("rev-parse", `${verifiedCommit}^{commit}`).stdout);
    mergeUsesVerified = 1;
  } else {
    err(`integration-batch-merge: verifiedCommit ${verifiedCommit} (from ${stateFile}) is not a resolvable commit on ${integrationRef} \u2014 falling back to integration HEAD (COVERAGE will fail closed if that tip is untested)`);
  }
}
if (mergeTarget === "") {
  mergeTarget = integrationTip;
}
if (mergeUsesVerified === 1) {
  say(`integration-batch-merge: MERGE-TO-VERIFIED-COMMIT \u2014 merging the verified commit ${mergeTarget} (the point the green suite tested) instead of integration HEAD ${integrationTip}`);
}
var tmpWt = "";
var tmpWtCleaned = false;
function cleanupTmpWt() {
  if (tmpWt === "" || tmpWtCleaned) return;
  tmpWtCleaned = true;
  stopSessionsUnderWorktree(tmpWt);
  git("worktree", "remove", "--force", tmpWt);
  try {
    fs2.rmSync(tmpWt, { recursive: true, force: true });
  } catch {
  }
}
process.on("exit", cleanupTmpWt);
function realMerge() {
  try {
    tmpWt = fs2.mkdtempSync(path2.join(os.tmpdir(), "integration-batch-merge."));
  } catch {
    err("integration-batch-merge: mktemp failed");
    return false;
  }
  tmpWtCleaned = false;
  if (git("worktree", "add", "-q", "--detach", tmpWt, developTip).status !== 0) {
    err(`integration-batch-merge: real-merge failed \u2014 could not create temp worktree at ${tmpWt}`);
    return false;
  }
  const merged = gitAt(tmpWt, "merge", "--no-ff", "--no-commit", mergeTarget);
  if (merged.status !== 0) {
    const conflicts = linesOf(gitAt(tmpWt, "diff", "--name-only", "--diff-filter=U").stdout).filter((l) => l !== "");
    if (conflicts.length === 0) {
      err("integration-batch-merge: real-merge aborted for a non-conflict reason (nothing moved)");
      gitAt(tmpWt, "merge", "--abort");
      return false;
    }
    let sharedConflicts = [];
    let intAuthConflicts = [];
    const codeConflicts = [];
    for (const p of conflicts) {
      if (isIntegrationAuthoritativeFile(p)) intAuthConflicts.push(p);
      else if (isSharedFile(p)) sharedConflicts.push(p);
      else codeConflicts.push(p);
    }
    if (intAuthConflicts.length > 0 && reverseEdgeCriterion !== "") {
      const stillIntAuth = [];
      for (const p of intAuthConflicts) {
        if (criterionSatisfied(tmpWt, p)) {
          say(`integration-batch-merge:   content criterion satisfied for ${p} \u2192 integration-authoritative`);
          stillIntAuth.push(p);
        } else {
          err(`integration-batch-merge:   content criterion NOT satisfied for ${p} \u2192 genuine conflict (FAIL-CLOSED, needs a human)`);
          codeConflicts.push(p);
        }
      }
      intAuthConflicts = stillIntAuth;
    }
    if (codeConflicts.length > 0) {
      err("integration-batch-merge: REAL-MERGE FAIL-CLOSED \u2014 code conflicts need a human; nothing moved");
      err("integration-batch-merge:   code conflict files:");
      for (const p of codeConflicts) err(`integration-batch-merge:     ${p}`);
      if (sharedConflicts.length > 0) {
        err("integration-batch-merge:   (shared files would auto-resolve develop-authoritative, but code conflicts block):");
        for (const p of sharedConflicts) err(`integration-batch-merge:     ${p}`);
      }
      if (intAuthConflicts.length > 0) {
        err("integration-batch-merge:   (reverse-edge files would resolve to the integration side, but code conflicts block):");
        for (const p of intAuthConflicts) err(`integration-batch-merge:     ${p}`);
      }
      gitAt(tmpWt, "merge", "--abort");
      return false;
    }
    if (intAuthConflicts.length > 0) {
      say(`integration-batch-merge: resolving integration-authoritative conflicts (integration side, ${intAuthConflicts.length}):`);
      for (const p of intAuthConflicts) {
        say(`integration-batch-merge:   ${p}`);
        resolveAsTheirs(tmpWt, p);
      }
    }
    if (sharedConflicts.length > 0) {
      say(`integration-batch-merge: auto-resolving shared-file conflicts develop-authoritative (${sharedConflicts.length}):`);
      for (const p of sharedConflicts) {
        say(`integration-batch-merge:   ${p}`);
        resolveAsOurs(tmpWt, p);
      }
    }
  }
  if (runId !== "") {
    say(`integration-batch-merge: real-merge commit carries runId ${runId}`);
    if (gitAt(tmpWt, "commit", "-q", "-m", `merge: fan-in ${integrationRef}\u2192${developRef} (runId: ${runId})`).status !== 0) {
      err("integration-batch-merge: real-merge commit failed (nothing moved)");
      gitAt(tmpWt, "merge", "--abort");
      return false;
    }
    say("integration-batch-merge: measure fanin_runid_present=true");
  } else {
    if (gitAt(tmpWt, "commit", "-q", "--no-edit").status !== 0) {
      err("integration-batch-merge: real-merge commit failed (nothing moved)");
      gitAt(tmpWt, "merge", "--abort");
      return false;
    }
  }
  const mergeCommit = stripNl(gitAt(tmpWt, "rev-parse", "HEAD").stdout);
  if (git("update-ref", "-m", `quay-ref-landing: real-merge ${developTip} -> ${mergeCommit}`, `refs/heads/${developRef}`, mergeCommit, developTip).status !== 0) {
    err("integration-batch-merge: update-ref CAS failed \u2014 develop moved concurrently? Nothing changed.");
    return false;
  }
  if (git("merge-base", "--is-ancestor", mergeTarget, `refs/heads/${developRef}`).status === 0) {
    say(`integration-batch-merge: OK \u2014 develop real-merged to ${mergeTarget} (merge commit ${mergeCommit})`);
    if (mergeUsesVerified === 1 && mergeTarget !== integrationTip) {
      say(`integration-batch-merge:   integration HEAD ${integrationTip} still has newer untested commits \u2014 they await the next green (nothing silently dropped)`);
      say("integration-batch-merge: measure integration_ff_merges=1");
    } else {
      say("integration-batch-merge: measure integration_ff_merges=0");
    }
    doSync();
    doDeliver();
    if (reconcile === 1 && dryRun === 0) {
      if (!reconcileIndex(mergeCommit)) return false;
    }
    return true;
  }
  err(`integration-batch-merge: post-measure FAILED \u2014 merge target ${mergeTarget} not ancestor of develop after real merge; needs human`);
  return false;
}
if (git("merge-base", "--is-ancestor", mergeTarget, `refs/heads/${developRef}`).status === 0) {
  if (dryRun === 1) {
    say("integration-batch-merge: DRY-RUN (no ref moved)");
    say(`integration-batch-merge: develop=${developTip} integration=${integrationTip}`);
  }
  if (mergeUsesVerified === 1 && mergeTarget !== integrationTip) {
    say(`integration-batch-merge: OK \u2014 verified commit ${mergeTarget} is already an ancestor of develop (the tested point is merged; integration HEAD ${integrationTip} has newer untested commits that await the next green)`);
  } else {
    say("integration-batch-merge: OK \u2014 integration is already an ancestor of develop (nothing pending)");
  }
  say("integration-batch-merge: measure integration_ff_merges=0");
  process.exit(0);
}
if (!checkObjectGate(mergeTarget, mergeUsesVerified)) process.exit(1);
if (!checkFreshnessGate(mergeTarget)) process.exit(1);
if (!checkWorktreeGreenGate()) process.exit(1);
if (reconcile === 1) {
  if (dryRun === 1) {
    if (reconcileApplies()) {
      const porcelain = stripNl(git("status", "--porcelain").stdout);
      say(`integration-batch-merge: DRY-RUN --reconcile: primary checkout (on ${developRef}) porcelain would-be-empty: ${porcelain === "" ? "yes" : "NO"}`);
      if (porcelain === "") say("integration-batch-merge: DRY-RUN --reconcile: guard would PASS; post-merge reconcile = git reset --mixed <new develop tip> (index only)");
    } else {
      say(`integration-batch-merge: DRY-RUN --reconcile: primary checkout not on ${developRef} \u2014 reconcile not needed`);
    }
  } else {
    if (!reconcileGuard()) process.exit(1);
  }
}
var ffPossible = git("merge-base", "--is-ancestor", `refs/heads/${developRef}`, mergeTarget).status === 0 ? 1 : 0;
var pending = gitOut("log", "--oneline", `refs/heads/${developRef}..${mergeTarget}`);
var deferred = gitOut("log", "--oneline", `${mergeTarget}..refs/heads/${integrationRef}`);
if (dryRun === 1) {
  say("integration-batch-merge: DRY-RUN (no ref moved)");
  say(`integration-batch-merge: develop=${developTip} integration=${integrationTip}`);
  if (ffPossible === 1) {
    say(`integration-batch-merge: FF-OK \u2014 ${developRef} is an ancestor of the merge target ${mergeTarget}`);
    say("integration-batch-merge: pending on integration:");
    say(`integration-batch-merge:   (merge surface ${developRef}..${mergeTarget})`);
    for (const l of linesOf(pending)) say(`    ${l}`);
    if (mergeUsesVerified === 1 && deferred !== "") {
      const deferredCount = linesOf(deferred).filter((l) => l !== "").length;
      say(`integration-batch-merge:   (${deferredCount} newer untested commit(s) on integration HEAD ${integrationTip} deferred to the next green \u2014 the verified commit is what the suite tested)`);
    }
  } else {
    reportDivergence();
    if (mergeMode === 1) reportConflictClassification(wouldConflicts);
    err(`integration-batch-merge: NOT-FAST-FORWARD \u2014 the merge target ${mergeTarget} is not a descendant of develop; needs a human (pass --merge to real-merge auto-resolving shared files develop-authoritative and reverse-edge files integration-authoritative)`);
    process.exit(1);
  }
  if (git("merge-base", "--is-ancestor", mergeTarget, `refs/heads/${developRef}`).status === 0) {
    say(`integration-batch-merge: measure integration_ff_merges=0 (post: merge target ${mergeTarget} is ancestor of develop)`);
  } else {
    say(`integration-batch-merge: measure integration_ff_merges=1 (post: merge target NOT yet ancestor \u2014 merge pending)`);
  }
  process.exit(0);
}
if (ffPossible === 1) {
  if (git("update-ref", "-m", `quay-ref-landing: fast-forward ${developTip} -> ${mergeTarget}`, `refs/heads/${developRef}`, mergeTarget, developTip).status !== 0) {
    err("integration-batch-merge: update-ref CAS failed \u2014 develop moved concurrently? Nothing changed.");
    process.exit(1);
  }
  if (git("merge-base", "--is-ancestor", mergeTarget, `refs/heads/${developRef}`).status === 0) {
    if (mergeUsesVerified === 1 && mergeTarget !== integrationTip) {
      say(`integration-batch-merge: OK \u2014 develop fast-forwarded to the VERIFIED commit ${mergeTarget} (the point the green suite tested)`);
      say(`integration-batch-merge:   integration HEAD ${integrationTip} still has newer untested commits \u2014 they await the next green (nothing silently dropped)`);
      say("integration-batch-merge: measure integration_ff_merges=1");
    } else {
      say("integration-batch-merge: OK \u2014 develop fast-forwarded to integration");
      say("integration-batch-merge: measure integration_ff_merges=0");
    }
    say(`integration-batch-merge: develop=${mergeTarget}`);
    doSync();
    doDeliver();
    if (reconcile === 1 && dryRun === 0) {
      if (!reconcileIndex(mergeTarget)) process.exit(1);
    }
  } else {
    err(`integration-batch-merge: post-measure FAILED \u2014 merge target ${mergeTarget} not ancestor of develop after ff; needs human`);
    process.exit(1);
  }
  process.exit(0);
}
reportDivergence();
if (mergeMode === 0) {
  err("integration-batch-merge: NOT-FAST-FORWARD \u2014 integration is not a descendant of develop; needs a human (pass --merge to real-merge auto-resolving shared files develop-authoritative and reverse-edge files integration-authoritative)");
  process.exit(1);
}
process.exit(realMerge() ? 0 : 1);
