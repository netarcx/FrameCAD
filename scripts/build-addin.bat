@echo off
REM Build the SolidWorks add-in and place output in build/solidworks-addin/
REM for bundling into the Windows installer.

setlocal
set ROOT=%~dp0..
set OUTPUT=%ROOT%\build\solidworks-addin
set PROJECT=%ROOT%\solidworks-addin\FrameCAD.SolidWorksAddin\FrameCAD.SolidWorksAddin.csproj

echo Building SolidWorks add-in for installer...
if exist "%OUTPUT%" rmdir /s /q "%OUTPUT%"
dotnet publish "%PROJECT%" -c Release -o "%OUTPUT%"
if %ERRORLEVEL% neq 0 (
    echo Add-in build failed.
    exit /b 1
)
echo Add-in built to %OUTPUT%
