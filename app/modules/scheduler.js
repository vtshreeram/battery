const {
    get_protection_mode,
    get_charge_limit,
    set_schedule,
    get_travel_mode,
    set_travel_mode
} = require( './settings' )
const { send_notification } = require( './notifications' )
const { record_event } = require( './activity-history' )
const { log } = require( './helpers' )
const { require_charge_limit, require_future_timestamp } = require( './ipc-validators' )
const { enable_battery_limiter } = require( './battery' )
const { restore_protection_state } = require( './protection-preferences' )
const { status_is_actionable } = require( './state-machine' )

/**
 * Configure a Travel Mode / Scheduled Charge target
 * @param {object} params
 * @param {number} params.target_time_ms - Future completion timestamp in ms
 * @param {number} [params.target_percentage=100] - Charge target (default 100%)
 */
const schedule_travel_mode = async ( { target_time_ms, target_percentage = 100 } ) => {
    try {
        const when = require_future_timestamp( target_time_ms )
        const target = require_charge_limit( target_percentage )
        const now = Date.now()

        const previous_mode = get_protection_mode()
        const previous_limit = get_charge_limit()

        const travel_plan = {
            active: true,
            target_time_ms: when,
            target_percentage: target,
            restore_mode: previous_mode,
            restore_limit: previous_limit,
            outcome: null,
            created_at: now
        }

        set_travel_mode( travel_plan )
        set_schedule( travel_plan )

        record_event( {
            type: 'schedule_start',
            title: 'Travel Mode Scheduled',
            detail: `Target ${ target }% by ${ new Date( when ).toLocaleTimeString() }. Prior limit: ${ previous_limit }% (${ previous_mode }).`
        } )

        log( `[Scheduler] Travel mode scheduled for ${ new Date( when ).toISOString() }` )
        return travel_plan
    } catch ( err ) {
        log( `[Scheduler] Error scheduling travel mode: `, err )
        throw err
    }
}

/**
 * Cancel active travel mode / schedule and restore previous protection
 */
const cancel_travel_mode = async () => {
    try {
        const travel_plan = get_travel_mode()
        if( !travel_plan || !travel_plan.active ) return false

        log( `[Scheduler] Cancelling active travel mode...` )
        set_travel_mode( null )
        set_schedule( null )

        const { restore_mode, restore_limit } = travel_plan

        record_event( {
            type: 'schedule_cancel',
            title: 'Travel Mode Cancelled',
            detail: `Restoring ${ restore_limit }% (${ restore_mode }).`
        } )

        const restored = await restore_protection_state( restore_mode, restore_limit )
        if( !restored ) {
            throw new Error( 'Could not restore the protection state from before Travel Mode' )
        }

        return true
    } catch ( err ) {
        log( `[Scheduler] Error cancelling travel mode: `, err )
        return false
    }
}

/**
 * Periodic tick checking whether schedule should start or complete
 * Safe against macOS sleep/wake cycles
 * @param {object} status
 */
async function finish_travel_mode( travel_plan, outcome, current_pct ) {
    set_travel_mode( null )
    set_schedule( null )

    const restored_limit = travel_plan.restore_limit
    const restored_mode = travel_plan.restore_mode
    if( outcome === 'target_reached' ) {
        send_notification( {
            category: 'full_charge_once_completed',
            title: '✈️ Travel Mode Complete',
            body: `Reached ${ travel_plan.target_percentage }%. Restored ${ restored_limit }% (${ restored_mode }).`
        } )
        record_event( {
            type: 'schedule_complete',
            title: 'Travel Mode Completed',
            detail: `Outcome: target_reached at ${ current_pct }%. Restored ${ restored_limit }% (${ restored_mode }).`
        } )
    } else if( outcome === 'deadline_missed' ) {
        send_notification( {
            category: 'full_charge_once_completed',
            title: '✈️ Travel Mode deadline reached',
            body: `Charge was ${ current_pct }% and did not reach ${ travel_plan.target_percentage }%. Restored ${ restored_limit }% (${ restored_mode }).`
        } )
        record_event( {
            type: 'schedule_deadline',
            title: 'Travel Mode deadline reached before target',
            detail: `Outcome: deadline_missed at ${ current_pct }% (target ${ travel_plan.target_percentage }%). Restored ${ restored_limit }% (${ restored_mode }).`
        } )
    } else {
        record_event( {
            type: 'schedule_error',
            title: 'Travel Mode ended with an error',
            detail: `Outcome: ${ outcome }. Restored ${ restored_limit }% (${ restored_mode }).`
        } )
    }

    const restored = await restore_protection_state( restored_mode, restored_limit )
    if( !restored ) {
        log( `[Scheduler] Failed to restore protection after Travel Mode outcome ${ outcome }` )
        return 'error'
    }
    return outcome
}

const evaluate_scheduler = async ( status ) => {
    try {
        const travel_plan = get_travel_mode()
        if( !travel_plan || !travel_plan.active ) return null

        if( !status_is_actionable( status ) ) {
            log( '[Scheduler] Deferring Travel Mode until a fresh battery reading is available' )
            return null
        }

        const now = Date.now()
        const time_until_target = travel_plan.target_time_ms - now
        const current_pct = status.percentage
        const pct_needed = Math.max( 0, travel_plan.target_percentage - current_pct )
        const estimated_lead_ms = pct_needed / 50 * 60 * 60 * 1000 + 15 * 60 * 1000

        if( time_until_target <= estimated_lead_ms && current_pct < travel_plan.target_percentage && !travel_plan.charging_engaged ) {
            log( `[Scheduler] Starting charge phase for travel mode (${ current_pct }% -> ${ travel_plan.target_percentage }%)` )
            const applied = await enable_battery_limiter( travel_plan.target_percentage )
            if( applied === null ) {
                log( '[Scheduler] Charge phase did not apply; leaving the schedule in place' )
                return 'error'
            }
            travel_plan.charging_engaged = true
            set_travel_mode( travel_plan )
        }

        const reached_target = current_pct >= travel_plan.target_percentage
        const past_deadline = now >= travel_plan.target_time_ms
        if( !past_deadline ) return travel_plan.charging_engaged ? 'charging' : 'waiting'

        const outcome = reached_target ? 'target_reached' : 'deadline_missed'
        log( `[Scheduler] Travel mode outcome: ${ outcome } at ${ current_pct }%` )
        return finish_travel_mode( travel_plan, outcome, current_pct )
    } catch ( err ) {
        log( '[Scheduler] Error evaluating scheduler: ', err )
        return 'error'
    }
}

module.exports = {
    schedule_travel_mode,
    cancel_travel_mode,
    evaluate_scheduler
}
