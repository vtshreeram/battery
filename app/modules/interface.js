/* eslint-disable no-use-before-define */
const { shell, app, Tray, Menu, powerMonitor, nativeTheme, dialog } = require( 'electron' )
const {
    enable_battery_limiter,
    disable_battery_limiter,
    initialize_battery,
    is_limiter_enabled,
    get_battery_status,
    uninstall_battery,
    get_battery_health
} = require( './battery' )
const { log } = require( './helpers' )
const { get_status_icon } = require( './theme' )
const {
    get_force_discharge_setting,
    update_force_discharge_setting,
    get_notifications_setting,
    toggle_notifications_setting,
    get_icon_style_setting,
    toggle_icon_style_setting,
    get_charge_limit,
    set_charge_limit,
    get_protection_mode,
    set_protection_mode,
    get_temporary_workflow
} = require( './settings' )
const { resolve_battery_state } = require( './state-machine' )
const { evaluate_power_notifications } = require( './notifications' )
const {
    start_charge_to_full,
    start_pause_protection,
    cancel_temporary_workflow,
    evaluate_temporary_workflow
} = require( './temporary-charge' )
const {
    is_calibration_running,
    start_calibration,
    cancel_calibration
} = require( './calibration' )
const { open_settings_window, init_settings_ipc } = require( './settings-window' )
const { evaluate_scheduler } = require( './scheduler' )
const { record_health_snapshot } = require( './health-history' )
const { update_statistics_tick } = require( './statistics' )
const { run_diagnostics } = require( './diagnostics' )
const { open_logs_folder, export_diagnostic_bundle } = require( './logs' )
const {
    URL_RELEASES,
    URL_README,
    URL_CLI_DOCS,
    URL_ISSUES
} = require( './config' )

let tray = undefined
let refresh_timer = undefined

const LIMIT_PRESETS = [ 70, 75, 80, 85, 90, 100 ]

// User actions
async function handle_set_limit( limit ) {
    try {
        log( `[Interface] Changing limit to ${ limit }%` )
        set_charge_limit( limit )
        if( get_protection_mode() === 'enabled' ) {
            await enable_battery_limiter( limit )
        }
        await refresh_tray()
    } catch ( e ) {
        log( `[Interface] Error setting limit: `, e )
    }
}

async function handle_custom_limit_dialog() {
    try {
        const current = get_charge_limit()
        const { response } = await dialog.showMessageBox( {
            type: 'question',
            buttons: [ 'Set Limit', 'Cancel' ],
            title: 'Custom Charge Limit',
            message: `Current charge limit is ${ current }%.`,
            detail: 'Enter a custom percentage between 50% and 100% in Settings, or pick a preset from the menu.'
        } )
        if( response === 0 ) {
            open_settings_window()
        }
    } catch ( e ) {
        log( `[Interface] Error in custom limit dialog: `, e )
    }
}

async function enable_limiter() {
    try {
        log( '[Interface] Enable limiter clicked' )
        set_protection_mode( 'enabled' )
        const target = get_charge_limit()
        await enable_battery_limiter( target )
        await refresh_tray()
    } catch ( e ) {
        log( `[Interface] Error in enable_limiter: `, e )
    }
}

async function disable_limiter() {
    try {
        log( '[Interface] Disable limiter clicked' )
        set_protection_mode( 'disabled' )
        await disable_battery_limiter()
        await refresh_tray()
    } catch ( e ) {
        log( `[Interface] Error in disable_limiter: `, e )
    }
}

async function restart_limiter() {
    try {
        log( '[Interface] Restart limiter clicked' )
        await disable_battery_limiter()
        const target = get_charge_limit()
        await enable_battery_limiter( target )
        await refresh_tray()
    } catch ( e ) {
        log( `[Interface] Error in restart_limiter: `, e )
    }
}

