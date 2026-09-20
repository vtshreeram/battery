const test = require( 'node:test' )
const assert = require( 'node:assert/strict' )
const { parse_ioreg_battery, parse_system_profiler_battery } = require( '../modules/battery' )

test( 'Health Parser - Normal ioreg output parses cycles and temp', () => {
    const ioregOutput = `
      | |   "CycleCount" = 142
      | |   "Temperature" = 2950
      | |   "DesignCapacity" = 6075
    `
    const parsed = parse_ioreg_battery( ioregOutput )
    assert.equal( parsed.cycles, '142' )
    assert.equal( parsed.temperature, '29.5°C / 85.1°F' )
} )

test( 'Health Parser - Normal system_profiler output parses capacity and condition', () => {
    const profilerOutput = `
      Battery Information:
        Health Information:
          Cycle Count: 142
          Condition: Normal
          Maximum Capacity: 98%
    `
    const parsed = parse_system_profiler_battery( profilerOutput )
    assert.equal( parsed.capacity, '98%' )
    assert.equal( parsed.condition, 'Normal' )
} )

test( 'Health Parser - Missing condition in system_profiler returns Unavailable, never Normal', () => {
    const profilerOutput = `
      Battery Information:
        Health Information:
          Cycle Count: 142
          Maximum Capacity: 95%
    `
    const parsed = parse_system_profiler_battery( profilerOutput )
    assert.equal( parsed.capacity, '95%' )
    assert.equal( parsed.condition, 'Unavailable', 'Condition must be Unavailable when missing, not defaulted to Normal' )
} )

test( 'Health Parser - Missing capacity in system_profiler returns Unavailable', () => {
    const profilerOutput = `
      Battery Information:
        Health Information:
          Condition: Replace Soon
    `
    const parsed = parse_system_profiler_battery( profilerOutput )
    assert.equal( parsed.capacity, 'Unavailable' )
    assert.equal( parsed.condition, 'Replace Soon' )
} )

test( 'Health Parser - Empty outputs return explicit Unavailable', () => {
    const parsedIoreg = parse_ioreg_battery( '' )
    assert.equal( parsedIoreg.cycles, 'Unavailable' )
    assert.equal( parsedIoreg.temperature, 'Unavailable' )

    const parsedProfiler = parse_system_profiler_battery( '' )
    assert.equal( parsedProfiler.capacity, 'Unavailable' )
    assert.equal( parsedProfiler.condition, 'Unavailable' )
} )
