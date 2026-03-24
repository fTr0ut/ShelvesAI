[CmdletBinding()]
param(
  [string]$ApiBase = "http://localhost:5001",
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [ValidateSet("GET", "POST", "PUT", "PATCH", "DELETE")]
  [string]$Method = "GET",
  [string]$BearerToken,
  [string]$BodyJson,
  [string]$OutFile,
  [switch]$NoClipboardToken,
  [switch]$Raw
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-Token {
  param(
    [string]$TokenParam,
    [switch]$NoClipboard
  )

  if (-not [string]::IsNullOrWhiteSpace($TokenParam)) {
    return $TokenParam.Trim()
  }

  if (-not [string]::IsNullOrWhiteSpace($env:SHELVES_BEARER_TOKEN)) {
    return $env:SHELVES_BEARER_TOKEN.Trim()
  }

  if (-not $NoClipboard -and (Get-Command Get-Clipboard -ErrorAction SilentlyContinue)) {
    try {
      $clip = (Get-Clipboard -Raw).Trim()
      if (-not [string]::IsNullOrWhiteSpace($clip)) {
        return $clip
      }
    } catch {
      # ignore and fallback to prompt
    }
  }

  $inputToken = Read-Host "Bearer token (paste token or full 'Bearer <token>')"
  if ([string]::IsNullOrWhiteSpace($inputToken)) {
    throw "Bearer token is required."
  }
  return $inputToken.Trim()
}

function Normalize-Token {
  param([Parameter(Mandatory = $true)][string]$Token)
  if ($Token -match "^\s*Bearer\s+") {
    return ($Token -replace "^\s*Bearer\s+", "").Trim()
  }
  return $Token.Trim()
}

function Get-ErrorMessage {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  try {
    $response = $ErrorRecord.Exception.Response
    if (-not $response) { return $ErrorRecord.Exception.Message }
    $stream = $response.GetResponseStream()
    if (-not $stream) { return $ErrorRecord.Exception.Message }
    $reader = New-Object System.IO.StreamReader($stream)
    $content = $reader.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($content)) {
      return $ErrorRecord.Exception.Message
    }
    return $content
  } catch {
    return $ErrorRecord.Exception.Message
  }
}

$tokenInput = Resolve-Token -TokenParam $BearerToken -NoClipboard:$NoClipboardToken
$token = Normalize-Token -Token $tokenInput

$base = $ApiBase.TrimEnd("/")
$requestPath = if ($Path.StartsWith("/")) { $Path } else { "/$Path" }
$url = "$base$requestPath"

$headers = @{
  Authorization = "Bearer $token"
  "ngrok-skip-browser-warning" = "true"
}

$invokeArgs = @{
  Uri = $url
  Method = $Method
  Headers = $headers
}

if (-not [string]::IsNullOrWhiteSpace($BodyJson)) {
  $invokeArgs["Body"] = $BodyJson
  $invokeArgs["ContentType"] = "application/json"
}

try {
  $response = Invoke-WebRequest @invokeArgs
  $content = $response.Content

  if (-not [string]::IsNullOrWhiteSpace($OutFile)) {
    Set-Content -Path $OutFile -Value $content
    Write-Host "Response saved to $OutFile"
  }

  if ($Raw) {
    Write-Output $content
    exit 0
  }

  try {
    $json = $content | ConvertFrom-Json -ErrorAction Stop
    $pretty = $json | ConvertTo-Json -Depth 100
    Write-Output $pretty
  } catch {
    Write-Output $content
  }
} catch {
  $msg = Get-ErrorMessage -ErrorRecord $_
  throw "Request failed ($Method $url): $msg"
}
