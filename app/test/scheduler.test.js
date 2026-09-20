const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { schedule_travel_mode, cancel_travel_mode } = require( '../modules/scheduler' )
const { get_travel_mode, reset_settings_to_defaults } = require( '../modules/settings' )
const { set_mock_handler } = require( '../modules/process-runner' )

test.beforeEach( () => {
    reset_settings_to_defaults()
    set_mock_handler( () => ( {
        stdout: '80,6:00,enabled,idle,80\n',
        stderr: ''
    } ) )
} )

test.afterEach( () => {
    set_mock_handler( null )
} )

test( 'Scheduler - Reject target time in the past', async () => {
    await assert.rejects( async () => {
        await schedule_travel_mode( { target_time_ms: Date.now() - 10000, target_percentage: 100 } )
    }, /Target time must be in the future/ )
} )

test( 'Scheduler - Schedule future travel mode plan', async () => {
    const futureTime = Date.now() + 2 * 60 * 60 * 1000 // 2 hours in future
    const plan = await schedule_travel_mode( { target_time_ms: futureTime, target_percentage: 100 } )

    assert.equal( plan.active, true )
    assert.equal( plan.target_percentage, 100 )
    assert.equal( plan.restore_limit, 80 )

    const stored = get_travel_mode()
    assert.equal( stored.active, true )
    assert.equal( stored.target_time_ms, futureTime )
} )

test( 'Scheduler - Cancel active travel mode restores plan', async () => {
    const futureTime = Date.now() + 2 * 60 * 60 * 1000
    await schedule_travel_mode( { target_time_ms: futureTime, target_percentage: 100 } )
    assert.ok( get_travel_mode() )

    const cancelled = await cancel_travel_mode()
    assert.equal( cancelled, true )
    assert.equal( get_travel_mode(), null )
} )
