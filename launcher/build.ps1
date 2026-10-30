$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Install .NET Framework 4.8 developer tools to build the launcher.' }
$launcherSource = Join-Path $PSScriptRoot 'SellmeplsLauncher.cs'
$launcherOutput = Join-Path $projectRoot 'Sellmepls Launcher.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Net.Http.dll "/out:$launcherOutput" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
Write-Output 'Built Sellmepls Launcher.exe'
