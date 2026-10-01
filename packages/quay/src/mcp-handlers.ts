// mcp-handlers.ts — per-domain MCP tool handler registration functions,
// extracted from startMcpServer (ARCH-M93-002 decomposition).
//
// Each register* function receives only the bindings it needs. All 15
// server.tool() registrations remain; only their inlined bodies have moved
// here from mcp-server.ts, so startMcpServer becomes a thin registration
// wrapper with outDegree ≤ 2 (loadConfig + QUAY_VERSION are in mcp-server.ts;
// the gate/lifecycle/action/adr imports move here).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { loadConfig, activeProvider } from "./config.ts";
import { type ProviderClient } from "./provider-client.ts";
import { composePayload, deliverTrigger } from "./action.ts";
import { QUAY_VERSION } from "./version.ts";
import { runGate } from "./gate/engine.ts";
import { resolveGateLogPath, runGateLogQuery } from "./gate/gate-log.ts";
import { listGates } from "./gate/registry.ts";
import { runComplete, runAdjudicate, runPromote, runRetreat, runCompleteOutOfBand } from "./gate/lifecycle.ts";
import { validateConfig } from "./config-validate.ts";
import { TASK_STATUS } from "./abi.ts";

export interface ConnectedProvider {
  id: string;
  client: ProviderClient;
}

