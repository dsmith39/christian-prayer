[CmdletBinding()]
param(
    [string]$EnvFile = "deploy/aws/aws.env",
    [switch]$SkipPrepare,
    [switch]$SkipBackend,
    [switch]$SkipFrontend,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)

    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-CheckedCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$Description
    )

    $display = "$FilePath $($Arguments -join ' ')".Trim()
    Write-Host $display -ForegroundColor DarkGray

    if ($DryRun) {
        return
    }

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Parse-EnvFile {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "AWS env file not found: $Path"
    }

    $values = @{}
    foreach ($rawLine in Get-Content -Path $Path) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            continue
        }

        $equalsIndex = $line.IndexOf("=")
        if ($equalsIndex -lt 1) {
            continue
        }

        $key = $line.Substring(0, $equalsIndex).Trim()
        $value = $line.Substring($equalsIndex + 1).Trim()
        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        $values[$key] = $value
    }

    return $values
}

function Get-RequiredValue {
    param(
        [hashtable]$Values,
        [string]$Key
    )

    $value = [string]$Values[$Key]
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Missing required setting: $Key"
    }

    return $value.Trim()
}

function Get-OptionalValue {
    param(
        [hashtable]$Values,
        [string]$Key,
        [string]$Default = ""
    )

    $value = [string]$Values[$Key]
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $Default
    }

    return $value.Trim()
}

function Assert-CommandAvailable {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        if ($DryRun) {
            Write-Host "Command not found on PATH for dry run: $Name" -ForegroundColor Yellow
            return
        }

        throw "Required command not found on PATH: $Name"
    }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

$envFilePath = Join-Path $repoRoot $EnvFile
$envValues = Parse-EnvFile -Path $envFilePath

$awsRegion = Get-RequiredValue -Values $envValues -Key "AWS_REGION"
$lambdaFunctionName = Get-OptionalValue -Values $envValues -Key "LAMBDA_FUNCTION_NAME" -Default "faithrequest-api"
$frontendBucket = Get-OptionalValue -Values $envValues -Key "FRONTEND_S3_BUCKET"
$cloudFrontDistributionId = Get-OptionalValue -Values $envValues -Key "CLOUDFRONT_DISTRIBUTION_ID"

$zipPath = Join-Path $repoRoot "deploy/aws/out/faithrequest-api.zip"
$frontendPath = Join-Path $repoRoot "deploy/aws/out/frontend"
$backendPath = Join-Path $repoRoot "backend"

Write-Step "Checking required CLI tools"
Assert-CommandAvailable -Name "node"
Assert-CommandAvailable -Name "npm"
Assert-CommandAvailable -Name "aws"

if (-not $SkipPrepare) {
    Write-Step "Generating deploy artifacts from $EnvFile"
    Invoke-CheckedCommand -FilePath "node" -Arguments @("deploy/aws/prepare.js", "--env-file", $EnvFile) -Description "AWS prepare"
}

if ((-not $SkipFrontend) -and (-not (Test-Path $frontendPath))) {
    throw "Generated frontend bundle not found: $frontendPath"
}

if (-not $SkipBackend) {
    Write-Step "Installing production backend dependencies"
    Invoke-CheckedCommand -FilePath "npm" -Arguments @("--prefix", "backend", "ci", "--omit=dev") -Description "npm ci"

    Write-Step "Packaging backend for Lambda"
    if (-not $DryRun) {
        if (Test-Path $zipPath) {
            Remove-Item $zipPath -Force
        }
        Compress-Archive -Path (Join-Path $backendPath "*") -DestinationPath $zipPath -Force
    } else {
        Write-Host "Compress-Archive -Path $backendPath\* -DestinationPath $zipPath -Force" -ForegroundColor DarkGray
    }

    Write-Step "Updating Lambda function code"
    Invoke-CheckedCommand -FilePath "aws" -Arguments @("lambda", "update-function-code", "--function-name", $lambdaFunctionName, "--zip-file", "fileb://deploy/aws/out/faithrequest-api.zip", "--region", $awsRegion) -Description "Lambda code update"
}

if (-not $SkipFrontend -and $frontendBucket) {
    Write-Step "Uploading frontend bundle to S3"
    Invoke-CheckedCommand -FilePath "aws" -Arguments @("s3", "sync", "deploy/aws/out/frontend", "s3://$frontendBucket", "--delete", "--region", $awsRegion) -Description "S3 sync"

    if ($cloudFrontDistributionId) {
        Write-Step "Invalidating CloudFront cache"
        Invoke-CheckedCommand -FilePath "aws" -Arguments @("cloudfront", "create-invalidation", "--distribution-id", $cloudFrontDistributionId, "--paths", "/*") -Description "CloudFront invalidation"
    }
}

Write-Step "Deployment workflow finished"
if ($DryRun) {
    Write-Host "Dry run only. No remote changes were made." -ForegroundColor Yellow
}
