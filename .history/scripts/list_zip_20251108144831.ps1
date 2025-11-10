param(
    [string]$zipPath
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    foreach ($e in $zip.Entries) { Write-Output $e.FullName }
} finally {
    $zip.Dispose()
}
