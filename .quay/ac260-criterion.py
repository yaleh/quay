python3 - <<'P'
import re, subprocess, sys
BR = "dist-plugin"
try:
    files = subprocess.run(["git","ls-tree","-r","--name-only",BR],capture_output=True,text=True,check=True).stdout.split()
except Exception as e:
    sys.stderr.write("AC-260: cannot read branch %s (%s) => the marketplace delivery face is absent, so this AC has never been exercised\n" % (BR, e)); sys.exit(1)
fileset = set(files)
carriers = [f for f in files if f.rsplit(".",1)[-1] in ("md","sh","js")]
if not carriers:
    sys.stderr.write("AC-260: branch %s carries no .md/.sh/.js file => delivery face malformed, nothing to judge\n" % BR); sys.exit(1)
ANY_RE = re.compile(r'[A-Za-z0-9_${}/.-]*(scripts|gate-scripts)/dist/[A-Za-z0-9_.-]+\.js')
BAD_RE = re.compile(r'(^|[^A-Za-z0-9_${}.-])(\.?/)?plugin/(scripts|gate-scripts)/dist/[A-Za-z0-9_.-]+\.js')
TS_RE  = re.compile(r'\$\{CLAUDE_PLUGIN_ROOT\}/(scripts|gate-scripts)/([A-Za-z0-9_.-]+\.ts)')
total = 0
bad = []
dangling = []
for f in carriers:
    try:
        txt = subprocess.run(["git","show","%s:%s" % (BR, f)],capture_output=True,text=True,check=True).stdout
    except Exception:
        continue
    total += len(ANY_RE.findall(txt))
    for m in BAD_RE.finditer(txt): bad.append((f, m.group(0).strip()))
    for m in TS_RE.finditer(txt):
        tgt = "%s/%s" % (m.group(1), m.group(2))
        if tgt not in fileset: dangling.append((f, m.group(0), tgt))
if total == 0:
    sys.stderr.write("AC-260: zero scripts/dist/*.js references across %d carriers on %s => the scan matched nothing, so a zero offender count would carry no information (hard rule 3b: a predicate that cannot hit must not report PASS)\n" % (len(carriers), BR)); sys.exit(1)
if bad:
    sys.stderr.write("AC-260: %d of %d dist references on %s still carry a cwd-relative plugin/ prefix (first 3: %r) => in a consuming project the plugin IS the tree root, so these resolve to a path that does not exist there\n" % (len(bad), total, BR, bad[:3])); sys.exit(1)
if dangling:
    sys.stderr.write("AC-260: %d plugin-root-anchored raw .ts references on %s point at files the publish strip step deleted (first 3: %r) => sibling instance of the same defect, invisible to the cwd-relative predicate alone (hard rule 5b)\n" % (len(dangling), BR, dangling[:3])); sys.exit(1)
sys.exit(0)
P
