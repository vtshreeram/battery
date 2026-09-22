const { app } = require( 'electron' )
const { log, alert, wait, confirm } = require( './helpers' )
const {
    get_force_discharge_setting,
    get_protection_mode,
    set_protection_mode,
    get_charge_limit,
    set_charge_limit
} = require( './settings' )
const {
    exec_file_async,
    exec_async,
    exec_sudo_async
} = require( './process-runner' )
const { URL_SETUP_SH } = require( './config' )

const { USER } = process.env
const binfolder = '/usr/local/co.palokaj.battery'
const battery = `${ binfolder }/battery`

// Passwordless SMC writes from visudoconfig in battery.sh. Firmware limit keys hold the
// charge ceiling while the adapter keeps powering the Mac. CH0J/CHIE/CH0I only isolate the adapter.
const smc_commands = [
    'bfF0 -w 00',
    'bfF0 -w 02',
    'bfD0 -w',
    'bfE0 -w',
    'CH0B -w 02',
    'CH0C -w 02',
    'CHTE -w 01000000',
    'CH0B -w 00',
    'CH0C -w 00',
    'CHTE -w 00000000',
    'CH0I -w 00',
    'CHIE -w 00',
    'CH0J -w 00',
    'CH0I -w 01',
    'CHIE -w 08',
    'CH0J -w 01'
]

/**
 * Parse raw CLI status_csv output into structured typed result
 * @param {string} csv_text
 * @returns {object}
 */
const parse_status_csv = ( csv_text = '' ) => {
    const trimmed = csv_text.trim()
    if( !trimmed ) {
        return {
            available: false,
            errorCode: 'EMPTY_OUTPUT',
            errorMessage: 'CLI returned empty status output',
            percentage: null,
            remaining: null,
            charging: null,
            discharging: null,
            maintain_percentage: null,
            maintainMode: null,
            lowerLimit: null,
            upperLimit: null,
            targetLimit: null,
            battery_state: 'Battery status unavailable',
            daemon_state: 'unavailable',
            source: 'cli',
            timestamp: Date.now()
        }
    }

    const parts = trimmed.split( ',' )
    const [ raw_percentage = '', raw_remaining = '', raw_charging = '', raw_discharging = '', raw_maintain = '' ] = parts

    const pct = parseInt( raw_percentage, 10 )
    const percentage = isNaN( pct ) ? null : pct
    const timeMatch = raw_remaining.match( /\d{1,2}:\d{2}/ )
    const remaining = timeMatch ? timeMatch[ 0 ] : 'unknown'
    const charging = raw_charging.trim() === 'enabled'
    const discharging = raw_discharging.trim() === 'discharging'
    const maintain = parse_maintain_field( raw_maintain )
    const { maintain_percentage } = maintain

    const is_valid = percentage !== null

    const remaining_suffix = remaining && remaining !== 'unknown' && remaining !== '0:00' ? ` (${ remaining } remaining)` : ''
    let battery_state = is_valid ? `${ percentage }%${ remaining_suffix }` : 'Battery status unavailable'
    let daemon_state = ''
    if( discharging ) {
        daemon_state = maintain_percentage === null
            ? 'forcing discharge'
            : `forcing discharge to ${ maintain_percentage }%`
    } else {
        daemon_state = `smc charging ${ charging ? 'enabled' : 'disabled' }`
    }

    return {
        available: is_valid,
        percentage,
        remaining,
        charging,
        discharging,
        maintain_percentage,
        maintainMode: maintain.maintainMode,
        lowerLimit: maintain.lowerLimit,
        upperLimit: maintain.upperLimit,
        targetLimit: maintain.targetLimit,
        battery_state,
        daemon_state,
        source: 'cli',
        timestamp: Date.now()
    }
}

/**
 * Keep a percentage range intact. parseInt("70-80") is 70 and would drop the upper bound.
 * @param {string} raw
 */
