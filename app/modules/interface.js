const { shell, app, Tray, Menu, powerMonitor, nativeTheme, nativeImage, Notification } = require( 'electron' )
const { enable_battery_limiter, disable_battery_limiter, initialize_battery, is_limiter_enabled, get_battery_status, uninstall_battery, get_battery_health } = require( './battery' )
const { log } = require( "./helpers" )
const { get_logo_template, get_status_icon } = require( './theme' )
const { get_force_discharge_setting, update_force_discharge_setting, get_notifications_setting, toggle_notifications_setting, get_icon_style_setting, toggle_icon_style_setting } = require( './settings' )

/* ///////////////////////////////
// Menu helpers
// /////////////////////////////*/
let tray = undefined

// Notification tracker for desktop alerts
const notification_tracker = {
    target_reached: false,
    low_20: false,
    crit_10: false
}

const check_and_send_notifications = ( is_on_battery, percentage, maintain_percentage, notifications_on ) => {
    if( !notifications_on || !Notification.isSupported() ) return

    const pct = Number( percentage )
    const target = Number( maintain_percentage || 80 )

    if( !is_on_battery ) {
        // Reset low battery flags when plugged into AC
        notification_tracker.low_20 = false
        notification_tracker.crit_10 = false

        if( pct >= target && !notification_tracker.target_reached ) {
            new Notification( {
                title: '🔋 Battery Protected',
                body: `Target ${ target }% reached. Switched to AC Adapter bypass (0 cycles).`
            } ).show()
            notification_tracker.target_reached = true
        }
    } else {
        // Running on battery: reset target reached flag
        notification_tracker.target_reached = false

        if( pct <= 10 && !notification_tracker.crit_10 ) {
            new Notification( {
                title: `🚨 Critical Battery (${ pct }%)`,
                body: 'Battery is below 10%! Plug in charger immediately.'
            } ).show()
            notification_tracker.crit_10 = true
            notification_tracker.low_20 = true
        } else if( pct <= 20 && !notification_tracker.low_20 ) {
            new Notification( {
                title: `🪫 Low Battery (${ pct }%)`,
                body: 'Connect charger to preserve battery longevity and avoid deep discharge.'
            } ).show()
            notification_tracker.low_20 = true
        }
    }
}

