@echo off
setlocal

REM ──────────────────────────────────────────────────────────────────────
REM  TrentCAD SolidWorks Add-in Build Script
REM  Builds and optionally registers the add-in without Visual Studio.
REM
REM  Prerequisites (one-time):
REM    1. Install .NET SDK (any modern version): https://dotnet.microsoft.com/download
REM    2. Install .NET Framework 4.8 Developer Pack:
REM       https://dotnet.microsoft.com/download/dotnet-framework/net48
REM    3. SolidWorks must be installed (for interop assemblies)
REM
REM  Usage:
REM    build.bat              Build only
REM    build.bat /register    Build + register COM add-in (requires Admin)
REM    build.bat /unregister  Unregister the COM add-in (requires Admin)
REM ──────────────────────────────────────────────────────────────────────

set PROJECT=TrentCAD.SolidWorksAddin\TrentCAD.SolidWorksAddin.csproj
set OUTPUT=%~dp0publish
set DLL=%OUTPUT%\TrentCAD.SolidWorksAddin.dll

if /i "%~1"=="/unregister" (
    echo Unregistering add-in...
    %windir%\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe /unregister "%DLL%"
    echo Done. Restart SolidWorks.
    exit /b %ERRORLEVEL%
)

echo Building TrentCAD SolidWorks Add-in...
dotnet publish "%~dp0%PROJECT%" -c Release -o "%OUTPUT%"
if %ERRORLEVEL% neq 0 (
    echo.
    echo Build failed. Make sure you have installed:
    echo   - .NET SDK: https://dotnet.microsoft.com/download
    echo   - .NET Framework 4.8 Developer Pack: https://dotnet.microsoft.com/download/dotnet-framework/net48
    exit /b 1
)

echo.
echo Build succeeded: %DLL%

if /i "%~1"=="/register" (
    echo.
    echo Registering COM add-in (requires Administrator)...
    %windir%\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe /codebase "%DLL%"
    if %ERRORLEVEL% neq 0 (
        echo.
        echo Registration failed. Right-click this script and "Run as Administrator".
        exit /b 1
    )
    echo.
    echo Registered successfully. Restart SolidWorks to load the add-in.
) else (
    echo.
    echo To register the add-in, run as Administrator:
    echo   build.bat /register
)
