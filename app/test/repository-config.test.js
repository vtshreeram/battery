const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const config = require( '../modules/config' )

test( 'Repository Config - Source of truth is vtshreeram/battery on main', () => {
    assert.equal( config.REPOSITORY_OWNER, 'vtshreeram' )
    assert.equal( config.REPOSITORY_NAME, 'battery' )
    assert.equal( config.DEFAULT_BRANCH, 'main' )

    const urls = [
        config.REPOSITORY_URL,
        config.REPOSITORY_RAW_BASE,
        config.URL_SETUP_SH,
        config.URL_UPDATE_SH,
        config.URL_BATTERY_SH,
        config.URL_RELEASES,
        config.URL_ISSUES,
        config.URL_README,
        config.URL_CLI_DOCS
    ]

    for( const url of urls ) {
        assert.ok( url.includes( 'vtshreeram/battery' ), `URL must reference vtshreeram/battery: ${ url }` )
        assert.ok( !url.includes( 'actuallymentor' ), `URL must not contain upstream actuallymentor: ${ url }` )
    }
} )
