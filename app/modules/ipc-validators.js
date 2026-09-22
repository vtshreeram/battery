const CHARGE_LIMIT_MIN = 50
const CHARGE_LIMIT_MAX = 100
const PAUSE_DURATIONS = new Set( [ '1h', '4h', 'tomorrow', 'unplugged' ] )
const DISPLAY_STYLES = new Set( [ 'text', 'icon' ] )
const ALERT_STYLES = new Set( [ 'none', 'banners', 'alerts' ] )
const MAX_SCHEDULE_HORIZON_MS = 14 * 24 * 60 * 60 * 1000

function invalid( message ) {
    const error = new Error( message )
    error.code = 'INVALID_INPUT'
    return error
}

function require_boolean( value, label ) {
    if( typeof value !== 'boolean' ) {
        throw invalid( `${ label } must be a boolean` )
    }
    return value
}

function require_protection_mode( mode ) {
    if( mode !== 'enabled' && mode !== 'disabled' ) {
        throw invalid( `Invalid protection mode: ${ mode }` )
    }
    return mode
}

function require_charge_limit( limit ) {
    const num = typeof limit === 'number' ? limit : Number( String( limit ) )
    if( !Number.isInteger( num ) || num < CHARGE_LIMIT_MIN || num > CHARGE_LIMIT_MAX ) {
        throw invalid( `Invalid charge limit: ${ limit }. Must be an integer between ${ CHARGE_LIMIT_MIN } and ${ CHARGE_LIMIT_MAX }.` )
    }
    return num
}

function require_future_timestamp( value ) {
    const num = typeof value === 'number' ? value : Number( value )
    if( !Number.isFinite( num ) ) {
        throw invalid( 'Target time must be a finite timestamp' )
    }
    const now = Date.now()
    if( num <= now ) {
        throw invalid( 'Target time must be in the future.' )
    }
    if( num - now > MAX_SCHEDULE_HORIZON_MS ) {
        throw invalid( 'Target time is too far in the future.' )
    }
    return num
}

function require_display_style( style ) {
    if( !DISPLAY_STYLES.has( style ) ) {
        throw invalid( `Invalid display style: ${ style }` )
    }
    return style
}

function require_pause_duration( duration ) {
    if( !PAUSE_DURATIONS.has( duration ) ) {
        throw invalid( `Invalid pause duration: ${ duration }` )
    }
    return duration
}

function require_alert_style( style ) {
    if( !ALERT_STYLES.has( style ) ) {
        throw invalid( `Invalid alert style: ${ style }` )
    }
    return style
}

module.exports = {
    require_boolean,
    require_protection_mode,
    require_charge_limit,
    require_future_timestamp,
    require_display_style,
    require_pause_duration,
    require_alert_style
}
