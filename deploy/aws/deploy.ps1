[CmdletBinding()]
param(
    [string]$EnvFile = "deploy/aws/aws.env",
    [switch]$SkipPrepare,
    [switch]$SkipDocker,
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
$awsAccountId = Get-RequiredValue -Values $envValues -Key "AWS_ACCOUNT_ID"
$ecrRepository = Get-OptionalValue -Values $envValues -Key "ECR_REPOSITORY" -Default "faithrequest-api"
$imageTag = Get-OptionalValue -Values $envValues -Key "IMAGE_TAG" -Default "latest"
$ecsCluster = Get-OptionalValue -Values $envValues -Key "ECS_CLUSTER"
$ecsService = Get-OptionalValue -Values $envValues -Key "ECS_SERVICE"
$frontendBucket = Get-OptionalValue -Values $envValues -Key "FRONTEND_S3_BUCKET"
$cloudFrontDistributionId = Get-OptionalValue -Values $envValues -Key "CLOUDFRONT_DISTRIBUTION_ID"

$imageUri = "$awsAccountId.dkr.ecr.$awsRegion.amazonaws.com/$ecrRepository`:$imageTag"
$taskDefinitionPath = Join-Path $repoRoot "deploy/aws/out/ecs-task-definition.json"
$frontendPath = Join-Path $repoRoot "deploy/aws/out/frontend"

Write-Step "Checking required CLI tools"
Assert-CommandAvailable -Name "node"
Assert-CommandAvailable -Name "aws"
if (-not $SkipDocker) {
    Assert-CommandAvailable -Name "docker"
}

if (-not $SkipPrepare) {
    Write-Step "Generating deploy artifacts from $EnvFile"
    Invoke-CheckedCommand -FilePath "node" -Arguments @("deploy/aws/prepare.js", "--env-file", $EnvFile) -Description "AWS prepare"
}

if (-not (Test-Path $taskDefinitionPath)) {
    throw "Generated ECS task definition not found: $taskDefinitionPath"
}

if ((-not $SkipFrontend) -and (-not (Test-Path $frontendPath))) {
    throw "Generated frontend bundle not found: $frontendPath"
}

if (-not $SkipDocker) {
    Write-Step "Logging Docker into Amazon ECR"
    $registry = "$awsAccountId.dkr.ecr.$awsRegion.amazonaws.com"
    $loginCommand = "aws ecr get-login-password --region $awsRegion | docker login --username AWS --password-stdin $registry"
    Write-Host $loginCommand -ForegroundColor DarkGray

    if (-not $DryRun) {
        $password = aws ecr get-login-password --region $awsRegion
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($password)) {
            throw "Failed to retrieve an ECR login password."
        }

        $password | docker login --username AWS --password-stdin $registry
        if ($LASTEXITCODE -ne 0) {
            throw "Docker login to Amazon ECR failed."
        }
    }

    Write-Step "Building and pushing backend image"
    Invoke-CheckedCommand -FilePath "docker" -Arguments @("build", "-t", "$ecrRepository`:$imageTag", "./backend") -Description "Docker build"
    Invoke-CheckedCommand -FilePath "docker" -Arguments @("tag", "$ecrRepository`:$imageTag", $imageUri) -Description "Docker tag"
    Invoke-CheckedCommand -FilePath "docker" -Arguments @("push", $imageUri) -Description "Docker push"
}

if (-not $SkipBackend) {
    Write-Step "Registering ECS task definition"
    Invoke-CheckedCommand -FilePath "aws" -Arguments @("ecs", "register-task-definition", "--cli-input-json", "file://deploy/aws/out/ecs-task-definition.json") -Description "ECS task definition registration"

    if ($ecsCluster -and $ecsService) {
        Write-Step "Triggering ECS service deployment"
        Invoke-CheckedCommand -FilePath "aws" -Arguments @("ecs", "update-service", "--cluster", $ecsCluster, "--service", $ecsService, "--force-new-deployment") -Description "ECS service update"
    }
}

if (-not $SkipFrontend -and $frontendBucket) {
    Write-Step "Uploading frontend bundle to S3"
    Invoke-CheckedCommand -FilePath "aws" -Arguments @("s3", "sync", "deploy/aws/out/frontend", "s3://$frontendBucket", "--delete") -Description "S3 sync"

    if ($cloudFrontDistributionId) {
        Write-Step "Invalidating CloudFront cache"
        Invoke-CheckedCommand -FilePath "aws" -Arguments @("cloudfront", "create-invalidation", "--distribution-id", $cloudFrontDistributionId, "--paths", "/*") -Description "CloudFront invalidation"
    }
}

Write-Step "Deployment workflow finished"
if ($DryRun) {
    Write-Host "Dry run only. No remote changes were made." -ForegroundColor Yellow
}