// stripHeadings: remove lines matching /^#+\s/ from body text before
// search indexing, so that structural markdown headings (## Proposal,
// ## Plan, ## AC, ## DoD) do not produce false positives when a search
// term matches a standard section name (e.g. "Proposal" matching every
// task that uses the Proposal/Plan/AC/DoD template).
//
// QX-028 added this helper to bin/quay.js and serve.ts. Inlined here
// rather than imported because mcp-server.ts is a separate entry point —
// importing from serve.ts or bin/quay.js would create cross-entry-point
// dependencies that don't exist anywhere else in this package. The
// implementation is identical in all three locations by design.
//
// QX-041 (experiment 4, iteration 11) added inFence tracking to serve.ts
// to preserve `# comment` lines inside fenced code blocks from being
// stripped. QX-044 (experiment 4, iteration 12) syncs that fix here
// (SH-005: the mcp-server.ts inline copy was not updated by QX-041).
export function stripHeadings(text: string): string {
  let inFence = false;
  return (text || "").split("\n").filter((line) => {
    if (/^```/.test(line)) { inFence = !inFence; return true; }
    if (inFence) return true; // preserve code content (including # comment lines)
    return !/^#+\s/.test(line); // strip structural headings outside fences
  }).join(" ");
}

// gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp: an MCP tool result that
// carries `structuredContent` AND a `content[0].text` holding the SAME JSON ships those bytes
// TWICE — the SDK serializes the whole result object over stdio, whose framing is super-linear
// in payload (ReadBuffer does a Buffer.concat per incoming chunk; the receiver then JSON.parses
// AND zod-validates the entire message). Measured on this host: a ~0.8 MB result round-trips in
// ~60 ms, ~3.3 MB in ~1 s, ~8.4 MB in ~3 s. The duplicate is therefore not a constant factor —
// it is the half of the payload that decides whether a list request queue-blocks the server.
//
// Below the budget the text form is kept VERBATIM (every existing small response, and every test
// that reads it, is byte-identical); above it the text becomes a one-line summary and the data
// lives exactly once, in structuredContent. The budget sits far below where the framing cost
// turns super-linear.
const TEXT_PAYLOAD_BUDGET_BYTES = 256 * 1024;

/** Build task_list's `content` block under the budget above. `payload` is measured, and returned
 *  verbatim when it fits — so the small-payload surface is unchanged. */
function budgetedTaskListContent(
  payload: Record<string, unknown>,
  summary: { count: number; total: number; page: number; totalPages: number },
): Array<{ type: "text"; text: string }> {
  const json = JSON.stringify(payload, null, 2);
  if (json.length <= TEXT_PAYLOAD_BUDGET_BYTES) return [{ type: "text" as const, text: json }];
  return [
    {
      type: "text" as const,
      text:
        `task_list: ${summary.count} task(s) — page ${summary.page}/${Math.max(1, summary.totalPages)} ` +
        `of ${summary.total} matching task(s). This page (${json.length} bytes) is in this result's ` +
        `structuredContent. The text form is omitted above ${TEXT_PAYLOAD_BUDGET_BYTES} bytes because a ` +
        `second copy of the same bytes doubles the stdio payload, whose framing cost grows super-linearly.`,
    },
  ];
}

export function registerTaskHandlers(
  server: McpServer,
  getClient: (id: string | undefined) => Promise<ConnectedProvider>
): void {
  // task_list — aggregates/proxies task_list against one Provider, selected
  // via the optional `provider` argument (defaults to the default-enabled
  // Provider). Same shape as each Provider's own task_list tool, plus the
  // one added `provider` field.
  //
  // QX-003 (experiment 4, iteration 1): added optional `prefix` parameter —
  // closes CB-009 (no prefix filter on MCP task_list) and partially
  // addresses CB-010 (response size reduced when prefix is used). Same
  // client-side filter logic as bin/quay.js's QX-002 implementation.
  //
  // QX-029 (experiment 4, iteration 8): added optional `search` parameter —
  // closes CB-014 (partial: search parity). Title+body search with heading
  // exclusion via stripHeadings(). Same logic as bin/quay.js + serve.ts.
  //
  // QX-030 (experiment 4, iteration 8): added optional `page` / `pageSize`
  // pagination parameters — closes CB-010 and UQ-008 (MCP response size).
  // Default pageSize=50, max pageSize=200. Applied after all other filters.
  // Response structuredContent includes total/page/pageSize/totalPages
  // metadata alongside the tasks array.
  //
  // QX-032 (experiment 4, iteration 9): changed `label` parameter from
  // z.string().optional() to z.array(z.string()).optional() — closes CB-015
  // (MCP multi-label filter parity). Backward-compatible: a single string
  // passed as label is coerced to a one-element array. AND-join semantics
  // match CLI (`--label A --label B`) and Web UI (`?label=A&label=B`).
  server.registerTool(
    "task_list",
    {
      description:
        `Version: ${QUAY_VERSION}. ` +
        "List tasks from an enabled Provider (defaults to the default-enabled Provider if `provider` is omitted), " +
        "optionally filtered by status, label, prefix (task-id prefix), and/or full-text search. " +
        "Supports pagination via `page` (1-based, default 1) and `pageSize` (default 50, max 200). " +
        "Response includes `tasks` array plus pagination metadata: `total` (filtered count before paging), " +
        "`page`, `pageSize`, `totalPages`. " +
        "On partial success (a task file whose frontmatter fails to parse), the response also includes " +
        "`malformed`: an array of { file, error } naming each unparseable file and its parser error " +
        "(these entries are unfiltered/unpaginated and never counted in `total`). " +
        "Filter order: status → label → prefix → search → pagination. " +
        "The filter+pagination work is pushed DOWN to the Provider when it supports it, so the " +
        "response carries only the requested page rather than every task's body — pageSize is a " +
        "real bound on the payload, not a post-hoc slice of an already-fully-transferred list. " +
        "The `label` parameter accepts an array of label strings for AND-join filtering (all specified labels must be present on the task). " +
        "A single string is also accepted for backward compatibility (treated as a one-element array). " +
        "The `prefix` parameter filters by task-id prefix (e.g. prefix='QX' returns only QX-* tasks, case-insensitive). " +
        "The `search` parameter does case-insensitive substring match on task title + body text; " +
        "markdown heading lines (## Proposal, ## Plan, ## AC, ## DoD, etc.) are excluded from the body match " +
        "to avoid false positives on template boilerplate. " +
        "Proxies the Provider's own task_list tool via Core's MCP client fan-out.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to query (defaults to the first-enabled Provider in .quay/config.yml)."),
        status: z.string().optional().describe("Filter by task status (e.g. 'todo', 'ready', 'done', 'needs-human', 'superseded'). Omit to include all statuses."),
        label: z.union([z.array(z.string()), z.string()]).optional().describe("Array of label strings for AND-join filtering (all specified labels must be present). A single string is accepted for backward compatibility. Omit to include all tasks regardless of labels."),
        prefix: z.string().optional().describe("Filter by task-id prefix, case-insensitive (e.g. 'QX' returns QX-001, QX-002, ...). Reduces response size for large multi-experiment workspaces."),
        search: z.string().optional().describe("Full-text search: case-insensitive substring match on task title + body content. Markdown heading lines (e.g. ## Proposal, ## Plan) are excluded from the body match to avoid template boilerplate false positives."),
        page: z.number().int().optional().describe("1-based page number (default 1). Applied after all filters."),
        pageSize: z.number().int().optional().describe("Number of tasks per page (default 50, max 200). Applied after all filters."),
      },
    },
    async ({ provider, status, label, prefix, search, page, pageSize }) => {
      const { client } = await getClient(provider);
      // QX-032: normalize label to an array (backward-compatible — single string still works).
      const labelFilters: string[] = Array.isArray(label) ? label : (label ? [label] : []);
      // QX-030: pagination values resolved BEFORE the fetch now, because they are
      // pushed DOWN to the Provider (see the push-down note below) — the previous
      // code could only resolve them after holding the whole store.
      const pageNum = Math.max(1, parseInt(String(page)) || 1);
      const size = Math.min(200, Math.max(1, parseInt(String(pageSize)) || 50));

      // ── gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp ──────────────
      // PUSH THE FILTERS AND THE PAGE DOWN. The previous shape here — `taskList({status})`
      // then filter and page in this process — forced the Provider to hand back EVERY
      // matching task WITH ITS BODY before any filter or page could be applied. On the
      // live store that is 2135 tasks / 14.4 MB, measured at 34-52 s on the ABI round
      // trip, and Core's MCP server is single-threaded: while that response was being
      // read and parsed, an unrelated `task_get` (2 ms of real work) sat in the queue and
      // the caller saw `-32001 Request timed out`. That is what made the ABI-only
      // `quay:quay-task` subagent — the documented task-CRUD main path, whose tool
      // allowlist has no CLI fallback — structurally unusable.
      //
      // The Provider's task_list applies status → label → prefix → search → page, the
      // SAME order and the SAME predicates this handler used to apply locally (the
      // native store shares one `matchesListFilter`, and its search clause is the same
      // title + heading-stripped-body substring match `stripHeadings` implements here).
      // So when it reports `paged: true` the answer IS the answer, and this handler
      // reports it without a second pass.
      //
      // Sentinel `paged: true` (not just "did the Provider return fewer rows"): a Provider
      // that ignores these optional args returns the whole unfiltered set and no `paged`
      // flag, which is exactly the case the client-side fallback below still serves.
      let listRes: Awaited<ReturnType<typeof client.taskList>>;
      try {
        listRes = await client.taskList({
          status,
          ...(labelFilters.length === 1 ? { label: labelFilters[0] } : {}),
          // >1 label: the array form is what the AND-join needs; the ABI's original
          // `label` is a single string, so a Provider whose schema rejects arrays
          // falls into the catch below rather than failing the read.
          ...(labelFilters.length > 1 ? { label: labelFilters } : {}),
          ...(prefix ? { prefix } : {}),
          ...(search ? { search } : {}),
          page: pageNum,
          pageSize: size,
        });
      } catch {
        // A Provider whose task_list schema rejects one of the pushed-down args (or an
        // older Provider build) fails the whole call. Re-issue the PRE-EXISTING call
        // shape — `{status}`, the one filter every Provider has always accepted — and
        // let the client-side fallback below do the filtering and paging. Either way the
        // caller gets a correct answer; only the cost differs. A genuine store failure
        // re-throws on this second call, so it is never masked.
        listRes = await client.taskList({ status });
      }
      const malformed = listRes.malformed;
      let tasks: typeof listRes.tasks;
      let total: number;
      let paged: typeof listRes.tasks;
      let totalPages: number;
      if (listRes.paged === true && typeof listRes.total === "number") {
        // The Provider applied every filter above and this is the requested window of
        // that filtered set — trust its count and its page.
        tasks = listRes.tasks;
        total = listRes.total;
        paged = tasks;
        totalPages = typeof listRes.totalPages === "number" ? listRes.totalPages : Math.ceil(total / size);
      } else {
        // ── client-side fallback (the pre-existing behaviour, kept for Providers that
        //    do not implement the optional filter/paging args) ──
        // QX-032: client-side AND-join label filter — matches CLI (--label A --label B) and
        // Web UI (?label=A&label=B) semantics. Empty labelFilters = no filter applied.
        let filtered = listRes.tasks;
        if (labelFilters.length > 0) {
          filtered = filtered.filter((t) =>
            labelFilters.every((l) => Array.isArray(t.labels) && t.labels.includes(l))
          );
        }
        // QX-003: client-side prefix filter.
        if (prefix) {
          filtered = filtered.filter((t) => t.id.toUpperCase().startsWith(prefix.toUpperCase()));
        }
        // QX-029: client-side search filter (title + stripped body, case-insensitive).
        if (search) {
          const sq = search.toLowerCase();
          filtered = filtered.filter((t) =>
            (t.title + " " + stripHeadings(t.body || "")).toLowerCase().includes(sq)
          );
        }
        // QX-030: pagination — applied after all filters so page/total reflect filtered set.
        total = filtered.length;
        const start = (pageNum - 1) * size;
        paged = filtered.slice(start, start + size);
        totalPages = Math.ceil(total / size);
      }
      // QX-035 (experiment 4, iteration 10): Mitigation A — _version field lets
      // AI agents detect MCP server staleness by comparing against expected version.
      // gap-one-unparseable-task-takes-down-the-whole-board: forward the
      // provider's malformed list verbatim (partial success — see above).
      const result = { tasks: paged, total, page: pageNum, pageSize: size, totalPages, _version: QUAY_VERSION, malformed };
      return {
        content: budgetedTaskListContent(result, { count: paged.length, total, page: pageNum, totalPages }),
        structuredContent: result,
      };
    }
  );

  // task_get
  // QX-031: description updated to reflect current field set (updatedAt added
  // by QX-018/store.js). No logic changes.
  server.registerTool(
    "task_get",
    {
      description:
        "Get one task by id from an enabled Provider (defaults to the default-enabled Provider if `provider` is omitted). " +
        "Returns full task details including id, title, status, labels, parent, children, role, body, updatedAt (ms since epoch), and extra fields. " +
        "Returns isError:true if the task id does not exist. " +
        "Proxies the Provider's own task_get tool.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to query (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to retrieve (e.g. 'QX-029')."),
      },
    },
    async ({ provider, id }) => {
      const { client } = await getClient(provider);
      const task = await client.taskGet(id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `no such task: ${id} (provider: ${provider || "default"})` }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
        structuredContent: { task },
      };
    }
  );

  // task_write — generic passthrough (provider-client.ts's own taskWrite is
  // already provider-agnostic per QN-024's comment; whether the selected
  // Provider actually implements data.write is between the caller and that
  // Provider's own manifest, same discipline as bin/quay.js's `task edit`).
  // QX-031: description updated to document expectedStatus CAS semantics and
  // label array type. No logic changes.
  //
  // SILENT-COMPLETION GUARD (gap-silent-completion-path-writes-no-gate-event, 2026-09-30):
  // the generic passthrough above has ONE semantic arm — reaching `done`. The invariant
  // "landing ⇒ a `complete` GateEvent" is asserted after the fact by `gate-event-coverage-check`,
  // which is fail-closed and runs BEFORE the suite in the static gate chain. On 2026-09-30 a bare
  // `task_write` flipping `needs-human → done` wrote ZERO events, so that judge reddened the next
  // day and every code delta's fan-in aborted at the static gate — the suite never ran. A detector
  // whose cost is a day of stopped landings is not a harmless red reading: the invariant has to
  // hold on the WRITE side.
  //
  // So a patch whose `status` is `done` is REFUSED unless it carries the explicit out-of-band
  // channel (`completeReason`), which routes through `runCompleteOutOfBand` — the one primitive
  // that writes the status AND the `complete` event together. The guard lives HERE, in Core, and
  // not in a Provider: "reaching done is gated" is task-lifecycle semantics, and pushing it into
  // each backend would leak gate meaning into every Provider (the ABI stays provider-agnostic).
  server.registerTool(
    "task_write",
    {
      description:
        "Write/patch one task's frontmatter and/or body on an enabled Provider (defaults to the default-enabled Provider). " +
        "Only provided fields are updated; omitted fields are left unchanged. " +
        "Supply `expectedStatus` for optimistic-locking (CAS): if the task's current status does not match, returns isError:true without writing. " +
        "`labels` is an array of strings (replaces the full label set). " +
        "`status:'done'` is REFUSED unless `completeReason` is supplied: reaching done must carry a `complete` GateEvent, and a bare status write produces none. " +
        "`completeReason` (required with status=done, ≥8 non-whitespace chars) is the explicit out-of-band completion channel — it writes status=done AND appends the `complete` pass event in one step, recording your reason as its evidence. Use it for a task the normal gate cannot judge (e.g. `needs-human`, or no acceptance meter); use `lifecycle_complete` for a `ready` task with a meter. " +
        "Returns the updated task object on success, or isError:true on CAS conflict, refusal, or other failure. " +
        "Proxies the Provider's own task_write tool (except for the status=done arm, which Core gates).",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to write to (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to write/patch (e.g. 'QX-029')."),
        title: z.string().optional().describe("New title. Omit to leave unchanged."),
        status: z.string().optional().describe("New status ('todo', 'ready', 'needs-human', 'done', 'superseded'). Omit to leave unchanged. 'done' requires completeReason."),
        labels: z.array(z.string()).optional().describe("Replacement label array (replaces all existing labels). Omit to leave unchanged."),
        parent: z.string().nullable().optional().describe("Parent task id, or null to clear. Omit to leave unchanged."),
        children: z.array(z.string()).optional().describe("Replacement children array. Omit to leave unchanged."),
        depends_on: z.array(z.string()).optional().describe("Prerequisite task ids (relation edge, first-class top-level field). Omit to leave unchanged."),
        goal_ac: z.string().optional().describe("Owning goal AC id (task→AC linkage, top-level single scalar). Omit to leave unchanged."),
        body: z.string().optional().describe("Full replacement body (markdown). Omit to leave unchanged."),
        extra: z.record(z.string(), z.any()).optional().describe("Extra frontmatter fields as a key/value map."),
        expectedStatus: z.string().optional().describe("Optimistic-locking guard: if task's current status differs from this value, the write is refused with isError:true (no mutation). Omit to skip the check."),
        completeReason: z.string().optional().describe("The out-of-band completion channel, required when status='done': why this task reaches done without a gate verdict (≥8 non-whitespace chars). Written as the `complete` GateEvent's `verifiedBy` evidence. Never forwarded to the Provider — it is a Core-side lifecycle instruction, not a task field."),
      },
    },
    async ({ provider, id, completeReason, ...patch }) => {
      const { client } = await getClient(provider);
      try {
        if ((patch as { status?: string }).status === TASK_STATUS.DONE) {
          if (typeof completeReason !== "string" || completeReason.trim() === "") {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text:
                    `refused: task_write cannot set status=done without the completion channel (${id}).\n` +
                    `Reaching done must carry a \`complete\` GateEvent — a bare status write produces none, and ` +
                    `gate-event-coverage-check (fail-closed, ahead of the suite) then stalls every landing.\n` +
                    `Two sanctioned routes:\n` +
                    `  (a) lifecycle_complete — runs the acceptance gate; requires status=ready and a meter (the normal path).\n` +
                    `  (b) task_write with completeReason:"<why>" — the explicit out-of-band channel for a task that cannot ` +
                    `be gated (needs-human, no acceptance meter). It writes status=done AND the complete event itself, ` +
                    `recording your reason as evidence.`,
                },
              ],
            };
          }
          const cfg = loadConfig();
          const logPath = resolveGateLogPath(cfg.workspaceRoot, {});
          const result = await runCompleteOutOfBand({
            client: client as unknown as Parameters<typeof runCompleteOutOfBand>[0]["client"],
            id,
            logPath,
            workspaceRoot: cfg.workspaceRoot,
            reason: completeReason,
            expectedStatus: (patch as { expectedStatus?: string }).expectedStatus,
          });
          process.exitCode = 0; // MCP is long-running: never leak the lifecycle helper's exitCode
          if (!result.ok) {
            return { isError: true, content: [{ type: "text" as const, text: result.reason }] };
          }
          // Same response shape as every other task_write arm (`structuredContent.task`) — the
          // completion channel is a route for one field, not a differently-shaped verb.
          const completed = await client.taskGet(id);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(completed, null, 2) }],
            structuredContent: { task: completed, complete: result },
          };
        }
        const task = await client.taskWrite({ id, ...patch });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
          structuredContent: { task },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }],
        };
      }
    }
  );

  // task_add_label — safe "append one label, keep the rest"
  // (gap-task-write-labels-replace-not-append-no-safe-add-action). `task_write.labels` REPLACES the
  // whole label set (see the task_write description above), so a caller that wants to ADD a single
  // label (e.g. delivery-critical) without wiping gap/defect/directive must first task_get + reassemble
  // the full array — an omission-prone round-trip with no mechanism as a backstop. This verb performs
  // that read-modify-write INTERNALLY (read current labels → append `label` when absent, dedupe →
  // write back the union), so the caller never hand-assembles a labels array. Provider-agnostic
  // (taskGet + taskWrite), matching the file's own "Core never special-cases a Provider id" discipline;
  // the driver-layer frontmatter-text counterpart is ensureLabel in plugin/scripts/task-ops.ts.
  server.registerTool(
    "task_add_label",
    {
      description:
        "Append a single label to one task WITHOUT disturbing its existing labels (safe label add). " +
        "`task_write.labels` REPLACES the whole label set, so adding one label by hand would wipe the " +
        "rest; this reads the current labels, appends `label` only when absent (no duplicates), and " +
        "writes back the union — no caller-side task_get + array reassembly. " +
        "Returns the updated task plus `added` (false when the label was already present). " +
        "Provider-agnostic (Core-side read-modify-write over task_get/task_write).",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to write to (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to add the label to (e.g. 'QX-029')."),
        label: z.string().min(1).describe("Label to append (e.g. 'delivery-critical'). Added only when absent; existing labels are preserved."),
      },
    },
    async ({ provider, id, label }) => {
      const { client } = await getClient(provider);
      try {
        const current = await client.taskGet(id);
        if (!current) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `no such task: ${id} (provider: ${provider || "default"})` }],
          };
        }
        const existing = Array.isArray(current.labels) ? current.labels : [];
        // Idempotent: the label is already present — return the current task WITHOUT writing. A
        // no-op taskWrite of an unchanged labels array would reach the Provider, which rewrites
        // identical bytes and then "fails" its commit as nothing-to-commit (a spurious failure log,
        // not a real error) — skipping the write keeps the no-op silent, matching the verb's
        // "append without duplicating" contract.
        if (existing.includes(label)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(current, null, 2) }],
            structuredContent: { task: current, added: false, label },
          };
        }
        const task = await client.taskWrite({ id, labels: [...existing, label] });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
          structuredContent: { task, added: true, label },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }],
        };
      }
    }
  );

  // task_delete — generic passthrough (gap-abi-missing-commit-delete-dependson-primitives), mirroring
  // taskWrite's provider-agnostic discipline: Core forwards the id and surfaces whatever the
  // Provider's own task_delete reports. A not-found id arrives as isError (the provider fails
  // closed), which taskDelete() throws → surfaced as isError:true here, never a silent no-op.
  server.registerTool(
    "task_delete",
    {
      description:
        "Delete one task by id on an enabled Provider (defaults to the default-enabled Provider). " +
        "Returns the deletion result ({ id, ok, reason, committed, propagated }); isError:true if the task id does not exist. " +
        "Proxies the Provider's own task_delete tool.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to delete from (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to delete (e.g. 'QX-029')."),
      },
    },
    async ({ provider, id }) => {
      const { client } = await getClient(provider);
      try {
        const result = await client.taskDelete(id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }],
        };
      }
    }
  );

  // task_check — generic passthrough, same pattern as task_write.
  // QX-031: description updated to document ok/acTotal/acChecked response
  // fields. No logic changes.
  server.registerTool(
    "task_check",
    {
      description:
        "Assert the ready/done gate for one task on an enabled Provider (defaults to the default-enabled Provider). " +
        "Returns { ok, acTotal, acChecked, ... } where ok:true means all AC checkboxes are checked and the task is in a gate-passing status. " +
        "ok:false means the gate is not yet satisfied (some ACs unchecked, or status not ready/done). " +
        "Proxies the Provider's own task_check tool.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to query (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to check the gate for (e.g. 'QX-029')."),
      },
    },
    async ({ provider, id }) => {
      const { client } = await getClient(provider);
      try {
        const result = await client.taskCheck(id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }],
        };
      }
    }
  );
}

