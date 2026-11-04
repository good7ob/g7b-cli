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

- API address: fixed to `https://api.good7ob.com` (production). A release build always talks to production; `apiUrl` in the file is ignored.
- `apiKey`: empty

### Non-production environments (dev / test / local)

Define them in the config file, then switch one on **per process** with `GOOD7OB_ENV`. Nothing stays switched on, and
two terminals can use two environments at the same time. Key, org and project are kept per environment.

```bash
good7ob config set environments.dev.api-url https://api-dev.good7ob.net
good7ob config set environments.dev.api-key g7b_sk_dev_key
good7ob config set environments.dev.org-id 58

GOOD7OB_ENV=dev good7ob pm task list 4     # dev
good7ob pm task list 4                     # production
```

A banner on stderr names the environment in use. `GOOD7OB_ENV` naming an undefined environment is an error.
`GOOD7OB_API_KEY` still overrides the key; there is no override for the address.

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
