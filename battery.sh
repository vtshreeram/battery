#!/bin/bash

## ###############
## Update management
## variables are used by this binary as well at the update script
## ###############
BATTERY_CLI_VERSION="v1.4.10"

# If a script may run as root:
#   - Reset PATH to safe defaults at the very beginning of the script.
#   - Never include user-owned directories in PATH.
PATH=/usr/bin:/bin:/usr/sbin:/sbin

# Ensure Ctrl+C stops the entire script, not just the current command
trap 'exit 130' INT

## ###############
## Variables
## ###############
visudo_folder=/private/etc/sudoers.d
visudo_file=${visudo_folder}/battery
configfolder=$HOME/.battery
pidfile=$configfolder/battery.pid
logfile=$configfolder/battery.log
maintain_percentage_tracker_file=$configfolder/maintain.percentage
maintain_voltage_tracker_file=$configfolder/maintain.voltage
notify_setting_file=$configfolder/notify.setting
daemon_path=$HOME/Library/LaunchAgents/battery.plist
calibrate_pidfile=$configfolder/calibrate.pid
calibrate_state_file=$configfolder/calibrate.state
maintain_result_file=$configfolder/maintain.result
path_configfile=/etc/paths.d/50-battery

# Test harness only. Production runs leave BATTERY_TEST_MODE unset.
# The override is refused for root and for the installed SMC path so a test cannot write real hardware.
if [[ "${BATTERY_TEST_MODE:-}" == "1" ]]; then
	if [[ "$EUID" -eq 0 ]]; then
		echo "BATTERY_TEST_MODE cannot run as root" >&2
		exit 1
	fi
	if [[ -z "${BATTERY_TEST_SMC:-}" || -z "${BATTERY_TEST_ROOT:-}" || -z "${BATTERY_TEST_BATTERY:-}" ]]; then
		echo "BATTERY_TEST_MODE requires BATTERY_TEST_SMC, BATTERY_TEST_ROOT, and BATTERY_TEST_BATTERY" >&2
		exit 1
	fi
	root_real="$(cd "$BATTERY_TEST_ROOT" && pwd)"
	smc_dir="$(cd "$(dirname "$BATTERY_TEST_SMC")" && pwd)"
	smc_real="$smc_dir/$(basename "$BATTERY_TEST_SMC")"
	case "$smc_real" in
		"$root_real"/*) ;;
		*)
			echo "BATTERY_TEST_SMC must live inside BATTERY_TEST_ROOT" >&2
			exit 1
			;;
	esac
	case "$root_real" in
		/|/usr|/usr/local|/usr/local/co.palokaj.battery|"$HOME"|"$HOME/.battery")
			echo "BATTERY_TEST_ROOT is not a safe test directory" >&2
			exit 1
			;;
	esac
	export BATTERY_TEST_MODE BATTERY_TEST_SMC BATTERY_TEST_ROOT BATTERY_TEST_BATTERY
	configfolder="$root_real/config"
	pidfile="$configfolder/battery.pid"
	logfile="$configfolder/battery.log"
	maintain_percentage_tracker_file="$configfolder/maintain.percentage"
	maintain_voltage_tracker_file="$configfolder/maintain.voltage"
	notify_setting_file="$configfolder/notify.setting"
	daemon_path="$root_real/LaunchAgents/battery.plist"
	calibrate_pidfile="$configfolder/calibrate.pid"
	calibrate_state_file="$configfolder/calibrate.state"
	maintain_result_file="$configfolder/maintain.result"
	battery_binary="$BATTERY_TEST_BATTERY"
	smc_binary="$smc_real"
fi

# Voltage limits
voltage_min="10.5"
voltage_max="12.6"
voltage_hyst_min="0.1"
voltage_hyst_max="2"

# SECURITY NOTES:
# - ALWAYS hardcode and use the absolute path to the battery executables to avoid PATH-based spoofing.
#   Think of the scenario where 'battery update_silent' running as root invokes 'battery visudo' as a
#   PATH spoofing opportunity example.
# - Ensure this script, smc binary and their parent folders are root-owned and not writable by
#   the user or others.
# - Ensure that you are not sourcing any user-writable scripts within this script to avoid overrides of
#   security critical variables.
if [[ "${BATTERY_TEST_MODE:-}" != "1" ]]; then
	binfolder="/usr/local/co.palokaj.battery"
	battery_binary="$binfolder/battery"
	smc_binary="$binfolder/smc"
fi

# GitHub URLs for setup and updates.
# Temporarily set to your username and branch to test update functionality with your fork.
# Security note: Do NOT allow github_user or github_branch to be injected via environment
#                variables or any other means. Keep them hardcoded.
github_user="vtshreeram"
github_branch="main"
github_url_setup_sh="https://raw.githubusercontent.com/${github_user}/battery/${github_branch}/setup.sh"
github_url_update_sh="https://raw.githubusercontent.com/${github_user}/battery/${github_branch}/update.sh"
github_url_battery_sh="https://raw.githubusercontent.com/${github_user}/battery/${github_branch}/battery.sh"

## ###############
## Housekeeping
## ###############

# Create config folder if needed
mkdir -p "$configfolder"

# create logfile if needed
touch "$logfile"

# Trim logfile if needed
if ! logsize=$(stat -f%z "$logfile" 2>/dev/null); then
	logsize=$(stat -c%s "$logfile" 2>/dev/null || echo 0)
fi
max_logsize_bytes=5000000
if ((logsize > max_logsize_bytes)); then
	tail -n 100 "$logfile" > "$logfile.tmp" && mv "$logfile.tmp" "$logfile"
fi

# CLI help message
helpmessage="
Battery CLI utility $BATTERY_CLI_VERSION

Usage:

  battery status
    output battery SMC status, % and time remaining

  battery logs LINES[integer, optional]
    output logs of the battery CLI and GUI
    eg: battery logs 100

  battery maintain PERCENTAGE[1-100,stop] or RANGE[lower-upper]
    reboot-persistent battery level maintenance: turn off charging above, and on below a certain value
    it has the option of a --force-discharge flag that discharges even when plugged in (this does NOT work well with clamshell mode)
    eg: battery maintain 80           # maintain at 80%
    eg: battery maintain 70-80        # maintain between 70-80%
    eg: battery maintain stop

  battery maintain VOLTAGE[${voltage_min}V-${voltage_max}V,stop] (HYSTERESIS[${voltage_hyst_min}V-${voltage_hyst_max}V])
    reboot-persistent battery level maintenance: keep battery at a certain voltage
  default hysteresis: 0.1V
    eg: battery maintain 11.4V       # keeps battery between 11.3V and 11.5V
    eg: battery maintain 11.4V 0.3V  # keeps battery between 11.1V and 11.7V

  battery charging SETTING[on/off]
    manually set the battery to (not) charge
    eg: battery charging on

  battery adapter SETTING[on/off]
    manually set the adapter to (not) charge even when plugged in
    eg: battery adapter off

  battery switch TARGET[battery/power]
    switch power source to battery or power adapter while plugged in
    eg: battery switch battery
    eg: battery switch power

  battery calibrate
    calibrate the battery by discharging it to 15%, then recharging it to 100%, and keeping it there for 1 hour
    if maintenance was running when calibration started, that same setting is restored
    if maintenance was stopped, it stays stopped
    menubar battery app execution and/or battery maintain command will interrupt calibration

  battery charge LEVEL[1-100]
    charge the battery to a certain percentage; battery maintenance is restored upon completion
    eg: battery charge 90

  battery discharge LEVEL[1-100]
    block adapter power until the battery reaches the specified level; battery maintenance is restored upon completion
    eg: battery discharge 90

  battery notify SETTING[on/off/status/test]
    manage macOS desktop notifications for bypass mode and low battery warnings
    eg: battery notify on
    eg: battery notify test

  battery health
    display detailed battery diagnostics, cycle count, temperature, and health

  battery update
    update the battery utility to the latest version

  battery reinstall
    reinstall the battery utility to the latest version (reruns the installation script)

  battery uninstall
    enable charging, remove the smc tool, and the battery script

"

# Visudo instructions
# File location: /etc/sudoers.d/battery
# Purpose:
# - Allows this script to execute 'sudo smc -w' commands without requiring a user password.
# - Allows passwordless updates.
visudoconfig="
# Visudo settings for the battery utility installed from https://github.com/vtshreeram/battery
# intended to be placed in $visudo_file on a mac

# Allow passwordless update (All battery app executables are owned by root to prevent privilege escalation attacks)
ALL ALL = NOPASSWD: $battery_binary update_silent
ALL ALL = NOPASSWD: $battery_binary update_silent is_enabled

# Allow passwordless battery-charging–related SMC write commands
Cmnd_Alias    CHARGING_OFF = $smc_binary -k CH0B -w 02, $smc_binary -k CH0C -w 02, $smc_binary -k CHTE -w 01000000
Cmnd_Alias    CHARGING_ON = $smc_binary -k CH0B -w 00, $smc_binary -k CH0C -w 00, $smc_binary -k CHTE -w 00000000
Cmnd_Alias    FIRMWARE_LIMIT = $smc_binary -k bfF0 -w 00, $smc_binary -k bfF0 -w 02, $smc_binary -k bfD0 -w *, $smc_binary -k bfE0 -w *
Cmnd_Alias    FORCE_DISCHARGE_OFF = $smc_binary -k CH0I -w 00, $smc_binary -k CHIE -w 00, $smc_binary -k CH0J -w 00
Cmnd_Alias    FORCE_DISCHARGE_ON = $smc_binary -k CH0I -w 01, $smc_binary -k CHIE -w 08, $smc_binary -k CH0J -w 01
Cmnd_Alias    LED_CONTROL = $smc_binary -k ACLC -w 04, $smc_binary -k ACLC -w 03, $smc_binary -k ACLC -w 02, $smc_binary -k ACLC -w 01, $smc_binary -k ACLC -w 00
ALL ALL = NOPASSWD: CHARGING_OFF
ALL ALL = NOPASSWD: CHARGING_ON
ALL ALL = NOPASSWD: FIRMWARE_LIMIT
ALL ALL = NOPASSWD: FORCE_DISCHARGE_OFF
ALL ALL = NOPASSWD: FORCE_DISCHARGE_ON
ALL ALL = NOPASSWD: LED_CONTROL

# Temporarily keep passwordless SMC reading commands so the old menubar GUI versions don't ask for password on each launch
# trying to execute 'battery visudo'. There is no harm in removing this, so do it as soon as you believe users are no
# longer using old versions.
ALL ALL = NOPASSWD: $smc_binary -k CH0C -r, $smc_binary -k CH0I -r, $smc_binary -k ACLC -r, $smc_binary -k CHIE -r, $smc_binary -k CHTE -r, $smc_binary -k CH0J -r, $smc_binary -k bfF0 -r, $smc_binary -k bfD0 -r, $smc_binary -k bfE0 -r
"

# Get parameters
action=$1
setting=$2
subsetting=$3

## ###############
## Helpers
## ###############

function log() {
	echo -e "$(date +%D-%T) [$$]: $*"
}

function notifications_enabled() {
	if test -f "$notify_setting_file"; then
		local setting
		setting="$(tr -d '[:space:]' < "$notify_setting_file" 2>/dev/null || true)"
		if [[ "$setting" == "off" ]]; then
			return 1
		fi
	fi
	return 0
}

function send_notification() {
	local title="$1"
	local subtitle="$2"
	local message="$3"
	local sound="${4:-default}"

	# Gracefully handle 2 or 3 arguments
	if [[ $# -eq 2 ]]; then
		sound="default"
		message="$subtitle"
		subtitle=""
	elif [[ $# -eq 3 && ( "$3" == "default" || "$3" == "Glass" || "$3" == "Sosumi" || "$3" == "Basso" || "$3" == "Hero" || "$3" == "Tink" || "$3" == "Ping" ) ]]; then
		sound="$3"
		message="$subtitle"
		subtitle=""
	fi

	if ! notifications_enabled; then
		return 0
	fi

	if [[ -n "$subtitle" ]]; then
		osascript -e "display notification \"$message\" with title \"$title\" subtitle \"$subtitle\" sound name \"$sound\"" >/dev/null 2>&1 &
	else
		osascript -e "display notification \"$message\" with title \"$title\" sound name \"$sound\"" >/dev/null 2>&1 &
	fi
}

function valid_percentage() {
	if ! [[ "$1" =~ ^[0-9]+$ ]] || [[ "$1" -lt 0 ]] || [[ "$1" -gt 100 ]]; then
		return 1
	else
		return 0
	fi
}

function valid_percentage_range() {
	# Check if input matches range format: NUMBER-NUMBER
	if ! [[ "$1" =~ ^[0-9]+-[0-9]+$ ]]; then
		return 1
	fi

	# Extract lower and upper bounds
	local lower="${1%-*}"
	local upper="${1#*-}"

	# Validate both numbers are valid percentages
	if ! valid_percentage "$lower" || ! valid_percentage "$upper"; then
		return 1
	fi

	# Check lower < upper
	if [[ "$lower" -ge "$upper" ]]; then
		return 1
	fi

	# Check bounds are reasonable (lower >= 10, upper <= 100)
	if [[ "$lower" -lt 10 ]] || [[ "$upper" -gt 100 ]]; then
		return 1
	fi

	return 0
}

function valid_voltage() {
	if [[ "$1" =~ ^[0-9]+(\.[0-9]+)?V$ ]]; then
		return 0
	fi
	return 1
}

function smc_privileged() {
	if [[ "${BATTERY_TEST_MODE:-}" == "1" ]]; then
		case "$smc_binary" in
			/usr/*|/bin/*|/sbin/*)
				echo "BATTERY_TEST_MODE refused SMC path $smc_binary" >&2
				return 1
				;;
		esac
		"$smc_binary" "$@"
	else
		sudo "$smc_binary" "$@"
	fi
}

function smc_read_raw() {
	local key="$1"
	"$smc_binary" -k "$key" -r 2>&1 || true
}

# Valid SMC data is a real read. Empty output, "no data", "Error", and other malformed text are unsupported.
function smc_output_is_valid_data() {
	local line="$1"
	if [[ -z "${line//[[:space:]]/}" ]]; then
		return 1
	fi
	local lower
	lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
	if [[ "$lower" == *"no data"* || "$lower" == *"error"* ]]; then
		return 1
	fi
	if [[ "$line" == *[Bb]ytes* ]]; then
		return 0
	fi
	if [[ "$line" =~ [0-9A-Fa-f][0-9A-Fa-f] ]]; then
		return 0
	fi
	return 1
}

function smc_key_supported() {
	local line
	line="$(smc_read_raw "$1")"
	smc_output_is_valid_data "$line"
}

function smc_read_hex() {
	local key="$1"
	local line
	line="$(smc_read_raw "$key")"
	if ! smc_output_is_valid_data "$line"; then
		echo
		return 1
	fi
	if [[ "$line" == *[Bb]ytes* ]]; then
		echo "${line#*bytes}" | tr -d ' )'
	else
		echo "$line" | grep -Eo '[0-9A-Fa-f]+' | tail -n 1
	fi
}

function smc_hex_to_uint() {
	local hex="$1"
	hex="${hex//[^0-9A-Fa-f]/}"
	if [[ -z "$hex" ]]; then
		return 1
	fi
	echo $((16#$hex))
}

# bfD0/bfE0 are little-endian. Bytes 50 00 00 00 are 80%. Reading them as one big-endian integer is not 80.
function smc_le_percent_to_uint() {
	local hex="$1"
	local i rev=""
	hex="${hex//[^0-9A-Fa-f]/}"
	if [[ -z "$hex" ]]; then
		return 1
	fi
	if (( ${#hex} % 2 )); then
		hex="0$hex"
	fi
	for ((i=${#hex}-2; i>=0; i-=2)); do
		rev+="${hex:i:2}"
	done
	echo $((16#$rev))
}

function smc_write_hex() {
	local key=$1
	local hex_value=$2
	if ! smc_privileged -k "$key" -w "$hex_value" >/dev/null 2>&1; then
		log "⚠️ Failed to write $hex_value to $key"
		return 1
	fi
	return 0
}

## #########################
## Detect supported SMC keys
## #########################
smc_key_supported CHTE && smc_supports_tahoe=true || smc_supports_tahoe=false
smc_key_supported CH0B && smc_supports_legacy=true || smc_supports_legacy=false
smc_key_supported CHIE && smc_supports_adapter_chie=true || smc_supports_adapter_chie=false
smc_key_supported CH0I && smc_supports_adapter_ch0i=true || smc_supports_adapter_ch0i=false
smc_key_supported CH0J && smc_supports_adapter_ch0j=true || smc_supports_adapter_ch0j=false
if smc_key_supported bfF0 && smc_key_supported bfD0 && smc_key_supported bfE0; then
	smc_supports_firmware_limit=true
else
	smc_supports_firmware_limit=false
fi

function log_smc_capabilities() {
	log "SMC capabilities: tahoe=$smc_supports_tahoe legacy=$smc_supports_legacy firmware=$smc_supports_firmware_limit CHIE=$smc_supports_adapter_chie CH0I=$smc_supports_adapter_ch0i CH0J=$smc_supports_adapter_ch0j"
}

# bfD0/bfE0 are little-endian ui32. 80% is bytes 50 00 00 00.
# Writing big-endian 00 00 00 50 looks like 80 in the SMC tool, but this firmware then clears bfF0 and charging continues.
function percentage_to_smc_hex() {
	printf '%02x000000' "$1"
}

function firmware_limit_only() {
	[[ "$smc_supports_firmware_limit" == "true" && "$smc_supports_tahoe" != "true" && "$smc_supports_legacy" != "true" ]]
}

# A single percentage becomes a 2-point band so the pack is not bounced every minute.
function normalize_firmware_band() {
	local upper="$1"
	local lower="$2"
	if [[ "$lower" -ge "$upper" ]]; then
		lower=$((upper - 2))
		[[ "$lower" -lt 1 ]] && lower=1
	fi
	echo "$lower $upper"
}

# Armed is not enough: bfD0 and bfE0 must match the requested band.
function firmware_limit_matches() {
	local upper="$1"
	local lower="$2"
	local band normalized_lower arm_hex upper_hex lower_hex arm_n upper_n lower_n
	band="$(normalize_firmware_band "$upper" "$lower")"
	normalized_lower="${band%% *}"
	upper="${band##* }"
	arm_hex="$(smc_read_hex bfF0)" || return 1
	upper_hex="$(smc_read_hex bfD0)" || return 1
	lower_hex="$(smc_read_hex bfE0)" || return 1
	arm_n="$(smc_hex_to_uint "$arm_hex")" || return 1
	upper_n="$(smc_le_percent_to_uint "$upper_hex")" || return 1
	lower_n="$(smc_le_percent_to_uint "$lower_hex")" || return 1
	[[ "$arm_n" -eq 2 && "$upper_n" -eq "$upper" && "$lower_n" -eq "$normalized_lower" ]]
}

# True when bfD0/bfE0 hold the requested band, whether or not bfF0 stayed armed.
function firmware_percentages_match() {
	local upper="$1"
	local lower="$2"
	local band normalized_lower upper_hex lower_hex upper_n lower_n
	band="$(normalize_firmware_band "$upper" "$lower")"
	normalized_lower="${band%% *}"
	upper="${band##* }"
	upper_hex="$(smc_read_hex bfD0)" || return 1
	lower_hex="$(smc_read_hex bfE0)" || return 1
	upper_n="$(smc_le_percent_to_uint "$upper_hex")" || return 1
	lower_n="$(smc_le_percent_to_uint "$lower_hex")" || return 1
	[[ "$upper_n" -eq "$upper" && "$lower_n" -eq "$normalized_lower" ]]
}

# Reconnect wall power without changing the charge ceiling.
# disable_discharging also decides whether charging is allowed, and that clears a working ceiling.
function reconnect_adapter() {
	log "Reconnecting power adapter"
	if [[ "$smc_supports_adapter_ch0j" == "true" ]]; then
		smc_write_hex CH0J 00 || return 1
	fi
	if [[ "$smc_supports_adapter_chie" == "true" ]]; then
		smc_write_hex CHIE 00 || return 1
	fi
	if [[ "$smc_supports_adapter_ch0i" == "true" ]]; then
		smc_write_hex CH0I 00 || return 1
	fi
}

# Keep the adapter connected. Cutting it makes macOS report Battery Power.
function enforce_unarmed_firmware_hold() {
	local upper="$1"
	local lower="$2"
	local percent="$3"
	reconnect_adapter || log "⚠️ Failed to reconnect the power adapter"
	if ! firmware_limit_matches "$upper" "$lower"; then
		log "Charge is ${percent}%. The ${upper}% ceiling did not stay armed, and the adapter stays connected."
	fi
}

# Firmware ceiling: stop charging at the upper percentage and keep the adapter powering the Mac.
# bfF0 00 clears the limit, 02 arms it. bfD0 is the upper percentage, bfE0 the lower.
function apply_firmware_charge_limit() {
	local upper="$1"
	local lower="$2"
	local band prev_arm prev_upper prev_lower failed
	band="$(normalize_firmware_band "$upper" "$lower")"
	lower="${band%% *}"
	upper="${band##* }"
	if firmware_limit_matches "$upper" "$lower"; then
		log "Firmware ceiling already ${lower}-${upper}%"
		return 0
	fi
	# The percentages are already right and only the arm bit is missing.
	# Do not write bfF0 00 here. That write turns charging back on.
	if firmware_percentages_match "$upper" "$lower"; then
		log "Re-arming firmware ceiling ${lower}-${upper}% without clearing it"
		smc_write_hex bfF0 02 || return 1
		if firmware_limit_matches "$upper" "$lower"; then
			return 0
		fi
		log "Firmware stored ${lower}-${upper}% and cleared the arm bit, so the ceiling will not stop charging"
		return 2
	fi
	prev_arm="$(smc_read_hex bfF0 || true)"
	prev_upper="$(smc_read_hex bfD0 || true)"
	prev_lower="$(smc_read_hex bfE0 || true)"
	log "Setting firmware charge limit ${lower}-${upper}%"
	failed=0
	smc_write_hex bfF0 00 || failed=1
	if [[ "$failed" -eq 0 ]]; then
		smc_write_hex bfD0 "$(percentage_to_smc_hex "$upper")" || failed=1
	fi
	if [[ "$failed" -eq 0 ]]; then
		smc_write_hex bfE0 "$(percentage_to_smc_hex "$lower")" || failed=1
	fi
	if [[ "$failed" -eq 0 ]]; then
		smc_write_hex bfF0 02 || failed=1
	fi
	if [[ "$failed" -eq 0 ]] && firmware_limit_matches "$upper" "$lower"; then
		return 0
	fi
	# This firmware stores bfD0/bfE0 and then clears bfF0. The band is present, but it does not stop charging.
	if [[ "$failed" -eq 0 ]] && firmware_percentages_match "$upper" "$lower"; then
		log "Firmware stored ${lower}-${upper}% and cleared the arm bit, so the ceiling will not stop charging"
		return 2
	fi
	log "⚠️ Firmware charge limit verification failed for ${lower}-${upper}% (arm=$(smc_read_hex bfF0 || true) upper=$(smc_read_hex bfD0 || true) lower=$(smc_read_hex bfE0 || true))"
	if [[ -n "$prev_upper" ]]; then
		smc_write_hex bfD0 "$prev_upper" || log "⚠️ Failed to restore bfD0"
	fi
	if [[ -n "$prev_lower" ]]; then
		smc_write_hex bfE0 "$prev_lower" || log "⚠️ Failed to restore bfE0"
	fi
	if [[ -n "$prev_arm" ]]; then
		smc_write_hex bfF0 "$prev_arm" || log "⚠️ Failed to restore bfF0"
	fi
	return 1
}

function clear_firmware_charge_limit() {
	local arm upper lower
	log "Clearing firmware charge limit"
	smc_write_hex bfF0 00 || return 1
	smc_write_hex bfD0 00000000 || return 1
	smc_write_hex bfE0 00000000 || return 1
	arm="$(smc_hex_to_uint "$(smc_read_hex bfF0)")" || return 1
	upper="$(smc_hex_to_uint "$(smc_read_hex bfD0)")" || return 1
	lower="$(smc_hex_to_uint "$(smc_read_hex bfE0)")" || return 1
	if [[ "$arm" -ne 0 || "$upper" -ne 0 || "$lower" -ne 0 ]]; then
		log "⚠️ Firmware charge limit readback after clear was arm=$arm upper=$upper lower=$lower"
		return 1
	fi
}

# The gauge SOC the firmware compares with bfD0. The menu percentage can sit a little higher.
function read_firmware_soc() {
	if [[ "${BATTERY_TEST_MODE:-}" == "1" ]]; then
		if [[ -n "${BATTERY_TEST_PERCENT:-}" ]]; then
			echo "$BATTERY_TEST_PERCENT"
		fi
		return
	fi
	local soc
	soc="$(ioreg -rn AppleSmartBattery -w0 2>/dev/null | tr ',' '\n' | sed -n 's/.*"StateOfCharge"=\([0-9][0-9]*\).*/\1/p' | head -1)"
	if valid_percentage "$soc"; then
		echo "$soc"
	fi
}

