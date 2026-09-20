const { Notification, nativeImage, app } = require( 'electron' )
const path = require( 'node:path' )
const fs = require( 'node:fs' )
const { exec } = require( 'node:child_process' )
const { get_notification_category, get_notifications_setting, get_notification_sound, get_notification_alert_style } = require( './settings' )
const { record_event } = require( './activity-history' )
const { log } = require( './helpers' )

// Category state trackers for deduplication
const sent_flags = {
    target_reached: false,
    low_battery: false,
    critical_battery: false,
    full_charge_once_completed: false,
    pause_ending: false,
    calibration: false,
    temperature_warning: false
}

let cached_icon = null
const get_notification_icon = () => {
    if( cached_icon ) return cached_icon
    try {
        const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : ''
        const candidates = [
            path.join( appPath, 'assets', 'icon.png' ),
            path.join( appPath, 'build', 'icon.png' ),
            path.join( __dirname, '..', 'assets', 'icon.png' ),
            path.join( __dirname, '..', 'build', 'icon.png' ),
            path.join( process.resourcesPath || '', 'icon.icns' ),
            path.join( process.resourcesPath || '', 'icon.png' )
        ]

        for( const p of candidates ) {
            if( p && fs.existsSync( p ) && nativeImage && typeof nativeImage.createFromPath === 'function' ) {
                cached_icon = nativeImage.createFromPath( p )
                return cached_icon
            }
        }
    } catch ( err ) {
        log( `[Notifications] Error resolving notification icon: `, err?.message )
    }
    return undefined
}

/**
 * Dispatch an Apple-native desktop notification
 * @param {object} options
 * @param {string} options.category - Target notification category
 * @param {string} [options.title='Battery King'] - Notification title
 * @param {string} [options.subtitle] - macOS notification subtitle / event header
 * @param {string} options.body - Notification description body
 * @param {string} [options.sound='default'] - Apple system sound name
 * @param {boolean} [options.force=false] - Bypass deduplication
 */
const send_notification = ( {
    category,
    title = 'Battery King',
    subtitle = '',
    body,
    sound = 'default',
    force = false
} ) => {
    try {
        if( !get_notifications_setting() && !force ) return false
        if( category && !get_notification_category( category ) && !force ) {
            log( `[Notifications] Notification skipped (category '${ category }' disabled)` )
            return false
        }

        const alert_style = get_notification_alert_style ? get_notification_alert_style() : 'banners'
        if( alert_style === 'none' && !force ) {
            log( `[Notifications] Notification skipped (alert style is none)` )
            return false
        }

        if( !force && category && sent_flags[ category ] ) {
            return false // Deduplicated
        }

        const app_title = title || 'Battery King'
        const notif_subtitle = subtitle || ''
        const notif_body = body || ''
        const notif_icon = get_notification_icon()

        const sound_enabled = get_notification_sound ? get_notification_sound() : true
        const effective_sound = sound_enabled ? sound || 'default' : 'none'

        if( Notification && typeof Notification.isSupported === 'function' && Notification.isSupported() ) {
            const notif = new Notification( {
                title: app_title,
                subtitle: notif_subtitle,
                body: notif_body,
                icon: notif_icon,
                silent: effective_sound === 'none',
                sound: effective_sound === 'none' ? undefined : effective_sound
            } )
            notif.show()
        } else {
            // Native macOS AppleScript fallback for background daemons or non-GUI processes
            const soundParam = effective_sound && effective_sound !== 'none' ? `sound name "${ effective_sound }"` : ''
            const safeBody = notif_body.replace( /"/g, '\\"' )
            const safeSub = notif_subtitle.replace( /"/g, '\\"' )
            const safeTitle = app_title.replace( /"/g, '\\"' )
            const script = notif_subtitle
                ? `display notification "${ safeBody }" with title "${ safeTitle }" subtitle "${ safeSub }" ${ soundParam }`
                : `display notification "${ safeBody }" with title "${ safeTitle }" ${ soundParam }`
            exec( `osascript -e '${ script }'`, () => {} )
        }

        if( category ) {
            sent_flags[ category ] = true
        }

        // Record in local activity history
        record_event( {
            type: `notify_${ category || 'alert' }`,
            title: notif_subtitle || app_title,
            detail: notif_body,
            level: category && ( category.includes( 'error' ) || category.includes( 'critical' ) ) ? 'error' : 'info'
        } )

        log( `[Notifications] Sent Apple notification [${ category }]: ${ notif_subtitle } - ${ notif_body }` )
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
        // Plugged into AC power
        sent_flags.low_battery = false
        sent_flags.critical_battery = false

        if( pct >= target_pct && !sent_flags.target_reached ) {
            send_notification( {
                category: 'target_reached',
                title: 'Battery King',
                subtitle: `Target Limit Reached (${ target_pct }%)`,
                body: `Power adapter bypass active. System running directly on AC with zero battery wear.`,
                sound: 'Glass'
            } )
        }
    } else {
        // Running on Battery power
        sent_flags.target_reached = false

        if( pct <= 10 ) {
            send_notification( {
                category: 'critical_battery',
                title: 'Battery King',
                subtitle: `Critical Battery Alert (${ pct }%)`,
                body: 'Battery is below 10%. Connect power adapter immediately to avoid shutdown.',
                sound: 'Basso'
            } )
            sent_flags.low_battery = true
        } else if( pct <= 20 ) {
            send_notification( {
                category: 'low_battery',
                title: 'Battery King',
                subtitle: `Low Battery Warning (${ pct }%)`,
                body: 'Battery is below 20%. Connect your charger to maintain battery longevity.',
                sound: 'Sosumi'
            } )
        }
    }
}

const send_test_notification = () => {
    return send_notification( {
        category: 'target_reached',
        title: 'Battery King',
        subtitle: 'Apple Notifications Active',
        body: 'Alert banners, icons, and system audio cues are configured correctly.',
        sound: 'Glass',
        force: true
    } )
}

const reset_notification_flag = ( category ) => {
    sent_flags[ category ] = false
}

module.exports = {
    send_notification,
    evaluate_power_notifications,
    send_test_notification,
    reset_notification_flag
}