export function registerGateHandlers(
  server: McpServer,
  getClient: (id: string | undefined) => Promise<ConnectedProvider>,
  cfg: ReturnType<typeof loadConfig>
): void {
  // ── QENG gate/lifecycle tools (DIR-007 MCP parity) ──
  // Every tool below delegates to the SAME src/gate/*.ts functions
  // bin/quay.js's own gate/gate-log/complete/adjudicate/promote/retreat
  // branches call -- zero duplicated gate/lifecycle logic. `run` (the
  // autonomous scan->complete loop) is deliberately NOT exposed here; see
  // docs/plans/14-mcp-gate-lifecycle-parity.md for the full decision.
  //
  // Convention shared by all 6 tools below: a gate/lifecycle FAIL (unmet
  // acceptance meter, illegal transition attempted, etc.) is a normal
  // SUCCESSFUL tool call reporting `ok:false` in structuredContent -- NOT
  // isError:true -- mirroring how the existing task_check tool already
  // treats a failing gate as a successful read, not a crash. isError:true is
  // reserved for genuine call failures (unknown task id, unknown gate name,
  // illegal transition attempted via promote/retreat, missing/empty
  // `retreat` reason).

  // DIR-103-C — MCP-side per-provider `acceptance_env` resolution (per-surface
  // helper duplicated from bin/quay.ts — see that file's own
  // resolveAcceptanceEnvFile). Defined inside registerGateHandlers so it
  // closes over `cfg`; explicit `providerId` rather than implicit active-id.
  // Relative paths resolve against cfg.workspaceRoot. Returns undefined when
  // the provider has no `acceptance_env` key.
  function resolveAcceptanceEnvFile(providerId: string | undefined): string | undefined {
    const provider = activeProvider(cfg, providerId);
    if (typeof provider.acceptance_env !== "string" || provider.acceptance_env.trim() === "") {
      return undefined;
    }
    return path.resolve(cfg.workspaceRoot, provider.acceptance_env);
  }

  // gate_run — mirrors `quay gate <task-id> [--gate <name>]`. Default gate
  // is "acceptance" at the MCP-tool layer only, matching the CLI's own
  // `vf.gate ?? "acceptance"` default (the engine's own `runGate` default,
  // "dod", is for direct programmatic callers and stays unchanged).
  server.registerTool(
    "gate_run",
    {
      description:
        "Run a named gate check against one task on an enabled Provider (defaults to the default-enabled Provider), appending one GateEvent to the gate-events log. " +
        "Defaults to the 'acceptance' gate (runs task.extra.acceptance as a shell command, fail-closed if unset) -- matching `quay gate <task-id>`'s own CLI default. " +
        "Pass `gate` to select a different registered gate (e.g. 'dod'). " +
        "Pass `dryRun: true` to execute the gate (running the acceptance command via the shared runner) WITHOUT appending a GateEvent or mutating status. " +
        "Returns { ok, reason, event } -- ok:false is a NORMAL result (gate not satisfied), not an error. " +
        "Mirrors `quay gate <task-id> [--gate <name>]`.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to query (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to run the gate against (e.g. 'QX-029')."),
        gate: z.string().optional().describe("Gate name to run (default: 'acceptance', matching the CLI's own default). Use `--gate dod`'s equivalent, e.g. gate: 'dod', to run the author gate instead."),
        timeoutMs: z.number().int().positive().optional().describe("Kill deadline in ms for the acceptance runner (MCP parity with the CLI's --timeout; DIR-049 B1). Highest precedence: overrides the gate's gates.yml timeoutMs and the 60000 default. Needed for long suites (e.g. a ~137s `npx vitest run` via an acceptance gate would otherwise time out at the 60s default)."),
        file: z.string().optional().describe("Override the GateEvent log path (default <workspaceRoot>/.quay/gate-events.jsonl)."),
        cwd: z.string().optional().describe("Override the acceptance runner's working directory (default: workspaceRoot). Mirrors `quay gate --cwd`. Highest precedence over workspaceRoot default."),
        dryRun: z.boolean().optional().describe("When true, execute the acceptance command via the shared runAcceptance() runner and return the verdict WITHOUT appending a GateEvent and WITHOUT mutating task status (DIR-103-B dry run)."),
      },
    },
    async ({ provider, id, gate, timeoutMs, file, cwd, dryRun }) => {
      const prevTimeout = process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
      const prevCwd = process.env.QUAY_ACCEPTANCE_CWD;
      const prevEnv = process.env.QUAY_ACCEPTANCE_ENV;
      try {
        const { client } = await getClient(provider);
        const logPath = resolveGateLogPath(cfg.workspaceRoot, { file });
        // mirrors pinAcceptanceEnv in bin/quay.js -- see DIR-046
        if (cwd) {
          process.env.QUAY_ACCEPTANCE_CWD = cwd;
        } else if (!process.env.QUAY_ACCEPTANCE_CWD) {
          process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;
        }
        // else: pre-set env var wins -- leave untouched (mirrors pinAcceptanceEnv in bin/quay.js:206)
        // DIR-049 B1: thread an explicit timeout into the acceptance runner (the MCP path previously
        // had NO way to raise it, so a long acceptance-gate command always hit the 60000 default —
        // the archguard DIR-048 friction). `resolveRunnerOptions` reads QUAY_ACCEPTANCE_TIMEOUT_MS at
        // highest precedence; set it here so gate_run reaches parity with the CLI `--timeout`.
        if (timeoutMs !== undefined) process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = String(timeoutMs);
        // DIR-103-C: pin QUAY_ACCEPTANCE_ENV from the selected provider's
        // acceptance_env config key — mirrors resolveAcceptanceEnvFile + the
        // cwd branch's explicit-override-wins: a pre-set env var wins; never
        // clobber. Falls through to resolveRunnerOptions which reads this env var.
        const envFile = resolveAcceptanceEnvFile(provider);
        if (envFile && !process.env.QUAY_ACCEPTANCE_ENV) {
          process.env.QUAY_ACCEPTANCE_ENV = envFile;
        }
        // DIR-103-B: dryRun is a pure forward — the skip-append lives in the
        // engine (runGate), never here. The handler performs no local skip logic.
        const result = await runGate({ client: client as Parameters<typeof runGate>[0]['client'], id, gate: gate ?? "acceptance", logPath, workspaceRoot: cfg.workspaceRoot, dryRun });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }] };
      } finally {
        // restore so one gate_run's explicit timeout never leaks into later env-driven resolutions
        if (prevTimeout === undefined) delete process.env.QUAY_ACCEPTANCE_TIMEOUT_MS;
        else process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = prevTimeout;
        // restore QUAY_ACCEPTANCE_CWD so one gate_run's cwd never leaks into subsequent calls
        if (prevCwd === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;
        else process.env.QUAY_ACCEPTANCE_CWD = prevCwd;
        // restore QUAY_ACCEPTANCE_ENV so one gate_run's env file never leaks into subsequent calls
        if (prevEnv === undefined) delete process.env.QUAY_ACCEPTANCE_ENV;
        else process.env.QUAY_ACCEPTANCE_ENV = prevEnv;
      }
    }
  );

  // gate_log — read-only query, never appends. Mirrors `quay gate-log <task-id>`.
  server.registerTool(
    "gate_log",
    {
      description:
        "Read-only query of GateEvent history for one task on an enabled Provider (defaults to the default-enabled Provider). Never appends. " +
        "Returns the matching GateEvent array (newest last), optionally filtered by gate name / actor / time range / pagination. " +
        "Mirrors `quay gate-log <task-id> [--gate <name>] [--json]`.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id (only affects workspaceRoot resolution; the gate-event log is workspace-wide, not per-Provider)."),
        id: z.string().describe("Task id to filter GateEvents by (pipeline_id)."),
        gate: z.string().optional().describe("Filter by gate name (e.g. 'acceptance', 'dod')."),
        actor: z.string().optional().describe("Filter by actor."),
        since: z.string().optional().describe("ISO timestamp lower bound (inclusive)."),
        until: z.string().optional().describe("ISO timestamp upper bound (inclusive)."),
        limit: z.number().int().optional().describe("Max number of events to return."),
        offset: z.number().int().optional().describe("Number of matching events to skip before applying limit."),
        file: z.string().optional().describe("Override the GateEvent log path (default <workspaceRoot>/.quay/gate-events.jsonl)."),
      },
    },
    async ({ provider, id, gate, actor, since, until, limit, offset, file }) => {
      try {
        await getClient(provider); // validates provider id / resolves workspaceRoot use, same as other tools
        const events = runGateLogQuery(cfg.workspaceRoot, { pipelineId: id, gate, actor, since, until, limit, offset, file });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }],
          structuredContent: { events },
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }] };
      }
    }
  );

  // gate_list — mirrors `quay gate --list`. Exposes the registered gate names
  // (built-ins + workspace gates) over MCP so agents can discover available
  // gates without hardcoding names or inspecting files directly.
  server.registerTool(
    "gate_list",
    {
      description:
        "List registered gate names (built-ins + workspace gates). " +
        "Returns { gates: string[] } including dod, acceptance, and any workspace gates declared in .quay/gates.yml. " +
        "Mirrors `quay gate --list`.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id (only affects workspaceRoot resolution; gates are workspace-wide, not per-Provider)."),
      },
    },
    async ({ provider }) => {
      try {
        await getClient(provider); // validates provider id / resolves workspaceRoot use
        const gates = listGates(cfg.workspaceRoot);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ gates }, null, 2) }],
          structuredContent: { gates },
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }] };
      }
    }
  );
}

