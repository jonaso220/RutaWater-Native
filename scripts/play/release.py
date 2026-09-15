#!/usr/bin/env python3
"""Version-gated Android builds and explicit Google Play draft promotion."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

CONFIG = Path(__file__).with_name('config.json')


def version(config, revision=None):
    path = config['version_file']
    text = subprocess.check_output(['git', 'show', f'{revision}:{path}'], text=True) if revision else Path(path).read_text()
    if config['framework'] == 'flutter':
        match = re.search(r'^version:\s*([^+\s]+)\+(\d+)\s*$', text, re.M)
        if not match:
            raise ValueError('pubspec.yaml must declare version: name+code')
        return match[1], int(match[2])
    return re.search(r'versionName\s+"([^"]+)"', text)[1], int(re.search(r'versionCode\s+(\d+)', text)[1])


def release_update(releases, code, name, mode, notes):
    """Preserve serving releases on upload; never overwrite another draft."""
    code = str(code)
    matches = [r for r in releases if code in r.get('versionCodes', [])]
    if mode == 'submit':
        if len(matches) != 1 or matches[0]['status'] != 'draft':
            raise ValueError(f'Version {code} must already be a draft in the configured track')
        draft = matches[0]
        if draft.get('versionCodes') != [code]:
            raise ValueError('Refusing to promote a draft containing additional version codes')
        return [{**draft, 'status': 'completed'}]
    if matches:
        raise ValueError(f'Version {code} already exists. No release was changed.')
    if any(r['status'] == 'draft' for r in releases):
        raise ValueError('Another draft exists. Resolve it in Play Console before uploading a new one.')
    return [*releases, {'name': f'{code} ({name})', 'versionCodes': [code], 'status': 'draft', 'releaseNotes': notes}]


class Play:
    def __init__(self, config):
        self.root = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{config['package']}"
        self.token = os.environ['PLAY_ACCESS_TOKEN']

    def request(self, method, url, body=None, binary=False):
        data = body if binary else (json.dumps(body).encode() if body is not None else None)
        request = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/octet-stream' if binary else 'application/json',
        })
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = response.read()
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as error:
            detail = json.loads(error.read()).get('error', {}).get('message', 'API request failed')
            raise RuntimeError(f'Google Play HTTP {error.code}: {detail}') from None

    def run(self, config, mode, code, name):
        edit = self.request('POST', self.root + '/edits', {})['id']
        edit_url = self.root + '/edits/' + edit
        committed = False
        try:
            tracks = self.request('GET', edit_url + '/tracks').get('tracks', [])
            track = next((t for t in tracks if t['track'] == config['track']), None)
            if track is None:
                raise ValueError(f"Configured track {config['track']} does not exist; available: {[t['track'] for t in tracks]}")
            if mode == 'verify':
                print(json.dumps({'package': config['package'], 'track': config['track'], 'releases': track.get('releases', [])}, indent=2))
                summary('Build/signing and Google Play access verified. No upload or review submission was performed.', config)
                return
            notes = json.loads(Path('scripts/play/release-notes.json').read_text())
            if not notes or any(not n.get('text') or len(n['text']) > 500 for n in notes):
                raise ValueError('Provide release notes of 1–500 characters per language')
            releases = release_update(track.get('releases', []), code, name, mode, notes)
            if mode == 'upload':
                all_codes = {c for t in tracks for r in t.get('releases', []) for c in r.get('versionCodes', [])}
                if str(code) in all_codes:
                    raise ValueError(f'Version {code} is already uploaded on another track. No duplicate upload attempted.')
                data = Path(config['bundle']).read_bytes()
                upload = edit_url.replace('/androidpublisher/v3/', '/upload/androidpublisher/v3/') + '/bundles?uploadType=media'
                result = self.request('POST', upload, data, binary=True)
                if int(result['versionCode']) != int(code):
                    raise ValueError('Built bundle version does not match source version; edit discarded')
            self.request('PUT', edit_url + '/tracks/' + config['track'], {'track': config['track'], 'releases': releases})
            self.request('POST', edit_url + ':validate')
            # Draft uploads must not submit pending changes or restart a review.
            query = '?changesNotSentForReview=true&changesInReviewBehavior=ERROR_IF_IN_REVIEW' if mode == 'upload' else ''
            self.request('POST', edit_url + ':commit' + query)
            committed = True
            summary(f'Version {code} ({name}): ' + ('uploaded as a draft. Use the manual review button when ready.' if mode == 'upload' else 'submitted to Google Play. Review/approval may still be pending.'), config)
        finally:
            if not committed:
                try:
                    self.request('DELETE', edit_url)
                except Exception as error:
                    print(f'Warning: temporary Play edit cleanup failed: {error}', file=sys.stderr)


def summary(message, config):
    print(message)
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(message + f"\n\n[Open Google Play Console]({config['console_url']})\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['detect', 'verify', 'upload', 'submit'])
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text())
    name, code = version(config)
    if args.command == 'detect':
        mode = os.getenv('RELEASE_ACTION', 'verify')
        run = True
        if os.getenv('GITHUB_EVENT_NAME') == 'push':
            before = os.environ['BEFORE_SHA']
            _, old_code = version(config, before)
            if code < old_code:
                raise ValueError('Android version code cannot decrease')
            run, mode = code > old_code, 'upload'
        if mode not in ('verify', 'upload', 'submit'):
            raise ValueError('Unsupported action')
        if mode == 'submit':
            requested = os.getenv('RELEASE_CODE', '')
            if not requested.isdecimal() or int(requested) != code:
                raise ValueError(f'Enter the exact version code from main ({code}) to submit its draft')
        with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
            out.write(f'run={str(run).lower()}\nmode={mode}\ncode={code}\nversion={name}\n')
        if not run:
            summary('No Android version increment; no build or upload needed.', config)
        return
    Play(config).run(config, args.command, code, name)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
