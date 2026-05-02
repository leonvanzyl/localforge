@echo off
setlocal

set "PORT=7777"

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run LocalForge.
  echo Install Node.js 20 or newer from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
if "%NODE_MAJOR%"=="" (
  echo Could not determine the installed Node.js version.
  pause
  exit /b 1
)

if %NODE_MAJOR% LSS 20 (
  echo LocalForge requires Node.js 20 or newer. Found %NODE_VERSION%.
  echo Install Node.js 20 or newer from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js 20 or newer from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  if exist "package-lock.json" (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Applying database migrations...
call npm run db:migrate
if errorlevel 1 (
  echo Database migration failed.
  pause
  exit /b 1
)

echo Checking port %PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = %PORT%; $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); foreach ($processId in $pids) { if ($processId -ne $PID) { Write-Host \"Stopping process $processId on port $port...\"; Stop-Process -Id $processId -Force -ErrorAction Stop } }"
if errorlevel 1 (
  echo Failed to free port %PORT%.
  pause
  exit /b 1
)

echo Starting LocalForge at http://localhost:%PORT%
call npm run dev
