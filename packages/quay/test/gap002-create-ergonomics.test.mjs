// @test-group product
// M29-cli-create-ergonomics, iteration-1 (independent re-derivation).
//
// This file is written from scratch by iteration-1, without reading
// iteration-0's test file, to independently reproduce and then close
// GAP-002 (Core CLI `task edit <new-id> --status todo`, no `--title`,
// silently upserts a titleless task record) and GAP-001 (no dedicated
// `task create` verb at the Core CLI layer), plus verify the G-02 help-text
// fix. See charter: experiments/quay-perpetual-stream/charters/
// M29-cli-create-ergonomics.md for the full mechanism description.
//
// Scratch-store discipline: every probe here uses its own disposable
// mkdtemp() workspace + QUAY_NATIVE_TASKS_DIR-pointed tasks dir. The real
// repo-root tasks/ directory is never touched by this file.
//
// Run: node --test packages/quay/test/gap002-create-ergonomics.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// Builds a fresh, disposable workspace with a .quay/config.yml pointing its
// native provider at a throwaway tasks dir. Returns { workspaceRoot, tasksDir }.
function makeWorkspace(tag) {
  return makeTmpWorkspace(`quay-m29-it1-${tag}`, { nativeBin, nativeProviderDir });
}

function runQuay(args, cwd) {
  try {
    const out = execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

// ---------------------------------------------------------------------
// (a) Independent RED reproduction of GAP-002's exact mechanism: `task
// edit <new-id> --status todo`, no --title, on an id that does not yet
// exist in the store.
// ---------------------------------------------------------------------
test("GAP-002 exact shape: task edit <new-id> --status todo (no --title) must not silently upsert a titleless record", () => {
  const { workspaceRoot } = makeWorkspace("exact");
  const r = runQuay(["task", "edit", "GAP2-EXACT-1", "--status", "todo", "--json"], workspaceRoot);

  // Post-fix expectation: hard refusal, non-zero exit, no task written.
  // (Pre-fix, this iteration confirmed status===0 with a corrupted record —
  // see iteration-1 report §skepticism for the raw RED evidence captured
  // before the fix was applied.)
  assert.notEqual(r.status, 0, `expected non-zero exit refusing the titleless create; got exit=${r.status}, stdout=${r.stdout}`);

  const view = runQuay(["task", "view", "GAP2-EXACT-1", "--json"], workspaceRoot);
  assert.notEqual(view.status, 0, `task must not have been created at all; task view exit=${view.status}, stdout=${view.stdout}`);
});

// ---------------------------------------------------------------------
// (b)/(h) Variant reproduction shapes — a fix narrowly patched to the
// --status-only shape M27 happened to use might still leave siblings
// vulnerable. Try --body-only, --labels-only, and no-flags-at-all (empty
// patch guard interacts differently) on non-existent ids.
// ---------------------------------------------------------------------
test("variant: task edit <new-id> --body-only (no --title, no --status) on non-existent id must also refuse", () => {
  const { workspaceRoot } = makeWorkspace("variant-body");
  const r = runQuay(["task", "edit", "GAP2-VARIANT-BODY-1", "--body", "some body text", "--json"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected refusal; got exit=${r.status}, stdout=${r.stdout}`);
  const view = runQuay(["task", "view", "GAP2-VARIANT-BODY-1", "--json"], workspaceRoot);
  assert.notEqual(view.status, 0, "task must not exist after refused --body-only create-via-edit");
});

test("variant: task edit <new-id> --labels-only (no --title) on non-existent id must also refuse", () => {
  const { workspaceRoot } = makeWorkspace("variant-labels");
  const r = runQuay(["task", "edit", "GAP2-VARIANT-LABELS-1", "--labels", "a,b", "--json"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected refusal; got exit=${r.status}, stdout=${r.stdout}`);
  const view = runQuay(["task", "view", "GAP2-VARIANT-LABELS-1", "--json"], workspaceRoot);
  assert.notEqual(view.status, 0, "task must not exist after refused --labels-only create-via-edit");
});

test("variant: task edit <new-id> --parent-only (no --title) on non-existent id must also refuse", () => {
  const { workspaceRoot } = makeWorkspace("variant-parent");
  const r = runQuay(["task", "edit", "GAP2-VARIANT-PARENT-1", "--parent", "SOME-1", "--json"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected refusal; got exit=${r.status}, stdout=${r.stdout}`);
});

test("variant: task edit <new-id> --extra-only (no --title) on non-existent id must also refuse", () => {
  const { workspaceRoot } = makeWorkspace("variant-extra");
  const r = runQuay(["task", "edit", "GAP2-VARIANT-EXTRA-1", "--extra", JSON.stringify({ k: "v" }), "--json"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected refusal; got exit=${r.status}, stdout=${r.stdout}`);
});

test("variant: task edit <new-id> --append-notes-only (no --title) on non-existent id must also refuse", () => {
  const { workspaceRoot } = makeWorkspace("variant-notes");
  const r = runQuay(["task", "edit", "GAP2-VARIANT-NOTES-1", "--append-notes", "a note", "--json"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected refusal (append-notes on a non-existent id has its own 'no such task' guard already; confirming it still holds); got exit=${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
});

// (h) Deep-look finding, added after independent post-fix probing: an
// EMPTY-STRING --title (not merely a missing --title) on a non-existent id
// must also be refused — patch.title !== undefined alone is not a
// sufficient guard, since "" is a defined-but-useless title and would
// otherwise slip past a naive `title === undefined` check and silently
// write `title: ""` (a sibling degenerate-title defect to GAP-002's
// literal "no title key" symptom).
test("deep-look: task edit <new-id> --title \"\" (empty string) --status todo on non-existent id must also refuse, not just missing --title", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("deep-empty-title");
  const r = runQuay(["task", "edit", "GAP2-DEEP-EMPTYTITLE-1", "--title", "", "--status", "todo", "--json"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected refusal for empty-string --title on create-via-edit; got exit=${r.status}, stdout=${r.stdout}`);
  const filesWritten = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir) : [];
  assert.equal(filesWritten.length, 0, `expected no files written; found: ${JSON.stringify(filesWritten)}`);
});

// Control: task edit on a non-existent id WITH --title should be allowed
// (this is the legitimate create-via-upsert path the fix must not break).
test("control: task edit <new-id> --title <t> --status todo on non-existent id is allowed (create-via-upsert with title)", () => {
  const { workspaceRoot } = makeWorkspace("control-with-title");
  const r = runQuay(["task", "edit", "GAP2-CONTROL-1", "--title", "Real Title", "--status", "todo", "--json"], workspaceRoot);
  assert.equal(r.status, 0, `expected success when --title is supplied; got exit=${r.status}, stderr=${r.stderr}`);
  const t = JSON.parse(r.stdout);
  assert.equal(t.title, "Real Title");
});

// Control: task edit on an EXISTING id with no --title must still work
// (the guard must be existence-gated, not an unconditional --title
// requirement for all edits).
test("control: task edit <existing-id> --status done (no --title) still works (guard is existence-gated only)", () => {
  const { workspaceRoot } = makeWorkspace("control-existing");
  const create = runQuay(["task", "edit", "GAP2-EXISTING-1", "--title", "Seed", "--status", "todo", "--json"], workspaceRoot);
  assert.equal(create.status, 0, `seed create failed: ${create.stderr}`);
  const r = runQuay(["task", "edit", "GAP2-EXISTING-1", "--status", "done", "--json"], workspaceRoot);
  assert.equal(r.status, 0, `expected success editing an existing task without --title; got exit=${r.status}, stderr=${r.stderr}`);
  const t = JSON.parse(r.stdout);
  assert.equal(t.status, "done");
});

// ---------------------------------------------------------------------
// (c) New `quay task create` verb — GAP-001 structural fix. Hard usage
// error, no provider call, if --title missing or empty.
// ---------------------------------------------------------------------
test("task create <id> --title <title> succeeds and produces a real title", () => {
  const { workspaceRoot } = makeWorkspace("create-ok");
  const r = runQuay(["task", "create", "GAP2-CREATE-1", "--title", "Created via new verb", "--json"], workspaceRoot);
  assert.equal(r.status, 0, `expected success; got exit=${r.status}, stderr=${r.stderr}`);
  const t = JSON.parse(r.stdout);
  assert.equal(t.title, "Created via new verb");
});

test("task create <id> with no --title hard-fails (usage error, no provider call, no file written)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("create-no-title");
  const r = runQuay(["task", "create", "GAP2-CREATE-NOTITLE-1"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected failure; got exit=${r.status}, stdout=${r.stdout}`);
  // No provider call: nothing written to the scratch tasks dir at all.
  const filesWritten = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir) : [];
  assert.equal(filesWritten.length, 0, `expected no files written to tasks dir; found: ${JSON.stringify(filesWritten)}`);
});

test("task create <id> with empty --title (\"\") hard-fails, not just missing --title", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("create-empty-title");
  const r = runQuay(["task", "create", "GAP2-CREATE-EMPTYTITLE-1", "--title", ""], workspaceRoot);
  assert.notEqual(r.status, 0, `expected failure for empty --title; got exit=${r.status}, stdout=${r.stdout}`);
  const filesWritten = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir) : [];
  assert.equal(filesWritten.length, 0, `expected no files written for empty-title create; found: ${JSON.stringify(filesWritten)}`);
});

// ---------------------------------------------------------------------
// (d) G-02: --help text must list task edit's real flag surface + the new
// task create verb.
// ---------------------------------------------------------------------
test("--help lists task edit's full flag surface and the new task create verb", () => {
  const out = execFileSync("node", [quayBin, "--help"], { encoding: "utf8" });
  for (const flag of [
    "--title", "--body", "--body-file", "--labels", "--extra",
    "--parent", "--children", "--expect-status", "--append-notes",
  ]) {
    assert.ok(out.includes(flag), `--help output missing flag ${flag}\n---\n${out}`);
  }
  assert.ok(/task create/.test(out), `--help output missing the new "task create" verb\n---\n${out}`);
});
