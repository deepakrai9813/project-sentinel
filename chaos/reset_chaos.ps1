Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Project Sentinel - Healing Primary API                 " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:8474/proxies/primary_api/toxics"

Write-Host "`n[+] Removing latency toxic..." -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/latency_chaos" -Method Delete
    Write-Host "    -> Latency removed!" -ForegroundColor Green
} catch {
    Write-Host "    -> No active latency toxic found." -ForegroundColor DarkGray
}

Write-Host "`n[+] Removing packet loss toxic..." -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/loss_chaos" -Method Delete
    Write-Host "    -> Packet loss removed!" -ForegroundColor Green
} catch {
    Write-Host "    -> No active loss toxic found." -ForegroundColor DarkGray
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " Primary API Restored to Healthy State!                   " -ForegroundColor Green
Write-Host " Watch the Circuit Breaker transition:                   " -ForegroundColor Yellow
Write-Host " OPEN -> HALF-OPEN (Testing probe) -> CLOSED (Recovered) " -ForegroundColor Cyan
Write-Host " Dashboard: http://localhost:3000                        " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
