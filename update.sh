#!/bin/bash

echo -e "🔋 Starting battery update\n"

# This script is running as root:
#   - Reset PATH to safe defaults at the very beginning of the script.
#   - Never include user-owned directories in PATH.
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

# Ensure Ctrl+C stops the entire script, not just the current command
trap 'exit 130' INT

# Define the installation directory for the battery background executables
binfolder="/usr/local/co.palokaj.battery"

is_launched_by_gui_app() {
	# Determine the process group ID (PGID) of the current process
	local this_process_pgid
	this_process_pgid="$(ps -o pgid= -p $$ | tr -d ' ')"
	# Return 0 if any process in the same process group has battery.app or Electron.app in its command string
	# shellcheck disable=SC2009
	ps -x -g "$this_process_pgid" -o command= -ww 2>/dev/null | grep -qE '(battery\.app|Electron\.app)' >/dev/null 2>&1
}

# If running as an unprivileged user and launched by GUI app
if [[ $EUID -ne 0 ]] && is_launched_by_gui_app; then
	# This execution path is taken when GUI app version 1_3_2 or earlier launches update using
	# the battery script of the same version. This is expected when a new version of battery.sh
	# is released but the GUI app has not been updated yet.
	# Exit successfully with a silent warning to avoid disrupting the existing installation.
	printf "%s\n%s\n" \
		"The update to the next version requires root privileges." \
		"Run the updated menu bar GUI app or issue the 'battery update' command in Terminal."
	exit 0
fi

# Trigger reinstall for Terminal users to update from version 1_3_2 or earlier.
if [[ $EUID -ne 0 && ! -x "$binfolder/battery" ]]; then
	echo -e "💡 This battery update requires a full reinstall...\n"
	curl -sS "https://raw.githubusercontent.com/vtshreeram/battery/main/setup.sh" | bash
	"$binfolder/battery" maintain recover
	exit 0
fi

echo -n "[ 1 ] Allocating temp folder: "
tempfolder="$(mktemp -d)"
echo "$tempfolder"
trap 'rm -rf "$tempfolder"' EXIT

updatefolder="$tempfolder/battery"
mkdir -p "$updatefolder"

echo "[ 2 ] Downloading the latest battery version"
if ! curl -sS -o "$updatefolder/battery.sh" https://raw.githubusercontent.com/vtshreeram/battery/main/battery.sh; then
	err=$?
	echo -e "\n❌ Failed to download the update.\n"
	exit "$err"
fi

echo "[ 3 ] Writing script to $binfolder/battery"
sudo install -d -m 755 -o root -g wheel "$binfolder"
sudo install -m 755 -o root -g wheel "$updatefolder/battery.sh" "$binfolder/battery"

echo "[ 4 ] Remove temporary folder"
rm -rf "$tempfolder"

echo -e "\n🎉 Battery tool updated.\n"
exit 0
