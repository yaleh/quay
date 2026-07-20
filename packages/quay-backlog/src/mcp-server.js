// quay-backlog mcp — the Backlog.md Provider's formal ABI transport
// (proposal §5.1). Mirrors quay-native's/quay-github's src/mcp-server.js
// shape (design §6: "native as ABI conformance reference"). Read-only:
// task_list, task_get, task_check (a clear "not supported" result, never a
// fabricated pass/fail — see backlog-client.js#check's own comment); NO
// task_write tool at all (this Provider declares capabilities.data.write:
// false in provider.yml — there is no write tool to call, matching the
// documented contract rather than registering a tool that always errors).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createBacklogClient } from "./backlog-client.js";
import { readManifest } from "./manifest.js";

export async function startMcpServer({ tasksDir }) {
  const client = createBacklogClient(tasksDir);

  const server = new McpServer({
    name: "quay-backlog",
    version: "0.0.1",
  });

  // provider://manifest — static declaration resource (proposal §7, required).
  server.registerResource(
    "manifest",
    "provider://manifest",
    { description: "quay-backlog's static self-declaration (provider.yml)" },
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

  // task_list — data.read (required).
  server.registerTool(
    "task_list",
    {
      description: "List tasks in the Backlog.md board's backing tasks directory, optionally filtered by status/label.",
      inputSchema: {
        status: z.string().optional(),
        label: z.string().optional(),
      },
    },
    async ({ status, label }) => {
      const tasks = client.list({ status, label });
      return {
        content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
        structuredContent: { tasks },
      };
    }
  );

  // task_get — data.read (required).
  server.registerTool(
    "task_get",
    {
      description: "Get one task by id (e.g. TASK-3) from the Backlog.md board.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const task = client.get(id);
      if (!task) {
        return { isError: true, content: [{ type: "text", text: `no such task: ${id}` }] };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
        structuredContent: { task },
      };
    }
  );

  // task_check — always reports ok:false with a clear "not supported"
  // reason (this Provider has no gate). Mirrors the shape of every other
  // Provider's task_check tool so a generic caller (e.g. Core's taskCheck
  // passthrough) gets a well-formed structuredContent result, not a thrown
  // error, when it happens to call this on a read-only Provider.
  server.registerTool(
    "task_check",
    {
      description: "quay-backlog has no gate concept; always reports ok:false with reason 'not supported'.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const result = client.check(id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ── ADR tools — quay-backlog does NOT support ADRs, mirrors quay-github's
  // own degrade-cleanly convention exactly.
  const ADR_UNSUPPORTED = "quay-backlog does not support ADRs; use the native provider for ADR storage.";
  server.registerTool(
    "adr_list",
    { description: "ADRs are not supported by the Backlog.md provider; always returns an empty list.", inputSchema: { status: z.string().optional(), tag: z.string().optional() } },
    async () => ({ content: [{ type: "text", text: "[]" }], structuredContent: { adrs: [] } })
  );
  server.registerTool(
    "adr_get",
    { description: "ADRs are not supported by the Backlog.md provider.", inputSchema: { id: z.string() } },
    async () => ({ isError: true, content: [{ type: "text", text: ADR_UNSUPPORTED }] })
  );
  server.registerTool(
    "adr_write",
    { description: "ADRs are not supported by the Backlog.md provider.", inputSchema: { id: z.string() } },
    async () => ({ isError: true, content: [{ type: "text", text: ADR_UNSUPPORTED }] })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`quay-backlog mcp: serving read-only tasks from ${tasksDir}`);
}
