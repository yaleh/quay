// @test-group engine
// Tests for drain-scheduler.ts — DIR-071 DRAIN step trigger logic.
// Mirror routine-scheduler.test.mjs test shape: pure-function tests + CLI exit-code tests.
// RED-first (ADR-001 / DIR-019).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDisposition, classifyDirective, dueDirectives, main } from "../scripts/drain-scheduler.ts";

// ── parseDisposition ───────────────────────────────────────────────────────────────────
test("parseDisposition: valid pending directive returns parsed object", () => {
  const task = { id: "DIR-068", title: "Test directive", extra: { dirStatus: "pending" }, labels: ["directive"] };
  const result = parseDisposition(task);
  assert.equal(result.id, "DIR-068");
  assert.equal(result.title, "Test directive");
  assert.equal(result.extra.dirStatus, "pending");
});

test("parseDisposition: non-pending (applied) directive returns null", () => {
  const task = { id: "DIR-068", title: "Done directive", extra: { dirStatus: "applied" } };
  assert.equal(parseDisposition(task), null);
});

test("parseDisposition: non-pending (deferred) directive returns null", () => {
  const task = { id: "DIR-068", title: "Deferred", extra: { dirStatus: "deferred" } };
  assert.equal(parseDisposition(task), null);
});

test("parseDisposition: task with no extra.dirStatus returns null (no dirStatus = not a directive)", () => {
  const task = { id: "DIR-068", title: "No dirStatus", extra: {} };
  assert.equal(parseDisposition(task), null);
});

test("parseDisposition: missing id throws", () => {
  assert.throws(() => parseDisposition({ title: "No id" }), /missing id/);
});

test("parseDisposition: non-object throws", () => {
  assert.throws(() => parseDisposition("nope"), /task must be an object/);
  assert.throws(() => parseDisposition(null), /task must be an object/);
});

test("parseDisposition: directive with no labels defaults to empty array", () => {
  const task = { id: "DIR-068", title: "No labels", extra: { dirStatus: "pending" } };
  const result = parseDisposition(task);
  assert.deepEqual(result.labels, []);
});

// ── classifyDirective ──────────────────────────────────────────────────────────────────
test("classifyDirective: plain pending directive → autonomous", () => {
  const d = { id: "DIR-068", title: "test", extra: {}, labels: ["directive"] };
  assert.equal(classifyDirective(d), "autonomous");
});

test("classifyDirective: missionRedirection: true → human-steered", () => {
  const d = { id: "DIR-069", title: "redirect", extra: { missionRedirection: true }, labels: ["directive"] };
  assert.equal(classifyDirective(d), "human-steered");
});

test("classifyDirective: label:human-steered → human-steered", () => {
  const d = { id: "DIR-070", title: "human", extra: {}, labels: ["directive", "human-steered"] };
  assert.equal(classifyDirective(d), "human-steered");
});

test("classifyDirective: both missionRedirection AND human-steered label → human-steered", () => {
  const d = { id: "DIR-071", title: "both", extra: { missionRedirection: true }, labels: ["directive", "human-steered"] };
  assert.equal(classifyDirective(d), "human-steered");
});

test("classifyDirective: case-insensitive label match", () => {
  const d = { id: "DIR-072", title: "case", extra: {}, labels: ["directive", "Human-Steered"] };
  assert.equal(classifyDirective(d), "human-steered");
});

// ── dueDirectives ──────────────────────────────────────────────────────────────────────
test("dueDirectives: returns only pending directives, classified", () => {
  const tasks = [
    { id: "DIR-068", title: "Fix X", extra: { dirStatus: "pending" }, labels: ["directive"] },
    { id: "DIR-069", title: "Redirect Y", extra: { dirStatus: "pending", missionRedirection: true }, labels: ["directive"] },
    { id: "DIR-060", title: "Already applied", extra: { dirStatus: "applied" }, labels: ["directive"] },
    { id: "TASK-001", title: "Not a directive", extra: {}, labels: ["milestone-candidate"] },
  ];
  const due = dueDirectives(tasks);
  assert.equal(due.length, 2);
  assert.deepEqual(due[0], { id: "DIR-068", title: "Fix X", classification: "autonomous" });
  assert.deepEqual(due[1], { id: "DIR-069", title: "Redirect Y", classification: "human-steered" });
});

