export type Busy = 'improve' | 'handoff' | null

declare module 'claude-code' {
  interface PluginState {
    'prompt-band': { busy: Busy; lastPressAt: number; contextPct: number; isTurnRunning: boolean }
  }
}
