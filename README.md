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
good7ob pm health --help
```

Project management commands for projects, tasks, workflows, reports, tags, and product health.

```bash
good7ob pm health 10                                   # KPIs: progress, scope vs baseline, velocity, ETA
good7ob pm health config set 10 --basis STORY_POINT --status-completion in_progress=40
good7ob pm health scope-change add 10 --delta -12.5 --reason "drop export"
good7ob pm health burnup 10 --from 2026-09-01           # table + text chart
good7ob pm health snapshots rebuild 10 --days 14
good7ob pm health forecast 10                          # P50/P80 completion dates ("数据不足" when history is too short)
good7ob pm health cost 10                              # budget vs actual vs progress, EAC
good7ob pm health budget set 10 --amount 10000000 --currency CNY --labor-rate 200 --token-price-per-million 7.5
good7ob pm health cost-entry add 10 --category cloud --amount 1200.50 --currency CNY --date 2026-09-01
good7ob pm health what-if 10 --add-scope 100 --deadline 2026-12-01   # simulation only, nothing is saved
good7ob pm health diagnosis 10                         # deterministic findings; `explain` adds AI commentary
good7ob pm health report generate 10 --period week     # then: report list 10 / report get 7 --out weekly.md
```

`pm health` also covers the workload basis config, the scope-change log, burnup and snapshot rebuild, plus progress intelligence: P50/P80 forecast, budget and cost entries, cost progress, what-if, diagnosis, AI explanation (AI-generated, needs human review) and management reports. See `FEATURES.md`.

### `idea`

```bash
good7ob idea list --product 3
good7ob idea get 12
good7ob idea solution add 12 --name "async export" --effort-backend 5 --cost 30000 --confidence medium --kpi "time:5h:2h:hours"
good7ob idea select 12 34 --reason "lowest cost"   # approves the idea, creates a requirement in the inbox
good7ob idea select 12 34 --reason "lowest cost" --require-approval   # files an approval instead; idea stays evaluating
good7ob idea comment add 12 --text "go with the backend option"
good7ob idea tag set 12 --tags backend,ai
good7ob idea merge 13 --into 12
good7ob idea generate 12 --count 3 --hints "reuse the export component"   # AI drafts 2-4 solutions (ESTIMATES; spends tokens)
good7ob idea correction 3                                                 # per-product estimate correction factors
good7ob idea change-set create 12 --title "order export rollout"
good7ob idea change-set analyze 5 && good7ob idea change-set item confirm 5 11
good7ob idea change-set submit 5                                          # files an approval
good7ob idea change-set apply 5                                           # creates tasks + trace links; documents are NOT edited
good7ob idea review start 12 && good7ob idea review metrics 12 --metric "NPS:40::pts"
good7ob idea review complete 12                                           # released -> validated
```

Idea pool: capture ideas, compare solutions with structured estimates, pick one (optionally through approval), collaborate with comments / attachments / tags / relations, merge duplicates, AI-generated solutions with historical estimate correction, change sets (impact analysis → approval → Apply into tasks) and post-release effect reviews. See `FEATURES.md`.

### `workspace`

```bash
good7ob workspace queue --limit 50 --status active --action-type PLAN_APPROVAL
good7ob workspace queue --action-type BUG_FIX          # bugs assigned to me
good7ob workspace queue counts
good7ob workspace queue snooze 501 --until +2h        # or an ISO time (no offset = UTC)
good7ob workspace queue approve 501 --comment "LGTM"   # decide in place: approval / task plan / task completion
good7ob workspace queue reject 502 --comment "out of scope"
good7ob workspace queue dismiss 503                    # also: done, reopen
good7ob workspace overview
good7ob workspace tasks --group waiting -p 1 --page-size 20
good7ob workspace products --scope following
good7ob workspace product follow 12                    # or unfollow
good7ob workspace orgs
good7ob workspace queue --sort score                  # highest priority score first (adds a score column)
good7ob workspace ai-team --status error              # my AI employees: state, tasks, queue, stats
good7ob workspace ai-team log 7 --from 2026-09-12 --to 2026-09-19
good7ob workspace daily-report generate --ai          # or: daily-report [--date d] to read the stored one
good7ob workspace next-actions --limit 10             # what to do first, with scores and reasons
```

What is waiting on you (approvals, info requests, blocked/paused tasks, alerts, requirements to triage, risks) with snooze / dismiss / done / reopen and in-place approve / reject, plus overview and your tasks, products and organizations, your AI team (state, work log), the AI daily report and ranked next actions. See `FEATURES.md`.

### `release`

```bash
good7ob release create --product 12 --name "v1.2 发布" --version 1.2.0 --end 2026-10-15
good7ob release tasks add 7 --task-ids 101,102,103
good7ob release start 7
good7ob release request-approval 7 --description "ready to ship"   # opens an approval
good7ob release baseline 7 --note "scope frozen"
good7ob release health 7
```

Plan a release, attach tasks, start it, ask for approval; baseline its scope and read its health/velocity. Approving is done with `approval`. See `FEATURES.md`.

### `approval`

```bash
good7ob approval list --mine              # pending requests I can decide
good7ob approval approve 31 --comment "LGTM"
good7ob approval reject 31 --comment "scope unclear"   # --comment is required
```

Decide, inspect or cancel approval requests. There is no create command: features open requests themselves (e.g. `release request-approval`, `prd request-approval`).

### `trace`

```bash
good7ob trace create --product 12 --source-type IDEA --source-id 5 --target-type REQUIREMENT --target-id 9 --link-type derived_from
good7ob trace list --product 12 --source-type IDEA --source-id 5
```

Directed trace links between product objects (idea → requirement → task → test). See `FEATURES.md`.

### `template`

```bash
good7ob template search -k login --type TASK --tag Vue --sort popular
good7ob template get 4                                # published version: content, variables, dependencies
good7ob template create --name "Login flow" --type TASK --tags vue,auth --content-file tasks.json --version 1.0.0
good7ob template version add 21 --version 1.1.0 --content-file tasks.json --variables-file vars.json --changelog "add estimates"
good7ob template diff 21 1.0.0 1.1.0
good7ob template version submit 21 1.1.0              # PRIVATE/ORG publish at once, PUBLIC goes to platform review
good7ob template dependency set 21 1.1.0 --file deps.json
good7ob template favorite 4 && good7ob template review add 4 --rating 5 --comment "saved a day"
good7ob template package create --name "Web starter" --item 4:^1.0.0 --item 9
good7ob template install 4 --org 3 --with-deps         # my installs: `template installed`, `template uninstall 4`
good7ob template deps 4 --org 3                        # missing / outdated / unavailable dependencies
good7ob template use 4 --org 3 --product 9 --module 55 --var feature=Login --dry-run   # preview, creates nothing
good7ob template use 4 --org 3 --product 9 --module 55 --var feature=Login             # tasks / module / release / test cases / PRD / workflow
good7ob template use 8 --org 3 --product 9 --var title=Login --out ./api.md            # document templates: body to a file
good7ob template package use 5 --org 3 --product 9 --var project_name=Shop --item 4:owner=Zhang
good7ob template instances --product 9 && good7ob template upgrade 31 --preview        # instances are never modified automatically
good7ob template admin reviews                        # platform admins only (see GOOD7OB_API_KEY below)
good7ob template admin reject 9 --reason "missing description"
```

Template Center: browse the catalog, manage personal / organization templates and their `x.y.z` versions (content and variables are validated locally against the server limits before upload), publish, favorite, review, bundle templates into packages, install and instantiate them (one server transaction; `--dry-run` previews with a local single-pass render, `--out` never overwrites without `--force`; instantiation is not idempotent, so after a timeout check `template instances` before retrying), get upgrade hints, and moderate public submissions. Admin commands need an admin-identity token: the CLI has no separate admin credential, so run them with `GOOD7OB_API_KEY=<admin token>`. See `FEATURES.md`.

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
good7ob qc testcase --help   # alias: qc tc
good7ob qc report --help

# Test case library (prd-0082)
good7ob qc tc list 12 --status Active --mode Automated
good7ob qc tc get 345
good7ob qc tc create --product-id 12 --title "Login succeeds" \
  --step "Submit valid credentials::Dashboard is shown" --priority P1 --rp 101,102
good7ob qc tc import e2e/features --product-id 12 --dry-run   # script path = path relative to --root (default .)
good7ob qc tc import e2e/features --product-id 12             # re-import updates cases with the same path + scenario
good7ob qc tc coverage 12          # uncovered RPs; --all for every RP
good7ob qc tc suites 12
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
