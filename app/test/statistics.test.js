const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const {
    get_statistics,
    reset_statistics,
    increment_target_reached,
    increment_full_charge_sessions
} = require( '../modules/statistics' )

test.beforeEach( () => {
    reset_statistics()
} )

test( 'Statistics - Track event increments', () => {
    const initial = get_statistics()
    assert.equal( initial.charge_target_reached_count, 0 )
    assert.equal( initial.full_charge_sessions_count, 0 )

    increment_target_reached()
    increment_target_reached()
    increment_full_charge_sessions()

    const updated = get_statistics()
    assert.equal( updated.charge_target_reached_count, 2 )
    assert.equal( updated.full_charge_sessions_count, 1 )
} )

test( 'Statistics - Reset statistics clears counters', () => {
    increment_target_reached()
    reset_statistics()
    const stats = get_statistics()
    assert.equal( stats.charge_target_reached_count, 0 )
} )
