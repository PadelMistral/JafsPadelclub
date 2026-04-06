$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sourceRoot = Split-Path -Parent $root
$target = Join-Path $root "www"

if (Test-Path $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}

New-Item -ItemType Directory -Path $target | Out-Null

$includeDirs = @(
    "css",
    "js",
    "imagenes",
    "api"
)

$includeFiles = @(
    "index.html",
    "home.html",
    "admin.html",
    "calendario.html",
    "diario.html",
    "evento-detalle.html",
    "evento-sorteo.html",
    "eventos.html",
    "historial.html",
    "manifest.json",
    "mi-elo.html",
    "notificaciones.html",
    "offline.html",
    "palas.html",
    "pantalla-inicial.html",
    "perfil.html",
    "ranking.html",
    "ranking-v3.html",
    "puntosRanking.html",
    "recuperar.html",
    "registro.html",
    "sw.js",
    "OneSignalSDKWorker.js",
    "OneSignalSDKUpdaterWorker.js",
    "favicon.ico"
)

foreach ($dir in $includeDirs) {
    $src = Join-Path $sourceRoot $dir
    if (Test-Path $src) {
        Copy-Item -LiteralPath $src -Destination $target -Recurse -Force
    }
}

foreach ($file in $includeFiles) {
    $src = Join-Path $sourceRoot $file
    if (Test-Path $src) {
        Copy-Item -LiteralPath $src -Destination $target -Force
    }
}

Write-Host "Web copiada a $target"


