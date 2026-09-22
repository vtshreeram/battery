const {
    get_protection_mode,
    get_charge_limit,
    get_temporary_workflow,
    set_temporary_workflow
} = require( './settings' )
const { enable_battery_limiter, disable_battery_limiter } = require( './battery' )
const { restore_protection_state } = require( './protection-preferences' )
const { status_is_actionable } = require( './state-machine' )
const { send_notification } = require( './notifications' )
const { record_event } = require( './activity-history' )
const { log } = require( './helpers' )

/**
 * Start Charge to 100% Once workflow
 */
const start_charge_to_full = async () => {
    try {
        const previous_mode = get_protection_mode()
        const previous_limit = get_charge_limit()

        log( `[TemporaryCharge] Starting Charge to 100% Once (prior mode: ${ previous_mode }, prior limit: ${ previous_limit }%)` )

        const workflow = {
            type: 'full_charge',
            restore_mode: previous_mode,
            restore_limit: previous_limit,
            started_at: Date.now()
        }

        record_event( {
            type: 'workflow_start',
            title: 'Charge to 100% Once Started',
            detail: `Will charge to 100% and then restore ${ previous_limit }% limit (${ previous_mode }).`
        } )

        const applied = await enable_battery_limiter( 100 )
        if( applied === null ) {
            log( '[TemporaryCharge] Charge to 100% did not apply; leaving the previous protection state' )
            return false
        }
        set_temporary_workflow( workflow )
        return true
    } catch ( err ) {
        log( `[TemporaryCharge] Error starting charge to 100%: `, err )
        return false
    }
}

/**
 * Start Temporary Pause workflow
 * @param {'1h'|'4h'|'tomorrow'|'unplugged'} duration
 */
const start_pause_protection = async ( duration ) => {
    try {
        const previous_mode = get_protection_mode()
        const previous_limit = get_charge_limit()

        let expires_at = null
        const now = Date.now()

        if( duration === '1h' ) {
            expires_at = now + 60 * 60 * 1000
        } else if( duration === '4h' ) {
            expires_at = now + 4 * 60 * 60 * 1000
        } else if( duration === 'tomorrow' ) {
            const tomorrow = new Date()
            tomorrow.setDate( tomorrow.getDate() + 1 )
            tomorrow.setHours( 8, 0, 0, 0 )
            expires_at = tomorrow.getTime()
        }

        const workflow = {
            type: 'pause',
            pause_type: duration,
            restore_mode: previous_mode,
            restore_limit: previous_limit,
            expires_at,
            started_at: now
        }

        record_event( {
            type: 'workflow_start',
            title: `Charge limit paused (${ duration })`,
            detail: `Charge limit paused. Will restore ${ previous_limit }% limit (${ previous_mode }).`
        } )

        const stopped = await disable_battery_limiter()
        if( stopped === null ) {
            log( '[TemporaryCharge] Pause did not stop maintenance; leaving the previous protection state' )
            return false
        }
        set_temporary_workflow( workflow )
        return true
    } catch ( err ) {
        log( `[TemporaryCharge] Error pausing protection: `, err )
        return false
    }
}

/**
 * Cancel any active temporary workflow and safely restore previous settings
 */
const cancel_temporary_workflow = async () => {
    try {
        const workflow = get_temporary_workflow()
        if( !workflow ) return false

        log( `[TemporaryCharge] Cancelling workflow: ${ workflow.type }` )

        const { restore_mode, restore_limit } = workflow
        const restored = await restore_protection_state( restore_mode, restore_limit )
        if( !restored ) return false
        set_temporary_workflow( null )
        record_event( {
            type: 'workflow_cancel',
            title: 'Temporary Workflow Cancelled',
            detail: `Restoring ${ restore_limit }% limit (${ restore_mode }).`
        } )

        return true
    } catch ( err ) {
        log( `[TemporaryCharge] Error cancelling workflow: `, err )
        return false
    }
}

/**
 * Evaluate active temporary workflow against current status and time
 * Restores previous settings when conditions are met.
 * @param {object} status
 * @param {boolean} on_battery
 */
const evaluate_temporary_workflow = async ( status, on_battery ) => {
    try {
        const workflow = get_temporary_workflow()
        if( !workflow ) return

        if( !status_is_actionable( status ) ) {
            log( '[TemporaryCharge] Deferring workflow decision until a fresh battery reading is available' )
            return
        }

        const now = Date.now()

        // 1. Check Full Charge completion
        if( workflow.type === 'full_charge' ) {
            if( status && status.percentage >= 100 ) {
                log( `[TemporaryCharge] Full charge reached (100%). Restoring prior configuration.` )
                const restored = await restore_protection_state( workflow.restore_mode, workflow.restore_limit )
                if( !restored ) return
                set_temporary_workflow( null )

                send_notification( {
                    category: 'full_charge_once_completed',
                    title: '🔋 Full Charge Complete',
                    body: `Battery reached 100%. Restored ${ workflow.restore_limit }% charge limit.`
                } )

                record_event( {
                    type: 'workflow_complete',
                    title: 'Charge to 100% Completed',
                    detail: `Restored ${ workflow.restore_limit }% limit (${ workflow.restore_mode }).`
                } )
            }
        }

        // 2. Check Pause expiration
        if( workflow.type === 'pause' ) {
            const expired = workflow.expires_at && now >= workflow.expires_at
            const unplugged = workflow.pause_type === 'unplugged' && on_battery

            if( expired || unplugged ) {
                log( `[TemporaryCharge] Pause ended (expired: ${ expired }, unplugged: ${ unplugged }). Restoring.` )
                const restored = await restore_protection_state( workflow.restore_mode, workflow.restore_limit )
                if( !restored ) return
                set_temporary_workflow( null )

                send_notification( {
                    category: 'pause_ending',
                    title: '⏳ Charge limit pause ended',
                    body: `Resuming ${ workflow.restore_limit }% charge limit.`
                } )

                record_event( {
                    type: 'workflow_complete',
                    title: 'Charge limit pause ended',
                    detail: `Restored ${ workflow.restore_limit }% limit (${ workflow.restore_mode }).`
                } )
            }
        }
    } catch ( err ) {
        log( `[TemporaryCharge] Error evaluating temporary workflow: `, err )
    }
}

module.exports = {
    start_charge_to_full,
    start_pause_protection,
    cancel_temporary_workflow,
    evaluate_temporary_workflow
}
