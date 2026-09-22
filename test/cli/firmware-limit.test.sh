#!/bin/bash
# CLI regression tests. They use a fake SMC and must not touch a real Mac's SMC keys.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
STATE="$WORK/smc-state"
FAIL_KEYS=""
HOLD=""

cleanup() {
	if [[ -f "$WORK/config/battery.pid" ]]; then
		kill "$(tr -d '[:space:]' < "$WORK/config/battery.pid")" 2>/dev/null || true
	fi
	if [[ -f "$WORK/config/calibrate.pid" ]]; then
		kill "$(tr -d '[:space:]' < "$WORK/config/calibrate.pid")" 2>/dev/null || true
	fi
	rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$STATE"
cp "$ROOT/test/cli/fake-smc.sh" "$WORK/fake-smc"
chmod +x "$WORK/fake-smc"

run_battery() {
	env \
		BATTERY_TEST_MODE=1 \
		BATTERY_TEST_ROOT="$WORK" \
		BATTERY_TEST_SMC="$WORK/fake-smc" \
		BATTERY_TEST_BATTERY="$ROOT/battery.sh" \
		BATTERY_TEST_CALIBRATION="$HOLD" \
		SMC_STATE_DIR="$STATE" \
		SMC_FAIL_WRITE_KEYS="$FAIL_KEYS" \
		bash "$ROOT/battery.sh" "$@"
}

assert_eq() {
	local actual="$1"
	local expected="$2"
	local label="$3"
	if [[ "$actual" != "$expected" ]]; then
		echo "FAIL $label: expected [$expected] got [$actual]" >&2
		exit 1
	fi
}

read_key() {
	if [[ -f "$STATE/$1" ]]; then
		cat "$STATE/$1"
	else
		echo MISSING
	fi
}

reset_state() {
	rm -rf "$STATE" "$WORK/config"
	mkdir -p "$STATE"
	FAIL_KEYS=""
	HOLD=""
}

seed_percent_ceiling() {
	local upper_hex="$1"
	local lower_hex="$2"
	printf '02' > "$STATE/bfF0"
	printf '%s' "$upper_hex" > "$STATE/bfD0"
	printf '%s' "$lower_hex" > "$STATE/bfE0"
}

echo "1. armed 80% rewrites to 70%"
reset_state
seed_percent_ceiling 00000050 0000004e
run_battery _test_apply_firmware 70 70
assert_eq "$(read_key bfF0)" "02" "70 arm"
assert_eq "$(read_key bfD0)" "00000046" "70 upper"
assert_eq "$(read_key bfE0)" "00000044" "70 lower"

echo "2. armed 70% rewrites to 100%"
reset_state
seed_percent_ceiling 00000046 00000044
run_battery _test_apply_firmware 100 100
assert_eq "$(read_key bfF0)" "02" "100 arm"
assert_eq "$(read_key bfD0)" "00000064" "100 upper"
assert_eq "$(read_key bfE0)" "00000062" "100 lower"

echo "3. maintain stop clears the firmware ceiling"
reset_state
seed_percent_ceiling 00000050 0000004e
run_battery maintain stop
assert_eq "$(read_key bfF0)" "00" "cleared arm"
assert_eq "$(read_key bfD0)" "00000000" "cleared upper"
assert_eq "$(read_key bfE0)" "00000000" "cleared lower"

echo "4. one failed firmware write fails the operation and restores the previous ceiling"
reset_state
seed_percent_ceiling 00000050 0000004e
FAIL_KEYS="bfE0"
set +e
run_battery _test_apply_firmware 70 70
status=$?
set -e
assert_eq "$status" "1" "failed write status"
assert_eq "$(read_key bfF0)" "02" "restored arm"
assert_eq "$(read_key bfD0)" "00000050" "restored upper"
assert_eq "$(read_key bfE0)" "0000004e" "restored lower"

echo "5. SMC Error output is not treated as a supported key"
reset_state
printf '02' > "$STATE/bfD0"
printf '02' > "$STATE/bfE0"
: > "$STATE/bfF0.error"
caps="$(run_battery _test_capabilities)"
assert_eq "$caps" "firmware=false legacy=false tahoe=false ch0j=false" "error capability"
: > "$STATE/bfF0.empty"
rm -f "$STATE/bfF0.error"
set +e
run_battery _test_key_supported bfF0
empty_status=$?
set -e
assert_eq "$empty_status" "1" "empty output rejected"

echo "7. voltage mode does not fall back to a percentage ceiling"
reset_state
printf '00' > "$STATE/bfF0"
printf '00000000' > "$STATE/bfD0"
printf '00000000' > "$STATE/bfE0"
set +e
run_battery maintain 11.4V
voltage_status=$?
set -e
assert_eq "$voltage_status" "1" "voltage unsupported"
if [[ -e "$WORK/config/maintain.percentage" ]]; then
	echo "FAIL voltage mode wrote maintain.percentage" >&2
	exit 1
fi
assert_eq "$(read_key bfF0)" "00" "voltage left ceiling disarmed"
assert_eq "$(read_key bfD0)" "00000000" "voltage did not program 80"

echo "17. calibration cancel restores a disabled limiter and clears adapter isolation"
reset_state
printf '00' > "$STATE/CH0J"
printf '00' > "$STATE/bfF0"
printf '00000000' > "$STATE/bfD0"
printf '00000000' > "$STATE/bfE0"
mkdir -p "$WORK/config"
printf '80' > "$WORK/config/maintain.percentage"
HOLD=hold
run_battery calibrate >"$WORK/calibrate-disabled.log" 2>&1 &
wrapper_pid=$!
for _attempt in $(seq 1 80); do
	[[ -f "$WORK/config/calibrate.pid" ]] && break
	sleep 0.1
done
[[ -f "$WORK/config/calibrate.pid" ]]
calibrate_pid="$(tr -d '[:space:]' < "$WORK/config/calibrate.pid")"
kill -TERM "$calibrate_pid"
for _attempt in $(seq 1 80); do
	kill -0 "$calibrate_pid" 2>/dev/null || break
	sleep 0.1
done
wait "$wrapper_pid" 2>/dev/null || true
if kill -0 "$calibrate_pid" 2>/dev/null; then
	echo "FAIL calibration process survived SIGTERM" >&2
	exit 1
fi
assert_eq "$(read_key CH0J)" "00" "adapter isolation cleared"
assert_eq "$(read_key bfF0)" "00" "charging normalized"
assert_eq "$(cat "$WORK/config/maintain.percentage")" "80" "preferred limit kept"
if [[ -f "$WORK/config/calibrate.pid" || -f "$WORK/config/calibrate.state" ]]; then
	echo "FAIL calibration state files were left behind" >&2
	exit 1
fi
if [[ -f "$WORK/config/launchctl.log" ]] && grep -q 'enable ' "$WORK/config/launchctl.log"; then
	echo "FAIL disabled protection was re-enabled" >&2
	exit 1
fi

echo "17b. calibration cancel restores an active 75% limit"
reset_state
printf '00' > "$STATE/CH0J"
printf '00' > "$STATE/bfF0"
printf '00000000' > "$STATE/bfD0"
printf '00000000' > "$STATE/bfE0"
mkdir -p "$WORK/config"
printf '75' > "$WORK/config/maintain.percentage"
sleep 300 &
sleep_pid=$!
printf '%s' "$sleep_pid" > "$WORK/config/battery.pid"
HOLD=hold
run_battery calibrate >"$WORK/calibrate-enabled.log" 2>&1 &
wrapper_pid=$!
for _attempt in $(seq 1 80); do
	[[ -f "$WORK/config/calibrate.pid" ]] && break
	sleep 0.1
done
[[ -f "$WORK/config/calibrate.pid" ]]
calibrate_pid="$(tr -d '[:space:]' < "$WORK/config/calibrate.pid")"
kill -TERM "$calibrate_pid"
for _attempt in $(seq 1 80); do
	kill -0 "$calibrate_pid" 2>/dev/null || break
	sleep 0.1
done
wait "$wrapper_pid" 2>/dev/null || true
if kill -0 "$calibrate_pid" 2>/dev/null; then
	echo "FAIL active calibration survived SIGTERM" >&2
	exit 1
fi
assert_eq "$(read_key bfF0)" "02" "restored arm"
assert_eq "$(read_key bfD0)" "0000004b" "restored 75 upper"
assert_eq "$(read_key bfE0)" "00000049" "restored 75 lower"
assert_eq "$(read_key CH0J)" "00" "restored adapter connected"
assert_eq "$(cat "$WORK/config/maintain.percentage")" "75" "restored limit file"

echo "CLI firmware tests passed"
