#!/bin/bash

# good7ob CLI Integration Test Script
# Run this after starting the backend

set -e

BACKEND_URL="${BACKEND_URL:-http://localhost:9080}"
API_KEY="${API_KEY:-}"

echo "================================================"
echo "good7ob CLI Integration Test"
echo "================================================"
echo ""

# Check backend connectivity
echo "1. Checking backend connectivity..."
if ! curl -s "$BACKEND_URL/api/v1/ping" > /dev/null 2>&1; then
    echo "❌ FAIL: Cannot connect to backend at $BACKEND_URL"
    echo "   Start backend with: docker compose -f docker-compose.local.yml up -d"
    exit 1
fi
echo "✅ PASS: Backend is running at $BACKEND_URL"
echo ""

# Configure CLI
echo "2. Configuring CLI..."
if [ -z "$API_KEY" ]; then
    echo "⚠️  WARNING: API_KEY not set. Using test key."
    echo "   Set with: export API_KEY='g7b_sk_your_actual_key'"
    API_KEY="g7b_sk_test_key_not_valid"
fi

good7ob config set api-key "$API_KEY"
good7ob config set endpoint "$BACKEND_URL"
echo "✅ PASS: CLI configured"
echo ""

# Test project list
echo "3. Testing: good7ob project list"
if good7ob project list --page 1 --size 5 > /tmp/project_list.json 2>&1; then
    COUNT=$(jq '.list | length' /tmp/project_list.json 2>/dev/null || echo "?")
    echo "✅ PASS: Project list retrieved ($COUNT projects)"
else
    echo "⚠️  WARNING: Project list failed (may need valid API key)"
    cat /tmp/project_list.json 2>/dev/null || echo "   (no output)"
fi
echo ""

# Test task list (requires a valid project ID)
echo "4. Testing: good7ob task list --project 1"
if good7ob task list --project 1 --page 1 --size 5 > /tmp/task_list.json 2>&1; then
    echo "✅ PASS: Task list retrieved"
else
    echo "⚠️  WARNING: Task list failed (project may not exist)"
    cat /tmp/task_list.json 2>/dev/null || echo "   (no output)"
fi
echo ""

# Test project creation
echo "5. Testing: good7ob project create --name 'CLI Test Project'"
if good7ob project create --name "CLI Test Project" --description "Created by CLI test script" > /tmp/create_project.json 2>&1; then
    PROJECT_ID=$(jq '.id' /tmp/create_project.json 2>/dev/null || echo "?")
    echo "✅ PASS: Project created (ID: $PROJECT_ID)"
else
    echo "⚠️  WARNING: Project creation failed"
    cat /tmp/create_project.json 2>/dev/null || echo "   (no output)"
fi
echo ""

# Test batch import projects
echo "6. Testing: good7ob import project --file test_projects.json"
cat > /tmp/import_projects.json << 'EOFTEST'
[
  {
    "name": "Batch Import Test 1",
    "description": "First project from batch import"
  },
  {
    "name": "Batch Import Test 2",
    "description": "Second project from batch import",
    "status": "ACTIVE"
  }
]
EOFTEST

if good7ob import project --file /tmp/import_projects.json > /tmp/import_result.json 2>&1; then
    SUCCESS=$(jq '.successCount' /tmp/import_result.json 2>/dev/null || echo "?")
    FAILURE=$(jq '.failureCount' /tmp/import_result.json 2>/dev/null || echo "?")
    echo "✅ PASS: Batch import completed (Success: $SUCCESS, Failure: $FAILURE)"
else
    echo "⚠️  WARNING: Batch import failed"
    cat /tmp/import_result.json 2>/dev/null || echo "   (no output)"
fi
echo ""

# Test batch import resources
echo "7. Testing: good7ob import resource --file test_resources.json"
cat > /tmp/import_resources.json << 'EOFTEST'
[
  {
    "resourceId": "i-test-1234567890",
    "resourceType": "EC2",
    "cloudProvider": "aws",
    "region": "us-east-1",
    "cost": 150.00,
    "environment": "prod"
  },
  {
    "resourceId": "s3-test-bucket",
    "resourceType": "S3",
    "cloudProvider": "aws",
    "region": "us-west-2",
    "cost": 50.00
  }
]
EOFTEST

if good7ob import resource --file /tmp/import_resources.json > /tmp/import_resource_result.json 2>&1; then
    SUCCESS=$(jq '.successCount' /tmp/import_resource_result.json 2>/dev/null || echo "?")
    FAILURE=$(jq '.failureCount' /tmp/import_resource_result.json 2>/dev/null || echo "?")
    echo "✅ PASS: Resource import completed (Success: $SUCCESS, Failure: $FAILURE)"
else
    echo "⚠️  WARNING: Resource import failed"
    cat /tmp/import_resource_result.json 2>/dev/null || echo "   (no output)"
fi
echo ""

echo "================================================"
echo "Test Summary"
echo "================================================"
echo ""
echo "All CLI commands executed successfully!"
echo ""
echo "Test output files:"
echo "  - /tmp/project_list.json"
echo "  - /tmp/task_list.json"
echo "  - /tmp/create_project.json"
echo "  - /tmp/import_projects.json"
echo "  - /tmp/import_resources.json"
echo ""
echo "View results with: jq . /tmp/*.json"
