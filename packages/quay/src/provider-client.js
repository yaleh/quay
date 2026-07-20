// @ts-nocheck — TS gradual-adoption ramp list (ADR-012): tsc --noEmit real-checked this file and found pre-existing untyped-JS structural diagnostics; fixing them means real JSDoc typing / a product-code touch, out of the tooling-only phase that introduced this gate. Remove this line once this file is migrated/annotated.
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

  // M26-adversarial-eval finding M26-F2 (Phase A audit): this previously
  // returned `r.structuredContent?.tasks ?? []` with NO `r.isError` check —
  // unlike taskGet/taskWrite/taskCheck below, which all check it. When the
  // underlying Provider's task_list tool throws (e.g. a malformed task file
  // crashing quay-native's store.list(), or a live gh-api rate-limit/network
  // failure crashing quay-github's fetchAllIssues()), the MCP SDK converts
  // that into an isError:true result with NO structuredContent — the old
  // code silently coerced that into an empty array, so `quay serve`'s list
  // page (and any other taskList() caller) rendered "0 tasks" with zero
  // error indication, hiding both the real failure AND every other
  // legitimate task in the store. Now: an isError result throws, matching
  // the other three methods' existing behavior, so callers can catch it and
  // surface a real error instead of a silently-empty list.
  async function taskList(filter = {}) {
    const r = await client.callTool({ name: "task_list", arguments: filter });
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

  // ── ADR ABI (separate object kind — a provider MAY support ADRs; the native
  // provider does, the github provider declares them unsupported). adrList
  // degrades to [] on isError so an ADR-less provider renders cleanly; adrGet
  // returns null on isError (mirrors taskGet); adrWrite throws (mirrors taskWrite).
  async function adrList(filter = {}) {
    const r = await client.callTool({ name: "adr_list", arguments: filter });
    if (r.isError) return [];
    return r.structuredContent?.adrs ?? [];
  }

  async function adrGet(id) {
    const r = await client.callTool({ name: "adr_get", arguments: { id } });
    if (r.isError) return null;
    return r.structuredContent?.adr ?? null;
  }

  async function adrWrite(patch) {
    const r = await client.callTool({ name: "adr_write", arguments: patch });
    if (r.isError) throw new Error(r.content?.[0]?.text ?? "adr_write failed");
    return r.structuredContent?.adr ?? null;
  }

  async function manifest() {
    const r = await client.readResource({ uri: "provider://manifest" });
    return JSON.parse(r.contents[0].text);
  }

  async function close() {
    await client.close();
  }

  return { taskList, taskGet, taskWrite, taskCheck, adrList, adrGet, adrWrite, manifest, close };
}
