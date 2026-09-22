const Store = require( 'electron-store' )
const fs = require( 'node:fs' )
const path = require( 'node:path' )
const os = require( 'node:os' )
const { log } = require( './helpers' )

const DEFAULT_SETTINGS = {
    protection_mode: 'enabled', // 'enabled' | 'disabled' — last mode successfully requested by the user
    charge_limit: 80, // desired percentage; the CLI maintain file is a separate runtime config
    force_discharge: false,
    display_style: 'text',
    launch_at_login: true,
    master_notifications: true,
    notification_sound: true, // play sound for notifications
    notification_alert_style: 'banners', // 'none' | 'banners' | 'alerts'
    notifications: {
        protection_activated: true,
        target_reached: true,
        low_battery: true,
        critical_battery: true,
        charging_started: true,
        full_charge_once_completed: true,
        pause_ending: true,
        calibration: true,
        protection_error: true,
        health_warning: true,
        temperature_warning: true,
        update: true
    },
    temporary_workflow: null, // { type: 'full_charge' | 'pause', restore_mode, restore_limit, expires_at }
    schedule: null, // { enabled: false, target_time: null, target_percentage: 100, restore_limit: 80 }
    travel_mode: null // { active: false, departure_time: null, restore_limit: 80, restore_mode }
}

// GUI preference files the CLI reads. maintain.percentage is CLI runtime state and is not rewritten here.
const PREFERENCE_FILE_KEYS = new Set( [
    'notifications',
    'master_notifications',
    'display_style'
] )

function electron_user_data() {
    try {
        const electron = require( 'electron' )
        if( electron && electron.app && typeof electron.app.getPath === 'function' ) {
            return electron.app.getPath( 'userData' )
        }
    } catch ( err ) {
        log( '[Settings] Electron userData unavailable: ', err?.message )
    }
    return null
}

const electron_data_dir = electron_user_data()
const isolated_root = path.join( os.tmpdir(), 'battery-king-node-settings' )

let config_dir = electron_data_dir ? path.join( os.homedir(), '.battery' ) : path.join( isolated_root, 'config' )
let store_cwd = electron_data_dir || path.join( isolated_root, 'store' )
let store = null
let migrated = false

function notify_file() {
    return path.join( config_dir, 'notify.setting' )
}

function icon_style_file() {
    return path.join( config_dir, 'icon_style.setting' )
}

function maintain_file() {
    return path.join( config_dir, 'maintain.percentage' )
}

function voltage_file() {
    return path.join( config_dir, 'maintain.voltage' )
}

function pid_file() {
    return path.join( config_dir, 'battery.pid' )
}

function settings_file() {
    return path.join( store_cwd, 'battery-settings-v1.json' )
}

function read_json( file ) {
    try {
        return JSON.parse( fs.readFileSync( file, 'utf8' ) )
    } catch ( err ) {
        return null
    }
}

function recorded_schema_version() {
    const parsed = read_json( settings_file() )
    const version = parsed && parsed.schema_version
    return typeof version === 'number' ? version : 0
}

function open_store() {
    const already_migrated = fs.existsSync( settings_file() ) && recorded_schema_version() >= 1
    store = new Store( {
        name: 'battery-settings-v1',
        cwd: store_cwd,
        defaults: DEFAULT_SETTINGS
    } )
    migrated = already_migrated
}

open_store()

function pid_is_alive( file ) {
    try {
        if( !fs.existsSync( file ) ) return false
        const pid = parseInt( fs.readFileSync( file, 'utf8' ).trim(), 10 )
        if( !Number.isInteger( pid ) || pid <= 0 ) return false
        process.kill( pid, 0 )
        return true
    } catch ( err ) {
        return false
    }
}

/**
 * Copy legacy CLI/GUI files into the Electron store once.
 * schema_version is written only after this finishes, so a default value cannot skip migration.
 */
