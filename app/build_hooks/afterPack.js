const { execSync } = require( 'child_process' )
const path = require( 'path' )

exports.default = async function afterPack( context ) {
    if( context.electronPlatformName !== 'darwin' ) return

    const appName = context.packager.appInfo.productFilename
    const appPath = path.join( context.appOutDir, `${ appName }.app` )
    console.log( `\n🪝 afterPack hook: Ad-hoc signing ${ appPath }...` )

    try {
        execSync( `xattr -cr "${ appPath }"`, { stdio: 'inherit' } )
        execSync( `codesign --force --deep -s - "${ appPath }"`, { stdio: 'inherit' } )
        console.log( `✅ Successfully stripped xattr and ad-hoc signed ${ appPath }` )
    } catch ( err ) {
        console.error( `❌ Failed to ad-hoc sign ${ appPath }:`, err )
    }
}