function parse_maintain_field( raw ) {
    const text = String( raw || '' ).trim()
    const empty = {
        maintainMode: null,
        maintain_percentage: null,
        lowerLimit: null,
        upperLimit: null,
        targetLimit: null
    }
    if( !text ) return empty

    const range = text.match( /^(\d{1,3})-(\d{1,3})$/ )
    if( range ) {
        const lowerLimit = Number( range[ 1 ] )
        const upperLimit = Number( range[ 2 ] )
        if( lowerLimit >= 0 && upperLimit <= 100 && lowerLimit < upperLimit ) {
            return {
                maintainMode: 'range',
                maintain_percentage: upperLimit,
                lowerLimit,
                upperLimit,
                targetLimit: null
            }
        }
        return empty
    }

    if( /^\d{1,3}$/.test( text ) ) {
        const targetLimit = Number( text )
        if( targetLimit >= 0 && targetLimit <= 100 ) {
            return {
                maintainMode: 'percentage',
                maintain_percentage: targetLimit,
                lowerLimit: targetLimit,
                upperLimit: targetLimit,
                targetLimit
            }
        }
    }

    return { ...empty, maintainMode: 'unknown' }
}

/**
 * Battery status checker with retries and explicit error state
 * NEVER returns fabricated fallback values (e.g. 80%) when hardware is unreachable.
 * @param {number} retries
 * @returns {Promise<object>}
 */
const get_battery_status = async ( retries = 2 ) => {
    try {
        const result = await exec_async( `${ battery } status_csv`, 3000 )
        const parsed = parse_status_csv( result.stdout )
        if( parsed.available ) {
            log( `[Battery] Status ${ parsed.percentage }% charging=${ parsed.charging } discharging=${ parsed.discharging } maintain=${ parsed.maintain_percentage }` )
            return parsed
        }
        throw new Error( parsed.errorMessage || 'Invalid status output from CLI' )
    } catch ( e ) {
        log( `[Battery] Error getting battery status: `, e?.message || e )
        if( retries > 0 ) {
            await wait( 500 )
            return get_battery_status( retries - 1 )
        }

        const ERR_COMMAND_NOT_FOUND = 127
        if( e.code === ERR_COMMAND_NOT_FOUND ) {
            log( `[Battery] Binary not found error, reporting unavailable` )
        }

        // Return explicit UNAVAILABLE structure. NEVER fake 80% or active state.
        return {
            available: false,
            errorCode: e.code || 'STATUS_ERROR',
            errorMessage: e.message || 'Battery status unavailable',
            percentage: null,
            remaining: null,
            charging: null,
            discharging: null,
            maintain_percentage: null,
            maintainMode: null,
            lowerLimit: null,
            upperLimit: null,
            targetLimit: null,
            battery_state: 'Battery status unavailable',
            daemon_state: 'unavailable',
            source: 'cli',
            timestamp: Date.now()
        }
    }
}

/**
 * Desired limit matches the maintain target reported by the CLI.
 * A range matches on its upper bound, which is the ceiling the firmware holds.
 */
function observed_limit_matches( status, limit ) {
    if( !status || status.available !== true ) return false
    if( status.maintainMode === 'range' ) {
        return status.upperLimit === limit
    }
    if( status.maintainMode === 'percentage' ) {
        return status.targetLimit === limit
    }
    return status.maintain_percentage === limit
}

/**
 * Enable battery limiter at the requested limit.
 * protection_mode and charge_limit are updated only after the CLI accepts the limit
 * and status readback shows that same target.
 * @param {number} targetLimit
 * @returns {Promise<number|null>} current battery percentage, or null when the operation failed
 */
const enable_battery_limiter = async ( targetLimit ) => {
    try {
        const requested = targetLimit === undefined || targetLimit === null || targetLimit === ''
            ? get_charge_limit()
            : Number( targetLimit )
        if( !Number.isInteger( requested ) || requested < 50 || requested > 100 ) {
            throw new Error( `Invalid charge limit: ${ targetLimit }. Must be an integer between 50 and 100.` )
        }

        const allow_force_discharge = get_force_discharge_setting()
        log( `[Battery] Enabling battery limiter at ${ requested }% (force-discharge: ${ allow_force_discharge })` )

        try {
            await exec_async(
                `${ battery } maintain ${ requested }${ allow_force_discharge ? ' --force-discharge' : '' }`,
                20000
            )
        } catch ( exec_error ) {
            if( exec_error?.code !== 'ETIMEDOUT' ) throw exec_error
            log( '[Battery] maintain launcher timed out; checking whether the limiter is running' )
        }

        const status = await get_battery_status()
        if( !observed_limit_matches( status, requested ) ) {
            throw new Error( `Charge limit ${ requested }% was not confirmed by battery status` )
        }

        set_charge_limit( requested )
        set_protection_mode( 'enabled' )
        log( `[Battery] enable_battery_limiter confirmed at ${ requested }%, battery ${ status.percentage }%` )
        return status.percentage
    } catch ( e ) {
        log( '[Battery] Error enabling battery limiter: ', e )
        try {
            await alert( `Could not enable battery protection:\n${ e.message }` )
        } catch ( alert_error ) {
            log( '[Battery] Could not show the enable-failure dialog: ', alert_error?.message || alert_error )
        }
        return null
    }
}

