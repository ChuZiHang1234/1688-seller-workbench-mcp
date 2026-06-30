$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillDir = Split-Path -Parent $scriptDir
$skillName = "1688-seller-workbench-mcp"
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
$destRoot = Join-Path $codexHome "skills"
$destDir = Join-Path $destRoot $skillName
$configPath = Join-Path $codexHome "config.toml"

function Resolve-NodeExe {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "OpenClaw\deps\portable-node\node.exe"),
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
  ) | Where-Object { $_ -and (Test-Path $_) }

  if (-not $candidates -or $candidates.Count -eq 0) {
    throw "Node.js was not found. Install Node.js or set the MCP command manually in $configPath."
  }
  return $candidates[0]
}

New-Item -ItemType Directory -Force -Path $destRoot | Out-Null

if ((Resolve-Path -LiteralPath $skillDir).Path -ne (Resolve-Path -LiteralPath $destDir -ErrorAction SilentlyContinue).Path) {
  if (Test-Path $destDir) {
    $backupDir = "$destDir.backup.$(Get-Date -Format yyyyMMddHHmmss)"
    Move-Item -LiteralPath $destDir -Destination $backupDir
    Write-Host "Backed up existing skill to: $backupDir"
  }
  Copy-Item -LiteralPath $skillDir -Destination $destDir -Recurse
  Write-Host "Installed skill to: $destDir"
} else {
  Write-Host "Skill already located at: $destDir"
}

Push-Location $destDir
try {
  npm.cmd install --no-audit --no-fund
} finally {
  Pop-Location
}

$nodeExe = Resolve-NodeExe
$serverPath = Join-Path $destDir "src\mcp-server.js"
$configBlock = @"

[mcp_servers.work1688]
command = '$nodeExe'
args = ['$serverPath']
startup_timeout_sec = 60.0

"@

if (-not (Test-Path $configPath)) {
  New-Item -ItemType File -Force -Path $configPath | Out-Null
}

$configText = Get-Content -LiteralPath $configPath -Raw
if ($configText -notmatch '(?m)^\[mcp_servers\.work1688\]') {
  Add-Content -LiteralPath $configPath -Value $configBlock
  Write-Host "Registered MCP server in: $configPath"
} else {
  Write-Host "MCP server [mcp_servers.work1688] is already present in: $configPath"
}

Write-Host "Restart Codex to load the new MCP tools."
