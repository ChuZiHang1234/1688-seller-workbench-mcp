$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillDir = Join-Path $repoRoot "skills\1688-seller-workbench-mcp"

if (-not (Test-Path (Join-Path $skillDir "SKILL.md"))) {
  throw "Cannot find skill at: $skillDir"
}

powershell -ExecutionPolicy Bypass -File (Join-Path $skillDir "scripts\install.ps1")
