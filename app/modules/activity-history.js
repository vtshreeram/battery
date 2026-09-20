const fs = require( 'node:fs' )
const path = require( 'node:path' )
const os = require( 'node:os' )
const { log } = require( './helpers' )

const ACTIVITY_FILE = path.join( os.homedir(), '.battery', 'activity.json' )
const MAX_HISTORY_ENTRIES = 500

let last_recorded_event = null

/**
 * Load activity history from disk
 * @returns {Array}
 */
const load_activity = () => {
    try {
        if( fs.existsSync( ACTIVITY_FILE ) ) {
            const raw = fs.readFileSync( ACTIVITY_FILE, 'utf8' )
            const parsed = JSON.parse( raw )
            return Array.isArray( parsed ) ? parsed : []
        }
    } catch ( err ) {
        log( `[Activity] Error loading activity history: `, err?.message )
    }
    return []
}

/**
 * Save activity history to disk
 * @param {Array} entries
 */
const save_activity = ( entries = [] ) => {
    try {
        const dir = path.dirname( ACTIVITY_FILE )
        if( !fs.existsSync( dir ) ) {
            fs.mkdirSync( dir, { recursive: true } )
        }
        const trimmed = entries.slice( -MAX_HISTORY_ENTRIES )
        fs.writeFileSync( ACTIVITY_FILE, JSON.stringify( trimmed, null, 2 ), 'utf8' )
    } catch ( err ) {
        log( `[Activity] Error saving activity history: `, err?.message )
    }
}

/**
 * Record a significant lifecycle or battery event
 * Deduplicates events if identical to the previous event recorded within 1 minute
 * @param {object} event
 * @param {string} event.type - Event category identifier
 * @param {string} event.title - Human readable title
 * @param {string} event.detail - Detailed explanation
 * @param {'info'|'warning'|'error'} [event.level='info'] - Severity
 */
const record_event = ( { type, title, detail = '', level = 'info' } ) => {
    const now = Date.now()
    if( last_recorded_event && last_recorded_event.type === type && last_recorded_event.title === title &&  now - last_recorded_event.timestamp < 60000  ) {
        return null // Suppress duplicate within 1 min
    }

    const event = {
        id: `${ now }-${ Math.random().toString( 36 ).slice( 2, 7 ) }`,
        timestamp: now,
        type,
        title,
        detail,
        level
    }

    last_recorded_event = event
    const history = load_activity()
    history.push( event )
    save_activity( history )
    log( `[Activity] Event recorded: [${ level.toUpperCase() }] ${ title } - ${ detail }` )
    return event
}

/**
 * Get recent activity events
 * @param {number} limit
 * @returns {Array}
 */
const get_recent_activity = ( limit = 50 ) => {
    const history = load_activity()
    return history.slice( -limit ).reverse()
}

/**
 * Clear activity history
 */
const clear_activity = () => {
    save_activity( [] )
}

module.exports = {
    ACTIVITY_FILE,
    MAX_HISTORY_ENTRIES,
    record_event,
    get_recent_activity,
    clear_activity
}
