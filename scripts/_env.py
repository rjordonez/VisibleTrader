"""Shared .env loader for scripts/*.py — was copy-pasted (with two subtly
different, inconsistent implementations) across 6 separate scripts before
being consolidated here.

Same files Vite reads for the frontend. Usage:
    from _env import load_env

    load_env()
    DATABASE_URL = os.environ['DATABASE_URL']
"""
import os

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(_SCRIPTS_DIR, '..', '.env')
ENV_LOCAL_PATH = os.path.join(_SCRIPTS_DIR, '..', '.env.local')


def _load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            # setdefault, not assignment — a real shell-exported env var
            # always wins over either file, matching normal dotenv
            # precedence (one of the two implementations this replaced
            # silently violated this by overwriting unconditionally).
            os.environ.setdefault(key.strip(), value.strip())


def load_env():
    """.env.local loaded first — setdefault() means .env.local wins over
    .env, matching Vite's own precedence for the frontend reading the same
    files."""
    _load_env_file(ENV_LOCAL_PATH)
    _load_env_file(ENV_PATH)
