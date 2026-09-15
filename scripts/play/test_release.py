import unittest
from unittest.mock import patch, Mock
import os
from pathlib import Path
import tempfile
from release import release_update, main, Play

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

class ApiSafetyTests(unittest.TestCase):
    config = {'package':'com.example.test','track':'alpha','bundle':'app.aab','console_url':'https://example.com'}
    def client(self):
        with patch.dict(os.environ, {'PLAY_ACCESS_TOKEN':'test-only'}):
            return Play(self.config)
    def test_verify_never_commits(self):
        client = self.client()
        client.request = Mock(side_effect=[{'id':'temporary'}, {'tracks':[{'track':'alpha'}]}, {}])
        with patch('release.summary'), patch('builtins.print'):
            client.run(self.config, 'verify', 3, '1.0')
        self.assertEqual([c.args[0] for c in client.request.call_args_list], ['POST','GET','DELETE'])
        self.assertTrue(client.request.call_args_list[-1].args[1].endswith('/edits/temporary'))
    def test_upload_never_cancels_existing_review(self):
        client = self.client()
        client.request = Mock(side_effect=[{'id':'temporary'}, {'tracks':[{'track':'alpha'}]}, {'versionCode':3}, {}, {}, {}])
        with patch('release.summary'), patch('release.Path.read_bytes', return_value=b'bundle'), patch('release.Path.read_text', return_value='[{"language":"es-419","text":"Changes"}]'):
            client.run(self.config, 'upload', 3, '1.0')
        commit = client.request.call_args_list[-1].args[1]
        self.assertIn('changesNotSentForReview=true', commit)
        self.assertIn('changesInReviewBehavior=ERROR_IF_IN_REVIEW', commit)

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
