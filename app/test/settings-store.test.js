const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const {
    get_protection_mode,
    set_protection_mode,
    get_charge_limit,
    set_charge_limit,
    get_force_discharge_setting,
    toggle_force_discharge,
    get_notifications_setting,
    get_notification_category,
    set_notification_category,
    get_icon_style_setting,
    toggle_icon_style_setting,
    reset_settings_to_defaults
} = require( '../modules/settings' )

test.beforeEach( () => {
    reset_settings_to_defaults()
} )

test( 'Settings Store - Default values', () => {
    assert.equal( get_protection_mode(), 'enabled' )
    assert.equal( get_charge_limit(), 80 )
    assert.equal( get_force_discharge_setting(), false )
    assert.equal( get_icon_style_setting(), 'text' )
    assert.equal( get_notifications_setting(), true )
    assert.equal( get_notification_category( 'target_reached' ), true )
} )

test( 'Settings Store - Protection mode persists enabled and disabled', () => {
    set_protection_mode( 'disabled' )
    assert.equal( get_protection_mode(), 'disabled' )

    set_protection_mode( 'enabled' )
    assert.equal( get_protection_mode(), 'enabled' )

    assert.throws( () => {
        set_protection_mode( 'invalid_mode' )
    }, /Invalid protection mode/ )
} )

test( 'Settings Store - Charge limit valid range (50 - 100)', () => {
    set_charge_limit( 70 )
    assert.equal( get_charge_limit(), 70 )

    set_charge_limit( 85 )
    assert.equal( get_charge_limit(), 85 )

    set_charge_limit( 100 )
    assert.equal( get_charge_limit(), 100 )

    set_charge_limit( 50 )
    assert.equal( get_charge_limit(), 50 )

    assert.throws( () => {
        set_charge_limit( 40 )
    }, /Invalid charge limit/ )

    assert.throws( () => {
        set_charge_limit( 105 )
    }, /Invalid charge limit/ )

    assert.throws( () => {
        set_charge_limit( 'invalid' )
    }, /Invalid charge limit/ )
} )

test( 'Settings Store - Force discharge toggle', () => {
    assert.equal( get_force_discharge_setting(), false )
    const toggled = toggle_force_discharge()
    assert.equal( toggled, true )
    assert.equal( get_force_discharge_setting(), true )
    toggle_force_discharge()
    assert.equal( get_force_discharge_setting(), false )
} )

test( 'Settings Store - Icon style toggle', () => {
    assert.equal( get_icon_style_setting(), 'text' )
    const toggled = toggle_icon_style_setting()
    assert.equal( toggled, 'icon' )
    assert.equal( get_icon_style_setting(), 'icon' )
    toggle_icon_style_setting()
    assert.equal( get_icon_style_setting(), 'text' )
} )

test( 'Settings Store - Granular notification categories', () => {
    set_notification_category( 'temperature_warning', false )
    assert.equal( get_notification_category( 'temperature_warning' ), false )
    assert.equal( get_notification_category( 'target_reached' ), true )

    set_notification_category( 'temperature_warning', true )
    assert.equal( get_notification_category( 'temperature_warning' ), true )
} )
