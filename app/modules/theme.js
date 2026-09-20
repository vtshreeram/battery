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
    unplugged: 'status-unplugged-Template.png',
    battery: 'status-battery-Template.png'
}

const load_template_icon = ( filename ) => {
    const image_path = path.join( asset_path, filename )
    if( !existsSync( image_path ) ) return null
    const img = nativeImage.createFromPath( image_path )
    if( !img || img.isEmpty() ) return null
    img.setTemplateImage( true )
    return img
}

const get_status_icon = ( state = 'charging' ) => {
    const normalized = STATUS_FILES[ state ] ? state : 'unplugged'
    if( icon_cache.has( normalized ) ) return icon_cache.get( normalized )

    const preferred = load_template_icon( STATUS_FILES[ normalized ] )
    if( preferred ) {
        icon_cache.set( normalized, preferred )
        return preferred
    }

    // Older builds shipped battery/unplugged under either filename
    const fallback_name = normalized === 'unplugged' ? STATUS_FILES.battery : STATUS_FILES.unplugged
    const fallback = load_template_icon( fallback_name )
    if( fallback ) {
        icon_cache.set( normalized, fallback )
        return fallback
    }

    log( `Status image missing for ${ normalized }, using empty template` )
    const empty = nativeImage.createEmpty()
    icon_cache.set( normalized, empty )
    return empty
}

module.exports = {
    get_status_icon
}
