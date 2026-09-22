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

const set_force_discharge_setting = ( enabled ) => {
    const next = Boolean( enabled )
    log( `[Settings] Setting force discharge to ${ next }` )
    set_setting( 'force_discharge', next )
    return next
}

const toggle_force_discharge = () => {
    return set_force_discharge_setting( !get_force_discharge_setting() )
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

const get_master_notifications = () => {
    return Boolean( get_setting( 'master_notifications', true ) )
}

const set_master_notifications = ( enabled ) => {
    log( `[Settings] Setting master notifications: ${ enabled }` )
    return set_setting( 'master_notifications', Boolean( enabled ) )
}

const get_notifications_setting = () => {
    if( !get_master_notifications() ) return false
    const notifications = get_setting( 'notifications', {} )
    return Object.values( notifications ).some( Boolean )
}

const toggle_notifications_setting = () => {
    const current = get_master_notifications()
    const new_state = !current
    set_master_notifications( new_state )
    const notifications = get_setting( 'notifications', {} )
    const updated = {}
    for( const key of Object.keys( notifications ) ) {
        updated[ key ] = new_state
    }
    set_setting( 'notifications', updated )
    log( `[Settings] Toggled all notifications to: ${ new_state }` )
    return new_state
}

const get_notification_sound = () => {
    return Boolean( get_setting( 'notification_sound', true ) )
}

const set_notification_sound = ( enabled ) => {
    log( `[Settings] Setting notification sound to: ${ enabled }` )
    return set_setting( 'notification_sound', Boolean( enabled ) )
}

const get_notification_alert_style = () => {
    return get_setting( 'notification_alert_style', 'banners' )
}

const set_notification_alert_style = ( style ) => {
    const valid = [ 'none', 'banners', 'alerts' ].includes( style ) ? style : 'banners'
    log( `[Settings] Setting notification alert style to: ${ valid }` )
    return set_setting( 'notification_alert_style', valid )
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

const set_icon_style_setting = ( style ) => {
    const new_val = style === 'text' ? 'text' : 'icon'
    set_setting( 'display_style', new_val )
    log( `[Settings] Setting icon style to: ${ new_val }` )
    return new_val
}

const toggle_icon_style_setting = () => {
    const current = get_icon_style_setting()
    const new_val = current === 'text' ? 'icon' : 'text'
    return set_icon_style_setting( new_val )
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

const get_startup_setting = () => {
    return Boolean( get_setting( 'launch_at_login', true ) )
}

const set_startup_setting = ( enabled ) => {
    log( `[Settings] Setting launch_at_login: ${ enabled }` )
    return set_setting( 'launch_at_login', Boolean( enabled ) )
}

const get_power_source_preference = () => {
    return get_setting( 'power_source_mode', 'adapter' )
}

const set_power_source_preference = ( mode ) => {
    const valid = mode === 'battery' ? 'battery' : 'adapter'
    log( `[Settings] Setting power source preference: ${ valid }` )
    return set_setting( 'power_source_mode', valid )
}

const toggle_startup_setting = () => {
    const current = get_startup_setting()
    return set_startup_setting( !current )
}

module.exports = {
    get_force_discharge_setting,
    set_force_discharge_setting,
    toggle_force_discharge,
    update_force_discharge_setting,
    get_master_notifications,
    set_master_notifications,
    get_notification_sound,
    set_notification_sound,
    get_notification_alert_style,
    set_notification_alert_style,
    get_notifications_setting,
    toggle_notifications_setting,
    get_notification_category,
    set_notification_category,
    get_icon_style_setting,
    toggle_icon_style_setting,
    set_icon_style_setting,
    get_startup_setting,
    set_startup_setting,
    toggle_startup_setting,
    get_power_source_preference,
    set_power_source_preference,
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