export function registerLifecycleHandlers(
  server: McpServer,
  getClient: (id: string | undefined) => Promise<ConnectedProvider>,
  cfg: ReturnType<typeof loadConfig>
): void {
  // lifecycle_complete — mirrors `quay complete <task-id>`.
  server.registerTool(
    "lifecycle_complete",
    {
      description:
        "Precondition: task status is 'ready'. Runs the acceptance gate; on pass writes status='done' and appends a 'complete' GateEvent (exit-0-equivalent); on fail, status is left unchanged (exit-1-equivalent). " +
        "Not-ready task -> ok:false, no gate run, no write. Returns { ok, reason }. Mirrors `quay complete <task-id>`.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to write to (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to complete (must currently be status='ready')."),
        file: z.string().optional().describe("Override the GateEvent log path (default <workspaceRoot>/.quay/gate-events.jsonl)."),
      },
    },
    async ({ provider, id, file }) => {
      const prevCwd = process.env.QUAY_ACCEPTANCE_CWD;
      try {
        const { client } = await getClient(provider);
        const logPath = resolveGateLogPath(cfg.workspaceRoot, { file });
        process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;
        const result = await runComplete({ client: client as unknown as Parameters<typeof runComplete>[0]['client'], id, logPath, workspaceRoot: cfg.workspaceRoot });
        process.exitCode = 0; // DIR-086: reset stale exitCode from lifecycle function (MCP is long-running)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }] };
      } finally {
        if (prevCwd === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;
        else process.env.QUAY_ACCEPTANCE_CWD = prevCwd;
      }
    }
  );

  // lifecycle_adjudicate — read-only independent audit pass, never writes
  // status. Mirrors `quay adjudicate <task-id>`.
  server.registerTool(
    "lifecycle_adjudicate",
    {
      description:
        "Independent, read-only audit pass over one task: records the mechanical state observed via the task's own gate check as an 'audit' GateEvent, WITHOUT delegating verdict authority to it. Never writes status. " +
        "Returns { ok, reason }. Mirrors `quay adjudicate <task-id>`.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to query (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to adjudicate."),
        file: z.string().optional().describe("Override the GateEvent log path (default <workspaceRoot>/.quay/gate-events.jsonl)."),
      },
    },
    async ({ provider, id, file }) => {
      try {
        const { client } = await getClient(provider);
        const logPath = resolveGateLogPath(cfg.workspaceRoot, { file });
        const result = await runAdjudicate({ client: client as unknown as Parameters<typeof runAdjudicate>[0]['client'], id, logPath });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }] };
      }
    }
  );

  // lifecycle_promote — one legal forward step over the lifecycle
  // TRANSITIONS map (ready->done delegates to complete; todo->ready runs the
  // 'dod' author gate). Illegal forward edge -> isError:true (assertTransition
  // throws). Mirrors `quay promote <task-id>`.
  server.registerTool(
    "lifecycle_promote",
    {
      description:
        "Advance one task by exactly one legal forward lifecycle step (todo->ready via the 'dod' gate; ready->done via the same path as lifecycle_complete). " +
        "Returns { ok, reason, to }: on gate fail, ok:false and to:null (status unchanged). An ILLEGAL forward edge (e.g. task already 'done', or 'needs-human') returns isError:true. " +
        "Mirrors `quay promote <task-id>`.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to write to (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to promote."),
        file: z.string().optional().describe("Override the GateEvent log path (default <workspaceRoot>/.quay/gate-events.jsonl)."),
      },
    },
    async ({ provider, id, file }) => {
      const prevCwd = process.env.QUAY_ACCEPTANCE_CWD;
      try {
        const { client } = await getClient(provider);
        const logPath = resolveGateLogPath(cfg.workspaceRoot, { file });
        process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;
        const result = await runPromote({ client: client as unknown as Parameters<typeof runPromote>[0]['client'], id, logPath, workspaceRoot: cfg.workspaceRoot });
        process.exitCode = 0; // DIR-086: reset stale exitCode from lifecycle function (MCP is long-running)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }] };
      } finally {
        if (prevCwd === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;
        else process.env.QUAY_ACCEPTANCE_CWD = prevCwd;
      }
    }
  );

  // lifecycle_retreat — one legal backward step; `reason` is REQUIRED (it IS
  // the deliverable of a retreat) -- enforced both at the zod-schema level
  // (missing argument rejected before the handler runs) and by runRetreat's
  // own internal guard. No gate runs. Mirrors `quay retreat <task-id> --reason <r>`.
  server.registerTool(
    "lifecycle_retreat",
    {
      description:
        "Roll one task back by exactly one legal backward lifecycle step (done->ready, ready->todo, needs-human->todo). `reason` is REQUIRED -- it is the deliverable of a retreat and is recorded in the GateEvent payload. " +
        "No gate runs (retreat always succeeds for a legal edge, regardless of gate state). An ILLEGAL backward edge (e.g. task is 'todo') returns isError:true. " +
        "Returns { ok, to }. Mirrors `quay retreat <task-id> --reason <r>`.",
      inputSchema: {
        provider: z.string().optional().describe("Provider id to write to (defaults to the first-enabled Provider in .quay/config.yml)."),
        id: z.string().describe("Task id to retreat."),
        reason: z.string().min(1).describe("Required: why this task is being rolled back. Recorded in the GateEvent payload."),
        file: z.string().optional().describe("Override the GateEvent log path (default <workspaceRoot>/.quay/gate-events.jsonl)."),
      },
    },
    async ({ provider, id, reason, file }) => {
      try {
        const { client } = await getClient(provider);
        const logPath = resolveGateLogPath(cfg.workspaceRoot, { file });
        const result = await runRetreat({ client: client as unknown as Parameters<typeof runRetreat>[0]['client'], id, reason, logPath });
        process.exitCode = 0; // DIR-086: reset stale exitCode from lifecycle function (MCP is long-running)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }] };
      }
    }
  );
}