const migrate_legacy_settings = () => {
    if( migrated ) return
    if( recorded_schema_version() >= 1 ) {
        migrated = true
        return
    }

    try {
        log( '[Settings] Migrating legacy settings...' )
        let had_legacy = false

        try {
            const legacy_path = path.join( store_cwd, 'config.json' )
            if( fs.existsSync( legacy_path ) ) {
                const legacyStore = new Store( { name: 'config', cwd: store_cwd } )
                const legacyDischarge = legacyStore.get( 'force_discharge_if_needed' )
                if( typeof legacyDischarge === 'boolean' ) {
                    had_legacy = true
                    store.set( 'force_discharge', legacyDischarge )
                    log( `[Settings] Migrated force_discharge: ${ legacyDischarge }` )
                }
            }
        } catch ( err ) {
            log( '[Settings] No legacy electron-store found: ', err?.message )
        }

        try {
            if( fs.existsSync( notify_file() ) ) {
                had_legacy = true
                const val = fs.readFileSync( notify_file(), 'utf8' ).trim()
                const notifications_enabled = val !== 'off'
                const notifications = { ...DEFAULT_SETTINGS.notifications }
                for( const key of Object.keys( notifications ) ) {
                    notifications[ key ] = notifications_enabled
                }
                store.set( 'notifications', notifications )
                store.set( 'master_notifications', notifications_enabled )
                log( `[Settings] Migrated notifications: ${ notifications_enabled }` )
            }
        } catch ( err ) {
            log( '[Settings] Error reading legacy notify.setting: ', err?.message )
        }

        try {
            if( fs.existsSync( icon_style_file() ) ) {
                had_legacy = true
                const val = fs.readFileSync( icon_style_file(), 'utf8' ).trim()
                if( val === 'icon' || val === 'text' ) {
                    store.set( 'display_style', val )
                    log( `[Settings] Migrated display_style: ${ val }` )
                }
            }
        } catch ( err ) {
            log( '[Settings] Error reading legacy icon_style.setting: ', err?.message )
        }

        try {
            if( fs.existsSync( maintain_file() ) ) {
                had_legacy = true
                const raw = fs.readFileSync( maintain_file(), 'utf8' ).trim()
                const range = raw.match( /^(\d+)-(\d+)$/ )
                if( range ) {
                    const upper = parseInt( range[ 2 ], 10 )
                    if( upper >= 50 && upper <= 100 ) {
                        store.set( 'charge_limit', upper )
                    }
                    store.set( 'legacy_maintain_spec', raw )
                    log( `[Settings] Migrated maintain range ${ raw }` )
                } else {
                    const val = parseInt( raw, 10 )
                    if( !isNaN( val ) && String( val ) === raw && val >= 50 && val <= 100 ) {
                        store.set( 'charge_limit', val )
                        log( `[Settings] Migrated charge_limit: ${ val }` )
                    }
                }
            }
        } catch ( err ) {
            log( '[Settings] Error reading legacy maintain.percentage: ', err?.message )
        }

        try {
            if( fs.existsSync( voltage_file() ) ) {
                had_legacy = true
                const raw = fs.readFileSync( voltage_file(), 'utf8' ).trim()
                if( raw ) {
                    store.set( 'legacy_maintain_spec', raw )
                    store.set( 'maintain_mode_preference', 'voltage' )
                    log( `[Settings] Recorded legacy voltage maintenance: ${ raw }` )
                }
            }
        } catch ( err ) {
            log( '[Settings] Error reading legacy maintain.voltage: ', err?.message )
        }

        if( had_legacy ) {
            const running = pid_is_alive( pid_file() )
            store.set( 'protection_mode', running ? 'enabled' : 'disabled' )
            log( `[Settings] Migrated protection_mode as '${ running ? 'enabled' : 'disabled' }'` )
        }

        store.set( 'schema_version', 1 )
        migrated = true
        log( '[Settings] Migration completed successfully to schema v1' )
    } catch ( e ) {
        migrated = false
        log( '[Settings] Migration error: ', e )
        throw e
    }
}

/**
 * Write GUI preference files the CLI reads. Never touches maintain.percentage or maintain.voltage.
 */
const sync_preference_files = () => {
    try {
        if( !fs.existsSync( config_dir ) ) {
            fs.mkdirSync( config_dir, { recursive: true } )
        }

        const notifications = store.get( 'notifications', DEFAULT_SETTINGS.notifications )
        const master = store.get( 'master_notifications', true )
        const any_enabled = Boolean( master ) && Object.values( notifications ).some( Boolean )
        fs.writeFileSync( notify_file(), any_enabled ? 'on' : 'off', 'utf8' )

        const display_style = store.get( 'display_style', 'text' )
        fs.writeFileSync( icon_style_file(), display_style, 'utf8' )
    } catch ( e ) {
        log( '[Settings] Error syncing preference files: ', e )
    }
}

const sync_legacy_files = () => {
    sync_preference_files()
}

const get_setting = ( key, fallback ) => {
    migrate_legacy_settings()
    const val = store.get( key )
    return val !== undefined ? val : fallback !== undefined ? fallback : DEFAULT_SETTINGS[ key ]
}

const set_setting = ( key, value ) => {
    migrate_legacy_settings()
    store.set( key, value )
    if( PREFERENCE_FILE_KEYS.has( key ) ) {
        sync_preference_files()
    }
    return value
}

const get_all_settings = () => {
    migrate_legacy_settings()
    return store.store
}

const reset_settings_to_defaults = () => {
    store.clear()
    store.set( DEFAULT_SETTINGS )
    store.set( 'schema_version', 1 )
    migrated = true
    sync_preference_files()
}

/**
 * Point the store at a temporary directory. Used by migration tests.
 */
const configure_settings_location = ( { configDir, storeCwd } = {} ) => {
    if( configDir ) config_dir = configDir
    if( storeCwd ) store_cwd = storeCwd
    migrated = false
    open_store()
}

module.exports = {
    DEFAULT_SETTINGS,
    migrate_legacy_settings,
    sync_legacy_files,
    sync_preference_files,
    get_setting,
    set_setting,
    get_all_settings,
    reset_settings_to_defaults,
    configure_settings_location,
    settings_paths: () => ( {
        config_dir,
        store_cwd,
        maintain_file: maintain_file(),
        voltage_file: voltage_file(),
        notify_file: notify_file(),
        icon_style_file: icon_style_file(),
        pid_file: pid_file()
    } )
}
