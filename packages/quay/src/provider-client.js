// The Core's MCP client over the Provider ABI (proposal §5, §9). quay (Core)
// is provider-agnostic: it launches whatever `mcp_entry` the active Provider's
// config declares and speaks the uniform data-only ABI — no backend branch.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectProvider({ command, args, env, cwd }) {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env: { ...process.env, ...(env ?? {}) },
  });
  const client = new Client({ name: "quay-core", version: "0.0.1" });
  await client.connect(transport);

  async function taskList(filter = {}) {
    const r = await client.callTool({ name: "task_list", arguments: filter });
    return r.structuredContent?.tasks ?? [];
  }

  async function taskGet(id) {
    const r = await client.callTool({ name: "task_get", arguments: { id } });
    if (r.isError) return null;
    return r.structuredContent?.task ?? null;
  }

  // QN-024 (iteration 10): generic task_write passthrough — no
  // provider-specific branch. Whether a given Provider actually implements
  // task_write (data.write capability) is between the caller and the
  // Provider's own manifest; Core just forwards whatever patch fields are
  // given, same as taskList/taskGet forward whatever filter/id is given.
  async function taskWrite(patch) {
    const r = await client.callTool({ name: "task_write", arguments: patch });
    if (r.isError) throw new Error(r.content?.[0]?.text ?? "task_write failed");
    return r.structuredContent?.task ?? null;
  }

  async function manifest() {
    const r = await client.readResource({ uri: "provider://manifest" });
    return JSON.parse(r.contents[0].text);
  }

  async function close() {
    await client.close();
  }

  return { taskList, taskGet, taskWrite, manifest, close };
}
