# AI Work Record CLI Guide

The `work-record` command group provides a comprehensive interface for recording, managing, and analyzing AI agent work in the good7ob platform.

## Quick Start

### 1. Basic Work Record Creation

```bash
# Simple record - minimum required fields
good7ob work-record create \
  --summary "Implemented authentication module" \
  --agent "claude" \
  --output-path "/docs/auth-implementation.md"
```

### 2. Detailed Work Record with Metrics

```bash
# Full record with performance metrics
good7ob work-record create \
  --summary "Optimized database queries" \
  --agent "claude-4.5" \
  --output-path "/commits/db-optimization" \
  --task-type "performance" \
  --status "success" \
  --result "completed" \
  --token-usage 12500 \
  --duration-ms 1800000 \
  --project 5 \
  --tags "database,performance,optimization"
```

### 3. Work Record with Error Handling

```bash
# Record failed task with error details
good7ob work-record create \
  --summary "Database migration" \
  --agent "claude" \
  --output-path "/logs/migration.log" \
  --task-type "devops" \
  --status "failed" \
  --result "failed" \
  --error-message "Connection timeout after 30s retry" \
  --project 5
```

## Common Use Cases

### Recording Daily AI Work

```bash
# End of day: Record all completed tasks
good7ob work-record create \
  --summary "Daily standup: feature development" \
  --agent "claude" \
  --output-path "/dailies/2026-04-12.md" \
  --task-type "feature" \
  --token-usage 45000 \
  --project 5 \
  --tags "daily,standup"

good7ob work-record create \
  --summary "Code review for PR #123" \
  --agent "claude" \
  --output-path "/pr-reviews/pr-123.md" \
  --task-type "review" \
  --token-usage 8000 \
  --project 5
```

### Recording a Development Session

```bash
# Start of session
PROJECT_ID=5
SESSION_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# [Developer works for 2 hours on feature X]

# End of session: Record work
good7ob work-record create \
  --summary "Implemented user authentication with OAuth2" \
  --agent "claude" \
  --output-path "/features/oauth2-auth" \
  --task-type "feature" \
  --status "success" \
  --result "completed" \
  --token-usage 42000 \
  --duration-ms 7200000 \
  --project $PROJECT_ID \
  --completed-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --tags "auth,oauth2,feature" \
  --remark "Ready for code review"
```

### Recording Bug Fixes

```bash
# Simple bug fix
good7ob work-record create \
  --summary "Fixed: Memory leak in cache manager" \
  --agent "claude" \
  --output-path "/fixes/cache-leak.patch" \
  --task-type "bugfix" \
  --status "success" \
  --result "completed" \
  --project 5 \
  --tags "bugfix,critical" \
  --remark "All tests passing, ready to merge"

# Complex bug fix with investigation
good7ob work-record create \
  --summary "Debug and fix: Race condition in payment processing" \
  --agent "claude" \
  --output-path "/investigation/payment-race.md" \
  --task-type "bugfix" \
  --status "success" \
  --result "completed" \
  --token-usage 28000 \
  --duration-ms 5400000 \
  --project 5 \
  --description "Identified race condition between transaction creation and confirmation. Added mutex lock and transaction timeout." \
  --tags "bugfix,critical,payment"
```

### Recording Documentation Work

```bash
# Documentation task
good7ob work-record create \
  --summary "Updated API documentation for v2.0" \
  --agent "claude" \
  --output-path "/docs/api-v2.0.md" \
  --task-type "docs" \
  --status "success" \
  --result "completed" \
  --project 5 \
  --tags "documentation,api" \
  --remark "Includes examples and migration guide"
```

### Recording Code Review Sessions

```bash
# Code review task
good7ob work-record create \
  --summary "Code review: Authentication module refactoring (PR #456)" \
  --agent "claude" \
  --output-path "/reviews/pr-456-comments.md" \
  --task-type "review" \
  --status "success" \
  --result "completed" \
  --token-usage 6500 \
  --project 5 \
  --tags "review,code-review" \
  --remark "Approved with 3 suggestions for improvement"
```

## Querying Work Records

### List All Records

```bash
# List all work records
good7ob work-record list

# List with pagination
good7ob work-record list --page 1 --size 50
```

### Filter by Agent

```bash
# All work by Claude agent
good7ob work-record list --agent "claude"

# All work by multiple agents
good7ob work-record list --page 1 --size 100
```

### Filter by Task Type

