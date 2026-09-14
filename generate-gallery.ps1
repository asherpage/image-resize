<#
.SYNOPSIS
  Turns a Siteimprove "oversized images" Google Sheet export into a single
  self-contained HTML gallery of resized (~300KB) images, each linked to the
  page it belongs to.

.DESCRIPTION
  Point this at ANY Google Sheet that was exported the way Siteimprove's
  "Images larger than 1 MB" policy report is (URL / Size / Pages / Referring
  PDFs / Match detected / Details columns, with an expanded Page sub-table
  under each image row). No npm, no Node.js, no Claude required to run it -
  just PowerShell and Windows' built-in image library.

.PARAMETER SheetUrl
  The full Google Sheets URL you'd copy from the address bar, e.g.
  https://docs.google.com/spreadsheets/d/XXXXXXXX/edit?gid=123456789#gid=123456789
  The sheet must be shared as "Anyone with the link can view".

.PARAMETER OutDir
  Where to write the gallery and resized images. Defaults to .\out next to
  this script.

.EXAMPLE
  .\generate-gallery.ps1 -SheetUrl "https://docs.google.com/spreadsheets/d/18qq7Dnm4qkE9fr8YWZaMYFR8KpjYX2niIlJECoSJ_QY/edit?gid=638764626#gid=638764626"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$SheetUrl,

    [string]$OutDir,

    [int]$TargetKB = 300,
    [int]$MaxKB = 340
)

$ErrorActionPreference = 'Stop'

$ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { Get-Location }
if (-not $OutDir) { $OutDir = Join-Path $ScriptRoot 'out' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

$targetBytes = $TargetKB * 1KB
$maxBytes = $MaxKB * 1KB
$minWidth = 500

# ---------------------------------------------------------------------------
# 1. Parse the sheet URL and fetch the CSV export
# ---------------------------------------------------------------------------
if ($SheetUrl -notmatch '/d/([a-zA-Z0-9_-]+)') {
    throw "Could not find a sheet ID in that URL. Paste the full URL from your browser's address bar."
}
$sheetId = $Matches[1]
$gid = '0'
if ($SheetUrl -match 'gid=(\d+)') { $gid = $Matches[1] }

$csvUrl = "https://docs.google.com/spreadsheets/d/$sheetId/export?format=csv&gid=$gid"
Write-Output "Fetching sheet CSV..."
$client = New-Object System.Net.WebClient
$client.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36')
try {
    $csvBytes = $client.DownloadData($csvUrl)
} catch {
    throw "Could not download the sheet. Make sure it's shared as 'Anyone with the link can view'. Details: $($_.Exception.Message)"
}
$csvText = [System.Text.Encoding]::UTF8.GetString($csvBytes)

# ---------------------------------------------------------------------------
# 2. Parse the CSV (handles quoted fields with embedded commas properly)
# ---------------------------------------------------------------------------
$reader = New-Object System.IO.StringReader($csvText)
$parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($reader)
$parser.SetDelimiters(",")
$parser.HasFieldsEnclosedInQuotes = $true
$rows = New-Object System.Collections.Generic.List[object]
while (-not $parser.EndOfData) {
    $rows.Add($parser.ReadFields())
}
$parser.Close()

$siteName = $null
$policyName = $null
foreach ($r in $rows) {
    if ($r[0] -like 'Site:*') { $siteName = $r[0].Substring(5).Trim() }
    if ($r[0] -like 'Policy:*') { $policyName = $r[0].Substring(7).Trim() }
}

$headerIdx = -1
for ($i = 0; $i -lt $rows.Count; $i++) {
    if ($rows[$i][0] -eq 'URL' -and $rows[$i][1] -eq 'Size') { $headerIdx = $i; break }
}
if ($headerIdx -eq -1) {
    throw "This doesn't look like a Siteimprove 'oversized images' export (no URL/Size header row found). Generate this script's expected sheet from Siteimprove's Policy > Images report."
}

$items = New-Object System.Collections.Generic.List[object]
$i = $headerIdx + 1
while ($i -lt $rows.Count) {
    $row = $rows[$i]
    $url = $row[0]
    if ($url -and $url.StartsWith('http')) {
        $size = $row[1]
        $pageCount = 0
        [void][int]::TryParse($row[2], [ref]$pageCount)
        $i++
        $pages = New-Object System.Collections.Generic.List[object]
        if ($pageCount -gt 0 -and $i -lt $rows.Count) {
            $i++ # skip the "Title / URL / Page Report / Page level" sub-header row
            for ($p = 0; $p -lt $pageCount -and $i -lt $rows.Count; $p++) {
                $sub = $rows[$i]
                $title = $sub[6]
                $pageUrl = $sub[7]
                if ($title -or $pageUrl) { $pages.Add([PSCustomObject]@{ title = $title; url = $pageUrl }) }
                $i++
            }
        }
        $items.Add([PSCustomObject]@{ imageUrl = $url; originalSize = $size; pages = $pages })
    } else {
        $i++
    }
}
Write-Output "Parsed $($items.Count) image entries."
if ($items.Count -eq 0) {
    throw "No image rows found. Check that the sheet link points at the right tab (gid) and that it's the Siteimprove oversized-images export."
}

# ---------------------------------------------------------------------------
# 3. Resize helper (JPEG, stepping quality then dimensions down to target)
# ---------------------------------------------------------------------------
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }

