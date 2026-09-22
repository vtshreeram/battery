const { app, BrowserWindow, ipcMain } = require( 'electron' )
const path = require( 'node:path' )
const {
    get_all_settings,
    get_force_discharge_setting,
    set_master_notifications,
    set_icon_style_setting
} = require( './settings' )
const { apply_charge_limit, apply_force_discharge } = require( './protection-preferences' )
const {
    require_boolean,
    require_protection_mode,
    require_charge_limit,
    require_future_timestamp,
    require_display_style,
    require_pause_duration
} = require( './ipc-validators' )
const {
    get_battery_status,
    get_battery_health,
    enable_battery_limiter,
    disable_battery_limiter,
    switch_to_battery,
    switch_to_power,
    is_ac_attached,
    uninstall_battery
} = require( './battery' )
const { run_diagnostics } = require( './diagnostics' )
const { export_diagnostic_bundle } = require( './logs' )
const { repair_installation } = require( './repair' )
const { start_charge_to_full, start_pause_protection } = require( './temporary-charge' )
const { start_calibration } = require( './calibration' )
const { schedule_travel_mode, cancel_travel_mode } = require( './scheduler' )
const { is_startup_enabled, set_startup_enabled, toggle_startup } = require( './startup' )
const { log } = require( './helpers' )

let settings_window = null

const open_settings_window = () => {
    if( settings_window && !settings_window.isDestroyed() ) {
        settings_window.show()
        settings_window.focus()
        return settings_window
    }

    settings_window = new BrowserWindow( {
        width: 560,
        height: 680,
        minWidth: 480,
        minHeight: 520,
        resizable: true,
        title: 'Battery King Settings',
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join( __dirname, '..', 'preload', 'settings-preload.js' )
        }
    } )

    const view_path = path.join( __dirname, '..', 'views', 'settings.html' )
    settings_window.webContents.setWindowOpenHandler( () => ( { action: 'deny' } ) )
    settings_window.webContents.on( 'will-navigate', ( event, url ) => {
        if( !String( url ).startsWith( 'file:' ) ) event.preventDefault()
    } )
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
        const ac_attached = await is_ac_attached().catch( () => true )
        const startup = await is_startup_enabled().catch( () => true )
        return { settings, status, health, ac_attached, startup }
    } )

    ipcMain.handle( 'settings:switch_to_power', async () => {
        log( '[SettingsWindow] IPC switch_to_power' )
        await switch_to_power()
        if( on_change_callback ) on_change_callback()
        const new_status = await get_battery_status().catch( () => null )
        const ac_attached = await is_ac_attached().catch( () => true )
        return { status: new_status, ac_attached }
    } )

    ipcMain.handle( 'settings:switch_to_battery', async () => {
        log( '[SettingsWindow] IPC switch_to_battery' )
        await switch_to_battery()
        if( on_change_callback ) on_change_callback()
        const new_status = await get_battery_status().catch( () => null )
        const ac_attached = await is_ac_attached().catch( () => true )
        return { status: new_status, ac_attached }
    } )

    ipcMain.handle( 'settings:toggle_power_source', async () => {
        const status = await get_battery_status().catch( () => null )
        if( status?.discharging ) {
            await switch_to_power()
        } else {
            await switch_to_battery()
        }
        if( on_change_callback ) on_change_callback()
        const new_status = await get_battery_status().catch( () => null )
        const ac_attached = await is_ac_attached().catch( () => true )
        return { status: new_status, ac_attached }
    } )

    ipcMain.handle( 'settings:set_protection', async ( _, mode ) => {
        const valid = require_protection_mode( mode )
        log( `[SettingsWindow] IPC set_protection: ${ valid }` )
        if( valid === 'enabled' ) {
            const applied = await enable_battery_limiter()
            if( applied === null ) {
                throw new Error( 'Could not enable battery protection' )
            }
        } else {
            const stopped = await disable_battery_limiter()
            if( stopped === null ) {
                throw new Error( 'Could not disable battery protection' )
            }
        }
        if( on_change_callback ) on_change_callback()
        return valid
    } )

    ipcMain.handle( 'settings:set_limit', async ( _, limit ) => {
        const valid = require_charge_limit( limit )
        log( `[SettingsWindow] IPC set_limit: ${ valid }` )
        const result = await apply_charge_limit( valid )
        if( !result.ok ) {
            throw new Error( 'Could not apply the charge limit' )
        }
        if( on_change_callback ) on_change_callback()
        return result
    } )

    ipcMain.handle( 'settings:toggle_discharge', async () => {
        const next = !get_force_discharge_setting()
        const result = await apply_force_discharge( next )
        if( on_change_callback ) on_change_callback()
        return result.enabled
    } )

    ipcMain.handle( 'settings:set_master_notif', ( _, enabled ) => {
        return set_master_notifications( require_boolean( enabled, 'Notifications' ) )
    } )

    ipcMain.handle( 'settings:set_icon_style', ( _, style ) => {
        const val = set_icon_style_setting( require_display_style( style ) )
        if( on_change_callback ) on_change_callback()
        return val
    } )

    ipcMain.handle( 'settings:set_startup', async ( _, enabled ) => {
        const valid = require_boolean( enabled, 'Launch at startup' )
        log( `[SettingsWindow] IPC set_startup: ${ valid }` )
        const val = await set_startup_enabled( valid )
        if( on_change_callback ) on_change_callback()
        return val
    } )

    ipcMain.handle( 'settings:toggle_startup', async () => {
        log( '[SettingsWindow] IPC toggle_startup' )
        const val = await toggle_startup()
        if( on_change_callback ) on_change_callback()
        return val
    } )

    ipcMain.handle( 'settings:charge_full', async () => {
        const res = await start_charge_to_full()
        if( on_change_callback ) on_change_callback()
        return res
    } )

    ipcMain.handle( 'settings:pause', async ( _, duration ) => {
        const res = await start_pause_protection( require_pause_duration( duration ) )
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

    ipcMain.handle( 'settings:schedule_travel', async ( _, target_time_ms, target_percentage ) => {
        const plan = await schedule_travel_mode( {
            target_time_ms: require_future_timestamp( target_time_ms ),
            target_percentage: require_charge_limit( target_percentage ?? 100 )
        } )
        if( on_change_callback ) on_change_callback()
        return plan
    } )

    ipcMain.handle( 'settings:cancel_travel', async () => {
        const res = await cancel_travel_mode()
        if( on_change_callback ) on_change_callback()
        return res
    } )

    ipcMain.handle( 'settings:uninstall', async () => {
        const uninstalled = await uninstall_battery()
        if( uninstalled ) app.quit()
        return uninstalled
    } )
}

module.exports = {
    open_settings_window,
    init_settings_ipc
}