/**
 * Disable battery limiter.
 * protection_mode stays unchanged until `maintain stop` finishes and status no longer reports an active maintain process.
 */
const disable_battery_limiter = async () => {
    try {
        log( `[Battery] Disabling battery limiter` )
        await exec_async( `${ battery } maintain stop`, 8000 )
        const still_running = await is_limiter_enabled()
        if( still_running ) {
            throw new Error( 'Maintenance process was still running after maintain stop' )
        }
        set_protection_mode( 'disabled' )
        const status = await get_battery_status()
        return status?.percentage ?? null
    } catch ( e ) {
        log( '[Battery] Error disabling battery limiter: ', e )
        try {
            await alert( `Could not disable battery protection:\n${ e.message }` )
        } catch ( alert_error ) {
            log( '[Battery] Could not show the disable-failure dialog: ', alert_error?.message || alert_error )
        }
        return null
    }
}

const log_err_return_false = ( ...errdata ) => {
    log( '[Battery] Error in shell call: ', ...errdata )
    return false
}

/**
 * Check if the CLI maintenance process is actively maintaining
 */
async function is_limiter_enabled() {
    try {
        const result = await exec_async( `${ battery } status` )
        return result.stdout.includes( 'being maintained at' )
    } catch ( e ) {
        log( `[Battery] Error checking limiter status: `, e?.message )
        return false
    }
}

/**
 * Initialize battery background components and restore persisted user mode
 */