# While the charge is above the user's limit, park the firmware ceiling one point under the
# current gauge reading. Aiming it straight at 80 makes this firmware run the Mac from the
# battery until the pack falls all the way there. A close ceiling only stops charging.
function firmware_ceiling_for_hold() {
	local user_lower="$1"
	local user_upper="$2"
	local percent="$3"
	local fw_upper fw_lower
	if (( percent > user_upper )); then
		# Sit on the current gauge. A ceiling below it makes this firmware
		# run the Mac from the battery and the percentage falls quickly.
		fw_upper=$percent
		if (( fw_upper < user_upper )); then
			fw_upper=$user_upper
		fi
		fw_lower=$((fw_upper - 2))
		if (( fw_lower < 1 )); then
			fw_lower=1
		fi
	else
		fw_upper=$user_upper
		fw_lower=$user_lower
		if (( fw_lower >= fw_upper )); then
			fw_lower=$((fw_upper - 2))
			if (( fw_lower < 1 )); then
				fw_lower=1
			fi
		fi
	fi
	echo "$fw_lower $fw_upper"
}

# Resolve the maintain band used when disable_charging runs outside the maintain loop.
function firmware_limit_bounds() {
	local upper="${active_fw_upper:-${upper_bound:-}}"
	local lower="${active_fw_lower:-${lower_bound:-}}"
	local saved
	if ! valid_percentage "$upper"; then
		saved="$(get_maintain_percentage)"
		if valid_percentage_range "$saved"; then
			lower="${saved%-*}"
			upper="${saved#*-}"
		elif valid_percentage "$saved"; then
			upper="$saved"
			lower="$saved"
		else
			upper=80
			lower=80
		fi
	fi
	if ! valid_percentage "$lower"; then
		lower="$upper"
	fi
	echo "$lower $upper"
}

