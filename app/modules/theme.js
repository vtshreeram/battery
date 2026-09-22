const { nativeImage, app } = require( 'electron' )
const path = require( 'path' )
const { existsSync } = require( 'fs' )
const { log } = require( './helpers' )
const { resourcesPath } = process

const asset_path = app.isPackaged ? resourcesPath : './assets'
const icon_cache = new Map()

// Menu-bar marks. The battery fill is always shown. The mark says what the power is doing.
// plugged: adapter connected, battery not charging
// charging: adapter connected, battery taking a charge
// paused: limit paused while on adapter
// discharging: adapter connected but the pack is being drained on purpose
// battery: running on the battery, no extra mark
const GLYPHS = {
    bolt: [
        '  ##  ',
        ' ###  ',
        '##### ',
        ' ###  ',
        '  ##  ',
        ' ###  ',
        ' ##   ',
        '#     '
    ],
    plug: [
        ' #  # ',
        ' #  # ',
        '######',
        ' #### ',
        '  ##  ',
        '  ##  ',
        ' #### ',
        '######'
    ],
    pause: [
        '##  ##',
        '##  ##',
        '##  ##',
        '##  ##',
        '##  ##',
        '##  ##'
    ],
    down: [
        '  ##  ',
        '  ##  ',
        '  ##  ',
        '######',
        ' #### ',
        '  ##  '
    ]
}

const BADGE_FOR_STATE = {
    charging: 'bolt',
    plugged: 'plug',
    protected: 'plug',
    paused: 'pause',
    discharging: 'down'
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

    const bolt_slash = load_template_icon( 'battery-active-0-Template.png' )
    if( bolt_slash ) return cache_icon( key, bolt_slash )

    log( `Battery level icon missing for ${ level }%` )
    return cache_icon( key, nativeImage.createEmpty() )
}

const blit = ( dest, dest_w, src, src_w, src_h, dx, dy ) => {
    for( let y = 0; y < src_h; y++ ) {
        const src_row = y * src_w * 4
        const dest_row = ( y + dy ) * dest_w * 4
        src.copy( dest, dest_row + dx * 4, src_row, src_row + src_w * 4 )
    }
}

const stamp_glyph = ( buffer, width, height, glyph, origin_x, origin_y, scale ) => {
    glyph.forEach( ( row, gy ) => {
        for( let gx = 0; gx < row.length; gx++ ) {
            if( row[ gx ] !== '#' ) continue
            for( let sy = 0; sy < scale; sy++ ) {
                for( let sx = 0; sx < scale; sx++ ) {
                    const x = origin_x + gx * scale + sx
                    const y = origin_y + gy * scale + sy
                    if( x < 0 || y < 0 || x >= width || y >= height ) continue
                    const i = ( y * width + x ) * 4
                    buffer[ i ] = 0
                    buffer[ i + 1 ] = 0
                    buffer[ i + 2 ] = 0
                    buffer[ i + 3 ] = 255
                }
            }
        }
    } )
}

const compose_battery_badge = ( level_image, glyph_name ) => {
    const scale = level_image.getScaleFactor() || 1
    const logical = level_image.getSize()
    const src_w = logical.width * scale
    const src_h = logical.height * scale
    const src = level_image.getBitmap()
    if( !src || src.length < src_w * src_h * 4 ) return level_image

    const glyph = GLYPHS[ glyph_name ]
    const glyph_w = glyph[ 0 ].length * scale
    const glyph_h = glyph.length * scale
    const gap = 3 * scale
    const out_w = src_w + gap + glyph_w
    const out_h = Math.max( src_h, glyph_h )
    const out = Buffer.alloc( out_w * out_h * 4 )

    const battery_y = Math.floor( ( out_h - src_h ) / 2 )
    blit( out, out_w, src, src_w, src_h, 0, battery_y )

    const badge_x = src_w + gap
    const badge_y = Math.floor( ( out_h - glyph_h ) / 2 )
    stamp_glyph( out, out_w, out_h, glyph, badge_x, badge_y, scale )

    const image = nativeImage.createFromBitmap( out, {
        width: out_w / scale,
        height: out_h / scale,
        scaleFactor: scale
    } )
    image.setTemplateImage( true )
    return image
}

const get_status_icon = ( state = 'battery', percent = 100 ) => {
    const level = round_battery_level( percent )
    const badge = BADGE_FOR_STATE[ state ] || null
    const key = badge ? `${ state }-${ level }` : `level-${ level }`
    if( icon_cache.has( key ) ) return icon_cache.get( key )

    const level_icon = load_template_icon( `battery-active-${ level }-Template@2x.png` )
        || load_template_icon( `battery-active-${ level }-Template.png` )
    if( !level_icon ) {
        log( `Battery level icon missing for ${ level }%` )
        return cache_icon( key, get_battery_level_icon( percent ) )
    }

    if( !badge ) return cache_icon( key, level_icon )
    return cache_icon( key, compose_battery_badge( level_icon, badge ) )
}

module.exports = {
    get_status_icon,
    round_battery_level
}
