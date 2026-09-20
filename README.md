# Battery Charge Limiter for Apple Silicon MacBooks

<img width="320px" align="right" src="./screenshots/tray.png" alt="Battery Menu Bar UI"/>

A modern, robust battery-management tool for Apple Silicon (M1/M2/M3/M4) Macs. It enables you to cap battery charging to 80% (or any custom limit between 50% and 100%), keeping your battery cool and significantly extending lithium-ion cell longevity when chronically connected to power.

This repository is maintained at **[`vtshreeram/battery`](https://github.com/vtshreeram/battery)**.

> **Why limit charging?** Lithium-ion batteries degrade fastest when held at 100% state-of-charge under high ambient temperatures. Keeping battery levels around 70–80% when plugged into power reduces chemical stress and maintains long-term capacity. For technical details, see [Battery University BU-808](https://batteryuniversity.com/article/bu-808-how-to-prolong-lithium-based-batteries).

---

## ⚡ Key Features

### 🛡️ Smart Battery Protection
* **Reboot-Persistent Limiting**: Maintains charge levels (default 80%) across reboots and sleep/wake cycles using a lightweight macOS `LaunchAgent` daemon.
* **Custom Thresholds & Presets**: Choose quick presets (80%, 75%, 70%, 60%, 50%) or set custom limits anywhere between 50% and 100%.
* **Optional Force Discharge**: When plugged in with battery above the target limit, seamlessly discharges the battery down to the target before holding power adapter bypass.
* **Non-Destructive Defaults**: If protection is disabled by the user, the app respects the choice and never silently forces it back on.

### 🚀 Flexible Overrides & Workflows
* **Charge to 100% Once**: One-click top-up. The app charges to 100% and automatically restores your configured limit as soon as full charge is reached.
* **Temporary Pause**: Pause battery limiting for 1 hour, 4 hours, until tomorrow morning (8:00 AM), or until power is unplugged.
* **Travel Mode (Scheduled Departure)**: Set a departure time; the app dynamically calculates required charging lead-time and delivers a 100% charge right when you leave, automatically restoring protection afterwards.
* **Battery Calibration Cycle**: 4-stage automated cycle (discharge to 15% -> charge to 100% -> hold for 1 hour -> restore limit) to recalibrate macOS battery capacity estimations.

### 📊 Local Health Diagnostics & Monitoring
* **Battery Health & History**: Inspect real-time capacity percentage, cycle counts, manufacturing details, and historical capacity retention trends saved locally.
* **Informational Thermal Monitoring**: Real-time battery temperature display and alerts (>40°C elevated, >45°C high).
  > **Note on Thermal Safety**: Thermal alerts are strictly informational and advisory. The software does not execute automated charging cutoffs based on thermal thresholds, ensuring hardware safety remains governed by Apple's built-in SMC firmware.
* **Local Usage Statistics**: Track protection uptime, cycle efficiency, and charging state distributions without any external servers.
* **Smart Heuristic Recommendations**: On-device tips based on your actual charging patterns.

### 🔒 Privacy & Architecture Hardening
* **Zero Telemetry**: All third-party tracking, analytics endpoints (`unidentifiedanalytics`), and external telemetry have been completely removed.
* **Sandboxed Path Resolution**: CLI invocations use strict, safe PATH environments (`/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/usr/local/co.palokaj.battery`) preventing binary injection.
* **Versioned Settings Schema**: Migration engine safely transforms legacy file-based configurations (`~/.battery/*.setting`) into a structured schema (`v1`) without data loss.
* **Self-Repair Engine**: Integrated repair utility detects and repairs sudoers permissions, missing LaunchAgents, stale PID locks, and binary permissions with one click.

---

## 📥 Installation

### Requirements
* Apple Silicon MacBook (M1, M2, M3, M4 or newer). Intel MacBooks are not supported.
* macOS 12 Monterey, macOS 13 Ventura, macOS 14 Sonoma, or macOS 15 Sequoia.

### Option 1: One-Line Installer (CLI + Menu Bar App)
Run the following in your Terminal:

```bash
curl -s https://raw.githubusercontent.com/vtshreeram/battery/main/setup.sh | bash
```

The installer will:
1. Install Apple Silicon `smc` tool to `/usr/local/bin`
2. Install `battery` CLI to `/usr/local/bin` and `/usr/local/co.palokaj.battery`
3. Configure passwordless `sudo` rights for `smc` commands via `/etc/sudoers.d/battery`
4. Register the background maintenance `LaunchAgent` daemon (`~/Library/LaunchAgents/battery.plist`)
5. Download and place the Electron menu bar app in `/Applications/battery.app`

### Option 2: Precompiled DMG Release
Download the latest `.dmg` from the [Releases page](https://github.com/vtshreeram/battery/releases), open it, and drag `battery.app` to `/Applications`. Launch the application to finalize setup.

---

## 🖥️ Command Line Interface (CLI)

The GUI wraps around `battery.sh`, which can be run independently in terminal:

```bash
# Maintain battery level at 80% (reboot-persistent)
battery maintain 80

# Maintain battery level with forced discharge down to target
battery maintain 80 --force-discharge

# Maintain battery within a window (e.g. 70% to 80%)
battery maintain 70-80

# Stop maintenance (disable limiter)
battery maintain stop

# Inspect battery status in human-readable or CSV format
battery status
battery status_csv

# Inspect battery hardware health and capacity
battery health

# Run full battery calibration cycle
battery calibrate

# Enable or disable charging directly via SMC
battery charging off
battery charging on

# Disconnect power adapter input
battery adapter off
battery adapter on

# Self-repair permissions and launch daemons
battery repair
```

---

## ⚙️ Settings & Configuration

Access preferences by clicking the menu bar icon and selecting **Settings...**:
* **Target Charge Limit**: Set limit between 50% and 100%.
* **Force Discharge**: Toggle whether battery discharges when plugged in above target.
* **Menu Bar Display Style**: Choose between percentage text badge (`80%`) or clean icon display.
* **Granular Notifications**: Toggle specific alerts (Protection activated, Target reached, Low battery, Full charge completed, Pause ending, Temperature warning).
* **Diagnostics & Logs**: View live sanitized logs, run system health checks, or export diagnostic reports.

---

## 🛠️ Development & Contributing

Contributions are welcome! Please ensure all code meets repository standards before submitting pull requests.

### Prerequisites
* Node.js v20+
* ShellCheck (`brew install shellcheck`)

### Setup & Testing
```bash
# Clone the repository
git clone https://github.com/vtshreeram/battery.git
cd battery

# Validate shell scripts
shellcheck battery.sh setup.sh update.sh

# Install app dependencies
cd app
npm install

# Run static linting (check-only mode)
npm run lint:check

# Run automated test suite (mocked hardware, zero hardware mutation)
npm test

# Build production Electron release (macOS arm64)
npm run build
```

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