```bash
# All feature work
good7ob work-record list --task-type "feature"

# All bug fixes
good7ob work-record list --task-type "bugfix"

# Combine filters
good7ob work-record list --agent "claude" --task-type "feature" --status "success"
```

### Filter by Project

```bash
# All work for project 5
good7ob work-record list --project 5

# All successful work for project 5
good7ob work-record list --project 5 --status "success"
```

### Search by Keyword

```bash
# Search for specific topics
good7ob work-record list --keyword "authentication"
good7ob work-record list --keyword "database" --status "success"
```

### Combined Filtering

```bash
# Complex query: All successful feature work by Claude on project 5
good7ob work-record list \
  --project 5 \
  --agent "claude" \
  --task-type "feature" \
  --status "success" \
  --page 1 \
  --size 20
```

## Getting Statistics

### Overall Statistics

```bash
# All-time statistics
good7ob work-record stats

# Project-specific statistics
good7ob work-record stats --project 5

# User-specific statistics
good7ob work-record stats --user 123
```

### Time-Range Statistics

```bash
# Today's statistics
good7ob work-record stats --range today

# This week's statistics
good7ob work-record stats --range week

# This month's statistics
good7ob work-record stats --range month

# Last month's statistics
good7ob work-record stats --range lastMonth
```

### Combined Statistics

```bash
# Project statistics for this week
good7ob work-record stats --project 5 --range week

# User statistics for this month
good7ob work-record stats --user 123 --range month
```

## Updating Records

### Correct a Record

```bash
# Fix typo or incorrect info
good7ob work-record update <record-id> \
  --summary "Corrected summary text"
```

### Add Missing Information

```bash
# Add metrics after the fact
good7ob work-record update <record-id> \
  --token-usage 15000 \
  --duration-ms 3600000
```

### Change Status

```bash
# Mark task as completed
good7ob work-record update <record-id> \
  --status "success" \
  --result "completed"

# Mark task as failed with reason
good7ob work-record update <record-id> \
  --status "failed" \
  --result "failed" \
  --error-message "Deployment failed due to disk space"
```

### Update Tags and Remarks

```bash
# Add additional tags
good7ob work-record update <record-id> \
  --tags "urgent,high-priority" \
  --remark "Escalated to P1 due to production impact"
```

## Deleting Records

### Delete Single Record

```bash
# Soft delete (can be recovered)
good7ob work-record delete <record-id>
```

### Batch Delete Multiple Records

```bash
# Delete multiple records
good7ob work-record batch-delete 123 456 789

# Example: Delete all failed records for a project
# (would typically use a script to generate the IDs)
good7ob work-record batch-delete $(
  good7ob work-record list --project 5 --status "failed" \
    | jq -r '.records[].id' | tr '\n' ' '
)
```

## Exporting Data

### Export to JSON

```bash
# Export to file
good7ob work-record export --project 5 --output records.json

# Export all records (default JSON)
good7ob work-record export
```

### Export to CSV

```bash
# Export as CSV
good7ob work-record export --project 5 --format csv --output records.csv

# Export all records of a specific agent as CSV
good7ob work-record export --agent "claude" --format csv --output claude-work.csv
```

### Export for Analysis

```bash
# Export and process with jq
good7ob work-record list --project 5 | jq '.records | group_by(.aiAgent) | map({agent: .[0].aiAgent, count: length})'

# Export and calculate average token usage
good7ob work-record list --project 5 | jq '[.records[].tokenUsage] | add / length'

# Export and find slowest tasks
good7ob work-record list --project 5 | jq '.records | sort_by(.durationMs) | reverse | .[0:10]'
```

## Advanced Workflows

### Automated Record Creation from Build Logs

```bash
#!/bin/bash
# Script: auto_record_build.sh

BUILD_ID=$1
PROJECT_ID=$2
AGENT=${3:-claude}

# Get build info
BUILD_LOG="/var/log/builds/$BUILD_ID.log"
BUILD_TIME=$(stat -c %Y $BUILD_LOG)
BUILD_STATUS=$(grep "BUILD_STATUS=" $BUILD_LOG | tail -1 | cut -d= -f2)

# Record the build work
good7ob work-record create \
  --summary "Build #$BUILD_ID" \
  --agent "$AGENT" \
  --output-path "$BUILD_LOG" \
  --task-type "ci" \
  --status "$BUILD_STATUS" \
  --result "completed" \
  --project $PROJECT_ID \
  --completed-at "$(date -d @$BUILD_TIME -u +%Y-%m-%dT%H:%M:%SZ)"
```

