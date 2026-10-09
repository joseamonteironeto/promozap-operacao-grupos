@echo off
setlocal
cd /d "%~dp0"
title Promozap - Coletor local Mercado Livre
node server.mjs
echo.
echo O coletor foi encerrado. Pressione qualquer tecla para fechar.
pause >nul

