const { app } = require( 'electron' )
const { alert, log } = require( './modules/helpers' )
const { set_initial_interface } = require( './modules/interface' )

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

/* ///////////////////////////////
// Event listeners
// /////////////////////////////*/

app.whenReady().then( set_initial_interface )

/* ///////////////////////////////
// Global config
// /////////////////////////////*/

// Hide dock entry
if( app.dock ) app.dock.hide()

/* ///////////////////////////////
// Debugging
// /////////////////////////////*/
const debug = false
if( debug ) app.whenReady().then( async () => {

    await alert( __dirname )

    await alert( Object.keys( process.env ).join( '\n' ) )

    const { HOME, PATH, USER } = process.env
    await alert( `HOME: ${ HOME }\n\nPATH: ${ PATH }\n\nUSER: ${ USER }` )

} )
