const Store = require( 'electron-store' )
const fs = require( 'node:fs' )
const path = require( 'node:path' )
const os = require( 'node:os' )
const { log } = require( './helpers' )

const CONFIG_DIR = path.join( os.homedir(), '.battery' )
const NOTIFY_FILE = path.join( CONFIG_DIR, 'notify.setting' )
const ICON_STYLE_FILE = path.join( CONFIG_DIR, 'icon_style.setting' )
const MAINTAIN_FILE = path.join( CONFIG_DIR, 'maintain.percentage' )
const PID_FILE = path.join( CONFIG_DIR, 'battery.pid' )

const DEFAULT_SETTINGS = {
    schema_version: 1,
    protection_mode: 'enabled', // 'enabled' | 'disabled'
    charge_limit: 80,
    force_discharge: false,
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
    travel_mode: null // { active: false, departure_time: null, restore_limit: 80 }
}

const store = new Store( {
    name: 'battery-settings-v1',
    defaults: DEFAULT_SETTINGS
} )

let migrated = false

/**
 * Perform safe, idempotent migration from legacy storage locations
 */
const migrate_legacy_settings = () => {
    if( migrated ) return
    migrated = true

    try {
        const current_version = store.get( 'schema_version', 0 )
        if( current_version >= 1 ) {
            log( `[Settings] Settings already at schema version ${ current_version }` )
            return
        }

        log( `[Settings] Migrating legacy settings...` )

        // 1. Migrate legacy electron-store (force_discharge_if_needed)
        try {
            const legacyStore = new Store( { name: 'config' } )
            const legacyDischarge = legacyStore.get( 'force_discharge_if_needed' )
            if( typeof legacyDischarge === 'boolean' ) {
                store.set( 'force_discharge', legacyDischarge )
                log( `[Settings] Migrated force_discharge: ${ legacyDischarge }` )
            }
        } catch ( err ) {
            log( `[Settings] No legacy electron-store found: `, err?.message )
        }

        // 2. Migrate legacy ~/.battery/notify.setting
        try {
            if( fs.existsSync( NOTIFY_FILE ) ) {
                const val = fs.readFileSync( NOTIFY_FILE, 'utf8' ).trim()
                const notifications_enabled = val !== 'off'
                const notifications = { ...DEFAULT_SETTINGS.notifications }
                for( const key of Object.keys( notifications ) ) {
                    notifications[ key ] = notifications_enabled
                }
                store.set( 'notifications', notifications )
                log( `[Settings] Migrated notifications: ${ notifications_enabled }` )
            }
        } catch ( err ) {
            log( `[Settings] Error reading legacy notify.setting: `, err?.message )
        }

        // 3. Migrate legacy ~/.battery/icon_style.setting
        try {
            if( fs.existsSync( ICON_STYLE_FILE ) ) {
                const val = fs.readFileSync( ICON_STYLE_FILE, 'utf8' ).trim()
                if( val === 'icon' || val === 'text' ) {
                    store.set( 'display_style', val )
                    log( `[Settings] Migrated display_style: ${ val }` )
                }
            }
        } catch ( err ) {
            log( `[Settings] Error reading legacy icon_style.setting: `, err?.message )
        }

        // 4. Migrate legacy ~/.battery/maintain.percentage
        try {
            if( fs.existsSync( MAINTAIN_FILE ) ) {
                const val = parseInt( fs.readFileSync( MAINTAIN_FILE, 'utf8' ).trim(), 10 )
                if( !isNaN( val ) && val >= 50 && val <= 100 ) {
                    store.set( 'charge_limit', val )
                    log( `[Settings] Migrated charge_limit: ${ val }` )
                }
            }
        } catch ( err ) {
            log( `[Settings] Error reading legacy maintain.percentage: `, err?.message )
        }

        // 5. Inspect existing daemon / pid status to determine initial protection_mode
        try {
            const hasPid = fs.existsSync( PID_FILE )
            if( !hasPid ) {
                // If there's no maintain pidfile, check if user had previously disabled or was not running
                store.set( 'protection_mode', 'disabled' )
                log( `[Settings] No active maintain.pid found; initialized protection_mode as 'disabled'` )
            } else {
                store.set( 'protection_mode', 'enabled' )
                log( `[Settings] Active maintain.pid found; initialized protection_mode as 'enabled'` )
            }
        } catch ( err ) {
            log( `[Settings] Error checking daemon status for migration: `, err?.message )
        }

        store.set( 'schema_version', 1 )
        log( `[Settings] Migration completed successfully to schema v1` )
    } catch ( e ) {
        log( `[Settings] Migration error: `, e )
    }
}

/**
 * Synchronize settings with legacy files required by CLI binary
 */
const sync_legacy_files = () => {
    try {
        if( !fs.existsSync( CONFIG_DIR ) ) {
            fs.mkdirSync( CONFIG_DIR, { recursive: true } )
        }

        // Sync notify.setting
        const notifications = store.get( 'notifications', DEFAULT_SETTINGS.notifications )
        const any_enabled = Object.values( notifications ).some( Boolean )
        fs.writeFileSync( NOTIFY_FILE, any_enabled ? 'on' : 'off', 'utf8' )

        // Sync icon_style.setting
        const display_style = store.get( 'display_style', 'text' )
        fs.writeFileSync( ICON_STYLE_FILE, display_style, 'utf8' )

        // Sync maintain.percentage
        const charge_limit = store.get( 'charge_limit', 80 )
        fs.writeFileSync( MAINTAIN_FILE, String( charge_limit ), 'utf8' )
    } catch ( e ) {
        log( `[Settings] Error syncing legacy files: `, e )
    }
}

// Public API
const get_setting = ( key, fallback ) => {
    migrate_legacy_settings()
    const val = store.get( key )
    return val !== undefined ? val :  fallback !== undefined ? fallback : DEFAULT_SETTINGS[ key ] 
}

const set_setting = ( key, value ) => {
    migrate_legacy_settings()
    store.set( key, value )
    sync_legacy_files()
    return value
}

const get_all_settings = () => {
    migrate_legacy_settings()
    return store.store
}

const reset_settings_to_defaults = () => {
    store.clear()
    store.set( DEFAULT_SETTINGS )
    sync_legacy_files()
}

module.exports = {
    DEFAULT_SETTINGS,
    migrate_legacy_settings,
    sync_legacy_files,
    get_setting,
    set_setting,
    get_all_settings,
    reset_settings_to_defaults
}
