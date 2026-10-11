#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/defect-latency-pair.ts
import { spawnSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/defect-latency-pair.ts
var NOT_EVALUATED = "NOT-EVALUATED";
function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { code: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function gitOrThrow(root, args) {
  const r = git(root, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} \u2192 exit ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
  return r.stdout;
}
function parseNameOnlyLog(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("")) {
      const [sha, iso, subject] = raw.slice(1).split("");
      cur = { sha, committerIso: iso, subject: subject ?? "", files: [] };
      out.push(cur);
      continue;
    }
    if (cur === null) continue;
    const f = raw.trim();
    if (f) cur.files.push(f);
  }
  return out;
}
function parseDiffHunks(text) {
  const out = [];
  let file = null;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim();
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff --git ") || raw.startsWith("index ") || raw.startsWith("@@@")) continue;
    if (raw.startsWith("@@")) {
      if (!file) continue;
      const m = /^@@ -(\d+)(?:,(\d+))? \+/.exec(raw);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === void 0 ? 1 : Number(m[2]);
      out.push({ file, start, count });
    }
  }
  return out;
}
function parseBlamePorcelain(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const m = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(raw);
    if (m) out.push(m[1]);
  }
  return out;
}
var DEFECT_MARKERS = [
  [
    "silent-failure",
    [
      /静默/g,
      /无声/g,
      /不发出声音/g,
      /恒绿/g,
      /假绿/g,
      /看不见/g,
      /视而不见/g,
      /无信号/g,
      /吞掉/g,
      /不报错/g,
      /没有报/g,
      /没报/g,
      /silent/gi,
      /swallow/gi,
      /常量真|恒真|恒零/g,
      /伪装成/g,
      /同形/g
    ]
  ],
  [
    "loud-failure",
    [
      /崩溃/g,
      /报错/g,
      /抛错/g,
      /异常退出/g,
      /crash/gi,
      /throw/gi,
      /非零退出/g,
      /失败退出/g,
      /红色|变红|红窗/g,
      /flaky/gi,
      /OOM/gi
    ]
  ],
  [
    "performance",
    [
      /性能/g,
      /耗时/g,
      /延迟/g,
      /吞吐/g,
      /慢/g,
      /超时/g,
      /排队/g,
      /并发/g,
      /latency/gi,
      /perf(?:ormance)?/gi,
      /O\([^)]*\)/g
    ]
  ],
  [
    "doc-drift",
    [
      /文档/g,
      /漂移/g,
      /过期/g,
      /陈旧/g,
      /正本/g,
      /指令/g,
      /README/g,
      /CLAUDE\.md/g,
      /注释/g,
      /doc(?:s|umentation)?/gi
    ]
  ]
];
function classifyDefectType(body) {
  const counts = {};
  let best = "unclassified";
  let bestN = 0;
  for (const [name, pats] of DEFECT_MARKERS) {
    let n = 0;
    for (const p of pats) {
      const m = body.match(p);
      if (m) n += m.length;
    }
    counts[name] = n;
    if (n > bestN) {
      bestN = n;
      best = name;
    }
  }
  return { type: best, counts };
}
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
}
function dist(xs) {
  if (xs.length === 0) return { n: 0, min: null, median: null, p90: null, max: null, mean: null };
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
function sampleDeterministic(pool, n, seed) {
  const a = [...pool].sort((x, y) => x.taskId < y.taskId ? -1 : x.taskId > y.taskId ? 1 : 0);
  const rnd = seededRng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}
var LANDING_MERGE_PREFIX = "Merge branch 'develop' into task/";
var DONE_SUBJECT = /^tasks: (?:翻 )?(\S+?)(?: flip)? done（/;
function buildLandingIndex(root, ref) {
  const out = gitOrThrow(root, ["log", ref, "--format=%H%x01%P%x01%cI%x01%s"]);
  const merges = /* @__PURE__ */ new Map();
  const done = /* @__PURE__ */ new Map();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [sha, parents, iso, subject = ""] = line.split("");
    const entry = { sha, parents: parents.trim() ? parents.trim().split(" ") : [], iso };
    if (subject.startsWith(LANDING_MERGE_PREFIX)) {
      const id = subject.slice(LANDING_MERGE_PREFIX.length).trim();
      if (!merges.has(id)) merges.set(id, []);
      merges.get(id).push(entry);
    } else {
      const m = DONE_SUBJECT.exec(subject);
      if (m && m[1] !== "\u7FFB") {
        if (!done.has(m[1])) done.set(m[1], []);
        done.get(m[1]).push(entry);
      }
    }
  }
  return { merges, done };
}
function listGapTaskIds(root, ref) {
  const out = gitOrThrow(root, ["ls-tree", "-r", "--name-only", ref, "tasks/"]);
  const ids = [];
  for (const p of out.split("\n")) {
    const b = p.trim().split("/").pop() ?? "";
    if (b.startsWith("gap-") && b.endsWith(".md")) ids.push(b.slice(0, -3));
  }
  return ids;
}
function buildFilingIndex(root, ref) {
  const out = gitOrThrow(root, ["log", ref, "--diff-filter=A", "--format=%H%x01%cI", "--name-only", "--", "tasks/gap-*.md"]);
  const map = /* @__PURE__ */ new Map();
  let cur = null;
  for (const raw of out.split("\n")) {
    if (raw.includes("")) {
      const [sha, iso] = raw.split("");
      cur = { sha, iso };
      continue;
    }
    const f = raw.trim();
    if (!cur || !f.startsWith("tasks/")) continue;
    const b = f.slice("tasks/".length);
    if (!b.startsWith("gap-") || !b.endsWith(".md")) continue;
    map.set(b.slice(0, -3), cur);
  }
  return map;
}
function findFixCommits(root, tip, base, id) {
  const out = git(root, ["log", "--no-merges", "--name-only", "--format=%x02%H%x01%cI%x01%s", tip, `^${base}`]);
  if (out.code !== 0) return null;
  const commits = parseNameOnlyLog(out.stdout);
  const res = [];
  for (const c of commits) {
    if (/^tasks: 翻 /.test(c.subject) || /task_write by cli:/.test(c.subject)) continue;
    if (!c.files.some((f) => !f.startsWith("tasks/"))) continue;
    res.push({ sha: c.sha, iso: c.committerIso });
  }
  return res;
}
function landingShapeOf(idx, id) {
  if (idx.merges.has(id)) return "merge";
  if (idx.done.has(id)) return "done-only";
  return "none";
}
var SKIP_FILE = /^(tasks\/|\.quay\/|node_modules\/|plugin\/vendor\/|packages\/[^/]+\/dist\/)/;
var BULK_FILE = /^(package-lock\.json|\.gitignore)$/;
var TEST_FILE = /(^|\/)test\/|\.test\.[cm]?[jt]s$|\.spec\.[cm]?[jt]s$/;
function worthBlamin(p) {
  if (!p || SKIP_FILE.test(p)) return false;
  if (BULK_FILE.test(p)) return false;
  if (/\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|gz|wasm)$/i.test(p)) return false;
  return true;
}
function looksLikeRelocation(subject, fileCount) {
  if (fileCount >= 25) return true;
  return /^\s*(?:refactor|refactoring|rename|renaming|move|moving|format|formatting|style|chore\(format\)|reformat|restructure|reorganize|split|extract|migrate|relocate)(?![a-z])/i.test(subject) || /(重构|重命名|搬移|搬家|格式化|改名|拆分|拆出|收敛为|重组|归并|迁移)/.test(subject);
}
function blameOldLines(root, fixSha, ranges, opts = {}) {
  const maxFiles = opts.maxFiles ?? 12;
  const maxLines = opts.maxLines ?? 400;
  const byFile = /* @__PURE__ */ new Map();
  for (const r of ranges) {
    if (r.count <= 0) continue;
    if (!worthBlamin(r.file)) continue;
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r);
  }
  const files = [...byFile.keys()].sort((a, b) => Number(TEST_FILE.test(a)) - Number(TEST_FILE.test(b))).slice(0, maxFiles);
  const shas = /* @__PURE__ */ new Set();
  let lines = 0;
  let anyNonTest = false;
  for (const f of files) {
    const rs = byFile.get(f);
    const args = ["blame", "--line-porcelain"];
    let budget = 0;
    for (const r2 of rs) {
      if (budget >= maxLines) break;
      const take = Math.min(r2.count, maxLines - budget);
      args.push("-L", `${r2.start},+${take}`);
      budget += take;
    }
    if (budget === 0) continue;
    args.push(`${fixSha}^`, "--", f);
    const r = git(root, args);
    if (r.code !== 0) continue;
    const got = parseBlamePorcelain(r.stdout);
    if (got.length === 0) continue;
    if (!TEST_FILE.test(f)) anyNonTest = true;
    for (const s of got) shas.add(s);
    lines += got.length;
  }
  if (shas.size === 0) return { candidates: [], lines, blamedFiles: 0, anyNonTest: false, error: null };
  const list = [...shas];
  const iso = /* @__PURE__ */ new Map();
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const out = git(root, ["log", "--no-walk=unsorted", "--format=%H%x01%cI", ...chunk]);
    if (out.code !== 0) return { candidates: [], lines, blamedFiles: files.length, anyNonTest, error: "commit-time-read-failed" };
    for (const l of out.stdout.split("\n")) {
      if (!l.includes("")) continue;
      const [sha, ciso] = l.split("");
      iso.set(sha, ciso);
    }
  }
  const cands = [];
  for (const s of list) {
    const c = iso.get(s);
    if (!c) return { candidates: [], lines, blamedFiles: files.length, anyNonTest, error: "commit-time-missing" };
    cands.push({ sha: s, iso: c });
  }
  cands.sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso) || (a.sha < b.sha ? -1 : 1));
  return { candidates: cands, lines, blamedFiles: files.length, anyNonTest, error: null };
}
function pairOne(id, deps) {
  const { idx, filing } = deps;
  const shape = landingShapeOf(idx, id);
  const filed = filing.get(id);
  const body = deps.bodyOf(id);
  const defectType = classifyDefectType(body).type;
  const base = {
    taskId: id,
    t0: null,
    t1: filed ? filed.iso : null,
    latencyHours: null,
    t0Method: "unresolvable:no-filing-commit",
    confidence: "unresolvable",
    t0Commit: null,
    t1Commit: filed ? filed.sha : null,
    landingCommit: null,
    fixCommit: null,
    t0CandidateCommits: 0,
    candidatesAfterFiling: 0,
    defectType,
    landingShape: shape
  };
  if (!filed) return base;
  const merges = idx.merges.get(id) ?? [];
  const doneShas = new Set((idx.done.get(id) ?? []).map((d) => d.sha));
  const mergeBySha = new Map(merges.map((m) => [m.sha, m]));
  const cands = [];
  for (const m of merges) {
    if (m.parents.length < 2) continue;
    cands.push({ tip: m.parents[0], base: m.parents[1], iso: m.iso, kind: "merge-p1" });
  }
  for (const d of idx.done.get(id) ?? []) {
    const p = d.parents[0];
    const pm = p ? mergeBySha.get(p) : void 0;
    if (pm && pm.parents.length >= 2) cands.push({ tip: d.sha, base: pm.parents[1], iso: d.iso, kind: "done-after-merge" });
  }
  if (cands.length === 0 || !cands.some((c) => c.tip === c.base || doneShas.has(c.tip))) {
    for (const m of merges.slice(0, 4)) {
      if (m.parents.length < 2) continue;
      const reach = git(deps.root, ["rev-list", "--max-count=3000", m.parents[0]]);
      if (reach.code !== 0) continue;
      if (reach.stdout.split("\n").some((s) => doneShas.has(s.trim()))) {
        cands.push({ tip: m.parents[0], base: m.parents[1], iso: m.iso, kind: "merge-p1-contains-done" });
        break;
      }
    }
  }
  cands.sort((a, b) => Date.parse(b.iso) - Date.parse(a.iso) || (a.tip < b.tip ? -1 : 1));
  if (cands.length === 0) {
    base.t0Method = `unresolvable:${shape === "none" ? "no-landing-commit" : "no-landing-merge-with-done"}`;
    return base;
  }
  let fixes = null;
  for (const c of cands) {
    const f = findFixCommits(deps.root, c.tip, c.base, id);
    if (f && f.length > 0) {
      fixes = f;
      base.landingCommit = c.tip;
      break;
    }
    if (base.landingCommit === null) base.landingCommit = c.tip;
  }
  if (!fixes || fixes.length === 0) {
    base.t0Method = "unresolvable:no-code-fix-commit";
    return base;
  }
  fixes.sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso) || (a.sha < b.sha ? -1 : 1));
  let sawHunks = false;
  for (const f of fixes) {
    const diff = git(deps.root, ["diff", "--unified=0", "--no-color", "--no-renames", "--text", `${f.sha}^`, f.sha, "--", "."]);
    if (diff.code !== 0) continue;
    const ranges = parseDiffHunks(diff.stdout);
    const usable = ranges.filter((r) => r.count > 0 && worthBlamin(r.file));
    if (usable.length === 0) continue;
    sawHunks = true;
    const bl = blameOldLines(deps.root, f.sha, usable);
    if (bl.error) {
      base.t0Method = `unresolvable:${bl.error}`;
      base.fixCommit = f.sha;
      return base;
    }
    if (bl.candidates.length === 0) continue;
    base.fixCommit = f.sha;
    const t1ms = Date.parse(filed.iso);
    const within = bl.candidates.filter((c) => Date.parse(c.iso) <= t1ms);
    base.t0CandidateCommits = bl.candidates.length;
    base.candidatesAfterFiling = bl.candidates.length - within.length;
    if (within.length === 0) {
      base.t0Method = "unresolvable:all-candidates-after-filing";
      return base;
    }
    const t0 = within[within.length - 1];
    base.t0 = t0.iso;
    base.t0Commit = t0.sha;
    base.latencyHours = (t1ms - Date.parse(t0.iso)) / 36e5;
    const reloc = looksLikeRelocation(subjectOf(deps.root, t0.sha), fileCountOf(deps.root, t0.sha));
    const isMerge = parentsOf(deps.root, t0.sha).length >= 2;
    if (bl.candidates.length > 1) {
      base.confidence = "low";
      base.t0Method = `blame:latest-of-${bl.candidates.length}`;
    } else if (reloc) {
      base.confidence = "low";
      base.t0Method = "blame:suspect-relocation";
    } else if (isMerge) {
      base.confidence = "low";
      base.t0Method = "blame:suspect-merge-attribution";
    } else if (t0.sha === filed.sha) {
      base.confidence = "low";
      base.t0Method = "blame:same-as-filing";
    } else if (!bl.anyNonTest) {
      base.confidence = "low";
      base.t0Method = "blame:test-file-only";
    } else {
      base.confidence = "high";
      base.t0Method = "blame:single-commit";
    }
    return base;
  }
  base.t0Method = sawHunks ? "unresolvable:blame-yielded-no-candidate" : "unresolvable:no-old-line-hunks";
  return base;
}
var subjectCache = /* @__PURE__ */ new Map();
var fileCountCache = /* @__PURE__ */ new Map();
var parentsCache = /* @__PURE__ */ new Map();
function parentsOf(root, sha) {
  const k = `${root}${sha}`;
  if (!parentsCache.has(k)) {
    const r = git(root, ["log", "-1", "--format=%P", sha]);
    parentsCache.set(k, r.code === 0 && r.stdout.trim() ? r.stdout.trim().split(" ") : []);
  }
  return parentsCache.get(k);
}
function subjectOf(root, sha) {
  const k = `${root}${sha}`;
  if (!subjectCache.has(k)) {
    const r = git(root, ["log", "-1", "--format=%s", sha]);
    subjectCache.set(k, r.code === 0 ? r.stdout.trim() : "");
  }
  return subjectCache.get(k);
}
function fileCountOf(root, sha) {
  const k = `${root}${sha}`;
  if (!fileCountCache.has(k)) {
    const r = git(root, ["show", "--pretty=", "--name-only", sha]);
    fileCountCache.set(k, r.code === 0 ? r.stdout.split("\n").filter((s) => s.trim()).length : 0);
  }
  return fileCountCache.get(k);
}
function readTaskBodies(root, ref, ids) {
  const out = /* @__PURE__ */ new Map();
  const tree = gitOrThrow(root, ["ls-tree", "-r", ref, "tasks/"]);
  const oid = /* @__PURE__ */ new Map();
  for (const l of tree.split("\n")) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(l);
    if (!m) continue;
    const b = m[2].split("/").pop() ?? "";
    if (b.startsWith("gap-") && b.endsWith(".md")) oid.set(b.slice(0, -3), m[1]);
  }
  const wanted = ids.filter((i) => oid.has(i));
  const r = spawnSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: wanted.map((i) => oid.get(i)).join("\n") + "\n",
    maxBuffer: 512 * 1024 * 1024
  });
  if (r.error) throw r.error;
  const buf = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout ?? "");
  let pos = 0;
  for (const id of wanted) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    const hdr = /^([0-9a-f]{40}) blob (\d+)$/.exec(buf.subarray(pos, nl).toString("utf8"));
    if (!hdr) break;
    const size = Number(hdr[2]);
    const start = nl + 1;
    out.set(id, buf.subarray(start, start + size).toString("utf8"));
    pos = start + size + 1;
  }
  return out;
}
function buildReport(root, opts = {}) {
  const ref = opts.ref ?? "develop";
  const tip = gitOrThrow(root, ["rev-parse", ref]).trim();
  let ids = listGapTaskIds(root, ref);
  if (opts.only) ids = ids.filter((i) => i.includes(opts.only));
  const idx = buildLandingIndex(root, ref);
  const filing = buildFilingIndex(root, ref);
  const bodies = readTaskBodies(root, ref, ids);
  const pairs = ids.map((id) => pairOne(id, { root, idx, filing, bodyOf: (i) => bodies.get(i) ?? "" }));
  const verifiable = pairs.filter((p) => p.confidence !== "unresolvable");
  const latencies = verifiable.map((p) => p.latencyHours).filter((x) => Number.isFinite(x));
  const unresolvableByReason = {};
  for (const p of pairs) {
    if (p.confidence !== "unresolvable") continue;
    const reason = p.t0Method.replace(/^unresolvable:/, "");
    unresolvableByReason[reason] = (unresolvableByReason[reason] ?? 0) + 1;
  }
  const types = ["silent-failure", "loud-failure", "performance", "doc-drift", "unclassified"];
  const byDefectType = types.map((t) => {
    const sub = verifiable.filter((p) => p.defectType === t);
    return {
      defectType: t,
      n: sub.length,
      distribution: dist(sub.map((p) => p.latencyHours)),
      // AC4：样本 <5 ⇒ 标注「样本不足，不下结论」，⛔ 不照样给中位当结论。
      conclusionSuppressed: sub.length < 5
    };
  });
  const tail = [...verifiable].sort((a, b) => b.latencyHours - a.latencyHours).slice(0, 10);
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ref,
    refTip: tip,
    denominator: ids.length,
    verifiablePairs: verifiable.length,
    unresolvableRate: ids.length ? pairs.filter((p) => p.confidence === "unresolvable").length / ids.length : 0,
    unresolvableByReason,
    distribution: dist(latencies),
    tail,
    byDefectType,
    pairs
  };
}
function fmtH(v) {
  return v === null ? String(NOT_EVALUATED) : v.toFixed(1);
}
function renderHuman(r) {
  const L = [];
  L.push("\u7F3A\u9677\u53D1\u73B0\u5EF6\u8FDF\u5206\u5E03 \u2014 \u4ECE\u300C\u88AB\u5F15\u5165\u300D\u5230\u300C\u88AB\u7ACB\u6848\u300D");
  L.push("");
  L.push(`ref=${r.ref} tip=${r.refTip.slice(0, 12)}  generatedAt=${r.generatedAt}`);
  L.push("");
  L.push(`\u5206\u6BCD\uFF08\u5C1D\u8BD5\u914D\u5BF9\u7684 gap \u4EFB\u52A1\u603B\u6570\uFF09= ${r.denominator}`);
  L.push(`\u53EF\u6838\u914D\u5BF9\uFF08confidence != unresolvable\uFF09= ${r.verifiablePairs}`);
  L.push(`\u5931\u771F\u7387 unresolvable / \u603B\u6570 = ${r.unresolvableRate.toFixed(4)}\uFF08${(r.unresolvableRate * 100).toFixed(1)}%\uFF09`);
  L.push("");
  L.push(`\u5EF6\u8FDF\u5206\u5E03\uFF08\u5C0F\u65F6\uFF09\uFF1An=${r.distribution.n} min=${fmtH(r.distribution.min)} median=${fmtH(r.distribution.median)} p90=${fmtH(r.distribution.p90)} max=${fmtH(r.distribution.max)} mean=${fmtH(r.distribution.mean)}`);
  L.push("");
  L.push("\u5C3E\u90E8\uFF08\u6700\u957F 10 \u6761\uFF09\uFF1A");
  for (const t of r.tail) L.push(`  ${fmtH(t.latencyHours).padStart(9)} h  ${t.taskId}  (${t.confidence})`);
  L.push("");
  L.push("\u6309\u7F3A\u9677\u7C7B\u578B\u5206\u7EC4\uFF1A");
  for (const g of r.byDefectType) {
    const d = g.distribution;
    const note = g.conclusionSuppressed ? "  \u26A0\uFE0F \u6837\u672C\u4E0D\u8DB3\uFF0C\u4E0D\u4E0B\u7ED3\u8BBA" : "";
    L.push(`  ${g.defectType.padEnd(16)} n=${String(g.n).padStart(4)} median=${fmtH(d.median)} p90=${fmtH(d.p90)} max=${fmtH(d.max)}${note}`);
  }
  L.push("");
  L.push("unresolvable \u6210\u56E0\u5206\u7C7B\uFF08\u53E3\u5F84\u91CF\u4E0D\u4E86\u4EC0\u4E48\uFF09\uFF1A");
  const reasons = Object.entries(r.unresolvableByReason).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of reasons) L.push(`  ${String(v).padStart(5)}  ${k}`);
  if (reasons.length === 0) L.push("  \uFF08none\uFF09");
  L.push("");
  L.push("\u26D4 \u300Cunresolvable\u300D\u4E0E\u300Chigh\u300D\u4E0D\u540C\u5F62\uFF1A\u524D\u8005\u662F\u6CA1\u91CF\u5230\uFF0C\u540E\u8005\u662F\u91CF\u5230\u4E86\uFF08\u786C\u89C4\u5219 3b\uFF09\u3002");
  return L.join("\n");
}
function renderSample(rows, seed, pool) {
  const L = [];
  L.push(`\u62BD\u6837\u590D\u6838\uFF08seed=${seed}\uFF0C\u6C60 = confidence=="high" \u7684 ${pool} \u6761\uFF09`);
  for (const r of rows) {
    L.push(`${r.taskId}	t0=${r.t0}	t0sha=${r.t0Commit}	t1=${r.t1}	t1sha=${r.t1Commit}	latencyHours=${r.latencyHours === null ? "null" : r.latencyHours.toFixed(2)}	fix=${r.fixCommit}`);
  }
  return L.join("\n");
}
function parseArgs(argv) {
  const a = { root: process.cwd(), ref: "develop", emitJson: false, sample: null, seed: 20260914, only: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--root") a.root = argv[++i];
    else if (t === "--ref") a.ref = argv[++i];
    else if (t === "--emit-json" || t === "--json") a.emitJson = true;
    else if (t === "--sample") a.sample = Number(argv[++i]);
    else if (t === "--seed") a.seed = Number(argv[++i]);
    else if (t === "--only") a.only = argv[++i];
    else return { error: `unknown flag: ${t}` };
  }
  if (a.sample !== null && !Number.isFinite(a.sample)) return { error: "--sample needs a number" };
  if (!Number.isFinite(a.seed)) return { error: "--seed needs a number" };
  return a;
}
function main(argv) {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}
`);
    return 2;
  }
  const { root, ref, emitJson, sample, seed, only } = parsed;
  const isRepo = git(root, ["rev-parse", "--git-dir"]);
  if (isRepo.code !== 0) {
    process.stderr.write(`not a git repository: ${root}
