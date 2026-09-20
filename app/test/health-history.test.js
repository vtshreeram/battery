const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const fs = require( 'node:fs' )
const {
    HEALTH_HISTORY_FILE,
    record_health_snapshot,
    get_health_history,
    get_health_trends
} = require( '../modules/health-history' )

test.beforeEach( () => {
    try {
        if( fs.existsSync( HEALTH_HISTORY_FILE ) ) {
            fs.unlinkSync( HEALTH_HISTORY_FILE )
        }
    } catch ( err ) {
        // ignore
    }
} )

test( 'Health History - Records valid health snapshots and calculates trends', () => {
    const health = {
        available: true,
        capacity: '96%',
        cycles: '150',
        temperature: '32.5°C / 90.5°F',
        condition: 'Normal'
    }

    const recorded = record_health_snapshot( health )
    assert.ok( recorded )
    assert.equal( recorded.capacity_pct, 96 )
    assert.equal( recorded.cycles, 150 )
    assert.equal( recorded.temperature_c, 32.5 )
    assert.equal( recorded.condition, 'Normal' )

    const history = get_health_history()
    assert.equal( history.length, 1 )

    const trends = get_health_trends()
    assert.equal( trends.has_data, true )
    assert.equal( trends.avg_temp_c, '32.5°C' )
} )

test( 'Health History - Ignores unavailable health data', () => {
    const invalid = { available: false }
    const res = record_health_snapshot( invalid )
    assert.equal( res, null )

    const history = get_health_history()
    assert.equal( history.length, 0 )
} )
