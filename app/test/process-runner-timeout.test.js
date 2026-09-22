const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const fs = require( 'node:fs' )
const os = require( 'node:os' )
const path = require( 'node:path' )
const { exec_async } = require( '../modules/process-runner' )

test( 'a reported timeout stops the child process', async () => {
    const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'battery-timeout-' ) )
    const marker = path.join( dir, 'done' )
    const pidfile = path.join( dir, 'pid' )
    const command = `echo $$ > '${ pidfile }'; sleep 30; touch '${ marker }'`

    await assert.rejects(
        () => exec_async( command, 300 ),
        error => error.code === 'ETIMEDOUT'
    )

    await new Promise( resolve => setTimeout( resolve, 800 ) )
    assert.equal( fs.existsSync( marker ), false )
    const pid = Number( fs.readFileSync( pidfile, 'utf8' ).trim() )
    assert.ok( pid > 0 )
    let alive = true
    try {
        process.kill( pid, 0 )
    } catch ( err ) {
        alive = false
    }
    assert.equal( alive, false )
} )
