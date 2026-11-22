"""Tests for secret_scan.py: `python3 -m unittest discover -s tools`.

The scan skips this file, which holds fake samples on purpose.
"""

import unittest

from secret_scan import is_credential_file, scan_text

AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP"
GITHUB = "gh" + "p_" + "a" * 36
KEY_HEADER = "-----BEGIN " + "PRIVATE KEY-----"
PERSONAL = "someone" + "@" + "gmail.com"


def names(rel, text):
    return [name for _, _, name in scan_text(rel, text)]


class SecretScan(unittest.TestCase):
    def test_a_key_in_any_source_file_is_found(self):
        self.assertEqual(names("apps/desktop/src-tauri/src/x.rs", f'const K: &str = "{AWS}";'), ["aws-key"])
        self.assertEqual(names("apps/desktop/src/ui/x.tsx", f'const t = "{GITHUB}";'), ["github-token"])
        self.assertEqual(names("contracts/x.json", KEY_HEADER), ["private-key"])

    def test_local_paths_are_found_in_every_spelling(self):
        bs = chr(92)
        for line in ["C:/Users/someone/x", f"C:{bs}Users{bs}someone", f"C:{bs}{bs}Users{bs}{bs}x", "/c/Users/x", "/mnt/c/Users/x",
                     "D:/Claude/Social/x", f"C:{bs}Claude{bs}x"]:
            self.assertTrue(names("a.md", line), line)
        self.assertEqual(names("a.ts", 'folder: "D:/content/brand", "C:/x.json"'), [])

    def test_emails_allowed_only_where_published_on_purpose(self):
        self.assertEqual(names("a.md", "name@example.com, noreply@anthropic.com"), [])
        self.assertEqual(names("a.md", PERSONAL), ["email"])
        self.assertEqual(names("apps/desktop/tools/licenses/x-1.0.0.txt", PERSONAL), [])
        self.assertEqual(names("apps/desktop/src-tauri/Cargo.lock", PERSONAL), [])
        self.assertEqual(names("a.md", "icon@2x.png logo@3x.webp photo@2x.jpg"), [])

    def test_a_phone_number_but_not_digits_inside_a_checksum(self):
        self.assertEqual(names("a.md", "call 0532 123 45 67"), ["tr-phone"])
        self.assertEqual(names("Cargo.lock", 'checksum = "7421438de105a0827e44fadd05377727847d"'), [])

    def test_credential_files_are_found_by_name(self):
        for rel in [".env", "apps/site/.env", ".env.local", "x.pem", ".dev.vars", "keys/a.p12", ".npmrc",
                    "credentials.json", "app/firebase-adminsdk-abc12.json", "ci/deploy-service-account.json",
                    ".ENV", "id_rsa", "home/.ssh/id_ed25519", "id_ecdsa", "android/key.properties",
                    ".git-credentials", "release.jks", "upload.keystore", "server.key"]:
            self.assertTrue(is_credential_file(rel), rel)
        for rel in [".env.example", "apps/site/.env.sample", "id_rsa.pub", "src/env.ts", "contracts/manifest.schema.json",
                    "src/.env.d.ts"]:
            self.assertFalse(is_credential_file(rel), rel)


if __name__ == "__main__":
    unittest.main()
