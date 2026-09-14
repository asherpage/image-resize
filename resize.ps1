# Image Resizer - pure PowerShell/.NET version (no npm or Node.js required)
# Reads manifest.json (image URL + page it belongs to), downloads each image,
# re-compresses it toward ~300KB JPEG, and saves it to .\out\images with a
# descriptive filename. Also writes out\index.csv mapping each saved file to
# its page, in the same order as the source sheet.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
$outDir = Join-Path $root 'out\images'

# OneDrive-synced folders can be slow to materialize a brand-new nested
# directory (New-Item can report success without it actually existing yet).
# Retry, and fall back to cmd's mkdir, before giving up with a clear message.
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir -ErrorAction SilentlyContinue | Out-Null
}
if (-not (Test-Path $outDir)) {
    Start-Sleep -Milliseconds 500
    cmd /c mkdir "`"$outDir`"" 2>$null | Out-Null
}
if (-not (Test-Path $outDir)) {
    Write-Output "Could not create '$outDir'."
    Write-Output "Please create the folders manually (right-click this folder in VS Code's Explorer -> New Folder -> 'out', then inside that -> New Folder -> 'images'), then re-run this script."
    exit 1
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

$targetBytes = 300KB
$maxBytes = 340KB
$minWidth = 500

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }

function Compress-ToTarget {
    param([byte[]]$Bytes, [string]$DestPath)

    $inMs = New-Object System.IO.MemoryStream(,$Bytes)
    $img = [System.Drawing.Image]::FromStream($inMs)

    $origWidth = $img.Width
    $origHeight = $img.Height
    $width = $origWidth
    if ($width -gt 2000) { $width = 2000 }
    $quality = 85

    $lastGoodBytes = $null
    $lastAttemptBytes = $null

    for ($i = 0; $i -lt 40; $i++) {
        $height = [Math]::Max(1, [int][Math]::Round($origHeight * ($width / $origWidth)))
        $bmp = New-Object System.Drawing.Bitmap($width, $height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.Clear([System.Drawing.Color]::White)
        $g.DrawImage($img, 0, 0, $width, $height)
        $g.Dispose()

        $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$quality)

        $outMs = New-Object System.IO.MemoryStream
        $bmp.Save($outMs, $jpegCodec, $encParams)
        $bmp.Dispose()
        $currentBytes = $outMs.ToArray()
        $outMs.Dispose()
        $lastAttemptBytes = $currentBytes

        if ($currentBytes.Length -le $maxBytes) {
            $lastGoodBytes = $currentBytes
            if ($currentBytes.Length -le $targetBytes -or $quality -le 40) { break }
        }

        if ($quality -gt 40) {
            $quality -= 5
        } elseif ($width -gt $minWidth) {
            $width = [Math]::Max($minWidth, [int]($width * 0.85))
            $quality = 60
        } else {
            break
        }
    }

    $img.Dispose()
    $inMs.Dispose()

    $finalBytes = if ($lastGoodBytes) { $lastGoodBytes } else { $lastAttemptBytes }
    [System.IO.File]::WriteAllBytes($DestPath, $finalBytes)
    return $finalBytes.Length
}

$client = New-Object System.Net.WebClient
$client.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36')

$total = $manifest.Count
$ok = 0
$fail = 0
$i = 0
foreach ($item in $manifest) {
    $i++
    $dest = Join-Path $outDir $item.filename
    try {
        $bytes = $client.DownloadData($item.imageUrl)
        $newSize = Compress-ToTarget -Bytes $bytes -DestPath $dest
        $ok++
        Write-Output ("[{0}/{1}] OK    {2,6:N0} KB -> {3,4:N0} KB   {4}" -f $i, $total, [Math]::Round($bytes.Length/1KB), [Math]::Round($newSize/1KB), $item.filename)
    } catch {
        $fail++
        Write-Output ("[{0}/{1}] FAIL  {2}   {3}" -f $i, $total, $item.filename, $_.Exception.Message)
    }
}

$indexPath = Join-Path $root 'out\index.csv'
$manifest | Select-Object rowNum, filename, pageTitle, pageUrl, originalSize | Export-Csv -Path $indexPath -NoTypeInformation

Write-Output ""
Write-Output "Done. $ok resized, $fail failed."
Write-Output "Images:  $outDir"
Write-Output "Index:   $indexPath"
