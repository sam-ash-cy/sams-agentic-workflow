export type Status = { header: string; passed: string[]; failed: string[]; missing: string[]; unconfigured?: string[]; floor?: string; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'workflow-pane': { status: Shaped<Status | null> }
  }
}
