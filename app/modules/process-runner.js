const { execFile, spawn } = require( 'node:child_process' )
const { log } = require( './helpers' )

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

const MAX_BUFFER = 10 * 1024 * 1024

function kill_process_group( pid, signal ) {
    try {
        process.kill( -pid, signal )
    } catch ( err ) {
        try {
            process.kill( pid, signal )
        } catch ( inner ) {
            log( `[ProcessRunner] Process ${ pid } was already gone` )
        }
    }
}

/**
 * Run a shell command. A timeout kills the command's process group, so the
 * shell and the commands it started actually stop.
 * @param {string} command - Shell command string
 * @param {number} timeout_in_ms - Timeout in milliseconds. 0 waits until exit.
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
const exec_async = ( command, timeout_in_ms = 0 ) => {
    if( mock_handler ) {
        const mockRes = mock_handler( 'exec', command, [], { timeout: timeout_in_ms } )
        if( mockRes !== undefined ) return Promise.resolve( mockRes )
    }

    log( `[ProcessRunner] exec: ${ command }` )

    return new Promise( ( resolve, reject ) => {
        const child = spawn( '/bin/bash', [ '-c', command ], {
            env: process_env,
            detached: true,
            stdio: [ 'ignore', 'pipe', 'pipe' ]
        } )

        let stdout = ''
        let stderr = ''
        let settled = false
        let timed_out = false
        let kill_timer = null
        let timer = null

        const finish = ( error, result ) => {
            if( settled ) return
            settled = true
            if( timer ) clearTimeout( timer )
            if( kill_timer ) clearTimeout( kill_timer )
            if( error ) reject( error )
            else resolve( result )
        }

        child.stdout.on( 'data', chunk => {
            stdout += chunk
            if( stdout.length > MAX_BUFFER ) {
                stderr += '\noutput exceeded buffer'
                timed_out = true
                kill_process_group( child.pid, 'SIGKILL' )
            }
        } )
        child.stderr.on( 'data', chunk => {
            stderr += chunk
        } )

        if( timeout_in_ms > 0 ) {
            timer = setTimeout( () => {
                timed_out = true
                kill_process_group( child.pid, 'SIGTERM' )
                kill_timer = setTimeout( () => kill_process_group( child.pid, 'SIGKILL' ), 500 )
            }, timeout_in_ms )
        }

        child.on( 'error', error => {
            error.cmd = command
            error.output = { stdout, stderr }
            finish( error )
        } )

        child.on( 'close', ( code, signal ) => {
            const output = { stdout, stderr }
            if( timed_out ) {
                const error = new Error( `${ command } timed out after ${ timeout_in_ms }ms` )
                error.code = 'ETIMEDOUT'
                error.cmd = command
                error.output = output
                finish( error )
                return
            }
            if( code !== 0 ) {
                const error = new Error( `Command failed: ${ command }` )
                error.code = code || ( signal ? 'SIGNAL' : 'UNKNOWN' )
                error.cmd = command
                error.output = output
                finish( error )
                return
            }
            finish( null, output )
        } )
    } )
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
