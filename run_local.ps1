Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Project Sentinel - Starting Local Development Stack     " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

$env:Path += ";$env:USERPROFILE\go\bin"

# 1. Start Primary Mock API (Port 8081)
Write-Host "[+] Launching Primary Mock API on :8081..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Primary API :8081'; cd '$PSScriptRoot\backend'; `$env:Path += ';$env:USERPROFILE\go\bin'; `$env:PORT='8081'; go run ./cmd/primary-mock"

# 2. Start Secondary Fallback API (Port 8082)
Write-Host "[+] Launching Secondary Mock API on :8082..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Secondary API :8082'; cd '$PSScriptRoot\backend'; `$env:Path += ';$env:USERPROFILE\go\bin'; `$env:PORT='8082'; go run ./cmd/secondary-mock"

Start-Sleep -Seconds 2

# 3. Start Sentinel Multiplexer Proxy (Port 8080)
Write-Host "[+] Launching Sentinel Reverse Proxy on :8080..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Sentinel Proxy :8080'; cd '$PSScriptRoot\backend'; `$env:Path += ';$env:USERPROFILE\go\bin'; `$env:PORT='8080'; `$env:PRIMARY_URL='http://localhost:8081'; `$env:SECONDARY_URL='http://localhost:8082'; go run ./cmd/sentinel"

Start-Sleep -Seconds 1

# 4. Start React "War Room" Dashboard (Port 3000)
Write-Host "[+] Launching React War Room Dashboard on :3000..." -ForegroundColor Magenta
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='React War Room :3000'; cd '$PSScriptRoot\frontend'; npm run dev"

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  All services launched successfully!                     " -ForegroundColor Green
Write-Host "  Dashboard: http://localhost:3000                        " -ForegroundColor Yellow
Write-Host "  Sentinel:  http://localhost:8080                        " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
