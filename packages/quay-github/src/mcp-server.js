// quay-github mcp — the GitHub Provider's formal ABI transport (proposal §5.1).
// Mirrors quay-native's src/mcp-server.js shape (design §6: "native as ABI
// conformance reference" — the GitHub Provider should structurally resemble
// the reference, not invent a new shape). v1: provider://manifest, task_list,
// task_get (data.read + manifest, QN-002); task_write (status-only, QN-024);
// task_check (gate, primitive tasks only, QN-028, iteration 17). `skill`
// (status→Skill map / action buttons) remains a distinct, unimplemented
// capability — a separate follow-up, not part of this file's current scope.

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

  // task_write — data.write (QN-024, iteration 10: minimal status-only
  // write). Mirrors quay-native's own task_write tool name (design §6
  // symmetry), but with a deliberately narrower input schema — only `id`
  // and `status` are accepted, per this task's explicit scope discipline
  // (G5: do not gold-plate; title/body/labels/parent/children writes
  // remain out of scope for v1).
  server.registerTool(
    "task_write",
    {
      description:
        "Patch one task's status in the GitHub Provider's backing repository (status-only v1 write capability).",
      inputSchema: { id: z.string(), status: z.string() },
    },
    async ({ id, status }) => {
      const task = client.setStatus(id, status);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
        structuredContent: { task },
      };
    }
  );

  // task_check — gate (QN-028, iteration 17). Mirrors quay-native's own
  // task_check tool name/schema exactly ({id} input, structuredContent
  // output) so Core's existing, unmodified taskCheck() passthrough
  // (provider-client.js, QN-027) works against this Provider with zero
  // Core-side changes — the actual reusability/transfer proof this task
  // exists to produce. Primitive-task scope only (G5) — see
  // github-client.js's checkGate() header note.
  server.registerTool(
    "task_check",
    {
      description:
        "Assert the author->ready / execute->done gate for one GitHub-backed task (primitive tasks only, v1).",
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`quay-github mcp: serving tasks from github.com/${owner}/${repo} (read-only v1)`);
}