const initialize_battery = async () => {
    try {
        const { development, skipupdate } = process.env
        if( development ) log( `[Battery] Dev mode active, skip updates: ${ skipupdate }` )

        // Online check
        const online_check_timeout = 3000
        const online = await Promise.any( [
            exec_async( `curl -I https://icanhazip.com > /dev/null 2>&1`, online_check_timeout ),
            exec_async( `curl -I https://github.com > /dev/null 2>&1`, online_check_timeout )
        ] ).then( () => true ).catch( () => false )

        log( `[Battery] Internet online: ${ online }` )

        // Verify root-owned installation integrity
        const [
            bin_dir_root_owned,
            battery_installed,
            smc_installed,
            silent_update_enabled
        ] = await Promise.all( [
            exec_async( `test ! -L ${ binfolder } && test "$(stat -f '%u' ${ binfolder })" -eq 0` ).then( () => true ).catch( log_err_return_false ),
            exec_async( `test ! -L ${ battery } && test "$(stat -f '%u' ${ battery })" -eq 0` ).then( () => true ).catch( log_err_return_false ),
            exec_async( `test ! -L ${ binfolder }/smc && test "$(stat -f '%u' ${ binfolder }/smc)" -eq 0` ).then( () => true ).catch( log_err_return_false ),
            exec_async( `sudo -n ${ battery } update_silent is_enabled` ).then( () => true ).catch( log_err_return_false )
        ] )

        const is_installed = bin_dir_root_owned && battery_installed && smc_installed && silent_update_enabled
        log( `[Battery] Is installed: ${ is_installed } (bin: ${ bin_dir_root_owned }, cli: ${ battery_installed }, smc: ${ smc_installed }, visudo: ${ silent_update_enabled })` )

        if( !is_installed ) {
            log( `[Battery] Installing battery background components for ${ USER }...` )
            if( !online ) {
                return alert( `Battery needs an internet connection to download the required components. Please connect to the internet and relaunch.` )
            }
            await alert( `Welcome to Battery. The app needs to configure background helper components and will ask for your administrator password once.` )
            try {
                // Use official fork URL from config
                const install_cmd = `curl -s ${ URL_SETUP_SH } | bash -s -- ${ USER || '$USER' }`
                const result = await exec_sudo_async( install_cmd )
                log( `[Battery] Install completed: `, result )
                await alert( `Battery background components installed successfully.` )
            } catch ( e ) {
                log( `[Battery] Setup failed: `, e )
                await alert( `Failed to install background components:\n\n${ e.message }` )
                app.quit()
                app.exit()
                return
            }
        } else {
            // Update check if online
            if( online && !skipupdate ) {
                log( `[Battery] Checking for background updates...` )
                try {
                    await exec_async( `sudo -n ${ battery } update_silent`, 5000 )
                } catch ( e ) {
                    log( `[Battery] Background update check skipped: `, e?.message )
                }
            }
        }

        // Restore persisted user protection mode
        const mode = get_protection_mode()
        const target_limit = get_charge_limit()
        const currently_maintaining = await is_limiter_enabled()

        log( `[Battery] Startup state: persisted mode='${ mode }', target=${ target_limit }%, currently_maintaining=${ currently_maintaining }` )

        if( mode === 'enabled' ) {
            const live_status = currently_maintaining ? await get_battery_status() : null
            const live_limit = live_status?.maintain_percentage
            if( !currently_maintaining ) {
                log( `[Battery] Protection mode is 'enabled' but daemon was inactive. Restoring maintenance at ${ target_limit }%` )
                await enable_battery_limiter( target_limit )
            } else if( live_limit && live_limit !== target_limit ) {
                log( `[Battery] Live maintain ${ live_limit }% differs from saved limit ${ target_limit }%. Re-applying saved limit.` )
                await enable_battery_limiter( target_limit )
            }
        } else {
            log( `[Battery] Protection mode is 'disabled'. Ensuring maintenance is stopped.` )
            if( currently_maintaining ) {
                await exec_async( `${ battery } maintain stop` ).catch( () => {} )
            }
        }

    } catch ( e ) {
        log( `[Battery] Error Initializing battery: `, e )
        await alert( `Battery initialization error: ${ e.message }` )
    }
}

/**
 * Uninstall battery CLI components
 */
const uninstall_battery = async () => {
    try {
        const confirmed = await confirm( `Are you sure you want to uninstall Battery? This will remove background daemons and reset charging to normal.` )
        if( !confirmed ) return false
        await exec_sudo_async( `sudo ${ battery } uninstall silent` ).catch( e => {
            if( e.code !== 'SIGNAL' ) throw e
        } )
        await alert( `Battery has been uninstalled.` )
        return true
    } catch ( e ) {
        log( '[Battery] Error uninstalling battery: ', e )
        await alert( `Error uninstalling battery: ${ e.message }` )
        return false
    }
}

/**
 * Parse IORegistry output for battery cycles and temperature
 * @param {string} ioreg_stdout
 * @returns {{cycles: string, temperature: string}}
 */
const parse_ioreg_battery = ( ioreg_stdout = '' ) => {
    const cycle_match = ioreg_stdout.match( /"CycleCount"\s*=\s*(\d+)/ )
    const temp_match = ioreg_stdout.match( /"Temperature"\s*=\s*(\d+)/ )

    const cycles = cycle_match ? cycle_match[ 1 ] : 'Unavailable'
    let temperature = 'Unavailable'

    if( temp_match && temp_match[ 1 ] ) {
        const raw_val = Number( temp_match[ 1 ] )
        if( !isNaN( raw_val ) && raw_val > 0 ) {
            const temp_c = ( raw_val / 100 ).toFixed( 1 )
            const temp_f = (  Number( temp_c ) * 9 / 5  + 32 ).toFixed( 1 )
            temperature = `${ temp_c }°C / ${ temp_f }°F`
        }
    }

    return { cycles, temperature }
}

/**
 * Parse system_profiler SPPowerDataType output
 * NEVER default condition to 'Normal' if missing or failed!
 * @param {string} profiler_stdout
 * @returns {{capacity: string, condition: string}}
 */
