const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { resolve_battery_state, ProtectionState, pick_status_for_display } = require( '../modules/state-machine' )

test( 'State Machine - Unavailable when status is unavailable', () => {
    const res = resolve_battery_state( {
        status: { available: false },
        limiter_enabled: true
    } )
    assert.equal( res.state, ProtectionState.UNAVAILABLE )
    assert.equal( res.iconState, 'unplugged' )
} )

test( 'State Machine - Calibrating when calibration_active is true', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 50 },
        limiter_enabled: true,
        calibration_active: true
    } )
    assert.equal( res.state, ProtectionState.CALIBRATING )
    assert.equal( res.iconState, 'charging' )
} )

test( 'State Machine - Charge to 100% Once workflow', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 85, charging: true },
        limiter_enabled: true,
        temporary_workflow: { type: 'full_charge' }
    } )
    assert.equal( res.state, ProtectionState.CHARGE_TO_FULL )
    assert.equal( res.iconState, 'charging' )

    const completedRes = resolve_battery_state( {
        status: { available: true, percentage: 100, charging: false },
        limiter_enabled: true,
        temporary_workflow: { type: 'full_charge' }
    } )
    assert.equal( completedRes.state, ProtectionState.TARGET_REACHED )
    assert.equal( completedRes.iconState, 'protected' )
} )

test( 'State Machine - Paused workflow', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 70 },
        limiter_enabled: false,
        temporary_workflow: { type: 'pause' }
    } )
    assert.equal( res.state, ProtectionState.PAUSED )
} )

test( 'State Machine - High temperature warning (> 45°C)', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 80 },
        limiter_enabled: true,
        temperature_c: 47.5
    } )
    assert.equal( res.state, ProtectionState.TEMP_WARNING )
} )

test( 'State Machine - Force discharging state', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 90, discharging: true, maintain_percentage: 80 },
        limiter_enabled: true,
        on_battery: false
    } )
    assert.equal( res.state, ProtectionState.FORCE_DISCHARGING )
    assert.equal( res.iconState, 'unplugged' )
    assert.match( res.label, /Discharging to 80%/ )
} )

test( 'State Machine - Adapter connected plus SMC discharge is force-discharge', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 90, discharging: true, maintain_percentage: 80 },
        limiter_enabled: true,
        on_battery: true,
        ac_attached: true
    } )
    assert.equal( res.state, ProtectionState.FORCE_DISCHARGING )
    assert.equal( res.iconState, 'unplugged' )
} )

test( 'State Machine - Unplugged discharge is running on battery, not force-discharge', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 97, discharging: true, maintain_percentage: 85 },
        limiter_enabled: true,
        on_battery: true,
        ac_attached: false
    } )
    assert.equal( res.state, ProtectionState.ON_BATTERY )
    assert.equal( res.label, 'Running on Battery' )
    assert.equal( res.iconState, 'unplugged' )
} )

test( 'State Machine - Running on battery', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 60, discharging: false },
        limiter_enabled: true,
        on_battery: true
    } )
    assert.equal( res.state, ProtectionState.ON_BATTERY )
    assert.equal( res.iconState, 'unplugged' )
} )

test( 'pick_status_for_display keeps last good reading on a failed poll', () => {
    const last_good = { available: true, percentage: 97 }
    const picked = pick_status_for_display( { available: false, errorCode: 'STATUS_ERROR' }, last_good )
    assert.equal( picked.stale, true )
    assert.equal( picked.status.percentage, 97 )
} )

test( 'pick_status_for_display uses a fresh successful poll', () => {
    const picked = pick_status_for_display( { available: true, percentage: 80 }, { available: true, percentage: 97 } )
    assert.equal( picked.stale, false )
    assert.equal( picked.status.percentage, 80 )
} )

test( 'State Machine - Explicitly disabled protection mode', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 75, charging: true },
        limiter_enabled: false,
        protection_mode: 'disabled',
        on_battery: false
    } )
    assert.equal( res.state, ProtectionState.DISABLED )
    assert.equal( res.iconState, 'charging' )
} )

test( 'State Machine - Adapter bypass when at or above target', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 80, maintain_percentage: 80, charging: false },
        limiter_enabled: true,
        protection_mode: 'enabled',
        on_battery: false
    } )
    assert.equal( res.state, ProtectionState.BYPASS )
    assert.equal( res.iconState, 'protected' )
} )

test( 'State Machine - Charging toward target', () => {
    const res = resolve_battery_state( {
        status: { available: true, percentage: 65, maintain_percentage: 80, charging: true },
        limiter_enabled: true,
        protection_mode: 'enabled',
        on_battery: false
    } )
    assert.equal( res.state, ProtectionState.CHARGING )
    assert.equal( res.iconState, 'charging' )
} )
