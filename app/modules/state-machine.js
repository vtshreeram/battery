// Semantic Protection State Machine Definition
const ProtectionState = Object.freeze( {
    DISABLED: 'DISABLED',
    MONITORING: 'MONITORING',
    CHARGING: 'CHARGING',
    TARGET_REACHED: 'TARGET_REACHED',
    BYPASS: 'BYPASS',
    FORCE_DISCHARGING: 'FORCE_DISCHARGING',
    ON_BATTERY: 'ON_BATTERY',
    PAUSED: 'PAUSED',
    CHARGE_TO_FULL: 'CHARGE_TO_FULL',
    CALIBRATING: 'CALIBRATING',
    TEMP_WARNING: 'TEMP_WARNING',
    UNAVAILABLE: 'UNAVAILABLE',
    ERROR: 'ERROR'
} )

/**
 * Pure state resolver converting hardware and configuration inputs into a semantic state
 * @param {object} params
 * @param {object} params.status - Structured battery status from battery.js
 * @param {boolean} params.limiter_enabled - Whether CLI limiter is active
 * @param {string} params.protection_mode - 'enabled' | 'disabled'
 * @param {boolean} params.on_battery - Whether power source is battery
 * @param {boolean|null} params.ac_attached - Whether the power adapter is physically connected
 * @param {object|null} params.temporary_workflow - Active temporary workflow ({ type: 'full_charge' | 'pause' })
 * @param {boolean} params.calibration_active - Whether calibration is actively running
 * @param {number|null} params.temperature_c - Current battery temperature in Celsius
 * @returns {{ state: string, label: string, iconState: string }}
 */
const resolve_battery_state = ( {
    status,
    limiter_enabled,
    protection_mode = 'enabled',
    on_battery = false,
    ac_attached = null,
    temporary_workflow = null,
    calibration_active = false,
    temperature_c = null
} ) => {
    // 1. Hardware status unavailable or error
    if( !status || !status.available ) {
        return {
            state: ProtectionState.UNAVAILABLE,
            label: 'Battery status unavailable',
            iconState: 'battery'
        }
    }

    // 2. Calibration active
    if( calibration_active ) {
        return {
            state: ProtectionState.CALIBRATING,
            label: 'Calibration in progress',
            iconState: 'charging'
        }
    }

    // 3. Active temporary workflow: Charge to 100% Once
    if( temporary_workflow && temporary_workflow.type === 'full_charge' ) {
        if( on_battery ) {
            return {
                state: ProtectionState.ON_BATTERY,
                label: 'Charge to 100% paused (running on battery)',
                iconState: 'battery'
            }
        }
        if( status.percentage >= 100 ) {
            return {
                state: ProtectionState.TARGET_REACHED,
                label: 'Full charge reached (100%)',
                iconState: 'protected'
            }
        }
        return {
            state: ProtectionState.CHARGE_TO_FULL,
            label: `Charging to 100% Once (${ status.percentage }%)`,
            iconState: 'charging'
        }
    }

    // 4. Active temporary workflow: Paused
    if( temporary_workflow && temporary_workflow.type === 'pause' ) {
        return {
            state: ProtectionState.PAUSED,
            label: 'Protection temporarily paused',
            iconState: on_battery ? 'battery' : 'charging'
        }
    }

    // 5. Informational temperature warning (> 45°C)
    if( temperature_c !== null && temperature_c >= 45 ) {
        return {
            state: ProtectionState.TEMP_WARNING,
            label: `High battery temperature (${ temperature_c }°C)`,
            iconState: on_battery ? 'battery' : limiter_enabled ? 'protected' : 'charging'
        }
    }

    // 6. Running on battery vs force-discharge while the adapter is still plugged in.
    // Natural unplug must never be labelled as "Discharging to X%".
    const physically_unplugged = ac_attached === false
    const force_discharge = Boolean( status.discharging ) && ac_attached === true
    const inferred_force_discharge = Boolean( status.discharging ) && !on_battery && ac_attached !== false

    if( physically_unplugged || ( on_battery && !force_discharge ) ) {
        return {
            state: ProtectionState.ON_BATTERY,
            label: 'Running on Battery',
            iconState: 'battery'
        }
    }

    if( force_discharge || inferred_force_discharge ) {
        return {
            state: ProtectionState.FORCE_DISCHARGING,
            label: `Discharging to ${ status.maintain_percentage || 80 }%`,
            iconState: 'battery'
        }
    }

    // 7. Explicitly disabled protection
    if( protection_mode === 'disabled' || !limiter_enabled ) {
        return {
            state: ProtectionState.DISABLED,
            label: status.charging ? 'Charging (Limiter disabled)' : 'Limiter disabled',
            iconState: status.charging ? 'charging' : 'battery'
        }
    }

    // 8. Protection active: compare current charge with maintain target
    const target = Number( status.maintain_percentage || 80 )
    const current = Number( status.percentage )

    if( current >= target ) {
        return {
            state: ProtectionState.BYPASS,
            label: `Protected at ${ target }% (Adapter Bypass)`,
            iconState: 'protected'
        }
    }

    if( status.charging || current < target ) {
        return {
            state: ProtectionState.CHARGING,
            label: `Charging to ${ target }% (${ current }%)`,
            iconState: 'charging'
        }
    }

    return {
        state: ProtectionState.MONITORING,
        label: `Maintaining at ${ target }%`,
        iconState: 'protected'
    }
}

/**
 * Keep the last good hardware reading when a poll fails.
 * Prevents the tray from flashing "status unavailable" during a blip.
 */
const pick_status_for_display = ( fresh, last_good ) => {
    if( fresh && fresh.available ) {
        return { status: fresh, stale: false }
    }
    if( last_good && last_good.available ) {
        return { status: last_good, stale: true }
    }
    return { status: fresh || { available: false }, stale: false }
}

module.exports = {
    ProtectionState,
    resolve_battery_state,
    pick_status_for_display
}
