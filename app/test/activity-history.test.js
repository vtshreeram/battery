const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { record_event, get_recent_activity, clear_activity, MAX_HISTORY_ENTRIES } = require( '../modules/activity-history' )

test.beforeEach( () => {
    clear_activity()
} )

test( 'Activity History - Record and retrieve events', () => {
    record_event( {
        type: 'test_event',
        title: 'Test Title',
        detail: 'Test Detail',
        level: 'info'
    } )

    const recent = get_recent_activity( 10 )
    assert.equal( recent.length, 1 )
    assert.equal( recent[ 0 ].type, 'test_event' )
    assert.equal( recent[ 0 ].title, 'Test Title' )
    assert.equal( recent[ 0 ].detail, 'Test Detail' )
} )

test( 'Activity History - Clear activity history', () => {
    record_event( { type: 'event_1', title: 'E1' } )
    assert.equal( get_recent_activity().length, 1 )

    clear_activity()
    assert.equal( get_recent_activity().length, 0 )
} )

test( 'Activity History - Bounded retention limit', () => {
    for( let i = 0; i < 600; i++ ) {
        record_event( { type: `event_${ i }`, title: `Title ${ i }`, detail: `Detail ${ i }` } )
    }
    const all = get_recent_activity( 1000 )
    assert.ok( all.length <= MAX_HISTORY_ENTRIES, `History must not exceed ${ MAX_HISTORY_ENTRIES } entries` )
} )
