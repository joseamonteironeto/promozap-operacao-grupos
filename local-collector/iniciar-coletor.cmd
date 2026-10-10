@echo off
setlocal
cd /d "%~dp0"
title Promozap - Coletor local Mercado Livre

set "NODE_EXE="
where node.exe >nul 2>nul && set "NODE_EXE=node.exe"

if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo.
  echo ERRO: O Node.js nao foi encontrado neste computador.
  echo.
  echo Instale a versao LTS em https://nodejs.org/ e abra este arquivo novamente.
  echo Nenhum cookie ou configuracao foi alterado.
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" check-running.mjs >nul 2>nul
if not errorlevel 1 (
  echo.
  echo O coletor Promozap ja esta ligado.
  echo Abrindo o painel local no navegador...
  start "" "http://127.0.0.1:8765"
  timeout /t 2 /nobreak >nul
  exit /b 0
)

echo Iniciando o coletor Promozap...
"%NODE_EXE%" server.mjs
echo.
echo O coletor foi encerrado. Pressione qualquer tecla para fechar.
pause >nul

