// @test-group product
// kernel-proc-identity.test.mjs — the kernel leaf `packages/quay/src/kernel/proc-identity.ts`
// (gap-judgment-rewrites-route-through-proc-identity-leaf).
//
// WHAT THIS FILE IS FOR: that task routed ~6 hand-rolled `/proc/<pid>/cmdline` reads through the leaf,
// and its AC3 requires the migration be proven NOT to have折损 the failure value. The risk being
// pinned is 硬规则 3b: "readable-but-empty" and "could not read" are DIFFERENT states, and folding
// them into one value turns "could not tell" into "does not match".
//
// The leaf therefore has TWO read forms and this file pins both, in both directions:
//   · `readProcCmdline`     — argv;  unreadable ⇒ null,  readable-but-empty ⇒ null  (callers recognise
//                             an invocation: an empty argv must never be read as "matches nothing").
//   · `readProcCmdlineText` — text;  unreadable ⇒ null,  readable-but-empty ⇒ ""    (a MEASUREMENT).
//   ⇒ the reverse assertion AC3 asks for: the leaf's null path still returns null, NOT `[]` — and the
//     "" path is still distinguishable from it (an implementation that folded them would go red on
//     the pair below, in whichever direction it folded).
//
// Every fixture is a temp procRoot (the same injection seam the mechanism layer's tests use), so the
// unreadable / empty / normal branches are exercised deterministically — never against live /proc.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readProcCmdline,
  readProcCmdlineText,
  isQuayServe,
} from "../src/kernel/proc-identity.ts";

const _createdDirs = [];
function mktmp(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proc-identity-test-"));
  _createdDirs.push(dir);
  for (const [rel, data] of Object.entries(contents)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  return dir;
}

/** A fake procRoot whose only pid is 4242 with the given raw cmdline bytes. */
function procRootWith(raw) {
  return mktmp({ "4242/cmdline": raw });
}

const PID = 4242;

test("readProcCmdline — NUL-separated argv, trailing empty field dropped", () => {
  const root = procRootWith("node\0/app/worker.ts\0--task\0gap-x\0");
  assert.deepEqual(readProcCmdline(PID, root), ["node", "/app/worker.ts", "--task", "gap-x"]);
  // 空参数是【有内容】的 argv 元素 (foo "" bar) —— 只有【结尾】那个 NUL 产生的空字段被丢弃。
  const withEmptyArg = procRootWith("node\0\0bar\0");
  assert.deepEqual(readProcCmdline(PID, withEmptyArg), ["node", "", "bar"]);
});

test("AC3 反向断言 — 读不成的路径仍返回 null, 不是 [] (硬规则 3b)", () => {
  const root = procRootWith("node\0x\0");
  // pid 条目不存在 ⇒ 读不成
  assert.equal(readProcCmdline(999999999, root), null, "a missing pid entry is 'could not read' — null, never []");
  assert.equal(readProcCmdlineText(999999999, root), null, "the text form agrees: null");
  // 整个 procRoot 不存在 ⇒ 读不成 (不是「扫过且无进程」)
  assert.equal(readProcCmdline(999999999, path.join(root, "nonexistent")), null);
  // 关键对照: null ≠ [] —— [] 是「读到了、但没有参数」, 两者不得同形
  assert.notDeepEqual(readProcCmdline(999999999, root), [], "null must NOT be reported as the empty argv");
});

test("AC3 — 读到了但空 (僵尸) 与读不成是两个取值: Text ⇒ \"\", argv ⇒ null", () => {
  const root = procRootWith("");
  assert.equal(readProcCmdlineText(PID, root), "", "a readable-but-empty cmdline is a MEASUREMENT: \"\"");
  assert.equal(readProcCmdline(PID, root), null, "the argv form collapses empty→null (callers must not read it as 'matches nothing')");
  assert.notEqual(readProcCmdlineText(PID, root), readProcCmdline(PID, root), "the two forms must stay distinguishable");
});

test("readProcCmdlineText — NUL→空格, 不 trim (trim 是调用点的口径)", () => {
  // 结尾 NUL ⇒ 尾随空格【保留】: 这正是迁移前各调用点 `raw.replace(/\0/g, " ")` 的逐字行为
  // (只想比子串的调用点不受影响; 需要干净结尾的调用点自己 .trim()，如 worker-driver)。
  assert.equal(readProcCmdlineText(PID, procRootWith("node\0/a b.ts\0")), "node /a b.ts ");
  // 中间的空 argv 元素 ⇒ join 出两个连续空格（同样与 replace(/\0/g, " ") 逐字一致）
  assert.equal(readProcCmdlineText(PID, procRootWith("node\0\0bar\0")), "node  bar ");
  assert.equal(readProcCmdlineText(PID, procRootWith("node\0")).trim(), "node", "调用点 trim 后得到干净值");
});

test("reader 缝 — send-to-session 的 readFile 形态 (返回 string|null) 可原样传入", () => {
  const calls = [];
  const reader = (p) => {
    calls.push(p);
    if (p.endsWith("/777/cmdline")) return null; // 读不成
    if (p.endsWith("/888/cmdline")) return ""; // 读到了但空
    return "node\0/a/x.ts\0";
  };
  assert.equal(readProcCmdline(777, "/proc", reader), null, "reader returning null ⇒ 'could not read'");
  assert.equal(readProcCmdline(888, "/proc", reader), null, "reader returning \"\" ⇒ argv form collapses to null");
  assert.equal(readProcCmdlineText(888, "/proc", reader), "", "…but the text form keeps the measurement");
  assert.deepEqual(readProcCmdline(999, "/proc", reader), ["node", "/a/x.ts"]);
  // 缝收到的路径仍是 `/proc/<pid>/cmdline` —— 既有单测按【路径】注入的接缝不受迁移影响
  assert.deepEqual(calls, ["/proc/777/cmdline", "/proc/888/cmdline", "/proc/888/cmdline", "/proc/999/cmdline"]);
});

test("reader 抛异常 = 读不成 (不是崩溃): 与迁移前调用点的 try/catch 同语义", () => {
  const thrower = () => {
    throw new Error("EACCES");
  };
  assert.equal(readProcCmdline(PID, "/proc", thrower), null);
  assert.equal(readProcCmdlineText(PID, "/proc", thrower), null);
});

test("真 /proc 读数 — 本进程自己的 argv 可读, 且 argv[0] 非空 (迁移没有把真读也弄坏)", () => {
  const argv = readProcCmdline(process.pid);
  assert.ok(Array.isArray(argv) && argv.length > 0, `live /proc read must return argv, got ${JSON.stringify(argv)}`);
  assert.ok((argv[0] ?? "").length > 0, "argv[0] of a live process is non-empty");
  const text = readProcCmdlineText(process.pid);
  assert.ok(typeof text === "string" && text.length > 0, "the live text form is a non-empty string");
});

test("isQuayServe — 未受迁移影响 (两族入口 + serve 参数)", () => {
  assert.equal(isQuayServe(["node", "/x/packages/quay/bin/quay.ts", "serve", "--port", "1"]), true);
  assert.equal(isQuayServe(["node", "/x/packages/quay/bin/quay.js", "serve"]), true);
  assert.equal(isQuayServe(["node", "/x/packages/quay/bin/quay.ts", "task", "list"]), false);
  // null (读不成) ⇒ false, 且调用方必须把它当【自己的状态】而不是这个 false
  assert.equal(isQuayServe(null), false);
  assert.equal(isQuayServe([]), false);
});

after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});
