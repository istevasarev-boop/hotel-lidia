$env:Path = 'C:\Program Files\nodejs;' + $env:Path
Set-Location 'C:\Users\test\Documents\Hotel software'
& 'C:\Program Files\nodejs\npm.cmd' run dev *> 'C:\Users\test\Documents\Hotel software\dev-server.log'
