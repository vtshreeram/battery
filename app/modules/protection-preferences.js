const { log } = require( './helpers' )
const {
    get_protection_mode,
    get_charge_limit,
    set_charge_limit,
    set_force_discharge_setting
} = require( './settings' )
const { enable_battery_limiter, disable_battery_limiter } = require( './battery' )
const { require_charge_limit } = require( './ipc-validators' )

/**
 * Save a charge-limit preference.
 * When protection is off this updates the desired limit only and does not start the limiter.
 * When protection is on, the limiter is reprogrammed and the preference is kept only if that succeeds.
 */
async function apply_charge_limit( limit ) {
    const numeric = require_charge_limit( limit )
    if( get_protection_mode() !== 'enabled' ) {
        set_charge_limit( numeric )
        log( `[Protection] Saved charge limit ${ numeric }% while protection is off` )
        return {
            ok: true,
            hardware_changed: false,
            protection_mode: 'disabled',
            charge_limit: numeric
        }
    }

    const percentage = await enable_battery_limiter( numeric )
    if( percentage === null ) {
        return {
            ok: false,
            hardware_changed: false,
            protection_mode: get_protection_mode(),
            charge_limit: get_charge_limit()
        }
    }

    return {
        ok: true,
        hardware_changed: true,
        protection_mode: get_protection_mode(),
        charge_limit: get_charge_limit(),
        percentage
    }
}

/**
 * Remember whether force discharge is allowed.
 * Reapplies the running limiter when protection is already on, and leaves it stopped when protection is off.
 */
async function apply_force_discharge( enabled ) {
    const next = Boolean( enabled )
    set_force_discharge_setting( next )
    if( get_protection_mode() === 'enabled' ) {
        const applied = await enable_battery_limiter( get_charge_limit() )
        return { ok: applied !== null, enabled: next, protection_mode: get_protection_mode() }
    }
    log( '[Protection] Saved force-discharge preference while protection is off' )
    return { ok: true, enabled: next, protection_mode: 'disabled' }
}

/**
 * Put protection back to the mode and limit captured before a temporary workflow.
 * A disabled prior mode stays disabled and keeps its preferred limit.
 */
async function restore_protection_state( mode, limit ) {
    const numeric = require_charge_limit( limit )
    if( mode === 'enabled' ) {
        const applied = await enable_battery_limiter( numeric )
        return applied !== null
    }
    set_charge_limit( numeric )
    const stopped = await disable_battery_limiter()
    return stopped !== null
}

module.exports = {
    apply_charge_limit,
    apply_force_discharge,
    restore_protection_state
}
