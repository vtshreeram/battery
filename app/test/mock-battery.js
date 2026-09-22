const { set_mock_handler } = require( '../modules/process-runner' )

function install_battery_mock() {
    let limit = '80'
    let maintaining = false
    const calls = []

    set_mock_handler( ( _kind, command ) => {
        const text = String( command )
        calls.push( text )
        if( text.includes( 'maintain stop' ) ) {
            maintaining = false
            return { stdout: 'stopped\n', stderr: '' }
        }
        const match = text.match( /maintain\s+(\d+)/ )
        if( match ) {
            const [ , next_limit ] = match
            maintaining = true
            limit = next_limit
            return { stdout: `started ${ limit }\n`, stderr: '' }
        }
        if( text.includes( 'status_csv' ) ) {
            return { stdout: `50,1:00,disabled,not discharging,${ limit }\n`, stderr: '' }
        }
        if( text.includes( 'status' ) ) {
            const stdout = maintaining ? `being maintained at ${ limit }%\n` : 'not running\n'
            return { stdout, stderr: '' }
        }
        return { stdout: '0\n', stderr: '' }
    } )

    return {
        calls,
        limit: () => limit,
        maintaining: () => maintaining
    }
}

module.exports = { install_battery_mock }
