$ErrorActionPreference = 'Stop'
$assetRoot = Join-Path $PSScriptRoot 'dist\vendor'
New-Item -ItemType Directory -Force $assetRoot,(Join-Path $assetRoot 'core'),(Join-Path $assetRoot 'lang') | Out-Null
# Download only public open-source engine/model files; no image upload.
$downloads = @{
 'tesseract.min.js'='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js'
 'worker.min.js'='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js'
}
foreach ($name in @('tesseract-core','tesseract-core-simd','tesseract-core-lstm','tesseract-core-simd-lstm')) {
 foreach ($ext in @('.wasm.js','.wasm')) { $downloads["core\$name$ext"]="https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/$name$ext" }
}
foreach ($lang in @('eng','chi_sim','chi_tra')) { $downloads["lang\$lang.traineddata.gz"]="https://tessdata.projectnaptha.com/4.0.0/$lang.traineddata.gz" }
foreach ($item in $downloads.GetEnumerator()) { Write-Host "Downloading $($item.Key)"; Invoke-WebRequest -Uri $item.Value -OutFile (Join-Path $assetRoot $item.Key) }
'{"ready":true}' | Set-Content -Encoding utf8 (Join-Path $assetRoot 'ready.json')
Write-Host 'Ready. Start start.cmd. OCR now runs with local assets.'
