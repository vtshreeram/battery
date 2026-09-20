const { execFile, exec } = require( 'node:child_process' )
const { log, wait } = require( './helpers' )

const SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/usr/local/co.palokaj.battery'

const process_env = {
    ...process.env,
    PATH: SAFE_PATH
}

let mock_handler = null

const set_mock_handler = ( handler ) => {
    mock_handler = handler
}

/**
 * Execute an executable file directly without shell interpretation
 * @param {string} file - Path to executable
 * @param {string[]} args - Argument array
 * @param {object} options - Execution options
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
const exec_file_async = ( file, args = [], options = {} ) => {
    if( mock_handler ) {
        const mockRes = mock_handler( 'execFile', file, args, options )
        if( mockRes !== undefined ) return Promise.resolve( mockRes )
    }

    const { timeout = 10000, env = process_env, maxBuffer = 10 * 1024 * 1024 } = options
    log( `[ProcessRunner] execFile: ${ file } ${ args.join( ' ' ) }` )

    return new Promise( ( resolve, reject ) => {
        execFile( file, args, { env, timeout, maxBuffer }, ( error, stdout, stderr ) => {
            const output = { stdout: stdout ?? '', stderr: stderr ?? '' }
            if( error ) {
                if( !error.code ) {
                    if( error.signal ) error.code = 'SIGNAL'
                    else if( error.killed ) error.code = 'ETIMEDOUT'
                    else error.code = 'UNKNOWN'
                }
                error.cmd = `${ file } ${ args.join( ' ' ) }`
                error.output = output
                return reject( error )
            }
            return resolve( output )
        } )
    } )
}

/**
 * Run shell command with explicit timeout
 * @param {string} command - Shell command string
 * @param {number} timeout_in_ms - Timeout in milliseconds
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
const exec_async = ( command, timeout_in_ms = 0 ) => {
    if( mock_handler ) {
        const mockRes = mock_handler( 'exec', command, [], { timeout: timeout_in_ms } )
        if( mockRes !== undefined ) return Promise.resolve( mockRes )
    }

    log( `[ProcessRunner] exec: ${ command }` )

    const promise = new Promise( ( resolve, reject ) => {
        exec( command, { shell: '/bin/bash', env: process_env, maxBuffer: 10 * 1024 * 1024 }, ( error, stdout, stderr ) => {
            const output = { stdout: stdout ?? '', stderr: stderr ?? '' }
            if( error ) {
                error.code ??= error.signal ? 'SIGNAL' : 'UNKNOWN'
                error.cmd = command
                error.output = output
                return reject( error )
            }
            return resolve( output )
        } )
    } )

    if( timeout_in_ms > 0 ) {
        const timeoutPromise = wait( timeout_in_ms ).then( () => {
            const error = new Error( `${ command } timed out after ${ timeout_in_ms }ms` )
            error.code = 'ETIMEDOUT'
            error.cmd = command
            error.output = { stdout: '', stderr: '' }
            throw error
        } )
        return Promise.race( [ promise, timeoutPromise ] )
    }

    return promise
}

/**
 * Execute command with administrator privileges via macOS AppleScript dialog
 * Validates and escapes input to prevent AppleScript injection
 * @param {string} command - Command string to execute with sudo
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
const exec_sudo_async = ( command ) => {
    if( mock_handler ) {
        const mockRes = mock_handler( 'exec_sudo', command, [], {} )
        if( mockRes !== undefined ) return Promise.resolve( mockRes )
    }

    // Escape backslashes and double quotes for AppleScript string literal
    const escaped = command.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' )
    const script = `do shell script "${ escaped }" with administrator privileges`
    log( `[ProcessRunner] exec_sudo_async: ${ command }` )

    return new Promise( ( resolve, reject ) => {
        execFile( '/usr/bin/osascript', [ '-e', script ], { env: process_env }, ( error, stdout, stderr ) => {
            const output = { stdout: stdout ?? '', stderr: stderr ?? '' }
            if( error ) {
                error.code ??= error.signal ? 'SIGNAL' : 'UNKNOWN'
                error.cmd = command
                error.output = output
                return reject( error )
            }
            return resolve( output )
        } )
    } )
}

module.exports = {
    SAFE_PATH,
    set_mock_handler,
    exec_file_async,
    exec_async,
    exec_sudo_async
}
