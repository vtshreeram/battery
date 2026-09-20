const fs = require( 'node:fs' )
const path = require( 'node:path' )
const os = require( 'node:os' )
const { ProtectionState } = require( './state-machine' )
const { log } = require( './helpers' )

const STATS_FILE = path.join( os.homedir(), '.battery', 'stats.json' )

const DEFAULT_STATS = {
    time_protected_seconds: 0,
    time_charging_seconds: 0,
    time_on_battery_seconds: 0,
    time_force_discharging_seconds: 0,
    charge_target_reached_count: 0,
    full_charge_sessions_count: 0,
    last_updated: Date.now()
}

const load_stats = () => {
    try {
        if( fs.existsSync( STATS_FILE ) ) {
            const content = fs.readFileSync( STATS_FILE, 'utf8' )
            return { ...DEFAULT_STATS, ...JSON.parse( content ) }
        }
    } catch ( err ) {
        log( `[Statistics] Error reading stats: `, err?.message )
    }
    return { ...DEFAULT_STATS }
}

const save_stats = ( stats ) => {
    try {
        const dir = path.dirname( STATS_FILE )
        if( !fs.existsSync( dir ) ) {
            fs.mkdirSync( dir, { recursive: true } )
        }
        fs.writeFileSync( STATS_FILE, JSON.stringify( stats, null, 2 ), 'utf8' )
    } catch ( err ) {
        log( `[Statistics] Error saving stats: `, err?.message )
    }
}

let last_tick_time = Date.now()

/**
 * Increment duration counters based on current semantic state
 * @param {string} state - Current ProtectionState
 */
const update_statistics_tick = ( state ) => {
    const now = Date.now()
    const delta_sec = Math.round( ( now - last_tick_time ) / 1000 )
    last_tick_time = now

    if( delta_sec <= 0 || delta_sec > 300 ) {
        return // Ignore clock leaps or wake jumps > 5m
    }

    const stats = load_stats()

    if( state === ProtectionState.BYPASS || state === ProtectionState.TARGET_REACHED ) {
        stats.time_protected_seconds += delta_sec
    } else if( state === ProtectionState.CHARGING || state === ProtectionState.CHARGE_TO_FULL ) {
        stats.time_charging_seconds += delta_sec
    } else if( state === ProtectionState.ON_BATTERY ) {
        stats.time_on_battery_seconds += delta_sec
    } else if( state === ProtectionState.FORCE_DISCHARGING ) {
        stats.time_force_discharging_seconds += delta_sec
    }

    stats.last_updated = now
    save_stats( stats )
}

const increment_target_reached = () => {
    const stats = load_stats()
    stats.charge_target_reached_count += 1
    save_stats( stats )
}

const increment_full_charge_sessions = () => {
    const stats = load_stats()
    stats.full_charge_sessions_count += 1
    save_stats( stats )
}

const get_statistics = () => {
    return load_stats()
}

const reset_statistics = () => {
    save_stats( { ...DEFAULT_STATS, last_updated: Date.now() } )
}

module.exports = {
    STATS_FILE,
    update_statistics_tick,
    increment_target_reached,
    increment_full_charge_sessions,
    get_statistics,
    reset_statistics
}
