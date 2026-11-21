# syntax=docker/dockerfile:1
#
# ghcr.io/good7ob/runner (g7b #3634, design runner-onboarding B6 / 7.6): a hosted good7ob runner for one AI employee.
# good7ob CLI + Claude Code + git + gh. First start redeems G7B_ENROLL into the `runner` profile on the /data volume,
# every start after that runs `good7ob --profile runner agent listen`. Usage: docker/runner/README.md.
#
# Build from the repository root:
#   docker build -f docker/runner/Dockerfile -t ghcr.io/good7ob/runner:dev .
# The context is whitelisted by docker/runner/Dockerfile.dockerignore (no node_modules, dist or dev-env.json).

ARG NODE_IMAGE=node:22-slim

# ---- build: the CLI from this checkout, packed the way a release is installed ----
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
# no lifecycle scripts yet: `prepare` (tsc) needs the sources copied below
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json README.md ./
COPY src ./src
# dev-env.json would pin the install to a dev backend (src/services/flavor.ts); the image is a release install
RUN test ! -e dev-env.json \
 && mkdir /out \
 && npm pack --pack-destination /out \
 && mv /out/*.tgz /out/good7ob-cli.tgz

# ---- runtime ----
FROM ${NODE_IMAGE}

# Claude Code from npm, the way Anthropic's devcontainer feature and reference devcontainer install it (design B6).
# Pin with --build-arg CLAUDE_CODE_VERSION=<x.y.z> for a reproducible build.
ARG CLAUDE_CODE_VERSION=latest

LABEL org.opencontainers.image.title="good7ob runner" \
      org.opencontainers.image.description="Hosted good7ob runner: good7ob CLI + Claude Code, one AI employee per container" \
      org.opencontainers.image.source="https://github.com/good7ob/g7b-cli" \
      org.opencontainers.image.licenses="MIT"

# git / gh for the tasks (clone, branch, PR), tini as PID 1 so the agent's orphaned processes are reaped
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl git tini; \
    install -d -m 0755 /etc/apt/keyrings; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    chmod 0644 /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh; \
    rm -rf /var/lib/apt/lists/*; \
    # commits made by the agent need an identity; override per container with GIT_AUTHOR_* / GIT_COMMITTER_*
    git config --system user.name "good7ob runner"; \
    git config --system user.email "runner@good7ob.invalid"

RUN set -eux; \
    npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; \
    npm cache clean --force

COPY --from=build /out/good7ob-cli.tgz /tmp/good7ob-cli.tgz
# --omit=peer: ts-node's peer typescript is only for `npm run dev`, never loaded by dist/
RUN set -eux; \
    npm install -g --omit=peer --no-audit --no-fund /tmp/good7ob-cli.tgz; \
    rm /tmp/good7ob-cli.tgz; \
    npm cache clean --force; \
    test ! -e "$(npm root -g)/@good7ob/cli/dev-env.json"; \
    # smoke test in a throwaway HOME so nothing is left in the image's home
    tmp="$(mktemp -d)"; \
    HOME="$tmp" good7ob --version; \
    HOME="$tmp" claude --version; \
    rm -rf "$tmp"

COPY --chmod=0755 docker/runner/entrypoint.sh /usr/local/bin/g7b-runner-entrypoint

# non-root: the image's `node` user (uid 1000). HOME lives on the volume, so the profile (key, host id, env file,
# runner.log, runs/, work/) and Claude Code's own state survive container rebuilds.
RUN install -d -o node -g node -m 0755 /data \
 && install -d -o node -g node -m 0700 /data/home

ENV HOME=/data/home \
    GOOD7OB_PROFILE=runner \
    DISABLE_AUTOUPDATER=1

USER node
WORKDIR /data/home
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/g7b-runner-entrypoint"]
