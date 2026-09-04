// cli/task-edit.ts — `quay task edit <task-id>` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change (golden-replay
// equivalence verified in packages/quay/test/cli.test.mjs).

import { withProvider, printJson, resolveBody } from "./shared.ts";
import type { CliCtx } from "./context.ts";

export async function handleTaskEdit({ positional, flags, wantsJson }: CliCtx) {
  // QN-024 (iteration 10): generic task_write passthrough, provider-
  // agnostic — same withProvider() path as list/view, zero backend
  // branch. Whether the active Provider actually implements task_write
  // is a Provider-manifest question (data.write capability), not
  // something this command special-cases.
  //
  // M16-cli-edit-parity-impl (design doc §1.2): relaxed from status-only
  // to full-field parity with the native provider CLI's own `task edit`
  // flag surface — --title/--body/--body-file/--labels/--extra/--parent/
  // --children/--expect-status/--append-notes. `--status` is no longer
  // solely required; the guard below now requires at least one
  // patch-producing flag instead.
  //
  // M31-cli-gate-enforcement: this handler's status-transition write is,
  // by design, UNGUARDED by default — it does not consult `task check`'s
  // gate logic before writing, analogous to `git commit --no-verify`.
  // `task edit` is a low-level, provider-agnostic primitive (the generic
  // taskWrite passthrough); a caller who wants gate enforcement opts in
  // explicitly via --enforce-gate, which calls the SAME client.taskCheck(id)
  // logic `task check` uses (no duplicated gate logic) before the write,
  // and refuses (exit 1, no write) if result.ok === false. This was a
  // deliberate charter-time decision (option (b) hard-block-by-default was
  // explicitly rejected: an unknown number of existing callers may rely on
  // being able to force a transition past a gate they've manually verified
  // is safe to bypass) — see charter's "Decision" section for the full
  // reasoning: the M31-cli-gate-enforcement design record. A future reader should not have to
  // re-derive this from scratch.
  const id = positional[0];
  const enforceGate = flags["enforce-gate"] !== undefined;

  if (flags.body !== undefined && flags["body-file"] !== undefined) {
    console.error("quay task edit: --body and --body-file are mutually exclusive");
    process.exitCode = 1;
    return;
  }

  // QENG-2: --acceptance sets extra.acceptance (a runnable meter). Syntactic
  // type check runs here (before withProvider), because the "at least one
  // patch-producing flag" guard below runs before the provider callback too;
  // the actual read-merge-write needs client.taskGet and so happens INSIDE
  // withProvider (proposal §2 / review note 1). A bare `--acceptance` (no
  // value) parses to boolean true and is rejected here.
  if (flags.acceptance !== undefined
      && typeof flags.acceptance !== "string" && !Array.isArray(flags.acceptance)) {
    console.error("quay task edit: --acceptance requires a command string");
    process.exitCode = 1;
    return;
  }

  const patch: Record<string, unknown> = {};
  if (flags.title !== undefined) patch.title = flags.title;
  if (flags.status !== undefined) patch.status = flags.status;
  if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
  if (flags.parent !== undefined) patch.parent = flags.parent;
  if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
  if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra as string);
  if (flags.body !== undefined || flags["body-file"] !== undefined) {
    patch.body = await resolveBody(flags);
  }
  if (flags["expect-status"] !== undefined) patch.expectedStatus = flags["expect-status"];

  if (Object.keys(patch).length === 0 && flags["append-notes"] === undefined
      && flags.acceptance === undefined) {
    console.error(
      "quay task edit: at least one of --title/--status/--body/--body-file/--labels/--extra/" +
      "--parent/--children/--acceptance/--append-notes is required"
    );
    process.exitCode = 1;
    return;
  }

  await withProvider(async (client) => {
    // M31-cli-gate-enforcement (charter Decision section): `task edit
    // --status` is, and remains, UNGUARDED by default — a deliberate
    // low-level write primitive analogous to `git commit --no-verify`,
    // not a process-gate-enforcing command. This was a considered
    // rejection of hard-block-by-default (option a in the charter),
    // because flipping the default would be a breaking change to an
    // already-shipped CLI surface with an unknown number of external
    // callers (scripts, other agents' Skill-level automation) that may
    // rely on being able to force a status transition. `--enforce-gate`
    // is the additive, opt-in escape hatch for callers who DO want
    // enforcement: it calls the exact same `client.taskCheck(id)` path
    // `task check` uses (no duplicated gate logic) and refuses the write
    // if the gate fails. Only fires when the patch includes a `status`
    // field — Done-when clause 4, option (b): a non-status patch (e.g.
    // --labels only) with --enforce-gate present is a deliberate no-op
    // guard-check, not a check against irrelevant/stale gate state.
    // Placed here, BEFORE the --append-notes branch below, so a
    // combined --append-notes + --status write is also gated — the
    // gate's purpose (don't let a status transition slip past `task
    // check`) applies regardless of which code path performs the write.
    // See the M31-cli-gate-enforcement design record for the full reasoning.
    if (enforceGate && patch.status !== undefined) {
      const gateResult = await client.taskCheck(id);
      if (gateResult.ok === false) {
        console.error(
          `quay task edit: --enforce-gate refused this write — gate check failed: ${gateResult.reason}`
        );
        process.exitCode = 1;
        return;
      }
    }
    // M16-cli-edit-parity-impl (design doc §4 non-goals): --append-notes
    // is a Core-CLI-side read-then-write convenience, not a new ABI tool
    // — read the current body via taskGet, append the note text, then
    // taskWrite the whole new body. No native `appendNote` ABI passthrough
    // is introduced (mirrors the native CLI's own scope discipline; see
    // design doc §4's explicit non-goal).
    if (flags["append-notes"] !== undefined) {
      const current = await client.taskGet(id);
      if (!current) {
        console.error(`no such task: ${id}`);
        process.exitCode = 1;
        return;
      }
      const noteText = String(flags["append-notes"]);
      const newBody = `${current.body ?? ""}\n\n${noteText}`;
      const t = await client.taskWrite({ id, ...patch, body: newBody });
      if (wantsJson) printJson(t);
      else console.log(`${t.id}: ${t.title} [${t.status}] (note appended)`);
      return;
    }
    // M29-cli-create-ergonomics (GAP-002 fix): task edit's own contract is
    // "patch an EXISTING task" — the actual silent-corruption failure mode
    // (M27-competitive-bench's most severe finding) is specific to editing
    // a NON-EXISTENT id with no (usable) --title, which reaches the native
    // provider's store.js#write() upsert-as-create path with title
    // `undefined` and silently omits the title key from the serialized
    // frontmatter (YAML.stringify drops undefined-valued keys). Guard:
    // read-before-write via taskGet — if the id does not currently exist
    // AND no non-empty --title was supplied, refuse with a clear usage
    // error instead of silently upserting a titleless (or, per iteration-1's
    // own skepticism-pass finding, empty-titled) record. This covers every
    // non-title flag combination (--status/--body/--labels/--parent/
    // --children/--extra/--expect-status), not just the --status-only
    // shape M27 happened to reproduce, because the guard fires on the
    // (missing-or-empty-title, non-existent-id) precondition alone,
    // independent of which other flags were supplied.
    //
    // Empty-string --title check added independently by iteration-1 after
    // discovering `task edit <new-id> --title "" --status todo` slipped
    // past a title!==undefined-only guard and wrote `title: ""` — a
    // different but sibling degenerate-title defect to GAP-002's literal
    // "no title key at all" symptom, closed here under the same guard for
    // consistency with `task create`'s own empty-title rejection above.
    if (patch.title === undefined || String(patch.title).trim() === "") {
      const existing = await client.taskGet(id);
      if (!existing) {
        console.error(
          `quay task edit: task ${id} does not exist yet; creating a new task requires ` +
          `--title (or use 'quay task create')`
        );
        process.exitCode = 1;
        return;
      }
    }
    // QENG-2 (proposal §2, review note 1): read-merge-write extra.acceptance
    // INSIDE withProvider (needs client.taskGet). A list value is joined with
    // `&&` so the stored value is always one string the acceptance gate runs
    // as-is. Merge preserves other extra keys and any --extra patch.
    if (flags.acceptance !== undefined) {
      const cmd = Array.isArray(flags.acceptance) ? flags.acceptance.join(" && ") : flags.acceptance;
      const current = await client.taskGet(id);
      patch.extra = { ...(current?.extra ?? {}), ...((patch.extra ?? {}) as Record<string, unknown>), acceptance: cmd };
    }
    const t = await client.taskWrite({ id, ...patch });
    if (wantsJson) printJson(t);
    else console.log(`${t.id}: ${t.title} [${t.status}]`);
  }, { providerId: flags.provider, root: flags.root });
  return;
}
