@echo off
chcp 65001 >nul
title Сайт приёма дат рождения
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js не найден!
  echo   Скачайте и установите его с сайта: https://nodejs.org
  echo   После установки запустите этот файл ещё раз.
  echo.
  pause
  exit /b 1
)

echo.
echo   Запускаю сайт... Через пару секунд откроется браузер.
echo   Кабинет преподавателя: http://localhost:3000/admin
echo   Чтобы остановить сайт — закройте это окно.
echo.

start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000/admin"
node server.js
pause