## #################
## SMC Manipulation
## #################

# Change magsafe color
# see community sleuthing: https://github.com/actuallymentor/battery/issues/71
function change_magsafe_led_color() {
	local color=$1

	log "💡 Setting magsafe color to $color"

	if [[ "$color" == "green" ]]; then
		log "setting LED to green"
		smc_write_hex ACLC 03
	elif [[ "$color" == "orange" ]]; then
		log "setting LED to orange"
		smc_write_hex ACLC 04
	else
		# Default action: reset. Value 00 is a guess and needs confirmation
		log "resetting LED"
		smc_write_hex ACLC 00
	fi
}

# Adapter isolation keys (CH0J / CHIE / CH0I) disconnect wall power so the Mac runs on the battery.
# They are only for an explicit Battery Power / force-discharge choice. Limit charging must not write them.
# CH0I: https://github.com/actuallymentor/battery/issues/20#issuecomment-1364540704
# CH0J and CHIE read back as 0 when the adapter is connected and as 0x08 or 0x20 when it is isolated.
function enable_discharging() {
	log "🔽🔋 Enabling battery discharging"
	if [[ "$smc_supports_adapter_ch0j" == "true" ]]; then
		smc_write_hex CH0J 01
	elif [[ "$smc_supports_adapter_chie" == "true" ]]; then
		smc_write_hex CHIE 08
	else
		smc_write_hex CH0I 01
	fi
	smc_write_hex ACLC 01
}

function disable_discharging() {
	log "🔼🪫 Disabling battery discharging"
	# Clear every isolation key this Mac has. Clearing only the first one leaves the adapter cut
	# when the SMC mirrors the state onto CH0J and CHIE.
	if [[ "$smc_supports_adapter_ch0j" == "true" ]]; then
		smc_write_hex CH0J 00
	fi
	if [[ "$smc_supports_adapter_chie" == "true" ]]; then
		smc_write_hex CHIE 00
	fi
	if [[ "$smc_supports_adapter_ch0i" == "true" ]]; then
		smc_write_hex CH0I 00
	fi
	# Keep track of status
	is_charging=$(get_smc_charging_status)

	if ! valid_percentage "$setting"; then

		log "Disabling discharging: No valid maintain percentage set, enabling charging"
		# use direct commands since enable_charging also calls disable_discharging, and causes an eternal loop
		if [[ "$smc_supports_tahoe" == "true" ]]; then
			smc_write_hex CHTE 00000000
		elif [[ "$smc_supports_legacy" == "true" ]]; then
			smc_write_hex CH0B 00
			smc_write_hex CH0C 00
		elif [[ "$smc_supports_firmware_limit" == "true" ]]; then
			log "Disabling discharging: firmware charge limit left unchanged"
		else
			log "⚠️ Unable to reset charging state"
		fi
		change_magsafe_led_color "orange"

	elif [[ "$battery_percentage" -ge "$setting" && "$is_charging" == "enabled" ]]; then

		if firmware_limit_only; then
			log "Disabling discharging: leaving the firmware ceiling unchanged"
		else
			log "Disabling discharging: Charge above $setting, disabling charging"
			disable_charging
			change_magsafe_led_color "green"
		fi

	elif [[ "$battery_percentage" -lt "$setting" && "$is_charging" == "disabled" ]]; then

		log "Disabling discharging: Charge below $setting, enabling charging"
		# use direct commands since enable_charging also calls disable_discharging, and causes an eternal loop
		if [[ "$smc_supports_tahoe" == "true" ]]; then
			smc_write_hex CHTE 00000000
		elif [[ "$smc_supports_legacy" == "true" ]]; then
			smc_write_hex CH0B 00
			smc_write_hex CH0C 00
		elif [[ "$smc_supports_firmware_limit" == "true" ]]; then
			log "Disabling discharging: firmware charge limit left unchanged"
		else
			log "⚠️ Unable to reset charging state"
		fi
		change_magsafe_led_color "orange"

	fi

	battery_percentage=$(get_battery_percentage)
}