// Set interface to usable
const generate_app_menu = async () => {

    try {
        // Get battery and daemon status
        const { battery_state, daemon_state, maintain_percentage=80, percentage, discharging, charging } = await get_battery_status()

        // Check if limiter is on
        const limiter_on = await is_limiter_enabled()

        // Check force discharge setting
        const allow_discharge = get_force_discharge_setting()

        // Check notifications setting
        const notifications_on = get_notifications_setting()

        // Check icon display style setting
        const icon_style = get_icon_style_setting()

        // Get hardware health diagnostics
        const health = await get_battery_health()

        // Determine functional limiter state
        const is_on_battery = powerMonitor.onBatteryPower || discharging
        let current_state = 'battery'
        let tooltip_text = ''
        let friendly_status = ''

        if( is_on_battery ) {
            current_state = 'battery'
            friendly_status = discharging ? `Discharging to ${ maintain_percentage }%` : 'Running on Battery'
            tooltip_text = `Battery: ${ percentage }% • ${ friendly_status }`
        } else if( limiter_on && (!charging || Number( percentage ) >= Number( maintain_percentage )) ) {
            current_state = 'protected'
            friendly_status = `Protected at ${ maintain_percentage }% (Adapter Bypass)`
            tooltip_text = `Battery: ${ percentage }% • Protected at ${ maintain_percentage }%`
        } else if( charging || Number( percentage ) < Number( maintain_percentage ) ) {
            current_state = 'charging'
            friendly_status = `Charging to ${ maintain_percentage }%`
            tooltip_text = `Battery: ${ percentage }% • Charging to ${ maintain_percentage }%`
        } else {
            current_state = 'battery'
            friendly_status = daemon_state || 'Monitoring'
            tooltip_text = `Battery: ${ percentage }% • ${ friendly_status }`
        }

        // Trigger desktop notification if appropriate
        check_and_send_notifications( is_on_battery, percentage, maintain_percentage, notifications_on )

        // Set tray icon, title, and tooltip
        log( `Generate app menu: ${ percentage }% (state: ${ current_state }, status: ${ friendly_status })` )
        tray.setImage( get_status_icon( current_state ) )
        tray.setToolTip( tooltip_text )

        if( icon_style === 'text' ) {
            tray.setTitle( ` ${ percentage }%` )
        } else {
            tray.setTitle( '' )
        }

        // Build menu
        return Menu.buildFromTemplate( [

            {
                label: `Enable ${ maintain_percentage }% battery limit`,
                type: 'radio',
                checked: limiter_on,
                click: enable_limiter
            },
            {
                label: `Disable ${ maintain_percentage }% battery limit`,
                type: 'radio',
                checked: !limiter_on,
                click: disable_limiter
            },
            {
                type: 'separator'
            },
            {
                label: `Status: ${ friendly_status }`,
                enabled: false
            },
            {
                label: `Battery: ${ battery_state }`,
                enabled: false
            },
            {
                label: `Battery Health`,
                submenu: [
                    {
                        label: `Maximum Capacity: ${ health.capacity }`,
                        enabled: false
                    },
                    {
                        label: `Cycle Count: ${ health.cycles } cycles`,
                        enabled: false
                    },
                    {
                        label: `Hardware Condition: ${ health.condition }`,
                        enabled: false
                    },
                    {
                        label: `Temperature: ${ health.temperature }`,
                        enabled: false
                    }
                ]
            },
            {
                type: 'separator'
            },
            {
                label: `Advanced settings`,
                submenu: [
                    {
                        label: `Show percentage (${ percentage }%)`,
                        type: 'checkbox',
                        checked: icon_style === 'text',
                        click: async () => {
                            toggle_icon_style_setting()
                            await refresh_tray()
                        }
                    },
                    {
                        label: `Desktop notifications`,
                        type: 'checkbox',
                        checked: notifications_on,
                        click: async () => {
                            toggle_notifications_setting()
                            await refresh_tray()
                        }
                    },
                    {
                        label: `Allow force-discharging`,
                        type: 'checkbox',
                        checked: allow_discharge,
                        click: async () => {
                            const success = await update_force_discharge_setting()
                            if( limiter_on && success ) await restart_limiter()
                        }
                    }
                ]
            },
            {
                label: `About v${ app.getVersion() }`,
                submenu: [
                    {
                        label: `Check for updates`,
                        click: () => shell.openExternal( `https://github.com/actuallymentor/battery/releases` )
                    },
                    {
                        type: 'normal',
                        label: `Uninstall Battery ${ app.getVersion() }`,
                        click: async () => {
                            const uninstalled = await uninstall_battery()
                            if( !uninstalled ) return
                            tray.destroy()
                            app.quit()
                        }
                    },
                    {
                        type: 'separator'
                    },
                    {
                        label: `User manual`,
                        click: () => shell.openExternal( `https://github.com/actuallymentor/battery#readme` )
                    },
                    {
                        type: 'normal',
                        label: 'Command-line usage',
                        click: () => shell.openExternal( `https://github.com/actuallymentor/battery#-command-line-version` )
                    },
                    {
                        type: 'normal',
                        label: 'Help and feature requests',
                        click: () => shell.openExternal( `https://github.com/actuallymentor/battery/issues` )
                    }
                ]
            },
            {
                label: 'Quit',
                click: () => {
                    tray.destroy()
                    app.quit()
                }
            }
            
        ] )
    } catch ( e ) {
        log( `Error generating menu: `, e )
    }

}

// Periodic refreshing of icon and state
let refresh_timer = undefined
const set_interface_update_timer = async ( disable_only=false ) => {

    if( !disable_only ) log( `Refreshing interface update timer` )
    else log( `Disabling interface update timer due to disable_only set to `, disable_only )

    // Calculate update speed
    const { maintain_percentage=80, percentage, charging } = await get_battery_status()
    const percentage_delta = Math.floor( Math.abs( percentage - maintain_percentage ) )
    const slow_refresh_interval_in_ms = 1000 * 60 * 1 // 1 minute (was 10 minutes)
    const fast_refresh_interval_in_ms = 1000 * 30      // 30 seconds
    const battery_full_and_charging = charging && percentage == 100
    const refresh_speed =  percentage_delta < 5 || powerMonitor.onBatteryPower || battery_full_and_charging  ? slow_refresh_interval_in_ms : fast_refresh_interval_in_ms
    log( `Setting interface refresh speed to ${ refresh_speed / 1000 } seconds` )
    if( refresh_timer ) clearInterval( refresh_timer )
    // eslint-disable-next-line no-use-before-define
    if( !disable_only ) refresh_timer = setInterval( refresh_tray, refresh_speed )

}

