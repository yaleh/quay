// M16-cli-edit-parity-impl (exp5): CLI-level two-provider conformance probes
// for the Core CLI's newly-relaxed `task edit` flag surface (design doc
// docs/proposals/exp5-cli-edit-parity.md §5, Done-when clauses 5-7).
//
// Unlike provider-abi-conformance.test.mjs (which drives each Provider's own
// MCP server directly via `callTool`), this file spawns the real
// `packages/quay/bin/quay.js` binary as a subprocess for every probe, so it
// proves the Core CLI's own new flag-parsing/validation layer (§1.2/§1.3)
// actually reaches the ABI, not just that the ABI itself already works
// (already covered by provider-abi-conformance.test.mjs and M09/M12's own
// write-path tests). Follows cli.test.mjs's own isolated-workspace pattern
// (temp .quay/config.yml + temp native tasks dir) for the native leg, and
// the same live yaleh/quay read/idempotent-write fixtures
// (gh-3/gh-7/gh-12/gh-13/gh-14) provider-abi-conformance.test.mjs already
// established for the GitHub leg.
//
// §5.1 --title: two-provider, both supported (native + GitHub).
// §5.2 --extra: two-provider, native round-trip succeeds; GitHub hard-errors
//      with the exact PR-ABI-001 floor message and leaves gh-3 unmodified.
// §5.3 --labels/--parent/--children: extended per "all three are
//      all-provider-supported post-M12" — native + GitHub both probed.
//
// Run: node packages/quay/test/cli-edit-parity-conformance.test.mjs
// Precondition: `gh auth status` must show an authenticated session with
// write access to yaleh/quay (same standing precondition
// provider-abi-conformance.test.mjs's own M12 block already requires) —
// this file's GitHub leg spawns real `quay-github mcp` subprocesses via
// `--provider github` and performs idempotent/scratch-fixture writes only,
// never against gh-3/gh-7's own title/status/labels (only idempotent
// re-asserts of their current values, or the dedicated gh-12/13/14 scratch
// trio for parent/children mutation, mirroring provider-abi-conformance.
// test.mjs's own established discipline exactly).

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = path.join(__dirname, "..", "bin", "quay.js");
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.js");
const nativeProviderDir = path.dirname(nativeBin);
const githubBin = path.join(__dirname, "..", "..", "quay-github", "bin", "quay-github.js");
const githubProviderDir = path.dirname(githubBin);

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function run(args, opts = {}) {
  try {
    const out = execFileSync("node", [coreBin, ...args], { encoding: "utf8", ...opts });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";

async function main() {
  // ============================= NATIVE LEG =============================
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-edit-parity-tasks-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-edit-parity-workspace-"));

  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  function writeNativeOnlyConfig() {
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
        `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
        "  github:",
        "    enabled: false",
        `    path: "${githubProviderDir.replaceAll("\\", "\\\\")}"`,
        `    mcp_entry: ["node", "${githubBin.replaceAll("\\", "\\\\")}", "mcp"]`,
        "    env:",
        "      QUAY_GITHUB_REPO: \"yaleh/quay\"",
        "",
      ].join("\n")
    );
  }
  writeNativeOnlyConfig();

  execFileSync(
    "node",
    [nativeBin, "task", "create", "EP-1", "--title", "Edit-parity conformance fixture", "--status", "todo", "--body", VALID_SECTIONS],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir } }
  );
  execFileSync(
    "node",
    [nativeBin, "task", "create", "EP-PARENT", "--title", "Edit-parity parent fixture", "--status", "todo", "--body", VALID_SECTIONS],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir } }
  );
  execFileSync(
    "node",
    [nativeBin, "task", "create", "EP-CHILD", "--title", "Edit-parity child fixture", "--status", "todo", "--body", VALID_SECTIONS],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir } }
  );

  const spawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

  // --- §5.1 --title (native) ---
  {
    const r = run(["task", "edit", "EP-1", "--title", "Edit-parity conformance fixture (renamed)", "--json"], spawnOpts);
    let t;
    try { t = JSON.parse(r.stdout); } catch { t = null; }
    assert(r.status === 0 && t?.title === "Edit-parity conformance fixture (renamed)",
      `native: quay task edit EP-1 --title reaches store.write()'s title field (status=${r.status}, title=${t?.title})`);
  }

  // --- §5.3 --labels (native) ---
  {
    const r = run(["task", "edit", "EP-1", "--labels", "alpha,beta", "--json"], spawnOpts);
    let t;
    try { t = JSON.parse(r.stdout); } catch { t = null; }
    assert(r.status === 0 && Array.isArray(t?.labels) && t.labels.join(",") === "alpha,beta",
      `native: quay task edit EP-1 --labels alpha,beta reaches store.write()'s labels field (labels=${JSON.stringify(t?.labels)})`);
  }

  // --- §5.3 --parent/--children (native) ---
  {
    const r = run(["task", "edit", "EP-CHILD", "--parent", "EP-PARENT", "--json"], spawnOpts);
    let t;
    try { t = JSON.parse(r.stdout); } catch { t = null; }
    assert(r.status === 0 && t?.parent === "EP-PARENT",
      `native: quay task edit EP-CHILD --parent EP-PARENT reaches store.write()'s parent field (parent=${t?.parent})`);

    const r2 = run(["task", "edit", "EP-PARENT", "--children", "EP-CHILD", "--json"], spawnOpts);
    let t2;
    try { t2 = JSON.parse(r2.stdout); } catch { t2 = null; }
    assert(r2.status === 0 && Array.isArray(t2?.children) && t2.children.includes("EP-CHILD"),
      `native: quay task edit EP-PARENT --children EP-CHILD reaches store.write()'s children field (children=${JSON.stringify(t2?.children)})`);
  }

  // --- §5.2 --extra (native, supported) ---
  {
    const r = run(["task", "edit", "EP-1", "--extra", JSON.stringify({ probeKey: "probeValue" }), "--json"], spawnOpts);
    let t;
    try { t = JSON.parse(r.stdout); } catch { t = null; }
    assert(r.status === 0 && t?.extra?.probeKey === "probeValue",
      `native: quay task edit EP-1 --extra reaches store.write()'s extra merge, readable back (extra=${JSON.stringify(t?.extra)})`);
  }

  // ============================= GITHUB LEG =============================
  // Precondition check: fail loudly (not silently skip) if gh isn't
  // authenticated, matching provider-abi-conformance.test.mjs's own
  // no-silent-skip discipline for its GitHub leg.
  let ghAuthed = true;
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
  } catch {
    ghAuthed = false;
  }

  if (!ghAuthed) {
    console.error(
      "\nBLOCKED-ON-ENVIRONMENT: `gh auth status` did not report an authenticated session — " +
      "the GitHub leg of this file (§5.1/§5.2/§5.3's github-provider probes) cannot run. " +
      "This is disclosed explicitly per Done-when 10, not silently skipped or fabricated as PASS."
    );
    failures++; // an unauthenticated gh in CI is a real gap, not a soft warning
  } else {
    const githubSpawnOpts = { cwd: workspaceRoot, encoding: "utf8" };

    // Read gh-3's own current title/labels for idempotent re-assert (no lasting mutation).
    const gh3Before = JSON.parse(
      run(["task", "view", "gh-3", "--provider", "github", "--json"], githubSpawnOpts).stdout
    );
    assert(gh3Before?.id === "gh-3", `github: quay task view gh-3 --provider github returns real fixture (title=${gh3Before?.title})`);

    // --- §5.1 --title (github, idempotent re-assert of gh-3's own title) ---
    {
      const r = run(["task", "edit", "gh-3", "--title", gh3Before.title, "--provider", "github", "--json"], githubSpawnOpts);
      let t;
      try { t = JSON.parse(r.stdout); } catch { t = null; }
      assert(r.status === 0 && t?.title === gh3Before.title,
        `github: quay task edit gh-3 --title (idempotent re-assert) reaches github-client.js's real title write (status=${r.status}, title=${t?.title})`);
    }

    // --- §5.3 --labels (github, idempotent re-assert of gh-3's own labels) ---
    {
      const labelsArg = (gh3Before.labels ?? []).join(",");
      const r = run(["task", "edit", "gh-3", "--labels", labelsArg, "--provider", "github", "--json"], githubSpawnOpts);
      let t;
      try { t = JSON.parse(r.stdout); } catch { t = null; }
      const sameLabels = JSON.stringify((t?.labels ?? []).slice().sort()) === JSON.stringify((gh3Before.labels ?? []).slice().sort());
      assert(r.status === 0 && sameLabels,
        `github: quay task edit gh-3 --labels (idempotent re-assert of "${labelsArg}") reaches github-client.js's real labels write (labels=${JSON.stringify(t?.labels)})`);
    }

    // --- §5.3 --parent/--children (github, dedicated gh-12/gh-13/gh-14 scratch trio, mirrors provider-abi-conformance.test.mjs's own M12 block) ---
    {
      const addRes = run(["task", "edit", "gh-14", "--parent", "gh-12", "--provider", "github", "--json"], githubSpawnOpts);
      let addTask;
      try { addTask = JSON.parse(addRes.stdout); } catch { addTask = null; }
      const gh12After = JSON.parse(run(["task", "view", "gh-12", "--provider", "github", "--json"], githubSpawnOpts).stdout);
      assert(addRes.status === 0 && addTask?.parent === "gh-12" && (gh12After.children ?? []).includes("gh-14"),
        `github: quay task edit gh-14 --parent gh-12 reaches github-client.js's real writeRelations() (gh-14.parent=${addTask?.parent}, gh-12.children=${JSON.stringify(gh12After.children)})`);

      // Reassign back to gh-13 (restores the state provider-abi-conformance.test.mjs's own M12 block leaves things in, avoiding cross-file fixture drift).
      const reassignRes = run(["task", "edit", "gh-14", "--parent", "gh-13", "--provider", "github", "--json"], githubSpawnOpts);
      let reassignTask;
      try { reassignTask = JSON.parse(reassignRes.stdout); } catch { reassignTask = null; }
      assert(reassignRes.status === 0 && reassignTask?.parent === "gh-13",
        `github: quay task edit gh-14 --parent gh-13 (reassign) reaches github-client.js's real writeRelations() reassign path (gh-14.parent=${reassignTask?.parent})`);
    }

    // --- §5.2 --extra (github, hard-error floor, PR-ABI-001) ---
    {
      const gh3BeforeExtraProbe = JSON.parse(
        run(["task", "view", "gh-3", "--provider", "github", "--json"], githubSpawnOpts).stdout
      );
      const r = run(
        ["task", "edit", "gh-3", "--extra", JSON.stringify({ probeKey: "probeValue" }), "--provider", "github", "--json"],
        githubSpawnOpts
      );
      const exactFloorMessage =
        "task_write: unsupported field(s) [extra] — this Provider does not implement writing extra. " +
        "Supported fields: id, status, title, body, labels, parent, children.";
      assert(r.status !== 0, `github: quay task edit gh-3 --extra exits non-zero (status=${r.status})`);
      assert(r.stderr.includes(exactFloorMessage),
        `github: stderr contains the EXACT PR-ABI-001 hard-error floor message ` +
        `(expected substring present: ${r.stderr.includes(exactFloorMessage)})\n  --- actual stderr ---\n  ${r.stderr.trim()}`);

      const gh3AfterExtraProbe = JSON.parse(
        run(["task", "view", "gh-3", "--provider", "github", "--json"], githubSpawnOpts).stdout
      );
      const unmodified =
        gh3AfterExtraProbe.title === gh3BeforeExtraProbe.title &&
        gh3AfterExtraProbe.status === gh3BeforeExtraProbe.status &&
        gh3AfterExtraProbe.body === gh3BeforeExtraProbe.body &&
        JSON.stringify(gh3AfterExtraProbe.labels) === JSON.stringify(gh3BeforeExtraProbe.labels);
      assert(unmodified,
        `github: gh-3 is UNMODIFIED after the --extra hard-error (title/status/body/labels all unchanged) — ` +
        `proves no partial silent write occurred before the floor fired`);
    }
  }

  // ============================= SUMMARY =================================
  console.log(`\n--- cli-edit-parity-conformance: ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} ---`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("cli-edit-parity-conformance.test.mjs crashed:", err);
  process.exitCode = 1;
});