# Re:charging, Aldente uses CH0B https://github.com/davidwernhart/AlDente/blob/0abfeafbd2232d16116c0fe5a6fbd0acb6f9826b/AlDente/Helper.swift#L227
# but @joelucid uses CH0C https://github.com/davidwernhart/AlDente/issues/52#issuecomment-1019933570
# so I'm using both since with only CH0B I noticed sometimes during sleep it does trigger charging
function enable_charging() {
	log "🔌🔋 Enabling battery charging"
	if [[ "$smc_supports_tahoe" == "true" ]]; then
		smc_write_hex CHTE 00000000 || return 1
	elif [[ "$smc_supports_legacy" == "true" ]]; then
		smc_write_hex CH0B 00 || return 1
		smc_write_hex CH0C 00 || return 1
	elif [[ "$smc_supports_firmware_limit" == "true" ]]; then
		clear_firmware_charge_limit || return 1
	else
		log "⚠️ Unable to determine SMC keys for enabling charging"
		return 1
	fi
	disable_discharging
}

function disable_charging() {
	log "🔌🪫 Disabling battery charging"
	if [[ "$smc_supports_tahoe" == "true" ]]; then
		smc_write_hex CHTE 01000000 || return 1
	elif [[ "$smc_supports_legacy" == "true" ]]; then
		smc_write_hex CH0B 02 || return 1
		smc_write_hex CH0C 02 || return 1
	elif [[ "$smc_supports_firmware_limit" == "true" ]]; then
		local bounds limit_lower limit_upper
		bounds="$(firmware_limit_bounds)"
		limit_lower="${bounds%% *}"
		limit_upper="${bounds##* }"
		apply_firmware_charge_limit "$limit_upper" "$limit_lower"
		local apply_status=$?
		# 2: percentages stored, arm bit cleared. Charging is not actually stopped yet.
		if [[ "$apply_status" -eq 2 ]]; then
			return 2
		fi
		[[ "$apply_status" -eq 0 ]] || return 1
	else
		log "⚠️ Unable to determine SMC keys for disabling charging"
		return 1
	fi
}

function get_smc_charging_status() {
	local status_key="CH0B"
	if [[ "$smc_supports_tahoe" == "true" ]]; then
		status_key="CHTE"
	elif [[ "$smc_supports_legacy" == "true" ]]; then
		status_key="CH0B"
	elif [[ "$smc_supports_firmware_limit" == "true" ]]; then
		status_key="bfF0"
	fi
	hex_status=$(smc_read_hex "$status_key")
	if [[ -z "$hex_status" ]]; then
		echo "unknown"
		return
	fi
	if [[ "$smc_supports_tahoe" == "true" ]]; then
		if [[ "$hex_status" == "00000000" ]]; then
			echo "enabled"
		else
			echo "disabled"
		fi
	elif [[ "$smc_supports_legacy" == "true" ]]; then
		if [[ "$hex_status" == "00" ]]; then
			echo "enabled"
		else
			echo "disabled"
		fi
	elif [[ "$smc_supports_firmware_limit" == "true" ]]; then
		# bfF0 00 means the ceiling is off. Any other value means some ceiling is armed.
		# An armed bit does not mean the programmed band matches the requested target.
		if [[ "$hex_status" == "00" || "$hex_status" == "0" ]]; then
			echo "enabled"
		else
			echo "disabled"
		fi
	else
		echo "unknown"
	fi
}

function get_smc_discharging_status() {
	local status_key="CH0I"
	if [[ "$smc_supports_adapter_ch0j" == "true" ]]; then
		status_key="CH0J"
	elif [[ "$smc_supports_adapter_chie" == "true" ]]; then
		status_key="CHIE"
	fi
	hex_status=$(smc_read_hex "$status_key")
	if [[ -z "$hex_status" ]]; then
		echo "unknown"
		return
	fi
	if [[ "$hex_status" == "0" || "$hex_status" == "00" ]]; then
		echo "not discharging"
	else
		echo "discharging"
	fi
}

## ###############
## Statistics
## ###############

function get_battery_percentage() {
	if [[ "${BATTERY_TEST_MODE:-}" == "1" ]]; then
		echo "${BATTERY_TEST_PERCENT:-50}"
		return
	fi
	battery_percentage=$(pmset -g batt | tail -n1 | awk '{print $3}' | tr -d '%;')
	echo "$battery_percentage"
}

function get_remaining_time() {
	time_remaining=$(pmset -g batt | grep -Eo '[0-9]{1,2}:[0-9]{2}' | head -n1)
	if [[ -z "$time_remaining" ]]; then
		time_remaining="unknown"
	fi
	echo "$time_remaining"
}

function get_charger_state() {
	ac_attached=$(pmset -g batt | tail -n1 | awk '{ x=match($0, /AC attached/) > 0; print x }')
	echo "$ac_attached"
}

function get_maintain_percentage() {
	maintain_percentage=$(cat "$maintain_percentage_tracker_file" 2>/dev/null)
	echo "$maintain_percentage"
}

function get_voltage() {
	voltage=$(ioreg -l -n AppleSmartBattery -r | grep "\"Voltage\" =" | awk '{ print $3/1000 }' | tr ',' '.')
	echo "$voltage"
}

## ##################
## Miscellany helpers
## ##################

