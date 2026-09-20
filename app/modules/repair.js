const { exec_sudo_async } = require( './process-runner' )
const { URL_SETUP_SH } = require( './config' )
const { run_diagnostics, BATTERY_BINARY } = require( './diagnostics' )
const { record_event } = require( './activity-history' )
const { log } = require( './helpers' )

const { USER } = process.env

/**
 * Perform safe repair of installation components using official fork setup mechanism
 * @returns {Promise<{success: boolean, message: string, diagnostics: Array}>}
 */
const repair_installation = async () => {
    log( `[Repair] Starting installation repair...` )
    record_event( {
        type: 'repair_start',
        title: 'Repair Started',
        detail: 'Attempting to repair root binaries, visudo rules, and launch agent.'
    } )

    try {
        // Run setup.sh with administrator privileges to restore root binaries and visudo
        const repair_cmd = `curl -s ${ URL_SETUP_SH } | bash -s -- ${ USER || '$USER' }`
        await exec_sudo_async( repair_cmd )

        // Re-run visudo configuration explicitly to guarantee rules are intact
        try {
            await exec_sudo_async( `${ BATTERY_BINARY } visudo` )
        } catch ( e ) {
            log( `[Repair] Note on secondary visudo run: `, e?.message )
        }

        // Re-verify with full diagnostics
        const fresh_diagnostics = await run_diagnostics()
        const has_failures = fresh_diagnostics.some( d => d.status === 'failure' )

        if( !has_failures ) {
            record_event( {
                type: 'repair_success',
                title: 'Repair Succeeded',
                detail: 'All diagnostic checks passed after repair.'
            } )
            return {
                success: true,
                message: 'All battery components and permissions were repaired successfully.',
                diagnostics: fresh_diagnostics
            }
        } else {
            const failed_names = fresh_diagnostics.filter( d => d.status === 'failure' ).map( d => d.name ).join( ', ' )
            record_event( {
                type: 'repair_partial',
                title: 'Repair Completed With Warnings',
                detail: `Checks still failing: ${ failed_names }`,
                level: 'warning'
            } )
            return {
                success: false,
                message: `Repair ran but some checks are still failing: ${ failed_names }`,
                diagnostics: fresh_diagnostics
            }
        }
    } catch ( err ) {
        log( `[Repair] Repair failed with error: `, err )
        record_event( {
            type: 'repair_failure',
            title: 'Repair Failed',
            detail: err.message,
            level: 'error'
        } )
        return {
            success: false,
            message: `Repair failed: ${ err.message }`,
            diagnostics: await run_diagnostics()
        }
    }
}

module.exports = {
    repair_installation
}
