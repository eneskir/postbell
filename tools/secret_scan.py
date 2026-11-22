"""Scans every tracked file for secrets, credential files and personal data.

Commits are scanned locally before they are made; this is the second gate in CI,
because a commit made elsewhere (the web editor, a machine without the hook) skips
the local scan. Every tracked file that reads as UTF-8 is scanned, whatever its
extension; scanning zero files fails too: "clean" over nothing proves nothing.

Exit code: 0 clean, 1 findings, 2 nothing to scan or git could not be read.
"""

import re
import subprocess
import sys
from pathlib import Path

PATTERNS = {
    "private-key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "github-token": re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b"),
    "aws-key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "google-key": re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"),
    "slack-token": re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}\b"),
    "openai-style-key": re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}\b"),
    "cloudflare-token-assignment": re.compile(r"(?i)cloudflare_api_token\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{30,}"),
    "quoted-password": re.compile(r"(?i)\b(?:password|passwd|parola|sifre|şifre)\s*[:=]\s*['\"][^'\"]{4,}['\"]"),
    # Bounded by word characters so a run of digits inside a hex checksum does not match.
    "tr-phone": re.compile(r"(?<!\w)(?:\+90|0)\s?5\d{2}\s?\d{3}\s?\d{2}\s?\d{2}(?!\w)"),
    # An image name such as logo@2x.png has the shape of an address; a file extension is never its domain ending.
    "email": re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.(?!(?:png|jpe?g|webp|gif|svg|avif|ico)\b)[A-Za-z]{2,}\b"),
    # A path into a Windows user folder carries the account name and the layout of the
    # machine. Written as C:\Users\, C:\\Users\\ (escaped), C:/Users/, or the Git Bash,
    # WSL and Cygwin forms /c/Users/, /mnt/c/Users/, /cygdrive/c/Users/. Other drive paths
    # are left alone: made-up ones such as C:/x.json are common in test data.
    "local-user-path": re.compile(
        r"(?i)(?<![A-Za-z0-9])[A-Z]:(?:\\+|/)Users(?:\\+|/)"
        r"|(?<![\w.\-])/(?:mnt/|cygdrive/)?[A-Z]/Users/"
    ),
    # The maintainer's working folders: their layout is private and means nothing to anyone else.
    "local-work-path": re.compile(r"(?i)(?<![A-Za-z0-9])[CD]:(?:\\+|/)Claude(?:\\+|/)"),
}

# Addresses published on purpose. A personal address never goes here.
ALLOWED_EMAIL = re.compile(r"@users\.noreply\.github\.com$|^noreply@anthropic\.com$|@example\.com$")
# Third-party license texts and lock files carry their authors' addresses, which a license requires to keep.
THIRD_PARTY = re.compile(
    r"(^|/)(package-lock\.json|Cargo\.lock|THIRD_PARTY_NOTICES\.md|OFL\.txt)$|^apps/desktop/tools/licenses/[^/]+\.txt$"
)

CREDENTIAL_NAMES = re.compile(
    r"(?i)(^|/)(\.env(\..*)?|\.dev\.vars|\.npmrc|\.git-credentials|\.?credentials\.json|key\.properties|id_(rsa|dsa|ecdsa|ed25519))$"
    r"|(^|/)[^/]*(service-account|firebase-adminsdk)[^/]*\.json$"
    r"|\.(pem|p12|key|jks|keystore)$"
)
# A .env.d.ts file only declares the variable types.
ENV_EXAMPLES = re.compile(r"(?i)(^|/)\.env\.(example|sample|template|d\.ts)$")
# The scan and its tests hold the patterns and fake samples on purpose.
SELF = {"tools/secret_scan.py", "tools/test_secret_scan.py"}


def tracked_files(root: Path) -> list[str]:
    out = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], capture_output=True, check=True)
    return [p for p in out.stdout.decode("utf-8").split("\0") if p]


def is_credential_file(rel: str) -> bool:
    return bool(CREDENTIAL_NAMES.search(rel)) and not ENV_EXAMPLES.search(rel)


def scan_text(rel: str, text: str) -> list[tuple[str, int, str]]:
    findings = []
    for lineno, line in enumerate(text.splitlines(), 1):
        for name, pattern in PATTERNS.items():
            for match in pattern.finditer(line):
                if name == "email" and (ALLOWED_EMAIL.search(match.group(0)) or THIRD_PARTY.search(rel)):
                    continue
                findings.append((rel, lineno, name))
    return findings


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    try:
        files = tracked_files(root)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"ERROR: could not list tracked files ({exc})")
        return 2
    if not files:
        print("ERROR: no tracked files to scan")
        return 2

    findings = []
    scanned = skipped = 0
    for rel in files:
        if is_credential_file(rel):
            findings.append((rel, 0, "credential-file"))
            continue
        if rel in SELF:
            continue
        try:
            raw = (root / rel).read_bytes()
            text = raw.decode("utf-8")
        except (UnicodeDecodeError, OSError):
            skipped += 1
            continue
        if "\0" in text:
            skipped += 1
            continue
        scanned += 1
        findings += scan_text(rel, text)

    if scanned == 0:
        print(f"ERROR: none of the {len(files)} tracked files could be read as text")
        return 2
    for rel, lineno, name in findings:
        print(f"FOUND {name}: {rel}:{lineno}")
    print(f"text files scanned: {scanned} / binary or unreadable, skipped: {skipped} / tracked: {len(files)} / findings: {len(findings)}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
