const fs = require( 'node:fs' )
const path = require( 'node:path' )
const os = require( 'node:os' )
const { exec_file_async } = require( './process-runner' )
const { REPOSITORY_OWNER, REPOSITORY_NAME } = require( './config' )
const { get_all_settings } = require( './settings' )
const { log } = require( './helpers' )

const BINFOLDER = '/usr/local/co.palokaj.battery'
const BATTERY_BINARY = path.join( BINFOLDER, 'battery' )
const SMC_BINARY = path.join( BINFOLDER, 'smc' )
const CONFIG_FOLDER = path.join( os.homedir(), '.battery' )
const LAUNCH_AGENT = path.join( os.homedir(), 'Library', 'LaunchAgents', 'battery.plist' )

/**
 * Run a full system diagnostic inspection
 * Returns an array of diagnostic check items:
 * { id: string, name: string, status: 'pass'|'warning'|'failure'|'unavailable', details: string }
 */
const run_diagnostics = async () => {
    log( `[Diagnostics] Starting system diagnostics check...` )
    const checks = []

    // 1. Apple Silicon Architecture Check
    const arch = os.arch()
    if( arch === 'arm64' ) {
        checks.push( {
            id: 'arch',
            name: 'Apple Silicon Architecture',
            status: 'pass',
            details: `Detected architecture: ${ arch }`
        } )
    } else {
        checks.push( {
            id: 'arch',
            name: 'Apple Silicon Architecture',
            status: 'warning',
            details: `Non-ARM architecture: ${ arch }. Battery utility requires Apple Silicon.`
        } )
    }

    // 2. Apple Battery Hardware Detection
    try {
        const ioreg = await exec_file_async( '/usr/sbin/ioreg', [ '-r', '-c', 'AppleSmartBattery' ] )
        if( ioreg.stdout && ioreg.stdout.includes( 'AppleSmartBattery' ) ) {
            checks.push( {
                id: 'hardware_battery',
                name: 'Apple Battery Detection',
                status: 'pass',
                details: 'Smart battery controller detected via IORegistry'
            } )
        } else {
            checks.push( {
                id: 'hardware_battery',
                name: 'Apple Battery Detection',
                status: 'failure',
                details: 'No AppleSmartBattery found in IORegistry'
            } )
        }
    } catch ( err ) {
        checks.push( {
            id: 'hardware_battery',
            name: 'Apple Battery Detection',
            status: 'failure',
            details: `Failed to probe IORegistry: ${ err.message }`
        } )
    }

    // 3. Configured Binary Directory Existence & Permissions
    try {
        const binStat = fs.statSync( BINFOLDER )
        const isRootOwned = binStat.uid === 0
        if( isRootOwned ) {
            checks.push( {
                id: 'bin_dir',
                name: 'Binary Directory Security',
                status: 'pass',
                details: `${ BINFOLDER } exists and is owned by root (UID 0)`
            } )
        } else {
            checks.push( {
                id: 'bin_dir',
                name: 'Binary Directory Security',
                status: 'failure',
                details: `${ BINFOLDER } is owned by UID ${ binStat.uid } (must be 0/root)`
            } )
        }
    } catch ( err ) {
        checks.push( {
            id: 'bin_dir',
            name: 'Binary Directory Security',
            status: 'failure',
            details: `Binary directory ${ BINFOLDER } missing or inaccessible: ${ err.message }`
        } )
    }

    // 4. CLI Binary Existence & Ownership
    try {
        const batStat = fs.statSync( BATTERY_BINARY )
        if( batStat.uid === 0 ) {
            checks.push( {
                id: 'cli_binary',
                name: 'CLI Binary Ownership',
                status: 'pass',
                details: `${ BATTERY_BINARY } exists and is owned by root`
            } )
        } else {
            checks.push( {
                id: 'cli_binary',
                name: 'CLI Binary Ownership',
                status: 'failure',
                details: `${ BATTERY_BINARY } is owned by UID ${ batStat.uid } (must be root)`
            } )
        }
    } catch ( err ) {
        checks.push( {
            id: 'cli_binary',
            name: 'CLI Binary Ownership',
            status: 'failure',
            details: `CLI binary not found at ${ BATTERY_BINARY }`
        } )
    }

    // 5. SMC Binary Existence & Ownership
    try {
        const smcStat = fs.statSync( SMC_BINARY )
        if( smcStat.uid === 0 ) {
            checks.push( {
                id: 'smc_binary',
                name: 'SMC Binary Ownership',
                status: 'pass',
                details: `${ SMC_BINARY } exists and is owned by root`
            } )
        } else {
            checks.push( {
                id: 'smc_binary',
                name: 'SMC Binary Ownership',
                status: 'failure',
                details: `${ SMC_BINARY } is owned by UID ${ smcStat.uid } (must be root)`
            } )
        }
    } catch ( err ) {
        checks.push( {
            id: 'smc_binary',
            name: 'SMC Binary Ownership',
            status: 'failure',
            details: `SMC binary not found at ${ SMC_BINARY }`
        } )
    }

    // 6. Sudoers / Visudo Functionality Check
    try {
        await exec_file_async( '/usr/bin/sudo', [ '-n', BATTERY_BINARY, 'update_silent', 'is_enabled' ], { timeout: 3000 } )
        checks.push( {
            id: 'sudoers',
            name: 'Sudoers Configuration',
            status: 'pass',
            details: 'Passwordless sudo access verified for battery update_silent'
        } )
    } catch ( err ) {
        checks.push( {
            id: 'sudoers',
            name: 'Sudoers Configuration',
            status: 'failure',
            details: `Passwordless sudo check failed: ${ err.message }`
        } )
    }

    // 7. CLI Status Execution
    let cli_version = 'Unknown'
    try {
        const ver = await exec_file_async( BATTERY_BINARY, [ 'version' ], { timeout: 3000 } )
        cli_version = ver.stdout.trim()
        const statusRes = await exec_file_async( BATTERY_BINARY, [ 'status_csv' ], { timeout: 3000 } )
        checks.push( {
            id: 'cli_status',
            name: 'CLI Status Execution',
            status: 'pass',
            details: `CLI ${ cli_version } returned: ${ statusRes.stdout.trim() }`
        } )
    } catch ( err ) {
        checks.push( {
            id: 'cli_status',
            name: 'CLI Status Execution',
            status: 'failure',
            details: `Unable to query CLI status: ${ err.message }`
        } )
    }

    // 8. Launch Agent Background Daemon Status
    try {
        const plistExists = fs.existsSync( LAUNCH_AGENT )
        if( plistExists ) {
            checks.push( {
                id: 'launch_agent',
                name: 'Background Maintenance LaunchAgent',
                status: 'pass',
                details: `LaunchAgent plist is configured at ${ LAUNCH_AGENT }`
            } )
        } else {
            checks.push( {
                id: 'launch_agent',
                name: 'Background Maintenance LaunchAgent',
                status: 'warning',
                details: `LaunchAgent plist does not exist at ${ LAUNCH_AGENT }`
            } )
        }
    } catch ( err ) {
        checks.push( {
            id: 'launch_agent',
            name: 'Background Maintenance LaunchAgent',
            status: 'unavailable',
            details: `Cannot read LaunchAgent path: ${ err.message }`
        } )
    }

    // 9. Writable User Configuration Directory
    try {
        if( !fs.existsSync( CONFIG_FOLDER ) ) {
            fs.mkdirSync( CONFIG_FOLDER, { recursive: true } )
        }
        fs.accessSync( CONFIG_FOLDER, fs.constants.R_OK | fs.constants.W_OK )
        checks.push( {
            id: 'config_dir',
            name: 'User Configuration Directory',
            status: 'pass',
            details: `Directory ${ CONFIG_FOLDER } is readable and writable`
        } )
    } catch ( err ) {
        checks.push( {
            id: 'config_dir',
            name: 'User Configuration Directory',
            status: 'failure',
            details: `Cannot access ${ CONFIG_FOLDER }: ${ err.message }`
        } )
    }

    // 10. Repository & Update Source Correctness
    try {
        // Read battery.sh source if available
        if( fs.existsSync( BATTERY_BINARY ) ) {
            const content = fs.readFileSync( BATTERY_BINARY, 'utf8' )
            const userMatch = content.match( /github_user="([^"]+)"/ )
            const branchMatch = content.match( /github_branch="([^"]+)"/ )
            const configuredUser = userMatch ? userMatch[ 1 ] : 'unknown'
            const configuredBranch = branchMatch ? branchMatch[ 1 ] : 'unknown'

            if( configuredUser === REPOSITORY_OWNER && configuredBranch === 'main' ) {
                checks.push( {
                    id: 'repo_source',
                    name: 'Update Source Repository',
                    status: 'pass',
                    details: `Configured to official fork: ${ configuredUser }/${ REPOSITORY_NAME } (${ configuredBranch })`
                } )
            } else {
                checks.push( {
                    id: 'repo_source',
                    name: 'Update Source Repository',
                    status: 'warning',
                    details: `Update source mismatch: ${ configuredUser }/${ REPOSITORY_NAME } (${ configuredBranch }). Expected ${ REPOSITORY_OWNER }/main`
                } )
            }
        } else {
            checks.push( {
                id: 'repo_source',
                name: 'Update Source Repository',
                status: 'unavailable',
                details: 'Cannot inspect battery binary for repository URLs'
            } )
        }
    } catch ( err ) {
        checks.push( {
            id: 'repo_source',
            name: 'Update Source Repository',
            status: 'unavailable',
            details: `Error inspecting update source: ${ err.message }`
        } )
    }

    // 11. Persisted Protection Mode
    try {
        const settings = get_all_settings()
        checks.push( {
            id: 'persisted_mode',
            name: 'Charge limit preference',
            status: 'pass',
            details: `Mode: ${ settings.protection_mode }, Target Limit: ${ settings.charge_limit }%`
        } )
    } catch ( err ) {
        checks.push( {
            id: 'persisted_mode',
            name: 'Charge limit preference',
            status: 'warning',
            details: `Could not read persisted settings: ${ err.message }`
        } )
    }

    log( `[Diagnostics] Completed diagnostics check. Total checks: ${ checks.length }` )
    return checks
}

module.exports = {
    BINFOLDER,
    BATTERY_BINARY,
    SMC_BINARY,
    CONFIG_FOLDER,
    LAUNCH_AGENT,
    run_diagnostics
}
