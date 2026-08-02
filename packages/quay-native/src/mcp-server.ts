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

export async function startMcpServer({ tasksDir, adrDir, defaultStatus }: { tasksDir: string; adrDir?: string; defaultStatus?: string }): Promise<void> {
  // DIR-047: pass the per-provider default_task_status through to the store
  // (already validated by the caller — see bin/quay-native.js loadDefaultStatus()).
  // ADR-004 single-source: the store is the one place the creation default is
  // resolved; the MCP server merely forwards the configured value.
  const store = createStore(tasksDir, { defaultStatus });
  // ADRs are a SEPARATE kind (adr-store.js), stored in a sibling directory of
  // tasks/ — default to `<parent-of-tasksDir>/adr` when adrDir is not supplied.
  const resolvedAdrDir = adrDir ?? path.join(path.dirname(tasksDir), "adr");
  const adrStore = createAdrStore(resolvedAdrDir);

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
  server.registerTool(
    "task_list",
    {
      description: "List tasks in the native Provider's task store, optionally filtered by status/label.",
      inputSchema: {
        status: z.string().optional(),
        label: z.string().optional(),
      },
    },
    async ({ status, label }) => {
      const tasks = store.list({ status, label });
      return {
        content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
        structuredContent: { tasks },
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
