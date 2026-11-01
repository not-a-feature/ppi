"""Read-only legacy admin scrape. Never persists HTML, password hashes or cookies."""
import argparse
import hashlib
import json
import os
import re
import time
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

BASE = 'https://ppi.fsi.uni-tuebingen.de/'
ACCOUNT_FIELDS = ('id', 'username', 'role', 'tokens', 'lastLoggedIn', 'comment')


def atomic_write(path, data):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_bytes(data)
    temporary.replace(path)


def cached_download(path, receipt, protocol):
    if not path.exists() or not receipt.exists():
        return None
    record = json.loads(receipt.read_text(encoding='utf-8'))
    if record['source'] != protocol:
        return None
    data = path.read_bytes()
    if len(data) == int(protocol['fileSize']) and hashlib.sha256(data).hexdigest() == record['sha256']:
        return data
    return None


class Rows(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.rows, self.row = [], None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'form' and 'flex-table-row' in a.get('class', '').split():
            self.row = {}
        if self.row is not None and tag in ('input', 'button'):
            name = a.get('name')
            # The response includes password hashes. Drop them before storing anything.
            if name and name != 'passwordHash':
                self.row[name] = a.get('value', '')

    def handle_endtag(self, tag):
        if tag == 'form' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError('Legacy session expired or lacks administrator access; redirect refused')


def scrape(cookie, destination, resume=False):
    if not re.fullmatch(r'(PHPSESSID=)?[a-zA-Z0-9,-]+', cookie):
        raise ValueError('Supply only PHPSESSID or its value')
    if not cookie.startswith('PHPSESSID='):
        cookie = 'PHPSESSID=' + cookie
    destination.mkdir(parents=True, exist_ok=resume)
    assert not (destination / 'snapshot.json').exists(), 'Completed snapshots are immutable'
    (destination / 'files').mkdir(exist_ok=resume)
    state = destination / '.download-state'
    state.mkdir(exist_ok=resume)
    opener = urllib.request.build_opener(NoRedirect)

    def get(path):
        # Paths are constructed locally, never followed from links on admin pages.
        request = urllib.request.Request(BASE + path, headers={'Cookie': cookie})
        with opener.open(request, timeout=60) as response:
            return response.read(), response.headers

    def listing(page, paginated=True):
        result, total = [], None
        for number in range(10000):
            data, _ = get(page + '?page=' + str(number))
            html = data.decode('utf-8')
            assert 'flex-table' in html, 'Missing administrator table'
            rows = Rows(html).rows
            assert all('id' in row for row in rows), 'Row missing source ID'
            if paginated:
                totals = re.findall(r'\d+\s*-\s*\d+\s*/\s*(\d+)\s*<', html)
                assert totals and len(set(totals)) == 1, 'Missing or conflicting pagination total'
                current = int(totals[0])
                if total is None:
                    total = current
                assert total == current, 'Source changed during scrape; retry'
            result.extend(rows)
            assert len({r['id'] for r in result}) == len(result), 'Duplicate IDs during pagination'
            if not paginated or len(result) == total:
                return result
            assert rows and len(result) < total, 'Incomplete pagination'
        raise RuntimeError('Pagination limit exceeded')

    def save(name, value):
        atomic_write(destination / name, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))

    users = listing('userslist.php')
    # Legacy status contains activation/reset tokens; roles determine account state.
    users = [{k: row[k] for k in ACCOUNT_FIELDS} for row in users]
    save('users.json', users)
    lectures = listing('lectureslist.php', False)
    save('lectures.json', lectures)
    protocols = listing('examprotocolslist.php')
    save('protocols.json', protocols)
    missing, files = [], []
    def download(protocol):
        source_id = int(protocol['id'])
        extension = protocol['fileName'].rsplit('.', 1)[-1].lower()
        assert extension in ('pdf', 'txt'), f'Unsupported protocol extension: {source_id}'
        path = f'files/{source_id}.{extension}'
        existing = destination / path
        receipt = state / f'{source_id}.json'
        data = cached_download(existing, receipt, protocol) if resume else None
        if data is not None:
            return {'id': source_id, 'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        data, headers = get('examprotocolslist.php?download=' + str(source_id))
        if not headers.get('Content-Disposition', '').lower().startswith('attachment'):
            return {'missing': source_id}
        assert len(data) == int(protocol['fileSize']), f'File size changed: {source_id}'
        atomic_write(existing, data)
        atomic_write(receipt, json.dumps({'source': protocol, 'sha256': hashlib.sha256(data).hexdigest()}).encode('utf-8'))
        time.sleep(0.05)
        return {'id': source_id, 'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    with ThreadPoolExecutor(max_workers=4) as executor:
        for index, result in enumerate(executor.map(download, protocols)):
            if 'missing' in result:
                missing.append(result['missing'])
            else:
                files.append(result)
            if index % 50 == 0:
                print(f'Downloaded {index + 1}/{len(protocols)}', flush=True)
    # Detect changed account balances/roles and protocol records while downloading.
    assert protocols == listing('examprotocolslist.php'), 'Protocols changed during collection; retry'
    assert lectures == listing('lectureslist.php', False), 'Lectures changed during collection; retry'
    final_users = listing('userslist.php')
    final_users = [{k: r[k] for k in ACCOUNT_FIELDS} for r in final_users]
    assert users == final_users, 'Accounts changed during collection; retry'
    save('file-manifest.json', files)
    save('missing-files.json', missing)
    save('snapshot.json', {'version': 1, 'completedAt': datetime.now(timezone.utc).isoformat(), 'protocols': len(protocols), 'users': len(users), 'admins': sum(u['role'] == 'ADMIN' for u in users), 'missing': missing})
    print(f'Completed private scrape: {destination}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cookie-file', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--resume', action='store_true', help='Resume an interrupted, incomplete snapshot directory')
    args = parser.parse_args()
    cookie = args.cookie_file.read_text().strip() if args.cookie_file else os.environ['LEGACY_COOKIE']
    scrape(cookie, args.output, args.resume)
