#!/usr/bin/env bash
# Sanctioned ui-validator ONLY; does NOT start render jobs, type, or use CDP.
# Invoke from the SESSION WORKSPACE so screenshots land at ./.ui-proof.
set -eu
URL=${1:?Usage: bash gods-eye-view/scripts/qa-geopatch-ui.sh PREVIEW_URL LABEL}
LABEL=${2:?Choose a unique label; evidence logs will not be overwritten}
case "$LABEL" in *[!a-zA-Z0-9_-]*|'') echo 'Unsafe label' >&2; exit 2;; esac
HERE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SKILL=${UI_VALIDATOR_SCRIPT:-/home/appuser/.agents/skills/ui-validator/scripts/ui_validate.py}
if [ ! -f "$SKILL" ]; then
  SKILL="$HERE/../.goose/skills/ui-validator/scripts/ui_validate.py"
fi
if [ ! -f "$SKILL" ]; then echo 'Load ui-validator first; helper unavailable' >&2; exit 2; fi
OUT="$HERE/ops/cycle-geopatch/$LABEL"
mkdir "$OUT" # refuse a second run in same log directory
status=0
for scenario in yas kanes; do
  if [ "$scenario" = yas ]; then PROMPT='Car crash outside Yas Mall'; else PROMPT="Kane's Boxing Gym, Abu Dhabi"; fi
  TARGET=$(python3 - "$URL" "$PROMPT" <<'PY'
import sys,urllib.parse as u
p=u.urlsplit(sys.argv[1]);q=u.parse_qsl(p.query,keep_blank_values=True)
q=[(k,v) for k,v in q if k!='prompt']+[("prompt",sys.argv[2])]
print(u.urlunsplit((p.scheme,p.netloc,p.path,u.urlencode(q),p.fragment)))
PY
)
  EXACT=$(python3 - "$PROMPT" <<'PY'
import json,sys
print("document.querySelector('#ws-prompt')?.value === "+json.dumps(sys.argv[1]))
PY
)
  for viewport in 1440x900 390x844; do
    START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    code=0
    python3 "$SKILL" --url "$TARGET" --label "$LABEL-$scenario" --viewport "$viewport" \
      --wait-selector '#ws-app' --expect-selector '#ws-aoi' --expect-selector '#ws-evidence' \
      --expect-selector '#ws-camera' \
      --eval "document.querySelector('#ws-prompt')?.tagName === 'TEXTAREA'" \
      --eval "!document.querySelector('img.ws-frame') || document.querySelector('img.ws-frame').naturalWidth > 0" \
      --eval "$EXACT" \
      --eval "innerWidth === ${viewport%x*} && innerHeight === ${viewport#*x}" \
      >"$OUT/$scenario-$viewport.json" 2>"$OUT/$scenario-$viewport.stderr" || code=$?
    printf '%s\t%s\t%s\t%s\t%s\n' "$START" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$scenario" "$viewport" "$code" >>"$OUT/executions.tsv"
    if [ "$code" -ne 0 ]; then status=1; fi
  done
done
exit "$status"
