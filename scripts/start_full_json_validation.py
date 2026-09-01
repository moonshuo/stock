"""Starts the intentionally long full-history JSON parse without blocking the CLI."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = Path.home() / 'AppData' / 'Local' / 'Temp'
stdout = (LOG_DIR / 'automotive-json-validation.out').open('w', encoding='utf-8')
stderr = (LOG_DIR / 'automotive-json-validation.err').open('w', encoding='utf-8')
creationflags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW
process = subprocess.Popen(
    ['python', 'scripts/validate_all_json_parallel.py'],
    cwd=ROOT,
    stdout=stdout,
    stderr=stderr,
    creationflags=creationflags,
    close_fds=True,
)
print(process.pid)
