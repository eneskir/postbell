"""Tests for check_pr_title.py: `python3 -m unittest discover -s tools`."""

import unittest

from check_pr_title import MAX_LENGTH, problems


class PrTitle(unittest.TestCase):
    def test_a_conventional_title_passes(self):
        self.assertEqual(problems("fix: keep the alarm after a restart"), [])
        self.assertEqual(problems("feat(site)!: add the download page"), [])

    def test_a_title_without_a_type_fails(self):
        self.assertEqual(len(problems("Keep the alarm after a restart")), 1)
        self.assertEqual(len(problems("fix:no space")), 1)

    def test_a_long_title_fails(self):
        title = "fix: " + "a" * (MAX_LENGTH - 4)
        self.assertEqual(len(title), MAX_LENGTH + 1)
        self.assertEqual(len(problems(title)), 1)
        self.assertEqual(problems(title[:-1]), [])

    def test_a_title_ending_in_a_period_fails(self):
        self.assertEqual(len(problems("fix: keep the alarm.")), 1)


if __name__ == "__main__":
    unittest.main()
