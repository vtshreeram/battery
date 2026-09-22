const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const {
    start_charge_to_full,
    start_pause_protection,
    cancel_temporary_workflow,
    evaluate_temporary_workflow
} = require( '../modules/temporary-charge' )
const {
    get_temporary_workflow,
    get_charge_limit,
    set_charge_limit,
    set_protection_mode,
    reset_settings_to_defaults
} = require( '../modules/settings' )
const { set_mock_handler } = require( '../modules/process-runner' )
const { install_battery_mock } = require( './mock-battery' )

test.beforeEach( () => {
    reset_settings_to_defaults()
    install_battery_mock()
} )

test.afterEach( () => {
    set_mock_handler( null )
} )

test( 'TemporaryCharge - start_charge_to_full saves prior state and sets 100%', async () => {
    set_charge_limit( 75 )
    set_protection_mode( 'enabled' )

    const res = await start_charge_to_full()
    assert.equal( res, true )

    const wf = get_temporary_workflow()
    assert.ok( wf )
    assert.equal( wf.type, 'full_charge' )
    assert.equal( wf.restore_limit, 75 )
    assert.equal( wf.restore_mode, 'enabled' )
} )

test( 'TemporaryCharge - evaluate_temporary_workflow restores state when 100% is reached', async () => {
    set_charge_limit( 75 )
    set_protection_mode( 'enabled' )
    await start_charge_to_full()

    // Battery at 95% -> should not restore
    await evaluate_temporary_workflow( { percentage: 95 } )
    assert.ok( get_temporary_workflow() )

    // Battery reaches 100% -> should restore
    await evaluate_temporary_workflow( { percentage: 100 } )
    assert.equal( get_temporary_workflow(), null )
    assert.equal( get_charge_limit(), 75 )
} )

test( 'TemporaryCharge - start_pause_protection sets duration and cancels correctly', async () => {
    set_charge_limit( 85 )
    set_protection_mode( 'enabled' )

    const res = await start_pause_protection( '1h' )
    assert.equal( res, true )

    const wf = get_temporary_workflow()
    assert.ok( wf )
    assert.equal( wf.type, 'pause' )
    assert.equal( wf.restore_limit, 85 )
    assert.ok( wf.expires_at > Date.now() )

    const cancelled = await cancel_temporary_workflow()
    assert.equal( cancelled, true )
    assert.equal( get_temporary_workflow(), null )
    assert.equal( get_charge_limit(), 85 )
} )
