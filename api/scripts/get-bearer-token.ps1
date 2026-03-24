[CmdletBinding()]
param(
  [string]$ApiBase = "http://localhost:5001",
  [string]$Username,
  [string]$Password,
  [switch]$Bearer,
  [switch]$NoClipboard
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertFrom-SecureToPlainText {
  param([Parameter(Mandatory = $true)][System.Security.SecureString]$SecureString)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

function Get-ApiErrorMessage {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  try {
    $response = $ErrorRecord.Exception.Response
    if (-not $response) { return $ErrorRecord.Exception.Message }

    $stream = $response.GetResponseStream()
    if (-not $stream) { return $ErrorRecord.Exception.Message }

    $reader = New-Object System.IO.StreamReader($stream)
    $body = $reader.ReadToEnd()
    if (-not [string]::IsNullOrWhiteSpace($body)) {
      try {
        $parsed = $body | ConvertFrom-Json -ErrorAction Stop
        if ($parsed.error) { return [string]$parsed.error }
      } catch {
        return $body
      }
      return $body
    }

    return $ErrorRecord.Exception.Message
  } catch {
    return $ErrorRecord.Exception.Message
  }
}

if ([string]::IsNullOrWhiteSpace($Username)) {
  $Username = Read-Host "Username"
}

if ([string]::IsNullOrWhiteSpace($Username)) {
  throw "Username is required."
}

$plainPassword = $null
if (-not [string]::IsNullOrWhiteSpace($Password)) {
  $plainPassword = $Password
} else {
  $securePassword = Read-Host "Password" -AsSecureString
  $plainPassword = ConvertFrom-SecureToPlainText -SecureString $securePassword
}

if ([string]::IsNullOrWhiteSpace($plainPassword)) {
  throw "Password is required."
}

$normalizedBase = $ApiBase.TrimEnd("/")
$body = @{
  username = $Username
  password = $plainPassword
} | ConvertTo-Json -Compress

$loginPaths = @(
  "/api/auth/login",
  "/api/login"
)

$response = $null
$lastErrorMessage = $null

foreach ($path in $loginPaths) {
  $url = "$normalizedBase$path"
  try {
    $response = Invoke-RestMethod -Method Post -Uri $url -Body $body -ContentType "application/json"
    if ($response) { break }
  } catch {
    $lastErrorMessage = Get-ApiErrorMessage -ErrorRecord $_
  }
}

$plainPassword = $null

if (-not $response) {
  throw "Authentication failed. $lastErrorMessage"
}

$token = $null
foreach ($prop in @("token", "accessToken", "access_token", "jwt")) {
  if ($response.PSObject.Properties.Name -contains $prop -and -not [string]::IsNullOrWhiteSpace($response.$prop)) {
    $token = [string]$response.$prop
    break
  }
}

if (-not $token -and $response.PSObject.Properties.Name -contains "data" -and $response.data) {
  foreach ($prop in @("token", "accessToken", "access_token", "jwt")) {
    if ($response.data.PSObject.Properties.Name -contains $prop -and -not [string]::IsNullOrWhiteSpace($response.data.$prop)) {
      $token = [string]$response.data.$prop
      break
    }
  }
}

if (-not $token) {
  $available = ($response.PSObject.Properties.Name -join ", ")
  throw "Login succeeded but token was not found in response. Available properties: $available"
}

$output = if ($Bearer) { "Bearer $token" } else { $token }
Write-Output $output

if (-not $NoClipboard -and (Get-Command Set-Clipboard -ErrorAction SilentlyContinue)) {
  Set-Clipboard -Value $output
  Write-Host "Token copied to clipboard."
}
