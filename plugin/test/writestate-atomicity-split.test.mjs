// @test-group engine
// writestate-atomicity-split.test.mjs — the negative-control test for the atomic state write
// (tasks/gap-writestate-atomicity-split).
//
// AC2: for one of the three pre-migration non-atomic writers, construct a CONCURRENT read that
// pre-migration could observe a torn (half-written) state file and post-migration cannot — the
// tmp+rename atomicity guarantee. The two writers exercised here are the exact two shapes the task
// split: an in-place `fs.writeFileSync` of a large JSON value (the pre-migration non-atomic shape)
// vs `writeJsonAtomic` (tmp + renameSync, the post-migration shape).
//
// Two tests:
//   1. atomic — a concurrent reader never observes a torn file while writeJsonAtomic repeatedly
//      overwrites a large state file. rename(2) atomicity makes this a HARD guarantee (not a
//      timing bet); it goes RED if writeJsonAtomic regresses to an in-place write.
//   2. negative control — the SAME reader DOES observe a torn file against an in-place
//      fs.writeFileSync, proving the reader can bite (the pre-migration premise). Without this,
//      test 1's zero-torn assertion would be vacuous (it could pass only because the reader cannot
//      detect tearing at all).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "../scripts/write-json-atomic.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(__dirname, "..", "scripts", "write-json-atomic.ts");

// Child writer: overwrites `file` in a tight loop for `durationMs` with a large, alternating value.
// mode "atomic" uses writeJsonAtomic (tmp + rename); mode "nonatomic" uses a plain in-place
// fs.writeFileSync (the pre-migration shape). The large payload makes an in-place write observably
// torn to a concurrent reader, which is exactly the split the task eliminates.
const WRITER = `
import fs from "node:fs";
import { writeJsonAtomic } from ${JSON.stringify(MOD)};
const [file, mode, size, durationMs] = process.argv.slice(2);
const payload = "y".repeat(Number(size));
const end = Date.now() + Number(durationMs);
let i = 0;
while (Date.now() < end) {
  const v = { marker: i % 2 ? "B" : "C", payload, n: i };
  if (mode === "atomic") writeJsonAtomic(file, v);
  else fs.writeFileSync(file, JSON.stringify(v) + "\\n", "utf8");
  i++;
}
`;

async function runConcurrentRead(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wjsa-"));
  const file = path.join(dir, "state.json");
  writeJsonAtomic(file, { marker: "A", payload: "init", n: -1 });
  const writerPath = path.join(dir, "writer.mjs");
  fs.writeFileSync(writerPath, WRITER, "utf8");

  const size = 4 * 1024 * 1024; // 4MB — large enough that an in-place write is observably torn
  const durationMs = 1000;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", writerPath, file, mode, String(size), String(durationMs)],
    { stdio: "ignore" }
  );

  const readEnd = Date.now() + durationMs + 150;
  let reads = 0;
  let torn = 0;
  const seen = new Set();
  while (Date.now() < readEnd) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue; // transient: only reachable if the target is momentarily absent (rename race)
    }
    try {
      const v = JSON.parse(raw);
      seen.add(v.marker);
      reads += 1;
    } catch {
      torn += 1;
    }
  }

  const code = await new Promise((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.once("exit", (c) => resolve(c));
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return { reads, torn, seen, code };
}

test("writeJsonAtomic: a concurrent reader never observes a torn state file", async () => {
  const { reads, torn, seen, code } = await runConcurrentRead("atomic");
  assert.equal(code, 0, "writer child must exit cleanly");
  assert.ok(reads > 0, "reader must have made reads during the write window");
  assert.equal(torn, 0, "an atomic write must never expose a torn file");
  assert.ok(
    seen.has("B") && seen.has("C"),
    `reader must observe both written markers (writes actually landed); saw ${[...seen].join(",")}`
  );
});

test("negative control: an in-place writeFileSync IS observably torn to a concurrent reader", async () => {
  const { reads, torn, code } = await runConcurrentRead("nonatomic");
  assert.equal(code, 0, "writer child must exit cleanly");
  assert.ok(reads > 0, "reader must have made reads during the write window");
  assert.ok(torn > 0, "an in-place write must be observably torn (proves the reader can bite)");
});
