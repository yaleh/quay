// @test-group product
// M16-cli-edit-parity-impl (design doc §5, Done-when 5/6/7): CLI-level
// two-provider conformance probes for the newly-relaxed `quay task edit`
// flag surface (design doc §1.2). This is the "new sibling
// cli-edit-parity-conformance.test.mjs" alternative §5 names explicitly,
// invoking the real `packages/quay/bin/quay.js` binary as a subprocess
// (not `callTool` directly against the MCP server) — the CLI's own new
// flag-parsing layer is what this file exists to prove, on top of the ABI
// layer `provider-abi-conformance.test.mjs` already proves.
//
// Native leg: fully isolated, disposable fixture (fresh temp workspace +
// tasks dir), same pattern as cli.test.mjs's own QN-033 fixture.
//
// GitHub leg: live against the real `yaleh/quay` repo, reusing the SAME
// dedicated scratch-issue convention M09-gh-write/M12-abi-parent-write
// established (gh-11 for title/body/labels write; gh-3 for read-only /
// idempotent-status / hard-error-floor probes) — never the read-only
// gh-3/gh-4/gh-5/gh-7 fixtures for a genuinely mutating write, per that
// convention's own scope discipline.
//
// Run: node packages/quay/test/cli-edit-parity-conformance.test.mjs
//
// ADR-019 (M173/DIR-109): in-file skip declaration. The GitHub leg above
// performs real, mutating writes against the live yaleh/quay repo (gh-11
// title/body/labels; gh-3 idempotent-status/hard-error probes) — unsafe-by-
// default for an offline / credential-less run, and (matching this file's
// prior external-exclusion behavior) the native leg is not currently split
// out, so the whole file skips together. Classification lives HERE, not in
// an external grep/glob exclusion list. Opt in with QUAY_TEST_LIVE_GITHUB=1
// (requires GH_TOKEN / `gh auth login` with write access to yaleh/quay).

