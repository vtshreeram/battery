const fs = require( 'node:fs' )
const path = require( 'node:path' )
const os = require( 'node:os' )
const { log } = require( './helpers' )

const HEALTH_HISTORY_FILE = path.join( os.homedir(), '.battery', 'health_history.json' )
const MAX_SNAPSHOTS = 300

let last_snapshot_time = 0

const load_health_history = () => {
    try {
        if( fs.existsSync( HEALTH_HISTORY_FILE ) ) {
            const content = fs.readFileSync( HEALTH_HISTORY_FILE, 'utf8' )
            const data = JSON.parse( content )
            return Array.isArray( data ) ? data : []
        }
    } catch ( err ) {
        log( `[HealthHistory] Error reading health history: `, err?.message )
    }
    return []
}

const save_health_history = ( snapshots = [] ) => {
    try {
        const dir = path.dirname( HEALTH_HISTORY_FILE )
        if( !fs.existsSync( dir ) ) {
            fs.mkdirSync( dir, { recursive: true } )
        }
        const trimmed = snapshots.slice( -MAX_SNAPSHOTS )
        fs.writeFileSync( HEALTH_HISTORY_FILE, JSON.stringify( trimmed, null, 2 ), 'utf8' )
    } catch ( err ) {
        log( `[HealthHistory] Error saving health history: `, err?.message )
    }
}

/**
 * Record a battery health snapshot (at most once every 30 minutes)
 * @param {object} health
 */
const record_health_snapshot = ( health ) => {
    const now = Date.now()
    if( !health || !health.available ) return null
    if( now - last_snapshot_time < 30 * 60 * 1000 ) {
        return null // Rate limit to prevent disk thrashing
    }

    const capacity_num = health.capacity && health.capacity.includes( '%' ) ? parseInt( health.capacity, 10 ) : null
    const cycles_num = health.cycles && health.cycles !== 'Unavailable' ? parseInt( health.cycles, 10 ) : null
    const temp_c = health.temperature && health.temperature.includes( '°C' ) ? parseFloat( health.temperature ) : null

    const snapshot = {
        timestamp: now,
        capacity_pct: capacity_num,
        cycles: cycles_num,
        temperature_c: temp_c,
        condition: health.condition || 'Unavailable'
    }

    last_snapshot_time = now
    const history = load_health_history()
    history.push( snapshot )
    save_health_history( history )
    log( `[HealthHistory] Health snapshot recorded: ${ health.capacity }, ${ health.cycles } cycles, ${ health.temperature }` )
    return snapshot
}

/**
 * Get recent health history snapshots
 * @param {number} limit
 */
const get_health_history = ( limit = 50 ) => {
    const history = load_health_history()
    return history.slice( -limit )
}

/**
 * Compute aggregate observational statistics from recorded history
 */
const get_health_trends = () => {
    const history = load_health_history()
    if( history.length === 0 ) {
        return {
            has_data: false,
            avg_temp_c: null,
            min_temp_c: null,
            max_temp_c: null,
            total_snapshots: 0
        }
    }

    const temps = history.map( h => h.temperature_c ).filter( t => t !== null && !isNaN( t ) )
    const avg_temp = temps.length ? ( temps.reduce( ( a, b ) => a + b, 0 ) / temps.length ).toFixed( 1 ) : null
    const min_temp = temps.length ? Math.min( ...temps ).toFixed( 1 ) : null
    const max_temp = temps.length ? Math.max( ...temps ).toFixed( 1 ) : null

    return {
        has_data: true,
        avg_temp_c: avg_temp ? `${ avg_temp }°C` : 'Unavailable',
        min_temp_c: min_temp ? `${ min_temp }°C` : 'Unavailable',
        max_temp_c: max_temp ? `${ max_temp }°C` : 'Unavailable',
        total_snapshots: history.length
    }
}

module.exports = {
    HEALTH_HISTORY_FILE,
    MAX_SNAPSHOTS,
    record_health_snapshot,
    get_health_history,
    get_health_trends
}