export function registerAdrHandlers(
  server: McpServer,
  getClient: (id: string | undefined) => Promise<ConnectedProvider>
): void {
  // ── ADR tools — proxy the Provider's adr_list/adr_get/adr_write (separate
  // object kind; a Provider MAY not support ADRs, in which case adrList returns
  // [] and adr_get/adr_write surface isError, per provider-client.ts).
  server.registerTool(
    "adr_list",
    {
      description: "List ADRs (Architecture Decision Records) on an enabled Provider, optionally filtered by status/tag. ADRs are a separate kind from tasks (decision lifecycle: proposed/accepted/superseded/deprecated/rejected).",
      inputSchema: {
        provider: z.string().optional(),
        status: z.string().optional(),
        tag: z.string().optional(),
      },
    },
    async ({ provider, status, tag }) => {
      const { client } = await getClient(provider);
      const adrs = await client.adrList({ status, tag });
      return { content: [{ type: "text" as const, text: JSON.stringify(adrs, null, 2) }], structuredContent: { adrs } };
    }
  );

  server.registerTool(
    "adr_get",
    {
      description: "Get one ADR by id (ADR-NNN) from an enabled Provider. Returns isError:true if not found or the Provider does not support ADRs.",
      inputSchema: { provider: z.string().optional(), id: z.string() },
    },
    async ({ provider, id }) => {
      const { client } = await getClient(provider);
      const adr = await client.adrGet(id);
      if (!adr) return { isError: true, content: [{ type: "text" as const, text: `no such ADR: ${id}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(adr, null, 2) }], structuredContent: { adr } };
    }
  );

  server.registerTool(
    "adr_write",
    {
      description: "Write/patch one ADR on an enabled Provider. status ∈ proposed|accepted|superseded|deprecated|rejected (never 'done'). Returns isError:true on validation failure or if the Provider does not support ADRs.",
      inputSchema: {
        provider: z.string().optional(),
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
    async ({ provider, id, ...patch }) => {
      const { client } = await getClient(provider);
      try {
        const adr = await client.adrWrite({ id, ...patch });
        return { content: [{ type: "text" as const, text: JSON.stringify(adr, null, 2) }], structuredContent: { adr } };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }] };
      }
    }
  );
}

export function registerMetaHandlers(
  server: McpServer,
  getClient: (id: string | undefined) => Promise<ConnectedProvider>
): void {
  // ── Meta tools — proxy the Provider's meta_list/meta_get/meta_write (separate object kind:
  // message SENT TO the meta-driver, answered on the same record; proposed→answered lifecycle).
  server.registerTool(
    "meta_list",
    {
      description: "List META records (META-NNN) on an enabled Provider, optionally filtered by status. META records are a separate kind from tasks (message→meta-driver lifecycle: proposed→answered, the reply embedded on the same record).",
      inputSchema: {
        provider: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async ({ provider, status }) => {
      const { client } = await getClient(provider);
      const metas = await client.metaList({ status });
      return { content: [{ type: "text" as const, text: JSON.stringify(metas, null, 2) }], structuredContent: { metas } };
    }
  );

  server.registerTool(
    "meta_get",
    {
      description: "Get one META record by id (META-NNN) from an enabled Provider. Returns isError:true if not found or the Provider does not support META records.",
      inputSchema: { provider: z.string().optional(), id: z.string() },
    },
    async ({ provider, id }) => {
      const { client } = await getClient(provider);
      const meta = await client.metaGet(id);
      if (!meta) return { isError: true, content: [{ type: "text" as const, text: `no such META: ${id}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(meta, null, 2) }], structuredContent: { meta } };
    }
  );

  server.registerTool(
    "meta_write",
    {
      description: "Write/patch one META record on an enabled Provider. status ∈ proposed|answered (never 'done'); `handler` defaults to meta-driver; `reply` embeds the answer on the same record. Returns isError:true on validation failure or if the Provider does not support META records.",
      inputSchema: {
        provider: z.string().optional(),
        id: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        handler: z.string().optional(),
        reply: z.string().optional(),
        body: z.string().optional(),
      },
    },
    async ({ provider, id, ...patch }) => {
      const { client } = await getClient(provider);
      try {
        const meta = await client.metaWrite({ id, ...patch });
        return { content: [{ type: "text" as const, text: JSON.stringify(meta, null, 2) }], structuredContent: { meta } };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }] };
      }
    }
  );
}

