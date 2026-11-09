declare module 'claude-code' {
  interface PluginState {
    'context-guard': { pct: number; warned: boolean }
  }
}
export type Percent = number
