# Apply the saved team-network settings. Reads one JSON file.
# Does not delete or rewrite games, roster, video labels, or other files in .gamepath.

param(
  [Parameter(Mandatory = $true)][string]$Config,
  [switch]$EnsureLoopback
)

$ErrorActionPreference = 'Stop'
$configPath = [System.IO.Path]::GetFullPath($Config)
$folder = Split-Path -Parent $configPath
$statusPath = Join-Path $folder 'hotspot-status.json'
$logPath = Join-Path $folder 'hotspot-apply.log'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Write-Status([bool]$Ok, [string]$Message, [hashtable]$Extra) {
  $payload = @{ ok = $Ok; message = $Message }
  if ($Extra) { $Extra.GetEnumerator() | ForEach-Object { $payload[$_.Key] = $_.Value } }
  [System.IO.File]::WriteAllText($statusPath, ($payload | ConvertTo-Json -Compress), $utf8)
  $line = '{0}  {1}' -f (Get-Date -Format 's'), $Message
  [System.IO.File]::AppendAllText($logPath, $line + "`n", $utf8)
}

function Await-Action($Action) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod
  } | Select-Object -First 1
  $task = $method.Invoke($null, @($Action))
  $task.Wait()
}

function Await-Operation($Operation, [type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

function Install-OfflineAdapter {
  $found = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceDescription -match 'Loopback' })
  if ($found.Count -gt 0) {
    $nameTaken = Get-NetAdapter -Name 'Loopback' -ErrorAction SilentlyContinue
    if ($found[0].Name -ne 'Loopback' -and -not $nameTaken) {
      Rename-NetAdapter -Name $found[0].Name -NewName 'Loopback' -Confirm:$false
    }
    return
  }
  $inf = Join-Path $env:SystemRoot 'INF\netloop.inf'
  if (-not (Test-Path $inf)) { throw 'Windows has no offline network driver. Connect Ethernet and run setup again.' }
  & pnputil.exe /add-driver $inf /install | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not add the offline network adapter. Connect Ethernet and run setup again.' }
  Start-Sleep -Seconds 2
  $found = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceDescription -match 'Loopback' })
  if ($found.Count -eq 0) { throw 'The offline network adapter did not appear. Connect Ethernet and run setup again.' }
  $nameTaken = Get-NetAdapter -Name 'Loopback' -ErrorAction SilentlyContinue
  if ($found[0].Name -ne 'Loopback' -and -not $nameTaken) {
    Rename-NetAdapter -Name $found[0].Name -NewName 'Loopback' -Confirm:$false
  }
}

function Get-ShareProfile {
  $info = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
  $profiles = @($info::GetConnectionProfiles())
  $physical = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
    $_.Status -eq 'Up' -and $_.HardwareInterface -and $_.InterfaceDescription -notmatch 'Wireless|Wi-Fi|Virtual|Bluetooth|Loopback'
  })
  foreach ($adapter in $physical) {
    $guid = $adapter.InterfaceGuid.ToString().Trim('{}')
    $match = $profiles | Where-Object {
      $_.NetworkAdapter -and $_.NetworkAdapter.NetworkAdapterId.ToString().Trim('{}') -eq $guid
    } | Select-Object -First 1
    if ($match) { return $match }
  }
  $ethernet = $profiles | Where-Object {
    $_.NetworkAdapter -and $_.NetworkAdapter.IanaInterfaceType -eq 6 -and $_.ProfileName -notlike 'vEthernet*' -and $_.ProfileName -ne 'Loopback' -and $_.GetNetworkConnectivityLevel().ToString() -ne 'None'
  } | Select-Object -First 1
  if ($ethernet) { return $ethernet }
  $loop = $profiles | Where-Object { $_.ProfileName -eq 'Loopback' } | Select-Object -First 1
  if ($loop) { return $loop }
  if ($EnsureLoopback) {
    Install-OfflineAdapter
    $profiles = @($info::GetConnectionProfiles())
    $loop = $profiles | Where-Object { $_.ProfileName -eq 'Loopback' } | Select-Object -First 1
    if ($loop) { return $loop }
  }
  throw 'No Ethernet connection is available to share. Connect a cable, or enable offline network setup.'
}

try {
  if (-not (Test-Path $configPath)) { throw 'Save the team network in GamePath before enabling it.' }
  $saved = Get-Content -Raw -Path $configPath | ConvertFrom-Json
  $ssid = [string]$saved.ssid
  $passphrase = [string]$saved.passphrase
  $maxPeers = [int]$saved.maxPeers
  if (-not $ssid -or $ssid.Length -gt 32) { throw 'Network name must be 1 to 32 characters.' }
  if ($passphrase.Length -lt 8 -or $passphrase.Length -gt 63) { throw 'Wi-Fi password must be 8 to 63 characters.' }
  if ($maxPeers -lt 1 -or $maxPeers -gt 128) { throw 'Device limit must be from 1 to 128.' }

  $null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
  $settings = 'HKLM:\SYSTEM\CurrentControlSet\Services\icssvc\Settings'
  if (-not (Test-Path $settings)) { New-Item -Path $settings -Force | Out-Null }
  $currentPeers = (Get-ItemProperty -Path $settings -Name WifiMaxPeers -ErrorAction SilentlyContinue).WifiMaxPeers
  if ($currentPeers -ne $maxPeers) {
    New-ItemProperty -Path $settings -Name WifiMaxPeers -Value $maxPeers -PropertyType DWord -Force | Out-Null
    Restart-Service icssvc -Force -ErrorAction SilentlyContinue
    Start-Service icssvc -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }

  $wifi = Get-NetAdapter -Name 'Wi-Fi' -ErrorAction SilentlyContinue
  if ($wifi -and $wifi.Status -eq 'Disabled') { Enable-NetAdapter -Name 'Wi-Fi' -Confirm:$false }
  & netsh.exe interface set interface name='Wi-Fi' admin=enabled | Out-Null

  $profile = Get-ShareProfile
  $manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]::CreateFromConnectionProfile($profile)
  $point = $manager.GetCurrentAccessPointConfiguration()
  if ($point.Ssid -ne $ssid -or $point.Passphrase -ne $passphrase) {
    $point.Ssid = $ssid
    $point.Passphrase = $passphrase
    Await-Action $manager.ConfigureAccessPointAsync($point)
  }
  $state = $manager.TetheringOperationalState.ToString()
  if ($state -ne 'On') {
    $resultType = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
    $result = Await-Operation $manager.StartTetheringAsync() $resultType
    $outcome = $result.Status.ToString()
    if ($outcome -ne 'Success') { throw "Windows did not start the team network ($outcome)." }
  }

  Write-Status $true "Team network $ssid is on for $maxPeers devices." @{ ssid = $ssid; maxPeers = $maxPeers; gateway = '192.168.137.1' }
  exit 0
} catch {
  Write-Status $false $_.Exception.Message @{}
  exit 1
}
