# Install the plugin and the global files into ~/.claude (or $env:CLAUDE_CONFIG_DIR).
# -DryRun prints each step. Never overwrites: changed files are backed up first.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'; $here = $PSScriptRoot; $dest = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
function Step($msg, [scriptblock]$do) { Write-Output "+ $msg"; if (-not $DryRun) { & $do } }
function Backup($f) { if (Test-Path $f) { $b = "$f.bak.$(Get-Date -Format yyyyMMddHHmmss)"; Step "copy $f $b" { Copy-Item $f $b } } }
Step "mkdir $dest" { New-Item -ItemType Directory -Force $dest | Out-Null }
$frag = Join-Path $dest 'saw-workflow.md'; $src = Join-Path $here 'global/CLAUDE.md'
if (-not (Test-Path $frag) -or (Get-Content -Raw $frag) -ne (Get-Content -Raw $src)) { Backup $frag; Step "copy $src $frag" { Copy-Item $src $frag } }
$md = Join-Path $dest 'CLAUDE.md'
if (-not ((Test-Path $md) -and (Get-Content $md) -contains '@saw-workflow.md')) { Backup $md; Step "append @saw-workflow.md to $md" { Add-Content -Encoding ascii $md "`n@saw-workflow.md" } }
$set = Join-Path $dest 'settings.json'
if (Test-Path $set) { Write-Output "kept: $set (merge from global/settings.example.json by hand)" } else { Step "copy settings.example.json $set" { Copy-Item (Join-Path $here 'global/settings.example.json') $set } }
# Last: installing a plugin writes settings.json, which would stop the copy above.
if (-not $env:SAW_NO_PLUGIN -and (Get-Command claude -ErrorAction SilentlyContinue)) { Step "claude plugin marketplace add $here" { claude plugin marketplace add $here }; Step "claude plugin install sams-agentic-workflow@sams-agentic-workflow" { claude plugin install sams-agentic-workflow@sams-agentic-workflow }; foreach ($p in 'mattpocock-skills', 'engineering', 'dashboard-pane') { Step "claude plugin install $p@sams-agentic-workflow" { claude plugin install "$p@sams-agentic-workflow"; if ($LASTEXITCODE -ne 0) { Write-Output "warn: $p not installed; saw still loads, only the features that use it are off" } } } } else { Write-Output "skip: plugin install (claude not on PATH)" }
