const generate_recommendations = ( { stats, settings, health, status } ) => {
    const recommendations = []

    // 1. Suggest enabling protection if chronically plugged in with limiter disabled
    if( settings && settings.protection_mode === 'disabled' ) {
        if( stats && stats.time_charging_seconds > 7200 && !status?.on_battery ) {
            recommendations.push( {
                id: 'enable_protection',
                type: 'tip',
                title: 'Consider Enabling Battery Protection',
                message: 'Your MacBook spends significant time connected to power. Enabling an 80% charge limit keeps your battery in a resting voltage state and reduces chemical aging.'
            } )
        }
    }

    // 2. Suggest using Charge to 100% Once if user permanently maintains 100%
    if( settings && settings.charge_limit === 100 ) {
        recommendations.push( {
            id: 'use_temporary_100',
            type: 'suggestion',
            title: 'Use "Charge to 100% Once" Instead',
            message: 'Holding the battery at 100% continuously causes elevated cell stress. For travel preparation, we recommend maintaining 80% day-to-day and using "Charge to 100% Once" before heading out.'
        } )
    }

    // 3. Observed high temperature advice (informational only)
    if( health && health.temperature && health.temperature.includes( '°C' ) ) {
        const temp_c = parseFloat( health.temperature )
        if( temp_c >= 40 ) {
            recommendations.push( {
                id: 'high_temperature',
                type: 'warning',
                title: 'Elevated Battery Temperature Observed',
                message: `Current battery temperature is ${ temp_c }°C. Operating or charging in high ambient temperatures accelerates battery wear. Ensure vents are unobstructed.`
            } )
        }
    }

    // 4. Calibration recommendation for degraded condition or high cycles
    if( health ) {
        const isDegraded = health.condition && health.condition !== 'Normal' && health.condition !== 'Unavailable'
        const cycles = parseInt( health.cycles, 10 )
        if( isDegraded ||  !isNaN( cycles ) && cycles >= 500  ) {
            recommendations.push( {
                id: 'recommend_calibration',
                type: 'tip',
                title: 'Periodic Battery Calibration',
                message: 'Running a full calibration cycle can help macOS recalibrate state-of-charge measurements and provide accurate capacity metrics.'
            } )
        }
    }

    return recommendations
}

module.exports = {
    generate_recommendations
}
