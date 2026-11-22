"""Reads a Windows Credential Manager generic entry as a separate process of the same Windows user.

    python -I -X utf8 cred-read.py <target> <marker>

Prints whether the entry could be read, its size, and whether its secret contains <marker>; never the secret itself.
Used by vault-run.mjs to measure whether another program of the same user can read Postbell's vault entries.
"""

import ctypes
import sys
from ctypes import wintypes

CRED_TYPE_GENERIC = 1


class CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", wintypes.FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


def main() -> int:
    target, marker = sys.argv[1], sys.argv[2]
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    advapi.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
    advapi.CredReadW.restype = wintypes.BOOL
    advapi.CredFree.argtypes = [ctypes.c_void_p]
    p = ctypes.POINTER(CREDENTIAL)()
    if not advapi.CredReadW(target, CRED_TYPE_GENERIC, 0, ctypes.byref(p)):
        print(f"unreadable: error {ctypes.get_last_error()}")
        return 1
    try:
        c = p.contents
        blob = bytes(c.CredentialBlob[: c.CredentialBlobSize])
        persist = {1: "Session", 2: "Local", 3: "Enterprise"}.get(c.Persist, str(c.Persist))
        print(f"readable: {len(blob)} bytes, persist {persist}, contains the marker: {'yes' if marker.encode('utf-8') in blob else 'no'}")
    finally:
        advapi.CredFree(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
