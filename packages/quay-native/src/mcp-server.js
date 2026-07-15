// quay-native mcp — the native Provider's formal ABI transport (proposal §5.1).
// Data-only (glossary.md "The ABI (over MCP)"): provider://manifest, task_list,
// task_get for v0 (required, `data.read`); task_write/task_check added since
// time permitted (design §6 symmetry — same store.js core as the CLI).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createStore } from "./store.js";
import { readManifest } from "./manifest.js";

export async function startMcpServer({ tasksDir }) {
  const store = createStore(tasksDir);

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
        // this). z.record(z.any()) accepts an arbitrary JSON object, matching
        // the CLI's own `JSON.parse(flags.extra)` looseness (no schema
        // validation beyond "is it an object" — G5, do not gold-plate).
        extra: z.record(z.any()).optional(),
      },
    },
    async ({ id, ...patch }) => {
      const task = store.write(id, patch);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
        structuredContent: { task },
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now runs until stdin closes; log to stderr (stdout is the MCP channel).
  console.error(`quay-native mcp: serving tasks from ${tasksDir}`);
}
