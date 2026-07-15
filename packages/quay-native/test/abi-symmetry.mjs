// ABI symmetry check (design §6): quay-native's CLI `--json` output vs its
// MCP tool `structuredContent` must be the same schema, for all four
// surfaces: task_list, task_get, task_write, task_check.
// Iteration 1: iteration 0 only checked task_get key-by-key. This script
// checks all four for real, side-by-side, via an actual MCP client
// connection (not asserted).

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(__dirname, "..", "bin", "quay-native.js");

function cliJson(tasksDir, args) {
  const out = execFileSync("node", [binPath, ...args, "--json"], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

function keysOf(obj) {
  if (Array.isArray(obj)) return keysOf(obj[0] ?? {});
  return Object.keys(obj).sort();
}

async function main() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-abi-"));

  // Seed one task via CLI (create is a CLI-only convenience, not part of ABI).
  execFileSync("node", [binPath, "task", "create", "T-1", "--title", "Symmetry test", "--body", "## Proposal\nx\n## Plan\nx\n## AC\n- [ ] a\n## DoD\n- [ ] d\n"], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: [binPath, "mcp"],
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  const client = new Client({ name: "abi-symmetry-test", version: "0.0.1" });
  await client.connect(transport);

  const results = {};

  // 1. task_list
  {
    const cli = cliJson(tasksDir, ["task", "list"]);
    const mcp = await client.callTool({ name: "task_list", arguments: {} });
    const mcpTasks = mcp.structuredContent.tasks;
    results.task_list = {
      cliKeys: keysOf(cli),
      mcpKeys: keysOf(mcpTasks),
      match: JSON.stringify(keysOf(cli)) === JSON.stringify(keysOf(mcpTasks)),
    };
  }

  // 2. task_get
  {
    const cli = cliJson(tasksDir, ["task", "get", "T-1"]);
    const mcp = await client.callTool({ name: "task_get", arguments: { id: "T-1" } });
    const mcpTask = mcp.structuredContent.task;
    results.task_get = {
      cliKeys: keysOf(cli),
      mcpKeys: keysOf(mcpTask),
      match: JSON.stringify(keysOf(cli)) === JSON.stringify(keysOf(mcpTask)),
    };
  }

  // 3. task_write  (CLI: `task edit`; MCP: `task_write`)
  {
    const cli = cliJson(tasksDir, ["task", "edit", "T-1", "--labels", "x,y"]);
    const mcp = await client.callTool({ name: "task_write", arguments: { id: "T-1", labels: ["x", "y"] } });
    const mcpTask = mcp.structuredContent.task;
    results.task_write = {
      cliKeys: keysOf(cli),
      mcpKeys: keysOf(mcpTask),
      match: JSON.stringify(keysOf(cli)) === JSON.stringify(keysOf(mcpTask)),
    };
  }

  // 3b. task_write — body/children/extra VALUE equivalence (QN-001,
  // iteration 2; extended for `extra` in QN-007, iteration 3):
  // key-set match alone (3, above) does not prove CLI --body/--children/
  // --extra and MCP task_write's body/children/extra params produce
  // identical resulting view-models. Patch via CLI on one task id, via MCP
  // on a second, sibling task id seeded identically, then diff the actual
  // field VALUES (not just keys) between the two results.
  //
  // QN-007 honesty note: iteration 2's original version of this block
  // constructed `--extra` on the CLI side (`{ k: "v" }`) but NEVER passed
  // `extra` to the MCP call at all — so it could not have caught QN-007's
  // bug (MCP's inputSchema silently dropping `extra`) even though `extra`
  // appeared to be "covered" by this test's CLI-side call. This is exactly
  // the class of false confidence a value-level test can still produce if
  // it doesn't symmetrically exercise BOTH surfaces for the SAME field —
  // fixed here by passing `extra` into the MCP `task_write` call too, and by
  // asserting the MCP-side `extra` is not silently `{}` when a non-empty
  // value was sent (the specific regression this bug produced).
  {
    execFileSync("node", [binPath, "task", "create", "T-2", "--title", "Symmetry test (MCP twin)"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const cli = cliJson(tasksDir, [
      "task", "edit", "T-1",
      "--body", "patched via CLI",
      "--children", "C-1,C-2",
      "--extra", JSON.stringify({ k: "v" }),
    ]);
    const mcp = await client.callTool({
      name: "task_write",
      arguments: { id: "T-2", body: "patched via CLI", children: ["C-1", "C-2"], extra: { k: "v" } },
    });
    const mcpTask = mcp.structuredContent.task;
    const valueMatch =
      cli.body === mcpTask.body &&
      JSON.stringify(cli.children) === JSON.stringify(mcpTask.children) &&
      cli.role === mcpTask.role && // role re-derives to "compound" on both sides
      JSON.stringify(cli.extra) === JSON.stringify(mcpTask.extra) &&
      JSON.stringify(mcpTask.extra) !== JSON.stringify({}); // guards against silent-drop regressions
    results.task_write_value_equivalence = {
      cliBody: cli.body,
      mcpBody: mcpTask.body,
      cliChildren: cli.children,
      mcpChildren: mcpTask.children,
      cliRole: cli.role,
      mcpRole: mcpTask.role,
      cliExtra: cli.extra,
      mcpExtra: mcpTask.extra,
      match: valueMatch,
    };
  }

  // 3c. task_write — `extra` VALUE equivalence, isolated case (QN-007,
  // iteration 3): 3b above exercises `extra` alongside body/children on an
  // already-populated task; this block additionally proves the isolated
  // case — patching ONLY `extra` (no other fields) via each surface on two
  // freshly-seeded sibling tasks, confirming neither surface requires other
  // fields to be present for `extra` to round-trip correctly, and that the
  // MCP surface's `extra` is genuinely settable in isolation (not merely as
  // a side-effect of also setting `body`/`children` in the same call).
  {
    execFileSync("node", [binPath, "task", "create", "T-3", "--title", "extra-only CLI"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    execFileSync("node", [binPath, "task", "create", "T-4", "--title", "extra-only MCP"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const cli = cliJson(tasksDir, [
      "task", "edit", "T-3",
      "--extra", JSON.stringify({ foo: "bar", nested: { n: 1 } }),
    ]);
    const mcp = await client.callTool({
      name: "task_write",
      arguments: { id: "T-4", extra: { foo: "bar", nested: { n: 1 } } },
    });
    const mcpTask = mcp.structuredContent.task;
    const extraMatch =
      JSON.stringify(cli.extra) === JSON.stringify(mcpTask.extra) &&
      JSON.stringify(mcpTask.extra) === JSON.stringify({ foo: "bar", nested: { n: 1 } });
    results.task_write_extra_only_equivalence = {
      cliExtra: cli.extra,
      mcpExtra: mcpTask.extra,
      match: extraMatch,
    };
  }

  // 4. task_check
  {
    let cli;
    try {
      cli = cliJson(tasksDir, ["task", "check", "T-1"]);
    } catch (e) {
      // task check exits non-zero on ok:false; execFileSync throws but still
      // has stdout on e.stdout.
      cli = JSON.parse(e.stdout.toString());
    }
    const mcp = await client.callTool({ name: "task_check", arguments: { id: "T-1" } });
    const mcpResult = mcp.structuredContent;
    results.task_check = {
      cliKeys: keysOf(cli),
      mcpKeys: keysOf(mcpResult),
      match: JSON.stringify(keysOf(cli)) === JSON.stringify(keysOf(mcpResult)),
    };
  }

  await client.close();
  fs.rmSync(tasksDir, { recursive: true, force: true });

  console.log(JSON.stringify(results, null, 2));
  const allMatch = Object.values(results).every((r) => r.match);
  console.log(allMatch ? "ALL FOUR SURFACES SYMMETRIC" : "MISMATCH FOUND");
  process.exitCode = allMatch ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
