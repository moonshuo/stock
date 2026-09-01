"""Parallel full-history JSON parse validation for the large local snapshot archive."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parent.parent / 'data'

def parse_one(raw_path: str) -> str | None:
    try:
        json.loads(Path(raw_path).read_text(encoding='utf-8'))
        return None
    except Exception as exc:  # return so all failures can be reported
        return f'{raw_path}: {exc}'

if __name__ == '__main__':
    paths = [str(p) for p in ROOT.rglob('*.json')]
    workers = min(24, max(4, (os.cpu_count() or 2) * 2))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        failures = [x for x in pool.map(parse_one, paths) if x]
    if failures:
        print('\n'.join(failures), file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps({'valid': True, 'json_files_checked': len(paths), 'workers': workers}, ensure_ascii=False))
