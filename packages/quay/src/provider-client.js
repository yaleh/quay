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
    // M26-adversarial-eval finding ADV-001: taskList previously did not check
    // r.isError (unlike taskGet/taskWrite/taskCheck below, which all do) --
    // when the underlying Provider throws (e.g. one malformed task file
    // breaking store.list()), the MCP SDK returns isError:true with no
    // structuredContent, and this silently degraded to an empty array `[]`,
    // indistinguishable from "workspace legitimately has zero tasks". A
    // corrupted/malformed single task file could make the Web UI (and any
    // other taskList caller) silently show zero tasks instead of surfacing
    // an error -- worse than a crash for a task-management tool, since data
    // appears lost rather than reporting a diagnosable fault. Now matches
    // the other three passthroughs' isError handling.
    if (r.isError) throw new Error(r.content?.[0]?.text ?? "task_list failed");
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

  // QN-027 (iteration 13): generic task_check passthrough, mirroring
  // taskWrite's pattern exactly — provider-agnostic, no backend branch.
  // Whether the active Provider actually implements task_check (gate
  // capability) is between the caller and the Provider's own manifest;
  // Core just forwards the id and returns whatever the Provider's gate
  // reports, same as taskList/taskGet/taskWrite already do.
  async function taskCheck(id) {
    const r = await client.callTool({ name: "task_check", arguments: { id } });
    if (r.isError) throw new Error(r.content?.[0]?.text ?? "task_check failed");
    return r.structuredContent ?? null;
  }

  async function manifest() {
    const r = await client.readResource({ uri: "provider://manifest" });
    return JSON.parse(r.contents[0].text);
  }

  async function close() {
    await client.close();
  }

  return { taskList, taskGet, taskWrite, taskCheck, manifest, close };
}
