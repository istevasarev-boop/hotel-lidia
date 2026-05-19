@echo off
cd /d "C:\Users\test\Documents\Hotel software"
set "PATH=C:\Program Files\nodejs;%PATH%"
"C:\Program Files\nodejs\node.exe" "C:\Users\test\Documents\Hotel software\node_modules\next\dist\bin\next" dev
