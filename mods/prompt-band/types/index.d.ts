export type Busy = 'improve' | 'handoff' | null
// The open saw task's start and the session cost then; warned holds the budget shares already toasted.
export type TaskCost = { started: string; baseUsd: number; warned: number[] } | null

declare module 'claude-code' {
  interface PluginState {
    'prompt-band': { busy: Busy; lastPressAt: number; contextPct: number; isTurnRunning: boolean; sessionUsd: number; taskCost: TaskCost; taskState: string | null }
  }
}
