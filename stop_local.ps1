Write-Host "Stopping local Project Sentinel services..." -ForegroundColor Yellow

# Kill running processes on ports 8080, 8081, 8082, 3000
Get-NetTCPConnection -LocalPort 8080, 8081, 8082, 3000 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}

Write-Host "All Project Sentinel local services stopped." -ForegroundColor Green