function Compress-ToTarget {
    param([byte[]]$Bytes)

    $inMs = New-Object System.IO.MemoryStream(,$Bytes)
    $img = [System.Drawing.Image]::FromStream($inMs)

    $origWidth = $img.Width
    $origHeight = $img.Height
    $width = $origWidth
    if ($width -gt 2000) { $width = 2000 }
    $quality = 85

    $lastGoodBytes = $null
    $lastAttemptBytes = $null

    for ($n = 0; $n -lt 40; $n++) {
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
    if ($lastGoodBytes) { return $lastGoodBytes } else { return $lastAttemptBytes }
}

function Get-PageSlug {
    param($Item, [int]$RowNum)
    $title = if ($Item.pages.Count -gt 0 -and $Item.pages[0].title) { $Item.pages[0].title } else { 'unknown-page' }
    $slug = $title.ToLower()
    $slug = $slug -replace '\s*\|\s*[^|]*$', ''   # drop a trailing " | Site Name" segment, if present
    $slug = $slug -replace '[^a-z0-9]+', '-'
    $slug = $slug.Trim('-')
    if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40) }
    if (-not $slug) { $slug = 'unknown-page' }
    return "$slug-row{0:D3}" -f $RowNum
}

function HtmlEscape {
    param([string]$Text)
    if (-not $Text) { return '' }
    return [System.Web.HttpUtility]::HtmlEncode($Text)
}
Add-Type -AssemblyName System.Web

