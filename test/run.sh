#!/usr/bin/env bash
# Runs both suites. Needs node, and a chrome binary for the browser suite.
set -u
cd "$(dirname "$0")"
fail=0

echo "── parser ──"
node parse.test.js || fail=1

chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)
for suite in *.test.html; do
  echo
  echo "── ${suite%.test.html} ──"
  if [ -z "$chrome" ]; then
    echo "skipped (no chrome binary found)"
    continue
  fi
  out=$("$chrome" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=8000 \
        --allow-file-access-from-files --dump-dom "file://$PWD/$suite" 2>/dev/null \
        | python3 -c "import sys,re,html;t=sys.stdin.read();m=re.search(r'<pre id=\"out\">(.*?)</pre>',t,re.S);print(html.unescape(m.group(1)) if m else 'NO OUTPUT')")
  echo "$out" | grep -v '^PASS'
  echo "$out" | tail -1 | grep -q ' 0 failed' || fail=1
done

echo
[ $fail -eq 0 ] && echo "all green" || echo "FAILURES"
exit $fail
