const { log, confirm } = require( './helpers' )
const {
    get_setting,
    set_setting,
    get_all_settings,
    reset_settings_to_defaults
} = require( './settings-store' )

const get_force_discharge_setting = () => {
    return Boolean( get_setting( 'force_discharge', false ) )
}

const toggle_force_discharge = () => {
    const current = get_force_discharge_setting()
    log( `[Settings] Setting force discharge to ${ !current }` )
    set_setting( 'force_discharge', !current )
    return !current
}

const update_force_discharge_setting = async () => {
    try {
        const currently_allowed = get_force_discharge_setting()
        if( !currently_allowed ) {
            const proceed = await confirm(
                `This setting allows your battery to drain to the desired maintenance level while plugged in. ` +
                `This does not work well in Clamshell mode (laptop closed with an external monitor).\n\nAllow force-discharging?`
            )
            if( !proceed ) return false
        }
        return toggle_force_discharge()
    } catch ( e ) {
        log( `[Settings] Error updating force discharge: `, e )
        return false
    }
}

const get_notifications_setting = () => {
    const notifications = get_setting( 'notifications', {} )
    return Object.values( notifications ).some( Boolean )
}

const toggle_notifications_setting = () => {
    const current = get_notifications_setting()
    const new_state = !current
    const notifications = get_setting( 'notifications', {} )
    const updated = {}
    for( const key of Object.keys( notifications ) ) {
        updated[ key ] = new_state
    }
    set_setting( 'notifications', updated )
    log( `[Settings] Toggled all notifications to: ${ new_state }` )
    return new_state
}

const get_notification_category = ( category ) => {
    const notifications = get_setting( 'notifications', {} )
    return notifications[ category ] !== undefined ? notifications[ category ] : true
}

const set_notification_category = ( category, enabled ) => {
    const notifications = { ...get_setting( 'notifications', {} ) }
    notifications[ category ] = Boolean( enabled )
    set_setting( 'notifications', notifications )
    return notifications
}

const get_icon_style_setting = () => {
    return get_setting( 'display_style', 'text' )
}

const toggle_icon_style_setting = () => {
    const current = get_icon_style_setting()
    const new_val = current === 'text' ? 'icon' : 'text'
    set_setting( 'display_style', new_val )
    log( `[Settings] Setting icon style to: ${ new_val }` )
    return new_val
}

const get_protection_mode = () => {
    return get_setting( 'protection_mode', 'enabled' )
}

const set_protection_mode = ( mode ) => {
    if( mode !== 'enabled' && mode !== 'disabled' ) {
        throw new Error( `Invalid protection mode: ${ mode }` )
    }
    log( `[Settings] Setting protection mode to: ${ mode }` )
    return set_setting( 'protection_mode', mode )
}

const get_charge_limit = () => {
    const limit = Number( get_setting( 'charge_limit', 80 ) )
    return isNaN( limit ) ? 80 : Math.min( 100, Math.max( 50, limit ) )
}

const set_charge_limit = ( limit ) => {
    const num = Number( limit )
    if( isNaN( num ) || num < 50 || num > 100 ) {
        throw new Error( `Invalid charge limit: ${ limit }. Must be between 50 and 100.` )
    }
    log( `[Settings] Setting charge limit to: ${ num }%` )
    return set_setting( 'charge_limit', Math.round( num ) )
}

const get_temporary_workflow = () => {
    return get_setting( 'temporary_workflow', null )
}

const set_temporary_workflow = ( workflow ) => {
    return set_setting( 'temporary_workflow', workflow )
}

const get_schedule = () => {
    return get_setting( 'schedule', null )
}

const set_schedule = ( schedule ) => {
    return set_setting( 'schedule', schedule )
}

const get_travel_mode = () => {
    return get_setting( 'travel_mode', null )
}

const set_travel_mode = ( travel_mode ) => {
    return set_setting( 'travel_mode', travel_mode )
}

module.exports = {
    get_force_discharge_setting,
    toggle_force_discharge,
    update_force_discharge_setting,
    get_notifications_setting,
    toggle_notifications_setting,
    get_notification_category,
    set_notification_category,
    get_icon_style_setting,
    toggle_icon_style_setting,
    get_protection_mode,
    set_protection_mode,
    get_charge_limit,
    set_charge_limit,
    get_temporary_workflow,
    set_temporary_workflow,
    get_schedule,
    set_schedule,
    get_travel_mode,
    set_travel_mode,
    get_all_settings,
    reset_settings_to_defaults
}