function determine_unprivileged_user() {
	local username="$1"
	if [[ "$username" == "root" ]]; then
		log "⚠️ 'battery $action $setting $subsetting': argument user is root, trying to recover" >&2
		username=""
	fi
	if [[ -z "$username" && -n "$SUDO_USER" && "$SUDO_USER" != "root" ]]; then
		username="$SUDO_USER"
	fi
	if [[ -z "$username" && -n "$USER" && "$USER" != "root" ]]; then
		username="$USER"
	fi
	if [[ -z "$username" && "$HOME" == /Users/* ]]; then
		username="$(basename "$HOME")";
	fi
	if [[ -z "$username" ]]; then
		log "⚠️ 'battery $action $setting $subsetting': unable to determine unprivileged user; falling back to 'logname'" >&2
		username="$(logname 2>/dev/null || true)"
	fi
	echo "$username"
}

function assert_unprivileged_user() {
	local username="$1"
	if [[ -z "$username" || "$username" == "root" ]]; then
		log "❌ 'battery $action $setting $subsetting': failed to determine unprivileged user"
		exit 11
	fi
}

function assert_not_running_as_root() {
	if [[ $EUID -eq 0 ]]; then
		echo " ❌ The following command should not be executed with root privileges:"
		echo "        battery $action $setting $subsetting"
		echo "    Please, try running without 'sudo'"
		exit 1
	fi
}

function assert_running_as_root() {
	if [[ $EUID -ne 0 ]]; then
		log "❌ battery $action $setting $subsetting: must be executed with root privileges"
		exit 1
	fi
}

function ensure_owner() {
	local owner="$1" group="$2" path="$3"
	[[ -e $path ]] || { return 1; }
	local cur_owner
	cur_owner=$(stat -f '%Su' "$path")
	local cur_group
	cur_group=$(stat -f '%Sg' "$path")
	if [[ $cur_owner != "$owner" || $cur_group != "$group" ]]; then
		sudo chown -h "${owner}:${group}" "$path"
	fi
}

function ensure_owner_mode() {
	local owner="$1" group="$2" mode="$3" path="$4"
	ensure_owner "$owner" "$group" "$path" || return
	local cur_mode
	cur_mode=$(stat -f '%Lp' "$path")
	if [[ $cur_mode != "${mode#0}" ]]; then
		sudo chmod -h "$mode" "$path"
	fi
}

# Use the following function to apply any setup related fixes which require root permissions.
# This function is executed by 'update_silent' action with EUID==0.
function fixup_installation_owner_mode() {
	local username=$1

	ensure_owner_mode "$username" staff 755 "$(dirname "$daemon_path")"
	ensure_owner_mode "$username" staff 644 "$daemon_path"

	ensure_owner_mode "$username" staff 755 "$configfolder"
	ensure_owner_mode "$username" staff 644 "$pidfile"
	ensure_owner_mode "$username" staff 644 "$logfile"
	ensure_owner_mode "$username" staff 644 "$maintain_percentage_tracker_file"
	ensure_owner_mode "$username" staff 644 "$maintain_voltage_tracker_file"
	ensure_owner_mode "$username" staff 644 "$calibrate_pidfile"

	ensure_owner_mode root wheel 755 "$visudo_folder"
	ensure_owner_mode root wheel 440 "$visudo_file"

	ensure_owner_mode root wheel 755 "$binfolder"
	ensure_owner_mode root wheel 755 "$battery_binary"
	ensure_owner_mode root wheel 755 "$smc_binary"

	# Do some cleanup after previous versions
	sudo rm -f "$configfolder/visudo.tmp"
}

function is_latest_version_installed() {
	# Check if content is reachable first with HEAD request
	curl -sSI "$github_url_battery_sh" &>/dev/null || return 0

	# Download the remote script then parse and compare the version string
	local remote_script
	remote_script="$(curl -fsSL "$github_url_battery_sh" 2>/dev/null)" || return 0
	local remote_version
	remote_version="$(echo "$remote_script" | grep -E '^BATTERY_CLI_VERSION=' | head -n 1 | cut -d'"' -f2)"
	if [[ -z "$remote_version" ]]; then
		return 0
	fi

	# Compare versions: if local version is >= remote version, it is up-to-date
	local lowest_version
	lowest_version="$(printf '%s\n%s\n' "$BATTERY_CLI_VERSION" "$remote_version" | sort -V | head -n 1)"
	if [[ "$lowest_version" == "$remote_version" ]]; then
		# Local version is equal to or newer than remote
		return 0
	else
		# Remote version is newer than local
		return 1
	fi
}

## ###############
## Actions
## ###############

# If the config folder or log file were just created by the code above while
# running as root, set the correct ownership and permissions.
if [[ $EUID -eq 0 ]]; then
	username="$(determine_unprivileged_user "$SUDO_USER")"
	if [[ -n "$username" && "$username" != "root" ]]; then
		fixup_installation_owner_mode "$username"
	fi
fi

# Version message
if [[ "$action" == "version" ]] || [[ "$action" == "--version" ]]; then
	echo "$BATTERY_CLI_VERSION"
	exit 0
fi

# Help message
if [ -z "$action" ] || [[ "$action" == "help" ]] || [[ "$action" == "--help" ]]; then
	echo -e "$helpmessage"
	exit 0
fi

if [[ "${BATTERY_TEST_MODE:-}" == "1" ]]; then
	case "$action" in
		_test_apply_firmware)
			apply_firmware_charge_limit "$setting" "${subsetting:-$setting}"
			exit $?
			;;
		_test_capabilities)
			printf 'firmware=%s legacy=%s tahoe=%s ch0j=%s\n' \
				"$smc_supports_firmware_limit" "$smc_supports_legacy" "$smc_supports_tahoe" "$smc_supports_adapter_ch0j"
			exit 0
			;;
		_test_hold_band)
			firmware_ceiling_for_hold "$setting" "$subsetting" "${BATTERY_TEST_PERCENT:?}"
			exit $?
			;;
		_test_enforce_hold)
			enforce_unarmed_firmware_hold "$setting" "${subsetting:-$setting}" "${BATTERY_TEST_PERCENT:?}"
			exit $?
			;;
		_test_key_supported)
			if smc_key_supported "$setting"; then
				echo yes
				exit 0
			fi
			echo no
			exit 1
			;;
	esac
fi

# Update '/etc/sudoers.d/battery' config if needed
if [[ "$action" == "visudo" ]]; then

	# Allocate temp folder
	tempfolder="$(mktemp -d)"
	trap 'rm -rf "$tempfolder"' EXIT

	# Write the visudo file to a tempfile
	visudo_tmpfile="$tempfolder/visudo.tmp"
	echo -e "$visudoconfig" > "$visudo_tmpfile"

	# If the visudo folder does not exist, make it
	if ! test -d "$visudo_folder"; then
		sudo mkdir -p "$visudo_folder"
	fi
	ensure_owner_mode root wheel 755 "$visudo_folder"

	# If the visudo file is the same (no error, exit code 0), set the permissions just
	if sudo cmp "$visudo_file" "$visudo_tmpfile" &>/dev/null; then

		echo "☑️  The existing battery visudo file is what it should be for version $BATTERY_CLI_VERSION"

		# Check if file permissions are correct, if not, set them
		ensure_owner_mode root wheel 440 "$visudo_file"

		# Delete tempfolder
		rm -rf "$tempfolder"

		# exit because no changes are needed
		exit 0

	fi

	# Validate that the visudo tempfile is valid
	if sudo visudo -c -f "$visudo_tmpfile" &>/dev/null; then

		# Copy the visudo file from tempfile to live location
		sudo cp "$visudo_tmpfile" "$visudo_file"

		# Set correct permissions on visudo file
		ensure_owner_mode root wheel 440 "$visudo_file"

		# Delete tempfolder
		rm -rf "$tempfolder"

		echo "✅ Visudo file updated successfully"

	else
		echo "❌ Error validating visudo file, this should never happen:"
		sudo visudo -c -f "$visudo_tmpfile"
	fi

	exit 0
fi

# Reinstall helper
if [[ "$action" == "reinstall" ]]; then
	echo "This will run curl -sS ${github_url_setup_sh} | bash"
	if [[ ! "$setting" == "silent" ]]; then
		echo "Press any key to continue"
		read -r
	fi
	curl -fsSL "$github_url_setup_sh" | bash
	exit 0
fi

# Update helper for GUI app
if [[ "$action" == "update_silent" ]]; then

	assert_running_as_root

	# Exit with success when the GUI app just checks if passwordless updates are enabled
	if [[ "$setting" == "is_enabled" ]]; then
		exit 0
	fi

	# Try updating
	if ! is_latest_version_installed; then
		updater="$(mktemp)"
		if ! curl -fsSL -o "$updater" "$github_url_update_sh"; then
			rm -f "$updater"
			echo "❌ Failed to download the updater."
			exit 1
		fi
		if [[ ! -s "$updater" ]]; then
			rm -f "$updater"
			echo "❌ Updater download was empty."
			exit 1
		fi
		bash "$updater"
		rm -f "$updater"
		echo "✅ battery background script was updated to the latest version."
	else
		echo "☑️  No updates found"
	fi

	# Update the visudo configuration on each update ensuring that the latest version
	# is always installed.
	# Note: this will overwrite the visudo configuration file only if it is outdated.
	$battery_binary visudo

	# Determine the name of unprivileged user
	username="$(determine_unprivileged_user "")"
	assert_unprivileged_user "$username"

	# Use opportunity to fixup installation
	fixup_installation_owner_mode "$username"

	exit 0
fi

# Update helper for Terminal users
if [[ "$action" == "update" ]]; then

	assert_not_running_as_root

	# The older GUI versions 1_3_2 and below can not run silent passwordless update and
	# will complain with alert. Just exit with success and let them update themselves.
	# Remove this condition in future versions when you believe the old UI is not used anymore.
	if [[ "$setting" == "silent" ]]; then
		exit 0
	fi

	if ! curl -fsI "$github_url_battery_sh" &>/dev/null; then
		echo "❌ Can't check for updates: no internet connection (or GitHub unreachable)."
		exit 1
	fi

	# The code below repeats integrity checks from GUI app, specifically from
	# app/modules/battery.js: 'initialize_battery'. Try keeping it consistent.

	function check_installation_integrity() (
		function not_link_and_root_owned() {
			[[ ! -L "$1" ]] && [[ $(stat -f '%u' "$1") -eq 0 ]]
		}

		not_link_and_root_owned "$binfolder" && \
		not_link_and_root_owned "$battery_binary" && \
		not_link_and_root_owned "$smc_binary" && \
		sudo -n "$battery_binary" update_silent is_enabled >/dev/null 2>&1
	)

	if ! check_installation_integrity; then
		version_before="0" # Force restart maintenance process
		echo -e "‼️ The battery installation seems to be broken. Forcing reinstall...\n"
		"$battery_binary" reinstall silent
	else
		version_before="$($battery_binary version)"
		sudo "$battery_binary" update_silent
	fi

	# Restart background maintenance process if update was installed
	if [[ -x "$battery_binary" ]] && [[ "$($battery_binary version)" != "$version_before" ]]; then
		printf "\n%s\n" "🛠️  Restarting 'battery maintain' ..."
		$battery_binary maintain recover
	fi

	exit 0
fi

# Uninstall helper
if [[ "$action" == "uninstall" ]]; then

	if [[ ! "$setting" == "silent" ]]; then
		echo "This will enable charging, and remove the smc tool and battery script"
		echo "Press any key to continue"
		read -r
	fi

	$battery_binary maintain stop
	$battery_binary remove_daemon

	enable_charging
	disable_discharging

	sudo rm -fv /usr/local/bin/battery
	sudo rm -fv /usr/local/bin/smc

	sudo rm -fv "$visudo_file"
	sudo rm -frv "$binfolder"
	sudo rm -frv "$configfolder"
	sudo rm -fv "$path_configfile"

	# Ensure no dangling battery processes are left running
	pkill -f "/usr/local/bin/battery.*|/usr/local/co\.palokaj\.battery/battery.*"

	exit 0
fi

# Charging on/off controller
if [[ "$action" == "charging" ]]; then

	log "Setting $action to $setting"

	# Disable running daemon
	$battery_binary maintain stop

	# Set charging to on and off
	if [[ "$setting" == "on" ]]; then
		enable_charging
	elif [[ "$setting" == "off" ]]; then
		disable_charging
		charging_status=$?
		if [[ "$charging_status" -eq 1 ]]; then
			exit 1
		fi
	else
		log "Error: $setting is not \"on\" or \"off\"."
		exit 1
	fi

	exit 0

fi

# Power source switcher (switch to battery or switch to power/adapter)
if [[ "$action" == "switch" ]] || [[ "$action" == "power" ]]; then

	if [[ "$setting" == "battery" ]]; then
		log "⚡️ Switching power source to Battery (disabling adapter)"
		action="adapter"
		setting="off"
	elif [[ "$setting" == "power" || "$setting" == "adapter" ]]; then
		log "🔌 Switching power source to Power Adapter (enabling adapter)"
		action="adapter"
		setting="on"
	else
		log "Error: Unknown power target '$setting'. Please use 'battery switch battery' or 'battery switch power'."
		exit 1
	fi

fi

# Discharge on/off controller
if [[ "$action" == "adapter" ]]; then

	log "Setting $action to $setting"

	# Disable running daemon
	$battery_binary maintain stop

	# Set charging to on and off
	if [[ "$setting" == "on" ]]; then
		disable_discharging
	elif [[ "$setting" == "off" ]]; then
		enable_discharging
	else
		log "Error: $setting is not \"on\" or \"off\"."
		exit 1
	fi

	exit 0

fi

# Charging on/off controller
if [[ "$action" == "charge" ]]; then

	if ! valid_percentage "$setting"; then
		log "Error: $setting is not a valid setting for battery charge. Please use a number between 0 and 100"
		exit 1
	fi

	# Stop battery maintenance if invoked by user from Terminal
	if [[ "$BATTERY_HELPER_MODE" != "1" ]]; then
		$battery_binary maintain stop
	fi

	# Start charging
	battery_percentage=$(get_battery_percentage)
	log "Charging to $setting% from $battery_percentage%"
	enable_charging # also disables discharging

	# Loop until battery charging level is reached
	while [[ "$battery_percentage" -lt "$setting" ]]; do

		if [[ "$battery_percentage" -ge "$((setting - 3))" ]]; then
			sleep 20
		else
			caffeinate -is sleep 60
		fi

		battery_percentage=$(get_battery_percentage)

	done

	disable_charging
	log "Charging completed at $battery_percentage%"

	# Try restoring maintenance if invoked by user from Terminal
	if [[ "$BATTERY_HELPER_MODE" != "1" ]]; then
		$battery_binary maintain recover
	fi

	exit 0

fi

# Discharging on/off controller
if [[ "$action" == "discharge" ]]; then

	if ! valid_percentage "$setting"; then
		log "Error: $setting is not a valid setting for battery discharge. Please use a number between 0 and 100"
		exit 1
	fi

	# Stop battery maintenance if invoked by user from Terminal
	if [[ "$BATTERY_HELPER_MODE" != "1" ]]; then
		$battery_binary maintain stop
	fi

	# Start discharging
	battery_percentage=$(get_battery_percentage)
	log "Discharging to $setting% from $battery_percentage%"
	enable_discharging

	# Loop until battery charging level is reached
	while [[ "$battery_percentage" -gt "$setting" ]]; do

		log "Battery at $battery_percentage% (target $setting%)"
		caffeinate -is sleep 60
		battery_percentage=$(get_battery_percentage)

	done

	disable_discharging
	log "Discharging completed at $battery_percentage%"

	# Try restoring maintenance if invoked by user from Terminal
	if [[ "$BATTERY_HELPER_MODE" != "1" ]]; then
		$battery_binary maintain recover
	fi

	exit 0

fi

# Maintain at level
if [[ "$action" == "maintain_synchronous" ]]; then

	log_smc_capabilities

	# Checking if the calibration process is running
	if test -f "$calibrate_pidfile"; then
		pid=$(cat "$calibrate_pidfile" 2>/dev/null)
		kill "$pid" &>/dev/null
		log "🚨 Calibration process have been stopped"
	fi

	# Recover old maintain status if old setting is found
	if [[ "$setting" == "recover" ]]; then

		# Before doing anything, log out environment details as a debugging trail
		log "Debug trail. User: $USER, config folder: $configfolder, logfile: $logfile, file called with 1: $1, 2: $2"

		maintain_percentage=$(cat "$maintain_percentage_tracker_file" 2>/dev/null)
		if [[ -n "$maintain_percentage" ]]; then
			log "Recovering maintenance percentage $maintain_percentage"
			setting="$maintain_percentage"
		else
			log "No setting to recover, exiting"
			printf '%s\n' "fail" > "$maintain_result_file"
			exit 0
		fi
	fi

	# Parse setting - could be single value or range
	lower_bound=""
	upper_bound=""
	is_range=false

	if valid_percentage_range "$setting"; then
		# Range format: lower-upper
		is_range=true
		lower_bound="${setting%-*}"
		upper_bound="${setting#*-}"
	elif valid_percentage "$setting"; then
		# Single value format (backward compatible)
		is_range=false
		lower_bound="$setting"
		upper_bound="$setting"
	else
		log "Error: $setting is not a valid setting for battery maintain. Please use a number between 0 and 100, or a range like 70-80"
		printf '%s\n' "fail" > "$maintain_result_file"
		exit 1
	fi

	echo $$ > "$pidfile"

	battery_percentage=$(get_battery_percentage)
	# Use the menu percentage. The firmware gauge sits lower, and a ceiling under the
	# menu percentage makes the Mac run from the battery.
	hold_percent="$battery_percentage"
	fw_soc="$(read_firmware_soc || true)"
	if [[ -n "$fw_soc" && "$fw_soc" -gt "$hold_percent" ]]; then
		hold_percent="$fw_soc"
	fi
	read -r active_fw_lower active_fw_upper <<< "$(firmware_ceiling_for_hold "$lower_bound" "$upper_bound" "$hold_percent")"
	log "Firmware hold ${active_fw_lower}-${active_fw_upper}% for charge ${battery_percentage}% (limit ${upper_bound}%)"

	# Confirm the ceiling before the long loop. `battery maintain` waits for this result.
	if firmware_limit_only; then
		disable_charging
		ceiling_status=$?
		if [[ "$ceiling_status" -eq 1 ]]; then
			printf '%s\n' "fail" > "$maintain_result_file"
			log "⚠️ Failed to program firmware ceiling before maintenance loop"
			exit 1
		fi
	fi
	printf '%s\n' "ok" > "$maintain_result_file"

	# Check if the user requested that the battery maintenance first discharge to the desired level
	if [[ "$subsetting" == "--force-discharge" ]]; then
		# Before we start maintaining the battery level, first discharge to the target level
		discharge_target="$lower_bound"
		log "Triggering discharge to $discharge_target before enabling charging limiter"
		BATTERY_HELPER_MODE=1 $battery_binary discharge "$discharge_target"
		log "Discharge pre battery-maintenance complete, continuing to battery maintenance loop"
	else
		log "Not triggering discharge as it is not requested"
	fi

	if [[ "$is_range" == true ]]; then
		log "Maintaining battery between $lower_bound% and $upper_bound% from $battery_percentage%"
	else
		log "Charging to and maintaining at $setting% from $battery_percentage%"
	fi

	notified_target_reached=false
	notified_low_20=false
	notified_crit_10=false

	# Loop until battery percent is exceeded
	while true; do

		# Keep track of status
		is_charging=$(get_smc_charging_status)
		ac_attached=$(get_charger_state)

		# Firmware mode keeps the ceiling armed at the requested band. An already-armed
		# bfF0 is not enough: changing 80 to 70 must rewrite bfD0/bfE0.
		if firmware_limit_only; then

			hold_percent="$battery_percentage"
			fw_soc="$(read_firmware_soc || true)"
			if [[ -n "$fw_soc" && "$fw_soc" -gt "$hold_percent" ]]; then
				hold_percent="$fw_soc"
			fi
			read -r active_fw_lower active_fw_upper <<< "$(firmware_ceiling_for_hold "$lower_bound" "$upper_bound" "$hold_percent")"
			if ! firmware_limit_matches "$active_fw_upper" "$active_fw_lower"; then
				log "Firmware ceiling missing or mismatched for ${active_fw_lower}-${active_fw_upper}% (charge ${battery_percentage}%, limit ${upper_bound}%)"
				disable_charging
				ceiling_status=$?
				if [[ "$ceiling_status" -eq 1 ]]; then
					log "⚠️ Failed to program firmware ceiling ${active_fw_lower}-${active_fw_upper}%"
				fi
			fi
			enforce_unarmed_firmware_hold "$active_fw_upper" "$active_fw_lower" "$battery_percentage"
			if [[ "$battery_percentage" -ge "$upper_bound" && "$notified_target_reached" != true ]]; then
				if firmware_limit_matches "$upper_bound" "$lower_bound"; then
					send_notification "Battery King" "Target Limit Reached ($upper_bound%)" "Charging stopped. The Mac is running from the adapter." "Glass"
				else
					send_notification "Battery King" "Charge limit not enforced ($upper_bound%)" "The adapter stays connected. This Mac clears the firmware ceiling, so the battery can keep charging." "Glass"
				fi
				notified_target_reached=true
			elif [[ "$battery_percentage" -lt "$lower_bound" ]]; then
				notified_target_reached=false
			fi

		elif [[ "$battery_percentage" -ge "$upper_bound" && ("$is_charging" == "enabled" || "$ac_attached" == "1") ]]; then

			log "Charge at or above $upper_bound%"
			if [[ "$is_charging" != "disabled" ]]; then
				disable_charging
			fi
			change_magsafe_led_color "green"

			if [[ "$notified_target_reached" != true ]]; then
				send_notification "Battery King" "Target Limit Reached ($upper_bound%)" "Switched to AC Adapter bypass (0 cycles)." "Glass"
				notified_target_reached=true
			fi

		elif [[ "$battery_percentage" -lt "$lower_bound" && "$is_charging" == "disabled" ]]; then

			log "Charge below $lower_bound%"
			enable_charging
			change_magsafe_led_color "orange"
			notified_target_reached=false

		fi

		# Check low battery warnings when running on battery
		if [[ "$ac_attached" != "1" ]]; then
			notified_target_reached=false
			if [[ "$battery_percentage" -le 10 && "$notified_crit_10" != true ]]; then
				send_notification "Battery King" "Critical Battery Alert ($battery_percentage%)" "Battery is below 10%! Plug in charger immediately." "Basso"
				notified_crit_10=true
				notified_low_20=true
			elif [[ "$battery_percentage" -le 20 && "$notified_low_20" != true ]]; then
				send_notification "Battery King" "Low Battery Warning ($battery_percentage%)" "Connect charger to preserve battery longevity." "Sosumi"
				notified_low_20=true
			fi
		else
			# Reset low battery notification states when plugged into AC
			notified_low_20=false
			notified_crit_10=false
		fi

		sleep 60

		battery_percentage=$(get_battery_percentage)

	done

	exit 0

fi

# Maintain at voltage
if [[ "$action" == "maintain_voltage_synchronous" ]]; then

	log_smc_capabilities

	# Recover old maintain status if old setting is found
	if [[ "$setting" == "recover" ]]; then

		# Before doing anything, log out environment details as a debugging trail
		log "Debug trail. User: $USER, config folder: $configfolder, logfile: $logfile, file called with 1: $1, 2: $2"

		maintain_voltage=$(cat "$maintain_voltage_tracker_file" 2>/dev/null)
		if [[ -n "$maintain_voltage" ]]; then
			log "Recovering maintenance voltage $maintain_voltage"
			setting=$(echo "$maintain_voltage" | awk '{print $1}')
			subsetting=$(echo "$maintain_voltage" | awk '{print $2}')
		else
			log "No setting to recover, exiting"
			printf '%s\n' "fail" > "$maintain_result_file"
			exit 0
		fi
	fi

	if firmware_limit_only; then
		log "Error: voltage maintenance is not supported on this Mac. Firmware percentage ceilings cannot hold a voltage setpoint. Use a percentage, for example: battery maintain 80"
		printf '%s\n' "fail" > "$maintain_result_file"
		exit 1
	fi
	printf '%s\n' "ok" > "$maintain_result_file"

	voltage=$(get_voltage)
	lower_voltage=$(echo "$setting - $subsetting" | bc -l)
	upper_voltage=$(echo "$setting + $subsetting" | bc -l)
	log "Keeping voltage between ${lower_voltage}V and ${upper_voltage}V"

	echo $$ > "$pidfile"

	# Loop
	while true; do
		is_charging=$(get_smc_charging_status)

		if (($(echo "$voltage < $lower_voltage" | bc -l))) && [[ "$is_charging" == "disabled" ]]; then
			log "Battery at ${voltage}V"
			enable_charging
		fi
		if (($(echo "$voltage >= $upper_voltage" | bc -l))) && [[ "$is_charging" == "enabled" ]]; then
			log "Battery at ${voltage}V"
			disable_charging
		fi

		sleep 60

		voltage=$(get_voltage)

	done

	exit 0

fi

function stop_maintain_processes() {
	if test -f "$pidfile"; then
		local old_pid
		old_pid="$(tr -d '[:space:]' < "$pidfile" 2>/dev/null || true)"
		log "Killing old maintain process at ${old_pid:-unknown}"
		if [[ -n "$old_pid" ]]; then
			kill "$old_pid" &>/dev/null || true
		fi
		rm -f "$pidfile" 2>/dev/null
	fi
	# Tests must not signal the user's real maintenance processes.
	if [[ "${BATTERY_TEST_MODE:-}" == "1" ]]; then
		return 0
	fi
	local p
	while read -r p; do
		[[ -z "$p" || "$p" == "$$" ]] && continue
		kill "$p" &>/dev/null || true
	done < <(pgrep -f "battery maintain_.*synchronous" 2>/dev/null || true)
}

function wait_for_maintain_result() {
	local status
	for _attempt in $(seq 1 50); do
		if [[ -f "$maintain_result_file" ]]; then
			status="$(tr -d '[:space:]' < "$maintain_result_file")"
			[[ "$status" == "ok" ]]
			return
		fi
		sleep 0.1
	done
	return 1
}

# Start a long-running helper in its own session. The menu app's command timeout
# must not take the maintenance loop down with the short-lived launcher.
function start_detached() {
	perl -e 'use POSIX qw(setsid); setsid() or die "setsid: $!\n"; exec @ARGV or die "exec: $!\n"' -- "$@" >> "$logfile" 2>&1 &
}

function launchctl_invoke() {
	if [[ "${BATTERY_TEST_MODE:-}" == "1" ]]; then
		mkdir -p "$configfolder"
		printf '%s\n' "$*" >> "$configfolder/launchctl.log"
		return 0
	fi
	launchctl "$@"
}

# Asynchronous battery level maintenance
if [[ "$action" == "maintain" ]]; then

	assert_not_running_as_root

	if [[ "$setting" == "stop" ]]; then
		log "Killing running maintain daemons & enabling charging as default state"
		stop_maintain_processes
		"$battery_binary" disable_daemon
		if ! enable_charging; then
			log "⚠️ Failed to clear the charge limit"
			"$battery_binary" status
			exit 1
		fi
		"$battery_binary" status
		exit 0
	fi

	# Check if setting is a voltage
	is_voltage=false
	if valid_voltage "$setting"; then
		setting="${setting//V/}"

		if valid_voltage "$subsetting"; then
			subsetting="${subsetting//V/}"
		else
			subsetting="0.1"
		fi

		if (($(echo "$setting < $voltage_min" | bc -l) || $(echo "$setting > $voltage_max" | bc -l))); then
			log "Error: ${setting}V is not a valid setting. Please use a value between ${voltage_min}V and ${voltage_max}V"
			exit 1
		fi
		if (($(echo "$subsetting < $voltage_hyst_min" | bc -l) || $(echo "$subsetting > $voltage_hyst_max" | bc -l))); then
			log "Error: ${subsetting}V is not a valid setting. Please use a value between ${voltage_hyst_min}V and ${voltage_hyst_max}V"
			exit 1
		fi

		is_voltage=true
		if firmware_limit_only; then
			log "Error: voltage maintenance is not supported on this Mac. Firmware percentage ceilings cannot hold a voltage setpoint. Use a percentage, for example: battery maintain 80"
			exit 1
		fi

	# Check if setting is a percentage range or single value
	elif ! valid_percentage "$setting" && ! valid_percentage_range "$setting"; then
		log "Called with $setting $action"
		# If setting is not a valid percentage/range and not a special keyword, exit with an error.
		if ! { [[ "$setting" == "stop" ]] || [[ "$setting" == "recover" ]]; }; then
			log "Error: $setting is not a valid setting for battery maintain. Please use a number between 0 and 100, a range like 70-80, or an action keyword like 'stop' or 'recover'."
			exit 1
		fi

	fi

	reconnect_adapter

	stop_maintain_processes
	if test -f "$calibrate_pidfile"; then
		pid="$(tr -d '[:space:]' < "$calibrate_pidfile" 2>/dev/null || true)"
		if [[ -n "$pid" ]]; then
			kill "$pid" &>/dev/null || true
		fi
		log "🚨 Calibration process have been stopped"
	fi

	rm -f "$maintain_result_file"
	# Start maintenance script
	if [ "$is_voltage" = true ]; then
		log "Starting battery maintenance at ${setting}V ±${subsetting}V"
		start_detached "$battery_binary" maintain_voltage_synchronous "$setting" "$subsetting"
	else
		if valid_percentage_range "$setting"; then
			log "Starting battery maintenance between ${setting/-/% and }%"
		else
			log "Starting battery maintenance at $setting% $subsetting"
		fi
		start_detached "$battery_binary" maintain_synchronous "$setting" "$subsetting"
	fi

	# Store pid of maintenance process and setting
	echo $! > "$pidfile"
	if ! wait_for_maintain_result; then
		log "⚠️ Maintenance did not confirm the requested charge limit"
		stop_maintain_processes
		exit 1
	fi
	pid="$(tr -d '[:space:]' < "$pidfile" 2>/dev/null || true)"

	if ! [[ "$setting" == "recover" ]]; then

		rm "$maintain_percentage_tracker_file" "$maintain_voltage_tracker_file" 2>/dev/null

		if [[ "$is_voltage" = true ]]; then
			log "Writing new setting $setting $subsetting to $maintain_voltage_tracker_file"
			echo "$setting $subsetting" > "$maintain_voltage_tracker_file"
			log "Maintaining battery at ${setting}V ±${subsetting}V"

		else
			log "Writing new setting $setting to $maintain_percentage_tracker_file"
			echo "$setting" > "$maintain_percentage_tracker_file"
			if valid_percentage_range "$setting"; then
				log "Maintaining battery between ${setting/-/% and }%"
			else
				log "Maintaining battery at $setting%"
			fi
		fi

	fi

	# Enable the daemon that continues maintaining after reboot
	$battery_binary create_daemon

	exit 0

fi

calibration_cleaned=0

function kill_descendants() {
	local parent="$1"
	local child children
	children="$(pgrep -P "$parent" 2>/dev/null || true)"
	for child in $children; do
		kill_descendants "$child"
		kill -TERM "$child" 2>/dev/null || true
	done
}

function kill_calibration_tree() {
	local pgid member
	kill_descendants "$$"
	pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d '[:space:]' || true)"
	if [[ -n "$pgid" ]]; then
		while read -r member; do
			member="${member//[[:space:]]/}"
			[[ -z "$member" || "$member" == "$$" ]] && continue
			kill -TERM "$member" 2>/dev/null || true
		done < <(ps -o pid= -g "$pgid" 2>/dev/null || true)
	fi
	sleep 0.2
	kill_descendants "$$"
	if [[ -n "${pgid:-}" ]]; then
		while read -r member; do
			member="${member//[[:space:]]/}"
			[[ -z "$member" || "$member" == "$$" ]] && continue
			kill -KILL "$member" 2>/dev/null || true
		done < <(ps -o pid= -g "$pgid" 2>/dev/null || true)
	fi
}

function write_calibration_snapshot() {
	local was_active=0 mode="none" saved="" extra="" old_pid
	if test -f "$pidfile"; then
		old_pid="$(tr -d '[:space:]' < "$pidfile" 2>/dev/null || true)"
		if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
			was_active=1
		fi
	fi
	if test -f "$maintain_voltage_tracker_file"; then
		mode="voltage"
		saved="$(awk '{print $1}' "$maintain_voltage_tracker_file")"
		extra="$(awk '{print $2}' "$maintain_voltage_tracker_file")"
	elif test -f "$maintain_percentage_tracker_file"; then
		saved="$(tr -d '[:space:]' < "$maintain_percentage_tracker_file")"
		if valid_percentage_range "$saved"; then
			mode="range"
		elif valid_percentage "$saved"; then
			mode="percentage"
		fi
	fi
	mkdir -p "$configfolder"
	cat > "$calibrate_state_file" <<EOF
was_active=$was_active
mode=$mode
setting=$saved
subsetting=$extra
EOF
}

function restore_calibration_protection() {
	local was_active="0" mode="none" saved="" extra=""
	if [[ -f "$calibrate_state_file" ]]; then
		was_active="$(awk -F= '/^was_active=/ {print $2; exit}' "$calibrate_state_file")"
		mode="$(awk -F= '/^mode=/ {print $2; exit}' "$calibrate_state_file")"
		saved="$(awk -F= '/^setting=/ {print $2; exit}' "$calibrate_state_file")"
		extra="$(awk -F= '/^subsetting=/ {print $2; exit}' "$calibrate_state_file")"
	fi
	if [[ "$was_active" != "1" ]]; then
		log "Calibration ended. Protection was off and stays off."
		return 0
	fi
	log "Restoring protection captured at calibration start ($mode $saved $extra)"
	if [[ "$mode" == "voltage" && -n "$saved" ]]; then
		"$battery_binary" maintain "${saved}V" "${extra:-0.1}V" || log "⚠️ Failed to restore voltage maintenance"
	elif [[ -n "$saved" ]]; then
		"$battery_binary" maintain "$saved" || log "⚠️ Failed to restore percentage maintenance"
	fi
}

function cleanup_calibration() {
	if [[ "$calibration_cleaned" == "1" ]]; then
		return 0
	fi
	calibration_cleaned=1
	trap - INT TERM EXIT
	log "Cleaning up calibration"
	kill_calibration_tree
	disable_discharging || log "⚠️ Failed to clear adapter isolation after calibration"
	if ! enable_charging; then
		log "⚠️ Failed to normalize charging after calibration"
	fi
	restore_calibration_protection
	rm -f "$calibrate_pidfile" "$calibrate_state_file"
}

# Battery calibration
if [[ "$action" == "calibrate" ]]; then

	# Own the process group so cancellation can stop discharge/charge children with the parent.
	if [[ "${BATTERY_CALIBRATE_GROUP:-}" != "1" ]]; then
		export BATTERY_CALIBRATE_GROUP=1
		exec perl -e 'setpgrp(0, 0) or die "setpgrp: $!\n"; exec @ARGV or die "exec: $!\n"' -- "$0" "$@"
	fi

	write_calibration_snapshot
	if ! "$battery_binary" maintain stop; then
		log "⚠️ Could not stop maintenance before calibration"
	fi
	trap 'cleanup_calibration; exit 129' HUP
	trap 'cleanup_calibration; exit 130' INT
	trap 'cleanup_calibration; exit 143' TERM
	trap 'cleanup_calibration' EXIT
	echo $$ > "$calibrate_pidfile"

	echo -e "Starting battery calibration\n"

	if [[ "${BATTERY_TEST_CALIBRATION:-}" == "hold" ]]; then
		enable_discharging || true
		while true; do
			sleep 30
		done
	fi

	echo "[ 1 ] Discharging battery to 15%"
	BATTERY_HELPER_MODE=1 "$battery_binary" discharge 15

	echo "[ 2 ] Charging to 100%"
	BATTERY_HELPER_MODE=1 "$battery_binary" charge 100

	echo "[ 3 ] Reached 100%, waiting for 1 hour"
	enable_charging
	sleep 3600

	echo "[ 4 ] Discharging battery to 80%"
	BATTERY_HELPER_MODE=1 "$battery_binary" discharge 80

	echo "[ 5 ] Restoring the protection state captured when calibration started"
	echo -e "\n✅ Done\n"
	exit 0

fi

# Status logger
if [[ "$action" == "status" ]]; then

	log "Battery at $(get_battery_percentage)% ($(get_remaining_time) remaining), $(get_voltage)V, smc charging $(get_smc_charging_status)"
	maintain_running=false
	if test -f "$pidfile" && kill -0 "$(cat "$pidfile" 2>/dev/null)" 2>/dev/null; then
		maintain_running=true
	elif pgrep -f "battery maintain_synchronous" &>/dev/null || pgrep -f "battery maintain_voltage_synchronous" &>/dev/null; then
		maintain_running=true
	fi

	if [ "$maintain_running" = true ]; then
		maintain_percentage=$(cat "$maintain_percentage_tracker_file" 2>/dev/null)
		if [[ -n "$maintain_percentage" ]]; then
			if valid_percentage_range "$maintain_percentage"; then
				maintain_level="${maintain_percentage/-/% - }%"
			else
				maintain_level="$maintain_percentage%"
			fi
		else
			maintain_level=$(cat "$maintain_voltage_tracker_file" 2>/dev/null)
			maintain_level=$(echo "$maintain_level" | awk '{print $1 "V ±" $2 "V"}')
		fi
		log "Your battery is currently being maintained at $maintain_level"
	fi
	exit 0

fi

# Status logger in csv format
if [[ "$action" == "status_csv" ]]; then

	echo "$(get_battery_percentage),$(get_remaining_time),$(get_smc_charging_status),$(get_smc_discharging_status),$(get_maintain_percentage)"

fi

# Health & diagnostics
if [[ "$action" == "health" ]]; then

	battery_ioreg=$(ioreg -r -c AppleSmartBattery 2>/dev/null)

	cycle_count=$(echo "$battery_ioreg" | grep '"CycleCount" =' | head -n1 | awk '{print $3}')
	raw_temp=$(echo "$battery_ioreg" | grep '"Temperature" =' | head -n1 | awk '{print $3}')
	if [[ -n "$raw_temp" && "$raw_temp" =~ ^[0-9]+$ ]]; then
		temp_c=$(echo "scale=1; $raw_temp / 100" | bc -l)
		temp_f=$(echo "scale=1; ($temp_c * 9/5) + 32" | bc -l)
		temp_display="${temp_c}°C / ${temp_f}°F"
	else
		temp_display="Unknown"
	fi

	max_capacity=$(system_profiler SPPowerDataType 2>/dev/null | awk -F': ' '/Maximum Capacity/ {print $2}' | head -n1 | xargs)
	condition=$(system_profiler SPPowerDataType 2>/dev/null | awk -F': ' '/Condition/ {print $2}' | head -n1 | xargs)
	[[ -z "$condition" ]] && condition="Unavailable"
	[[ -z "$max_capacity" ]] && max_capacity="Unavailable"

	power_source=$(pmset -g batt 2>/dev/null | head -n1 | awk -F"'" '{print $2}')
	[[ -z "$power_source" ]] && power_source="Unknown"

	curr_percent=$(get_battery_percentage)
	curr_voltage=$(get_voltage)
	smc_charging=$(get_smc_charging_status)

	maintain_level="None"
	if test -f "$pidfile"; then
		maintain_percentage=$(cat "$maintain_percentage_tracker_file" 2>/dev/null)
		if [[ -n "$maintain_percentage" ]]; then
			maintain_level="$maintain_percentage%"
		fi
	fi

	if notifications_enabled; then
		notify_status="Enabled"
	else
		notify_status="Disabled"
	fi

	echo ""
	echo "  🔋 Battery Health & Diagnostic Report"
	echo "  ======================================"
	echo "  • Maximum Capacity : $max_capacity"
	echo "  • Cycle Count      : $cycle_count cycles"
	echo "  • Hardware Health  : $condition"
	echo "  • Temperature      : $temp_display"
	echo "  • Current Charge   : $curr_percent% (${curr_voltage}V)"
	echo "  • Power Source     : $power_source"
	echo "  • SMC Charging     : $smc_charging"
	echo "  • Active Maintain  : $maintain_level"
	echo "  • Notifications    : $notify_status"
	echo ""
	exit 0

fi

# Notifications manager
if [[ "$action" == "notify" ]]; then

	case "$setting" in
		on|enable)
			echo "on" > "$notify_setting_file"
			log "Notifications enabled"
			send_notification "Battery King" "Notifications Active" "Battery King notifications are now enabled." "Glass"
			echo "✅ Battery notifications enabled."
			exit 0
			;;
		off|disable)
			echo "off" > "$notify_setting_file"
			log "Notifications disabled"
			echo "🚫 Battery notifications disabled."
			exit 0
			;;
		test)
			send_notification "Battery King" "Notification Test" "AC Bypass active at 80% (0 cycles)." "Glass"
			echo "🔔 Sent test notification to macOS Notification Center."
			exit 0
			;;
		status|"")
			if notifications_enabled; then
				echo "🔔 Battery notifications: ENABLED"
			else
				echo "🔕 Battery notifications: DISABLED"
			fi
			exit 0
			;;
		*)
			echo "Usage: battery notify [on|off|status|test]"
			exit 1
			;;
	esac

fi

# launchd daemon creator, inspiration: https://www.launchd.info/
if [[ "$action" == "create_daemon" ]]; then

	assert_not_running_as_root

	call_action="maintain_synchronous"
	if test -f "$maintain_voltage_tracker_file"; then
		call_action="maintain_voltage_synchronous"
	fi

	daemon_definition="
<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
	<dict>
		<key>Label</key>
		<string>com.battery.app</string>
		<key>ProgramArguments</key>
		<array>
			<string>$battery_binary</string>
			<string>$call_action</string>
			<string>recover</string>
		</array>
		<key>StandardOutPath</key>
		<string>$logfile</string>
		<key>StandardErrorPath</key>
		<string>$logfile</string>
		<key>RunAtLoad</key>
		<true/>
	</dict>
</plist>
"

	mkdir -p "${daemon_path%/*}"

	# check if daemon already exists
	if test -f "$daemon_path"; then

		log "Daemon already exists, checking for differences"
		daemon_definition_difference=$(diff --brief --ignore-space-change --strip-trailing-cr --ignore-blank-lines <(cat "$daemon_path" 2>/dev/null) <(echo "$daemon_definition"))

		# remove leading and trailing whitespaces
		daemon_definition_difference=$(echo "$daemon_definition_difference" | xargs)
		if [[ "$daemon_definition_difference" != "" ]]; then

			log "daemon_definition changed: replace with new definitions"
			echo "$daemon_definition" >"$daemon_path"

		fi
	else

		# daemon not available, create new launch deamon
		log "Daemon does not yet exist, creating daemon file at $daemon_path"
		echo "$daemon_definition" >"$daemon_path"

	fi

	# enable daemon
	launchctl_invoke enable "gui/$(id -u "$USER")/com.battery.app"
	exit 0

fi

# Disable daemon
if [[ "$action" == "disable_daemon" ]]; then

	log "Disabling daemon at gui/$(id -u "$USER")/com.battery.app"
	launchctl_invoke disable "gui/$(id -u "$USER")/com.battery.app"
	exit 0

fi

# Remove daemon
if [[ "$action" == "remove_daemon" ]]; then

	rm "$daemon_path" 2>/dev/null
	exit 0

fi

# Display logs
if [[ "$action" == "logs" ]]; then

	amount="${2:-100}"

	echo -e "👾 Battery CLI logs:\n"
	tail -n "$amount" "$logfile"

	echo -e "\n🖥️	Battery GUI logs:\n"
	tail -n "$amount" "$configfolder/gui.log"

	echo -e "\n📁 Config folder details:\n"
	ls -lah "$configfolder"

	echo -e "\n⚙️	Battery data:\n"
	$battery_binary status
	$battery_binary | grep -E "v\d.*"

	exit 0

fi
