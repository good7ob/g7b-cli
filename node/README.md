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

### 4. Batch Import

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

## For AI Agents

This CLI is designed to work seamlessly with AI agents. Use the `--file` option for file paths and pipe output to `jq` for structured data processing.

```bash
# Create a project and capture the ID
PROJECT_ID=$(good7ob project create --name "test" | jq '.id')

# List tasks for that project
good7ob task list --project $PROJECT_ID
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
