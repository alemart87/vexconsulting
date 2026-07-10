# VEX Consulting — arranque local (Windows)
# Uso: clic derecho > Ejecutar con PowerShell, o desde una terminal: .\start-local.ps1
# Abre dos ventanas: backend (FastAPI :8000) y frontend (Next.js :3000).

$root = $PSScriptRoot

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle = 'VEX backend :8000'; cd '$root\backend'; python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
)

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle = 'VEX frontend :3000'; cd '$root\frontend'; npx next dev -H 0.0.0.0 -p 3000"
)

Write-Host "VEX Consulting iniciando..."
Write-Host "  App:     http://localhost:3000"
Write-Host "  Backend: http://127.0.0.1:8000/health"
Write-Host "Para detener: cerra las dos ventanas de PowerShell."

