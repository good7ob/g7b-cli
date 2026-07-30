# @good7ob/cli

Official command-line interface for the good7ob platform.

This repository currently contains the active TypeScript CLI implementation at the repository root (`src/` → `dist/`).

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

The CLI stores local configuration in:

```text
~/.good7ob/config.json
```

Default values:

- `apiUrl`: `https://api.good7ob.net`
- `apiKey`: empty

### Common config commands

```bash
# Set API base URL
good7ob config set api-url https://api.good7ob.net

# Set API key
good7ob config set api-key g7b_sk_your_api_key_here

# Read one value
good7ob config get api-url

# List current config (API key is masked)
good7ob config list

# Remove only the stored API key
good7ob config clear-credentials

# Reset config to defaults
good7ob config reset
```

> Note: the supported config keys are `api-url`, `api-key`, `user-id`, and `theme`.

## Command groups

Top-level help:

```bash
good7ob --help
```

### `config`

```bash
good7ob config --help
```

Manage local CLI configuration.

### `infra`

```bash
good7ob infra --help
good7ob infra resource --help
good7ob infra cost --help
good7ob infra bill --help
good7ob infra app --help
```

Manage cloud infrastructure, resources, costs, and billing.

### `pm`

```bash
good7ob pm --help
good7ob pm project --help
good7ob pm task --help
good7ob pm workflow --help
good7ob pm report --help
good7ob pm tag --help
```

Project management commands for projects, tasks, workflows, reports, and tags.

### `org`

```bash
good7ob org --help
```

Organization management commands for members, invitations, products, and subscriptions.

### `qc`

```bash
good7ob qc --help
```

Quality-control commands for bug tracking and QA reporting.

## Quick examples

### Project management

```bash
# List projects
good7ob pm project list

# Show one project
good7ob pm project get 123

# List tasks in a project
good7ob pm task list 123
```

### Infrastructure

```bash
# List cloud resources
good7ob infra resource list

# Show one resource
good7ob infra resource get i-1234567890
```

### Organization management

```bash
# List my organizations
good7ob org list

# Show one organization
good7ob org get 1001
```

### QA / QC

```bash
good7ob qc bug --help
good7ob qc report --help
```

## Build and test

```bash
npm run build
npm test
```

## Repository notes

- Active source code lives in the repository root under `src/`.
- Build output is generated under `dist/`.
- The historical `node/` directory is retained in the repository, but the root implementation is the current CLI entrypoint used by `package.json`.

## License

MIT
