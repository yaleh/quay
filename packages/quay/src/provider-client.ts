// The Core's MCP client over the Provider ABI (proposal §5, §9). quay (Core)
// is provider-agnostic: it launches whatever `mcp_entry` the active Provider's
// config declares and speaks the uniform data-only ABI — no backend branch.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Task, AdrRecord, Manifest, TaskDeleteResult, GoalRecord, MetaRecord } from './abi.ts';

export interface ConnectProviderOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

// gap-one-unparseable-task-takes-down-the-whole-board: the Provider's
// task_list may return PARTIAL success — the tasks whose frontmatter parsed,
// plus a machine-readable list of the files that did NOT (file name + the
// parser's raw error). This is NOT a call-level failure: `isError` is still
// reserved for genuine failures (provider unreachable, store itself unusable),
// which taskList() still throws on. The malformed list is what lets one bad
// task poison exactly its own row on the board instead of 500ing the whole
// list.
export interface MalformedTask {
  /** filename of the unparseable task file, e.g. "BAD-1.md" */
  file: string;
  /** the YAML parser's own raw error message */
  error: string;
}

export interface TaskListResult {
  tasks: Task[];
  malformed: MalformedTask[];
}

export interface ProviderClient {
  taskList(filter?: Record<string, unknown>): Promise<TaskListResult>;
  taskGet(id: string): Promise<Task>;
  taskWrite(patch: Record<string, unknown>): Promise<Task>;
  taskDelete(id: string): Promise<TaskDeleteResult>;
  taskCheck(id: string): Promise<unknown>;          // gate result — keep unknown
  adrList(filter?: Record<string, unknown>): Promise<AdrRecord[]>;
  adrGet(id: string): Promise<AdrRecord>;
  adrWrite(patch: Record<string, unknown>): Promise<AdrRecord>;
  goalList(filter?: Record<string, unknown>): Promise<GoalRecord[]>;
  goalGet(id: string): Promise<GoalRecord>;
  goalWrite(patch: Record<string, unknown>): Promise<GoalRecord>;
  goalGate(id: string): Promise<unknown>;
  metaList(filter?: Record<string, unknown>): Promise<MetaRecord[]>;
  metaGet(id: string): Promise<MetaRecord>;
  metaWrite(patch: Record<string, unknown>): Promise<MetaRecord>;
  manifest(): Promise<Manifest>;
  close(): Promise<void>;
}