export function registerConfigHandlers(
  server: McpServer,
  cfg: ReturnType<typeof loadConfig>
): void {
  // config_validate — workspace-scoped config validation (DIR-099-C).
  // This is a diagnostic tool, not a gate — it is read-only and does not
  // append to gate-events.jsonl. No `provider` argument because config
  // validation is workspace-scoped, not Provider-scoped (the config DEFINES
  // providers — routing through a provider to validate it is circular).
  // The handler is a thin passthrough to the shared validateConfig module
  // (DIR-099-A) — zero duplicated validation logic.
  //
  // omitted checkFiles defaults to false (byte-parity with CLI no-flag).
  // structuredContent is the machine-readable output channel.
  server.registerTool(
    "config_validate",
    {
      description:
        "Validate workspace configuration (.quay/config.yml) for structural correctness: " +
        "YAML syntax, provider fields, gate schemas, gate reference resolution, loop fields, and routine shapes. " +
        "Returns { ok, issues[] } in structuredContent. " +
        "Pass checkFiles:true to also verify that gate script/command paths reference files that exist on disk. " +
        "This tool is workspace-scoped — it does not take a provider argument (the config defines providers). " +
        "A malformed config returns ok:false with issues (not isError:true); " +
        "an absent/unreadable config file or internal crash returns isError:true.",
      inputSchema: {
        checkFiles: z.boolean().optional().describe(
          "If true, also check that gate script/command paths exist on disk. Default: false (CLI parity — --check-files is opt-in)."
        ),
      },
    },
    async ({ checkFiles }) => {
      try {
        const result = validateConfig({ workspaceRoot: cfg.workspaceRoot, checkFiles: checkFiles ?? false });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }],
        };
      }
    }
  );
}

