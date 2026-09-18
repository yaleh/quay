// @test-group product
// gap-sessions-page-slow-unclickable-flat-render — three defects on the /sessions list + /session/<id>
// detail page, fixed in stage one:
//   AC1  cards were bare <div>s with no link; the detail page already existed but the list never
//        linked to it → cardFor now wraps in <a href="/session/<id>">.
//   AC2  the list eagerly read every GONE session's 200 KB transcript tail (up to ~20 × 200 KB) →
//        readSessions skips the GONE tail (messages:null) and the GONE cards fold into a collapsed
//        <details>; only LIVE cards render by default.
//   AC3  the detail page flattened the whole 2 MB tail → it now renders only the most recent
//        SESSION_VIEW_INITIAL_TURNS turns and lazy-loads earlier turns on scroll via /session/<id>/earlier.
//
// These are user-visible web contracts ⇒ `product` group. All assertions are "能取假": the fake shape
// (bare <div>, fully-rendered GONE, fully-flattened transcript) must FAIL them.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readTranscript, SESSION_VIEW_INITIAL_TURNS, SESSION_VIEW_EARLIER_CHUNK } from "../src/observation.ts";
import { renderSessionsPage, renderSessionPage, earlierTurnsChunk, handleSessionEarlier } from "../src/serve-handlers.ts";

const LIVE_ID = "11111111-1111-4111-8111-111111111111";
const GONE_ID = "22222222-2222-4222-8222-222222222222";

function textTurn(role, text) {
  return { time: "2026-08-25T00:00:00Z", role, blocks: [{ kind: "text", text }] };
}

function viewFor(turns, truncated = false) {
  return { status: "ok", reason: null, sessionId: LIVE_ID, transcriptPath: "/x.jsonl", turns, truncated };
}

function sessionsResult() {
  return {
    status: "ok",
    reason: null,
    sessions: [
      { name: "outer", sessionId: LIVE_ID, layer: "Outer", alive: true, pid: 123, halted: false, transcriptStatus: "ok", transcriptReason: null, messages: [{ time: "t", role: "assistant", text: "hello live" }] },
      { name: GONE_ID, sessionId: GONE_ID, layer: "Outer", alive: false, pid: null, halted: false, transcriptStatus: "empty", transcriptReason: "GONE — transcript 在详情页按需读取", messages: null },
    ],
  };
}

function mockRes() {
  let status = 0;
  let body = "";
  return {
    writeHead: (s) => { status = s; },
    end: (b) => { body = String(b); },
    get statusCode() { return status; },
    get bodyText() { return body; },
  };
}

test("AC1: every card (LIVE and GONE) links to its /session/<id> detail page", () => {
  const html = renderSessionsPage(sessionsResult());
  assert(html.includes(`href="/session/${LIVE_ID}"`), "LIVE card is a link to the detail page");
  assert(html.includes(`href="/session/${GONE_ID}"`), "GONE card is a link to the detail page");
});

test("AC2: GONE cards fold into a collapsed <details>; LIVE cards render outside it by default", () => {
  // gap-webui-sessions-body-copy-en-zh: the summary and the deferred-read hint are now DICTIONARY
  // rows (serve-i18n.ts ROW 15), and `renderSessionsPage`'s default is `en`. The arms below pin the
  // CHINESE copy, so this render is asked for `zh` EXPLICITLY — the assertion's subject is the
  // structural fold plus the words it carries, and an unstated default would silently re-point it
  // at the en column the next time a default moves.
  const html = renderSessionsPage(sessionsResult(), null, "zh");
  const liveIdx = html.indexOf(`href="/session/${LIVE_ID}"`);
  const goneIdx = html.indexOf(`href="/session/${GONE_ID}"`);
  // The GONE fold's opening tag is the marker (the inlined CSS also mentions the literal "<details>"
  // in a comment, so a bare indexOf("<details") would false-match the <style> block).
  const detailsIdx = html.indexOf(`<details style="margin-top:0.75rem"`);
  assert(detailsIdx !== -1, "a GONE <details> fold is present");
  assert(liveIdx < detailsIdx, "LIVE card is rendered OUTSIDE the <details> (default-rendered)");
  assert(goneIdx > detailsIdx, "GONE card is INSIDE the collapsed <details>");
  assert(html.includes("已结束会话（GONE · 1）"), "the <details> summary names the GONE count");
  const goneSection = html.slice(detailsIdx, html.indexOf("</details>", detailsIdx));
  assert(!goneSection.includes("hello live"), "the GONE fold contains no transcript message preview (tail not read)");
  assert(goneSection.includes("transcript 在详情页按需读取"), "GONE card shows a deferred-read hint, not a 200KB tail preview");
});