export async function connectProvider({ command, args, env, cwd }: ConnectProviderOptions): Promise<ProviderClient> {
  // gap-mcp-server-test-deadlocks-at-high-test-concurrency: spawn the Provider
  // with stderr PIPED (not inherited) and forward it to our own stderr. The
  // SDK's StdioClientTransport defaults stderr to "inherit", so a Provider
  // subprocess carries the PARENT's stderr fd. When `quay mcp` is killed by its
  // client BEFORE finishing provider cleanup (the SDK's close() SIGTERMs at 2s,
  // SIGKILLs at 4s — under load the sequential provider cleanup can exceed the
  // 2s grace), the Provider is orphaned while still holding that inherited
  // stderr pipe open. In `node --test` that pipe is the test FILE's stderr, so
  // the runner waits on its EOF forever — the batch-tail deadlock (wchan=ep_poll,
  // ~0% CPU, "socket handles not released"). Piping + forwarding preserves the
  // diagnostics while breaking the fd-inheritance chain: an orphaned Provider
  // then holds only a pipe to its (dead) parent, never the runner's stderr.
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env: { ...process.env, ...(env ?? {}) },
    stderr: "pipe",
  });
  transport.stderr?.pipe(process.stderr);
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
  async function taskList(filter: Record<string, unknown> = {}): Promise<TaskListResult> {
    const r = await client.callTool({ name: "task_list", arguments: filter });
    // AC5 (gap-one-unparseable-task-takes-down-the-whole-board): a genuine
    // call failure (isError:true) STILL throws — the earlier "silent coercion
    // to empty array" behavior hid the real failure AND every legitimate task,
    // and this throw is what keeps that from coming back. What changes is that
    // a per-task frontmatter parse failure is now PARTIAL SUCCESS (isError:false
    // with a `malformed` array), so it never reaches this throw in the first
    // place.
    if (r.isError) throw new Error((r.content as Array<{text?: string}>)?.[0]?.text ?? "task_list failed");
    const sc = (r.structuredContent ?? {}) as { tasks?: Task[]; malformed?: MalformedTask[] };
    return { tasks: sc.tasks ?? [], malformed: sc.malformed ?? [] };
  }

  async function taskGet(id: string): Promise<Task> {
    const r = await client.callTool({ name: "task_get", arguments: { id } });
    if (r.isError) return null as unknown as Task;
    return (r.structuredContent as {task?: Task})?.task ?? null as unknown as Task;
  }

  // QN-024 (iteration 10): generic task_write passthrough — no
  // provider-specific branch. Whether a given Provider actually implements
  // task_write (data.write capability) is between the caller and the
  // Provider's own manifest; Core just forwards whatever patch fields are
  // given, same as taskList/taskGet forward whatever filter/id is given.
  async function taskWrite(patch: Record<string, unknown>): Promise<Task> {
    const r = await client.callTool({ name: "task_write", arguments: patch });
    if (r.isError) throw new Error((r.content as Array<{text?: string}>)?.[0]?.text ?? "task_write failed");
    return (r.structuredContent as {task?: Task})?.task ?? null as unknown as Task;
  }

  // gap-abi-missing-commit-delete-dependson-primitives: task_delete passthrough, mirroring taskWrite.
  // A not-found id surfaces as isError from the provider → throw (fail-closed, never a silent no-op).
  async function taskDelete(id: string): Promise<TaskDeleteResult> {
    const r = await client.callTool({ name: "task_delete", arguments: { id } });
    if (r.isError) throw new Error((r.content as Array<{text?: string}>)?.[0]?.text ?? "task_delete failed");
    return (r.structuredContent ?? { id, ok: false, reason: "no result" }) as TaskDeleteResult;
  }

  // QN-027 (iteration 13): generic task_check passthrough, mirroring
  // taskWrite's pattern exactly — provider-agnostic, no backend branch.
  // Whether the active Provider actually implements task_check (gate
  // capability) is between the caller and the Provider's own manifest;
  // Core just forwards the id and returns whatever the Provider's gate
  // reports, same as taskList/taskGet/taskWrite already do.
  async function taskCheck(id: string): Promise<unknown> {
    const r = await client.callTool({ name: "task_check", arguments: { id } });
    if (r.isError) throw new Error((r.content as Array<{text?: string}>)?.[0]?.text ?? "task_check failed");
    return r.structuredContent ?? null;
  }

  // ── ADR ABI (separate object kind — a provider MAY support ADRs; the native
  // provider does, the github provider declares them unsupported). adrList
  // degrades to [] on isError so an ADR-less provider renders cleanly; adrGet
  // returns null on isError (mirrors taskGet); adrWrite throws (mirrors taskWrite).
  async function adrList(filter: Record<string, unknown> = {}): Promise<AdrRecord[]> {
    const r = await client.callTool({ name: "adr_list", arguments: filter });
    if (r.isError) return [];
    return (r.structuredContent as {adrs?: AdrRecord[]})?.adrs ?? [];
  }

  async function adrGet(id: string): Promise<AdrRecord> {
    const r = await client.callTool({ name: "adr_get", arguments: { id } });
    if (r.isError) return null as unknown as AdrRecord;
    return (r.structuredContent as {adr?: AdrRecord})?.adr ?? null as unknown as AdrRecord;
  }

  async function adrWrite(patch: Record<string, unknown>): Promise<AdrRecord> {
    const r = await client.callTool({ name: "adr_write", arguments: patch });
    if (r.isError) throw new Error((r.content as Array<{text?: string}>)?.[0]?.text ?? "adr_write failed");
    return (r.structuredContent as {adr?: AdrRecord})?.adr ?? null as unknown as AdrRecord;
  }

  // ── Goal ABI (separate object kind — provider-backed storage, SPEC §5.2). Same
  // graceful-degradation contract as ADR: goalList degrades to [] on isError so a
  // goal-less provider (github stub, backlog) renders cleanly; goalGet returns null
  // on isError (mirrors adrGet); goalWrite throws (mirrors adrWrite); goalGate
  // returns the provider's gate verdict, throwing on isError (mirrors taskCheck).
  async function goalList(filter: Record<string, unknown> = {}): Promise<GoalRecord[]> {
    const r = await client.callTool({ name: "goal_list", arguments: filter });
    if (r.isError) return [];
    return (r.structuredContent as {goals?: GoalRecord[]})?.goals ?? [];
  }

  async function goalGet(id: string): Promise<GoalRecord> {
    const r = await client.callTool({ name: "goal_get", arguments: { id } });
    if (r.isError) return null as unknown as GoalRecord;
    return (r.structuredContent as {goal?: GoalRecord})?.goal ?? null as unknown as GoalRecord;
  }

  async function goalWrite(patch: Record<string, unknown>): Promise<GoalRecord> {
    const r = await client.callTool({ name: "goal_write", arguments: patch });
    if (r.isError) throw new Error((r.content as Array<{text?: string}>)?.[0]?.text ?? "goal_write failed");
    return (r.structuredContent as {goal?: GoalRecord})?.goal ?? null as unknown as GoalRecord;
  }

  async function goalGate(id: string): Promise<unknown> {
    const r = await client.callTool({ name: "goal_gate", arguments: { id } });
    if (r.isError) throw new Error((r.content as Array<{text?: string}>)?.[0]?.text ?? "goal_gate failed");
    return r.structuredContent ?? null;
  }

  // ── Meta ABI (separate object kind — message→meta-driver, answered on the same record). Same
  // graceful-degradation contract as ADR/goal: metaList degrades to [] on isError so a meta-less
  // provider renders cleanly; metaGet returns null on isError (mirrors goalGet); metaWrite throws
  // (mirrors goalWrite).
  async function metaList(filter: Record<string, unknown> = {}): Promise<MetaRecord[]> {
    const r = await client.callTool({ name: "meta_list", arguments: filter });
    if (r.isError) return [];
    return (r.structuredContent as {metas?: MetaRecord[]})?.metas ?? [];
  }

  async function metaGet(id: string): Promise<MetaRecord> {
    const r = await client.callTool({ name: "meta_get", arguments: { id } });
    if (r.isError) return null as unknown as MetaRecord;
    return (r.structuredContent as {meta?: MetaRecord})?.meta ?? null as unknown as MetaRecord;
  }

  async function metaWrite(patch: Record<string, unknown>): Promise<MetaRecord> {
    const r = await client.callTool({ name: "meta_write", arguments: patch });
    if (r.isError) throw new Error((r.content as Array<{text?: string}>)?.[0]?.text ?? "meta_write failed");
    return (r.structuredContent as {meta?: MetaRecord})?.meta ?? null as unknown as MetaRecord;
  }

  async function manifest(): Promise<Manifest> {
    const r = await client.readResource({ uri: "provider://manifest" });
    return JSON.parse((r.contents[0] as {text: string}).text) as Manifest;
  }

  async function close(): Promise<void> {
    await client.close();
  }

  return { taskList, taskGet, taskWrite, taskDelete, taskCheck, adrList, adrGet, adrWrite, goalList, goalGet, goalWrite, goalGate, metaList, metaGet, metaWrite, manifest, close };
}
