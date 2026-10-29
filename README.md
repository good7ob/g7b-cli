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

## Time fields

The CLI sends `X-Time-Format: epoch-ms` on every request.

- Text output shows date-times as Asia/Tokyo (JST) wall time, `yyyy-MM-dd HH:mm:ss`, whatever the local time zone.
- `--json` passes the backend values through unchanged: date-time fields (`createdAt`, `updatedAt`, `completedAt`, `deadline`, ...) are **epoch milliseconds (a UTC instant)**, not JST strings. Convert with `new Date(ms)`, or add 9 hours for JST wall time. Date-only fields (`LocalDate`, e.g. `startDate` on some endpoints) stay `yyyy-MM-dd` strings.

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
good7ob pm activity --project 1 --since 0 --limit 100     # activity feed, cursor mode (footer gives nextSinceId)
good7ob pm activity --task 7                              # page mode
good7ob pm activity post --task 7 --summary "done, please review"
```

Project management commands for projects, tasks, workflows, reports, tags, product health and the task / project activity feed.

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
good7ob req add make orders exportable           # alias of idea create: title only, source pm, product from GOOD7OB_PRODUCT_ID
good7ob idea list --product 3
good7ob idea get 12
good7ob idea solution add 12 --name "async export" --effort-backend 5 --cost 30000 --confidence medium --kpi "time:5h:2h:hours"
good7ob idea select 12 34 --reason "lowest cost"   # approves the idea, generates a PRD session
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

What is waiting on you (approvals, info requests, blocked/paused tasks, alerts, risks) with snooze / dismiss / done / reopen and in-place approve / reject, plus overview and your tasks, products and organizations, your AI team (state, work log), the AI daily report and ranked next actions. See `FEATURES.md`.

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

Directed trace links between product objects (idea → PRD → task → test). See `FEATURES.md`.

### `template`

```bash
good7ob template search -k login --type TASK --tag Vue --sort popular
good7ob template get 4                                # published version: content, variables
good7ob template create --name "Login flow" --type TASK --tags vue,auth --content-file tasks.json --version 1.0.0
good7ob template version add 21 --version 1.1.0 --content-file tasks.json --variables-file vars.json --changelog "add estimates"
good7ob template diff 21 1.0.0 1.1.0
good7ob template version submit 21 1.1.0              # PRIVATE/ORG publish at once, PUBLIC goes to platform review
good7ob template favorite 4 && good7ob template review add 4 --rating 5 --comment "saved a day"
good7ob template package create --name "Web starter" --item 4:^1.0.0 --item 9
good7ob template install 4 --org 3                     # 指定模版 (specify); list: `template installed`, cancel: `template uninstall 4`
good7ob template use 4 --org 3 --product 9 --module 55 --var feature=Login --dry-run   # preview, creates nothing
good7ob template use 4 --org 3 --product 9 --module 55 --var feature=Login             # tasks / module / release / test cases / PRD / workflow
good7ob template use 8 --org 3 --product 9 --var title=Login --out ./api.md            # document templates: body to a file
good7ob template package use 5 --org 3 --product 9 --var project_name=Shop --item 4:owner=Zhang --item-opt 4:module=56
good7ob template instances --product 9 && good7ob template upgrade 31 --preview        # instances are never modified automatically
good7ob template admin reviews                        # platform admins only (see GOOD7OB_API_KEY below)
good7ob template admin reject 9 --reason "missing description"
```

Template Center: browse the catalog, manage personal / organization templates and their `x.y.z` versions (content and variables are validated locally against the server limits before upload), publish, favorite, review, bundle templates into packages, install and instantiate them (one server transaction; `--dry-run` previews with a local single-pass render, `--out` never overwrites without `--force`; instantiation takes an idempotency key (`--idempotency-key`, auto-generated otherwise), so after a timeout retry with the same key and the server returns the first result instead of creating again), get upgrade hints, and moderate public submissions. Admin commands need an admin-identity token: the CLI has no separate admin credential, so run them with `GOOD7OB_API_KEY=<admin token>`. See `FEATURES.md`.

### `org`

```bash
good7ob org --help
good7ob org ai-employee capabilities 58
good7ob org ai-employee profile 58 7 --role DEVELOPER --tools task_read,comment --products 10
good7ob org ai-employee key issue 58 7                    # raw key printed once; then `good7ob config set api-key <key>`
good7ob org ai-employee key disable 58 7                  # or: enable, regenerate
```

Organization management commands for members, invitations, products, subscriptions and AI employees (CLI/MCP key, profile, capability catalogue).

### `whoami`

```bash
good7ob whoami
```

Who the configured API key acts as: a user, or an AI employee (id, nickname, org, role, capabilities, product scope). See `FEATURES.md`.

### `habit`

My work habits and personal workflows (prd-0127 FP-7; endpoints `/api/v1/me/work-habits`, `/me/work-workflows`). Acts as the logged-in user only. Starting a workflow run is not a CLI command — runs are started only by an Agent / AI employee via MCP. `--json` prints the raw `data` (`remove` prints `{id, removed:true}`, `reject` prints `{id, rejected:true}`).

```bash
good7ob habit list [--category PROCESS|CODE|COMMUNICATION|TOOL|OTHER] [--level STABLE|LOCAL] [--source MANUAL|AI_EXTRACTED] [--status ENABLED|DISABLED] [--keyword <text>]
good7ob habit add --title "汇报用中文" --content "回复和完成汇报一律用中文" --category COMMUNICATION [--level STABLE]
good7ob habit edit <id> [--title ..] [--content ..] [--category ..] [--level ..] [--version <n>]
good7ob habit enable <id> | disable <id> | remove <id> [--yes]
good7ob habit export [--out habits.md] [--scope enabled|filtered] [--include-workflows|--workflows]   # Markdown to stdout or file (--out/--file overwrites)
good7ob habit candidates | confirm <id> [--title ..] | reject <id>

