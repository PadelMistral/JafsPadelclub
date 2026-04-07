Write-Host "--- INICIANDO EMPAQUETADO PADELUMINATIS ---" -ForegroundColor Cyan

# 1. Sync web assets to mobile-capacitor/www
Write-Host "1/3 Sincronizando archivos web..." -ForegroundColor Yellow
cd mobile-capacitor
npm run sync:web

# 2. Sync with Capacitor
Write-Host "2/3 Ejecutando npx cap sync..." -ForegroundColor Yellow
npx cap sync

# 3. Final instructions
Write-Host ""
Write-Host "--- PROCESO COMPLETADO ---" -ForegroundColor Green
Write-Host "Ahora puedes:"
Write-Host "1. Subir los cambios a GitHub para que el Workflow cree la APK automáticamente."
Write-Host "2. O abrir Android Studio con: npm run android:open"
Write-Host ""
pause