test("dueDirectives: empty array returns empty", () => {
  assert.deepEqual(dueDirectives([]), []);
});

test("dueDirectives: non-array returns empty (fail-closed)", () => {
  assert.deepEqual(dueDirectives("nope"), []);
  assert.deepEqual(dueDirectives(null), []);
  assert.deepEqual(dueDirectives(undefined), []);
});

test("dueDirectives: no pending directives returns empty", () => {
  const tasks = [
    { id: "DIR-060", title: "Applied", extra: { dirStatus: "applied" } },
    { id: "DIR-061", title: "Deferred", extra: { dirStatus: "deferred" } },
  ];
  assert.deepEqual(dueDirectives(tasks), []);
});

test("dueDirectives: malformed task entries are silently skipped", () => {
  const tasks = [
    { id: "DIR-068", title: "Valid", extra: { dirStatus: "pending" } },
    null,
    undefined,
    "garbage",
    {},
    { id: "DIR-069", title: "Also valid", extra: { dirStatus: "pending" } },
  ];
  const due = dueDirectives(tasks);
  assert.equal(due.length, 2);
});

test("dueDirectives: human-steered label on pending directive → human-steered classification", () => {
  const tasks = [
    { id: "DIR-070", title: "Human steer", extra: { dirStatus: "pending" }, labels: ["directive", "human-steered"] },
  ];
  const due = dueDirectives(tasks);
  assert.equal(due.length, 1);
  assert.equal(due[0].classification, "human-steered");
});

// ── CLI main ───────────────────────────────────────────────────────────────────────────
test("main: pending directives → exit 0 + prints JSON array", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drain-"));
  const f = path.join(dir, "directives.json");
  fs.writeFileSync(f, JSON.stringify([
    { id: "DIR-068", title: "Fix X", extra: { dirStatus: "pending" }, labels: ["directive"] },
    { id: "DIR-069", title: "Redirect Y", extra: { dirStatus: "pending", missionRedirection: true }, labels: ["directive"] },
  ]));

  let stdout = "";
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { stdout += s; return true; };

  const code = await main(["node", "s", "--json", f]);
  process.stdout.write = origWrite;

  assert.equal(code, 0);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, "DIR-068");
  assert.equal(parsed[0].classification, "autonomous");
  assert.equal(parsed[1].id, "DIR-069");
  assert.equal(parsed[1].classification, "human-steered");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("main: no pending directives → exit 3", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drain-"));
  const f = path.join(dir, "directives.json");
  fs.writeFileSync(f, JSON.stringify([
    { id: "DIR-060", title: "Applied", extra: { dirStatus: "applied" } },
  ]));

  const code = await main(["node", "s", "--json", f]);
  assert.equal(code, 3);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("main: empty array → exit 3", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drain-"));
  const f = path.join(dir, "empty.json");
  fs.writeFileSync(f, "[]");

  const code = await main(["node", "s", "--json", f]);
  assert.equal(code, 3);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("main: missing file → exit 2", async () => {
  const code = await main(["node", "s", "--json", "/tmp/nonexistent-drain-directives.json"]);
  assert.equal(code, 2);
});

test("main: invalid JSON → exit 2", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drain-"));
  const f = path.join(dir, "bad.json");
  fs.writeFileSync(f, "not json");

  const code = await main(["node", "s", "--json", f]);
  assert.equal(code, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("main: no --json flag → exit 2", async () => {
  const code = await main(["node", "s"]);
  assert.equal(code, 2);
});
