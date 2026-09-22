const { contextBridge, ipcRenderer } = require( 'electron' )

contextBridge.exposeInMainWorld( 'batterySettings', {
    getState: () => ipcRenderer.invoke( 'settings:get_state' ),
    setProtection: mode => ipcRenderer.invoke( 'settings:set_protection', mode ),
    setLimit: limit => ipcRenderer.invoke( 'settings:set_limit', limit ),
    toggleDischarge: () => ipcRenderer.invoke( 'settings:toggle_discharge' ),
    setMasterNotifications: enabled => ipcRenderer.invoke( 'settings:set_master_notif', enabled ),
    setIconStyle: style => ipcRenderer.invoke( 'settings:set_icon_style', style ),
    setStartup: enabled => ipcRenderer.invoke( 'settings:set_startup', enabled ),
    toggleStartup: () => ipcRenderer.invoke( 'settings:toggle_startup' ),
    chargeFull: () => ipcRenderer.invoke( 'settings:charge_full' ),
    pause: duration => ipcRenderer.invoke( 'settings:pause', duration ),
    calibrate: () => ipcRenderer.invoke( 'settings:calibrate' ),
    runDiagnostics: () => ipcRenderer.invoke( 'settings:run_diag' ),
    repair: () => ipcRenderer.invoke( 'settings:repair' ),
    exportLogs: () => ipcRenderer.invoke( 'settings:export_logs' ),
    scheduleTravel: ( targetTimeMs, targetPercentage ) => ipcRenderer.invoke( 'settings:schedule_travel', targetTimeMs, targetPercentage ),
    cancelTravel: () => ipcRenderer.invoke( 'settings:cancel_travel' ),
    uninstall: () => ipcRenderer.invoke( 'settings:uninstall' ),
    switchToPower: () => ipcRenderer.invoke( 'settings:switch_to_power' ),
    switchToBattery: () => ipcRenderer.invoke( 'settings:switch_to_battery' )
} )
