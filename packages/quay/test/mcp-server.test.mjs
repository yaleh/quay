// QN-036 (DIR-007): regression test for Core's own MCP server
// (packages/quay/src/mcp-server.js, wired into bin/quay.js's `mcp`
// subcommand). Spawns the REAL `quay mcp` binary as a subprocess MCP
// server, connects a real MCP client to it (same SDK usage as
// abi-symmetry.mjs's own client-side pattern), and confirms:
//
//   1. it correctly proxies task_list/task_get/task_check (and
//      provider://manifest) through to a live Provider's own MCP server,
//      with results matching what calling that Provider's own `mcp`
//      subcommand directly would return (byte-identical structuredContent);
//   2. genuine multi-Provider aggregation/routing works: two independently
//      isolated native task stores, configured as two distinct enabled
//      Providers ("native" and "native-2") in one .quay/config.yml, are
//      both reachable through the ONE `quay mcp` endpoint via the optional
//      `provider` tool argument — this is the live proof of DIR-007 point 2
//      ("genuinely proxy/aggregate... for each Provider currently
//      enabled: true"), without depending on live `gh`/GitHub network
//      access inside this automated test file (github+live-repo
//      aggregation was separately live-verified by hand this iteration,
//      see experiment/iterations/iteration-26.md — this file exercises the
//      same code path against a second, fully local/isolated Provider
//      instance instead, so the test suite has zero external-network
//      dependency, consistent with this package's existing test-isolation
//      conventions, e.g. cli.test.mjs/serve.test.mjs);
//   3. error paths: unknown provider id, unknown task id;
//   4. resource enumeration: provider://manifest (default alias) and
//      provider://manifest/<id> per enabled Provider -- including (QN-041)
//      that each listed resource carries a distinct `name` field (display/
//      enumeration-only) separate from its `uri` (the actual lookup key),
//      and that `readResource({ name })` (uri omitted) genuinely fails
//      rather than silently succeeding -- closing the gap DESIGN.md §2.5
//      named ("not been checked against any MCP client that enumerates
//      resources by name rather than uri").
//   5. (QN-043) task_write's expectedStatus (CAS) option, live, through
//      this Core MCP path specifically -- the second DESIGN.md §2.5-named
//      gap ("forwarded but not specifically exercised through the Core MCP
//      path"): a matching expectedStatus succeeds and persists; a
//      mismatched one returns isError:true (not a crash) naming both the
//      expected and actual status; and a follow-up task_get confirms
//      nothing was written to disk on the conflict path.
//
// Run: node test/mcp-server.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreBin = path.join(__dirname, "..", "bin", "quay.js");
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.js");
const nativeProviderDir = path.dirname(nativeBin);

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
const AC_DOD_CHECKED =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

async function connectStdio(command, args, cwd, env) {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
  });
  const client = new Client({ name: "test-agent", version: "0.0.1" });
  await client.connect(transport);
  return { client, transport };
}

