#!/usr/bin/env bash
# Serial regression sweep. Whitelisted on purpose: `port-b1.mjs` / `port-events.mjs`
# are one-shot generators that overwrite hand-polished output, and the
# `pathprobe` / `physshowcase` / `showcase` scripts are interactive probes.
set -u
cd "$(dirname "$0")/.." || exit 1

SUITES=(
    mathtest rulestest combattest movetest crowdtest phystest occltest dirtest
    speedtest tasktest menutest assettest inputtest featuretest harvesttest
    maptest maptest2 buildingtest objecttest movetasktest attacktasktest
)

total=0
failed_suites=""
for s in "${SUITES[@]}"; do
    out=$(timeout 180 node "tools/$s.mjs" 2>&1)
    line=$(printf '%s\n' "$out" | grep -E "checks passed|passed,|RESULT +pass=" | tail -1)
    fails=$(printf '%s\n' "$out" | grep -c "^FAIL")
    [ -z "$line" ] && line="(no summary)"
    printf '%-16s %-34s FAIL=%s\n' "$s" "$line" "$fails"
    if [ "$fails" -gt 0 ]; then
        failed_suites="$failed_suites $s"
        printf '%s\n' "$out" | grep "^FAIL" | sed 's/^/    /'
    fi
    n=$(printf '%s' "$line" | grep -oE "[0-9]+" | head -1)
    [ -n "$n" ] && total=$((total + n))
done

printf '\nASSERTIONS TOTAL = %s\n' "$total"
if [ -n "$failed_suites" ]; then
    printf 'FAILED SUITES:%s\n' "$failed_suites"
    exit 1
fi
printf 'ALL GREEN\n'
