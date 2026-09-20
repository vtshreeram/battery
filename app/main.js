const { app } = require( 'electron' )
const { log } = require( './modules/helpers' )
const { set_initial_interface, refresh_tray } = require( './modules/interface' )
const { ensure_startup } = require( './modules/startup' )

const got_lock = app.requestSingleInstanceLock()
if( !got_lock ) {
    app.quit()
}

// Enable auto-updates
require( 'update-electron-app' )( {
    logger: {
        log: ( ...data ) => log( `[ update-electron-app ] `, ...data )
    }
} )

// Prevent app from quitting when all windows are closed (tray-only app)
app.on( 'window-all-closed', ( e ) => {
    e.preventDefault()
} )

// Global error handlers to keep tray daemon alive
process.on( 'uncaughtException', ( error ) => {
    log( 'Uncaught Exception in main: ', error )
} )
process.on( 'unhandledRejection', ( reason ) => {
    log( 'Unhandled Rejection in main: ', reason )
} )

if( got_lock ) {
    app.on( 'second-instance', () => {
        refresh_tray()
    } )
    app.whenReady().then( () => {
        set_initial_interface()
        ensure_startup().catch( ( err ) => log( '[Startup] Error in ensure_startup: ', err ) )
    } )
}

// Hide dock entry
if( app.dock ) app.dock.hide()
