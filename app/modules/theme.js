const { nativeImage, app } = require( 'electron' )
const path = require( 'path' )
const { existsSync } = require( 'fs' )
const { log } = require( './helpers' )
const { resourcesPath } = process

// Logo assets
const asset_path = app.isPackaged ? resourcesPath : './assets'

/* ///////////////////////////////
// Logo handlers
// /////////////////////////////*/
const get_logo_template = ( percent = 100, active ) => {

    // Image sizes available in /assets/
    log( `Get active logo for ${ percent }` )
    percent = Number( percent )

    // Image sizes available
    // see assets/modules/compile-images.je for values
    const percentage_increment_to_render = 5
    const display_percentage = Math.floor( percent / percentage_increment_to_render ) * percentage_increment_to_render
    log( `Display percentage ${ display_percentage } based on ${ percent }` )

    const image_path = path.join( asset_path, `/battery-${ active ? 'active' : 'inactive' }-${ display_percentage }-Template.png` )
    const exists = existsSync( image_path )
    log( `${ exists ? 'Found' : '🚨 Missing' } image: ${ image_path }` )
    return nativeImage.createFromPath( image_path )
}

const get_status_icon = ( state = 'charging' ) => {
    let filename
    if( state === 'protected' ) {
        filename = 'status-protected-Template.png'
    } else if( state === 'charging' || state === true ) {
        filename = 'status-charging-Template.png'
    } else {
        filename = 'status-battery-Template.png'
    }

    const image_path = path.join( asset_path, filename )
    if( existsSync( image_path ) ) {
        log( `Found status image (${ state }): ${ image_path }` )
        const img = nativeImage.createFromPath( image_path )
        if( img && !img.isEmpty() ) {
            img.setTemplateImage( true )
            return img
        }
    }
    log( `Status image missing: ${ image_path }, falling back to logo` )
    return get_logo_template( 80, state !== 'battery' )
}

module.exports = {
    get_logo_template,
    get_status_icon
}
