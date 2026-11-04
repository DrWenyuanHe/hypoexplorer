"""Maintain the project-only Claude SEO snapshot (Python 3.10+, Git; no packages)."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
URL = "https://github.com/AgriciDaniel/claude-seo.git"
LOCK = "seo-skills.lock.json"
VENDOR = "vendor/claude-seo"
ADAPTER_VERSION = 5


def now():
    return datetime.now(timezone.utc).isoformat()


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True, encoding="utf-8", timeout=120).stdout.strip()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def guarded(root, relative):
    """Never follow a symlink/junction or move anything outside the named root."""
    root = root.resolve()
    path = root / relative
    if not path.resolve().is_relative_to(root) or path.resolve() == root:
        raise ValueError(f"Path outside installation boundary: {relative}")
    for part in [path, *path.parents]:
        if part == root:
            break
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError(f"Refusing linked path: {part}")
    return path


def hashes(root):
    if not root.exists():
        return {}
    result = {}
    for path in sorted(root.rglob("*")):
        guarded(root, path.relative_to(root))
        if path.is_file():
            result[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def roots_for(names):
    if any(not re.fullmatch(r"seo(?:-[a-z0-9]+)*", n) for n in names):
        raise ValueError("Unexpected skill name; review upstream packaging before updating")
    return [VENDOR, *(f".agents/skills/{n}" for n in sorted(names))]


def read_lock(root):
    path = guarded(root, LOCK)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def verify(root, lock):
    if not lock or lock.get("schema_version") != 1 or lock.get("source_url") != URL:
        raise ValueError("Missing or unsupported SEO installation lock")
    expected_roots = roots_for(lock["skills"])
    if set(lock["installed_hashes"]) != set(expected_roots):
        raise ValueError("Unexpected owned paths in installation lock")
    differences = []
    for relative in expected_roots:
        actual = hashes(guarded(root, relative))
        expected = lock["installed_hashes"][relative]
        differences.extend(f"{relative}/{p}" for p in sorted(actual.keys() | expected.keys())
                           if actual.get(p) != expected.get(p))
    if differences:
        raise ValueError("Local changes detected; preserve/merge them before updating:\n" +
                         "\n".join(differences[:30]))


def latest():
    refs = dict(line.split()[::-1] for line in git("ls-remote", "--tags", URL).splitlines())
    tags = [(tuple(map(int, m.groups())), ref) for ref in refs
            if (m := re.fullmatch(r"refs/tags/v(\d+)\.(\d+)\.(\d+)", ref))]
    if not tags:
        raise ValueError("No stable vX.Y.Z upstream tag found")
    _, ref = max(tags)
    return ref.removeprefix("refs/tags/"), refs.get(ref + "^{}", refs[ref])


NOTE = """
## Project installation (Codex)

This copy belongs only to this repository. Run commands from the project root.
Use `$seo` or `$seo-<name>` in Codex; `/seo ...` below is upstream command notation.
Shared upstream files are in `vendor/claude-seo/`; in those files resolve
`${CLAUDE_PLUGIN_ROOT}` to that directory and run tools through
`python scripts/seo_runtime.py` (the project-local managed-runtime launcher).
Use native available tools; agent prompt files are supporting references, not
registered Claude agents. Optional MCP extensions need separately configured
services. Installing these skills does not set up runtime dependencies or accounts.
See `docs/seo-tooling.md` for updates and explicit runtime setup.

### SEO session update check

At the start of an SEO session, run `python scripts/seo_skills.py check` once,
including implicit skill selection. A session covers the requested SEO task and
its related follow-ups through delivery. Delegated sub-skills share that check's
result; pass it to them so they do not repeat the check or prompt.

Complete the requested SEO work with the installed skills. An available update
must not interrupt the task or trigger a prompt before the deliverable is complete.

- If `update_available` is false, no update prompt is needed.
- If true, after delivering the requested SEO work, show the installed version,
  latest tag, and comparison link. Ask once whether to install the update for
  future sessions or keep the installed version. Wait for the answer before
  installing; the completed SEO work does not depend on this choice. Never treat
  silence or an earlier session's approval as consent to this update.
- If approved, run the exact pinned `update_command` from the check. After it
  succeeds, reread the relevant installed SKILL.md files. If declined, keep the
  installed version; check again at the start of the next SEO session.
