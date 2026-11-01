import importlib.util
import unittest
import tempfile
import hashlib
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('scrape', Path(__file__).with_name('scrape-legacy.py'))
scrape = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scrape)


class ScrapeParserTest(unittest.TestCase):
    def test_resume_requires_matching_source_and_checksum(self):
        with tempfile.TemporaryDirectory(prefix='ppi-scrape-') as directory:
            path = Path(directory) / '1.txt'
            receipt = Path(directory) / '1.json'
            protocol = {'fileSize': '3', 'id': '1'}
            path.write_bytes(b'old')
            self.assertIsNone(scrape.cached_download(path, receipt, protocol))
            receipt.write_text(json.dumps({'source': protocol, 'sha256': hashlib.sha256(b'old').hexdigest()}))
            self.assertEqual(scrape.cached_download(path, receipt, protocol), b'old')
            path.write_bytes(b'new')
            self.assertIsNone(scrape.cached_download(path, receipt, protocol))
            path.write_bytes(b'old')
            self.assertIsNone(scrape.cached_download(path, receipt, {**protocol, 'id': '2'}))

    def test_only_admin_rows_and_no_password_hash(self):
        html = '''<form><input name="username" value="filter"></form>
        <form class="flex-table-row" method="POST">
        <input name="username" value="zxabc12"><input name="passwordHash" value="NEVER_SAVE">
        <input name="comment" value="private &amp; quoted &quot;note&quot;">
        <input name="role" value="ADMIN"><input name="tokens" value="17">
        <button name="id" value="42">Save</button></form>'''
        rows = scrape.Rows(html).rows
        self.assertEqual(len(rows), 1)
        self.assertNotIn('passwordHash', rows[0])
        self.assertEqual(rows[0]['comment'], 'private & quoted "note"')
        self.assertEqual(rows[0]['role'], 'ADMIN')
        self.assertEqual(rows[0]['id'], '42')


if __name__ == '__main__':
    unittest.main()
