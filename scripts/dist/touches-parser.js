import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/touches-parser.ts
import fs from "node:fs";
import path2 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/touches-parser.ts
function stripTouchAnnotation(entry) {
  let s = String(entry);
  const t = s.trimEnd();
  const i = t.length - 1;
  if (t[i] === "\uFF09") {
    let depth = 0;
    let open = -1;
    for (let j = i; j >= 0; j--) {
      const c = t[j];
      if (c === "\uFF09") depth++;
      else if (c === "\uFF08" && --depth === 0) {
        open = j;
        break;
      }
    }
    if (open !== -1) {
      let k = open;
      while (k > 0 && /\s/.test(t[k - 1])) k--;
      s = t.slice(0, k);
    }
  }
  return s.replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function parseTouchEntries(touchesSection) {
  if (!touchesSection) return [];
  return touchesSection.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, "").trim()).map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()).map(stripTouchAnnotation).map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()).map((l) => l.replace(/^\.\//, "").trim()).filter(Boolean);
}
function tagFromAnnotation(text) {
  const a = String(text ?? "").trim().toLowerCase();
  if (a === "new") return "new";
  if (a === "delete" || a === "deleted") return "delete";
  return null;
}
function parseTouchEntriesWithTags(touchesSection) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    let entry = m[1].trim();
    entry = entry.replace(/^[`"'']+|[`"'']+$/g, "").trim();
    let tag = tagFromAnnotation(entry.match(/\s*\(([^)]*)\)\s*$/)?.[1]);
    if (!tag) {
      const beforeFullWidth = entry.match(/\s*\(([^)]*)\)\s*[（]/);
      tag = tagFromAnnotation(beforeFullWidth?.[1]);
    }
    const stripped = stripTouchAnnotation(entry);
    const cleaned = stripped.replace(/^[`"'']+|[`"'']+$/g, "").trim();
    const path3 = cleaned.replace(/^\.\//, "").trim();
    if (!path3) continue;
    out.push({ path: path3, tag });
  }
  return out;
}
var UNCERTAIN_TOUCH_ANNOTATION_RE = /若成|若作|若|或等价|或|可能|也许|待定|暂定|拟|说不定|未定/;
function isBareDirectoryTouch(p, root) {
  const s = String(p ?? "").replace(/^\.\//, "").trim();
  if (!s) return true;
  if (s.endsWith("/")) return true;
  if (/[*?]/.test(s)) return false;
  if (root) {
    try {
      const st = fs.statSync(path2.join(root, s));
      if (st.isDirectory()) return true;
      if (st.isFile()) return false;
    } catch {
    }
  }
  return !s.split("/").pop().includes(".");
}
function flagBareDirUncertainTouches(touchesSection, root) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    const entry = m[1].trim();
    const annM = entry.match(/(?:（([^）]*)）|\(([^)]*)\))\s*$/);
    if (!annM) continue;
    const annotation = (annM[1] ?? annM[2] ?? "").trim();
    if (!annotation || !UNCERTAIN_TOUCH_ANNOTATION_RE.test(annotation)) continue;
    const p = stripTouchAnnotation(entry);
    if (isBareDirectoryTouch(p, root)) out.push({ raw: entry, path: p, annotation });
  }
  return out;
}
function extractTouchesSection(fullText) {
  const lines = String(fullText).split(/\r?\n/);
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].trimEnd().match(/^(#{1,6})\s+(.*)$/);
    if (!heading) continue;
    const text = heading[2].trim();
    if (/^touches\b/i.test(text)) candidates.push({ line: i, level: heading[1].length, text });
  }
  if (candidates.length === 0) {
    return { hasSection: false, section: "", heading: null, startLine: null, level: null };
  }
  const exact = candidates.filter((c) => c.text.toLowerCase() === "touches");
  const chosen = exact.length ? exact[0] : candidates.slice().sort((a, b) => a.level - b.level || a.line - b.line)[0];
  const out = [];
  for (let i = chosen.line + 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (/^#{1,6}\s+/.test(line)) break;
    out.push(line);
  }
  return {
    hasSection: true,
    section: out.join("\n"),
    heading: chosen.text,
    startLine: chosen.line + 1,
    level: chosen.level
  };
}
if (isDirectEntry(import.meta, void 0, "touches-parser")) {
  process.stdout.write("Usage: touches-parser.ts is a shared module, not a CLI \u2014 import { parseTouchEntries, extractTouchesSection, stripTouchAnnotation } from it.\n");
}
export {
  UNCERTAIN_TOUCH_ANNOTATION_RE,
  extractTouchesSection,
  flagBareDirUncertainTouches,
  isBareDirectoryTouch,
  parseTouchEntries,
  parseTouchEntriesWithTags,
  stripTouchAnnotation
};