async function handle_show_diagnostics() {
    try {
        const results = await run_diagnostics()
        const summary = results.map( r => `[${ r.status.toUpperCase() }] ${ r.name }:\n  ${ r.details }` ).join( '\n\n' )
        await dialog.showMessageBox( {
            type: 'info',
            title: 'Battery System Diagnostics',
            message: 'Diagnostic Results:',
            detail: summary,
            buttons: [ 'OK', 'Export Bundle' ]
        } ).then( async ( { response } ) => {
            if( response === 1 ) {
                await export_diagnostic_bundle()
            }
        } )
    } catch ( e ) {
        log( `[Interface] Error showing diagnostics: `, e )
    }
}

// Build tray context menu
const generate_app_menu = async () => {
    try {
        const status = await get_battery_status()
        const icon_style = get_icon_style_setting()
        const on_battery = powerMonitor.onBatteryPower || ( status?.discharging ?? false )

        // Evaluate active temporary workflows (charge to full / pause) and scheduler
        await evaluate_temporary_workflow( status, on_battery )
        await evaluate_scheduler( status )
        const temporary_workflow = get_temporary_workflow()
        const calibrating = is_calibration_running()

        // Handle unavailable hardware status
        if( !status || !status.available ) {
            log( `[Interface] Battery status unavailable, rendering error menu` )
            tray.setImage( get_status_icon( 'battery' ) )
            tray.setToolTip( 'Battery status unavailable' )
            if( icon_style === 'text' ) {
                tray.setTitle( ' --%' )
            } else {
                tray.setTitle( '' )
            }

            return Menu.buildFromTemplate( [
                {
                    label: '⚠️ Battery status unavailable',
                    enabled: false
                },
                {
                    label: status?.errorMessage ? `Error: ${ status.errorMessage }` : 'Hardware unreachable',
                    enabled: false
                },
                { type: 'separator' },
                {
                    label: '🔄 Retry checking status',
                    click: async () => {
                        await refresh_tray( true )
                    }
                },
                {
                    label: '🩺 Run diagnostics...',
                    click: handle_show_diagnostics
                },
                {
                    label: '⚙️ Settings...',
                    click: open_settings_window
                },
                {
                    label: '📄 View logs folder',
                    click: open_logs_folder
                },
                {
                    label: '📦 Export diagnostic bundle...',
                    click: async () => {
                        await export_diagnostic_bundle()
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    click: () => {
                        tray.destroy()
                        app.quit()
                    }
                }
            ] )
        }

        const limiter_on = await is_limiter_enabled()
        const protection_mode = get_protection_mode()
        const current_limit = get_charge_limit()
        const allow_discharge = get_force_discharge_setting()
        const notifications_on = get_notifications_setting()
        const health = await get_battery_health()

        // Extract raw temperature if available
        let temp_c = null
        if( health?.temperature && health.temperature.includes( '°C' ) ) {
            temp_c = parseFloat( health.temperature )
        }

        // Semantic State Resolution
        const semantic = resolve_battery_state( {
            status,
            limiter_enabled: limiter_on,
            protection_mode,
            on_battery,
            temporary_workflow,
            calibration_active: calibrating,
            temperature_c: temp_c
        } )

        // Check and send notifications through the granular notification dispatcher
        evaluate_power_notifications( {
            on_battery,
            percentage: status.percentage,
            target: current_limit
        } )

        // Track local health snapshot and protection statistics
        record_health_snapshot( health )
        update_statistics_tick( semantic.state )

        log( `[Interface] Update tray: ${ status.percentage }% (state: ${ semantic.state }, label: ${ semantic.label })` )
        tray.setImage( get_status_icon( semantic.iconState ) )
        tray.setToolTip( `Battery: ${ status.percentage }% • ${ semantic.label }` )

        if( icon_style === 'text' ) {
            tray.setTitle( ` ${ status.percentage }%` )
        } else {
            tray.setTitle( '' )
        }

        // Build limit selection submenu
        const limit_submenu = LIMIT_PRESETS.map( pct => ( {
            label: pct === 80 ? '80% (Recommended)' : `${ pct }%`,
            type: 'radio',
            checked: current_limit === pct && !temporary_workflow,
            click: () => handle_set_limit( pct )
        } ) )
        limit_submenu.push( { type: 'separator' } )
        limit_submenu.push( {
            label: 'Custom percentage...',
            click: handle_custom_limit_dialog
        } )

        return Menu.buildFromTemplate( [
            // Status Header
            {
                label: `Status: ${ semantic.label }`,
                enabled: false
            },
            {
                label: `Battery: ${ status.percentage }% (${ status.remaining || 'unknown' } remaining)`,
                enabled: false
            },
            { type: 'separator' },

            // Primary Toggle
            {
                label: `Enable Battery Protection`,
                type: 'radio',
                checked: limiter_on && !temporary_workflow,
                click: enable_limiter
            },
            {
                label: `Disable Battery Protection`,
                type: 'radio',
                checked: !limiter_on && !temporary_workflow,
                click: disable_limiter
            },
            {
                label: `Charge Limit: ${ current_limit }%`,
                submenu: limit_submenu
            },
            { type: 'separator' },

            // Quick Workflows
            ... temporary_workflow ? [
                {
                    label: `Active: ${ temporary_workflow.type === 'full_charge' ? 'Charging to 100%' : 'Protection Paused' }`,
                    enabled: false
                },
                {
                    label: '✕ Cancel Temporary Mode',
                    click: async () => {
                        await cancel_temporary_workflow()
                        await refresh_tray()
                    }
                },
                { type: 'separator' }
            ] : [
                {
                    label: '⚡ Charge to 100% Once',
                    click: async () => {
                        await start_charge_to_full()
                        await refresh_tray()
                    }
                },
                {
                    label: '⏸ Pause Protection',
                    submenu: [
                        {
                            label: 'For 1 Hour',
                            click: async () => {
                                await start_pause_protection( '1h' )
                                await refresh_tray()
                            }
                        },
                        {
                            label: 'For 4 Hours',
                            click: async () => {
                                await start_pause_protection( '4h' )
                                await refresh_tray()
                            }
                        },
                        {
                            label: 'Until Tomorrow (8:00 AM)',
                            click: async () => {
                                await start_pause_protection( 'tomorrow' )
                                await refresh_tray()
                            }
                        },
                        {
                            label: 'Until Unplugged',
                            click: async () => {
                                await start_pause_protection( 'unplugged' )
                                await refresh_tray()
                            }
                        }
                    ]
                },
                {
                    label: calibrating ? '✕ Cancel Calibration' : '🔄 Calibrate Battery...',
                    click: async () => {
                        if( calibrating ) {
                            await cancel_calibration()
                        } else {
                            await start_calibration()
                        }
                        await refresh_tray()
                    }
                },
                { type: 'separator' }
            ] ,

            // Battery Health
            {
                label: 'Battery Health',
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

            // Settings & Tools
            {
                label: '⚙️ Settings...',
                click: open_settings_window
            },
            {
                label: 'Advanced',
                submenu: [
                    {
                        label: `Show percentage (${ status.percentage }%)`,
                        type: 'checkbox',
                        checked: icon_style === 'text',
                        click: async () => {
                            toggle_icon_style_setting()
                            await refresh_tray()
                        }
                    },
                    {
                        label: 'Desktop notifications',
                        type: 'checkbox',
                        checked: notifications_on,
                        click: async () => {
                            toggle_notifications_setting()
                            await refresh_tray()
                        }
                    },
                    {
                        label: 'Allow force-discharging',
                        type: 'checkbox',
                        checked: allow_discharge,
                        click: async () => {
                            const success = await update_force_discharge_setting()
                            if( limiter_on && success ) await restart_limiter()
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Run diagnostics...',
                        click: handle_show_diagnostics
                    },
                    {
                        label: 'Open logs folder',
                        click: open_logs_folder
                    },
                    {
                        label: 'Export diagnostic bundle...',
                        click: async () => {
                            await export_diagnostic_bundle()
                        }
                    }
                ]
            },
            {
                label: `About v${ app.getVersion() }`,
                submenu: [
                    {
                        label: 'Check for updates',
                        click: () => shell.openExternal( URL_RELEASES )
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
                    { type: 'separator' },
                    {
                        label: 'User manual',
                        click: () => shell.openExternal( URL_README )
                    },
                    {
                        type: 'normal',
                        label: 'Command-line usage',
                        click: () => shell.openExternal( URL_CLI_DOCS )
                    },
                    {
                        type: 'normal',
                        label: 'Help and feature requests',
                        click: () => shell.openExternal( URL_ISSUES )
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
        log( `[Interface] Error generating menu: `, e )
    }
}

// Refresh tray with battery status values
const refresh_tray = async ( force_interactive_refresh = false ) => {
    log( '[Interface] Refreshing tray icon...' )
    const new_menu = await generate_app_menu()
    if( force_interactive_refresh && new_menu ) {
        tray.closeContextMenu()
        tray.popUpContextMenu( new_menu )
    }
    if( new_menu ) {
        tray.setContextMenu( new_menu )
    }
    set_interface_update_timer()
}

// Periodic refreshing of icon and state
const set_interface_update_timer = async ( disable_only = false ) => {
    if( !disable_only ) log( `[Interface] Refreshing update timer` )
    else log( `[Interface] Disabling update timer` )

    if( refresh_timer ) clearInterval( refresh_timer )
    if( disable_only ) return

    const status = await get_battery_status()
    const maintain_percentage = status?.maintain_percentage || 80
    const percentage = status?.percentage || 80
    const percentage_delta = Math.floor( Math.abs( percentage - maintain_percentage ) )

    const slow_interval = 1000 * 60 * 1
    const fast_interval = 1000 * 30
    const full_and_charging = status?.charging && percentage === 100
    const refresh_speed = percentage_delta < 5 || powerMonitor.onBatteryPower || full_and_charging ? slow_interval : fast_interval

    refresh_timer = setInterval( refresh_tray, refresh_speed )
}

/* ///////////////////////////////
// Initialisation
// /////////////////////////////*/
async function set_initial_interface() {
    log( '\n===\n=== Starting tray app\n===\n' )
    const is_on_battery = powerMonitor.onBatteryPower
    tray = new Tray( get_status_icon( is_on_battery ? 'battery' : 'charging' ) )

    tray.setTitle( '  updating...' )
    log( '[Interface] Tray icon created' )

    // Initialize IPC bridge with Settings Window
    init_settings_ipc( () => refresh_tray() )

    // Initialize battery background components and restore persisted user choice
    await initialize_battery()
    log( `[Interface] Battery initialization completed. Restored mode: ${ get_protection_mode() }` )

    // Initial render
    tray.setTitle( '' )
    await refresh_tray()

    // Listeners
    tray.on( 'mouse-enter', () => refresh_tray() )
    tray.on( 'click', () => refresh_tray() )
    nativeTheme.on( 'updated', () => refresh_tray() )

    powerMonitor.on( 'on-ac', () => {
        log( '[Interface] Power source changed: AC plugged in' )
        refresh_tray()
    } )
    powerMonitor.on( 'on-battery', () => {
        log( '[Interface] Power source changed: running on battery' )
        refresh_tray()
    } )

    set_interface_update_timer()
    powerMonitor.on( 'lock-screen', () => set_interface_update_timer( true ) )
    powerMonitor.on( 'unlock-screen', async () => {
        log( '[Interface] Screen unlocked: refreshing tray' )
        set_interface_update_timer()
        await refresh_tray()
    } )
    powerMonitor.on( 'suspend', () => set_interface_update_timer( true ) )
    powerMonitor.on( 'resume', async () => {
        log( '[Interface] System resumed from sleep: refreshing tray' )
        set_interface_update_timer()
        await refresh_tray()
    } )
}

module.exports = {
    set_initial_interface,
    refresh_tray
}