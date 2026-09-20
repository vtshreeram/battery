const fs = require( 'node:fs' )
const path = require( 'node:path' )
const os = require( 'node:os' )
const { shell, dialog, app } = require( 'electron' )
const { log } = require( './helpers' )
const { get_all_settings } = require( './settings' )
const { run_diagnostics, BATTERY_BINARY } = require( './diagnostics' )
const { exec_file_async } = require( './process-runner' )

const CONFIG_DIR = path.join( os.homedir(), '.battery' )
const GUI_LOG_FILE = path.join( CONFIG_DIR, 'gui.log' )
const CLI_LOG_FILE = path.join( CONFIG_DIR, 'battery.log' )

/**
 * Sanitize personal and sensitive data from text
 * @param {string} text
 * @returns {string}
 */
const sanitize_log_content = ( text = '' ) => {
    if( !text ) return ''
    const { username } = os.userInfo()
    const homedir = os.homedir()

    let sanitized = text
    if( homedir ) {
        sanitized = sanitized.split( homedir ).join( '~' )
    }
    if( username ) {
        sanitized = sanitized.split( username ).join( '<user>' )
    }
    // Remove IPv4 addresses
    sanitized = sanitized.replace( /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, '<ip-redacted>' )
    return sanitized
}

/**
 * Open the logs directory in Finder
 */
const open_logs_folder = () => {
    if( !fs.existsSync( CONFIG_DIR ) ) {
        fs.mkdirSync( CONFIG_DIR, { recursive: true } )
    }
    shell.openPath( CONFIG_DIR )
}

/**
 * Open the primary GUI log file in default editor
 */
const open_gui_log = () => {
    if( fs.existsSync( GUI_LOG_FILE ) ) {
        shell.openPath( GUI_LOG_FILE )
    } else {
        open_logs_folder()
    }
}

/**
 * Read the last N lines of a file safely
 * @param {string} filepath
 * @param {number} line_count
 * @returns {string}
 */
const read_tail_lines = ( filepath, line_count = 100 ) => {
    try {
        if( !fs.existsSync( filepath ) ) return '(No log file found)'
        const content = fs.readFileSync( filepath, 'utf8' )
        const lines = content.trim().split( '\n' )
        return lines.slice( -line_count ).join( '\n' )
    } catch ( err ) {
        return `(Error reading log: ${ err.message })`
    }
}

/**
 * Generate a comprehensive diagnostic and log bundle text
 * @returns {Promise<string>}
 */
const generate_diagnostic_bundle = async () => {
    let cli_version = 'Unknown'
    try {
        const res = await exec_file_async( BATTERY_BINARY, [ 'version' ], { timeout: 3000 } )
        cli_version = res.stdout.trim()
    } catch ( err ) {
        cli_version = `Unavailable (${ err.message })`
    }

    const diagnostics = await run_diagnostics()
    const settings = get_all_settings()

    // Non-sensitive settings summary
    const safe_settings = {
        schema_version: settings.schema_version,
        protection_mode: settings.protection_mode,
        charge_limit: settings.charge_limit,
        force_discharge: settings.force_discharge,
        display_style: settings.display_style,
        notifications_enabled: Object.values( settings.notifications || {} ).some( Boolean ),
        has_temporary_workflow: Boolean( settings.temporary_workflow ),
        has_schedule: Boolean( settings.schedule?.enabled )
    }

    const gui_tail = read_tail_lines( GUI_LOG_FILE, 100 )
    const cli_tail = read_tail_lines( CLI_LOG_FILE, 100 )

    const timestamp = new Date().toISOString()
    const os_info = `${ os.type() } ${ os.release() } (${ os.arch() })`

    const bundle = [
        `================================================================`,
        `                 BATTERY DIAGNOSTIC LOG BUNDLE                  `,
        `================================================================`,
        `Timestamp:            ${ timestamp }`,
        `App Version:          v${ app.getVersion ? app.getVersion() : '1.4.0' }`,
        `CLI Version:          ${ cli_version }`,
        `System:               ${ os_info }`,
        `Hardware Model:       ${ os.cpus()[ 0 ]?.model || 'Apple Silicon' }`,
        ``,
        `--- CONFIGURATION STATE ---`,
        JSON.stringify( safe_settings, null, 2 ),
        ``,
        `--- DIAGNOSTIC RESULTS ---`,
        ...diagnostics.map( d => `[${ d.status.toUpperCase() }] ${ d.name }: ${ d.details }` ),
        ``,
        `--- RECENT GUI LOGS (TAIL) ---`,
        sanitize_log_content( gui_tail ),
        ``,
        `--- RECENT CLI LOGS (TAIL) ---`,
        sanitize_log_content( cli_tail ),
        ``,
        `================================================================`,
        `                    END OF DIAGNOSTIC BUNDLE                    `,
        `================================================================`
    ].join( '\n' )

    return bundle
}

/**
 * Export the diagnostic bundle to a user-selected file
 */
const export_diagnostic_bundle = async ( parentWindow ) => {
    try {
        const bundleContent = await generate_diagnostic_bundle()
        const defaultName = `battery-diagnostics-${ new Date().toISOString().slice( 0, 10 ) }.txt`

        const result = await dialog.showSaveDialog( parentWindow, {
            title: 'Export Battery Diagnostic Log Bundle',
            defaultPath: path.join( os.homedir(), 'Desktop', defaultName ),
            filters: [ { name: 'Text Documents', extensions: [ 'txt' ] } ]
        } )

        if( !result.canceled && result.filePath ) {
            fs.writeFileSync( result.filePath, bundleContent, 'utf8' )
            await dialog.showMessageBox( parentWindow, {
                type: 'info',
                message: 'Diagnostic bundle exported successfully.',
                detail: `Saved to:\n${ result.filePath }`
            } )
            return result.filePath
        }
        return null
    } catch ( err ) {
        log( `[Logs] Error exporting diagnostic bundle: `, err )
        await dialog.showErrorBox( 'Export Failed', `Could not export diagnostic bundle: ${ err.message }` )
        return null
    }
}

module.exports = {
    CONFIG_DIR,
    GUI_LOG_FILE,
    CLI_LOG_FILE,
    sanitize_log_content,
    open_logs_folder,
    open_gui_log,
    read_tail_lines,
    generate_diagnostic_bundle,
    export_diagnostic_bundle
}
