# Image Resizer

## Cross-platform, self-service: the `web/` app (deploy to Vercel)

A React app + two serverless functions in [`web/`](web/) — works on any OS
(Windows, Mac, phone) since it's just a webpage, and the fetching/resizing
happens server-side so there's no browser CORS issue. Paste a sheet link,
click Generate, see the gallery build in place; right-click any photo to
save it (each image is served with proper headers, so it saves as a real
`.jpg`, no `.jfif` issue).

**To deploy:**
1. Push this repo to GitHub.
2. On vercel.com, sign in with GitHub, "Add New → Project", import this repo.
3. In the import screen, set **Root Directory** to `web` (this repo has other
   tools at the top level, so the actual app lives in that subfolder).
4. Deploy. Vercel builds and hosts it at a URL like `your-project.vercel.app`
   — share that link with anyone.

Tested locally against both the ASU Alumni and Sun Devil Club sheets end to
end (real HTTP requests through the actual handler code) before being added
here.

**Worth knowing:** anyone with the deployed URL can point it at *any* public
Google Sheet in that Siteimprove export format — there's no login or
access restriction. Fine for sharing with a coworker; if this ever needs to
be locked down, that'd be a follow-up (e.g. a simple shared password).

## Easiest for a non-technical coworker: "Image Resizer.bat"

Double-click **`Image Resizer.bat`**. A small window opens - paste a Google
Sheet link, click **Generate**, and it opens the finished gallery in the
default browser automatically. No terminal, no command line, no code visible.
Share the whole folder (or just this `.bat` plus `GenerateGalleryGui.ps1`,
which it depends on) with anyone who needs to do this themselves. Each run's
output goes in its own timestamped folder under `out\` so results from
different sheets never overwrite each other.

## Command-line option: generate-gallery.ps1 (no installs needed)

Works with **any** Siteimprove "Images larger than 1 MB" Google Sheet export,
not just ASU Alumni's. Pure PowerShell + Windows' built-in image library - no
npm, no Node.js, nothing to install. Share this one file (plus it'll pull the
rest of what it needs) with anyone who has PowerShell (i.e. everyone on
Windows).

```
powershell -ExecutionPolicy Bypass -File .\generate-gallery.ps1 -SheetUrl "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit?gid=YOUR_GID#gid=YOUR_GID"
```

(Try plain `.\generate-gallery.ps1 -SheetUrl "..."` first - only fall back to
the `-ExecutionPolicy Bypass` form if you hit a "running scripts is disabled"
error.)

The sheet must be shared as "Anyone with the link can view". Output lands in
`.\out\`:
- `gallery.html` - a single self-contained web page with every resized image
  inlined, its page link, and its source-file link. Double-click to open it
  in any browser - no server, no upload, nothing else needed. Right-click any
  photo -> "Save Image As..." to grab it.
- `images\` - the same resized `.jpg` files individually, named after the
  page they belong to (e.g. `hailie-wilke-26-bs-row010.jpg`).

Optional parameters: `-TargetKB` / `-MaxKB` (default 300/340) to change the
target file size, `-OutDir` to change where output goes.

## Alternative: the Node.js app (ASU Alumni sheet only, needs npm)

Downloads the oversized-image rows from the ASU Alumni image-policy audit
Google Sheet, resizes each image to land around ~300KB (JPEG, quality/size
stepped down automatically), and produces `out/resized-images-report.xlsx`
with:

- the resized image embedded per row
- the page title(s) and page URL(s) the image appears on (from the sheet's
  expanded "Pages" data)
- the original image URL, original size, new size, and new dimensions

Rows are in the same order as they appear in the source sheet.

## Setup

```
npm install
```

## Run

```
npm start
```

Output goes to `out/resized-images-report.xlsx` (and the resized JPEGs live
in `out/images/`).

## Notes

- The sheet must be viewable by "anyone with the link" for the CSV export to
  work without authentication.
- To point at a different sheet/tab, edit `SHEET_ID` and `GID` at the top of
  `main.js`.
- To change the target file size, edit `TARGET_BYTES` / `MAX_BYTES` in
  `main.js`.
