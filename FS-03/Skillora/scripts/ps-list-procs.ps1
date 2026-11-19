param([string]$Pattern = 'tsx|skillora')
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
foreach ($p in $procs) {
  if ($p.CommandLine -and $p.CommandLine -match $Pattern) {
    $cmd = $p.CommandLine
    if ($cmd.Length -gt 200) { $cmd = $cmd.Substring(0, 200) }
    Write-Output ("{0} :: {1}" -f $p.ProcessId, $cmd)
  }
}
if (-not $procs) { Write-Output "no node.exe processes" }