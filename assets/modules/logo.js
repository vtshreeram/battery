// Horizontal menu-bar battery, similar to macOS battery.100.
// Template-image black on transparent. Fill grows left-to-right.
module.exports = function bake_logo( percentage, opacity = 1 ) {

    const pct = Math.max( 0, Math.min( 1, ( Number( percentage ) || 0 ) / 100 ) )
    const inner_x = 2.45
    const inner_y = 3.35
    const inner_h = 6.3
    const inner_max_w = 18.7
    const fill_w = inner_max_w * pct
    const show_fill = fill_w >= 0.7
    const fill_rx = Math.min( 1, fill_w / 2 )

    const fill = show_fill
        ? `<rect x="${ inner_x }" y="${ inner_y }" width="${ fill_w.toFixed( 3 ) }" height="${ inner_h }" rx="${ fill_rx.toFixed( 3 ) }" fill="#000"/>`
        : ''

    return `<svg opacity="${ opacity }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 27 13" width="27" height="13">
        <rect x="0.85" y="1.7" width="22.3" height="9.6" rx="2.15" fill="none" stroke="#000" stroke-width="1.45"/>
        <rect x="23.7" y="4.55" width="2.05" height="3.9" rx="0.85" fill="#000"/>
        ${ fill }
    </svg>`

}