### Batch Recording from Git History

```bash
#!/bin/bash
# Script: record_commits.sh
# Record commits from the last N hours

HOURS=${1:-24}
PROJECT_ID=${2:-5}
AGENT=${3:-claude}

git log --since="$HOURS hours ago" --pretty=format:"%H|%s|%ai" | while IFS='|' read commit message timestamp; do
  good7ob work-record create \
    --summary "$(echo $message | cut -c 1-100)" \
    --agent "$AGENT" \
    --output-path "https://github.com/good7ob/repo/commit/$commit" \
    --task-type "code-change" \
    --status "success" \
    --project $PROJECT_ID \
    --completed-at "$(date -d "$timestamp" -u +%Y-%m-%dT%H:%M:%SZ)"
done
```

### Performance Tracking Dashboard

```bash
#!/bin/bash
# Script: performance_dashboard.sh

PROJECT_ID=${1:-5}

echo "=== AI Work Record Performance Dashboard ==="
echo ""

echo "Total Records:"
good7ob work-record stats --project $PROJECT_ID | jq '.totalRecords'

echo "Success Rate:"
good7ob work-record stats --project $PROJECT_ID | jq '.successRate'

echo "Average Duration (minutes):"
good7ob work-record stats --project $PROJECT_ID | jq '.avgDuration / 60000'

echo "Total Tokens Used:"
good7ob work-record stats --project $PROJECT_ID | jq '.totalTokenUsage'

echo ""
echo "Top AI Agents:"
good7ob work-record list --project $PROJECT_ID --page 1 --size 1000 | \
  jq '[.records[].aiAgent] | group_by(.) | map({agent: .[0], count: length}) | sort_by(-.count) | .[0:5]'

echo ""
echo "Records by Task Type:"
good7ob work-record list --project $PROJECT_ID --page 1 --size 1000 | \
  jq '[.records[].taskType] | group_by(.) | map({type: .[0], count: length}) | sort_by(-.count)'
```

## Tips & Best Practices

### 1. Always Include Summary

Keep summaries concise but descriptive (1-500 characters):
- ✅ Good: "Implemented JWT authentication with refresh token support"
- ❌ Bad: "work" or "stuff"

### 2. Use Consistent Agent Names

- `claude`, `claude-4.5`, `claude-sonnet`
- `codex`, `gemini`, `copilot`
- `custom-agent-name`

### 3. Be Specific with Task Types

- `feature` - New feature implementation
- `bugfix` - Bug fix
- `refactor` - Code refactoring
- `docs` - Documentation
- `analysis` - Research/analysis
- `review` - Code review
- `ci` - CI/CD related
- `devops` - DevOps/Infrastructure

### 4. Record Metrics When Available

Include token usage and duration for performance tracking:
```bash
--token-usage <number> --duration-ms <milliseconds>
```

### 5. Use Tags for Organization

Combine tags with hyphens or underscores:
- `logging`, `security`, `performance`
- `critical`, `high-priority`
- `frontend`, `backend`, `database`

### 6. Include Remarks for Context

Add remarks for important context:
```bash
--remark "Ready for code review" 
--remark "Blocked by PR #123"
--remark "Requires database migration"
```

### 7. Use Correct Timestamps

Records default to current time. For past work:
```bash
--completed-at "2026-04-12T15:30:00Z"
```

## JSON Output Format

All commands output valid JSON for easy scripting:

```json
{
  "id": 1,
  "summary": "Implemented feature X",
  "aiAgent": "claude",
  "taskType": "feature",
  "status": "success",
  "result": "completed",
  "outputPath": "/path/to/file",
  "tokenUsage": 15000,
  "durationMs": 3600000,
  "projectId": 5,
  "completedAt": "2026-04-12T18:30:00Z",
  "createdAt": "2026-04-12T18:35:00Z",
  "updatedAt": "2026-04-12T18:35:00Z"
}
```

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `Summary must be 1-500 characters` | Summary too long/short | Use `--summary "..."` with proper length |
| `AI agent name is required` | Missing `--agent` | Add `--agent <name>` |
| `Output path must be 1-1000 characters` | Path too long | Use shorter path or shorten with variables |
| `Cannot connect to backend` | Wrong endpoint | Run `good7ob config set endpoint <url>` |
| `API Error [401]` | Invalid API key | Run `good7ob config set api-key <key>` |

## Version History

- **0.2.0** (2026-04-12): Added work-record command group
- **0.1.0** (2026-04-01): Initial release with project, task, and import commands
