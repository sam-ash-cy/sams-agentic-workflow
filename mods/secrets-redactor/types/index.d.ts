declare module 'claude-code' {
  interface PluginState {
    'secrets-redactor': { vault: Vault; halt: string }
  }
}

/** Session-only map between real values and placeholders. Never written to disk by the mod. */
export type Vault = {
  byValue: Record<string, string>
  byToken: Record<string, string>
  count: Record<string, number>
}