- If the check fails, complete the task with the installed skills and briefly
  report at the end that update availability could not be verified. Do not claim
  they are current or attempt an automatic repair. If an approved update fails,
  stop and inspect its receipt before using potentially incomplete files.

An explicit user request to update the skills can be handled immediately. The
check is read-only; installing an available update still requires authorization.
This does not authorize runtime setup or changes outside this project's SEO
installation.

"""


def adapt(text, skill_manifest=False):
    text = text.replace('"${CLAUDE_PLUGIN_ROOT}/scripts/claude-seo"', "python scripts/seo_runtime.py")
    text = text.replace('"$HOME/.claude/skills/seo/scripts/claude-seo"', "python scripts/seo_runtime.py")
    text = text.replace("${CLAUDE_PLUGIN_ROOT}/skills/", ".agents/skills/")
    text = text.replace("${CLAUDE_PLUGIN_ROOT}", VENDOR)
    if skill_manifest:
        # Keep upstream frontmatter (including invocation policy) byte-for-byte.
        parts = text.split("---", 2)
        if len(parts) != 3 or parts[0].strip():
            raise ValueError("Invalid SKILL.md frontmatter")
        if not re.search(r"^name: .+", parts[1], re.M) or not re.search(r"^description: .+", parts[1], re.M):
            raise ValueError("Skill is missing discovery metadata")
        text = "---" + parts[1] + "---\n" + NOTE + parts[2]
        if "**Runtime:**" in text and "\n\nComprehensive SEO" in text:
            start = text.index("**Runtime:**")
            end = text.index("\n\nComprehensive SEO", start)
            text = text[:start] + "**Runtime:** Use `python scripts/seo_runtime.py run <script.py>`.\nThis delegates to the upstream managed runtime with project-local storage.\nRun setup only when explicitly requested; never use a global pip installation." + text[end:]
    return text


def stage(source, candidate, ref, commit):
    # Export raw committed bytes, independent of Git's checkout newline settings.
    vendor = candidate / VENDOR
    vendor.mkdir(parents=True)
    modes = {}
    for entry in git("ls-tree", "-r", commit, cwd=source).splitlines():
        meta, relative = entry.split("\t", 1)
        mode, kind, oid = meta.split()
        if kind != "blob" or mode not in {"100644", "100755"}:
            raise ValueError(f"Unsupported upstream file type: {relative}")
        modes[relative] = mode
    archive = subprocess.run(["git", "archive", "--format=zip", commit], cwd=source,
                             check=True, capture_output=True).stdout
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for item in bundle.infolist():
            if item.is_dir():
                continue
            relative = item.filename
            if relative not in modes:
                raise ValueError(f"Unexpected archive member: {relative}")
            path = guarded(vendor, relative)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(bundle.read(item))
            if modes[relative] == "100755":
                path.chmod(0o755)
    names = sorted(p.parent.name for p in (vendor / "skills").glob("*/SKILL.md"))
    roots_for(names)
    if not names or "seo" not in names:
        raise ValueError("Upstream no longer has the expected skills layout")
    source_hashes = hashes(vendor)
    # Upstream's report ignore glob also hides this committed template on
    # case-insensitive Windows Git installations. Keep it portable in fresh clones.
    template = vendor / "skills/seo-google/assets/templates/cwv-audit-report.md"
    if template.exists():
        exception = template.parent / ".gitignore"
        existing = exception.read_text(encoding="utf-8") if exception.exists() else ""
        exception.write_text(existing + "\n# Retain the bundled report template on Windows.\n!cwv-audit-report.md\n",
                             encoding="utf-8", newline="\n")
    for name in names:
        destination = candidate / ".agents/skills" / name
        shutil.copytree(vendor / "skills" / name, destination)
        for path in destination.rglob("*.md"):
            path.write_text(adapt(path.read_text(encoding="utf-8"), path.name == "SKILL.md"),
                            encoding="utf-8", newline="\n")
    return {"schema_version": 1, "adapter_version": ADAPTER_VERSION,
            "source_url": URL, "ref": ref, "commit": commit,
            "version": json.loads((vendor / ".claude-plugin/plugin.json").read_text())["version"],
            "skills": names, "source_hashes": source_hashes,
            "installed_hashes": {p: hashes(candidate / p) for p in roots_for(names)}}


def apply(root, candidate, lock, record):
    previous = read_lock(root)
    if previous:
        verify(root, previous)
    previous_roots = roots_for(previous["skills"]) if previous else []
    next_roots = roots_for(lock["skills"])
    owned = sorted(set(previous_roots + next_roots))
    for relative in owned:
        destination = guarded(root, relative)
        if destination.exists() and relative not in previous_roots:
            raise ValueError(f"Unowned destination already exists: {relative}")
    verify(candidate, lock)
    receipt = {"schema_version": 1, "started_at": now(), "status": "pending",
               "scope": "project", "client": "codex", "project": str(root.resolve()),
               "source": {k: lock[k] for k in ("source_url", "ref", "commit", "version")},
               "adaptations": "Project paths and runtime launcher; frontmatter policies retained",
               "previous_lock": previous, "candidate_lock": lock, "steps": []}
    record.mkdir(parents=True, exist_ok=True)
    write_json(record / "receipt.json", receipt)
    (record / "recovery.md").write_text(
        "# Recovery\n\nInspect receipt.json and actual paths before recovery.\n"
        "The operation stops on any failure; it does not blindly resume.\n"
        "For each promoted path, compare its hashes with candidate_lock. Preserve later edits.\n"
        "Move promoted paths outside discovery into this record, then restore matching\n"
        "backups/<project-relative-path> to the original project path, in reverse step order.\n"
        "For a fresh install, moving the promoted paths out of discovery is rollback.\n"
        "Restore previous_lock to seo-skills.lock.json (or retire the lock for a fresh install).\n"
        "Verify restored hashes against previous_lock. Do not overwrite unrelated files.\n",
        encoding="utf-8")
    try:
        if previous:
            verify(root, previous)  # Recheck immediately before the first mutation.
        for relative in owned:
            destination = guarded(root, relative)
            step = {"path": relative, "status": "pending"}
            receipt["steps"].append(step)
            write_json(record / "receipt.json", receipt)
            if destination.exists():
                backup = guarded(record, "backups/" + relative)
                backup.parent.mkdir(parents=True, exist_ok=True)
                destination.rename(backup)
                step["status"] = "backed_up"
                write_json(record / "receipt.json", receipt)
                if hashes(backup) != previous["installed_hashes"][relative]:
                    raise ValueError(f"Backup verification failed: {relative}")
            if relative in next_roots:
                destination.parent.mkdir(parents=True, exist_ok=True)
                guarded(candidate, relative).rename(destination)
            step["status"] = "installed" if relative in next_roots else "retired"
            write_json(record / "receipt.json", receipt)
        verify(root, lock)
        write_json(guarded(root, LOCK), lock)
        receipt.update(status="complete", completed_at=now(),
                       validation="Installed and backup file sets/SHA-256 verified; client discovery separate")
    except BaseException:
        receipt["status"] = "incomplete"
        raise
    finally:
        write_json(record / "receipt.json", receipt)


def update(root, ref=None):
    private = guarded(root, ".skill-installations/claude-seo")
    private.mkdir(parents=True, exist_ok=True)
    mutex = private / "writer.lock"
    # Exclusive file survives interruption: never automatically resume a partial update.
    with mutex.open("x") as writer:
        writer.write(f"pid={os.getpid()} started={now()}\n")
    success = False
    try:
        previous = read_lock(root)
        if previous:
            verify(root, previous)
        if ref is None:
            ref, expected_commit = latest()
        else:
            if not re.fullmatch(r"v\d+\.\d+\.\d+|[0-9a-f]{40}", ref):
                raise ValueError("--ref must be a stable vX.Y.Z tag or a full commit SHA")
            expected_commit = ref if re.fullmatch(r"[0-9a-f]{40}", ref) else None
        if previous and expected_commit == previous["commit"] and previous["adapter_version"] == ADAPTER_VERSION:
            print("Already up to date; installed hashes verified.")
            success = True
            return
        record = private / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
        source = record / "source"
        source.mkdir(parents=True)
        git("init", "--quiet", str(source))
        git("-c", "core.autocrlf=false", "fetch", "--depth=1", URL, ref, cwd=source)
        commit = git("rev-parse", "FETCH_HEAD^{commit}", cwd=source)
        if expected_commit and commit != expected_commit:
            raise ValueError("Upstream changed during resolution; retry after reviewing")
        candidate = record / "candidate"
        lock = stage(source, candidate, ref, commit)
        apply(root, candidate, lock, record)
        print(f"Installed {len(lock['skills'])} skills: v{lock['version']} ({commit}).")
        print(f"Receipt and recovery: {record}")
        success = True
    finally:
        # Only a completed operation clears the interruption guard.
        if success:
            mutex.unlink()
        else:
            print(f"Inspect records before retrying; writer guard retained at {mutex}", file=sys.stderr)


def import_project(root, source):
    """Import a verified project snapshot offline, retaining upstream provenance."""
    source = source.resolve()
    if source == root.resolve():
        raise ValueError("Source and destination projects must differ")
    source_lock = read_lock(source)
    verify(source, source_lock)
    previous = read_lock(root)
    if previous:
        verify(root, previous)
        if previous["commit"] == source_lock["commit"] and previous["adapter_version"] == ADAPTER_VERSION:
            print("Already installed; project hashes verified.")
            return
    private = guarded(root, ".skill-installations/claude-seo")
    private.mkdir(parents=True, exist_ok=True)
    mutex = private / "writer.lock"
    with mutex.open("x") as writer:
        writer.write(f"pid={os.getpid()} started={now()}\n")
    success = False
    try:
        record = private / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
        candidate = record / "candidate"
        vendor = candidate / VENDOR
        shutil.copytree(guarded(source, VENDOR), vendor)
        if hashes(vendor) != source_lock["installed_hashes"][VENDOR]:
            raise ValueError("Source snapshot changed during import")
        names = sorted(p.parent.name for p in (vendor / "skills").glob("*/SKILL.md"))
        if names != sorted(source_lock["skills"]):
            raise ValueError("Source skill inventory differs from its lock")
        for name in names:
            destination = candidate / ".agents/skills" / name
            shutil.copytree(vendor / "skills" / name, destination)
            for path in destination.rglob("*.md"):
                path.write_text(adapt(path.read_text(encoding="utf-8"), path.name == "SKILL.md"),
                                encoding="utf-8", newline="\n")
        lock = {**source_lock, "adapter_version": ADAPTER_VERSION,
                "installed_hashes": {p: hashes(candidate / p) for p in roots_for(names)}}
        write_json(record / "import-source.json", {
            "source_project": str(source), "source_lock": source_lock,
            "validation": "Source file sets and SHA-256 verified before import; source unchanged",
        })
        apply(root, candidate, lock, record)
        print(f"Imported {len(names)} skills: v{lock['version']} ({lock['commit']}).")
        print(f"Receipt and recovery: {record}")
        success = True
    finally:
        if success:
            mutex.unlink()
        else:
            print(f"Inspect records before retrying; writer guard retained at {mutex}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "update", "verify", "import"])
    parser.add_argument("--ref", help="Pin update to a stable release tag or full commit")
    parser.add_argument("--source-project", type=Path, help="Verified project installation to import offline")
    args = parser.parse_args()
    if args.command != "update" and args.ref:
        parser.error("--ref is only valid with update")
    if args.command == "import":
        if not args.source_project:
            parser.error("import requires --source-project")
        import_project(ROOT, args.source_project)
        return
    if args.source_project:
        parser.error("--source-project is only valid with import")
    if args.command == "update":
        update(ROOT, args.ref)
        return
    lock = read_lock(ROOT)
    verify(ROOT, lock)
    if args.command == "verify":
        print(f"Verified {len(lock['skills'])} project skills and upstream snapshot (v{lock['version']}).")
        return
    tag, commit = latest()
    print(json.dumps({"installed_version": lock["version"], "installed_commit": lock["commit"],
                      "latest_tag": tag, "latest_commit": commit,
                      "update_available": commit != lock["commit"],
                      "compare_url": f"{URL.removesuffix('.git')}/compare/{lock['commit']}...{commit}",
                      "update_command": f"python scripts/seo_skills.py update --ref {commit}"}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(f"SEO skills: {exc}", file=sys.stderr)
        if isinstance(exc, subprocess.CalledProcessError):
            print(exc.stderr, file=sys.stderr)
        sys.exit(1)
