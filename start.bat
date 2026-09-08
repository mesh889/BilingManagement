@echo off
title Bill Management - Starting Servers...

echo ============================================
echo   Bill Management System - Server Launcher
echo ============================================
echo.

:: Kill any existing processes on ports 3000 and 4200
echo [1/4] Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4200 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1

:: Start Node.js API Server
echo [2/4] Starting Node.js API Server on port 3000...
cd /d "%~dp0server"
start "Node API Server - Port 3000" cmd /k "title Node API Server (Port 3000) && node index.js"

:: Wait for Node server to start
timeout /t 2 /nobreak >nul

:: Start Angular Dev Server
echo [3/4] Starting Angular Dev Server on port 4200...
cd /d "%~dp0"
start "Angular Dev Server - Port 4200" cmd /k "title Angular Dev Server (Port 4200) && npx ng serve --port 4200"

:: Wait for Angular to compile and open browser
echo [4/4] Waiting for Angular to compile...
echo.
echo   Node.js API  : http://localhost:3000/api/bills
echo   Angular App  : http://localhost:4200
echo.

:wait_loop
timeout /t 3 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://localhost:4200 | findstr "200" >nul 2>&1
if errorlevel 1 (
    echo   Still compiling... please wait...
    goto wait_loop
)

:: Open browser
echo   Opening browser...
start http://localhost:4200

echo.
echo ============================================
echo   Both servers are running!
echo   Close this window to keep them running.
echo   To stop: close the two server windows.
echo ============================================
pause
