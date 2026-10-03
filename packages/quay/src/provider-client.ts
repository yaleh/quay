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
  // gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp: OPTIONAL paging
  // metadata. A Provider that can answer a filtered+paginated `task_list` returns
  // `paged: true` plus the window's `total`/`page`/`pageSize`/`totalPages`, which lets
  // Core report the filtered count WITHOUT ever holding the whole store (and, before
  // this, without a 14 MB body round-trip that queue-blocked Core's MCP server).
  // A Provider that cannot (any provider that never implemented `page`/`pageSize` —
  // the ABI does not require them) leaves `paged` undefined/false; Core then falls
  // back to fetching the unpaged list and doing the filtering+paging itself, which is
  // the pre-existing behaviour. `undefined` here therefore means "the Provider did not
  // say", NEVER "the Provider paged with zero results" — the two must stay
  // distinguishable (硬规则 3b).
  paged?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  // Whether the Provider's own walk actually examined every task file — it reports
  // false when it could answer from the directory listing alone. Optional for the
  // same "the Provider may not say" reason as above.
  scannedFiles?: boolean;
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
    const sc = (r.structuredContent ?? {}) as Partial<TaskListResult>;
    // gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp: forward the
    // Provider's paging metadata verbatim when it sent any (see TaskListResult). Each
    // field is passed through ONLY if present, so a Provider that never declares paging
    // leaves them `undefined` — "did not say" stays distinguishable from a paged answer.
    return {
      tasks: sc.tasks ?? [],
      malformed: sc.malformed ?? [],
      ...(sc.paged !== undefined ? { paged: sc.paged } : {}),
      ...(typeof sc.total === "number" ? { total: sc.total } : {}),
      ...(typeof sc.page === "number" ? { page: sc.page } : {}),
      ...(typeof sc.pageSize === "number" ? { pageSize: sc.pageSize } : {}),
      ...(typeof sc.totalPages === "number" ? { totalPages: sc.totalPages } : {}),
      ...(sc.scannedFiles !== undefined ? { scannedFiles: sc.scannedFiles } : {}),
    };
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

  // ── ADR / Goal / Meta list verbs — "failure is loud, empty/unsupported are not" ──
  // gap-provider-client-list-masks-call-failure-as-empty: these three used to
  // coerce a failed call to a silent empty array, collapsing a GENUINE call failure into
  // "there are no records" — the exact 硬规则 3b shape (a judge whose "could not
  // read the input" answer is byte-identical to its "clean, empty" answer).
  // taskList() was already fixed to THROW on isError
  // (gap-one-unparseable-task-takes-down-the-whole-board AC5); this applies the
  // SAME ruling to the three siblings, so the four kinds share one semantics:
  //
  //   failure     — the provider's tool ANSWERED with isError ⇒ throw. Never [].
  //   empty       — the tool answered with zero records       ⇒ [].  (≠ failure)
  //   unsupported — the provider does not do this kind        ⇒ [].  (≠ failure)
  //
  // "unsupported" must NOT be conflated with "failure" (AC6/DoD3). A provider
  // says "I don't do this kind" in one of two ways, BOTH of which resolve to []
  // rather than throwing:
  //   ① it registers the tool and returns a clean NON-error empty — github's
  //      adr_list/goal_list stubs (`{adrs:[]}` / `{goals:[]}`, isError falsy); or
  //   ② it never registers the tool at all — github has no `meta_list`. The MCP
  //      SDK's server-side tools/call handler flattens BOTH a missing tool and a
  //      thrown handler into the SAME `{isError:true, content:[{text}]}` shape
  //      (see @modelcontextprotocol/sdk server/mcp.js's CallToolRequestSchema),
  //      so the only discriminator left at this layer is the SDK's own
  //      `Tool <name> not found` text (JSON-RPC -32602 InvalidParams). We match
  //      that EXACT signature for the EXACT tool name; a genuine handler failure
  //      carries the handler's own message instead, so it still throws. If the
  //      signature ever drifts, the failure direction is fail-LOUD (throw, not a
  //      silent []) — the safe direction under 硬规则 3b.
  function isUnsupportedToolCall(r: { content?: unknown }, toolName: string): boolean {
    const text = (r.content as Array<{ text?: string }> | undefined)?.[0]?.text;
    return text === `MCP error -32602: Tool ${toolName} not found`;
  }
  /** Shared unwrap for the three OPTIONAL-kind list verbs: throw on a genuine
   *  call failure; resolve to [] for both "empty" and "unsupported". */
  // The `[x: string]: unknown` index signature is REQUIRED, not cosmetic: the
  // SDK's `client.callTool` return type is a UNION whose compatibility member
  // (`{ toolResult }`) shares NONE of isError/content/structuredContent. A
  // property-only all-optional parameter type is a "weak type", and TS rejects
  // assigning that union to it (TS2345 "no properties in common"). The index
  // signature mirrors the SDK's own shape and lets the union assign cleanly.
  function unwrapKindList<T>(r: { [x: string]: unknown; isError?: boolean; content?: unknown; structuredContent?: unknown }, toolName: string, key: string): T[] {
    if (r.isError) {
      if (isUnsupportedToolCall(r, toolName)) return [];
      throw new Error((r.content as Array<{ text?: string }>)?.[0]?.text ?? `${toolName} failed`);
    }
    return ((r.structuredContent as Record<string, T[]> | undefined)?.[key]) ?? [];
  }

  // ── ADR ABI (separate object kind — a provider MAY support ADRs; the native
  // provider does, the github provider declares them unsupported). adrList now
  // THROWS on a genuine call failure (see unwrapKindList above, same ruling as
  // taskList) and resolves to [] only for "empty" or "unsupported"; adrGet
  // returns null on isError (mirrors taskGet); adrWrite throws (mirrors taskWrite).
  async function adrList(filter: Record<string, unknown> = {}): Promise<AdrRecord[]> {
    const r = await client.callTool({ name: "adr_list", arguments: filter });
    return unwrapKindList<AdrRecord>(r, "adr_list", "adrs");
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
  // contract as ADR: goalList THROWS on a genuine call failure (unwrapKindList,
  // the same ruling as taskList) and resolves to [] only for "empty" or
  // "unsupported" (github's goal_list stub returns a clean non-error empty);
  // goalGet returns null on isError (mirrors adrGet); goalWrite throws (mirrors
  // adrWrite); goalGate returns the provider's gate verdict, throwing on isError
  // (mirrors taskCheck).
  async function goalList(filter: Record<string, unknown> = {}): Promise<GoalRecord[]> {
    const r = await client.callTool({ name: "goal_list", arguments: filter });
    return unwrapKindList<GoalRecord>(r, "goal_list", "goals");
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
  // contract as ADR/goal: metaList THROWS on a genuine call failure (unwrapKindList, the same
  // ruling as taskList) and resolves to [] only for "empty" or "unsupported" — github registers
  // no meta_list at all, which arrives as the SDK's `Tool meta_list not found` isError and is
  // classified as unsupported (≠ failure) by unwrapKindList; metaGet returns null on isError
  // (mirrors goalGet); metaWrite throws (mirrors goalWrite).
  async function metaList(filter: Record<string, unknown> = {}): Promise<MetaRecord[]> {
    const r = await client.callTool({ name: "meta_list", arguments: filter });
    return unwrapKindList<MetaRecord>(r, "meta_list", "metas");
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
