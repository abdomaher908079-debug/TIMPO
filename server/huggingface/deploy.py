"""Deploys the cloud processing server as a free Hugging Face Docker Space.

Usage (from the repository root, with HF_TOKEN and SUPABASE_SERVICE_ROLE_KEY set):
    pip install huggingface_hub
    python server/huggingface/deploy.py <user>/hookcut-cloud
Optional: SUPABASE_URL, SUPABASE_ANON_KEY and ALLOWED_ORIGINS override the defaults below.
"""

import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

SERVER = Path(__file__).resolve().parent.parent
SECRETS = {
    "SUPABASE_URL": os.environ.get("SUPABASE_URL", "https://medqkcnpxjogeedenkee.supabase.co"),
    "SUPABASE_ANON_KEY": os.environ.get("SUPABASE_ANON_KEY", "sb_publishable_kuPhFeyFRjwIdCzEbRudVA_9cdr5j5n"),
    "SUPABASE_SERVICE_ROLE_KEY": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    "ALLOWED_ORIGINS": os.environ.get("ALLOWED_ORIGINS", "https://hookcut.pages.dev"),
}
# Free CPU Spaces are slow: base.en for every plan. Spaces serve port 7860 (app_port in README.md).
VARIABLES = {"PORT": "7860", "WHISPER_MODEL": "base.en"}


def main(repo_id: str):
    api = HfApi(token=os.environ["HF_TOKEN"])
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)
    for key, value in SECRETS.items():
        api.add_space_secret(repo_id, key, value)
    for key, value in VARIABLES.items():
        api.add_space_variable(repo_id, key, value)
    files = {name: SERVER / name for name in ("Dockerfile", "app.py", "limits.py", "requirements.txt")}
    files["README.md"] = SERVER / "huggingface" / "README.md"
    for name, path in files.items():
        api.upload_file(path_or_fileobj=str(path), path_in_repo=name, repo_id=repo_id, repo_type="space")
    print(f"https://{repo_id.replace('/', '-').replace('_', '-').lower()}.hf.space")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "Hookcut/hookcut-cloud")
