export type Tab = 'settings' | 'mods' | 'projects'
export type Scope = 'global' | 'project' | 'local'

export type Project = { id: string; name: string; path: string; state: string; summary: string }

export type SettingRow = {
  key: string
  group: string
  description: string
  type: 'boolean' | 'enum' | 'number' | 'text' | 'list'
  options?: string[]
  value: string | number | boolean | (string | number | boolean)[]
  source: string
  layer?: string | number | boolean | (string | number | boolean)[]
  blocked?: (string | number | boolean)[]
  note?: string
}

export type ModRow = { name: string; description: string; state: string; own: boolean; install: string }

// What the pane draws. The session, the csrf key and the port never go in here: they live
// in the module's own variables, so no redraw, state dump or other plugin can read them.
export type View = {
  phase: 'idle' | 'starting' | 'ready' | 'error'
  message: string
  writable: boolean
  tab: Tab
  project: string
  scope: Scope
  group: string
  page: number
  filter: string
  projects: Project[]
  rows: SettingRow[]
  mods: ModRow[]
  restart: string
}

declare module 'claude-code' {
  interface PluginState {
    'dashboard-pane': { view: Shaped<View> }
  }
}
