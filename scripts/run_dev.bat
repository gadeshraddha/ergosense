@echo off
REM ErgoSense: start backend + frontend (Windows).
REM Run from the project root in PowerShell:   .\scripts\run_dev.bat
setlocal
cd /d "%~dp0.."

echo.
echo === ErgoSense dev start ===

REM ---------- Backend (Python) ----------
if not exist "backend\.venv\Scripts\python.exe" (
  echo [1/4] Creating Python environment ^(first time only, uses Python 3.12^)...
  py -3.12 -m venv backend\.venv
  if errorlevel 1 (
    echo Could not find Python 3.12 via "py -3.12". Trying default "python"...
    python -m venv backend\.venv
    if errorlevel 1 (
      echo.
      echo ERROR: Python was not found. Install Python 3.12 from python.org ^(tick "Add python.exe to PATH"^) and run this again.
      exit /b 1
    )
  )
) else (
  echo [1/4] Python environment already exists.
)

echo [2/4] Installing backend packages ^(quick if already installed^)...
"backend\.venv\Scripts\python.exe" -m pip install -q -r backend\requirements.txt
if errorlevel 1 (
  echo ERROR: installing backend packages failed. Read the message above.
  exit /b 1
)

if not exist "backend\.env" (
  echo Creating backend\.env from the example...
  copy /y "backend\.env.example" "backend\.env" >nul
)

REM ---------- Frontend (Node) ----------
if not exist "frontend\node_modules" (
  echo [3/4] Installing frontend packages ^(first time only, takes a minute^)...
  pushd frontend
  call npm install
  popd
) else (
  echo [3/4] Frontend packages already installed.
)

echo [4/4] Starting both servers in their own windows...
start "ErgoSense Backend (port 8000)" cmd /k "cd /d %cd%\backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
start "ErgoSense Frontend (port 5173)" cmd /k "cd /d %cd%\frontend && npm run dev"

echo.
echo Opening http://localhost:5173 in a few seconds...
echo To stop: close the two black server windows.
timeout /t 8 /nobreak >nul
start "" http://localhost:5173
endlocal
