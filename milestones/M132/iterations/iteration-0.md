## M132 iteration-0 — version-consistency CI job

Added 'version-consistency' job to .github/workflows/ci.yml.
Runs on every push: node --experimental-strip-types scripts/version-consistency-check.ts.
Fails build on version drift (non-zero exit). GREEN on current unified tree (exit 0).