// Refresh tray with battery status values
const refresh_tray = async ( force_interactive_refresh = false ) => {

    log( "Refreshing tray icon..." )
    const new_menu = await generate_app_menu()
    if( force_interactive_refresh ) {
        log( `Forcing interactive refresh ${ force_interactive_refresh }` )
        tray.closeContextMenu()
        tray.popUpContextMenu( new_menu )
    }
    tray.setContextMenu( new_menu )

    // Refresh timer 
    log( `Resetting interface timer speed` )
    set_interface_update_timer()

}

// Refresh app logo
const refresh_logo = async ( percent=80, force ) => {

    log( `Refresh logo for percentage ${ percent }, force ${ force }` )
    const icon_style = get_icon_style_setting()
    const limiter_on = await is_limiter_enabled()
    const is_on_battery = powerMonitor.onBatteryPower
    const state = is_on_battery ? 'battery' : (limiter_on ? 'protected' : 'charging')

    tray.setImage( get_status_icon( state ) )
    if( icon_style === 'text' ) {
        return tray.setTitle( ` ${ percent }%` )
    }
    return tray.setTitle( '' )
}


/* ///////////////////////////////
// Initialisation
// /////////////////////////////*/
async function set_initial_interface() {

    log('\n===\n=== Starting tray app\n===\n')
    const is_on_battery = powerMonitor.onBatteryPower
    tray = new Tray( get_status_icon( is_on_battery ? 'battery' : 'charging' ) )

    // Set "loading" context
    tray.setTitle( '  updating...' )
    
    log( "Tray app boot complete" )

    log( "Triggering boot-time auto-update" )
    await initialize_battery()
    log( "App initialisation process complete" )

    // Start battery handler
    await enable_battery_limiter()

    // Set tray styles
    tray.setTitle( '' )
    await refresh_tray()

    // Set tray open listener
    tray.on( 'mouse-enter', () => refresh_tray() )
    tray.on( 'click', () => refresh_tray() )
    nativeTheme.on( 'updated', () => refresh_tray() )

    // Power change listeners (instant update when plugged / unplugged)
    powerMonitor.on( 'on-ac', () => {
        log( 'Power source changed: AC plugged in' )
        refresh_tray()
    } )
    powerMonitor.on( 'on-battery', () => {
        log( 'Power source changed: running on battery' )
        refresh_tray()
    } )

    // Set refresh timer for the battery icon
    set_interface_update_timer()
    powerMonitor.on( 'lock-screen', () => set_interface_update_timer( true ) )
    powerMonitor.on( 'unlock-screen', async () => {
        log( 'Screen unlocked: refreshing tray' )
        set_interface_update_timer()
        await refresh_tray()
    } )
    powerMonitor.on( 'suspend', () => set_interface_update_timer( true ) )
    powerMonitor.on( 'resume', async () => {
        log( 'System resumed from sleep: refreshing tray' )
        set_interface_update_timer()
        await refresh_tray()
    } )

}

/* ///////////////////////////////
// User interactions
// /////////////////////////////*/
async function enable_limiter() {

    try {
        log( 'Enable limiter' )
        await refresh_logo( 80, 'active' )
        const percent_left = await enable_battery_limiter()
        log( `Interface enabled limiter, percentage remaining: ${ percent_left }` )
        await refresh_logo( percent_left, 'active' )
        await refresh_tray()
    } catch ( e ) {
        log( `Error in enable_limiter: `, e )
    }

}

async function disable_limiter() {

    try {
        log( 'Disable limiter' )
        await refresh_logo( 80, 'inactive' )
        const percent_left = await disable_battery_limiter()
        log( `Interface enabled limiter, percentage remaining: ${ percent_left }` )
        await refresh_logo( percent_left, 'inactive' )
        await refresh_tray()
    } catch ( e ) {
        log( `Error in disable_limiter: `, e )
    }

}

async function restart_limiter() {

    try {
        log( 'Restart limiter' )
        const percent_left = await disable_battery_limiter()
        await enable_battery_limiter()
        await refresh_logo( percent_left, 'active' )
        await refresh_tray()
    } catch ( e ) {
        log( `Error in restart_limiter: `, e )
    }

}


module.exports = {
    set_initial_interface
}