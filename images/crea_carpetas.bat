@echo off
for /l %%i in (1,1,300) do (
    mkdir "%%i"
)
echo Folders 1 to 300 created.
pause