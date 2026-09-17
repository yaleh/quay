# quay CI runner image — the reproducible definition of the tokyo-alpha `test` job's host.
#
# Why this file exists (tasks/gap-ac282-runner-prereqs-already-present, GOAL-022 scope item 3
# 「自定义 runner 镜像消除重复装包」): the `test` job runs on an **ephemeral** self-hosted runner
# container. `gh-runner-quay.service` starts it with `--rm` + `ExecStartPre=docker rm -f` +
# `Restart=always` + `EPHEMERAL=true` ⇒ the runner registers, takes ONE job, exits, and systemd
# starts a fresh container **from the same image** ~5s later. Anything installed inside the job is
# discarded with the container, so the `Install suite runtime prerequisites` step in ci.yml
# re-installs PyYAML and tmux **on every single job**. Measured 2026-09-17: that step cost 8s out
# of a 30s target for the test job (26.7%).
#
# ⛔ The fix cannot live in the workflow: a step inside the job runs *after* the container was
# created, so it can never change what the next job starts from. The only place that eliminates
# the repeat cost is **the image itself** — which is what this file is.
#
# ⛔ The ci.yml provisioning step is deliberately KEPT (all its branches, including the apt/pip
# installs): it is the fail-closed guarantee for a runner whose image is not this one (a rebuild, a
# revert to `myoung34/github-runner:latest`, a second runner host). On this image it simply takes
# its no-op branch, which is what `.github/workflows/ci.yml`'s `__PREREQ__` markers record.
# `plugin/test/ci-runner-env-prereqs.test.mjs` asserts that recipe still exists.
#
# Build + deploy (tokyo-alpha; GOAL-022 pins development to boheidc, so the host-side action is
# runner deployment only):
#   docker build -t quay-ci-runner:ac282 .github/runner
#   # then point gh-runner-quay.service's ExecStart at that tag (one line), daemon-reload, restart,
#   # and check `gh api /repos/yaleh/quay/actions/runners` still shows tokyo-alpha-1 online.
#
# procps (ps/pgrep) is already in the base image, but it is named explicitly anyway: a base-image
# bump must not silently drop an undeclared prerequisite of the suite (full-suite-runner.ts reads
# `pgrep -c -f 'full-suite-runner\.ts'`, and the process-reaper tests shell out to `ps`).
FROM myoung34/github-runner:latest

RUN apt-get update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      python3-yaml \
      tmux \
      procps \
 && rm -rf /var/lib/apt/lists/*

# Fail the BUILD — not a future job — if a prerequisite did not actually land. A build that
# succeeds while the image is missing a prerequisite would reproduce exactly the failure mode this
# image exists to remove (a pile of environment-shaped test failures that read as product defects).
RUN python3 -c 'import yaml; print("PyYAML", yaml.__version__)' \
 && command -v tmux \
 && command -v pgrep \
 && command -v ps
