const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const {
    get_startup_setting,
    set_startup_setting,
    toggle_startup_setting,
    reset_settings_to_defaults
} = require( '../modules/settings' )
const {
    is_startup_enabled,
    set_startup_enabled,
    toggle_startup,
    ensure_startup,
    find_app_path,
    LAUNCH_AGENT_PATH
} = require( '../modules/startup' )

test.beforeEach( () => {
    reset_settings_to_defaults()
} )

test( 'Startup Settings - Default value is true (open at login)', () => {
    assert.equal( get_startup_setting(), true )
} )

test( 'Startup Settings - Setter updates setting and persists', () => {
    set_startup_setting( false )
    assert.equal( get_startup_setting(), false )

    set_startup_setting( true )
    assert.equal( get_startup_setting(), true )
} )

test( 'Startup Settings - Toggler toggles setting state', () => {
    assert.equal( get_startup_setting(), true )
    const val1 = toggle_startup_setting()
    assert.equal( val1, false )
    assert.equal( get_startup_setting(), false )

    const val2 = toggle_startup_setting()
    assert.equal( val2, true )
    assert.equal( get_startup_setting(), true )
} )

test( 'Startup Module - find_app_path locates an app bundle or path', () => {
    const app_path = find_app_path()
    assert.equal( typeof app_path, 'string' )
    assert.ok( app_path.length > 0 )
} )

test( 'Startup Module - is_startup_enabled returns a boolean', async () => {
    const enabled = await is_startup_enabled()
    assert.equal( typeof enabled, 'boolean' )
} )

test( 'Startup Module - LAUNCH_AGENT_PATH is properly defined', () => {
    assert.ok( LAUNCH_AGENT_PATH.includes( 'battery.plist' ) )
} )

test( 'Startup Module - set_startup_enabled updates setting correctly', async () => {
    const res = await set_startup_enabled( true )
    assert.equal( res, true )
    assert.equal( get_startup_setting(), true )
} )

test( 'Startup Module - toggle_startup toggles state correctly', async () => {
    const res1 = await toggle_startup()
    assert.equal( typeof res1, 'boolean' )
    const res2 = await toggle_startup()
    assert.equal( typeof res2, 'boolean' )
    assert.notEqual( res1, res2 )
} )

test( 'Startup Module - ensure_startup executes cleanly', async () => {
    await assert.doesNotReject( async () => {
        await ensure_startup()
    } )
} )