import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The native-leg fixture dirs are removed once at the end of this file (the carrier-array +
// after() pattern) — a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
import fs from "node:fs";
import os from "node:os";
import YAML from "yaml";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const LIVE_GITHUB_ENV = "QUAY_TEST_LIVE_GITHUB";
const liveGithubEnabled = process.env[LIVE_GITHUB_ENV] === "1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const githubBin = path.join(__dirname, "..", "..", "quay-github", "bin", "quay-github.ts");
const githubProviderDir = path.dirname(githubBin);

let failures = 0;
function record(provider, probe, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} [${provider}/${probe}] ${detail}`);
}

function run(args, opts) {
  try {
    const out = execFileSync("node", [quayBin, ...args], { encoding: "utf8", ...opts });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
    };
  }
}

async function main() {
  // ============================= NATIVE LEG =============================
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-edit-conf-native-tasks-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-cli-edit-conf-native-ws-"));
  _tmpDirs.push(tasksDir);
  _tmpDirs.push(workspaceRoot);
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      "      QUAY_NATIVE_TASKS_DIR: \"./tasks-env-relative\"",
      "  github:",
      "    enabled: false",
      `    path: "${githubProviderDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${githubBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      "      QUAY_GITHUB_REPO: \"yaleh/quay\"",
      "",
    ].join("\n")
  );
  const envTasksDir = path.join(workspaceRoot, "tasks-env-relative");
  fs.mkdirSync(envTasksDir, { recursive: true });

  execFileSync("node", [nativeBin, "task", "create", "CEP-1", "--title", "cli-edit-parity conformance fixture",
    "--status", "todo", "--body", "## Proposal\ninitial body\n", "--labels", "orig-a,orig-b"], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: envTasksDir },
  });

  const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

  // §5.1 --title, native.
  {
    const before = run(["task", "view", "CEP-1", "--json"], spawnOpts);
    const t0 = JSON.parse(before.stdout);
    const r = run(["task", "edit", "CEP-1", "--title", t0.title, "--json"], spawnOpts); // idempotent re-assert
    const ok = r.status === 0 && JSON.parse(r.stdout).title === t0.title;
    record("native", "title-two-provider", ok,
      `quay task edit CEP-1 --title "<same title>" -> exit=${r.status}, title matches=${ok}`);
  }

  // gap-task-write-accepts-a-title-that-breaks-its-own-frontmatter: hazardous
  // titles must be YAML-safe-serialized by the write side through the REAL Core
  // CLI → native provider → store path. A title containing a space+`#` (YAML
  // comment start) or `: ` (nested-mapping start) written UNQUOTED would
  // truncate / fail to parse; the fix must quote it so the file still parses
  // and the read-back title is byte-identical (AC1/AC2 conformance probe).
  {
    const hazardous = "The ## Contract";
    const r = run(["task", "edit", "CEP-1", "--title", hazardous, "--json"], spawnOpts);
    const t = JSON.parse(r.stdout || "null");
    const filePath = path.join(envTasksDir, "CEP-1.md");
    const raw = fs.readFileSync(filePath, "utf8");
    const m = /^---\n([\s\S]*?)\n---/.exec(raw);
    let parsed = null;
    let parseErr = null;
    try { parsed = YAML.parse(m[1]); } catch (e) { parseErr = e; }
    const ok = r.status === 0 && t?.title === hazardous && !parseErr && parsed?.title === hazardous;
    record("native", "hazardous-title-space-hash", ok,
      `quay task edit CEP-1 --title "${hazardous}" -> exit=${r.status}, ` +
      `read-back title matches=${t?.title === hazardous}, file parses=${!parseErr}, parsed=${JSON.stringify(parsed?.title)}`);
  }
  {
    const hazardous = "god-package: gate/ has fanOut=62";
    const r = run(["task", "edit", "CEP-1", "--title", hazardous, "--json"], spawnOpts);
    const t = JSON.parse(r.stdout || "null");
    const filePath = path.join(envTasksDir, "CEP-1.md");
    const raw = fs.readFileSync(filePath, "utf8");
    const m = /^---\n([\s\S]*?)\n---/.exec(raw);
    let parsed = null;
    let parseErr = null;
    try { parsed = YAML.parse(m[1]); } catch (e) { parseErr = e; }
    const ok = r.status === 0 && t?.title === hazardous && !parseErr && parsed?.title === hazardous;
    record("native", "hazardous-title-colon-space", ok,
      `quay task edit CEP-1 --title "${hazardous}" -> exit=${r.status}, ` +
      `read-back title matches=${t?.title === hazardous}, file parses=${!parseErr}, parsed=${JSON.stringify(parsed?.title)}`);
  }

  // §5.2 --extra, native round-trip.
  {
    const r = run(["task", "edit", "CEP-1", "--extra", JSON.stringify({ probeKey: "probeValue" }), "--json"], spawnOpts);
    const after = run(["task", "view", "CEP-1", "--json"], spawnOpts);
    const t = JSON.parse(after.stdout);
    const ok = r.status === 0 && t.extra?.probeKey === "probeValue";
    record("native", "extra-round-trip", ok,
      `quay task edit CEP-1 --extra '{"probeKey":"probeValue"}' -> exit=${r.status}, read-back extra.probeKey=${t.extra?.probeKey}`);
  }

  // §5.3 --labels/--parent/--children extended, native.
  {
    const r = run(["task", "edit", "CEP-1", "--labels", "new-x,new-y", "--json"], spawnOpts);
    const t = JSON.parse(r.stdout);
    const ok = r.status === 0 && Array.isArray(t.labels) && t.labels.join(",") === "new-x,new-y";
    record("native", "labels-extended", ok,
      `quay task edit CEP-1 --labels new-x,new-y -> exit=${r.status}, labels=${JSON.stringify(t.labels)}`);
  }
  {
    execFileSync("node", [nativeBin, "task", "create", "CEP-2", "--title", "cli-edit-parity child fixture",
      "--status", "todo", "--body", "## Proposal\nchild body\n"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: envTasksDir },
    });
    const r = run(["task", "edit", "CEP-1", "--children", "CEP-2", "--json"], spawnOpts);
    const t = JSON.parse(r.stdout);
    const ok = r.status === 0 && Array.isArray(t.children) && t.children.includes("CEP-2");
    record("native", "children-extended", ok,
      `quay task edit CEP-1 --children CEP-2 -> exit=${r.status}, children=${JSON.stringify(t.children)}`);

    const rParent = run(["task", "edit", "CEP-2", "--parent", "CEP-1", "--json"], spawnOpts);
    const tParent = JSON.parse(rParent.stdout);
    const okParent = rParent.status === 0 && tParent.parent === "CEP-1";
    record("native", "parent-extended", okParent,
      `quay task edit CEP-2 --parent CEP-1 -> exit=${rParent.status}, parent=${tParent.parent}`);
  }

  // Done-when 2/3 CLI-level evidence (--body-file incl. stdin, mutual
  // exclusion, --append-notes) — also exercised here as part of this same
  // conformance sweep (native only; these are Core-CLI-flag-layer
  // behaviors, not provider-divergence probes).
  {
    const bodyFile = path.join(workspaceRoot, "body.md");
    fs.writeFileSync(bodyFile, "## Proposal\nfile-based body\n");
    const r = run(["task", "edit", "CEP-1", "--body-file", bodyFile, "--json"], spawnOpts);
    const t = JSON.parse(r.stdout);
    record("native", "body-file-path", r.status === 0 && t.body === "## Proposal\nfile-based body\n",
      `quay task edit CEP-1 --body-file <path> -> exit=${r.status}, body=${JSON.stringify(t.body)}`);
  }
  {
    const r = run(["task", "edit", "CEP-1", "--body-file", "-", "--json"], {
      ...spawnOpts, input: "## Proposal\nstdin body\n",
    });
    const t = JSON.parse(r.stdout);
    record("native", "body-file-stdin", r.status === 0 && t.body === "## Proposal\nstdin body\n",
      `quay task edit CEP-1 --body-file - (stdin) -> exit=${r.status}, body=${JSON.stringify(t.body)}`);
  }
  {
    const r = run(["task", "edit", "CEP-1", "--body", "x", "--body-file", "-", "--json"], spawnOpts);
    record("native", "body-mutual-exclusion", r.status === 1 && r.stderr.includes("mutually exclusive"),
      `quay task edit CEP-1 --body x --body-file - -> exit=${r.status}, stderr=${JSON.stringify(r.stderr.trim())}`);
  }
  {
    const before = run(["task", "view", "CEP-1", "--json"], spawnOpts);
    const bodyBefore = JSON.parse(before.stdout).body;
    const r = run(["task", "edit", "CEP-1", "--append-notes", "Appended via conformance probe", "--json"], spawnOpts);
    const t = JSON.parse(r.stdout);
    const ok = r.status === 0 && t.body.startsWith(bodyBefore) && t.body.includes("Appended via conformance probe");
    record("native", "append-notes", ok,
      `quay task edit CEP-1 --append-notes "..." -> exit=${r.status}, body before=${JSON.stringify(bodyBefore)}, after=${JSON.stringify(t.body)}`);
  }

  // ============================= GITHUB LEG =============================
  const ghSpawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

  // §5.1 --title, github — real mutating write to the dedicated gh-11
  // scratch issue (M09-gh-write's own convention), restored to its
  // pre-probe value immediately after (idempotent from the repo's point of
  // view, same discipline provider-abi-conformance.test.mjs already uses
  // for gh-3's title).
  {
    const before = run(["task", "view", "gh-11", "--provider", "github", "--json"], ghSpawnOpts);
    const t0 = JSON.parse(before.stdout);
    const r = run(["task", "edit", "gh-11", "--title", t0.title, "--provider", "github", "--json"], ghSpawnOpts);
    const ok = r.status === 0 && JSON.parse(r.stdout).title === t0.title;
    record("github", "title-two-provider", ok,
      `quay task edit gh-11 --title "<same title>" --provider github -> exit=${r.status}, title matches=${ok}`);
  }

  // §5.2 --extra, github hard-error floor. gh-3 (read-only fixture, never
  // mutated by this probe) — the call is expected to error BEFORE any
  // write occurs (PR-ABI-001 floor: 'extra' remains genuinely unsupported
  // on GitHub post-M12, per design doc §2.3).
  {
    const before = run(["task", "view", "gh-3", "--provider", "github", "--json"], ghSpawnOpts);
    const gh3Before = JSON.parse(before.stdout);
    const r = run(["task", "edit", "gh-3", "--extra", JSON.stringify({ probeKey: "probeValue" }), "--provider", "github", "--json"], ghSpawnOpts);
    const after = run(["task", "view", "gh-3", "--provider", "github", "--json"], ghSpawnOpts);
    const gh3After = JSON.parse(after.stdout);
    const hasFloorMsg = /unsupported field\(s\) \[extra\]/.test(r.stderr) &&
      /Supported fields: id, status, title, body, labels, parent, children/.test(r.stderr);
    const unmodified = gh3After.title === gh3Before.title && gh3After.body === gh3Before.body &&
      JSON.stringify(gh3After.labels) === JSON.stringify(gh3Before.labels);
    const ok = r.status === 1 && hasFloorMsg && unmodified;
    record("github", "extra-hard-error-floor", ok,
      `quay task edit gh-3 --extra '{"probeKey":"probeValue"}' --provider github -> exit=${r.status}, ` +
      `floor message present=${hasFloorMsg}, gh-3 unmodified=${unmodified}, stderr=${JSON.stringify(r.stderr.trim())}`);
  }

  // §5.3 --labels/--parent/--children extended, github (all
  // all-provider-supported post-M12) — real mutating writes to the
  // dedicated gh-11 scratch issue's labels; idempotent re-assert of its
  // current label set (add-then-remove-back), never touching gh-3/gh-4/
  // gh-5/gh-7's read-only fixtures.
  {
    const before = run(["task", "view", "gh-11", "--provider", "github", "--json"], ghSpawnOpts);
    const gh11Before = JSON.parse(before.stdout);
    const currentLabels = Array.isArray(gh11Before.labels) ? gh11Before.labels : [];
    // Idempotent re-assert of gh-11's OWN current label set through the
    // newly-relaxed CLI --labels flag (proves the CLI flag reaches the
    // real write path without introducing a net label change).
    const r = run(["task", "edit", "gh-11", "--labels", currentLabels.join(","), "--provider", "github", "--json"], ghSpawnOpts);
    const t = JSON.parse(r.stdout || "null");
    const ok = r.status === 0 && Array.isArray(t?.labels) &&
      JSON.stringify([...t.labels].sort()) === JSON.stringify([...currentLabels].sort());
    record("github", "labels-extended", ok,
      `quay task edit gh-11 --labels "<same set>" --provider github -> exit=${r.status}, labels=${JSON.stringify(t?.labels)}`);
  }
  // --parent/--children on github reuse M12-abi-parent-write's own
  // dedicated scratch trio (gh-12/gh-13 parents, gh-14 child) — already
  // exercised at the ABI (task_write) layer by
  // provider-abi-conformance.test.mjs. This file additionally proves the
  // SAME mutation reachable through the newly-relaxed CLI flag layer.
  //
  // gh-14's live `parent` is currently null (no parent set — M12/other
  // iterations' own idempotent-write discipline leaves it unset between
  // runs), so a naive "re-assert current parent unchanged" probe would pass
  // literal `--parent null`, which quay-github correctly hard-rejects as an
  // invalid task id (not a real regression). Instead: set parent=gh-12
  // explicitly, idempotently re-assert that same value a second time (the
  // actual "does --parent reach task_write" proof), then restore gh-14 to
  // its original parent=null state so this probe leaves no net change on
  // the shared live fixture (same idempotent-write discipline as every
  // other github probe in this file).
  {
    const before = run(["task", "view", "gh-14", "--provider", "github", "--json"], ghSpawnOpts);
    const gh14Before = JSON.parse(before.stdout);
    const originalParent = gh14Before.parent;

    const r1 = run(["task", "edit", "gh-14", "--parent", "gh-12", "--provider", "github", "--json"], ghSpawnOpts);
    const t1 = JSON.parse(r1.stdout || "null");
    const setOk = r1.status === 0 && t1?.parent === "gh-12";

    const r2 = run(["task", "edit", "gh-14", "--parent", "gh-12", "--provider", "github", "--json"], ghSpawnOpts);
    const t2 = JSON.parse(r2.stdout || "null");
    const reassertOk = r2.status === 0 && t2?.parent === "gh-12";

    // Restore original state (null -> clear via quay-github's own "no
    // parent" sentinel; if originalParent was already truthy, restore that
    // instead — keeps this probe idempotent regardless of starting state).
    const restoreArgs = originalParent
      ? ["task", "edit", "gh-14", "--parent", originalParent, "--provider", "github", "--json"]
      : ["task", "edit", "gh-14", "--parent", "", "--provider", "github", "--json"];
    const rRestore = run(restoreArgs, ghSpawnOpts);
    const tRestore = JSON.parse(rRestore.stdout || "null");
    const restoreOk = rRestore.status === 0 && (tRestore?.parent ?? null) === (originalParent ?? null);

    const ok = setOk && reassertOk && restoreOk;
    record("github", "parent-extended", ok,
      `quay task edit gh-14 --parent gh-12 (set) -> exit=${r1.status}, parent=${t1?.parent}; ` +
      `(re-assert) -> exit=${r2.status}, parent=${t2?.parent}; ` +
      `(restore to original=${originalParent}) -> exit=${rRestore.status}, parent=${tRestore?.parent ?? null}`);
  }
  {
    const before = run(["task", "view", "gh-13", "--provider", "github", "--json"], ghSpawnOpts);
    const gh13Before = JSON.parse(before.stdout);
    const currentChildren = Array.isArray(gh13Before.children) ? gh13Before.children : [];
    const r = run(["task", "edit", "gh-13", "--children", currentChildren.join(","), "--provider", "github", "--json"], ghSpawnOpts);
    const t = JSON.parse(r.stdout || "null");
    const ok = r.status === 0 && Array.isArray(t?.children) &&
      JSON.stringify([...t.children].sort()) === JSON.stringify([...currentChildren].sort());
    record("github", "children-extended", ok,
      `quay task edit gh-13 --children "<same current set>" --provider github -> exit=${r.status}, children=${JSON.stringify(t?.children)}`);
  }

  // ============================= SUMMARY =================================
  console.log(`\n--- cli-edit-parity-conformance: ${failures === 0 ? "all probes passed" : failures + " probe(s) FAILED"} ---`);
  if (failures > 0) {
    console.error(`\n${failures} cli-edit-parity-conformance test failure(s).`);
    throw new Error(`${failures} cli-edit-parity-conformance test failure(s)`);
  } else {
    console.log("\nAll cli-edit-parity-conformance scenario cells passed.");
  }
}

test(
  "cli-edit-parity-conformance: native+github CLI-level `quay task edit` flag-surface probes",
  {
    skip:
      !liveGithubEnabled &&
      `live-GitHub test skipped by default — opt in with ${LIVE_GITHUB_ENV}=1 (requires GH_TOKEN / gh auth with write access to yaleh/quay)`,
  },
  main
);
