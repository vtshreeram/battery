const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { generate_recommendations } = require( '../modules/recommendations' )

test( 'Recommendations - Suggest enabling protection if chronically charging with protection disabled', () => {
    const recs = generate_recommendations( {
        stats: { time_charging_seconds: 10000 },
        settings: { protection_mode: 'disabled' },
        status: { on_battery: false },
        health: null
    } )

    assert.ok( recs.some( r => r.id === 'enable_protection' ) )
} )

test( 'Recommendations - Suggest temporary 100% if charge limit set to 100%', () => {
    const recs = generate_recommendations( {
        stats: {},
        settings: { charge_limit: 100 },
        status: {},
        health: null
    } )

    assert.ok( recs.some( r => r.id === 'use_temporary_100' ) )
} )

test( 'Recommendations - Warn about elevated temperature if > 40°C', () => {
    const recs = generate_recommendations( {
        stats: {},
        settings: { charge_limit: 80 },
        status: {},
        health: { temperature: '42.0°C / 107.6°F' }
    } )

    assert.ok( recs.some( r => r.id === 'high_temperature' ) )
} )
