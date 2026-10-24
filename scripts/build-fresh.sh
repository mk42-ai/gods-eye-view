#!/usr/bin/env bash
# Fresh production build from the CURRENT checkout (2026-10-24).
#
# Root cause of the "old build served" incident: a sandbox was booted from a
# dist/ directory built from an earlier commit, so index.html + the hashed
# bundles it referenced were stale while HEAD was newer. This script is the
# only sanctioned way to produce dist/ for a deploy:
#   1. rm -rf dist (never reuse a previous output directory),
#   2. resolve BUILD_COMMIT = git short SHA of HEAD (or the caller's value),
#   3. vite build with that id injected (meta name=build-id, header badge,
#      /api/version, GEV_BUILD_ID define),
#   4. verify the emitted index.html carries exactly that id.
set -euo pipefail
cd "$(dirname "$0")/.."
export BUILD_COMMIT="${BUILD_COMMIT:-$(git rev-parse --short=9 HEAD 2>/dev/null || echo '')}"
if [ -z "$BUILD_COMMIT" ]; then
  echo "build-fresh: cannot resolve a build id (not a git checkout and BUILD_COMMIT unset)" >&2
  exit 2
fi
if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null || true)" ]; then
  echo "build-fresh: WARNING — working tree has uncommitted changes; build id $BUILD_COMMIT names HEAD, not the tree" >&2
fi
rm -rf dist
# `vite` is invoked through its package entry so the build does not depend on
# node_modules/.bin being populated (some installs leave it empty).
node scripts/refresh-celestrak-snapshot.mjs --skip-if-fresh 6 || true
node node_modules/vite/bin/vite.js build
served="$(grep -o '<meta name="build-id" content="[^"]*"' dist/index.html | sed 's/.*content="//; s/"$//')"
if [ "$served" != "$BUILD_COMMIT" ]; then
  echo "build-fresh: dist/index.html carries build id '$served', expected '$BUILD_COMMIT'" >&2
  exit 3
fi
echo "$BUILD_COMMIT" > dist/BUILD_ID
echo "build-fresh: dist/ built from $BUILD_COMMIT ($(ls dist/assets | grep -c '\.js$') hashed JS bundles)"
