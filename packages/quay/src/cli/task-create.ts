// cli/task-create.ts — `quay task create <task-id> --title <title>` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { withProvider, printJson, resolveBody } from "./shared.ts";
import type { CliCtx } from "./context.ts";

export async function handleTaskCreate({ positional, flags, wantsJson }: CliCtx) {
  // M29-cli-create-ergonomics (GAP-001): dedicated Core-CLI `task create`
  // verb. --title is MANDATORY at the CLI-parsing layer — a hard usage
  // error (no provider call made at all) if missing or empty. This is
  // the structural/ergonomic complement to the `task edit` guard below;
  // together they close GAP-002 (see that guard's own comment for the
  // full mechanism trace).
  const id = positional[0];
  if (!id) {
    console.error("quay task create: missing required <id> argument");
    process.exitCode = 1;
    return;
  }
  if (flags.body !== undefined && flags["body-file"] !== undefined) {
    console.error("quay task create: --body and --body-file are mutually exclusive");
    process.exitCode = 1;
    return;
  }
  if (typeof flags.title !== "string" || flags.title.trim() === "") {
    console.error("quay task create: --title <title> is required (and must be non-empty)");
    process.exitCode = 1;
    return;
  }

  const patch: Record<string, unknown> = { title: flags.title };
  if (flags.status !== undefined) patch.status = flags.status;
  if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
  if (flags.parent !== undefined) patch.parent = flags.parent;
  if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
  if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra as string);
  if (flags.body !== undefined || flags["body-file"] !== undefined) {
    patch.body = await resolveBody(flags);
  }
  // gap-cli-write-surface-lacks-toplevel-fields: `task create` shares the `task edit` write
  // surface (同面) — the same top-level `depends_on`/`goal_ac` fields are writable at creation.
  if (flags["depends-on"] !== undefined) patch.depends_on = String(flags["depends-on"]).split(",").filter(Boolean);
  if (flags["goal-ac"] !== undefined) patch.goal_ac = flags["goal-ac"];

  await withProvider(async (client) => {
    // gap-quay-native-task-create-duplicate-id-prepends-frontmatter: `create` must not be a
    // silent upsert. This verb is Core-side and provider-agnostic, so it can only reach the
    // task store through the ABI — and the ABI's `task_write` is an upsert with no create-only
    // flag. Without this check, re-creating an existing id (e.g. a driver re-running a task's
    // "ensure it exists" setup) returned exit 0 while silently re-statusing a settled `done`
    // task to whatever `--status` said — the reported defect (archguard's TASK-TSCONFIG-EXTENDS
    // went `done` -> `todo` under a fresh frontmatter block).
    //
    // Shape: read-then-write, so a concurrent create of the SAME new id can still interleave.
    // That residue is deliberate and bounded: the native Provider's store guards the create path
    // race-free inside its own lock (`AlreadyExistsError` in store.ts#write), and the ABI-level
    // check here is what covers the CLI front door it cannot see. Closing it fully would mean a
    // create-only flag on the Provider ABI itself — a separate change, not this defect's scope.
    const existing = await client.taskGet(id);
    if (existing) {
      console.error(
        `quay task create: task "${id}" already exists — refusing to create it ` +
          `(nothing written; use \`task edit\` / task_write to modify an existing task)`
      );
      process.exitCode = 1;
      return;
    }
    const t = await client.taskWrite({ id, ...patch });
    if (wantsJson) printJson(t);
    else console.log(`${t.id}: ${t.title} [${t.status}]`);
  }, { providerId: flags.provider, root: flags.root });
  return;
}
