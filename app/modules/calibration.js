const fs = require( 'node:fs' )
const path = require( 'node:path' )
const os = require( 'node:os' )
const { spawn } = require( 'node:child_process' )
const { log, alert, confirm } = require( './helpers' )
const { get_charge_limit, get_protection_mode } = require( './settings' )
const { record_event } = require( './activity-history' )
const { send_notification } = require( './notifications' )
const { BATTERY_BINARY } = require( './diagnostics' )

const CALIBRATE_PID_FILE = path.join( os.homedir(), '.battery', 'calibrate.pid' )

let active_process = null

const is_calibration_running = () => {
    try {
        if( fs.existsSync( CALIBRATE_PID_FILE ) ) {
            const pidStr = fs.readFileSync( CALIBRATE_PID_FILE, 'utf8' ).trim()
            const pid = parseInt( pidStr, 10 )
            if( !isNaN( pid ) ) {
                // Check if process is alive
                try {
                    process.kill( pid, 0 )
                    return true
                } catch ( e ) {
                    // Stale pidfile
                    fs.unlinkSync( CALIBRATE_PID_FILE )
                    return false
                }
            }
        }
    } catch ( err ) {
        log( `[Calibration] Error checking calibration pid: `, err?.message )
    }
    return false
}

const start_calibration = async () => {
    try {
        if( is_calibration_running() ) {
            await alert( 'Battery calibration is already running.' )
            return false
        }

        const proceed = await confirm(
            `Battery calibration will cycle the battery to recalibrate macOS capacity estimation:\n\n` +
            `1. Discharge to 15%\n` +
            `2. Charge to 100%\n` +
            `3. Hold at 100% for 1 hour\n` +
            `4. Restore your battery limit\n\n` +
            `Ensure your MacBook is connected to power and avoid unplugging it during the process.\n\n` +
            `Start calibration?`
        )
        if( !proceed ) return false

        const target = get_charge_limit()
        const mode = get_protection_mode()

        record_event( {
            type: 'calibration_start',
            title: 'Calibration Started',
            detail: `Started full calibration cycle. Will restore ${ target }% (${ mode }).`
        } )

        send_notification( {
            category: 'calibration',
            title: '⚙️ Calibration Started',
            body: 'Discharging to 15% before charging to 100%.'
        } )

        // Launch CLI calibration process
        active_process = spawn( BATTERY_BINARY, [ 'calibrate' ], {
            detached: true,
            stdio: 'ignore'
        } )
        active_process.unref()

        log( `[Calibration] Spawned calibration process PID: ${ active_process.pid }` )
        return true
    } catch ( err ) {
        log( `[Calibration] Error starting calibration: `, err )
        await alert( `Could not start calibration:\n${ err.message }` )
        return false
    }
}

function process_is_alive( pid ) {
    try {
        process.kill( pid, 0 )
        return true
    } catch ( err ) {
        return false
    }
}

function sleep( ms ) {
    return new Promise( resolve => setTimeout( resolve, ms ) )
}

/**
 * Ask the calibration leader to exit. Its shell trap restores charging and the
 * protection state captured when calibration started, then removes the pid file.
 * A second GUI restore would race that trap and could turn protection back on.
 */
const cancel_calibration = async () => {
    try {
        if( !is_calibration_running() ) return false

        log( `[Calibration] Cancelling calibration...` )
        let pid = null
        try {
            if( fs.existsSync( CALIBRATE_PID_FILE ) ) {
                pid = parseInt( fs.readFileSync( CALIBRATE_PID_FILE, 'utf8' ).trim(), 10 )
            }
        } catch ( err ) {
            log( `[Calibration] Could not read calibration pid: `, err?.message )
        }

        if( Number.isInteger( pid ) && pid > 0 ) {
            try {
                process.kill( pid, 'SIGTERM' )
            } catch ( err ) {
                log( `[Calibration] SIGTERM failed: `, err?.message )
            }
            const deadline = Date.now() + 2000
            while( process_is_alive( pid ) && Date.now() < deadline ) {
                await sleep( 50 )
            }
            if( process_is_alive( pid ) ) {
                try {
                    process.kill( -pid, 'SIGKILL' )
                } catch ( err ) {
                    try {
                        process.kill( pid, 'SIGKILL' )
                    } catch ( inner ) {
                        log( `[Calibration] SIGKILL failed: `, inner?.message )
                    }
                }
            }
        }

        if( fs.existsSync( CALIBRATE_PID_FILE ) && ( !pid || !process_is_alive( pid ) ) ) {
            fs.unlinkSync( CALIBRATE_PID_FILE )
        }

        record_event( {
            type: 'calibration_cancel',
            title: 'Calibration Cancelled',
            detail: 'User cancelled calibration. The calibration process restores the protection state it captured at start.'
        } )

        await alert( 'Calibration cancelled. Charging was returned to the state from before calibration.' )
        return true
    } catch ( err ) {
        log( `[Calibration] Error cancelling calibration: `, err )
        return false
    }
}

module.exports = {
    is_calibration_running,
    start_calibration,
    cancel_calibration
}
