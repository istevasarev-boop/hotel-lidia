@echo off
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
echo Starting Hotel Lidia for phone access...
echo.
echo Open on this computer:
echo   http://127.0.0.1:3000
echo.
echo Open on your phone, if it is on the same Wi-Fi/network:
echo   http://192.168.1.19:3000
echo.
npm run dev:phone
