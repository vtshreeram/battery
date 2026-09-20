/* eslint-disable no-use-before-define */
const { app, Tray, Menu, powerMonitor, nativeTheme, dialog } = require( 'electron' )
const {
    enable_battery_limiter,
    disable_battery_limiter,
    initialize_battery,
    is_limiter_enabled,
    get_battery_status,
    get_battery_health,
    is_ac_attached,
    switch_to_battery,
    switch_to_power
} = require( './battery' )
const { log } = require( './helpers' )
const { get_status_icon, round_battery_level } = require( './theme' )
const {
    get_icon_style_setting,
    get_charge_limit,
    set_charge_limit,
    get_protection_mode,
    set_protection_mode,
    get_temporary_workflow,
    get_travel_mode
} = require( './settings' )
const { resolve_battery_state, pick_status_for_display } = require( './state-machine' )
const { evaluate_power_notifications } = require( './notifications' )
const {
    start_charge_to_full,
    start_pause_protection,
    cancel_temporary_workflow,
    evaluate_temporary_workflow
} = require( './temporary-charge' )
const {
    is_calibration_running,
    cancel_calibration
} = require( './calibration' )
const { open_settings_window, init_settings_ipc } = require( './settings-window' )
const { evaluate_scheduler, cancel_travel_mode } = require( './scheduler' )
const { record_health_snapshot } = require( './health-history' )
const { update_statistics_tick } = require( './statistics' )
const { run_diagnostics } = require( './diagnostics' )
const { open_logs_folder, export_diagnostic_bundle } = require( './logs' )

let tray = undefined
let refresh_timer = undefined
let last_good_status = null
let last_icon_state = null
let last_title = null
let last_tooltip = null
let last_refresh_interval_ms = null
let refresh_in_flight = false
let refresh_queued = false

const apply_tray_visuals = ( iconState, title, tooltip, percent = null ) => {
    const visual_key = iconState === 'charging' || iconState === 'protected'
        ? iconState
        : `battery-${ round_battery_level( percent ) }`
    if( visual_key !== last_icon_state ) {
        tray.setImage( get_status_icon( iconState, percent ) )
        last_icon_state = visual_key
    }
    if( tooltip !== last_tooltip ) {
        tray.setToolTip( tooltip )
        last_tooltip = tooltip
    }
    if( title !== last_title ) {
        tray.setTitle( title )
        last_title = title
    }
}

const LIMIT_PRESETS = [ 70, 80, 90, 100 ]

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

async function toggle_limiter() {
    try {
        const limiter_on = await is_limiter_enabled()
        if( limiter_on ) {
            await disable_limiter()
        } else {
            await enable_limiter()
        }
    } catch ( e ) {
        log( `[Interface] Error in toggle_limiter: `, e )
    }
}

