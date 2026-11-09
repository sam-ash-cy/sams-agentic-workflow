declare module 'claude-code' {
  interface PluginState {
    'trail-nudge': { nudges: number; hasTrail: boolean | null }
  }
}
export type NudgeCount = number
