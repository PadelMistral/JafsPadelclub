$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

$targets = @(
    @{ Path = Join-Path $root "node_modules\onesignal-cordova-plugin\plugin.xml"; From = 'com.onesignal:OneSignal:5.7.6'; To = 'com.onesignal:OneSignal:5.6.2' },
    @{ Path = Join-Path $root "node_modules\onesignal-cordova-plugin\plugin.xml"; From = 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.7.10'; To = 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.24' },
    @{ Path = Join-Path $root "android\app\capacitor.build.gradle"; From = 'com.onesignal:OneSignal:5.7.6'; To = 'com.onesignal:OneSignal:5.6.2' },
    @{ Path = Join-Path $root "android\app\capacitor.build.gradle"; From = 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.7.10'; To = 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.24' },
    @{ Path = Join-Path $root "android\capacitor-cordova-android-plugins\build.gradle"; From = 'com.onesignal:OneSignal:5.7.6'; To = 'com.onesignal:OneSignal:5.6.2' },
    @{ Path = Join-Path $root "android\capacitor-cordova-android-plugins\build.gradle"; From = 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.7.10'; To = 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.24' }
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
foreach ($target in $targets) {
    if (-not (Test-Path $target.Path)) { continue }
    $content = Get-Content -Raw -LiteralPath $target.Path
    if ($content.Contains($target.From)) {
        $content = $content.Replace($target.From, $target.To)
        [System.IO.File]::WriteAllText($target.Path, $content, $utf8NoBom)
        Write-Host "Patched $($target.Path)"
    }
}
