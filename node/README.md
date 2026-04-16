# @good7ob/cli

Official Command Line Interface (CLI) for the good7ob platform.

## Installation

```bash
npm install -g @good7ob/cli
```

## Quick Start

### 1. Configure API Key

First, create an MCP API key in the good7ob web portal, then set it in the CLI:

```bash
good7ob config set api-key g7b_sk_your_api_key_here
good7ob config set endpoint http://localhost:9080  # Optional, defaults to good7ob prod
```

### 2. Project Management

```bash
# List projects
good7ob project list --page 1 --size 20

# Get project details
good7ob project get <project-id>

# Create a new project
good7ob project create --name "My Project" --description "Project description"
```

### 3. Task Management

```bash
# List tasks in a project
good7ob task list --project <project-id> --page 1 --size 20

# Get task details
good7ob task get <task-id>

# Create a new task
good7ob task create --project <project-id> --title "Task title" --description "Task description"
```

### 4. AI Work Record Management

```bash
# Create an AI work record
good7ob work-record create \
  --summary "Implemented Datadog logging configuration" \
  --agent "claude-4.5" \
  --output-path "/path/to/logback-*.xml" \
  --task-type "feature" \
  --status "success" \
  --token-usage 15000 \
  --duration-ms 3600000 \
  --project 5 \
  --tags "logging,datadog"

# List work records
good7ob work-record list --project 5 --agent claude --status success

# Get work record details
good7ob work-record get <record-id>

# Update a work record
good7ob work-record update <record-id> --status "completed" --result "completed"

# Delete a work record
good7ob work-record delete <record-id>

# Batch delete work records
good7ob work-record batch-delete <id1> <id2> <id3>

# Get statistics
good7ob work-record stats --project 5 --range week

# Export work records (JSON or CSV)
good7ob work-record export --project 5 --format csv --output records.csv
```

#### Work Record Fields

**Required:**
- `--summary`: Task summary (1-500 characters)
- `--agent`: AI agent name (e.g., claude, codex, gemini)
- `--output-path`: Output/document path (1-1000 characters)

**Optional:**
- `--task-type`: Type of task (feature, bugfix, refactor, docs, analysis)
- `--status`: Status (pending, in_progress, success, failed)
- `--result`: Result (completed, partial, failed)
- `--description`: Detailed description
- `--error-message`: Error message if task failed
- `--token-usage`: Number of tokens consumed
- `--duration-ms`: Execution duration in milliseconds
- `--model-version`: AI model version used
- `--project`: Associated project ID
- `--task`: Associated task ID
- `--user`: User ID
- `--tags`: Tags (comma-separated)
- `--remark`: Additional remarks
- `--completed-at`: ISO 8601 timestamp (default: current time)

#### Filtering Options (List Command)

```bash
# Filter by multiple criteria
good7ob work-record list \
  --project 5 \
  --agent "claude" \
  --task-type "feature" \
  --status "success" \
  --keyword "logging"

# Pagination
good7ob work-record list --page 2 --size 50
```

### 5. Batch Import

#### Import Projects

Create a JSON file `projects.json`:

```json
[
  {
    "name": "Project 1",
    "description": "First project"
  },
  {
    "name": "Project 2",
    "description": "Second project",
    "status": "ACTIVE"
  }
]
```

Then import:

```bash
good7ob import project --file projects.json
```

#### Import Cloud Resources

Create a JSON file `resources.json`:

```json
[
  {
    "resourceId": "i-1234567890",
    "resourceType": "EC2",
    "cloudProvider": "aws",
    "region": "us-east-1",
    "cost": 150.00,
    "environment": "prod",
    "applicationName": "api-service"
  }
]
```

Then import:

```bash
good7ob import resource --file resources.json
```

#### Import AI Work Records

Create a JSON file `work-records.json`:

```json
[
  {
    "summary": "Implemented feature X",
    "aiAgent": "claude",
    "taskType": "feature",
    "outputPath": "/docs/implementation.md",
    "status": "success",
    "result": "completed",
    "tokenUsage": 15000,
    "durationMs": 3600000,
    "projectId": 5,
    "completedAt": "2026-04-12T18:30:00Z"
  },
  {
    "summary": "Fixed bug in logging",
    "aiAgent": "claude",
    "taskType": "bugfix",
    "outputPath": "/commits/abc123",
    "status": "success",
    "result": "completed",
    "tokenUsage": 8000,
    "durationMs": 1800000,
    "projectId": 5,
    "tags": "logging,hotfix",
    "completedAt": "2026-04-12T17:00:00Z"
  }
]
```

Then import:

```bash
good7ob import work-record --file work-records.json
```

## Configuration

Configuration is stored in `~/.good7ob/config.json`.

```bash
# Show current configuration
good7ob config show

# Set API Key
good7ob config set api-key <your-api-key>

# Set custom endpoint
good7ob config set endpoint https://api.good7ob.com
```

## Output Format

All commands output JSON by default, making it easy to parse and integrate with scripts and other tools.

```bash
# Example output
good7ob project list | jq '.data[0].projectName'
```

## Command Aliases

For convenience, the CLI supports shorter aliases:

```bash
# work-record → wr
good7ob wr list --project 5
good7ob wr create --summary "..." --agent "claude" --output-path "..."
```

## For AI Agents

This CLI is designed to work seamlessly with AI agents. Use the `--file` option for file paths and pipe output to `jq` for structured data processing.

```bash
# Create a project and capture the ID
PROJECT_ID=$(good7ob project create --name "test" | jq '.id')

# List tasks for that project
good7ob task list --project $PROJECT_ID

# Create a work record after completing a task
RECORD=$(good7ob work-record create \
  --summary "Implemented feature XYZ" \
  --agent "claude" \
  --output-path "/path/to/implementation" \
  --project $PROJECT_ID \
  --token-usage 10000 \
  --status "success" | jq '.id')

echo "Created work record: $RECORD"
```

### Batch Recording for AI Workflows

```bash
# Script: record_ai_work.sh
#!/bin/bash

PROJECT_ID=$1
SUMMARY=$2
AGENT=$3
OUTPUT_PATH=$4

good7ob work-record create \
  --summary "$SUMMARY" \
  --agent "$AGENT" \
  --output-path "$OUTPUT_PATH" \
  --project $PROJECT_ID \
  --task-type "feature" \
  --status "success" \
  --completed-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## Troubleshooting

### Authentication Error

Make sure your API key is set correctly:

```bash
good7ob config show
```

### Connection Error

Check your endpoint configuration. Default is `http://localhost:9080` for local development.

```bash
good7ob config set endpoint http://localhost:9080
```

## License

MIT
