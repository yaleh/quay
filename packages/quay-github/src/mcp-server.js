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

  // task_write — data.write. QN-024 (iteration 10) shipped status-only
  // write; M09-gh-write (PR-ABI-001) extends this to real title/body/labels
  // write, while `parent`/`children` write remains explicitly out of scope
  // (charter M09-gh-write's exclusion — cross-issue body-text mutation is a
  // materially different/riskier write path, deferred to a future
  // milestone). Per PR-ABI-001's hard-error floor: any field NOT in this
  // schema's accepted set (id/status/title/body/labels) is now rejected
  // with an explicit isError:true tool error rather than the prior silent
  // drop-via-zod-input-stripping behavior — the MCP SDK's own zod input
  // validation strips unrecognized keys before the handler ever sees them,
  // so the handler cannot itself detect "an extra field was silently
  // dropped" after the fact; the fix is a raw (non-zod-typed) passthrough
  // shape plus an explicit unsupported-key scan INSIDE the handler, so
  // unrecognized keys are visible and can be rejected instead of stripped.
  const TASK_WRITE_SUPPORTED_FIELDS = new Set(["id", "status", "title", "body", "labels"]);
  // PR-ABI-001 hard-error floor: the MCP SDK builds a zod `z.object(shape)`
  // from a plain inputSchema shape and, by default, SILENTLY STRIPS
  // unrecognized keys before the handler ever sees them (confirmed by
  // reading node_modules/@modelcontextprotocol/sdk's own
  // server/mcp.js#validateToolInput -> zod-compat.js#normalizeObjectSchema
  // -> objectFromShape -- a plain `{k: zodType}` shape object is detected as
  // a "raw shape" and rebuilt into a default z.object(), which strips extra
  // keys). Passing an ACTUAL zod object schema (this has `_def`, so
  // normalizeObjectSchema's raw-shape heuristic does not fire and the
  // schema is used AS GIVEN) with `.catchall(z.unknown())` disables that
  // stripping -- unrecognized keys survive into the parsed args object, so
  // the handler below can see and explicitly reject them instead of the SDK
  // silently dropping them first. This is the actual fix for the
  // `title` field being silently dropped (task_write-unsupported-field-probe).
  const taskWriteInputSchema = z
    .object({
      id: z.string(),
      status: z.string().optional(),
      title: z.string().optional(),
      body: z.string().optional(),
      labels: z.array(z.string()).optional(),
    })
    .catchall(z.unknown());
  server.registerTool(
    "task_write",
    {
      description:
        "Patch one task's status/title/body/labels in the GitHub Provider's backing repository. " +
        "`parent`/`children` write is not supported (returns an explicit error); any other " +
        "unrecognized field also returns an explicit error rather than silently no-op'ing.",
      inputSchema: taskWriteInputSchema,
    },
    async (rawArgs) => {
      const unsupported = Object.keys(rawArgs).filter((k) => !TASK_WRITE_SUPPORTED_FIELDS.has(k));
      if (unsupported.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `task_write: unsupported field(s) [${unsupported.join(", ")}] — this Provider ` +
                `does not implement writing ${unsupported.join("/")} (e.g. parent/children write ` +
                `is explicitly out of scope, see M09-gh-write charter). Supported fields: ` +
                `${[...TASK_WRITE_SUPPORTED_FIELDS].join(", ")}.`,
            },
          ],
        };
      }
      const { id, status, title, body, labels } = rawArgs;
      if (status === undefined && title === undefined && body === undefined && labels === undefined) {
        return {
          isError: true,
          content: [{ type: "text", text: "task_write: at least one of status/title/body/labels is required" }],
        };
      }
      try {
        let task;
        if (status !== undefined) {
          task = client.setStatus(id, status);
        }
        const otherFields = {};
        if (title !== undefined) otherFields.title = title;
        if (body !== undefined) otherFields.body = body;
        if (labels !== undefined) otherFields.labels = labels;
        if (Object.keys(otherFields).length > 0) {
          task = client.writeFields(id, otherFields);
        }
        if (!task) {
          return { isError: true, content: [{ type: "text", text: `no such task: ${id}` }] };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
          structuredContent: { task },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `task_write failed: ${err.message}` }],
        };
      }
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