const parse_system_profiler_battery = ( profiler_stdout = '' ) => {
    const capacity_match = profiler_stdout.match( /Maximum Capacity:\s*([0-9]+%)/i )
    const condition_match = profiler_stdout.match( /Condition:\s*([^\n\r]+)/i )

    const capacity = capacity_match ? capacity_match[ 1 ] : 'Unavailable'
    const condition = condition_match ? condition_match[ 1 ].trim() : 'Unavailable'

    return { capacity, condition }
}

let cached_health = null
let last_health_fetch = 0

/**
 * Get battery health diagnostics
 * Tolerates missing fields and surfaces 'Unavailable' explicitly rather than fake values.
 */
const get_battery_health = async () => {
    const now = Date.now()
    if( cached_health &&  now - last_health_fetch < 60000  ) {
        return cached_health
    }

    try {
        const ioreg_p = exec_file_async( '/usr/sbin/ioreg', [ '-r', '-c', 'AppleSmartBattery' ] ).catch( () => ( { stdout: '' } ) )
        const profiler_p = exec_file_async( '/usr/sbin/system_profiler', [ 'SPPowerDataType' ] ).catch( () => ( { stdout: '' } ) )

        const [ ioreg_res, profiler_res ] = await Promise.all( [ ioreg_p, profiler_p ] )

        const { cycles, temperature } = parse_ioreg_battery( ioreg_res.stdout )
        const { capacity, condition } = parse_system_profiler_battery( profiler_res.stdout )

        const available = cycles !== 'Unavailable' || capacity !== 'Unavailable' || condition !== 'Unavailable'

        cached_health = {
            available,
            cycles,
            capacity,
            condition,
            temperature,
            timestamp: now
        }
        last_health_fetch = now
        return cached_health
    } catch ( e ) {
        log( '[Battery] Error getting battery health: ', e )
        return {
            available: false,
            cycles: 'Unavailable',
            capacity: 'Unavailable',
            condition: 'Unavailable',
            temperature: 'Unavailable',
            timestamp: now
        }
    }
}

/**
 * Check if the AC power adapter is physically attached
 * @returns {Promise<boolean>}
 */
const is_ac_attached = async () => {
    try {
        const { stdout } = await exec_file_async( '/usr/sbin/ioreg', [ '-r', '-n', 'AppleSmartBattery' ] )
        return /"ExternalConnected"\s*=\s*Yes/i.test( stdout ) || /"FedExternalConnected"\s*=\s*1/i.test( stdout )
    } catch ( e ) {
        log( '[Battery] Error checking AC attached state: ', e?.message || e )
        return true
    }
}

/**
 * Switch power source to battery (disables AC adapter power draw even when plugged in)
 * @returns {Promise<object|null>}
 */
const switch_to_battery = async () => {
    try {
        log( '[Battery] Switching power source to battery...' )
        await exec_async( `${ battery } adapter off` )
        await wait( 1000 )
        const status = await get_battery_status()
        return status
    } catch ( e ) {
        log( '[Battery] Error switching to battery: ', e )
        await alert( `Could not switch to battery power:\n${ e.message }` )
        return null
    }
}

/**
 * Switch power source to power adapter (restores AC adapter power and limiter)
 * @returns {Promise<object|null>}
 */
const switch_to_power = async () => {
    try {
        log( '[Battery] Switching power source to power adapter...' )
        await exec_async( `${ battery } adapter on` )
        await wait( 1000 )
        const mode = get_protection_mode()
        const target = get_charge_limit()
        if( mode === 'enabled' ) {
            await enable_battery_limiter( target )
        }
        await wait( 500 )
        const status = await get_battery_status()
        return status
    } catch ( e ) {
        log( '[Battery] Error switching to power adapter: ', e )
        await alert( `Could not switch to power adapter:\n${ e.message }` )
        return null
    }
}

module.exports = {
    smc_commands,
    parse_status_csv,
    parse_maintain_field,
    parse_ioreg_battery,
    parse_system_profiler_battery,
    enable_battery_limiter,
    disable_battery_limiter,
    initialize_battery,
    is_limiter_enabled,
    get_battery_status,
    uninstall_battery,
    get_battery_health,
    is_ac_attached,
    switch_to_battery,
    switch_to_power
}
