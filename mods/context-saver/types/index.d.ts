export type ReadMark = { mtimeMs: number; turn: number }

declare module 'claude-code' {
  interface PluginState {
    'context-saver': { reads: Shaped<Record<string, ReadMark>>; turn: number }
  }
}
