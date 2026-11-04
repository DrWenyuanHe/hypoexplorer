"""Exercise update preservation and recovery behavior without network access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("seo_skills", Path(__file__).resolve().parents[2] / "scripts/seo_skills.py")
seo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(seo)


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def candidate(self, label, names):
        directory = self.root / label
        for relative in seo.roots_for(names):
            path = directory / relative
            path.mkdir(parents=True)
            (path / "content.md").write_text(label)
        lock = {"schema_version": 1, "adapter_version": 1, "source_url": seo.URL,
                "commit": label, "ref": label, "version": "1.0.0", "skills": names,
                "installed_hashes": {p: seo.hashes(directory / p) for p in seo.roots_for(names)}}
        return directory, lock

    def install(self, label, names):
        candidate, lock = self.candidate(label, names)
        seo.apply(self.root, candidate, lock, self.root / "records" / label)
        return lock

    def test_update_backs_up_old_content_and_retires_removed_skills(self):
        unrelated = self.root / ".agents/skills/agentic-environment-setup/keep.md"
        unrelated.parent.mkdir(parents=True)
        unrelated.write_text("preserve")
        old = self.install("old", ["seo", "seo-page"])
        new = self.install("new", ["seo", "seo-content"])
        seo.verify(self.root, new)
        self.assertFalse((self.root / ".agents/skills/seo-page").exists())
        self.assertEqual(unrelated.read_text(), "preserve")
        for path, expected in old["installed_hashes"].items():
            self.assertEqual(seo.hashes(self.root / "records/new/backups" / path), expected)

    def test_local_edit_and_extra_file_block_update(self):
        old = self.install("old", ["seo"])
        owned = self.root / ".agents/skills/seo/content.md"
        owned.write_text("user edit")
        with self.assertRaisesRegex(ValueError, "Local changes"):
            self.install("new", ["seo"])
        self.assertEqual(owned.read_text(), "user edit")
        owned.write_text("old")
        (owned.parent / "extra.md").write_text("user addition")
        with self.assertRaisesRegex(ValueError, "Local changes"):
            seo.verify(self.root, old)

    def test_unowned_skill_is_never_replaced(self):
        path = self.root / ".agents/skills/seo/keep.md"
        path.parent.mkdir(parents=True)
        path.write_text("unowned")
        with self.assertRaisesRegex(ValueError, "Unowned"):
            self.install("new", ["seo"])
        self.assertEqual(path.read_text(), "unowned")

    def test_interruption_records_backup_and_leaves_old_lock(self):
        old = self.install("old", ["seo"])
        candidate, lock = self.candidate("new", ["seo"])
        original = Path.rename
        def fail_promotion(path, target):
            if path == candidate / ".agents/skills/seo":
                raise OSError("simulated interrupted promotion")
            return original(path, target)
        with patch.object(Path, "rename", fail_promotion), self.assertRaises(OSError):
            seo.apply(self.root, candidate, lock, self.root / "records/new")
        receipt = json.loads((self.root / "records/new/receipt.json").read_text())
        self.assertEqual(receipt["status"], "incomplete")
        self.assertEqual(seo.read_lock(self.root), old)
        self.assertEqual(seo.hashes(self.root / "records/new/backups/.agents/skills/seo"),
                         old["installed_hashes"][".agents/skills/seo"])

    def test_paths_cannot_escape_project(self):
        with self.assertRaises(ValueError):
            seo.guarded(self.root, "../outside")
        with self.assertRaises(ValueError):
            seo.roots_for(["../../outside"])

    def test_version_order_and_annotated_tag_resolution(self):
        output = "a refs/tags/v2.9.0\nb refs/tags/v2.10.0\nc refs/tags/v2.10.0^{}\nd refs/tags/v3.0.0-rc1"
        with patch.object(seo, "git", return_value=output):
            self.assertEqual(seo.latest(), ("v2.10.0", "c"))

    def test_adaptation_preserves_invocation_policy(self):
        text = '---\nname: seo\ndescription: SEO\ndisable-model-invocation: true\n---\n"${CLAUDE_PLUGIN_ROOT}/scripts/claude-seo" run test.py\n'
        adapted = seo.adapt(text, True)
        self.assertEqual(text.split("---")[1], adapted.split("---")[1])
        self.assertIn("python scripts/seo_runtime.py run test.py", adapted)

    def source_project(self):
        source = self.root / "source-project"
        skill = source / seo.VENDOR / "skills/seo/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("---\nname: seo\ndescription: Test SEO\ndisable-model-invocation: true\n---\nReference.\n", encoding="utf-8")
        installed = source / ".agents/skills/seo/SKILL.md"
        installed.parent.mkdir(parents=True)
        installed.write_text(seo.adapt(skill.read_text(), True), encoding="utf-8")
        lock = {"schema_version": 1, "adapter_version": seo.ADAPTER_VERSION - 1,
                "source_url": seo.URL, "commit": "a" * 40, "ref": "v1.0.0",
                "version": "1.0.0", "skills": ["seo"],
                "source_hashes": seo.hashes(source / seo.VENDOR),
                "installed_hashes": {p: seo.hashes(source / p) for p in seo.roots_for(["seo"])}}
        seo.write_json(source / seo.LOCK, lock)
        return source, lock

    def test_local_import_preserves_source_provenance_and_is_repeatable(self):
        source, source_lock = self.source_project()
        destination = self.root / "destination"
        before = seo.hashes(source)
        seo.import_project(destination, source)
        lock = seo.read_lock(destination)
        seo.verify(destination, lock)
        self.assertEqual(lock["source_hashes"], source_lock["source_hashes"])
        self.assertEqual(lock["commit"], source_lock["commit"])
        self.assertEqual(lock["adapter_version"], seo.ADAPTER_VERSION)
        installed = (destination / ".agents/skills/seo/SKILL.md").read_text()
        self.assertIn("disable-model-invocation: true", installed)
        self.assertIn("docs/seo-tooling.md", installed)
        seo.import_project(destination, source)
        self.assertEqual(before, seo.hashes(source))
        receipts = list((destination / ".skill-installations/claude-seo").glob("*/receipt.json"))
        self.assertEqual(len(receipts), 1)
        self.assertEqual(json.loads(receipts[0].read_text())["status"], "complete")

    def test_local_import_rejects_modified_source_before_writing_destination(self):
        source, _ = self.source_project()
        (source / seo.VENDOR / "extra.md").write_text("unreviewed source")
        destination = self.root / "destination"
        with self.assertRaisesRegex(ValueError, "Local changes"):
            seo.import_project(destination, source)
        self.assertFalse(destination.exists())

    def test_local_import_rejects_unowned_destination(self):
        source, _ = self.source_project()
        destination = self.root / "destination"
        existing = destination / ".agents/skills/seo/SKILL.md"
        existing.parent.mkdir(parents=True)
        existing.write_text("keep user skill")
        with self.assertRaisesRegex(ValueError, "Unowned"):
            seo.import_project(destination, source)
        self.assertEqual(existing.read_text(), "keep user skill")

    def test_end_to_end_annotated_release_and_archive_install(self):
        source = self.root / "upstream"
        source.mkdir()
        seo.git("init", "--quiet", str(source))
        skill = source / "skills/seo/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("---\nname: seo\ndescription: Test SEO\n---\nReference.\n", encoding="utf-8")
        manifest = source / ".claude-plugin/plugin.json"
        manifest.parent.mkdir()
        manifest.write_text('{"version":"1.0.0"}', encoding="utf-8")
        seo.git("add", ".", cwd=source)
        identity = ["-c", "user.name=Installer Test", "-c", "user.email=test@example.invalid"]
        seo.git(*identity, "commit", "-qm", "fixture", cwd=source)
        seo.git(*identity, "tag", "-a", "v1.0.0", "-m", "release", cwd=source)
        expected_commit = seo.git("rev-parse", "HEAD", cwd=source)
        original_git = seo.git
        def local_git(*args, cwd=None):
            return original_git(*(str(source) if a == seo.URL else a for a in args), cwd=cwd)
        with patch.object(seo, "git", local_git):
            seo.update(self.root, "v1.0.0")
            self.assertEqual(seo.read_lock(self.root)["commit"], expected_commit)
            seo.verify(self.root, seo.read_lock(self.root))
            seo.update(self.root)  # Stable release check is an idempotent no-op.
        self.assertEqual((self.root / seo.VENDOR / "skills/seo/SKILL.md").read_bytes(), skill.read_bytes())

    def test_adapter_update_refreshes_session_policy_without_changing_upstream(self):
        source = self.root / "upstream"
        source.mkdir()
        seo.git("init", "--quiet", str(source))
        for name in ["seo", "seo-page"]:
            skill = source / "skills" / name / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text(f"---\nname: {name}\ndescription: Test SEO\n---\nReference.\n", encoding="utf-8")
        manifest = source / ".claude-plugin/plugin.json"
        manifest.parent.mkdir()
        manifest.write_text('{"version":"1.0.0"}', encoding="utf-8")
        seo.git("add", ".", cwd=source)
        seo.git("-c", "user.name=Installer Test", "-c", "user.email=test@example.invalid",
                "commit", "-qm", "fixture", cwd=source)
        commit = seo.git("rev-parse", "HEAD", cwd=source)
        original_git = seo.git

        def local_git(*args, cwd=None):
            return original_git(*(str(source) if a == seo.URL else a for a in args), cwd=cwd)

        with patch.object(seo, "git", local_git):
            with patch.object(seo, "ADAPTER_VERSION", seo.ADAPTER_VERSION - 1), \
                    patch.object(seo, "NOTE", "Wait for the answer before doing the SEO work.\n"):
                seo.update(self.root, commit)
            previous = seo.read_lock(self.root)
            seo.update(self.root, commit)

        current = seo.read_lock(self.root)
        seo.verify(self.root, current)
        self.assertEqual(current["commit"], previous["commit"])
        self.assertEqual(current["source_hashes"], previous["source_hashes"])
        self.assertEqual(current["adapter_version"], seo.ADAPTER_VERSION)
        for name in ["seo", "seo-page"]:
            installed = (self.root / ".agents/skills" / name / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn("after delivering the requested SEO work", installed)
            self.assertIn("must not interrupt the task", installed)
            self.assertNotIn("Wait for the answer before doing the SEO work.", installed)
        receipts = list((self.root / ".skill-installations/claude-seo").glob("*/receipt.json"))
        self.assertEqual(len(receipts), 2)
        self.assertTrue(all(json.loads(path.read_text())["status"] == "complete" for path in receipts))


if __name__ == "__main__":
    unittest.main()
