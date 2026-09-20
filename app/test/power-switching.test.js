const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { switch_to_battery, switch_to_power, is_ac_attached, parse_status_csv } = require( '../modules/battery' )

test( 'Power Switching - Exports exist and are functions', () => {
    assert.equal( typeof switch_to_battery, 'function' )
    assert.equal( typeof switch_to_power, 'function' )
    assert.equal( typeof is_ac_attached, 'function' )
} )

test( 'Power Switching - Correctly parses forced discharge state as switched to battery', () => {
    const csv = '82,2:30,disabled,discharging,80'
    const status = parse_status_csv( csv )
    assert.equal( status.available, true )
    assert.equal( status.discharging, true )
    assert.equal( status.charging, false )
    assert.ok( status.daemon_state.includes( 'forcing discharge' ) )
} )

test( 'Power Switching - Correctly parses normal adapter power state', () => {
    const csv = '80,unknown,disabled,,80'
    const status = parse_status_csv( csv )
    assert.equal( status.available, true )
    assert.equal( status.discharging, false )
    assert.equal( status.charging, false )
} )
