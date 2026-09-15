import unittest
from unittest.mock import patch
import os
from pathlib import Path
import tempfile
from release import release_update, main

class ReleaseSafetyTests(unittest.TestCase):
    def test_upload_preserves_serving_release(self):
        current = {'versionCodes': ['28'], 'status': 'completed'}
        result = release_update([current], 29, '1.18', 'upload', [])
        self.assertEqual(result[0], current)
        self.assertEqual(result[1]['status'], 'draft')
    def test_no_silent_draft_replacement(self):
        with self.assertRaises(ValueError):
            release_update([{'versionCodes': ['29'], 'status': 'draft'}], 30, '1.19', 'upload', [])
    def test_no_duplicate_upload(self):
        with self.assertRaises(ValueError):
            release_update([{'versionCodes': ['28'], 'status': 'completed'}], 28, '1.17', 'upload', [])
    def test_submit_only_exact_draft(self):
        draft = {'versionCodes': ['29'], 'status': 'draft', 'releaseNotes': []}
        self.assertEqual(release_update([{'versionCodes': ['28'], 'status': 'completed'}, draft], 29, '1.18', 'submit', []), [{**draft, 'status': 'completed'}])
    def test_refuse_missing_or_published_version(self):
        for releases in ([], [{'versionCodes': ['29'], 'status': 'completed'}], [{'versionCodes': ['29','30'], 'status': 'draft'}]):
            with self.assertRaises(ValueError):
                release_update(releases, 29, '1.18', 'submit', [])

class TriggerTests(unittest.TestCase):
    def detect(self, current, previous, env):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            with patch.dict(os.environ, {**env, 'GITHUB_OUTPUT': str(output)}, clear=True), patch('sys.argv', ['release.py','detect']), patch('release.version', side_effect=[('1.0',current),('1.0',previous)]), patch('release.summary'):
                main()
            return output.read_text()
    def test_same_code_does_not_upload(self):
        self.assertIn('run=false', self.detect(28,28,{'GITHUB_EVENT_NAME':'push','BEFORE_SHA':'abc'}))
    def test_increment_uploads(self):
        self.assertIn('run=true\nmode=upload', self.detect(29,28,{'GITHUB_EVENT_NAME':'push','BEFORE_SHA':'abc'}))
    def test_decrease_fails(self):
        with self.assertRaises(ValueError):
            self.detect(27,28,{'GITHUB_EVENT_NAME':'push','BEFORE_SHA':'abc'})
    def test_submit_requires_matching_code(self):
        with self.assertRaises(ValueError):
            self.detect(28,28,{'GITHUB_EVENT_NAME':'workflow_dispatch','RELEASE_ACTION':'submit','RELEASE_CODE':'27'})

if __name__ == '__main__':
    unittest.main()