async function main() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-workspace-"));
  const tasksDirA = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-tasks-a-"));
  const tasksDirB = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mcp-test-tasks-b-"));

  // Two independently isolated native task stores, both declared as
  // enabled: true Providers ("native" and "native-2") — the multi-Provider
  // aggregation fixture (see file header). Distinct tasks_dir values make
  // cross-contamination between them immediately detectable.
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir}"`,
      `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDirA}"`,
      "  native-2:",
      "    enabled: true",
      `    path: "${nativeProviderDir}"`,
      `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDirB}"`,
      "",
    ].join("\n")
  );

  execFileSync("node", [nativeBin, "task", "create", "MCP-A1", "--title", "Provider-A-only task",
    "--status", "todo", "--body", VALID_SECTIONS + AC_DOD_CHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDirA },
  });
  execFileSync("node", [nativeBin, "task", "create", "MCP-B1", "--title", "Provider-B-only task",
    "--status", "todo", "--body", VALID_SECTIONS + AC_DOD_CHECKED], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDirB },
  });

  // ---- 1. Connect the real `quay mcp` subprocess ----
  const { client: core, transport: coreTransport } = await connectStdio("node", [coreBin, "mcp"], workspaceRoot);

  // ---- 2. Resource enumeration ----
  const resources = await core.listResources();
  const uris = resources.resources.map((r) => r.uri).sort();
  assert(
    uris.includes("provider://manifest") &&
      uris.includes("provider://manifest/native") &&
      uris.includes("provider://manifest/native-2"),
    "quay mcp lists provider://manifest (default alias) plus one provider://manifest/<id> resource per enabled Provider"
  );

  // QN-041: close the DESIGN.md §2.5 "name vs. uri" gap -- confirm each
  // listed resource carries both a distinct `name` and a `uri` field, and
  // that `name` cannot be used as an alternate lookup key (MCP's
  // resources/read request is uri-keyed by protocol; `name` is
  // listing/display-only). This was previously asserted only via
  // uri-based readResource() calls -- never checked against `name`.
  const defaultEntry = resources.resources.find((r) => r.uri === "provider://manifest");
  const nativeEntry = resources.resources.find((r) => r.uri === "provider://manifest/native");
  assert(
    typeof defaultEntry?.name === "string" && defaultEntry.name === "manifest",
    `provider://manifest's listed entry carries a distinct name field ("manifest"), got: ${JSON.stringify(defaultEntry)}`
  );
  assert(
    typeof nativeEntry?.name === "string" && nativeEntry.name === "manifest-native",
    `provider://manifest/native's listed entry carries a distinct name field ("manifest-native"), got: ${JSON.stringify(nativeEntry)}`
  );
  assert(
    nativeEntry.name !== nativeEntry.uri,
    "the per-Provider resource's name and uri are genuinely distinct strings, not the same value under two keys"
  );
  let nameLookupThrew = false;
  let nameLookupErrorText = "";
  try {
    await core.readResource({ name: "manifest" });
  } catch (err) {
    nameLookupThrew = true;
    nameLookupErrorText = err.message || String(err);
  }
  assert(
    nameLookupThrew,
    `readResource({ name: "manifest" }) (uri omitted) rejects rather than silently succeeding or resolving the wrong resource -- confirms an Agent cannot use the listing-only "name" field as an alternate lookup key (got error: ${nameLookupErrorText})`
  );

  const defaultManifest = await core.readResource({ uri: "provider://manifest" });
  const defaultManifestId = JSON.parse(defaultManifest.contents[0].text).id;
  assert(defaultManifestId === "native", "provider://manifest (default alias) resolves to the first-enabled Provider (native)");

  const manifestB = await core.readResource({ uri: "provider://manifest/native-2" });
  assert(
    JSON.parse(manifestB.contents[0].text).id === "native",
    "provider://manifest/native-2 still reports the underlying native Provider's own declared id (provider.yml's id field is per-code, not per-config-alias) — a real, honestly-named quirk of reusing the native binary as a second config-level Provider in this fixture"
  );

  // ---- 3. task_list: default Provider (omitted `provider` arg) ----
  {
    const r = await core.callTool({ name: "task_list", arguments: {} });
    const ids = r.structuredContent.tasks.map((t) => t.id);
    assert(ids.includes("MCP-A1") && !ids.includes("MCP-B1"), "task_list with no `provider` arg defaults to the first-enabled Provider (native / tasksDirA) and does not leak Provider B's tasks");
  }

  // ---- 4. task_list: explicit provider=native-2 ----
  {
    const r = await core.callTool({ name: "task_list", arguments: { provider: "native-2" } });
    const ids = r.structuredContent.tasks.map((t) => t.id);
    assert(ids.includes("MCP-B1") && !ids.includes("MCP-A1"), "task_list with provider='native-2' routes to Provider B's own isolated task store and does not leak Provider A's tasks");
  }

  // ---- 5. task_get + task_check, cross-checked byte-identical against
  //      each Provider's own `quay-native mcp` server called directly ----
  {
    const { client: directA } = await connectStdio("node", [nativeBin, "mcp"], nativeProviderDir, {
      QUAY_NATIVE_TASKS_DIR: tasksDirA,
    });
    const direct = await directA.callTool({ name: "task_get", arguments: { id: "MCP-A1" } });
    const viaCore = await core.callTool({ name: "task_get", arguments: { id: "MCP-A1", provider: "native" } });
    assert(
      JSON.stringify(direct.structuredContent) === JSON.stringify(viaCore.structuredContent),
      "task_get via `quay mcp` (provider=native) is byte-identical to calling quay-native's own mcp server directly"
    );

    const directCheck = await directA.callTool({ name: "task_check", arguments: { id: "MCP-A1" } });
    const viaCoreCheck = await core.callTool({ name: "task_check", arguments: { id: "MCP-A1", provider: "native" } });
    assert(
      JSON.stringify(directCheck.structuredContent) === JSON.stringify(viaCoreCheck.structuredContent),
      "task_check via `quay mcp` (provider=native) is byte-identical to calling quay-native's own mcp server directly"
    );
    await directA.close();
  }

  // ---- 6. task_write passthrough (generic, provider-agnostic) ----
  {
    const r = await core.callTool({ name: "task_write", arguments: { id: "MCP-A1", status: "ready", provider: "native" } });
    assert(r.structuredContent.task.status === "ready", "task_write via `quay mcp` persists the new status on the correct Provider (native)");
    const rB = await core.callTool({ name: "task_list", arguments: { provider: "native-2" } });
    assert(
      rB.structuredContent.tasks.find((t) => t.id === "MCP-B1").status === "todo",
      "task_write against Provider native left Provider native-2's own MCP-B1 task untouched (no cross-Provider leakage)"
    );
  }

  // ---- 7. task_write expectedStatus (CAS) passthrough, live (QN-043) ----
  {
    // MCP-A1's status is currently "ready" (set by step 6 above).
    const okResult = await core.callTool({
      name: "task_write",
      arguments: { id: "MCP-A1", status: "done", expectedStatus: "ready", provider: "native" },
    });
    assert(
      okResult.structuredContent?.task?.status === "done",
      "task_write via `quay mcp` with a matching expectedStatus (ready) succeeds and persists the new status (done)"
    );

    // Now MCP-A1 is "done". Attempt a CAS write premised on a stale
    // expectedStatus ("ready") -- must be refused, not silently applied.
    const conflictResult = await core.callTool({
      name: "task_write",
      arguments: { id: "MCP-A1", status: "needs-human", expectedStatus: "ready", provider: "native" },
    });
    assert(
      conflictResult.isError === true,
      "task_write via `quay mcp` with a mismatched expectedStatus returns isError:true, not a crash or a silent write"
    );
    const conflictText = conflictResult.content?.[0]?.text ?? "";
    assert(
      /expected status "ready"/.test(conflictText),
      `the CAS conflict error message names the expected status (got: ${conflictText})`
    );
    assert(
      /actual current status is "done"/.test(conflictText),
      `the CAS conflict error message names the actual current status (got: ${conflictText})`
    );

    const afterConflict = await core.callTool({ name: "task_get", arguments: { id: "MCP-A1", provider: "native" } });
    assert(
      afterConflict.structuredContent.task.status === "done",
      "after the refused CAS write, MCP-A1's status is still 'done' (the earlier successful write) -- the conflicting write did NOT get silently applied"
    );
  }

  // ---- 8. Error paths ----
  {
    const rUnknownProvider = await core.callTool({ name: "task_list", arguments: { provider: "does-not-exist" } });
    assert(rUnknownProvider.isError === true, "task_list with an unknown/non-enabled provider id returns isError:true, not a crash");
    assert(
      /not enabled/.test(rUnknownProvider.content?.[0]?.text ?? ""),
      "the unknown-provider error message names the enabled-provider set"
    );

    const rUnknownId = await core.callTool({ name: "task_get", arguments: { id: "NOPE-999" } });
    assert(rUnknownId.isError === true, "task_get with an unknown task id returns isError:true, not a crash");
  }

  await core.close();

  // ---- Cleanup ----
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.rmSync(tasksDirA, { recursive: true, force: true });
  fs.rmSync(tasksDirB, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} FAILURE(S)`);
    process.exitCode = 1;
  } else {
    console.log("\nAll QN-036 Core MCP server (DIR-007) tests passed.");
  }
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