export function registerAllHandlers(
  server: McpServer,
  getClient: (providerId: string | undefined) => Promise<ConnectedProvider>,
  cfg: ReturnType<typeof loadConfig>
): void {
  registerTaskHandlers(server, getClient);
  registerGateHandlers(server, getClient, cfg);
  registerLifecycleHandlers(server, getClient, cfg);
  registerAdrHandlers(server, getClient);
  registerMetaHandlers(server, getClient);
  registerActionHandlers(server, getClient, cfg);
  registerConfigHandlers(server, cfg);
}

export function registerActionHandlers(
  server: McpServer,
  getClient: (id: string | undefined) => Promise<ConnectedProvider>,
  cfg: ReturnType<typeof loadConfig>
): void {
  // action_list / action_run (DIR-010): mirror bin/quay.js's own `action
  // list`/`action run` subcommands (proposal §9's own "one capability set,
  // three bindings" list), so an Agent connected only via `quay mcp` can
  // enumerate and trigger action buttons, not merely list/get/write/check
  // tasks. Same generic, provider-agnostic passthrough shape as the four
  // existing tools above (optional `provider` argument, same
  // getClient()/error-handling convention) -- zero Provider-specific
  // branching, matching the standing "Core never special-cases a Provider
  // id" discipline (design §6.3, this file's own header comment).

  // action_list — same filtering logic as bin/quay.js's `action list`:
  // manifest.action_buttons filtered by whenStatus against the task's
  // current status.
  server.registerTool(
    "action_list",
    {
      description:
        "List the action buttons applicable to one task's current status, on an enabled Provider (defaults to the default-enabled Provider). Proxies the Provider's own manifest/task_get and applies the same whenStatus filter as `quay action list`.",
      inputSchema: {
        provider: z.string().optional(),
        id: z.string(),
      },
    },
    async ({ provider, id }) => {
      const { client } = await getClient(provider);
      const manifest = await client.manifest();
      const task = await client.taskGet(id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `no such task: ${id} (provider: ${provider || "default"})` }],
        };
      }
      const buttons = ((manifest.action_buttons ?? []) as Array<{ id: string; label: string; whenStatus?: string[] }>).filter(
        (b) => !b.whenStatus || b.whenStatus.includes(task.status)
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(buttons, null, 2) }],
        structuredContent: { buttons },
      };
    }
  );

  // action_run — same compose+deliver logic as bin/quay.js's `action run`.
  // Supports the DIR-009 mock/file-log delivery mode via an explicit
  // `mockLogPath` argument (rather than only the QUAY_ACTION_MOCK_LOG env
  // var bin/quay.js/serve.ts read), so this tool's own regression test can
  // select deterministic delivery per-call without relying on process-wide
  // env state -- the same underlying deliverTrigger() contract, just wired
  // through an explicit MCP tool argument instead of an env var, since MCP
  // tool calls are the natural place for a caller-supplied argument rather
  // than ambient environment state.
  server.registerTool(
    "action_run",
    {
      description:
        "Compose and deliver one action-button trigger for a task, on an enabled Provider (defaults to the default-enabled Provider). Mirrors `quay action run`. Pass `mockLogPath` to select the deterministic mock/file-log delivery mode (DIR-009) instead of live manda/print delivery -- the same contract QUAY_ACTION_MOCK_LOG selects for the CLI and Web UI.",
      inputSchema: {
        provider: z.string().optional(),
        id: z.string(),
        actionId: z.string(),
        mockLogPath: z.string().optional(),
      },
    },
    async ({ provider, id, actionId, mockLogPath }) => {
      const { client } = await getClient(provider);
      const manifest = await client.manifest();
      const task = await client.taskGet(id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `no such task: ${id} (provider: ${provider || "default"})` }],
        };
      }
      let payloadObj;
      try {
        payloadObj = composePayload({ providerManifest: manifest, task, actionId });
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: (err as Error)?.message ?? String(err) }],
        };
      }
      const channel = `task-${id}`;
      const envMockLogPath = mockLogPath || process.env.QUAY_ACTION_MOCK_LOG || undefined;
      const result = await deliverTrigger({
        root: cfg.workspaceRoot,
        channel,
        payloadObj,
        mockLogPath: envMockLogPath,
      });
      const combined = { ...payloadObj, channel, ...result };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(combined, null, 2) }],
        structuredContent: combined,
      };
    }
  );
}
