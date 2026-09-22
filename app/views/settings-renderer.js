    const api = window.batterySettings

    window.addEventListener( 'keydown', ( e ) => {
      if( ( e.metaKey && e.key === 'w' ) || e.key === 'Escape' ) {
        window.close()
      }
    } )

    async function loadData() {
      const data = await api.getState()
      if( !data ) return

      const protToggle = document.getElementById( 'toggle-protection' )
      if( protToggle ) protToggle.checked = data.settings.protection_mode === 'enabled'

      const disToggle = document.getElementById( 'toggle-discharge' )
      if( disToggle ) disToggle.checked = Boolean( data.settings.force_discharge )

      document.querySelectorAll( '#limit-presets .preset-btn' ).forEach( b => {
        b.classList.toggle( 'active', parseInt( b.dataset.val ) === data.settings.charge_limit )
      } )

      const iconToggle = document.getElementById( 'toggle-icon-style' )
      if( iconToggle ) iconToggle.checked = ( data.settings.display_style || 'text' ) === 'text'

      const startupToggle = document.getElementById( 'toggle-startup' )
      if( startupToggle ) startupToggle.checked = Boolean( data.startup )

      const masterSwitch = document.getElementById( 'master-notifications-switch' )
      if( masterSwitch ) masterSwitch.checked = data.settings.master_notifications !== false

      const powerTitle = document.getElementById( 'power-source-title' )
      const powerDesc = document.getElementById( 'power-source-desc' )
      const btnAdapter = document.getElementById( 'btn-choose-adapter' )
      const btnBattery = document.getElementById( 'btn-choose-battery' )

      if( btnAdapter && btnBattery && data.status ) {
        const isDischarging = Boolean( data.status.discharging )
        const acAttached = data.ac_attached !== false

        if( !acAttached ) {
          if( powerTitle ) powerTitle.textContent = 'Power Source'
          if( powerDesc ) powerDesc.textContent = 'No charger connected — running on battery'
          btnAdapter.disabled = true
          btnAdapter.classList.remove( 'active' )
          btnBattery.disabled = false
          btnBattery.classList.add( 'active' )
        } else if( isDischarging ) {
          if( powerTitle ) powerTitle.textContent = 'Power Source'
          if( powerDesc ) powerDesc.textContent = 'Charger is connected, but the Mac is using the battery'
          btnAdapter.disabled = false
          btnAdapter.classList.remove( 'active' )
          btnBattery.disabled = false
          btnBattery.classList.add( 'active' )
        } else {
          if( powerTitle ) powerTitle.textContent = 'Power Source'
          if( powerDesc ) powerDesc.textContent = 'Running from the charger'
          btnAdapter.disabled = false
          btnAdapter.classList.add( 'active' )
          btnBattery.disabled = false
          btnBattery.classList.remove( 'active' )
        }
      }

      renderTravelMode( data.settings.travel_mode )

      if( data.health ) {
        const capEl = document.getElementById( 'health-capacity' )
        const cycEl = document.getElementById( 'health-cycles' )
        const condEl = document.getElementById( 'health-condition' )
        const tempEl = document.getElementById( 'health-temp' )
        if( capEl ) capEl.textContent = data.health.capacity || 'Unavailable'
        if( cycEl ) cycEl.textContent = data.health.cycles ? `${data.health.cycles} cycles` : 'Unavailable'
        if( condEl ) condEl.textContent = data.health.condition || 'Normal'
        if( tempEl ) tempEl.textContent = data.health.temperature || 'Unavailable'
      }
    }

    function renderTravelMode( plan ) {
      const planRow = document.getElementById( 'travel-plan-row' )
      const scheduleRow = document.getElementById( 'travel-schedule-row' )
      const activeDesc = document.getElementById( 'travel-active-desc' )

      if( plan && plan.active && plan.target_time_ms > Date.now() ) {
        if( planRow ) planRow.style.display = 'flex'
        if( scheduleRow ) scheduleRow.style.display = 'none'
        const timeStr = new Date( plan.target_time_ms ).toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } )
        if( activeDesc ) activeDesc.textContent = `100% by ${timeStr}`
      } else {
        if( planRow ) planRow.style.display = 'none'
        if( scheduleRow ) scheduleRow.style.display = 'flex'
      }
    }

    document.getElementById( 'toggle-protection' ).addEventListener( 'change', ( e ) => {
      api.setProtection( e.target.checked ? 'enabled' : 'disabled' ).then( () => loadData() ).catch( () => loadData() )
    } )

    document.getElementById( 'toggle-discharge' ).addEventListener( 'change', () => {
      api.toggleDischarge().then( () => loadData() ).catch( () => loadData() )
    } )

    const startupToggle = document.getElementById( 'toggle-startup' )
    if( startupToggle ) {
      startupToggle.addEventListener( 'change', ( e ) => {
        api.setStartup( e.target.checked )
      } )
    }

    document.getElementById( 'toggle-icon-style' ).addEventListener( 'change', ( e ) => {
      api.setIconStyle( e.target.checked ? 'text' : 'icon' )
    } )

    document.querySelectorAll( '#limit-presets .preset-btn' ).forEach( b => {
      b.addEventListener( 'click', () => {
        api.setLimit( parseInt( b.dataset.val, 10 ) ).then( () => loadData() ).catch( () => loadData() )
        document.querySelectorAll( '#limit-presets .preset-btn' ).forEach( btn => btn.classList.remove( 'active' ) )
        b.classList.add( 'active' )
      } )
    } )

    document.getElementById( 'btn-schedule-travel' ).addEventListener( 'click', async () => {
      const timeVal = document.getElementById( 'travel-target-time' ).value
      if( !timeVal ) {
        alert( 'Choose a time.' )
        return
      }
      const [hours, minutes] = timeVal.split( ':' ).map( Number )
      const target = new Date()
      target.setHours( hours, minutes, 0, 0 )
      if( target.getTime() <= Date.now() ) target.setDate( target.getDate() + 1 )
      await api.scheduleTravel( target.getTime(), 100 )
      await loadData()
    } )

    document.getElementById( 'btn-cancel-travel' ).addEventListener( 'click', async () => {
      await api.cancelTravel()
      await loadData()
    } )

    const btnAdapter = document.getElementById( 'btn-choose-adapter' )
    const btnBattery = document.getElementById( 'btn-choose-battery' )

    if( btnAdapter ) {
      btnAdapter.addEventListener( 'click', async () => {
        if( btnAdapter.classList.contains( 'active' ) ) return
        btnAdapter.disabled = true
        btnBattery.disabled = true
        await api.switchToPower()
        await loadData()
      } )
    }

    if( btnBattery ) {
      btnBattery.addEventListener( 'click', async () => {
        if( btnBattery.classList.contains( 'active' ) ) return
        btnAdapter.disabled = true
        btnBattery.disabled = true
        await api.switchToBattery()
        await loadData()
      } )
    }

    document.getElementById( 'btn-charge-full' ).addEventListener( 'click', () => {
      api.chargeFull()
    } )
    document.getElementById( 'btn-pause-tmw' ).addEventListener( 'click', () => api.pause( 'tomorrow' ) )
    document.getElementById( 'btn-calibrate' ).addEventListener( 'click', () => api.calibrate() )
    document.getElementById( 'btn-repair' ).addEventListener( 'click', async () => {
      const res = await api.repair()
      alert( res.message )
    } )
    document.getElementById( 'btn-export-logs' ).addEventListener( 'click', () => api.exportLogs() )
    document.getElementById( 'btn-uninstall' ).addEventListener( 'click', async () => {
      if( !confirm( 'Uninstall Battery King and its helper?' ) ) return
      await api.uninstall()
    } )

    const masterSwitchEl = document.getElementById( 'master-notifications-switch' )
    if( masterSwitchEl ) {
      masterSwitchEl.addEventListener( 'change', ( e ) => {
        api.setMasterNotifications( e.target.checked )
      } )
    }

    loadData()
    setInterval( loadData, 3000 )
  