good7ob habit workflow list [--scene daily|task] | show <id> | enable <id> | disable <id> | default <id> | remove <id> [--yes]
good7ob habit workflow add --name 每日开工 --scene daily --step 看待办 --step 定三件事   # or --from-file steps.json|yaml
good7ob habit workflow edit <id> [--name ..] [--step ..] [--from-file ..] [--version <n>]
```

See `FEATURES.md` (habit) for the file format, error codes and rules.

### `agent`

Lets the machine a local agent (Hermes / Claude Code / Codex) runs on pull good7ob AI tasks. One work slot per machine (`~/.good7ob/agent-state.json`): no new claim while a task is busy; past `estimatedHours` (or `agent.expectedMinutes`) it is `timeout`, and past that plus `agent.graceMinutes` it is released back to the queue. A task the agent moved out of `in_progress` (plan submitted, question asked, done) frees the slot without a release.

```bash
# Forward claimed tasks to a Hermes webhook (HMAC-signed) — or use agent.forward.command instead
good7ob config set agent.forward.url http://127.0.0.1:8644/webhooks/good7ob-task
good7ob config set agent.forward.secret <secret>
# good7ob config set agent.forward.command 'claude -p "处理 good7ob 任务 {taskId}"'   # only {taskId}/{taskNo}

