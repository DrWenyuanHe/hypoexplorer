"""Project-local launcher for the optional upstream SEO managed runtime."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    env = os.environ.copy()
    env["CLAUDE_SEO_DATA_DIR"] = str(ROOT / ".skill-installations/claude-seo-runtime")
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    # Dependency and browser installation stay in this project. API credentials
    # retain upstream behavior; configure integrations separately when requested.
    sys.exit(subprocess.call([sys.executable, str(ROOT / "vendor/claude-seo/scripts/runtime.py"),
                             *sys.argv[1:]], env=env, cwd=ROOT))
