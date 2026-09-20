const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { parse_status_csv } = require( '../modules/battery' )

test( 'Status Parser - Normal charging output', () => {
    const raw = '75,1:45,enabled,,80\n'
    const result = parse_status_csv( raw )

    assert.equal( result.available, true )
    assert.equal( result.percentage, 75 )
    assert.equal( result.remaining, '1:45' )
    assert.equal( result.charging, true )
    assert.equal( result.discharging, false )
    assert.equal( result.maintain_percentage, 80 )
    assert.ok( result.battery_state.includes( '75%' ) )
    assert.ok( result.daemon_state.includes( 'smc charging enabled' ) )
} )

test( 'Status Parser - Discharging / bypass output', () => {
    const raw = '85,unknown,disabled,discharging,80'
    const result = parse_status_csv( raw )

    assert.equal( result.available, true )
    assert.equal( result.percentage, 85 )
    assert.equal( result.charging, false )
    assert.equal( result.discharging, true )
    assert.equal( result.maintain_percentage, 80 )
    assert.ok( result.daemon_state.includes( 'forcing discharge' ) )
} )

test( 'Status Parser - Protected / adapter bypass without discharging', () => {
    const raw = '80,unknown,disabled,,80'
    const result = parse_status_csv( raw )

    assert.equal( result.available, true )
    assert.equal( result.percentage, 80 )
    assert.equal( result.charging, false )
    assert.equal( result.discharging, false )
    assert.equal( result.maintain_percentage, 80 )
} )

test( 'Status Parser - Empty string produces explicit unavailable state', () => {
    const result = parse_status_csv( '' )

    assert.equal( result.available, false )
    assert.equal( result.percentage, null )
    assert.equal( result.remaining, null )
    assert.equal( result.charging, null )
    assert.equal( result.discharging, null )
    assert.equal( result.maintain_percentage, null )
    assert.equal( result.battery_state, 'Battery status unavailable' )
    assert.equal( result.errorCode, 'EMPTY_OUTPUT' )
} )

test( 'Status Parser - Missing or partial fields handled gracefully', () => {
    const raw = '55,,'
    const result = parse_status_csv( raw )

    assert.equal( result.available, true )
    assert.equal( result.percentage, 55 )
    assert.equal( result.charging, false )
    assert.equal( result.discharging, false )
    assert.equal( result.maintain_percentage, null )
} )

test( 'Status Parser - Non-numeric percentage fails explicitly', () => {
    const raw = 'invalid,unknown,disabled,,80'
    const result = parse_status_csv( raw )

    assert.equal( result.available, false )
    assert.equal( result.percentage, null )
    assert.equal( result.battery_state, 'Battery status unavailable' )
} )

test( 'Status Parser - Custom limit is captured correctly', () => {
    const raw = '65,0:45,enabled,,60'
    const result = parse_status_csv( raw )

    assert.equal( result.available, true )
    assert.equal( result.maintain_percentage, 60 )
} )
