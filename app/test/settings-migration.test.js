const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const fs = require( 'node:fs' )
const os = require( 'node:os' )
const path = require( 'node:path' )
const {
    configure_settings_location,
    get_setting,
    settings_paths
} = require( '../modules/settings-store' )
const {
    get_charge_limit,
    get_protection_mode,
    get_icon_style_setting,
    get_master_notifications,
    get_force_discharge_setting,
    set_charge_limit
} = require( '../modules/settings' )

function fresh_home() {
    const root = fs.mkdtempSync( path.join( os.tmpdir(), 'battery-migrate-' ) )
    const configDir = path.join( root, '.battery' )
    const storeCwd = path.join( root, 'electron-store' )
    fs.mkdirSync( configDir, { recursive: true } )
    fs.mkdirSync( storeCwd, { recursive: true } )
    return { root, configDir, storeCwd }
}

test( 'legacy settings migrate into a new store and stay there', () => {
    const home = fresh_home()
    fs.writeFileSync( path.join( home.configDir, 'maintain.percentage' ), '75\n' )
    fs.writeFileSync( path.join( home.configDir, 'notify.setting' ), 'off\n' )
    fs.writeFileSync( path.join( home.configDir, 'icon_style.setting' ), 'icon\n' )
    fs.writeFileSync( path.join( home.configDir, 'battery.pid' ), String( process.pid ) )
    fs.writeFileSync( path.join( home.storeCwd, 'config.json' ), JSON.stringify( {
        force_discharge_if_needed: true
    } ) )

    configure_settings_location( { configDir: home.configDir, storeCwd: home.storeCwd } )

    assert.equal( get_charge_limit(), 75 )
    assert.equal( get_protection_mode(), 'enabled' )
    assert.equal( get_icon_style_setting(), 'icon' )
    assert.equal( get_master_notifications(), false )
    assert.equal( get_force_discharge_setting(), true )
    assert.equal( get_setting( 'schema_version' ), 1 )
    assert.equal( fs.readFileSync( path.join( home.configDir, 'maintain.percentage' ), 'utf8' ).trim(), '75' )

    set_charge_limit( 60 )
    configure_settings_location( { configDir: home.configDir, storeCwd: home.storeCwd } )
    assert.equal( get_charge_limit(), 60 )
    assert.equal( get_icon_style_setting(), 'icon' )
    assert.equal( settings_paths().maintain_file.endsWith( 'maintain.percentage' ), true )
} )

test( 'unrelated preference changes do not rewrite maintenance files', () => {
    const home = fresh_home()
    const maintain = path.join( home.configDir, 'maintain.percentage' )
    const voltage = path.join( home.configDir, 'maintain.voltage' )
    fs.writeFileSync( maintain, '70-80\n' )
    fs.writeFileSync( voltage, '11.4 0.3\n' )
    configure_settings_location( { configDir: home.configDir, storeCwd: home.storeCwd } )
    get_charge_limit()

    const { set_icon_style_setting, set_startup_setting, set_master_notifications } = require( '../modules/settings' )
    set_icon_style_setting( 'icon' )
    set_startup_setting( false )
    set_master_notifications( false )
    set_charge_limit( 90 )

    assert.equal( fs.readFileSync( maintain, 'utf8' ), '70-80\n' )
    assert.equal( fs.readFileSync( voltage, 'utf8' ), '11.4 0.3\n' )
} )
