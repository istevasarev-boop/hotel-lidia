@echo off
echo This must be run as Administrator.
echo It allows phones on your Wi-Fi/network to open Hotel Lidia on port 3000.
echo.
netsh advfirewall firewall add rule name="Hotel Lidia App Port 3000" dir=in action=allow protocol=TCP localport=3000
echo.
pause
