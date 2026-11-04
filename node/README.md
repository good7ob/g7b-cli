# @good7ob/cli

Official command-line interface for the good7ob platform.

> Note: the actively maintained CLI implementation now lives at the repository root (`src/` → `dist/`). This README is kept aligned for compatibility with the legacy `node/` subtree.

## Features

- `config` — manage local CLI configuration
- `infra` — cloud applications, resources, costs, and bills
- `pm` — projects, tasks, workflows, reports, and tags
- `org` — organizations, members, invitations, products, and subscriptions
- `qc` — QA / bug tracking and quality reports

## Requirements

- Node.js `>= 16`
- npm `>= 8`

## Local development

From the repository root:

```bash
npm install
npm run build
node dist/index.js --help
```

To make the command available globally from your local checkout:

```bash
npm link
good7ob --help
```

## Configuration

Configuration is stored in:

```text
~/.good7ob/config.json
```

Default values:

- API address: fixed to `https://api.good7ob.com` (production). It cannot be configured, and `apiUrl` in the file is ignored.
- `apiKey`: empty

### Dev / test installs

A release install always talks to production. To reach another environment, clone the repository a second time and mark
that clone as a dev install by creating `dev-env.json` next to `package.json` (it is git-ignored and not published):

```bash
echo '{"name":"dev","apiUrl":"https://api-dev.good7ob.net"}' > dev-env.json
npm install && npm run build
```

The dev clone talks to that address and keeps its own config and local state in `~/.good7ob-dev` (production uses
`~/.good7ob`), so the two never share a key, an org, a project or a work slot and can be used side by side on one machine.
A dev clone prints `[good7ob] 使用 dev 环境：<地址>` on stderr for every command. Give it its own command name, e.g.
`alias good7ob-dev='node /path/to/dev-clone/dist/index.js'`.

### Common config commands

```bash
good7ob config set api-key g7b_sk_your_api_key_here
good7ob config get api-key
good7ob config list
good7ob config clear-credentials
good7ob config reset
```

Supported config keys:

- `api-url`
- `api-key`
- `user-id`
- `theme`

## Top-level command groups

```bash
good7ob --help
good7ob config --help
good7ob infra --help
good7ob pm --help
good7ob org --help
good7ob qc --help
```

## Quick examples

```bash
# Projects
good7ob pm project list
good7ob pm project get 123

# Tasks
good7ob pm task list 123

# Infrastructure
good7ob infra resource list
good7ob infra resource get i-1234567890

# Organizations
good7ob org list
good7ob org get 1001
```

## Build and test

```bash
npm run build
npm test
```

## License

MIT
