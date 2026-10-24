#!/usr/bin/env bash
set -eo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

if [ -z "$PREVIEW_URL" ]; then
  export PREVIEW_URL="http://127.0.0.1:4173"
fi

# Spec 18 also greps the served bundles for the EXACT server key when the runner
# exports it (read from the git-ignored .env; the value never enters the repo).
if [ -z "$ONDEMAND_API_KEY" ] && [ -f .env ]; then
  export ONDEMAND_API_KEY="$(grep -E '^ONDEMAND_API_KEY=' .env | head -1 | cut -d= -f2-)"
fi

# @playwright/test is a repo devDependency (package.json)
PW_CLI="node_modules/@playwright/test/cli.js"

echo "============================================================"
echo " Running Gods-Eye E2E acceptance suite against $PREVIEW_URL"
echo "============================================================"

mkdir -p tests/report/artifacts tests/report/html tests/report/screenshots

TEST_STATUS=0
node "$PW_CLI" test -c tests/playwright.config.mjs "$@" || TEST_STATUS=$?

echo ""
echo "============================================================"
echo " Test Results Matrix"
echo "============================================================"

RESULTS_FILE="tests/report/results.json"
if [ -f "$RESULTS_FILE" ]; then
  node -e "
    const fs = require('fs');
    try {
      const data = JSON.parse(fs.readFileSync('$RESULTS_FILE', 'utf8'));
      const suites = data.suites || [];
      const testMap = new Map();

      function walk(s) {
        if (s.suites) s.suites.forEach(walk);
        if (s.specs) {
          s.specs.forEach(spec => {
            const title = spec.title || '';
            const file = spec.file || '';
            const match = file.match(/(\d{2})-[^.]+/);
            const num = match ? match[1] : '??';
            const runs = spec.tests || [];
            let passed = false;
            let skipped = false;
            runs.forEach(t => {
              if (t.status === 'expected') passed = true;
              if (t.status === 'skipped') skipped = true;
              (t.results || []).forEach(r => {
                if (r.status === 'passed') passed = true;
                if (r.status === 'skipped') skipped = true;
              });
            });
            const status = passed ? 'pass' : (skipped ? 'skip' : 'fail');
            testMap.set(num, status);
          });
        }
      }
      suites.forEach(walk);

      for (let i = 1; i <= 18; i++) {
        const num = String(i).padStart(2, '0');
        const st = testMap.get(num) || 'unknown';
        console.log(\`test \${num}: \${st}\`);
      }
    } catch (e) {
      console.error('Failed to parse results.json:', e.message);
    }
  "
else
  echo "No results.json found at $RESULTS_FILE"
fi

DATE_STR="$(date +%Y-%m-%d)"
ARTIFACT_DIR="docs/agent-execution/artifacts/gods-eye-${DATE_STR}"
echo ""
echo "Copying test reports to ${ARTIFACT_DIR}..."
mkdir -p "$ARTIFACT_DIR"
if [ -d "tests/report" ]; then
  cp -r tests/report/* "$ARTIFACT_DIR/" 2>/dev/null || true
fi

echo "Done (exit code: $TEST_STATUS)."
exit "$TEST_STATUS"
