// quay-native mcp — the native Provider's formal ABI transport (proposal §5.1).
// Data-only (glossary.md "The ABI (over MCP)"): provider://manifest, task_list,
// task_get for v0 (required, `data.read`); task_write/task_check added since
// time permitted (design §6 symmetry — same store.js core as the CLI).

import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createStore } from "./store.ts";
// ADR store is a generic filesystem-frontmatter store, now owned by `quay`
// (Core) — see bin/quay-native.js for the full rationale (ADR-013 / DIR-035-A).
import { createAdrStore } from "quay/adr-store";
import { readManifest } from "./manifest.ts";
// Goal store is PROVIDER-OWNED (SPEC-goal-mechanism-2026-09-06.md §5.2): the goal
// schema lives here in quay-native, NOT in Core (Core keeps only the view-model +
// a delegation shim). The generic frontmatter plumbing it reuses is Core's
// frontmatter-store-base, reached by relative path (see that file's header).
import { createGoalStore, readGoalConfig } from "./goal-store.ts";
// `goal_gate` runs a goal record's `criterion` through Core's acceptance runner —
// the SAME single runner every Core gate uses (no duplicated timeout/kill logic).
import { runAcceptance } from "../../quay/src/gate/acceptance-runner.ts";

export async function startMcpServer({ tasksDir, adrDir, goalDir, defaultStatus }: { tasksDir: string; adrDir?: string; goalDir?: string; defaultStatus?: string }): Promise<void> {
  // DIR-047: pass the per-provider default_task_status through to the store
  // (already validated by the caller — see bin/quay-native.js loadDefaultStatus()).
  // ADR-004 single-source: the store is the one place the creation default is
  // resolved; the MCP server merely forwards the configured value.
  const store = createStore(tasksDir, { defaultStatus });
  // ADRs are a SEPARATE kind (adr-store.js), stored in a sibling directory of
  // tasks/ — default to `<parent-of-tasksDir>/adr` when adrDir is not supplied.
  const resolvedAdrDir = adrDir ?? path.join(path.dirname(tasksDir), "adr");
  const adrStore = createAdrStore(resolvedAdrDir);
  // Goals are a SEPARATE kind (goal-store.ts), stored in a sibling directory of
  // tasks/ — default to `<parent-of-tasksDir>/goals` when goalDir is not supplied
  // (the same repo-root-sibling resolution shape as adr/). cap/stale (I1′/I3 policy
  // values) are read from `.quay/config.yml`'s `goals:` section at the workspace root
  // (goalDir's parent), honoring the configurable-value discipline of SPEC §4.2.
  const resolvedGoalDir = goalDir ?? path.join(path.dirname(tasksDir), "goals");
  const goalCfg = readGoalConfig(path.dirname(resolvedGoalDir));
  const goalStore = createGoalStore(resolvedGoalDir, { cap: goalCfg.cap, staleMs: goalCfg.staleMs });

  const server = new McpServer({
    name: "quay-native",
    version: "0.0.1",
  });

  // provider://manifest — static declaration resource (proposal §7, required).
  server.registerResource(
    "manifest",
    "provider://manifest",
    { description: "quay-native's static self-declaration (provider.yml)" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(readManifest(), null, 2),
        },
      ],
    })
  );

  // task_list — data.read (required)
  // gap-task-list-route-is-linear-in-task-count: the list route (web board,
  // CLI `--summary`-style consumers) only needs frontmatter fields
  // (id/title/status/labels/role/children/updatedAt) — NOT the full body
  // markdown. This tool accepts an OPTIONAL `includeBody` (default true =
  // full tasks, byte-for-byte backward compatible with every existing
  // caller). Passing `includeBody: false` strips `body` from each returned
  // task, shrinking the MCP round-trip payload from ~5.7MB (all task bodies)
  // to ~0.3MB (frontmatter only) — the dominant cost in the
  // "MCP round-trip + rendering" half of the task-list route. The param is
  // additive and opt-in: providers/callers that never pass it are unaffected.
  //
  // gap-serve-search-timeout-all-body-fetch: an OPTIONAL `search` param does
  // server-side title+body filtering (heading lines stripped, case-insensitive)
  // BEFORE the response is built, so the MCP round-trip carries only the
  // matching tasks instead of every task's body. The web UI's `/tasks?q=`
  // search uses this to avoid the 1572-body payload that timed out the MCP
  // round-trip (-32001). Search is applied in the store walk (status → label →
  // search), independent of `includeBody` (which only shapes the response).
  server.registerTool(
    "task_list",
    {
      description: "List tasks in the native Provider's task store, optionally filtered by status/label/search.",
      inputSchema: {
        status: z.string().optional(),
        label: z.string().optional(),
        includeBody: z.boolean().optional(),
        search: z.string().optional(),
      },
    },
    async ({ status, label, includeBody, search }) => {
      // gap-one-unparseable-task-takes-down-the-whole-board: partial success.
      // One task file whose frontmatter fails to parse must not take down the
      // whole task_list call (that was the "all-or-nothing" defect) — return
      // the parseable tasks PLUS a machine-readable malformed list ({file,
      // error}) so the Core can surface the bad file visibly instead of 500ing
      // the board. isError stays reserved for genuine call-level failures
      // (store itself unreachable, etc.), which still throw.
      const { tasks, malformed } = store.listWithMalformed({ status, label, search });
      const outTasks = includeBody === false
        ? tasks.map((t) => { const { body: _omit, ...rest } = t; return rest; })
        : tasks;
      return {
        content: [{ type: "text", text: JSON.stringify({ tasks: outTasks, malformed }, null, 2) }],
        structuredContent: { tasks: outTasks, malformed },
      };
    }
  );

  // task_get — data.read (required)
  server.registerTool(
    "task_get",
    {
      description: "Get one task by id from the native Provider's task store.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const task = store.get(id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text", text: `no such task: ${id}` }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
        structuredContent: { task },
      };
    }
  );

  // task_write — data.write (optional capability; implemented for v0 since
  // time permitted, per the task prompt's "if time permits").
  server.registerTool(
    "task_write",
    {
      description: "Write/patch one task's frontmatter and/or body in the native Provider's task store.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        labels: z.array(z.string()).optional(),
        parent: z.string().nullable().optional(),
        children: z.array(z.string()).optional(),
        // gap-unified-frontmatter-parser: `depends_on` is a first-class relation edge (prerequisite
        // task ids), explicitly listed here so users can discover it WITHOUT the `extra` escape hatch.
        // It is stored top-level (mirroring `children`), and read back by readDependsOn()/parseTask()/
        // store.parse() through the single frontmatter parser. Legacy `extra: { depends_on: [...] }`
        // remains readable for backward compatibility.
        //   canonical (new writes):   depends_on: ["dep1", "dep2"]
        //   legacy (still readable):  extra: { depends_on: [dep1, dep2], schema: "v1" }
        depends_on: z.array(z.string()).optional(),
        body: z.string().optional(),
        // QN-007: `extra` (design §7.1's "escape hatch for backend-specific
        // fields") was missing from this schema entirely — the MCP SDK's
        // zod-based input validation silently stripped it before it ever
        // reached store.write(), even though store.write() itself has always
        // handled `extra` correctly (the CLI's `edit --extra` path proves
        // this). z.record(z.string(), z.any()) accepts an arbitrary JSON object, matching
        // the CLI's own `JSON.parse(flags.extra)` looseness (no schema
        // validation beyond "is it an object" — G5, do not gold-plate).
        extra: z.record(z.string(), z.any()).optional(),
        // QN-015: CAS option, symmetric with the CLI's --expect-status flag
        // (design §6). Omitted entirely => store.write()'s existing,
        // unaffected behavior (no CAS check performed).
        expectedStatus: z.string().optional(),
      },
    },
    async ({ id, ...patch }) => {
      try {
        const task = store.write(id, patch);
        return {
          content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
          structuredContent: { task },
        };
      } catch (err) {
        if (err && err.name === "ConflictError") {
          return {
            content: [{ type: "text", text: `CAS conflict: ${err.message}` }],
            structuredContent: {
              error: "ConflictError",
              message: err.message,
              id: err.id,
              expectedStatus: err.expectedStatus,
              actualStatus: err.actualStatus,
            },
            isError: true,
          };
        }
        throw err;
      }
    }
  );

  // task_delete — data.write (gap-abi-missing-commit-delete-dependson-primitives): the ABI verb the
  // native Provider was missing. Unlinks the task file + branch-aware commit (same primitive as
  // task_write). Fail-closed: a not-found id returns isError:true, never a silent no-op.
  server.registerTool(
    "task_delete",
    {
      description: "Delete one task by id from the native Provider's task store (unlink + branch-aware commit). Fails closed (isError) on a non-existent id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const result = store.delete(id);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: result.reason === "missing" ? `no such task: ${id}` : result.reason }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // task_check — gate (optional capability; native provides it, design §6).
  server.registerTool(
    "task_check",
    {
      description: "Assert the ready/done gates for one task (design §3): author->ready or execute->done.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const result = store.check(id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ── ADR tools (separate object kind — decision lifecycle, not task lifecycle) ──
  // adr_list — data.read
  server.registerTool(
    "adr_list",
    {
      description: "List ADRs (Architecture Decision Records) in the native store, optionally filtered by status/tag.",
      inputSchema: { status: z.string().optional(), tag: z.string().optional() },
    },
    async ({ status, tag }) => {
      const adrs = adrStore.list({ status, tag });
      return {
        content: [{ type: "text", text: JSON.stringify(adrs, null, 2) }],
        structuredContent: { adrs },
      };
    }
  );

  // adr_get — data.read
  server.registerTool(
    "adr_get",
    {
      description: "Get one ADR by id (ADR-NNN) from the native store.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      let adr = null;
      try {
        adr = adrStore.get(id);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
      if (!adr) return { isError: true, content: [{ type: "text", text: `no such ADR: ${id}` }] };
      return {
        content: [{ type: "text", text: JSON.stringify(adr, null, 2) }],
        structuredContent: { adr },
      };
    }
  );

  // adr_write — data.write. Status is the DECISION lifecycle (never "done").
  server.registerTool(
    "adr_write",
    {
      description: "Write/patch one ADR (frontmatter + body) in the native store. status ∈ proposed|accepted|superseded|deprecated|rejected.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        date: z.string().optional(),
        supersedes: z.array(z.string()).optional(),
        superseded_by: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        body: z.string().optional(),
      },
    },
    async ({ id, superseded_by, ...rest }) => {
      try {
        const adr = adrStore.write(id, { ...rest, supersededBy: superseded_by });
        return {
          content: [{ type: "text", text: JSON.stringify(adr, null, 2) }],
          structuredContent: { adr },
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
    }
  );

  // ── Goal tools (separate object kind — provider-backed storage, SPEC §5.2) ──
  // goal_list — data.read
  server.registerTool(
    "goal_list",
    {
      description: "List goal records (GOAL-NNN + AC-NNN) in the native store, optionally filtered by status/kind/goal.",
      inputSchema: { status: z.string().optional(), kind: z.string().optional(), goal: z.string().optional() },
    },
    async ({ status, kind, goal }) => {
      const goals = goalStore.list({ status, kind, goal });
      return {
        content: [{ type: "text", text: JSON.stringify(goals, null, 2) }],
        structuredContent: { goals },
      };
    }
  );

  // goal_get — data.read
  server.registerTool(
    "goal_get",
    {
      description: "Get one goal record by id (GOAL-NNN or AC-NNN) from the native store.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      let goal = null;
      try {
        goal = goalStore.get(id);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
      if (!goal) return { isError: true, content: [{ type: "text", text: `no such goal: ${id}` }] };
      return {
        content: [{ type: "text", text: JSON.stringify(goal, null, 2) }],
        structuredContent: { goal },
      };
    }
  );

  // goal_write — data.write. I1′ (hard cap) is enforced by the provider's write
  // path (SPEC §5.2: the invariant lives in the provider so a future provider
  // cannot bypass it). `origin` is required; AC records must declare `goal:`.
  server.registerTool(
    "goal_write",
    {
      description: "Write/patch one goal record (GOAL-NNN or AC-NNN) in the native store. status ∈ draft|active|achieved|superseded|retired; `origin` is required (empty origin writes nothing); an AC record must declare `goal: GOAL-NNN`; activating past the active-GOAL cap (default 3) is rejected unless the same call disposes an active goal.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        goal: z.string().optional(),
        criterion: z.string().optional(),
        expect: z.string().optional(),
        origin: z.string().optional(),
        evidence: z.object({ at: z.string().optional(), verdict: z.string().optional(), reading: z.string().optional() }).optional(),
        supersedes: z.array(z.string()).optional(),
        superseded_by: z.array(z.string()).optional(),
        body: z.string().optional(),
        disposeOld: z.object({ id: z.string(), to: z.enum(["achieved", "superseded"]) }).optional(),
      },
    },
    async ({ id, superseded_by, disposeOld, ...rest }) => {
      try {
        const goal = goalStore.write(id, { ...rest, supersededBy: superseded_by, disposeOld: disposeOld as { id: string; to: "achieved" | "superseded" } | undefined });
        return {
          content: [{ type: "text", text: JSON.stringify(goal, null, 2) }],
          structuredContent: { goal },
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
    }
  );

  // goal_gate — run the record's `criterion` via Core's acceptance runner and
  // return the verdict. Empty criterion fails closed (never a silent PASS).
  server.registerTool(
    "goal_gate",
    {
      description: "Run one goal record's `criterion` via the acceptance runner and return the verdict (empty criterion fails closed).",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      let goal = null;
      try {
        goal = goalStore.get(id);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
      if (!goal) return { isError: true, content: [{ type: "text", text: `no such goal: ${id}` }] };
      const criterion = (goal as unknown as Record<string, unknown>).criterion;
      let verdict: string;
      let reason: string;
      if (typeof criterion !== "string" || criterion.trim() === "") {
        verdict = "fail";
        reason = `${id} has no criterion defined (fail-closed — an unenforceable AC must never silently pass)`;
      } else {
        const result = runAcceptance({ command: criterion, cwd: path.dirname(resolvedGoalDir), timeoutMs: 60000 });
        verdict = result.ok ? "pass" : "fail";
        reason = result.reason;
      }
      const out = { id, verdict, reason, timestamp: new Date().toISOString() };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now runs until stdin closes; log to stderr (stdout is the MCP channel).
  console.error(`quay-native mcp: serving tasks from ${tasksDir}, ADRs from ${resolvedAdrDir}`);

  // gap-suite-speedup (task gap-suite-speedup): when the client disconnects
  // (stdin EOF), close the transport so the process exits promptly. The SDK
  // StdioServerTransport only watches stdin for 'data'/'error', never
  // 'end'/'close' — so a disconnected server whose event loop still holds a
  // live handle would otherwise never drain, and an SDK client's
  // StdioClientTransport.close() would fall back to its 2s SIGTERM timeout.
  // Closing the transport on stdin EOF drains those handles so the process
  // exits on its own. No behavior change to serving: only shutdown becomes
  // prompt.
  process.stdin.on("close", () => {
    void transport.close();
  });
}
