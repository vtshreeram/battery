const { nativeImage, app } = require( 'electron' )
const path = require( 'path' )
const { existsSync } = require( 'fs' )
const { log } = require( './helpers' )
const { resourcesPath } = process

const asset_path = app.isPackaged ? resourcesPath : './assets'
const icon_cache = new Map()

const STATUS_FILES = {
    protected: 'status-protected-Template.png',
    charging: 'status-charging-Template.png',
    battery: 'status-battery-Template.png'
}

const LEVEL_STEP = 5

const load_template_icon = ( filename ) => {
    const image_path = path.join( asset_path, filename )
    if( !existsSync( image_path ) ) return null
    const img = nativeImage.createFromPath( image_path )
    if( !img || img.isEmpty() ) return null
    img.setTemplateImage( true )
    return img
}

const round_battery_level = ( percent ) => {
    const n = Number( percent )
    const clamped = Number.isFinite( n ) ? Math.min( 100, Math.max( 0, n ) ) : 0
    return Math.floor( clamped / LEVEL_STEP ) * LEVEL_STEP
}

const cache_icon = ( key, img ) => {
    icon_cache.set( key, img )
    return img
}

const get_battery_level_icon = ( percent ) => {
    const level = round_battery_level( percent )
    const key = `level-${ level }`
    if( icon_cache.has( key ) ) return icon_cache.get( key )

    const level_icon = load_template_icon( `battery-active-${ level }-Template.png` )
    if( level_icon ) return cache_icon( key, level_icon )

    const bolt_slash = load_template_icon( STATUS_FILES.battery )
    if( bolt_slash ) return cache_icon( key, bolt_slash )

    log( `Battery level icon missing for ${ level }%` )
    return cache_icon( key, nativeImage.createEmpty() )
}

const get_status_icon = ( state = 'charging', percent = 100 ) => {
    if( state === 'protected' || state === 'charging' ) {
        if( icon_cache.has( state ) ) return icon_cache.get( state )
        const img = load_template_icon( STATUS_FILES[ state ] )
        if( img ) return cache_icon( state, img )
        log( `Status image missing for ${ state }` )
        return cache_icon( state, nativeImage.createEmpty() )
    }

    // On battery / discharging / unknown: show a battery body, never the plug glyph.
    // status-unplugged-Template.png is a power-plug drawing and reads as "plugged in".
    return get_battery_level_icon( percent )
}

module.exports = {
    get_status_icon,
    round_battery_level
}
