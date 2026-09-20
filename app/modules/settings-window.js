const { BrowserWindow, ipcMain } = require( 'electron' )
const path = require( 'node:path' )
const {
    get_all_settings,
    set_protection_mode,
    set_charge_limit,
    toggle_force_discharge,
    set_notification_category
} = require( './settings' )
const { get_battery_status, get_battery_health, enable_battery_limiter, disable_battery_limiter } = require( './battery' )
const { run_diagnostics } = require( './diagnostics' )
const { export_diagnostic_bundle } = require( './logs' )
const { repair_installation } = require( './repair' )
const { get_recent_activity, clear_activity } = require( './activity-history' )
const { start_charge_to_full, start_pause_protection } = require( './temporary-charge' )
const { start_calibration } = require( './calibration' )
const { schedule_travel_mode, cancel_travel_mode } = require( './scheduler' )
const { get_health_history, get_health_trends } = require( './health-history' )
const { get_statistics, reset_statistics } = require( './statistics' )
const { generate_recommendations } = require( './recommendations' )
const { log } = require( './helpers' )

let settings_window = null

const open_settings_window = () => {
    if( settings_window && !settings_window.isDestroyed() ) {
        settings_window.show()
        settings_window.focus()
        return settings_window
    }

    settings_window = new BrowserWindow( {
        width: 720,
        height: 520,
        resizable: false,
        title: 'Battery Settings',
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    } )

    const view_path = path.join( __dirname, '..', 'views', 'settings.html' )
    settings_window.loadFile( view_path )

    settings_window.on( 'closed', () => {
        settings_window = null
    } )

    return settings_window
}

// Register IPC handlers once
let ipc_initialized = false
const init_settings_ipc = ( on_change_callback ) => {
    if( ipc_initialized ) return
    ipc_initialized = true

    ipcMain.handle( 'settings:get_state', async () => {
        const settings = get_all_settings()
        const status = await get_battery_status().catch( () => null )
        const health = await get_battery_health().catch( () => null )
        const diagnostics = await run_diagnostics().catch( () => [] )
        const activity = get_recent_activity( 30 )
        const stats = get_statistics()
        const health_trends = get_health_trends()
        const health_history = get_health_history( 30 )
        const recommendations = generate_recommendations( { stats, settings, health, status } )

        return { settings, status, health, diagnostics, activity, stats, health_trends, health_history, recommendations }
    } )

    ipcMain.handle( 'settings:set_protection', async ( _, mode ) => {
        log( `[SettingsWindow] IPC set_protection: ${ mode }` )
        set_protection_mode( mode )
        if( mode === 'enabled' ) {
            await enable_battery_limiter()
        } else {
            await disable_battery_limiter()
        }
        if( on_change_callback ) on_change_callback()
        return mode
    } )

    ipcMain.handle( 'settings:set_limit', async ( _, limit ) => {
        log( `[SettingsWindow] IPC set_limit: ${ limit }` )
        set_charge_limit( limit )
        await enable_battery_limiter( limit )
        if( on_change_callback ) on_change_callback()
        return limit
    } )

    ipcMain.handle( 'settings:toggle_discharge', async () => {
        const val = toggle_force_discharge()
        await enable_battery_limiter()
        if( on_change_callback ) on_change_callback()
        return val
    } )

    ipcMain.handle( 'settings:set_notif_cat', ( _, cat, enabled ) => {
        return set_notification_category( cat, enabled )
    } )

    ipcMain.handle( 'settings:charge_full', async () => {
        const res = await start_charge_to_full()
        if( on_change_callback ) on_change_callback()
        return res
    } )

    ipcMain.handle( 'settings:pause', async ( _, duration ) => {
        const res = await start_pause_protection( duration )
        if( on_change_callback ) on_change_callback()
        return res
    } )

    ipcMain.handle( 'settings:calibrate', async () => {
        return start_calibration()
    } )

    ipcMain.handle( 'settings:run_diag', async () => {
        return run_diagnostics()
    } )

    ipcMain.handle( 'settings:repair', async () => {
        const res = await repair_installation()
        if( on_change_callback ) on_change_callback()
        return res
    } )

    ipcMain.handle( 'settings:export_logs', async () => {
        return export_diagnostic_bundle( settings_window )
    } )

    ipcMain.handle( 'settings:clear_activity', () => {
        clear_activity()
        return true
    } )

    ipcMain.handle( 'settings:schedule_travel', async ( _, target_time_ms, target_percentage ) => {
        const plan = await schedule_travel_mode( { target_time_ms, target_percentage } )
        if( on_change_callback ) on_change_callback()
        return plan
    } )

    ipcMain.handle( 'settings:cancel_travel', async () => {
        const res = await cancel_travel_mode()
        if( on_change_callback ) on_change_callback()
        return res
    } )

    ipcMain.handle( 'settings:reset_stats', () => {
        reset_statistics()
        return true
    } )
}

module.exports = {
    open_settings_window,
    init_settings_ipc
}
