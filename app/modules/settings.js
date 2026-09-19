const Store = require( 'electron-store' )
const { log, confirm } = require( './helpers' )
const store = new Store( {
    force_discharge_if_needed: {
        type: 'boolean'
    }
} )

const get_force_discharge_setting = () => {
    // Check if force discharge is on
    const force_discharge_if_needed = store.get( 'force_discharge_if_needed' )
    log( `Force discharge setting: ${ typeof force_discharge_if_needed } ${ force_discharge_if_needed }` )
    return force_discharge_if_needed === true
}

const toggle_force_discharge = () => {
    const status = get_force_discharge_setting()
    log( `Setting force discharge to ${ !status }` )
    store.set( 'force_discharge_if_needed', !status )
}

// Update the force discharge setting
const update_force_discharge_setting = async () => {

    try {

        const currently_allowed = get_force_discharge_setting()
        if( !currently_allowed ) {
            const proceed = await confirm( `This setting allows your battery to drain to the desired maintenance level while plugged in. This does not work well in Clamshell mode (laptop closed with an external monitor).\n\nAllow force-discharging?` )
            if( !proceed ) return false
        }

        // Toggle setting and refresh tray
        toggle_force_discharge()
        return true


    } catch ( e ) {
        log( `Error updating force discharge: `, e )
    }

}

const fs = require( 'fs' )
const path = require( 'path' )
const os = require( 'os' )

const notify_setting_path = path.join( os.homedir(), '.battery', 'notify.setting' )

const get_notifications_setting = () => {
    try {
        if( fs.existsSync( notify_setting_path ) ) {
            const val = fs.readFileSync( notify_setting_path, 'utf8' ).trim()
            return val !== 'off'
        }
    } catch( e ) {
        log( `Error reading notifications setting: `, e )
    }
    return true
}

const toggle_notifications_setting = () => {
    try {
        const currently_enabled = get_notifications_setting()
        const new_val = currently_enabled ? 'off' : 'on'
        const dir = path.dirname( notify_setting_path )
        if( !fs.existsSync( dir ) ) fs.mkdirSync( dir, { recursive: true } )
        fs.writeFileSync( notify_setting_path, new_val )
        log( `Setting notifications to: ${ new_val }` )
        return !currently_enabled
    } catch( e ) {
        log( `Error updating notifications setting: `, e )
        return get_notifications_setting()
    }
}

const icon_style_path = path.join( os.homedir(), '.battery', 'icon_style.setting' )

const get_icon_style_setting = () => {
    try {
        if( fs.existsSync( icon_style_path ) ) {
            const val = fs.readFileSync( icon_style_path, 'utf8' ).trim()
            if( val === 'icon' ) return 'icon'
        }
    } catch( e ) {
        log( `Error reading icon style setting: `, e )
    }
    return 'text'
}

const toggle_icon_style_setting = () => {
    try {
        const current = get_icon_style_setting()
        const new_val = current === 'text' ? 'icon' : 'text'
        const dir = path.dirname( icon_style_path )
        if( !fs.existsSync( dir ) ) fs.mkdirSync( dir, { recursive: true } )
        fs.writeFileSync( icon_style_path, new_val )
        log( `Setting icon style to: ${ new_val }` )
        return new_val
    } catch( e ) {
        log( `Error updating icon style setting: `, e )
        return get_icon_style_setting()
    }
}

module.exports = {
    get_force_discharge_setting,
    toggle_force_discharge,
    update_force_discharge_setting,
    get_notifications_setting,
    toggle_notifications_setting,
    get_icon_style_setting,
    toggle_icon_style_setting
}