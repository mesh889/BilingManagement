@echo off

set "PATH=C:\Program Files\nodejs;C:\Users\vishw\AppData\Roaming\npm;%PATH%"
set "PM2_HOME=C:\Users\vishw\.pm2"

cd /d "C:\Users\vishw\OneDrive\Desktop\BilingManagement"

"C:\Users\vishw\AppData\Roaming\npm\pm2.cmd" resurrect

exit /b 0