# Lists a process's top-level windows; -Restore restores and focuses the "Postbell" window without touching the screen.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File window.ps1 -ProcId <pid> [-Restore]
param([int]$ProcId, [switch]$Restore)
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Pw {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static List<IntPtr> Of(uint pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
}
"@
foreach ($h in [Pw]::Of($ProcId)) {
  $t = New-Object System.Text.StringBuilder 256; [void][Pw]::GetWindowText($h, $t, 256)
  $c = New-Object System.Text.StringBuilder 256; [void][Pw]::GetClassName($h, $c, 256)
  "$h | $t | $c | visible=$([Pw]::IsWindowVisible($h)) iconic=$([Pw]::IsIconic($h))"
  if ($Restore -and $t.ToString() -eq "Postbell") {
    [void][Pw]::ShowWindow($h, 9); Start-Sleep -Milliseconds 200; [void][Pw]::SetForegroundWindow($h)
    "restored: $h iconic=$([Pw]::IsIconic($h))"
  }
}
