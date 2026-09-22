Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Project Sentinel - Injecting Toxiproxy Chaos           " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:8474/proxies/primary_api/toxics"

# 1. Inject 500ms Latency
$latencyPayload = @{
    name = "latency_chaos"
    type = "latency"
    stream = "downstream"
    toxicity = 1.0
    attributes = @{
        latency = 500
        jitter = 0
    }
} | ConvertTo-Json

Write-Host "`n[+] Injecting 500ms latency into Primary API..." -ForegroundColor DarkYellow
try {
    $res1 = Invoke-RestMethod -Uri $baseUrl -Method Post -Body $latencyPayload -ContentType "application/json"
    Write-Host "    -> 500ms latency active! (Exceeds 200ms context timeout)" -ForegroundColor Green
} catch {
    Write-Host "    -> Latency toxic might already exist: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. Inject 20% Packet Loss
$lossPayload = @{
    name = "loss_chaos"
    type = "loss"
    stream = "downstream"
    toxicity = 0.2
    attributes = @{}
} | ConvertTo-Json

Write-Host "`n[+] Injecting 20% packet drop rate into Primary API..." -ForegroundColor DarkYellow
try {
    $res2 = Invoke-RestMethod -Uri $baseUrl -Method Post -Body $lossPayload -ContentType "application/json"
    Write-Host "    -> 20% packet loss active!" -ForegroundColor Green
} catch {
    Write-Host "    -> Loss toxic might already exist: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " Hostile conditions active!                               " -ForegroundColor Red
Write-Host " - Primary latency: 500ms (Limit: 200ms)                  " -ForegroundColor White
Write-Host " - Primary packet drop: 20%                               " -ForegroundColor White
Write-Host " Observe Sentinel War Room at http://localhost:3000       " -ForegroundColor Yellow
Write-Host " Circuit will trip to OPEN and route 100% to Secondary.   " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
