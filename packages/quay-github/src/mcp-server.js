// quay-github mcp — the GitHub Provider's formal ABI transport (proposal §5.1).
// Mirrors quay-native's src/mcp-server.js shape (design §6: "native as ABI
// conformance reference" — the GitHub Provider should structurally resemble
// the reference, not invent a new shape). v1 is read-only:
// provider://manifest, task_list, task_get ONLY (data.read + manifest).
// task_write / task_check are deliberately NOT implemented (QN-002 v1 scope,
// G5 walking-skeleton discipline — do not gold-plate a read-only Provider).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createGithubClient } from "./github-client.js";
import { readManifest } from "./manifest.js";

export async function startMcpServer({ owner, repo }) {
  const client = createGithubClient({ owner, repo });

  const server = new McpServer({
    name: "quay-github",
    version: "0.0.1",
  });

  // provider://manifest — static declaration resource (proposal §7, required).
  server.registerResource(
    "manifest",
    "provider://manifest",
    { description: "quay-github's static self-declaration (provider.yml)" },
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

  // task_list — data.read (required). Same tool name/shape as quay-native's
  // task_list (design §6 symmetry principle extended across Providers).
  server.registerTool(
    "task_list",
    {
      description:
        "List tasks in the GitHub Provider's backing repository (issues), optionally filtered by status/label.",
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

  // task_get — data.read (required). Same tool name/shape as quay-native's
  // task_get.
  server.registerTool(
    "task_get",
    {
      description: "Get one task by id (gh-<issue-number>) from the GitHub Provider.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const task = client.get(id);
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

  // NOTE: task_write / task_check are intentionally NOT registered — v1
  // capabilities are data.read + manifest only (provider.yml declares this
  // explicitly; QN-002 AC #3). The Core degrades gracefully (design §6.2):
  // no write -> grey out edit.

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`quay-github mcp: serving tasks from github.com/${owner}/${repo} (read-only v1)`);
}
