const fs = require( 'node:fs' )
const path = require( 'node:path' )
const os = require( 'node:os' )
const { log } = require( './helpers' )
const { exec_file_async } = require( './process-runner' )
const { get_startup_setting, set_startup_setting } = require( './settings' )

let electron_app = null
try {
    const electron = require( 'electron' )
    electron_app = electron.app || null
} catch {
    electron_app = null
}

// Maintenance daemon plist. Login startup must not load or unload this agent.
const LAUNCH_AGENT_PATH = path.join( os.homedir(), 'Library', 'LaunchAgents', 'battery.plist' )

/**
 * Locate the primary application bundle or executable path
 * @returns {string}
 */
const find_app_path = () => {
    const candidates = [
        '/Applications/battery.app',
        '/Applications/Battery King.app'
    ]
    for( const candidate of candidates ) {
        if( fs.existsSync( candidate ) ) return candidate
    }
    if( electron_app && typeof electron_app.getPath === 'function' ) {
        try {
            const exe = electron_app.getPath( 'exe' )
            const app_match = exe.match( /(^.*?\.app)/ )
            if( app_match && fs.existsSync( app_match[ 1 ] ) ) return app_match[ 1 ]
            return exe
        } catch ( e ) {
            log( '[Startup] Error reading electron app path: ', e?.message )
        }
    }
    return '/Applications/battery.app'
}

/**
 * Check whether startup is currently enabled
 * @returns {Promise<boolean>}
 */
const is_startup_enabled = async () => {
    try {
        if( electron_app && typeof electron_app.getLoginItemSettings === 'function' ) {
            const settings = electron_app.getLoginItemSettings()
            if( typeof settings?.openAtLogin === 'boolean' ) {
                return settings.openAtLogin
            }
        }

        // Query macOS system events login items
        const script = 'tell application "System Events" to get count of (every login item whose path contains "battery" or name is "battery" or name is "Battery King")'
        const { stdout } = await exec_file_async( '/usr/bin/osascript', [ '-e', script ] )
        const count = parseInt( stdout.trim(), 10 )
        if( !isNaN( count ) ) {
            return count > 0
        }
    } catch ( e ) {
        log( '[Startup] Error checking system startup: ', e?.message )
    }

    return get_startup_setting()
}

/**
 * Enable or disable startup
 * @param {boolean} enabled
 * @returns {Promise<boolean>}
 */
const set_startup_enabled = async ( enabled ) => {
    const should_enable = Boolean( enabled )
    log( `[Startup] Setting startup enabled: ${ should_enable }` )
    set_startup_setting( should_enable )

    const app_path = find_app_path()

    // 1. Electron setLoginItemSettings
    if( electron_app && typeof electron_app.setLoginItemSettings === 'function' ) {
        try {
            electron_app.setLoginItemSettings( {
                openAtLogin: should_enable,
                openAsHidden: true,
                path: app_path
            } )
        } catch ( e ) {
            log( '[Startup] Electron setLoginItemSettings error: ', e?.message )
        }
    }

    // 2. Sync via macOS System Events
    try {
        if( should_enable ) {
            const check_script = 'tell application "System Events" to get count of (every login item whose path contains "battery" or name is "battery" or name is "Battery King")'
            const { stdout } = await exec_file_async( '/usr/bin/osascript', [ '-e', check_script ] )
            const count = parseInt( stdout.trim(), 10 )
            if( isNaN( count ) || count === 0 ) {
                const add_script = `tell application "System Events" to make login item at end with properties {path:"${ app_path }", hidden:false, name:"battery"}`
                await exec_file_async( '/usr/bin/osascript', [ '-e', add_script ] )
            }
        } else {
            const delete_script = 'tell application "System Events" to delete (every login item whose path contains "battery" or name is "battery" or name is "Battery King")'
            await exec_file_async( '/usr/bin/osascript', [ '-e', delete_script ] )
        }
    } catch ( e ) {
        log( '[Startup] AppleScript login item sync error: ', e?.message )
    }

    return should_enable
}

/**
 * Toggle startup state
 * @returns {Promise<boolean>}
 */
const toggle_startup = async () => {
    const current = await is_startup_enabled()
    return set_startup_enabled( !current )
}

/**
 * Ensure startup state matches persisted setting (runs at app launch)
 */
const ensure_startup = async () => {
    const target = get_startup_setting()
    if( target ) {
        await set_startup_enabled( true )
    }
}

module.exports = {
    is_startup_enabled,
    set_startup_enabled,
    toggle_startup,
    ensure_startup,
    find_app_path,
    LAUNCH_AGENT_PATH
}