async function handle_show_diagnostics() {
    try {
        const results = await run_diagnostics()
        const summary = results.map( r => `[${ r.status.toUpperCase() }] ${ r.name }:\n  ${ r.details }` ).join( '\n\n' )
        await dialog.showMessageBox( {
            type: 'info',
            title: 'Battery King Diagnostics',
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
        const fresh_status = await get_battery_status()
        const { status, stale } = pick_status_for_display( fresh_status, last_good_status )
        if( status?.available ) last_good_status = status

        const icon_style = get_icon_style_setting()
        const ac_attached = await is_ac_attached()
        const on_battery = ac_attached === false || powerMonitor.onBatteryPower

        // Evaluate active temporary workflows (charge to full / pause) and scheduler
        await evaluate_temporary_workflow( status, on_battery )
        await evaluate_scheduler( status )
        const temporary_workflow = get_temporary_workflow()
        const calibrating = is_calibration_running()

        // Handle unavailable hardware status (only when we have no last-good reading)
        if( !status || !status.available ) {
            log( `[Interface] Battery status unavailable, rendering error menu` )
            apply_tray_visuals(
                'battery',
                icon_style === 'text' ? ' --%' : '',
                'Battery King: Status unavailable',
                0
            )

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
            ac_attached,
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

        if( stale ) {
            log( `[Interface] Using last-good status after a failed poll: ${ status.percentage }% (${ semantic.state })` )
        } else {
            log( `[Interface] Update tray: ${ status.percentage }% (state: ${ semantic.state }, label: ${ semantic.label })` )
        }
        apply_tray_visuals(
            semantic.iconState,
            icon_style === 'text' ? ` ${ status.percentage }%` : '',
            `Battery King: ${ status.percentage }% • ${ semantic.label }`,
            status.percentage
        )

        // Build limit selection submenu
        const limit_submenu = LIMIT_PRESETS.map( pct => ( {
            label: pct === 80 ? '80% (Recommended)' : `${ pct }%`,
            type: 'radio',
            checked: current_limit === pct && !temporary_workflow,
            click: () => handle_set_limit( pct )
        } ) )

        let battery_subtext = ''
        if( on_battery && status.remaining && /^\d{1,2}:\d{2}$/.test( status.remaining.trim() ) && status.remaining.trim() !== '0:00' ) {
            battery_subtext = ` (${ status.remaining.trim() } remaining)`
        } else if( !on_battery && status.percentage === 100 ) {
            battery_subtext = ' (Fully Charged)'
        }

        const travel_plan = get_travel_mode()
        const is_travel_active = Boolean( travel_plan && travel_plan.active && travel_plan.target_time_ms > Date.now() )

        const exception_items = []
        if( is_travel_active ) {
            exception_items.push( {
                label: `Scheduled: 100% by ${ new Date( travel_plan.target_time_ms ).toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } ) }`,
                enabled: false
            } )
            exception_items.push( {
                label: 'Cancel scheduled full charge',
                click: async () => {
                    await cancel_travel_mode()
                    await refresh_tray()
                }
            } )
        } else if( temporary_workflow ) {
            exception_items.push( {
                label: temporary_workflow.type === 'full_charge' ? 'Charging to 100%…' : 'Charge limit paused',
                enabled: false
            } )
            exception_items.push( {
                label: 'Cancel',
                click: async () => {
                    await cancel_temporary_workflow()
                    await refresh_tray()
                }
            } )
        } else {
            exception_items.push( {
                label: 'Charge to 100% once',
                click: async () => {
                    await start_charge_to_full()
                    await refresh_tray()
                }
            } )
            exception_items.push( {
                label: 'Pause until tomorrow',
                click: async () => {
                    await start_pause_protection( 'tomorrow' )
                    await refresh_tray()
                }
            } )
        }
        if( calibrating ) {
            exception_items.push( {
                label: 'Cancel calibration',
                click: async () => {
                    await cancel_calibration()
                    await refresh_tray()
                }
            } )
        }

        return Menu.buildFromTemplate( [
            {
                label: `Battery: ${ status.percentage }%${ battery_subtext }`,
                enabled: false
            },
            {
                label: `Status: ${ semantic.label }`,
                enabled: false
            },
            { type: 'separator' },
            {
                label: 'Power Source:',
                enabled: false
            },
            {
                label: 'Power Adapter',
                type: 'radio',
                checked: ac_attached && !status.discharging,
                enabled: ac_attached,
                click: async () => {
                    log( '[Interface] Selected Power Adapter' )
                    await switch_to_power()
                    await refresh_tray()
                }
            },
            {
                label: 'Battery Power',
                type: 'radio',
                checked: !ac_attached || status.discharging,
                click: async () => {
                    log( '[Interface] Selected Battery Power' )
                    await switch_to_battery()
                    await refresh_tray()
                }
            },
            { type: 'separator' },
            {
                label: 'Limit charging',
                type: 'checkbox',
                checked: limiter_on && !temporary_workflow,
                click: toggle_limiter
            },
            {
                label: `Charge Limit: ${ current_limit }%`,
                submenu: limit_submenu
            },
            { type: 'separator' },
            ...exception_items,
            { type: 'separator' },
            {
                label: 'Settings...',
                accelerator: 'CmdOrCtrl+,',
                click: open_settings_window
            },
            {
                label: 'Quit Battery King',
                accelerator: 'CmdOrCtrl+Q',
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
    if( !tray ) return
    if( refresh_in_flight ) {
        refresh_queued = true
        return
    }
    refresh_in_flight = true
    try {
        const new_menu = await generate_app_menu()
        if( force_interactive_refresh && new_menu ) {
            tray.closeContextMenu()
            tray.popUpContextMenu( new_menu )
        }
        if( new_menu ) {
            tray.setContextMenu( new_menu )
        }
        set_interface_update_timer()
    } finally {
        refresh_in_flight = false
        if( refresh_queued ) {
            refresh_queued = false
            refresh_tray()
        }
    }
}

const compute_refresh_interval = ( status ) => {
    const slow_interval = 1000 * 60 * 1
    const fast_interval = 1000 * 30
    if( !status || !status.available ) return slow_interval

    const maintain_percentage = status.maintain_percentage || 80
    const percentage = status.percentage || 80
    const percentage_delta = Math.floor( Math.abs( percentage - maintain_percentage ) )
    const full_and_charging = status.charging && percentage === 100
    return percentage_delta < 5 || powerMonitor.onBatteryPower || full_and_charging ? slow_interval : fast_interval
}

// Periodic refreshing of icon and state
const set_interface_update_timer = ( disable_only = false ) => {
    if( disable_only ) {
        if( refresh_timer ) clearInterval( refresh_timer )
        refresh_timer = undefined
        last_refresh_interval_ms = null
        return
    }

    const refresh_speed = compute_refresh_interval( last_good_status )
    if( refresh_timer && last_refresh_interval_ms === refresh_speed ) return

    if( refresh_timer ) clearInterval( refresh_timer )
    last_refresh_interval_ms = refresh_speed
    refresh_timer = setInterval( () => refresh_tray(), refresh_speed )
}

/* ///////////////////////////////
// Initialisation
// /////////////////////////////*/
async function set_initial_interface() {
    log( '\n===\n=== Starting tray app\n===\n' )
    const is_on_battery = powerMonitor.onBatteryPower
    last_icon_state = is_on_battery ? 'battery' : 'charging'
    tray = new Tray( get_status_icon( last_icon_state, 100 ) )
    log( '[Interface] Tray icon created' )

    // Initialize IPC bridge with Settings Window
    init_settings_ipc( () => refresh_tray() )

    // Initialize battery background components and restore persisted user choice
    await initialize_battery()
    log( `[Interface] Battery initialization completed. Restored mode: ${ get_protection_mode() }` )

    await refresh_tray()

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