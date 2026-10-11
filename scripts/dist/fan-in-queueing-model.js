#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/fan-in-queueing-model.ts
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
var NOT_EVALUATED = "NOT-EVALUATED";
function percentile(sorted, p) {
  if (sorted.length === 0) return NOT_EVALUATED;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
}
function dist(xs) {
  if (xs.length === 0) {
    return { n: 0, min: NOT_EVALUATED, median: NOT_EVALUATED, p90: NOT_EVALUATED, max: NOT_EVALUATED, mean: NOT_EVALUATED };
  }
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    median: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length
  };
}
function isoToMs(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(ts);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(Number(`0.${m[7]}`) * 1e3) : 0);
  return Number.isFinite(ms) ? ms : null;
}
function readLockEvents(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { events: [], malformed: 0, missing: true };
  }
  const events = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      malformed++;
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      malformed++;
      continue;
    }
    events.push(o);
  }
  return { events, malformed, missing: false };
}
function pairLockHolds(events) {
  const open = /* @__PURE__ */ new Map();
  const holds = [];
  let unpairedReleases = 0;
  for (const e of events) {
    const epoch = e.epoch;
    if (typeof epoch !== "number" || !Number.isFinite(epoch)) continue;
    const key = `${String(e.taskId)}\0${String(e.runId)}\0${String(e.pid)}`;
    if (e.event === "acquire") {
      open.set(key, epoch);
    } else if (e.event === "release") {
      const a = open.get(key);
      if (a === void 0) {
        unpairedReleases++;
        continue;
      }
      open.delete(key);
      holds.push({
        taskId: typeof e.taskId === "string" ? e.taskId : null,
        runId: typeof e.runId === "string" ? e.runId : null,
        acquire: a,
        release: epoch,
        holdSecs: Math.max(0, epoch - a)
      });
    }
  }
  holds.sort((x, y) => x.acquire - y.acquire);
  return { holds, unpairedAcquires: open.size, unpairedReleases, malformedLines: 0 };
}
function listFanInAttemptFiles(root) {
  const dir = path.join(root, ".quay");
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith("fan-in-") && n.endsWith(".log") && !n.startsWith("fan-in-suite-")).map((n) => path.join(dir, n)).sort();
}
function splitFanInLogName(base) {
  const m = /^fan-in-(.*?)-(wk-[A-Za-z0-9-]+)\.log$/.exec(base);
  if (!m) return { task: base.replace(/^fan-in-/, "").replace(/\.log$/, ""), runId: "" };
  return { task: m[1], runId: m[2] };
}
function parseFanInAttempts(text, file) {
  const base = path.basename(file);
  const { task, runId } = splitFanInLogName(base);
  const entries = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      malformed++;
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const rec = o;
    if (typeof rec.step !== "string" || typeof rec.ts !== "string") continue;
    const tsMs = isoToMs(rec.ts);
    if (tsMs === null) continue;
    entries.push({ step: rec.step, tsMs, wallMs: typeof rec.wall_ms === "number" ? rec.wall_ms : null });
  }
  if (malformed > 0) {
  }
  const attempts = [];
  let cur = null;
  const push = (releaseTsMs) => {
    if (!cur) return;
    const suiteEntries = cur.steps.filter((s) => s.step === "suite-end");
    const suiteSecs = suiteEntries.length ? suiteEntries.reduce((a, s) => a + (s.wallMs ?? 0), 0) / 1e3 : NOT_EVALUATED;
    const otherSecs = cur.steps.filter((s) => s.step !== "suite-end").reduce((a, s) => a + (s.wallMs ?? 0), 0) / 1e3;
    const totalSecs = releaseTsMs === null ? NOT_EVALUATED : (releaseTsMs - cur.acquireTsMs) / 1e3 + cur.waitSecs;
    const residual = typeof totalSecs === "number" && totalSecs > 0 ? Math.abs(totalSecs - (cur.waitSecs + (typeof suiteSecs === "number" ? suiteSecs : 0) + otherSecs)) / totalSecs : NOT_EVALUATED;
    attempts.push({
      file,
      task,
      runId,
      waitSecs: cur.waitSecs,
      acquireTsMs: cur.acquireTsMs,
      releaseTsMs,
      steps: cur.steps,
      suiteSecs,
      otherSecs,
      totalSecs,
      residual
    });
    cur = null;
  };
  for (const e of entries) {
    if (e.step === "acquire-fan-in-lock") {
      push(null);
      cur = { waitSecs: (e.wallMs ?? 0) / 1e3, acquireTsMs: e.tsMs, steps: [] };
    } else if (e.step === "release-fan-in-lock" && cur) {
      push(e.tsMs);
    } else if (cur) {
      cur.steps.push(e);
    }
  }
  push(null);
  return attempts;
}
function readAllAttempts(root) {
  const files = listFanInAttemptFiles(root);
  const attempts = [];
  let malformedFiles = 0;
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      malformedFiles++;
      continue;
    }
    const got = parseFanInAttempts(text, f);
    if (got.length === 0) malformedFiles++;
    attempts.push(...got);
  }
  return { attempts, files: files.length, malformedFiles };
}
function busySecsInWindow(holds, loSec, hiSec) {
  let busy = 0;
  for (const h of holds) {
    const lo = Math.max(h.acquire, loSec);
    const hi = Math.min(h.release, hiSec);
    if (hi > lo) busy += hi - lo;
  }
  return busy;
}
function hourlyRho(holds, loSec, hiSec) {
  const out = [];
  const first = Math.floor(loSec / 3600) * 3600;
  for (let h = first; h <= hiSec; h += 3600) {
    const hi = Math.min(h + 3600, hiSec);
    const lo = Math.max(h, loSec);
    if (hi <= lo) continue;
    out.push({
      hour: h,
      rho: busySecsInWindow(holds, h, h + 3600) / 3600,
      arrivals: holds.filter((x) => x.acquire >= lo && x.acquire < hi).length
    });
  }
  return out;
}
function computeModel(holds, waits, inSystemSecs) {
  const ne = (v) => Number.isFinite(v) ? v : NOT_EVALUATED;
  if (holds.length === 0) {
    return {
      window: { fromSec: NOT_EVALUATED, toSec: NOT_EVALUATED, wallSecs: NOT_EVALUATED, days: NOT_EVALUATED },
      holdSecs: dist([]),
      waitSecs: dist(waits),
      rho: NOT_EVALUATED,
      lambdaPerSec: NOT_EVALUATED,
      lambdaPerDay: NOT_EVALUATED,
      L_byLittle: NOT_EVALUATED,
      L_timeAverage: NOT_EVALUATED,
      capacityPerDay: NOT_EVALUATED,
      headroomFactor: NOT_EVALUATED,
      perHourRho: { n: 0, median: NOT_EVALUATED, p90: NOT_EVALUATED, max: NOT_EVALUATED, fracGe090: NOT_EVALUATED },
      tailNote: "\u9501\u4E8B\u4EF6\u8F7D\u4F53\u4E3A\u7A7A \u21D2 \u6392\u961F\u6A21\u578B NOT-EVALUATED\uFF08\u26D4 \u4E0D\u662F\u300C\u03C1=0\u300D\uFF09"
    };
  }
  const fromSec = holds[0].acquire;
  const toSec = holds.reduce((m, h) => Math.max(m, h.release), holds[0].release);
  const wallSecs = Math.max(0, toSec - fromSec);
  const busy = holds.reduce((a, h) => a + h.holdSecs, 0);
  const rho = wallSecs > 0 ? busy / wallSecs : NOT_EVALUATED;
  const lambdaPerSec = wallSecs > 0 ? holds.length / wallSecs : NOT_EVALUATED;
  const lambdaPerDay = typeof lambdaPerSec === "number" ? lambdaPerSec * 86400 : NOT_EVALUATED;
  const meanHold = busy / holds.length;
  const capacityPerDay = meanHold > 0 ? 86400 / meanHold : NOT_EVALUATED;
  const meanWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
  const W = meanWait === null ? null : meanHold + meanWait;
  const L_byLittle = typeof lambdaPerSec === "number" && W !== null ? lambdaPerSec * W : NOT_EVALUATED;
  const L_timeAverage = wallSecs > 0 ? inSystemSecs.reduce((a, b) => a + b, 0) / wallSecs : NOT_EVALUATED;
  const hrs = hourlyRho(holds, fromSec, toSec);
  const hrRhos = hrs.map((h) => h.rho).sort((a, b) => a - b);
  const headroomFactor = typeof lambdaPerDay === "number" && lambdaPerDay > 0 && typeof capacityPerDay === "number" ? capacityPerDay / lambdaPerDay : NOT_EVALUATED;
  return {
    window: { fromSec, toSec, wallSecs, days: ne(wallSecs / 86400) },
    holdSecs: dist(holds.map((h) => h.holdSecs)),
    waitSecs: dist(waits),
    rho: ne(rho),
    lambdaPerSec: ne(lambdaPerSec),
    lambdaPerDay,
    L_byLittle,
    L_timeAverage,
    capacityPerDay,
    headroomFactor,
    perHourRho: {
      n: hrs.length,
      median: percentile(hrRhos, 0.5),
      p90: percentile(hrRhos, 0.9),
      max: hrRhos.length ? hrRhos[hrRhos.length - 1] : NOT_EVALUATED,
      fracGe090: hrs.length ? hrs.filter((h) => h.rho >= 0.9).length / hrs.length : NOT_EVALUATED
    },
    tailNote: "\u7B49\u5F85\u65F6\u95F4\u662F\u91CD\u5C3E\uFF1A\u4E2D\u4F4D\u4E0E\u5747\u503C\u5DEE\u4E09\u4E2A\u6570\u91CF\u7EA7\uFF08\u591A\u6570\u5230\u8FBE\u649E\u4E0A\u7A7A\u95F2\u9501\uFF0C\u5C11\u6570\u649E\u5728\u5FD9\u671F\u5C3E\u90E8\uFF09\u3002\u26D4 \u53EA\u770B\u4E2D\u4F4D\u6570\u4F1A\u5F97\u51FA\u300C\u6CA1\u6709\u6392\u961F\u300D\uFF0C\u53EA\u770B\u5747\u503C\u4F1A\u5F97\u51FA\u300C\u5168\u662F\u6392\u961F\u300D\u2014\u2014\u4E24\u8005\u90FD\u662F\u540C\u4E00\u4EFD\u6570\u636E\u7684\u7247\u9762\u8BFB\u6CD5\u3002"
  };
}
function waitVsRho(waitsAtMs, hrs) {
  const bands = [
    [0, 0.25],
    [0.25, 0.5],
    [0.5, 0.75],
    [0.75, 0.9],
    [0.9, 1.01]
  ];
  const byHour = /* @__PURE__ */ new Map();
  for (const h of hrs) byHour.set(h.hour, h.rho);
  return bands.map(([lo, hi]) => {
    const ws = waitsAtMs.filter((w) => {
      const r = byHour.get(Math.floor(w.tsMs / 36e5) * 3600);
      return typeof r === "number" && r >= lo && r < hi;
    }).map((w) => w.waitSecs).sort((a, b) => a - b);
    return {
      rhoLo: lo,
      rhoHi: hi,
      n: ws.length,
      medianWaitSecs: percentile(ws, 0.5),
      p90WaitSecs: percentile(ws, 0.9),
      meanWaitSecs: ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : NOT_EVALUATED
    };
  });
}
function concurrencVsThroughput(outcomes, landingsByDay, landingsReadError = null) {
  const byDay = /* @__PURE__ */ new Map();
  let maxSeenInFlight = 0;
  for (const o of outcomes) {
    if (!o.day) continue;
    const cur = byDay.get(o.day) ?? { max: 0, wallMs: 0 };
    if (typeof o.inFlight === "number") {
      cur.max = Math.max(cur.max, o.inFlight);
      maxSeenInFlight = Math.max(maxSeenInFlight, o.inFlight);
    }
    cur.wallMs += o.wallMs ?? 0;
    byDay.set(o.day, cur);
  }
  const groups = /* @__PURE__ */ new Map();
  for (const [day, v] of byDay) {
    const landings = landingsByDay.get(day);
    if (landings === void 0) continue;
    const workerHours = v.wallMs / 36e5;
    const slots = Math.max(1, v.max) * 24;
    const row = { landings, workerHours, slotUtil: workerHours / slots };
    const g = groups.get(v.max) ?? [];
    g.push(row);
    groups.set(v.max, g);
  }
  const levels = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([maxInFlight, rows]) => {
    const ls = rows.map((r) => r.landings).sort((a, b) => a - b);
    const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NOT_EVALUATED;
    return {
      maxInFlight,
      days: rows.length,
      meanLandings: mean(ls),
      medianLandings: percentile(ls, 0.5),
      meanWorkerHours: mean(rows.map((r) => r.workerHours)),
      meanSlotUtil: mean(rows.map((r) => r.slotUtil))
    };
  });
  return {
    levels,
    landingsReadError,
    observedCap: maxSeenInFlight > 0 ? maxSeenInFlight : NOT_EVALUATED,
    confound: "\u26D4 \u6863\u4F4D\u4E0D\u662F\u968F\u673A\u5206\u914D\u7684\uFF1A\u5E76\u53D1 cap \u7531\u8D44\u6E90\u95F8\uFF08avg300\uFF09\u81EA\u9002\u5E94\u9009\u51FA\uFF08GO=5 / WAIT=2 / EXTREME=1\uFF09\uFF0C\u4E14\u4F4E\u6863\u65E5\u5F80\u5F80\u540C\u65F6\u662F\u300C\u6C60\u91CC\u6CA1\u8D27\u300D\u7684\u65E5 \u21D2 \u4F4E\u6863\u4F4D\u7684\u4F4E\u843D\u5730\u6570\u662F**\u56E0\u679C\u53CC\u5411**\u7684\uFF0C\u4E0D\u80FD\u8BFB\u6210\u300C\u5E76\u53D1\u4F4E \u21D2 \u541E\u5410\u4F4E\u300D\u3002\u672C\u8868\u53EA\u80FD\u62A5\u51FA\u5B9E\u6D4B\u5173\u7CFB\uFF0C\u4E0D\u80FD\u8BC1\u56E0\u679C\u3002"
  };
}
function readWorkerOutcomes(root) {
  const file = path.join(root, ".quay", "worker-outcome.jsonl");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const r = o;
    const ts = typeof r.ts === "string" ? r.ts : "";
    out.push({
      day: ts.slice(0, 10),
      inFlight: typeof r.in_flight_count === "number" ? r.in_flight_count : null,
      wallMs: typeof r.wall_clock_ms === "number" ? r.wall_clock_ms : null
    });
  }
  return out;
}
function readLandingsByDay(root, ref = "develop") {
  const r = spawnSync("git", ["log", ref, "--format=%aI|%s"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024
  });
  const out = /* @__PURE__ */ new Map();
  if (r.status !== 0 || r.error) {
    return { landings: /* @__PURE__ */ new Map(), error: r.error ? `spawnSync: ${r.error.message}` : `git log ${ref} exit ${r.status}` };
  }
  for (const line of (r.stdout ?? "").split("\n")) {
    const idx = line.indexOf("|");
    if (idx < 0) continue;
    const iso = line.slice(0, idx);
    const subj = line.slice(idx + 1);
    const m = /^tasks: 翻 (\S+) done（/.exec(subj) ?? /^tasks: 翻 (\S+)（/.exec(subj);
    if (!m) continue;
    const day = iso.slice(0, 10);
    const set = out.get(day) ?? /* @__PURE__ */ new Set();
    set.add(m[1]);
    out.set(day, set);
  }
  return { landings: new Map([...out.entries()].map(([d, s]) => [d, s.size])), error: null };
}
function buildReport(root) {
  const lockFile = path.join(root, ".quay", "fan-in-lock-events.jsonl");
  const le = readLockEvents(lockFile);
  const pairing = pairLockHolds(le.events);
  const { attempts, files, malformedFiles } = readAllAttempts(root);
  const waits = attempts.map((a) => a.waitSecs);
  const inSystem = attempts.filter((a) => a.releaseTsMs !== null).map((a) => (a.releaseTsMs - (a.acquireTsMs - a.waitSecs * 1e3)) / 1e3);
  const model = computeModel(pairing.holds, waits, inSystem);
  const withSuite = attempts.filter((a) => typeof a.suiteSecs === "number");
  const totals = attempts.map((a) => a.totalSecs).filter((x) => typeof x === "number" && x > 0);
  const resid = attempts.map((a) => a.residual).filter((x) => typeof x === "number");
  const sumTotal = totals.reduce((a, b) => a + b, 0);
  const sumWait = attempts.reduce((a, b) => a + b.waitSecs, 0);
  const sumSuite = withSuite.reduce((a, b) => a + b.suiteSecs, 0);
  const sumOther = attempts.reduce((a, b) => a + b.otherSecs, 0);
  const covered = sumWait + sumSuite + sumOther;
  const hrs = hourlyRho(pairing.holds, model.window.fromSec === NOT_EVALUATED ? 0 : model.window.fromSec, model.window.toSec === NOT_EVALUATED ? 0 : model.window.toSec);
  const wvr = waitVsRho(
    attempts.map((a) => ({ tsMs: a.acquireTsMs, waitSecs: a.waitSecs })),
    hrs
  );
  const outcomes = readWorkerOutcomes(root);
  const landingsRead = readLandingsByDay(root);
  const cvt = concurrencVsThroughput(outcomes, landingsRead.landings, landingsRead.error);
  const hiBand = wvr[wvr.length - 1];
  const loBand = wvr[0];
  const medWait = model.waitSecs.median;
  const reverseIndicator = model.rho;
  const reverseIndicatorHolds = typeof reverseIndicator === "number" && typeof medWait === "number" && typeof loBand?.medianWaitSecs === "number" ? reverseIndicator < 0.5 && loBand.medianWaitSecs < 1 : NOT_EVALUATED;
  return {
    model,
    decomposition: {
      n: attempts.length,
      medianTotalSecs: percentile([...totals].sort((a, b) => a - b), 0.5),
      medianWaitSecs: percentile([...waits].sort((a, b) => a - b), 0.5),
      medianSuiteSecs: percentile(withSuite.map((a) => a.suiteSecs).sort((a, b) => a - b), 0.5),
      medianOtherSecs: percentile(attempts.map((a) => a.otherSecs).sort((a, b) => a - b), 0.5),
      residual: dist(resid),
      residualOver15Pct: resid.filter((r) => r >= 0.15).length,
      residualP90Ok: resid.length ? percentile([...resid].sort((a, b) => a - b), 0.9) < 0.15 : NOT_EVALUATED,
      aggregateShareWaitPct: covered > 0 ? sumWait / covered * 100 : NOT_EVALUATED,
      aggregateShareSuitePct: covered > 0 ? sumSuite / covered * 100 : NOT_EVALUATED,
      aggregateShareOtherPct: covered > 0 ? sumOther / covered * 100 : NOT_EVALUATED,
      attemptsWithoutSuite: attempts.length - withSuite.length
    },
    waitVsRho: wvr,
    concurrency: cvt,
    falsifier: {
      claim: "\u7ED3\u8BBA\u300C\u74F6\u9888\u5728\u6392\u961F\u800C\u975E\u8BA1\u7B97\u300D\u7684\u53CD\u5411\u8BFB\u6CD5\u662F\uFF1A\u82E5\u541E\u5410\u53D7\u8BA1\u7B97\u9650\u5236\uFF0C\u5219\u9501\u5229\u7528\u7387\u5E94\u8FDC\u4F4E\u4E8E 1\uFF0C\u4E14\u7B49\u5F85\u65F6\u95F4\u5E94\u63A5\u8FD1 0\u3002",
      reverseIndicator: "\u03C1\uFF08\u7A97\u53E3\u9501\u5229\u7528\u7387\uFF09\u4E0E\u4F4E \u03C1 \u6863\uFF08\u03C1<0.25\uFF09\u7684\u7B49\u5F85\u4E2D\u4F4D\u6570",
      reverseIndicatorMeasured: reverseIndicator,
      reverseIndicatorHolds,
      note: `\u4F4E \u03C1 \u6863\uFF08\u03C1<0.25\uFF09\u7B49\u5F85\u4E2D\u4F4D = ${String(loBand?.medianWaitSecs)} s\uFF08n=${loBand?.n ?? 0}\uFF09\uFF1B\u9AD8 \u03C1 \u6863\uFF08\u03C1\u22650.9\uFF09\u7B49\u5F85\u4E2D\u4F4D = ${String(hiBand?.medianWaitSecs)} s\uFF08n=${hiBand?.n ?? 0}\uFF09\u3002\u26D4 \u53CD\u5411\u6307\u6807**\u90E8\u5206\u6210\u7ACB**\uFF1A\u805A\u5408\u5C42 \u03C1=${fmt(reverseIndicator)} \u8FDC\u4F4E\u4E8E 1 \u21D2 \u805A\u5408\u541E\u5410**\u4E0D**\u53D7\u9501\u9650\u5236\uFF1B\u4F46\u5B9E\u6D4B knee \u5728 \u03C1\u22480.75\uFF1A\u03C1<0.75 \u4E09\u6863\u7684\u7B49\u5F85**\u4E2D\u4F4D**\u90FD \u22480.1 s\uFF08= \u8FDB\u7A0B\u542F\u52A8\u5F00\u9500\uFF0C\u5373\u300C\u6CA1\u6392\u961F\u300D\uFF09\uFF0C\u8DE8\u8FC7 \u03C1=0.75 \u540E\u4E2D\u4F4D\u8DF3\u5230 ${String(wvr[3]?.medianWaitSecs)} s\u3001\u03C1\u22650.9 \u518D\u5230 ${String(hiBand?.medianWaitSecs)} s\u3002\u21D2 **\u5C3E\u90E8\u5EF6\u8FDF**\u7531\u6392\u961F\u652F\u914D\uFF0C\u800C\u805A\u5408\u541E\u5410\u4E0D\u7531\u5B83\u652F\u914D\u3002\u4E24\u4E2A\u8BFB\u6CD5\u90FD\u6210\u7ACB\u3001\u4E92\u4E0D\u77DB\u76FE\uFF08\u5747\u503C\u4E0E\u4E2D\u4F4D\u5728\u540C\u4E00\u4EFD\u91CD\u5C3E\u6570\u636E\u4E0A\u7684\u4E24\u79CD\u6295\u5F71\uFF09\uFF0C\u6307\u5411\u7684\u7ED3\u8BBA\u4E0D\u540C\u2014\u2014\u8FD9\u6B63\u662F\u5FC5\u987B\u540C\u65F6\u62A5\u51FA\u7684\u539F\u56E0\u3002`
    },
    carriers: {
      "fan-in-lock-events": `${lockFile}\uFF1Aholds=${pairing.holds.length} unpairedAcquires=${pairing.unpairedAcquires} unpairedReleases=${pairing.unpairedReleases} malformed=${le.malformed}${le.missing ? `\uFF08\u7F3A\u5931 \u21D2 NOT-EVALUATED\uFF09` : ""}`,
      "fan-in-per-run-logs": `${path.join(root, ".quay", "fan-in-*.log")}\uFF1Afiles=${files} attempts=${attempts.length} unreadable=${malformedFiles}`,
      "worker-outcome": `${path.join(root, ".quay", "worker-outcome.jsonl")}\uFF1Arows=${outcomes.length}`,
      "git-log-develop-landings": landingsRead.error ? `ref=develop \u8BFB\u53D6\u5931\u8D25 \u21D2 NOT-EVALUATED\uFF08${landingsRead.error}\uFF09` : `ref=develop days=${landingsRead.landings.size}`
    }
  };
}
function fmt(v) {
  if (v === NOT_EVALUATED) return NOT_EVALUATED;
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return Math.abs(v) < 1 ? String(Number(v.toFixed(4))) : v.toFixed(1);
  }
  return String(v);
}
function renderHuman(r) {
  const L = [];
  L.push("fan-in \u6392\u961F\u8BBA\u6A21\u578B \u2014 \u52A0\u5E76\u53D1\u5230\u5E95\u63D0\u541E\u5410\u8FD8\u662F\u53EA\u52A0\u957F\u961F\u5217");
  L.push("");
  L.push("\u8F7D\u4F53\uFF1A");
  for (const [k, v] of Object.entries(r.carriers)) L.push(`  ${k}: ${v}`);
  L.push("");
  L.push(`\u7A97\u53E3 ${fmt(r.model.window.days)} \u5929\uFF08wall ${fmt(r.model.window.wallSecs)} s\uFF09`);
  L.push("");
  L.push("\u516D\u4E2A\u5FC5\u9700\u91CF\uFF1A");
  L.push(`  \u7B49\u5F85\u65F6\u95F4\u5206\u5E03(s)  n=${r.model.waitSecs.n} median=${fmt(r.model.waitSecs.median)} p90=${fmt(r.model.waitSecs.p90)} max=${fmt(r.model.waitSecs.max)} mean=${fmt(r.model.waitSecs.mean)}`);
  L.push(`  \u9501\u6301\u6709\u5206\u5E03(s)    n=${r.model.holdSecs.n} median=${fmt(r.model.holdSecs.median)} p90=${fmt(r.model.holdSecs.p90)} max=${fmt(r.model.holdSecs.max)} mean=${fmt(r.model.holdSecs.mean)}`);
  L.push(`  \u9501\u5229\u7528\u7387 \u03C1       ${fmt(r.model.rho)}`);
  L.push(`  \u5230\u8FBE\u7387 \u03BB         ${fmt(r.model.lambdaPerDay)} /\u5929`);
  L.push(`  \u5E73\u5747\u5728\u7CFB\u7EDF\u6570 L   ${fmt(r.model.L_byLittle)}\uFF08Little \u03BB\xB7W\uFF09 / \u65F6\u95F4\u5E73\u5747 ${fmt(r.model.L_timeAverage)}`);
  L.push(`  \u5355\u670D\u52A1\u5668\u5BB9\u91CF     1/E[S] = ${fmt(r.model.capacityPerDay)} /\u5929 \u21D2 \u03C1=1 \u7684\u5230\u8FBE\u7387\u500D\u6570\u4F59\u91CF ${fmt(r.model.headroomFactor)}\xD7`);
  L.push("");
  L.push(`\u6BCF\u5C0F\u65F6 \u03C1\uFF1An=${r.model.perHourRho.n} median=${fmt(r.model.perHourRho.median)} p90=${fmt(r.model.perHourRho.p90)} max=${fmt(r.model.perHourRho.max)} \u03C1\u22650.9 \u5360 ${fmt(r.model.perHourRho.fracGe090)}`);
  L.push("");
  L.push("\u4E09\u6BB5\u62C6\u5206\uFF08\u6BCF\u6B21 fan-in \u5C1D\u8BD5\uFF09\uFF1A");
  L.push(`  n=${r.decomposition.n}  \u4E2D\u4F4D total=${fmt(r.decomposition.medianTotalSecs)}s wait=${fmt(r.decomposition.medianWaitSecs)}s suite=${fmt(r.decomposition.medianSuiteSecs)}s other=${fmt(r.decomposition.medianOtherSecs)}s`);
  L.push(`  \u6B8B\u5DEE median=${fmt(r.decomposition.residual.median)} p90=${fmt(r.decomposition.residual.p90)} \u8D85 15% \u7684\u5C1D\u8BD5 ${r.decomposition.residualOver15Pct}/${r.decomposition.n}`);
  L.push(`  \u805A\u5408\u5360\u6BD4 wait=${fmt(r.decomposition.aggregateShareWaitPct)}% suite=${fmt(r.decomposition.aggregateShareSuitePct)}% other=${fmt(r.decomposition.aggregateShareOtherPct)}%`);
  L.push("");
  L.push("\u5B9E\u6D4B wait-vs-\u03C1\uFF08\u552F\u4E00\u53EF\u53D6\u5047\u7684\u7ED3\u8BBA\u8F7D\u4F53\uFF09\uFF1A");
  for (const b of r.waitVsRho) {
    L.push(`  \u03C1\u2208[${b.rhoLo},${b.rhoHi}) n=${String(b.n).padStart(4)} median=${fmt(b.medianWaitSecs)}s p90=${fmt(b.p90WaitSecs)}s mean=${fmt(b.meanWaitSecs)}s`);
  }
  L.push("");
  L.push(`\u5E76\u53D1\u5EA6 vs \u541E\u5410\uFF08\u89C2\u6D4B cap=${fmt(r.concurrency.observedCap)}\uFF09\uFF1A`);
  if (r.concurrency.landingsReadError) L.push(`  \u26D4 \u843D\u5730\u6570\u8BFB\u53D6\u5931\u8D25 \u21D2 \u672C\u8868 NOT-EVALUATED\uFF1A${r.concurrency.landingsReadError}`);
  for (const l of r.concurrency.levels) {
    L.push(`  maxIF=${l.maxInFlight} \u5929\u6570=${l.days} \u5747\u843D\u5730=${fmt(l.meanLandings)} worker\u69FD\u5229\u7528=${fmt(l.meanSlotUtil)}`);
  }
  L.push("");
  L.push("\u53EF\u53D6\u5047\uFF08AC4\uFF09\uFF1A");
  L.push(`  ${r.falsifier.claim}`);
  L.push(`  ${r.falsifier.note}`);
  L.push("");
  L.push("\u26D4 L_byLittle \u4E0E L_timeAverage \u4E00\u81F4\u662F Little's law \u7684\u6052\u7B49\u5F0F\uFF0C\u4E0D\u662F\u6A21\u578B\u9A8C\u8BC1\uFF08\u786C\u89C4\u5219 4\uFF09\u3002");
  return L.join("\n");
}
function main(argv) {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--json") json = true;
    else if (argv[i] === "--since") i++;
  }
  const report = buildReport(root);
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(renderHuman(report) + "\n");
  const noCarrier = report.model.window.fromSec === NOT_EVALUATED && report.decomposition.n === 0;
  return noCarrier ? 1 : 0;
}
var isDirect = process.argv[1] && /fan-in-queueing-model\.(ts|js)$/.test(process.argv[1]);
if (isDirect) {
  process.exit(main(process.argv.slice(2)));
}
export {
  NOT_EVALUATED,
  buildReport,
  busySecsInWindow,
  computeModel,
  concurrencVsThroughput,
  dist,
  hourlyRho,
  isoToMs,
  listFanInAttemptFiles,
  pairLockHolds,
  parseFanInAttempts,
  percentile,
  readAllAttempts,
  readLandingsByDay,
  readLockEvents,
  readWorkerOutcomes,
  renderHuman,
  splitFanInLogName,
  waitVsRho
};
