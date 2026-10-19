# Creates tnc-sim.lnk in this folder: double-click it to start tnc-sim with no console window.
# Paths inside the profile are written as %USERPROFILE%\... so the shortcut survives moves within the profile.
$root = $PSScriptRoot
if ($root.StartsWith($env:USERPROFILE, [StringComparison]::OrdinalIgnoreCase)) {
    $root = '%USERPROFILE%' + $root.Substring($env:USERPROFILE.Length)
}
$l = (New-Object -ComObject WScript.Shell).CreateShortcut("$PSScriptRoot\tnc-sim.lnk")
$l.TargetPath = "$env:SystemRoot\explorer.exe"
$l.Arguments = 'index.html'
$l.WorkingDirectory = $root
$l.IconLocation = "$root\assets\tnc-sim.ico"
$l.Description = 'TNC 640 simulator (offline, in the browser)'
$l.Save()
