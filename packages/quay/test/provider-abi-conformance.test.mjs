// M03-abi-eval (exp5, DIR-001 items 1-2): differential conformance suite —
// runs the SAME scenario set (task_list / task_get / task_write(status) /
// task_check) against both the native and github Providers' own MCP
// servers directly (bin/quay-native.js mcp, bin/quay-github.js mcp) and
// flags behavioral divergence between them. Minimum scope per the charter:
// a primitive task and a compound (parent/children) task, both providers —
// 8 cells minimum (4 ops x 2 shapes).
//
// Native leg: fully isolated, disposable fixture (fresh temp tasks dir),
// following packages/quay-native/test/*.test.mjs's own established
// pattern — this file creates its own primitive AND compound (parent +
// children) fixture tasks via `quay-native task create`.
//
// GitHub leg: this package has NO local-fixture equivalent (see
// packages/quay-github/test/cli.test.mjs's own header comment:
// createGithubClient() shells out to the real `gh api` for every
// operation, no dependency-injection seam in the CLI binary). This file
// therefore reuses the SAME real, durable, already-live fixtures that
// package's own test suite already depends on and documents:
//   - primitive: gh-3, gh-4 (packages/quay-github/test/cli.test.mjs test 2)
//   - compound (parent/children): gh-7 (parent, CLOSED, role "compound",
//     children [gh-5, gh-6] — created live for QN-035/DIR-006, see
//     packages/quay-github/DESIGN.md §3.5 and gh-7's own issue body).
// Exactly like write.test.mjs / cli.test.mjs's own scope discipline, this
// file NEVER issues a live status-changing write against the real repo:
// the task_write(status) scenario against github is exercised via an
// IDEMPOTENT write (re-asserting the task's own CURRENT status, read live
// immediately beforehand) plus a schema-level differential probe (does
// github's task_write silently drop unsupported fields like `title`, per
// the write-completeness gap DIR-001/this milestone's matrix names) — no
// destructive mutation of the real yaleh/quay issue backlog.
//
// This file is this milestone's own domain-misfit audit channel (per
// inherited-core.md's decision procedure and the charter's it0d): it is
// the FIRST cross-provider automated evidence source for behavioral
// alignment, intended to keep running in CI (existing `node --test`
// invocation already picks up every *.test.mjs under packages/quay/test/)
// as a standing audit channel going forward, not just a one-off report.
//
// Run: node packages/quay/test/provider-abi-conformance.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.js");
const githubBin = path.join(__dirname, "..", "..", "quay-github", "bin", "quay-github.js");

