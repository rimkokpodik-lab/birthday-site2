#!/usr/bin/env bash
# Запуск сайта на macOS / Linux:  ./start.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установите его: https://nodejs.org"
  exit 1
fi
echo "Сайт запускается: http://localhost:3000"
node server.js