test("AC3: detail page renders only the most recent N turns and arms the scroll loader", () => {
  const turns = Array.from({ length: 80 }, (_, i) => textTurn("user", `msg-${String(i).padStart(3, "0")}`));
  const html = renderSessionPage(viewFor(turns));
  assert(html.includes("msg-079"), "most recent turn rendered");
  assert(html.includes("msg-050"), "first of the recent 30 rendered");
  assert(!html.includes("msg-049"), "older turn NOT rendered by default (no full flatten)");
  assert(!html.includes("msg-000"), "oldest turn NOT rendered by default");
  assert(html.includes(`data-total="80"`), "data-total reflects the full turn count");
  assert(html.includes(`data-rendered="${SESSION_VIEW_INITIAL_TURNS}"`), "data-rendered reflects the recent-N default");
  assert(html.includes("tx-earlier-sentinel"), "scroll sentinel present");
  assert(html.includes("<script>"), "scroll loader script present");
  assert(html.includes("/earlier?before="), "loader fetches the on-demand earlier endpoint");
});

test("AC3: detail page with <= N turns renders everything with no scroll loader", () => {
  const turns = Array.from({ length: 5 }, (_, i) => textTurn("user", `msg-${String(i).padStart(3, "0")}`));
  const html = renderSessionPage(viewFor(turns));
  assert(html.includes("msg-000"), "all turns rendered when fewer than N");
  assert(html.includes("msg-004"));
  assert(!html.includes("tx-earlier-sentinel"), "no sentinel when nothing to lazy-load");
  assert(!html.includes("<script>"), "no script when nothing to lazy-load");
});

test("AC3: truncated=true arms the loader even when the read window's turns are all rendered", () => {
  const turns = Array.from({ length: 5 }, (_, i) => textTurn("user", `msg-${String(i).padStart(3, "0")}`));
  const html = renderSessionPage(viewFor(turns, true));
  assert(html.includes("tx-earlier-sentinel"));
  assert(html.includes("<script>"));
  assert(html.includes('data-truncated="true"'));
});

test("AC3: readTranscript reports truncated=true when the file is larger than the read window", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-trunc-"));
  const p = path.join(dir, "s.jsonl");
  try {
    const big = "x".repeat(2000);
    const small = JSON.stringify({ type: "user", timestamp: "2026-08-25T00:00:00Z", message: { role: "user", content: "hi" } });
    fs.writeFileSync(p, `${big}\n${small}\n`);
    const within = readTranscript(p, 500); // window smaller than the file ⇒ older bytes exist
    assert.equal(within.truncated, true);
    const full = readTranscript(p, 100_000); // window covers the whole file ⇒ nothing truncated
    assert.equal(full.truncated, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3: earlierTurnsChunk returns the chunk immediately before the already-rendered turns", () => {
  const turns = Array.from({ length: 80 }, (_, i) => textTurn("user", `msg-${String(i).padStart(3, "0")}`));
  const chunk = earlierTurnsChunk(turns, 30);
  assert.equal(chunk.length, SESSION_VIEW_EARLIER_CHUNK, "one chunk of the fixed earlier-chunk size");
  assert.equal(chunk[0].blocks[0].text, "msg-000", "chunk starts at the oldest turn in the window");
  assert.equal(chunk[chunk.length - 1].blocks[0].text, "msg-049", "chunk ends right before the rendered recent turns");
  assert.equal(earlierTurnsChunk(turns, 80).length, 0, "before >= total ⇒ nothing earlier");
  const small = earlierTurnsChunk(turns.slice(0, 5), 3);
  assert.equal(small.length, 2, "a short transcript returns only the turns before `before`");
});

test("AC3: /session/<id>/earlier rejects a non-UUID sessionId with 400 (no disk read)", async () => {
  const res = mockRes();
  await handleSessionEarlier({}, res, { workspaceRoot: "/tmp/whatever" }, "not-a-uuid", new URL("http://x/session/not-a-uuid/earlier?before=10"));
  assert.equal(res.statusCode, 400);
  const data = JSON.parse(res.bodyText);
  assert.equal(data.count, 0);
  assert.equal(data.truncated, false);
});
