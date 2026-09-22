#!/bin/bash
# Fake SMC used by CLI tests. It never talks to hardware.
set -euo pipefail

STATE="${SMC_STATE_DIR:?}"
FAIL="${SMC_FAIL_WRITE_KEYS:-}"
key=""
mode=""
value=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		-k)
			key="$2"
			shift 2
			;;
		-r)
			mode="read"
			shift
			;;
		-w)
			mode="write"
			value="$2"
			shift 2
			;;
		*)
			echo "unknown smc argument: $1" >&2
			exit 2
			;;
	esac
done

mkdir -p "$STATE"

if [[ "$mode" == "read" ]]; then
	if [[ -f "$STATE/$key.error" ]]; then
		echo "Error: $key"
		exit 0
	fi
	if [[ -f "$STATE/$key.empty" ]]; then
		exit 0
	fi
	if [[ -f "$STATE/$key.nodata" || ! -f "$STATE/$key" ]]; then
		echo "no data"
		exit 0
	fi
	printf '%s: bytes %s\n' "$key" "$(cat "$STATE/$key")"
	exit 0
fi

if [[ "$mode" == "write" ]]; then
	case ",$FAIL," in
		*",$key,"*)
			echo "write failed for $key" >&2
			exit 1
			;;
	esac
	# This Mac's firmware accepts the percentage keys and immediately clears bfF0.
	if [[ "${SMC_DISARM_BFF0:-}" == "1" && "$key" == "bfF0" && "$value" != "00" ]]; then
		value="00"
	fi
	printf '%s' "$value" > "$STATE/$key"
	printf '%s %s\n' "$key" "$value" >> "$STATE/writes.log"
	exit 0
fi

echo "smc invocation had no read or write" >&2
exit 2
