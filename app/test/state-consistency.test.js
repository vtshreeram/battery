const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { parse_status_csv } = require( '../modules/battery' )
const { resolve_battery_state, ProtectionState, status_is_actionable } = require( '../modules/state-machine' )
const { set_mock_handler } = require( '../modules/process-runner' )
const { install_battery_mock } = require( './mock-battery' )
const {
    reset_settings_to_defaults,
    set_protection_mode,
    set_charge_limit,
    get_protection_mode,
    get_charge_limit,
    get_temporary_workflow,
    get_travel_mode,
    set_travel_mode
} = require( '../modules/settings' )
const { enable_battery_limiter } = require( '../modules/battery' )
const { apply_charge_limit, apply_force_discharge } = require( '../modules/protection-preferences' )
const { evaluate_temporary_workflow, start_charge_to_full } = require( '../modules/temporary-charge' )
const { schedule_travel_mode, evaluate_scheduler } = require( '../modules/scheduler' )
const { set_startup_enabled } = require( '../modules/startup' )
const { require_charge_limit, require_protection_mode } = require( '../modules/ipc-validators' )

test.beforeEach( () => {
    reset_settings_to_defaults()
    install_battery_mock()
} )

test.afterEach( () => {
    set_mock_handler( null )
} )

test( 'status parsing keeps a 70-80 range', () => {
    const result = parse_status_csv( '72,1:10,disabled,not discharging,70-80\n' )
    assert.equal( result.maintainMode, 'range' )
    assert.equal( result.lowerLimit, 70 )
    assert.equal( result.upperLimit, 80 )
    assert.equal( result.targetLimit, null )
    assert.equal( result.maintain_percentage, 80 )
} )

test( 'a single percentage stays a percentage', () => {
    const result = parse_status_csv( '80,1:10,disabled,not discharging,80\n' )
    assert.equal( result.maintainMode, 'percentage' )
    assert.equal( result.targetLimit, 80 )
    assert.equal( result.maintain_percentage, 80 )
} )

test( 'range state uses both bounds', () => {
    const inside = resolve_battery_state( {
        status: {
            available: true,
            percentage: 75,
            charging: false,
            maintainMode: 'range',
            lowerLimit: 70,
            upperLimit: 80,
            maintain_percentage: 80
        },
        limiter_enabled: true,
        protection_mode: 'enabled',
        on_battery: false
    } )
    assert.equal( inside.state, ProtectionState.MONITORING )
    assert.match( inside.label, /70%/ )
    assert.match( inside.label, /80%/ )
} )

test( 'failed limiter activation does not record protection as enabled', async () => {
    set_protection_mode( 'disabled' )
    set_charge_limit( 80 )
    set_mock_handler( () => {
        const error = new Error( 'smc write failed' )
        error.code = 1
        throw error
    } )
    const result = await enable_battery_limiter( 70 )
    assert.equal( result, null )
    assert.equal( get_protection_mode(), 'disabled' )
    assert.equal( get_charge_limit(), 80 )
} )

test( 'changing the limit while protection is off does not start the limiter', async () => {
    set_protection_mode( 'disabled' )
    const mock = install_battery_mock()
    const result = await apply_charge_limit( 70 )
    assert.equal( result.hardware_changed, false )
    assert.equal( result.protection_mode, 'disabled' )
    assert.equal( get_charge_limit(), 70 )
    assert.equal( get_protection_mode(), 'disabled' )
    assert.equal( mock.calls.some( call => call.includes( 'maintain ' ) ), false )
} )

test( 'force discharge while protection is off does not start the limiter', async () => {
    set_protection_mode( 'disabled' )
    const mock = install_battery_mock()
    const result = await apply_force_discharge( true )
    assert.equal( result.protection_mode, 'disabled' )
    assert.equal( mock.calls.some( call => call.includes( 'maintain ' ) ), false )
} )

test( 'stale telemetry cannot complete charge-to-full', async () => {
    set_charge_limit( 75 )
    set_protection_mode( 'enabled' )
    assert.equal( await start_charge_to_full(), true )
    await evaluate_temporary_workflow( { available: true, percentage: 100, stale: true }, false )
    assert.ok( get_temporary_workflow() )
    await evaluate_temporary_workflow( { available: false, percentage: 100 }, false )
    assert.ok( get_temporary_workflow() )
} )

test( 'stale telemetry cannot advance Travel Mode', async () => {
    set_protection_mode( 'disabled' )
    set_charge_limit( 80 )
    await schedule_travel_mode( { target_time_ms: Date.now() + 60 * 60 * 1000, target_percentage: 100 } )
    const outcome = await evaluate_scheduler( { available: true, percentage: 82, stale: true } )
    assert.equal( outcome, null )
    assert.equal( get_travel_mode().active, true )
    assert.equal( get_travel_mode().charging_engaged, undefined )
    assert.equal( get_protection_mode(), 'disabled' )
    assert.equal( get_charge_limit(), 80 )
} )

test( 'Travel Mode deadline before the target is not success and restores disabled protection', async () => {
    set_protection_mode( 'disabled' )
    set_charge_limit( 80 )
    const future = Date.now() + 60 * 60 * 1000
    await schedule_travel_mode( { target_time_ms: future, target_percentage: 100 } )
    const plan = get_travel_mode()
    plan.target_time_ms = Date.now() - 1000
    set_travel_mode( plan )

    const outcome = await evaluate_scheduler( { available: true, percentage: 82 } )
    assert.equal( outcome, 'deadline_missed' )
    assert.equal( get_travel_mode(), null )
    assert.equal( get_protection_mode(), 'disabled' )
    assert.equal( get_charge_limit(), 80 )
} )

test( 'Travel Mode target reached restores the previous disabled limit', async () => {
    set_protection_mode( 'disabled' )
    set_charge_limit( 80 )
    const future = Date.now() + 60 * 60 * 1000
    await schedule_travel_mode( { target_time_ms: future, target_percentage: 100 } )
    const plan = get_travel_mode()
    plan.target_time_ms = Date.now() - 1000
    set_travel_mode( plan )

    const outcome = await evaluate_scheduler( { available: true, percentage: 100 } )
    assert.equal( outcome, 'target_reached' )
    assert.equal( get_protection_mode(), 'disabled' )
    assert.equal( get_charge_limit(), 80 )
} )

test( 'scheduler IPC validation rejects a bad percentage', () => {
    assert.throws( () => require_charge_limit( 101 ), /Invalid charge limit/ )
    assert.throws( () => require_charge_limit( '70-80' ), /Invalid charge limit/ )
    assert.throws( () => require_protection_mode( 'on' ), /Invalid protection mode/ )
} )

test( 'launch at startup does not load or unload the maintenance agent', async () => {
    const calls = []
    set_mock_handler( ( _kind, file, args ) => {
        calls.push( `${ file } ${ ( args || [] ).join( ' ' ) }` )
        return { stdout: '0\n', stderr: '' }
    } )
    await set_startup_enabled( false )
    assert.equal( calls.some( call => call.includes( 'battery.plist' ) ), false )
    assert.equal( calls.some( call => call.includes( 'launchctl' ) ), false )
} )

test( 'actionable status requires a fresh percentage', () => {
    assert.equal( status_is_actionable( { available: true, percentage: 0 } ), true )
    assert.equal( status_is_actionable( { available: true, percentage: 80, stale: true } ), false )
    assert.equal( status_is_actionable( { available: false, percentage: 80 } ), false )
} )