`);
    return 2;
  }
  const hasRef = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (hasRef.code !== 0) {
    process.stderr.write(`ref not found: ${ref}
`);
    return 2;
  }
  const report = buildReport(root, { ref, ...only ? { only } : {} });
  if (sample !== null) {
    const pool = report.pairs.filter((p) => p.confidence === "high");
    const rows = sampleDeterministic(pool, sample, seed);
    if (emitJson) process.stdout.write(JSON.stringify({ seed, poolSize: pool.length, rows }, null, 2) + "\n");
    else process.stdout.write(renderSample(rows, seed, pool.length) + "\n");
    return 0;
  }
  if (emitJson) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(renderHuman(report) + "\n");
  return 0;
}
var isDirect = process.argv[1] != null && /defect-latency-pair\.(ts|js)$/.test(process.argv[1]);
if (isDirect) {
  process.exitCode = main(process.argv.slice(2));
}
export {
  DONE_SUBJECT,
  NOT_EVALUATED,
  blameOldLines,
  buildFilingIndex,
  buildLandingIndex,
  buildReport,
  classifyDefectType,
  dist,
  findFixCommits,
  git,
  landingShapeOf,
  listGapTaskIds,
  looksLikeRelocation,
  seededRng as mulberry32,
  pairOne,
  parseArgs,
  parseBlamePorcelain,
  parseDiffHunks,
  parseNameOnlyLog,
  percentile,
  readTaskBodies,
  renderHuman,
  renderSample,
  sampleDeterministic
};
