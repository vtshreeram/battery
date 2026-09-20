const { Notification } = require( 'electron' )
const { get_notification_category, get_notifications_setting } = require( './settings' )
const { record_event } = require( './activity-history' )
const { log } = require( './helpers' )

// Category state trackers for deduplication
const sent_flags = {
    target_reached: false,
    low_battery: false,
    critical_battery: false,
    full_charge_once_completed: false,
    temperature_warning: false
}

/**
 * Dispatch desktop alert if category is enabled
 * @param {object} options
 * @param {string} options.category - One of the configured notification categories
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body
 * @param {string} [options.sound] - Optional sound
 * @param {boolean} [options.force=false] - Force send bypassing deduplication
 */
const send_notification = ( { category, title, body, force = false } ) => {
    try {
        if( !get_notifications_setting() ) return false
        if( !get_notification_category( category ) ) {
            log( `[Notifications] Notification skipped (category '${ category }' disabled)` )
            return false
        }

        if( !Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported() ) {
            log( `[Notifications] Desktop notifications not supported on this platform` )
            return false
        }

        if( !force && sent_flags[ category ] ) {
            return false // Deduplicated
        }

        new Notification( { title, body } ).show()
        sent_flags[ category ] = true

        // Record in activity history
        record_event( {
            type: `notify_${ category }`,
            title,
            detail: body,
            level: category.includes( 'error' ) || category.includes( 'critical' ) ? 'error' : 'info'
        } )

        log( `[Notifications] Sent notification [${ category }]: ${ title }` )
        return true
    } catch ( err ) {
        log( `[Notifications] Error sending notification: `, err )
        return false
    }
}

/**
 * Reset deduplication flags based on power/charge state
 * @param {boolean} on_battery
 * @param {number} percentage
 * @param {number} target
 */
const evaluate_power_notifications = ( { on_battery, percentage, target } ) => {
    const pct = Number( percentage )
    const target_pct = Number( target || 80 )

    if( !on_battery ) {
        // Plugged into AC
        sent_flags.low_battery = false
        sent_flags.critical_battery = false

        if( pct >= target_pct && !sent_flags.target_reached ) {
            send_notification( {
                category: 'target_reached',
                title: '🔋 Target Charge Reached',
                body: `Target ${ target_pct }% reached. Switched to AC Adapter bypass.`
            } )
        }
    } else {
        // Running on Battery
        sent_flags.target_reached = false

        if( pct <= 10 ) {
            send_notification( {
                category: 'critical_battery',
                title: `🚨 Critical Battery (${ pct }%)`,
                body: 'Battery is below 10%! Plug in charger immediately.'
            } )
            sent_flags.low_battery = true
        } else if( pct <= 20 ) {
            send_notification( {
                category: 'low_battery',
                title: `🪫 Low Battery (${ pct }%)`,
                body: 'Connect charger to maintain battery longevity and avoid deep discharge.'
            } )
        }
    }
}

const reset_notification_flag = ( category ) => {
    sent_flags[ category ] = false
}

module.exports = {
    send_notification,
    evaluate_power_notifications,
    reset_notification_flag
}