good7ob agent listen [--interval 15] [--once]   # poll → claim → forward
good7ob agent next [--json]                     # for agents that pull: exit 3 = busy, 4 = queue empty
good7ob agent done <taskId> [--status completed]
good7ob agent status
good7ob agent reset [--release]
```

Other settings: `agent.intervalSeconds` (15), `agent.expectedMinutes` (60), `agent.graceMinutes` (30), `agent.projectId`.

### `qc`

```bash
good7ob qc --help
```

Quality-control commands for bug tracking and QA reporting.

### `schema`

Load a live PostgreSQL schema into Forge DB Schema Design (`/forge/schema/*`: module → table → column). Tables are grouped into modules by name prefix (`forge_`, `pm_`, …; unmatched → `其他`). Table/column DB comments become descriptions, and singular/plural pairs such as `pm_task`/`pm_tasks` are flagged `疑似重复`. The import is idempotent: it creates what is missing and updates what changed, and it never deletes. Writes need the `owner`/`admin` role in the org.

```bash
# 1. Export (no DB driver in the CLI; psql runs the query)
good7ob schema export-sql --db-schema good7ob_dev | psql "$DATABASE_URL" -At > schema.json

# 2. Preview grouping, then plan against the org, then write
good7ob schema import --file schema.json --parse-only
good7ob schema import --org 58 --file schema.json --dry-run
good7ob schema import --org 58 --file schema.json
```

A table already registered under a different module is skipped and listed: table names are unique per org, and the API can't move a table between modules.

## Quick examples

### Project management

```bash
# List projects
good7ob pm project list

# Show one project
good7ob pm project get 123

# List tasks in a project
good7ob pm task list 123

# Task dependencies (same project, no cycles; types finish_to_start | start_to_start)
good7ob pm task dep list 1851
good7ob pm task dep add 1851 --on 1850            # 1851 depends on 1850
good7ob pm task dep remove 1851 --on 1850

# Estimate vs actual (time / tokens / cost; cost only shown when you may see it)
good7ob pm task time 1950
good7ob pm task estimate set 1950 --hours 1.5 --tokens 400000 --reason "re-estimate"   # also --seconds, --model, --source
good7ob pm task estimate list 1950
good7ob pm task estimate clear 1950 --reason "cancelled"
good7ob pm task effort add --task 1950:2 --task 1951:1 --work 1h30m --note "pairing"   # one session over several tasks (weights)
good7ob pm task effort list 1950
good7ob pm task effort void 301 --reason "duplicate"
good7ob pm task effort reallocate manual:<session-id> --task 1950:1 --task 1952:1 --reason "missed a task"
good7ob pm project time-deviation 12 --executor-type AGENT --only-completed

# Set expected completion day (independent of the deadline)
good7ob pm task update 456 --planned-end-date 2026-10-25

# Set both planned dates, on update or create
good7ob pm task update 456 --planned-start-date 2026-10-20 --planned-end-date 2026-10-25
good7ob pm task create --project-id 123 --name "Scheduled task" --planned-end-date 2026-10-25

# View planned dates
good7ob pm task get 456
```

Task planned dates use `YYYY-MM-DD` (Asia/Tokyo), with day precision. Invalid dates
and reversed ranges are rejected. Omitted dates remain unchanged on update; when
only one date is provided, the server validates it against the existing other date.

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
good7ob qc tc create-batch cases.json --product-id 12 --dry-run   # [{suite:"A/B", title, steps, ...}]
good7ob qc tc create-batch cases.json --product-id 12             # missing suites are created; --skip N resumes
good7ob qc tc coverage 12          # uncovered RPs; --all for every RP
good7ob qc tc suites 12
```

### Test runs (`test-run`, alias of `qc run upload|latest`)

One call imports a whole report: `POST /qc/runs/import` starts the run, reports every result, uploads the screenshots and finishes it (failed results open bugs, the run is attached to the automation step). Use `qc run start / report / attach / finish` for step-by-step reporting.

```bash
# Playwright JSON or JUnit XML (format detected from extension + content; --format playwright|junit|g7b to force)
good7ob test-run upload --project 7 --type e2e --report playwright-report.json --screenshots test-results \
  [--run <runId> --step <stepId>] [--task <id>] [--test-round <planId>] [--env dev|test|staging|prod] [--build <sha>] [--auto-bug] [--json]
good7ob test-run latest --step 32          # or --task <id> / --project <id>; --json for the raw run
```

- `--type` is `unit|api|e2e|regression`; with `--run/--step` the source is `AUTOMATION_STEP`, otherwise `CLI`.
- Screenshots: the directory is walked recursively; only png/jpg/gif/webp are sent, files over 20 MB are skipped with a warning, 200 MB per upload and 20 per case at most. Files are matched to cases through the Playwright report's attachment paths (absolute path, or result-folder/file name when the report came from another machine); unmatched files are sent as `<folder>__<file>` so the server can match them by scenario prefix.
- Report ≤ 20 MB and ≤ 2000 results (split larger runs). Exit code: 0 all passed, 2 uploaded with failures, 1 argument / parse / upload error.

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
