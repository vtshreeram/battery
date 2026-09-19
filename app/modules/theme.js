const { ipcMain, nativeTheme, nativeImage, app } = require( 'electron' )
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

/* ///////////////////////////////
// Handle dark theme switching
// /////////////////////////////*/
ipcMain.handle( 'dark-mode:toggle', () => {

    if( nativeTheme.shouldUseDarkColors ) {
        nativeTheme.themeSource = 'light'
    } else {
        nativeTheme.themeSource = 'dark'
    }

    return nativeTheme.shouldUseDarkColors
} )

ipcMain.handle( 'dark-mode:system', () => {
    nativeTheme.themeSource = 'system'
} )

const get_indicator_logo = ( style = 'bolt' ) => {
    const filename = `indicator-${ style }-Template.png`
    const image_path = path.join( asset_path, filename )
    if( existsSync( image_path ) ) {
        log( `Found indicator image: ${ image_path }` )
        return nativeImage.createFromPath( image_path )
    }
    log( `Indicator image missing: ${ image_path }, falling back to logo` )
    return get_logo_template( 80, true )
}

module.exports = {
    get_logo_template,
    get_indicator_logo
}
