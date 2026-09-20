const {
    get_protection_mode,
    get_charge_limit,
    set_schedule,
    get_travel_mode,
    set_travel_mode
} = require( './settings' )
const { enable_battery_limiter, disable_battery_limiter } = require( './battery' )
const { send_notification } = require( './notifications' )
const { record_event } = require( './activity-history' )
const { log } = require( './helpers' )

/**
 * Configure a Travel Mode / Scheduled Charge target
 * @param {object} params
 * @param {number} params.target_time_ms - Future completion timestamp in ms
 * @param {number} [params.target_percentage=100] - Charge target (default 100%)
 */
const schedule_travel_mode = async ( { target_time_ms, target_percentage = 100 } ) => {
    try {
        const now = Date.now()
        if( target_time_ms <= now ) {
            throw new Error( 'Target time must be in the future.' )
        }

        const previous_mode = get_protection_mode()
        const previous_limit = get_charge_limit()

        const travel_plan = {
            active: true,
            target_time_ms,
            target_percentage,
            restore_mode: previous_mode,
            restore_limit: previous_limit,
            created_at: now
        }

        set_travel_mode( travel_plan )
        set_schedule( travel_plan )

        record_event( {
            type: 'schedule_start',
            title: 'Travel Mode Scheduled',
            detail: `Target ${ target_percentage }% by ${ new Date( target_time_ms ).toLocaleTimeString() }. Prior limit: ${ previous_limit }%.`
        } )

        log( `[Scheduler] Travel mode scheduled for ${ new Date( target_time_ms ).toISOString() }` )
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

        if( restore_mode === 'enabled' ) {
            await enable_battery_limiter( restore_limit )
        } else {
            await disable_battery_limiter()
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
const evaluate_scheduler = async ( status ) => {
    try {
        const travel_plan = get_travel_mode()
        if( !travel_plan || !travel_plan.active ) return

        const now = Date.now()
        const time_until_target = travel_plan.target_time_ms - now

        // Calculate lead time needed to charge (estimate ~1 hour per 50% charge)
        const current_pct = status?.percentage || 80
        const pct_needed = Math.max( 0, travel_plan.target_percentage - current_pct )
        const estimated_lead_ms =   pct_needed / 50  * 60 * 60 * 1000  +  15 * 60 * 1000  // +15m buffer

        if( time_until_target <= estimated_lead_ms && current_pct < travel_plan.target_percentage ) {
            // Engage charge to target
            if( !travel_plan.charging_engaged ) {
                log( `[Scheduler] Starting charge phase for travel mode (${ current_pct }% -> ${ travel_plan.target_percentage }%)` )
                travel_plan.charging_engaged = true
                set_travel_mode( travel_plan )
                await enable_battery_limiter( travel_plan.target_percentage )
            }
        }

        // Check completion
        const reached_target = current_pct >= travel_plan.target_percentage
        const past_deadline = now >= travel_plan.target_time_ms

        if(  reached_target && time_until_target <= 0  || past_deadline ) {
            log( `[Scheduler] Travel mode completed. Restoring original configuration.` )
            set_travel_mode( null )
            set_schedule( null )

            send_notification( {
                category: 'full_charge_once_completed',
                title: '✈️ Travel Mode Complete',
                body: `Ready for departure. Restored ${ travel_plan.restore_limit }% battery limit.`
            } )

            record_event( {
                type: 'schedule_complete',
                title: 'Travel Mode Completed',
                detail: `Reached target. Restored ${ travel_plan.restore_limit }% limit (${ travel_plan.restore_mode }).`
            } )

            if( travel_plan.restore_mode === 'enabled' ) {
                await enable_battery_limiter( travel_plan.restore_limit )
            } else {
                await disable_battery_limiter()
            }
        }
    } catch ( err ) {
        log( `[Scheduler] Error evaluating scheduler: `, err )
    }
}

module.exports = {
    schedule_travel_mode,
    cancel_travel_mode,
    evaluate_scheduler
}
