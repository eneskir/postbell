# Samples idle CPU and private memory of a process and its children (WebView2) into a semicolon file; perf-run.py runs it.
param([int]$Kok, [string]$Cikti, [int]$Sure = 600, [int]$Aralik = 10)
$cores = [Environment]::ProcessorCount
function Agac {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = New-Object System.Collections.Generic.List[int]; $ids.Add($Kok)
  do { $changed = $false
    foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId); $changed = $true } }
  } while ($changed)
  $ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
}
$rows = @("time;processes;cpu_percent;private_mb;working_set_mb")
$p0 = Agac; $cpu0 = ($p0 | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum; $t0 = Get-Date
$start = $t0
while (((Get-Date) - $start).TotalSeconds -lt $Sure) {
  Start-Sleep -Seconds $Aralik
  $ps = Agac
  if (-not ($ps | Where-Object Id -eq $Kok)) { $rows += "root process gone: $(Get-Date -Format HH:mm:ss)"; break }
  $cpu = ($ps | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum; $t = Get-Date
  $pct = 100 * ($cpu - $cpu0) / (($t - $t0).TotalSeconds * $cores)
  $priv = ($ps | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB
  $ws = ($ps | Measure-Object WorkingSet64 -Sum).Sum / 1MB
  $rows += [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0};{1};{2:F3};{3:F1};{4:F1}", $t.ToString("HH:mm:ss"), $ps.Count, $pct, $priv, $ws)
  $cpu0 = $cpu; $t0 = $t
}
$rows | Set-Content -Encoding utf8 $Cikti