# ---------------------------------------------------------------------------
# 4. Download + resize every image
# ---------------------------------------------------------------------------
# Some OneDrive-synced folders (seen on managed/corporate machines) refuse to
# take brand-new subfolders/files at all - and it can look like it worked
# (CreateDirectory succeeds, Test-Path says true) while actually writing a
# file into it still fails. So actually probe with a real file write rather
# than trusting Test-Path, and fall back to the user's Temp folder if it fails.
function Test-DirectoryWritable {
    param([string]$Path)
    try {
        [System.IO.Directory]::CreateDirectory($Path) | Out-Null
        $probe = Join-Path $Path ".write-test-$([guid]::NewGuid().ToString('N')).tmp"
        [System.IO.File]::WriteAllBytes($probe, [byte[]]@(1))
        Remove-Item $probe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

$preferredImgDir = Join-Path $OutDir 'images'
$fallbackImgDir = Join-Path $env:TEMP "ImageResizerGallery\$(Split-Path -Leaf $OutDir)\images"
if (Test-DirectoryWritable $preferredImgDir) {
    $imgDir = $preferredImgDir
} else {
    Write-Output "Couldn't write into '$preferredImgDir' (likely OneDrive-restricted) - using $fallbackImgDir instead."
    if (-not (Test-DirectoryWritable $fallbackImgDir)) {
        throw "Could not create a writable output folder in either location. Try running this script from a local (non-OneDrive) folder."
    }
    $imgDir = $fallbackImgDir
    $OutDir = Split-Path -Parent $imgDir
}

$total = $items.Count
$rowNum = 0
$results = New-Object System.Collections.Generic.List[object]
foreach ($item in $items) {
    $rowNum++
    $slug = Get-PageSlug -Item $item -RowNum $rowNum
    $filename = "$slug.jpg"
    $destPath = Join-Path $imgDir $filename
    try {
        $bytes = $client.DownloadData($item.imageUrl)
        $resized = Compress-ToTarget -Bytes $bytes
        [System.IO.File]::WriteAllBytes($destPath, $resized)
        Write-Output ("[{0}/{1}] OK    {2,6:N0} KB -> {3,4:N0} KB   {4}" -f $rowNum, $total, [Math]::Round($bytes.Length / 1KB), [Math]::Round($resized.Length / 1KB), $filename)
        $results.Add([PSCustomObject]@{ rowNum = $rowNum; status = 'ok'; imageUrl = $item.imageUrl; originalSize = $item.originalSize; pages = $item.pages; filename = $filename; localPath = $destPath; newBytes = $resized.Length })
    } catch {
        Write-Output ("[{0}/{1}] FAIL  {2}   {3}" -f $rowNum, $total, $item.imageUrl, $_.Exception.Message)
        $results.Add([PSCustomObject]@{ rowNum = $rowNum; status = 'error'; imageUrl = $item.imageUrl; originalSize = $item.originalSize; pages = $item.pages; filename = $null; localPath = $null; newBytes = 0 })
    }
}

$okCount = ($results | Where-Object { $_.status -eq 'ok' }).Count
Write-Output ""
Write-Output "Resized $okCount of $total images."

# ---------------------------------------------------------------------------
# 5. Build the HTML gallery (single self-contained file, images inlined)
# ---------------------------------------------------------------------------
Write-Output "Building gallery.html..."

function Parse-SizeToKB {
    param([string]$Size)
    if (-not $Size) { return 0 }
    if ($Size -match '([\d.]+)\s*MB') { return [double]$Matches[1] * 1024 }
    if ($Size -match '([\d.]+)\s*KB') { return [double]$Matches[1] }
    return 0
}

$sb = New-Object System.Text.StringBuilder
foreach ($r in $results) {
    $pageLinks = if ($r.pages.Count -gt 0) {
        ($r.pages | ForEach-Object {
            $t = if ($_.title) { $_.title } else { $_.url }
            "<a href=`"$(HtmlEscape $_.url)`" target=`"_blank`" rel=`"noopener`">$(HtmlEscape $t)</a>"
        }) -join '<br>'
    } else {
        '<span class="muted">No page match recorded</span>'
    }

    $imgTag = '<div class="broken">image unavailable</div>'
    if ($r.status -eq 'ok') {
        $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($r.localPath))
        $imgTag = "<img id=`"img-$($r.rowNum)`" data-b64=`"$b64`" alt=`"Resized image for row $($r.rowNum)`" loading=`"lazy`">"
    }

    $origKB = [Math]::Round((Parse-SizeToKB $r.originalSize))
    $newKB = if ($r.status -eq 'ok') { [Math]::Round($r.newBytes / 1KB) } else { $null }
    $pct = if ($origKB -gt 0 -and $newKB) { [Math]::Round((1 - ($newKB / $origKB)) * 100) } else { $null }
    $pctHtml = if ($null -ne $pct) { "<span class=`"pct`">-$pct%</span>" } else { '' }
    $newSizeText = if ($newKB) { "$newKB KB" } else { '&mdash;' }

    $fileHint = if ($r.filename) { "<span class=`"filename`">save as $(HtmlEscape $r.filename)</span>" } else { '' }

    [void]$sb.AppendLine(@"
      <article class="card">
        <div class="thumb">$imgTag</div>
        <div class="meta">
          <div class="rownum">#$($r.rowNum) $fileHint</div>
          <div class="sizes">
            <span class="size-orig">$(HtmlEscape $r.originalSize)</span>
            <span class="arrow">&rarr;</span>
            <span class="size-new">$newSizeText</span>
            $pctHtml
          </div>
          <div class="field">
            <span class="label">Page</span>
            <div class="value">$pageLinks</div>
          </div>
          <div class="field">
            <span class="label">Source image</span>
            <div class="value"><a href="$(HtmlEscape $r.imageUrl)" target="_blank" rel="noopener" class="srclink">$(HtmlEscape ([uri]$r.imageUrl).Segments[-1])</a></div>
          </div>
        </div>
      </article>
"@)
}
$cardsHtml = $sb.ToString()

$eyebrow = if ($siteName) { HtmlEscape $siteName } else { 'Image Policy Audit' }
$policyText = if ($policyName) { HtmlEscape $policyName } else { 'Images larger than 1 MB' }

$html = @"
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Resized Images - $eyebrow</title>
<style>
  :root {
    --bg: #faf8f6; --surface: #ffffff; --ink: #211a1d; --muted: #766c70;
    --border: #e9e2df; --accent: #8c1d40; --accent-soft: #f5e6ea;
    --good: #2e7d46; --good-soft: #e7f3ea;
    --shadow: 0 1px 2px rgba(33,26,29,0.06), 0 8px 24px rgba(33,26,29,0.05);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #171214; --surface: #221b1e; --ink: #f2ecee; --muted: #b3a7ab;
      --border: #3a2e32; --accent: #e8a3b8; --accent-soft: #3a232c;
      --good: #7fd99a; --good-soft: #1f3324;
      --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.35);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: var(--accent); }
  header { max-width: 1180px; margin: 0 auto; padding: 48px 24px 28px; }
  .eyebrow { font-family: Consolas, "SFMono-Regular", monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin: 0 0 10px; }
  h1 { font-weight: 700; font-size: clamp(28px, 4vw, 40px); line-height: 1.1; margin: 0 0 14px; }
  .lede { color: var(--muted); font-size: 15px; line-height: 1.6; max-width: 62ch; margin: 0 0 22px; }
  .lede strong { color: var(--ink); }
  .statbar { display: flex; flex-wrap: wrap; gap: 10px; font-family: Consolas, monospace; font-size: 13px; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; display: flex; gap: 8px; align-items: baseline; }
  .stat b { font-size: 15px; }
  .stat .good { color: var(--good); }
  main { max-width: 1180px; margin: 0 auto; padding: 8px 24px 64px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); display: flex; flex-direction: column; }
  .thumb { background: repeating-conic-gradient(var(--bg) 0% 25%, var(--surface) 0% 50%) 0 0 / 20px 20px; aspect-ratio: 16 / 10; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid var(--border); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .broken { color: var(--muted); font-size: 13px; font-family: Consolas, monospace; }
  .meta { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
  .rownum { font-family: Consolas, monospace; font-size: 11px; color: var(--muted); letter-spacing: 0.04em; display: flex; justify-content: space-between; gap: 8px; }
  .filename { color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sizes { display: flex; align-items: baseline; gap: 7px; font-family: Consolas, monospace; font-size: 13px; }
  .size-orig { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--border); }
  .arrow { color: var(--muted); }
  .size-new { color: var(--ink); font-weight: 500; }
  .pct { margin-left: auto; background: var(--good-soft); color: var(--good); border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 500; }
  .field { font-size: 13px; }
  .label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 3px; }
  .value { line-height: 1.45; word-break: break-word; }
  .value a { text-decoration: none; }
  .value a:hover { text-decoration: underline; }
  .srclink { font-family: Consolas, monospace; font-size: 12px; color: var(--muted); }
  .srclink:hover { color: var(--accent); }
  .muted { color: var(--muted); }
  .howto { max-width: 1180px; margin: 0 auto; padding: 0 24px 40px; }
  .howto .box { background: var(--accent-soft); border: 1px solid var(--border); border-radius: 10px; padding: 14px 18px; font-size: 13px; color: var(--ink); line-height: 1.6; }
  .howto b { color: var(--accent); }
  footer { max-width: 1180px; margin: 0 auto; padding: 0 24px 48px; font-family: Consolas, monospace; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<header>
  <p class="eyebrow">$eyebrow &middot; Image Policy Audit</p>
  <h1>Resized images, ready to save</h1>
  <p class="lede">Every image below violated the site's <strong>$policyText</strong> policy. Each one has been re-compressed to roughly <strong>$TargetKB&nbsp;KB</strong> and is shown at full resolution &mdash; right-click any photo and choose <strong>Save Image As&hellip;</strong> to download it.</p>
  <div class="statbar">
    <span class="stat">Resized <b>$okCount</b> of <b>$total</b></span>
  </div>
</header>
<div class="howto">
  <div class="box"><b>To download:</b> right-click (or press-and-hold on touch) any photo below and choose "Save Image As&hellip;". The "Source image" link opens the original oversized file; the "Page" link opens the live page it appears on.</div>
</div>
<main>
  <div class="grid">
$cardsHtml
  </div>
</main>
<footer>Generated locally by generate-gallery.ps1 from a Siteimprove "$policyText" export.</footer>
<script>
  document.querySelectorAll('img[data-b64]').forEach(function (img) {
    try {
      var b64 = img.getAttribute('data-b64');
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var blob = new Blob([bytes], { type: 'image/jpeg' });
      img.src = URL.createObjectURL(blob);
      img.removeAttribute('data-b64');
    } catch (e) { console.error('Failed to hydrate image', img.id, e); }
  });
</script>
</body>
</html>
"@

$galleryPath = Join-Path $OutDir 'gallery.html'
[System.IO.File]::WriteAllText($galleryPath, $html, [System.Text.Encoding]::UTF8)

Write-Output ""
Write-Output "Done."
Write-Output "Gallery: $galleryPath"
Write-Output "Images:  $imgDir"
Write-Output ""
Write-Output "Open gallery.html in any browser (double-click it) to view and save the images."