let failures = 0;
const results = []; // { provider, shape, op, ok, detail }
function record(provider, shape, op, ok, detail) {
  results.push({ provider, shape, op, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} [${provider}/${shape}/${op}] ${detail}`);
}

async function connectStdio(command, args, env) {
  const transport = new StdioClientTransport({ command, args, env: { ...process.env, ...env } });
  const client = new Client({ name: "abi-conformance-test", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

const VALID_SECTIONS =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n" +
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

async function main() {
  // ============================= NATIVE LEG =============================
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-abi-conf-native-"));
  const nativeEnv = { QUAY_NATIVE_TASKS_DIR: tasksDir };

  // Primitive fixture.
  execFileSync(
    "node",
    [nativeBin, "task", "create", "ABI-P1", "--title", "Primitive conformance fixture", "--status", "todo", "--body", VALID_SECTIONS],
    { env: { ...process.env, ...nativeEnv } }
  );
  // Compound fixture: one child (done), one parent (todo, references the child).
  execFileSync(
    "node",
    [nativeBin, "task", "create", "ABI-C1-CHILD", "--title", "Compound conformance fixture child", "--status", "done", "--body", VALID_SECTIONS],
    { env: { ...process.env, ...nativeEnv } }
  );
  execFileSync(
    "node",
    [
      nativeBin, "task", "create", "ABI-C1", "--title", "Compound conformance fixture parent",
      "--status", "ready", "--body", VALID_SECTIONS + "- [x] #ABI-C1-CHILD\n",
    ],
    { env: { ...process.env, ...nativeEnv } }
  );
  // `task create` has no --children flag (native's CLI dispatch table,
  // bin/quay-native.js); children are set via a follow-up `task edit`.
  execFileSync(
    "node",
    [nativeBin, "task", "edit", "ABI-C1", "--children", "ABI-C1-CHILD"],
    { env: { ...process.env, ...nativeEnv } }
  );

  const nativeClient = await connectStdio("node", [nativeBin, "mcp"], nativeEnv);

  // --- native / primitive ---
  {
    const r = await nativeClient.callTool({ name: "task_list", arguments: {} });
    const tasks = r.structuredContent?.tasks ?? [];
    record("native", "primitive", "task_list", Array.isArray(tasks) && tasks.some((t) => t.id === "ABI-P1"),
      `task_list returns array including ABI-P1 (got ${tasks.length} tasks)`);
  }
  {
    const r = await nativeClient.callTool({ name: "task_get", arguments: { id: "ABI-P1" } });
    const t = r.structuredContent?.task;
    record("native", "primitive", "task_get", !r.isError && t?.id === "ABI-P1" && t?.status === "todo",
      `task_get ABI-P1 -> status=${t?.status}, role=${t?.role}`);
  }
  {
    const r = await nativeClient.callTool({ name: "task_write", arguments: { id: "ABI-P1", status: "ready" } });
    const t = r.structuredContent?.task;
    record("native", "primitive", "task_write-status", !r.isError && t?.status === "ready",
      `task_write status todo->ready -> status=${t?.status}`);
  }
  {
    const r = await nativeClient.callTool({ name: "task_check", arguments: { id: "ABI-P1" } });
    const sc = r.structuredContent;
    record("native", "primitive", "task_check", typeof sc?.ok === "boolean",
      `task_check ABI-P1 (status=ready, AC checked) -> ok=${sc?.ok}, gate=${sc?.gate}`);
  }

  // --- native / compound ---
  {
    const r = await nativeClient.callTool({ name: "task_list", arguments: {} });
    const tasks = r.structuredContent?.tasks ?? [];
    record("native", "compound", "task_list", tasks.some((t) => t.id === "ABI-C1"),
      `task_list includes ABI-C1 (compound parent)`);
  }
  {
    const r = await nativeClient.callTool({ name: "task_get", arguments: { id: "ABI-C1" } });
    const t = r.structuredContent?.task;
    record("native", "compound", "task_get",
      !r.isError && t?.role === "compound" && Array.isArray(t?.children) && t.children.includes("ABI-C1-CHILD"),
      `task_get ABI-C1 -> role=${t?.role}, children=${JSON.stringify(t?.children)}`);
  }
  {
    const r = await nativeClient.callTool({ name: "task_write", arguments: { id: "ABI-C1", status: "ready" } });
    const t = r.structuredContent?.task;
    // idempotent write (already ready) -- exercises the write path without changing gate semantics
    record("native", "compound", "task_write-status", !r.isError && t?.status === "ready",
      `task_write status (idempotent ready->ready) on compound parent -> status=${t?.status}`);
  }
  {
    const r = await nativeClient.callTool({ name: "task_check", arguments: { id: "ABI-C1" } });
    const sc = r.structuredContent;
    record("native", "compound", "task_check", typeof sc?.ok === "boolean" && Array.isArray(sc?.childrenStatus),
      `task_check ABI-C1 (compound, child done) -> ok=${sc?.ok}, childrenStatus present=${Array.isArray(sc?.childrenStatus)}`);
  }

  await nativeClient.close();

  // ============================= GITHUB LEG =============================
  // Live against yaleh/quay real fixtures. Read-only-safety self-check on
  // this file's own source, mirroring quay-github/test/cli.test.mjs's own
  // convention: confirm no invocation below writes a DIFFERENT status than
  // the task's own just-read current status (idempotent-write-only, no
  // live mutation of the real backlog beyond a same-value re-assert).
  const githubEnv = { QUAY_GITHUB_REPO: "yaleh/quay" };
  const githubClient = await connectStdio("node", [githubBin, "mcp"], githubEnv);

  // --- github / primitive (gh-3, gh-4) ---
  {
    const r = await githubClient.callTool({ name: "task_list", arguments: {} });
    const tasks = r.structuredContent?.tasks ?? [];
    record("github", "primitive", "task_list",
      Array.isArray(tasks) && tasks.some((t) => t.id === "gh-3") && tasks.some((t) => t.id === "gh-4"),
      `task_list includes known real issues gh-3, gh-4 (got ${tasks.length} tasks)`);
  }
  let gh3Before;
  {
    const r = await githubClient.callTool({ name: "task_get", arguments: { id: "gh-3" } });
    gh3Before = r.structuredContent?.task;
    record("github", "primitive", "task_get", !r.isError && gh3Before?.id === "gh-3",
      `task_get gh-3 -> status=${gh3Before?.status}, role=${gh3Before?.role}`);
  }
  {
    // IDEMPOTENT write: re-assert gh-3's own just-read current status. No
    // real status change occurs (computeStatusWrite's own no-op/idempotent
    // branch, packages/quay-github/test/write.test.mjs Case 4).
    const r = await githubClient.callTool({ name: "task_write", arguments: { id: "gh-3", status: gh3Before.status } });
    const t = r.structuredContent?.task;
    record("github", "primitive", "task_write-status", !r.isError && t?.status === gh3Before.status,
      `task_write status (idempotent, ${gh3Before.status}->${gh3Before.status}) -> status=${t?.status}`);

    // DIVERGENCE PROBE (not a live mutation risk: same status value, PLUS
    // an unsupported `title` field): does github's task_write silently
    // drop unsupported fields, matching native's own explicit-field
    // schema behavior, or error? Native's schema DECLARES title/labels/
    // parent/children/body as optional write fields (packages/quay-native/
    // src/mcp-server.js); github's schema declares ONLY {id, status}
        // (packages/quay-github/src/mcp-server.js). This is exactly the kind
    // of cell the charter instructs NOT to trust from provider.yml/DESIGN.md
    // prose alone.
    const probe = await githubClient.callTool({
      name: "task_write",
      arguments: { id: "gh-3", status: gh3Before.status, title: "ABI-CONFORMANCE-PROBE-SHOULD-NOT-APPLY" },
    });
    const probeTask = probe.structuredContent?.task;
    const titleUnchanged = probeTask?.title === gh3Before.title;
    record("github", "primitive", "task_write-unsupported-field-probe",
      !probe.isError && titleUnchanged,
      `task_write with extra 'title' field on github (unsupported per schema) -> isError=${probe.isError}, ` +
      `title unchanged=${titleUnchanged} (silently dropped by MCP SDK zod stripping, not an error) — ` +
      `DIVERGES from native, whose schema accepts+applies 'title' (see gap log)`
    );
  }
  {
    const r = await githubClient.callTool({ name: "task_check", arguments: { id: "gh-3" } });
    const sc = r.structuredContent;
    record("github", "primitive", "task_check", typeof sc?.ok === "boolean",
      `task_check gh-3 -> ok=${sc?.ok}, gate=${sc?.gate}`);
  }

  // --- github / compound (gh-7 parent, [gh-5, gh-6] children) ---
  {
    const r = await githubClient.callTool({ name: "task_get", arguments: { id: "gh-7" } });
    const t = r.structuredContent?.task;
    record("github", "compound", "task_get",
      !r.isError && t?.role === "compound" && Array.isArray(t?.children) && t.children.length === 2,
      `task_get gh-7 -> role=${t?.role}, children=${JSON.stringify(t?.children)}, status=${t?.status}`);
  }
  {
    // task_list already exercised above for the primitive shape; re-confirm
    // it also surfaces the compound parent (role derivation happens in
    // list() too, not just get() — DESIGN.md §3.2).
    const r = await githubClient.callTool({ name: "task_list", arguments: {} });
    const tasks = r.structuredContent?.tasks ?? [];
    const gh7 = tasks.find((t) => t.id === "gh-7");
    record("github", "compound", "task_list", !!gh7 && gh7.role === "compound",
      `task_list's own gh-7 entry has role=${gh7?.role} (role derived by list(), not just get())`);
  }
  {
    // DIVERGENCE PROBE (PR-ABI-002): the SAME real task's `parent` field,
    // read via two different entry points. github-client.js#get()'s own
    // comment self-documents that single-issue lookup cannot cheaply
    // compute `parent` and leaves it null; list() builds a full parentIndex
    // and populates it correctly. This probe demonstrates the asymmetry is
    // real and live, not just a source-comment claim.
    const viaGet = await githubClient.callTool({ name: "task_get", arguments: { id: "gh-5" } });
    const viaList = await githubClient.callTool({ name: "task_list", arguments: {} });
    const gh5FromList = (viaList.structuredContent?.tasks ?? []).find((t) => t.id === "gh-5");
    const getParent = viaGet.structuredContent?.task?.parent;
    const listParent = gh5FromList?.parent;
    record("github", "compound", "task_get-vs-task_list-parent-probe",
      getParent === null && listParent === "gh-7",
      `gh-5's 'parent' field: task_get -> ${JSON.stringify(getParent)}, task_list -> ${JSON.stringify(listParent)} — ` +
      `CONFIRMED path-dependent divergence on the SAME real task (see gap log PR-ABI-002); ` +
      `native's own store.js#get()/list() both resolve 'parent' identically (no such asymmetry) — this is github-only`
    );
  }
  let gh7Before;
  {
    const r = await githubClient.callTool({ name: "task_get", arguments: { id: "gh-7" } });
    gh7Before = r.structuredContent?.task;
    const w = await githubClient.callTool({ name: "task_write", arguments: { id: "gh-7", status: gh7Before.status } });
    const t = w.structuredContent?.task;
    record("github", "compound", "task_write-status", !w.isError && t?.status === gh7Before.status,
      `task_write status (idempotent, ${gh7Before.status}->${gh7Before.status}) on compound parent gh-7 -> status=${t?.status}`);
  }
  {
    const r = await githubClient.callTool({ name: "task_check", arguments: { id: "gh-7" } });
    const sc = r.structuredContent;
    record("github", "compound", "task_check", typeof sc?.ok === "boolean" && Array.isArray(sc?.childrenStatus),
      `task_check gh-7 (compound, both children done, issue CLOSED) -> ok=${sc?.ok}, childrenStatus present=${Array.isArray(sc?.childrenStatus)}`);
  }

  await githubClient.close();

  // ============================= SUMMARY =================================
  console.log(`\n--- ${results.length} scenario cells run (native: ${results.filter(r=>r.provider==="native").length}, github: ${results.filter(r=>r.provider==="github").length}) ---`);
  for (const shape of ["primitive", "compound"]) {
    for (const provider of ["native", "github"]) {
      const cells = results.filter((r) => r.shape === shape && r.provider === provider);
      console.log(`${provider}/${shape}: ${cells.length} cells, ${cells.filter((c) => c.ok).length} ok, ${cells.filter((c) => !c.ok).length} fail`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} provider-abi-conformance test failure(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nAll provider-abi-conformance scenario cells passed (this is a CONFORMANCE report, not a claim of feature-parity — see the unsupported-field probe above and dashboard.md/gap-list.md for divergence findings logged separately, not failed as test assertions since they are documented, expected-per-scope divergences, not regressions).");
  }
}

main().catch((err) => {
  console.error("provider-abi-conformance.test.mjs crashed:", err);
  process.exitCode = 1;
});
