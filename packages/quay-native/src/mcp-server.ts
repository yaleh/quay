// quay-native mcp — the native Provider's formal ABI transport (proposal §5.1).
// Data-only (glossary.md "The ABI (over MCP)"): provider://manifest, task_list,
// task_get for v0 (required, `data.read`); task_write/task_check added since
// time permitted (design §6 symmetry — same store.js core as the CLI).

import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createStore } from "./store.ts";
// ADR store is a generic filesystem-frontmatter store, now owned by `quay`
// (Core) — see bin/quay-native.js for the full rationale (ADR-013 / DIR-035-A).
import { createAdrStore } from "quay/adr-store";
import { readManifest } from "./manifest.ts";
// Goal store is PROVIDER-OWNED (SPEC-goal-mechanism-2026-09-06.md §5.2): the goal
// schema lives here in quay-native, NOT in Core (Core keeps only the view-model +
// a delegation shim). The generic frontmatter plumbing it reuses is Core's
// frontmatter-store-base, reached by relative path (see that file's header).
import { createGoalStore, readGoalConfig } from "./goal-store.ts";
// Meta store is PROVIDER-OWNED like the goal store (gap-meta-records-should-be-a-first-class-store-
// kind-not-a-task-label): the META record schema lives in Core, re-exported here, and the provider
// exposes meta_list/meta_get/meta_write over the ABI.
import { createMetaStore } from "./meta-store.ts";
// `goal_gate` runs a goal record's `criterion` through Core's acceptance runner —
// the SAME single runner every Core gate uses (no duplicated timeout/kill logic).
import { runAcceptance, resolveAcceptanceTimeout, timeoutKnobHint, verdictFromAcceptance } from "../../quay/src/gate/acceptance-runner.ts";
// …and records the verdict in the SAME ledger `quay goal gate` appends to, so the two entry points
// for one criterion leave the same durable evidence (gap-goal-gate-verdict-single-mapping-not-evaluated).
import { appendGateEvent } from "../../quay/src/gate/gate-event-store.ts";
// The "which tree was this evaluated on" payload fragment (SPEC-goal-branch-2026-10-03 §7 辛), shared
// with the `goal gate` CLI / sweep writers so all three entry points record the same shape (硬规则 5b).
import { evaluationContext } from "../../quay/src/goal-store.ts";
import { randomUUID } from "node:crypto";

// ── task_list's text/content budget ────────────────────────────────────────────────────────────
// gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp: an MCP tool result that
// carries `structuredContent` AND a `content[0].text` of the SAME JSON ships those bytes TWICE —
// the SDK serializes the whole result object over stdio. The transport's framing is super-linear
// in payload (ReadBuffer.append does a Buffer.concat per incoming chunk, then the receiver
// JSON.parses AND zod-validates the whole message), measured here as ~60 ms for a 0.8 MB result,
// ~1 s for 3.3 MB, ~3 s for 8.4 MB. So the duplicate is not a constant factor, it is the half of
// the payload that turns a usable response into a queue-blocking one.
//
// Below the budget the text form is kept VERBATIM (every existing small response — and every test
// that reads it — is byte-identical); above it, the text becomes a one-line summary and the data
// lives once, in structuredContent. The budget is deliberately far below the point where the
// framing cost turns super-linear.
const TEXT_PAYLOAD_BUDGET_BYTES = 256 * 1024;

/** Build a task_list result's `content` block under the budget above. `json` MUST be the exact
 *  serialization of `summarySource` — it is measured to decide, and returned verbatim when small. */
function budgetedTaskListContent(
  payload: Record<string, unknown>,
  summarySource: { count: number; total: number; page: number; totalPages: number; scannedFiles: boolean },
): Array<{ type: "text"; text: string }> {
  const json = JSON.stringify(payload, null, 2);
  if (json.length <= TEXT_PAYLOAD_BUDGET_BYTES) return [{ type: "text" as const, text: json }];
  return [
    {
      type: "text" as const,
      text:
        `task_list: ${summarySource.count} task(s) — page ${summarySource.page}/${Math.max(1, summarySource.totalPages)} ` +
        `of ${summarySource.total} matching task(s)` +
        `${summarySource.scannedFiles ? "" : " (resolved from the directory listing; no task file was read)"}. ` +
        `This page (${json.length} bytes) is in this result's structuredContent. ` +
        `The text form is omitted above ${TEXT_PAYLOAD_BUDGET_BYTES} bytes because a second copy of the ` +
        `same bytes doubles the stdio payload, whose framing cost grows super-linearly.`,
    },
  ];
}

export async function startMcpServer({ tasksDir, adrDir, goalDir, metaDir, defaultStatus }: { tasksDir: string; adrDir?: string; goalDir?: string; metaDir?: string; defaultStatus?: string }): Promise<void> {
  // DIR-047: pass the per-provider default_task_status through to the store
  // (already validated by the caller — see bin/quay-native.js loadDefaultStatus()).
  // ADR-004 single-source: the store is the one place the creation default is
  // resolved; the MCP server merely forwards the configured value.
  const store = createStore(tasksDir, { defaultStatus });
  // ADRs are a SEPARATE kind (adr-store.js), stored in a sibling directory of
  // tasks/ — default to `<parent-of-tasksDir>/adr` when adrDir is not supplied.
  const resolvedAdrDir = adrDir ?? path.join(path.dirname(tasksDir), "adr");
  const adrStore = createAdrStore(resolvedAdrDir);
  // Goals are a SEPARATE kind (goal-store.ts), stored in a sibling directory of
  // tasks/ — default to `<parent-of-tasksDir>/goals` when goalDir is not supplied
  // (the same repo-root-sibling resolution shape as adr/). cap/stale (I1′/I3 policy
  // values) are read from `.quay/config.yml`'s `goals:` section at the workspace root
  // (goalDir's parent), honoring the configurable-value discipline of SPEC §4.2.
  const resolvedGoalDir = goalDir ?? path.join(path.dirname(tasksDir), "goals");
  const goalCfg = readGoalConfig(path.dirname(resolvedGoalDir));
  const goalStore = createGoalStore(resolvedGoalDir, { cap: goalCfg.cap, staleMs: goalCfg.staleMs });
  // Meta records are a SEPARATE kind (meta-store.ts), stored in a sibling directory of tasks/ —
  // default to `<parent-of-tasksDir>/meta` when metaDir is not supplied (same repo-root-sibling
  // resolution shape as adr/ and goals/).
  const resolvedMetaDir = metaDir ?? path.join(path.dirname(tasksDir), "meta");
  const metaStore = createMetaStore(resolvedMetaDir);

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
  // gap-task-list-route-is-linear-in-task-count: the list route (web board,
  // CLI `--summary`-style consumers) only needs frontmatter fields
  // (id/title/status/labels/role/children/updatedAt) — NOT the full body
  // markdown. This tool accepts an OPTIONAL `includeBody` (default true =
  // full tasks, byte-for-byte backward compatible with every existing
  // caller). Passing `includeBody: false` strips `body` from each returned
  // task, shrinking the MCP round-trip payload from ~5.7MB (all task bodies)
  // to ~0.3MB (frontmatter only) — the dominant cost in the
  // "MCP round-trip + rendering" half of the task-list route. The param is
  // additive and opt-in: providers/callers that never pass it are unaffected.
  //
  // gap-serve-search-timeout-all-body-fetch: an OPTIONAL `search` param does
  // server-side title+body filtering (heading lines stripped, case-insensitive)
  // BEFORE the response is built, so the MCP round-trip carries only the
  // matching tasks instead of every task's body. The web UI's `/tasks?q=`
  // search uses this to avoid the 1572-body payload that timed out the MCP
  // round-trip (-32001). Search is applied in the store walk (status → label →
  // search), independent of `includeBody` (which only shapes the response).
  // gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp: OPTIONAL
  // `prefix`/`page`/`pageSize` complete the server-side filter+page surface, so a
  // caller that wants one screen of tasks no longer has to receive every body in
  // the store to get it. Measured on the live store (2135 tasks): the whole-store
  // payload is 14.4 MB and the ABI round-trip of it is ~34-52 s, which on Core's
  // single-threaded MCP server queue-blocks every concurrent read (-32001). With
  // `pageSize` the response carries at most `pageSize` bodies whatever the store
  // size, and the filter/index phase reads no bodies at all (store.queryPage).
  //
  // BACKWARD COMPATIBLE BY CONSTRUCTION: `prefix`/`page`/`pageSize` are optional
  // and their absence reproduces the previous whole-filtered-set answer exactly
  // (pageSize undefined ⇒ no paging), so every existing caller — the web board's
  // `includeBody:false`, `serve-task`'s `search`, the ABI conformance suite — is
  // untouched. The response's `total`/`page`/`pageSize`/`totalPages`/`paged`/
  // `scannedFiles` fields are additive: a caller that ignores them sees the same
  // `tasks` + `malformed` it always did.
  server.registerTool(
    "task_list",
    {
      description: "List tasks in the native Provider's task store, optionally filtered by status/label/prefix/search and paginated by page/pageSize.",
      inputSchema: {
        status: z.string().optional(),
        label: z.union([z.string(), z.array(z.string())]).optional(),
        includeBody: z.boolean().optional(),
        search: z.string().optional(),
        prefix: z.string().optional(),
        page: z.number().int().optional(),
        pageSize: z.number().int().optional(),
      },
    },
    async ({ status, label, includeBody, search, prefix, page, pageSize }) => {
      // gap-one-unparseable-task-takes-down-the-whole-board: partial success.
      // One task file whose frontmatter fails to parse must not take down the
      // whole task_list call (that was the "all-or-nothing" defect) — return
      // the parseable tasks PLUS a machine-readable malformed list ({file,
      // error}) so the Core can surface the bad file visibly instead of 500ing
      // the board. isError stays reserved for genuine call-level failures
      // (store itself unreachable, etc.), which still throw.
      const { tasks, malformed, total, page: resolvedPage, pageSize: resolvedSize, totalPages, scannedFiles } =
        store.queryPage(
          { status, label, search, prefix },
          { page, pageSize, includeBody: includeBody !== false },
        );
      const outTasks = includeBody === false
        ? tasks.map((t) => { const { body: _omit, ...rest } = t; return rest; })
        : tasks;
      // `paged` is the caller's own signal that this response is a WINDOW of the
      // filtered set (and therefore that every filter it sent was applied by the
      // store, not silently dropped) — Core's MCP `task_list` reads it to decide
      // whether it may use `total` as the filtered count instead of re-fetching
      // everything and re-filtering client-side. It is false when `pageSize` was
      // absent, which is exactly the pre-existing whole-set contract.
      const result = {
        tasks: outTasks,
        malformed,
        total,
        page: resolvedPage,
        pageSize: resolvedSize,
        totalPages,
        paged: pageSize !== undefined && pageSize !== null,
        scannedFiles,
      };
      return {
        content: budgetedTaskListContent(result, {
          count: outTasks.length,
          total,
          page: resolvedPage,
          totalPages,
          scannedFiles,
        }),
        structuredContent: result,
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
        // gap-unified-frontmatter-parser: `depends_on` is a first-class relation edge (prerequisite
        // task ids), explicitly listed here so users can discover it WITHOUT the `extra` escape hatch.
        // It is stored top-level (mirroring `children`), and read back by readDependsOn()/parseTask()/
        // store.parse() through the single frontmatter parser. Legacy `extra: { depends_on: [...] }`
        // remains readable for backward compatibility.
        //   canonical (new writes):   depends_on: ["dep1", "dep2"]
        //   legacy (still readable):  extra: { depends_on: [dep1, dep2], schema: "v1" }
        depends_on: z.array(z.string()).optional(),
        // gap-goal-ac-task-linkage-top-level-field: `goal_ac` is the owning goal AC id (task→AC
        // linkage, G7). Like `depends_on`, it is stored TOP-LEVEL (a single scalar, not an array —
        // a task declares at most one owning AC), and read back by readGoalAc()/parseTask() through
        // the single frontmatter parser. It is optional (gap-* defect tasks carry none).
        goal_ac: z.string().optional(),
        body: z.string().optional(),
        // QN-007: `extra` (design §7.1's "escape hatch for backend-specific
        // fields") was missing from this schema entirely — the MCP SDK's
        // zod-based input validation silently stripped it before it ever
        // reached store.write(), even though store.write() itself has always
        // handled `extra` correctly (the CLI's `edit --extra` path proves
        // this). z.record(z.string(), z.any()) accepts an arbitrary JSON object, matching
        // the CLI's own `JSON.parse(flags.extra)` looseness (no schema
        // validation beyond "is it an object" — G5, do not gold-plate).
        extra: z.record(z.string(), z.any()).optional(),
        // QN-015: CAS option, symmetric with the CLI's --expect-status flag
        // (design §6). Omitted entirely => store.write()'s existing,
        // unaffected behavior (no CAS check performed).
        expectedStatus: z.string().optional(),
      },
    },
    async ({ id, ...patch }) => {
      try {
        const task = store.write(id, patch);
        return {
          content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
          structuredContent: { task },
        };
      } catch (err) {
        if (err && err.name === "ConflictError") {
          return {
            content: [{ type: "text", text: `CAS conflict: ${err.message}` }],
            structuredContent: {
              error: "ConflictError",
              message: err.message,
              id: err.id,
              expectedStatus: err.expectedStatus,
              actualStatus: err.actualStatus,
            },
            isError: true,
          };
        }
        throw err;
      }
    }
  );

  // task_delete — data.write (gap-abi-missing-commit-delete-dependson-primitives): the ABI verb the
  // native Provider was missing. Unlinks the task file + branch-aware commit (same primitive as
  // task_write). Fail-closed: a not-found id returns isError:true, never a silent no-op.
  server.registerTool(
    "task_delete",
    {
      description: "Delete one task by id from the native Provider's task store (unlink + branch-aware commit). Fails closed (isError) on a non-existent id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const result = store.delete(id);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: result.reason === "missing" ? `no such task: ${id}` : result.reason }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
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

  // ── ADR tools (separate object kind — decision lifecycle, not task lifecycle) ──
  // adr_list — data.read
  server.registerTool(
    "adr_list",
    {
      description: "List ADRs (Architecture Decision Records) in the native store, optionally filtered by status/tag.",
      inputSchema: { status: z.string().optional(), tag: z.string().optional() },
    },
    async ({ status, tag }) => {
      const adrs = adrStore.list({ status, tag });
      return {
        content: [{ type: "text", text: JSON.stringify(adrs, null, 2) }],
        structuredContent: { adrs },
      };
    }
  );

  // adr_get — data.read
  server.registerTool(
    "adr_get",
    {
      description: "Get one ADR by id (ADR-NNN) from the native store.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      let adr = null;
      try {
        adr = adrStore.get(id);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
      if (!adr) return { isError: true, content: [{ type: "text", text: `no such ADR: ${id}` }] };
      return {
        content: [{ type: "text", text: JSON.stringify(adr, null, 2) }],
        structuredContent: { adr },
      };
    }
  );

  // adr_write — data.write. Status is the DECISION lifecycle (never "done").
  server.registerTool(
    "adr_write",
    {
      description: "Write/patch one ADR (frontmatter + body) in the native store. status ∈ proposed|accepted|superseded|deprecated|rejected.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        date: z.string().optional(),
        supersedes: z.array(z.string()).optional(),
        superseded_by: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        body: z.string().optional(),
      },
    },
    async ({ id, superseded_by, ...rest }) => {
      try {
        const adr = adrStore.write(id, { ...rest, supersededBy: superseded_by });
        return {
          content: [{ type: "text", text: JSON.stringify(adr, null, 2) }],
          structuredContent: { adr },
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
    }
  );

  // ── Goal tools (separate object kind — provider-backed storage, SPEC §5.2) ──
  // goal_list — data.read
  server.registerTool(
    "goal_list",
    {
      description: "List goal records (GOAL-NNN + AC-NNN) in the native store, optionally filtered by status/kind/goal.",
      inputSchema: { status: z.string().optional(), kind: z.string().optional(), goal: z.string().optional() },
    },
    async ({ status, kind, goal }) => {
      const goals = goalStore.list({ status, kind, goal });
      return {
        content: [{ type: "text", text: JSON.stringify(goals, null, 2) }],
        structuredContent: { goals },
      };
    }
  );

  // goal_get — data.read
  server.registerTool(
    "goal_get",
    {
      description: "Get one goal record by id (GOAL-NNN or AC-NNN) from the native store.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      let goal = null;
      try {
        goal = goalStore.get(id);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
      if (!goal) return { isError: true, content: [{ type: "text", text: `no such goal: ${id}` }] };
      return {
        content: [{ type: "text", text: JSON.stringify(goal, null, 2) }],
        structuredContent: { goal },
      };
    }
  );

  // goal_write — data.write. I1′ (hard cap) is enforced by the provider's write
  // path (SPEC §5.2: the invariant lives in the provider so a future provider
  // cannot bypass it). `origin` is required; AC records must declare `goal:`.
  server.registerTool(
    "goal_write",
    {
      description: "Write/patch one goal record (GOAL-NNN or AC-NNN) in the native store. status ∈ draft|active|achieved|superseded|retired. Completeness is kind-split: a GOAL record requires a non-empty `body` (≥40 non-whitespace chars — background / scope & non-goals / exit conditions; `origin` is only a provenance citation, never the body) plus `origin`; an AC record requires `criterion` + `expect` + `goal: GOAL-NNN` (its content lives in those fields, `body` optional) plus `origin`. Empty `origin` writes nothing. Activating past the active-GOAL cap (default 3) is rejected unless the same call disposes an active goal.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        goal: z.string().optional(),
        criterion: z.string().optional(),
        expect: z.string().optional(),
        origin: z.string().optional(),
        evidence: z.object({ at: z.string().optional(), verdict: z.string().optional(), reading: z.string().optional() }).optional(),
        supersedes: z.array(z.string()).optional(),
        superseded_by: z.array(z.string()).optional(),
        body: z.string().optional(),
        disposeOld: z.object({ id: z.string(), to: z.enum(["achieved", "superseded"]) }).optional(),
      },
    },
    async ({ id, superseded_by, disposeOld, ...rest }) => {
      try {
        const goal = goalStore.write(id, { ...rest, supersededBy: superseded_by, disposeOld: disposeOld as { id: string; to: "achieved" | "superseded" } | undefined });
        return {
          content: [{ type: "text", text: JSON.stringify(goal, null, 2) }],
          structuredContent: { goal },
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
    }
  );

  // goal_gate — run the record's `criterion` via Core's acceptance runner and
  // return the verdict. Empty criterion fails closed (never a silent PASS).
  server.registerTool(
    "goal_gate",
    {
      description: "Run one goal record's `criterion` via the acceptance runner and return the verdict (empty criterion fails closed).",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      let goal = null;
      try {
        goal = goalStore.get(id);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
      if (!goal) return { isError: true, content: [{ type: "text", text: `no such goal: ${id}` }] };
      const criterion = (goal as unknown as Record<string, unknown>).criterion;
      // The criterion cwd (the workspace root) — the SAME path names the gate event's evaluation
      // root, so a reader can tell WHICH tree this verdict was obtained on (SPEC §7 辛).
      const evalRoot = path.dirname(resolvedGoalDir);
      let verdict: string;
      let reason: string;
      let cause: string | null = null;
      if (typeof criterion !== "string" || criterion.trim() === "") {
        verdict = "fail";
        reason = `${id} has no criterion defined (fail-closed — an unenforceable AC must never silently pass)`;
      } else {
        // ⛔ The ONE mapping, shared with `quay goal gate` and the sweep
        // (gap-goal-gate-verdict-single-mapping-not-evaluated). Before it, this entry recorded a
        // criterion that TIMED OUT, failed to spawn, or could not be run at all (exit 126/127) as
        // `fail` — i.e. asserted "this criterion is false" about one that never stated anything
        // (hard rule 3b).
        // The deadline comes from the RECORD's `timeoutMs` (or QUAY_ACCEPTANCE_TIMEOUT_MS), ⛔ not a
        // hard-wired 60000: a `timeoutMs` on the record was previously unreadable on this path, and
        // the timeout reason named a gates.yml key the goal path never consults.
        const t = resolveAcceptanceTimeout((goal as unknown as { timeoutMs?: unknown }).timeoutMs);
        const result = runAcceptance({
          command: criterion,
          cwd: evalRoot,
          timeoutMs: t.timeoutMs,
          timeoutKnob: timeoutKnobHint(t),
        });
        const v = verdictFromAcceptance(result);
        verdict = v.verdict;
        reason = v.reason;
        cause = v.cause;
      }
      // The ledger is the DURABLE record of the verdict — the same carrier `quay goal gate` appends
      // to (same derivation `<workspaceRoot>/.quay/gate-events.jsonl`, same `gate:"goal"` shape, same
      // `payload.cause`). ⛔ Without this the MCP entry point's verdict existed only in a transient
      // tool response: a criterion that could not be evaluated left NO evidence, while the CLI
      // entry point for the same criterion did (hard rule 5b — the cluster, not the reported site).
      const timestamp = new Date().toISOString();
      appendGateEvent(path.join(evalRoot, ".quay", "gate-events.jsonl"), {
        id: randomUUID(),
        item_id: id,
        pipeline_id: id,
        gate: "goal",
        actor: "goal-mcp",
        verdict,
        timestamp,
        // `evaluationRoot`/`treeSha` name WHICH tree this verdict was obtained on (SPEC §7 辛) — the
        // same cwd the criterion ran in above, so the preview worktree stays distinguishable from the
        // main checkout (硬规则 5b: this is the CLUSTER, not just the `goal gate` CLI site).
        payload: { reason, ...(cause ? { cause } : {}), ...evaluationContext(evalRoot) },
      });
      const out = { id, verdict, cause, reason, timestamp };
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      };
    }
  );

  // ── Meta tools (separate object kind — message SENT TO the meta-driver, answered on the same
  // record; proposed→answered lifecycle, never "done") ──
  // meta_list — data.read
  server.registerTool(
    "meta_list",
    {
      description: "List META records (META-NNN) in the native store, optionally filtered by status. META records are a separate kind from tasks (message→meta-driver lifecycle: proposed→answered).",
      inputSchema: { status: z.string().optional() },
    },
    async ({ status }) => {
      const metas = metaStore.list({ status });
      return {
        content: [{ type: "text", text: JSON.stringify(metas, null, 2) }],
        structuredContent: { metas },
      };
    }
  );

  // meta_get — data.read
  server.registerTool(
    "meta_get",
    {
      description: "Get one META record by id (META-NNN) from the native store.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      let meta = null;
      try {
        meta = metaStore.get(id);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
      if (!meta) return { isError: true, content: [{ type: "text", text: `no such META: ${id}` }] };
      return {
        content: [{ type: "text", text: JSON.stringify(meta, null, 2) }],
        structuredContent: { meta },
      };
    }
  );

  // meta_write — data.write. status ∈ proposed|answered (never "done"); `handler` defaults to
  // "meta-driver" (the only kind semi-processed by a driver's semantics).
  server.registerTool(
    "meta_write",
    {
      description: "Write/patch one META record (META-NNN) in the native store. status ∈ proposed|answered; `handler` defaults to meta-driver; `reply` embeds the meta-driver's answer on the same record.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        handler: z.string().optional(),
        reply: z.string().optional(),
        body: z.string().optional(),
      },
    },
    async ({ id, ...rest }) => {
      try {
        const meta = metaStore.write(id, rest);
        return {
          content: [{ type: "text", text: JSON.stringify(meta, null, 2) }],
          structuredContent: { meta },
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }] };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now runs until stdin closes; log to stderr (stdout is the MCP channel).
  console.error(`quay-native mcp: serving tasks from ${tasksDir}, ADRs from ${resolvedAdrDir}, meta from ${resolvedMetaDir}`);

  // gap-suite-speedup (task gap-suite-speedup): when the client disconnects
  // (stdin EOF), close the transport so the process exits promptly. The SDK
  // StdioServerTransport only watches stdin for 'data'/'error', never
  // 'end'/'close' — so a disconnected server whose event loop still holds a
  // live handle would otherwise never drain, and an SDK client's
  // StdioClientTransport.close() would fall back to its 2s SIGTERM timeout.
  // Closing the transport on stdin EOF drains those handles so the process
  // exits on its own. No behavior change to serving: only shutdown becomes
  // prompt.
  process.stdin.on("close", () => {
    void transport.close();
  });
}
