"""Regression tests for the show-server deployment contracts."""

import contextlib
import importlib.util
import io
import os
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

DEPLOY_PATH = Path(__file__).resolve().parents[1] / 'deploy.py'
REPO_ROOT = DEPLOY_PATH.parent.parent
SHORTCUT_SCRIPT = DEPLOY_PATH.parent / 'setup' / 'install_desktop_shortcuts.ps1'
PROVISION_SCRIPT = DEPLOY_PATH.parent / 'setup' / 'provision_runtime_secrets.ps1'
BOOT_SCRIPT = DEPLOY_PATH.parent / 'boot_server.ps1'
SPEC = importlib.util.spec_from_file_location('bm26_deploy', DEPLOY_PATH)
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)

SHORTCUT_PLAN = {
    'scene': 'titanic',
    'launcherProfile': 'prod',
    'lightingProfile': '2d_pixels',
    'simulation': (
        'http://localhost:6969/simulation/?scene=titanic&lighting_mode=sacn_in'
        '&profile=2d_pixels&spotlights=0'
    ),
    'audio': 'http://localhost:6966/',
    'captainpad': 'http://localhost:6967/',
    'hash': 'a' * 64,
}


class RobocopyContractTest(unittest.TestCase):
    """Pin production mirror exclusions and fail-loud diagnostics."""

    def test_both_robocopy_modes_exclude_source_and_destination_git(self) -> None:
        """Dry-run and real sync must never enumerate either .git tree."""
        source = r'C:\design\BM26-Titanic'
        destination = r'\\show-server\titanic\BM26-Titanic'
        for list_only in (True, False):
            with self.subTest(list_only=list_only):
                command = DEPLOY.robocopy_cmd(source, destination, list_only=list_only)
                excluded = command[command.index('/XD') + 1:command.index('/XF')]
                self.assertIn(source + r'\.git', excluded)
                self.assertIn(destination + r'\.git', excluded)
                excluded_files = command[command.index('/XF') + 1:]
                self.assertIn('.git', excluded_files)
                self.assertEqual('/L' in command, list_only)
                self.assertNotIn('/ZB', command)

    def test_exact_git_acl_failure_is_a_loud_invariant_error(self) -> None:
        """The production incident signature must never suggest an ACL fallback."""
        denied_path = (r'\\show-server\titanic\BM26-Titanic\.git\objects\info\packs')
        process = subprocess.CompletedProcess(
            args=['robocopy'],
            returncode=8,
            stdout=(f'ERROR 5 (0x00000005) Accessing Destination File {denied_path}\n'
                    'Access is denied.'),
            stderr='',
        )
        error = io.StringIO()
        with contextlib.redirect_stderr(error), self.assertRaises(SystemExit):
            DEPLOY.robocopy_failure('robocopy /L preview', process)
        message = error.getvalue()
        self.assertIn('attempted to read excluded prod .git metadata', message)
        self.assertIn('do not use /ZB', message)
        self.assertIn(denied_path, message)


class RuntimeSecretPreflightTest(unittest.TestCase):
    """Pin the persistent, redacted BM26_SECRETS gate before stack stop."""

    def test_local_private_source_is_validated_without_printing_values(self) -> None:
        """A valid external YAML resolves while its values stay out of output."""
        scratch_root = Path.home() / 'tmp'
        scratch_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch_root) as temp_dir:
            source = Path(temp_dir) / 'secrets.yaml'
            source.write_text(
                'SinaAuth: owner-test\n'
                'MishaAuth: collaborator-test\n'
                'MARITIME_TERM_FOR_SAILIOR_PASS: bringup-test\n',
                encoding='utf-8',
            )
            output = io.StringIO()
            with mock.patch.dict(os.environ, {'BM26_SECRETS': str(source)}):
                with contextlib.redirect_stdout(output):
                    resolved = DEPLOY.secrets_path()
            self.assertEqual(resolved, source)
            self.assertNotIn('owner-test', output.getvalue())
            self.assertNotIn(str(source), output.getvalue())

    def test_preflight_queries_persistent_scopes_without_echoing_value(self) -> None:
        """A readable persistent secret source passes without exposing its path."""
        process = subprocess.CompletedProcess(
            args=['powershell'],
            returncode=0,
            stdout='BM26_SECRETS_READY scope=Machine\n',
            stderr='',
        )
        with mock.patch.object(DEPLOY, 'ssh_run', return_value=process) as ssh_run:
            DEPLOY.preflight_runtime_secrets(
                {'ssh_user': 'titanic', 'dest': r'C:\titanic\BM26-Titanic'})
        command = ssh_run.call_args.args[1]
        self.assertIn("GetEnvironmentVariable('BM26_SECRETS','User')", command)
        self.assertIn("GetEnvironmentVariable('BM26_SECRETS','Machine')", command)
        self.assertIn('[IO.File]::Open', command)
        self.assertIn('BM26_SECRETS_NOT_READY inside_repo', command)
        self.assertNotIn('Write-Output $path', command)

    def test_missing_persistent_secret_fails_before_deploy(self) -> None:
        """The crash-loop incident signature must stop preflight, fully redacted."""
        process = subprocess.CompletedProcess(
            args=['powershell'],
            returncode=2,
            stdout='',
            stderr='BM26_SECRETS is not provisioned in persistent User or Machine scope',
        )
        error = io.StringIO()
        with mock.patch.object(DEPLOY, 'ssh_run', return_value=process):
            with contextlib.redirect_stderr(error), self.assertRaises(SystemExit):
                DEPLOY.preflight_runtime_secrets(
                    {'ssh_user': 'titanic', 'dest': r'C:\titanic\BM26-Titanic'})
        self.assertIn('failed after secure provisioning', error.getvalue())
        self.assertIn('path and values redacted', error.getvalue())

    def test_remote_paths_are_stable_and_outside_prod(self) -> None:
        """Secret payloads must never enter the mirrored production tree."""
        entry = {
            'share_root': r'C:\titanic',
            'dest': r'C:\titanic\BM26-Titanic',
        }
        paths = DEPLOY._remote_secret_paths(entry)
        self.assertEqual(paths['destination'], r'C:\titanic\private\secrets.yaml')
        self.assertFalse(paths['destination'].lower().startswith(entry['dest'].lower()))

    def test_secure_provisioning_orders_acl_copy_finalize_and_verify(self) -> None:
        """The secret crosses SCP only after its private directory is protected."""
        entry = {
            'host': 'example',
            'ssh_user': 'titanic',
            'share_root': r'C:\titanic',
            'dest': r'C:\titanic\BM26-Titanic',
        }
        prepare = subprocess.CompletedProcess(
            args=['powershell'], returncode=0, stdout='BM26_SECRET_DIRECTORY_READY\n', stderr='')
        finalize = subprocess.CompletedProcess(
            args=['powershell'],
            returncode=0,
            stdout='BM26_SECRETS_PROVISIONED scope=Machine\n',
            stderr='',
        )
        events = []

        def record_copy(_source, _entry, _remote, label):
            events.append(f'copy:{label}')

        def record_ssh(_entry, command, **_kwargs):
            if '-PrepareDirectory' in command:
                events.append('prepare')
                return prepare
            events.append('finalize')
            return finalize

        with (
            mock.patch.object(DEPLOY, '_scp_redacted', side_effect=record_copy),
            mock.patch.object(DEPLOY, 'ssh_run', side_effect=record_ssh),
            mock.patch.object(
                DEPLOY,
                'preflight_runtime_secrets',
                side_effect=lambda *_: events.append('verify'),
            ),
        ):
            DEPLOY.provision_runtime_secrets(entry, Path('private-source.yaml'))
        self.assertEqual(
            events,
            ['copy:provisioner', 'prepare', 'copy:private secret', 'finalize', 'verify'],
        )


class ProductionPipelineTest(unittest.TestCase):
    """Pin safety ordering in the production orchestration."""

    def test_dry_run_checks_secrets_before_smb_preview_and_changes_nothing(self) -> None:
        """Persistent secrets must fail before Robocopy preview or stack stop."""
        args = types.SimpleNamespace(scene=None, restart_only=False, dry_run=True)
        entry = {'scene': 'titanic', 'profile': 'prod'}
        events = []
        with (
            mock.patch.object(
                DEPLOY,
                'git_info',
                return_value={'head': 'abc1234', 'branch': 'feat/test', 'dirty_count': 0},
            ),
            mock.patch.object(
                DEPLOY, 'secrets_path', side_effect=lambda: events.append('local') or Path('s')),
            mock.patch.object(
                DEPLOY, 'preflight_ssh', side_effect=lambda *_: events.append('ssh')),
            mock.patch.object(
                DEPLOY,
                'resolve_shortcut_plan',
                side_effect=lambda *_: events.append('plan') or SHORTCUT_PLAN,
            ),
            mock.patch.object(
                DEPLOY,
                'probe_runtime_secrets',
                side_effect=lambda *_: events.append('probe') or (False, 'missing'),
            ),
            mock.patch.object(
                DEPLOY,
                'preflight_smb',
                side_effect=lambda *_: events.append('smb') or r'\\show\prod',
            ),
            mock.patch.object(
                DEPLOY, 'show_sync_preview', side_effect=lambda *_: events.append('preview')),
            mock.patch.object(DEPLOY, 'stop_stack') as stop_stack,
            mock.patch.object(DEPLOY, 'install_desktop_shortcuts') as shortcuts,
        ):
            DEPLOY.deploy_prod('example', entry, args)
        self.assertEqual(events, ['local', 'ssh', 'plan', 'probe', 'smb', 'preview'])
        stop_stack.assert_not_called()
        shortcuts.assert_not_called()

    def test_real_deploy_provisions_secrets_before_smb_preview_and_stack_stop(self) -> None:
        """A provisioning failure must leave the running stack untouched."""
        args = types.SimpleNamespace(scene=None, restart_only=False, dry_run=False)
        entry = {'scene': 'titanic', 'profile': 'prod'}
        events = []

        def mark(name, result=None):
            return lambda *_args, **_kwargs: events.append(name) or result

        with (
            mock.patch.object(
                DEPLOY,
                'git_info',
                return_value={'head': 'abc1234', 'branch': 'feat/test', 'dirty_count': 0},
            ),
            mock.patch.object(DEPLOY, 'secrets_path', side_effect=mark('local', Path('s'))),
            mock.patch.object(DEPLOY, 'preflight_ssh', side_effect=mark('ssh')),
            mock.patch.object(
                DEPLOY, 'resolve_shortcut_plan', side_effect=mark('plan', SHORTCUT_PLAN)),
            mock.patch.object(
                DEPLOY, 'provision_runtime_secrets', side_effect=mark('provision')),
            mock.patch.object(
                DEPLOY, 'preflight_smb', side_effect=mark('smb', r'\\show\prod')),
            mock.patch.object(DEPLOY, 'show_sync_preview', side_effect=mark('preview')),
            mock.patch.object(DEPLOY, 'stop_stack', side_effect=mark('stop')),
            mock.patch.object(DEPLOY, 'sync_prod', side_effect=mark('sync')),
            mock.patch.object(DEPLOY, 'ship_manifest', side_effect=mark('manifest')),
            mock.patch.object(
                DEPLOY, 'install_desktop_shortcuts', side_effect=mark('shortcuts')),
            mock.patch.object(DEPLOY, 'apply_overlay', side_effect=mark('overlay')),
            mock.patch.object(DEPLOY, 'stamp_deploy_info', side_effect=mark('stamp')),
            mock.patch.object(
                DEPLOY, 'capture_server_time', side_effect=mark('clock', 'server-time')),
            mock.patch.object(DEPLOY, 'start_stack', side_effect=mark('start')),
            mock.patch.object(DEPLOY, 'verify_prod', side_effect=mark('verify')),
        ):
            DEPLOY.deploy_prod('example', entry, args)
        self.assertEqual(
            events,
            [
                'local',
                'ssh',
                'plan',
                'provision',
                'smb',
                'preview',
                'stop',
                'sync',
                'manifest',
                'overlay',
                'shortcuts',
                'stamp',
                'clock',
                'start',
                'verify',
            ],
        )


class FetchMigrationTest(unittest.TestCase):
    """Pin the explicit migration from prod Git metadata to scratch."""

    def test_fetch_defaults_to_scratch(self) -> None:
        """A plain fetch command must target the durable scratch workspace."""
        args = DEPLOY.build_parser().parse_args(['fetch', '--machine', 'example'])
        self.assertEqual(args.source, 'scratch')

    def test_direct_prod_fetch_fails_before_remote_access(self) -> None:
        """Retired prod fetch must fail before SSH or any server mutation."""
        with mock.patch.object(DEPLOY, 'ssh_run') as ssh_run:
            with self.assertRaises(SystemExit):
                DEPLOY.fetch_tree('example', {'dest': r'C:\prod'}, 'prod')
        ssh_run.assert_not_called()


class DesktopShortcutTest(unittest.TestCase):
    """Execute the PowerShell shortcut installer in an isolated desktop."""

    def run_installer(self, desktop: Path, assets: Path) -> subprocess.CompletedProcess:
        """Run the installer as the current user against a test desktop."""
        plan = DEPLOY.resolve_shortcut_plan('test-no-overlay', {'profile': 'prod'}, 'titanic')
        return subprocess.run(
            [
                'powershell',
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                str(SHORTCUT_SCRIPT),
                '-ExpectedUser',
                os.environ['USERNAME'],
                '-RepoRoot',
                str(REPO_ROOT),
                '-LauncherProfile',
                'prod',
                '-Scene',
                'titanic',
                '-AssetsPath',
                str(assets),
                '-ExpectedPlanHash',
                plan['hash'],
                '-DesktopPath',
                str(desktop),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_shortcuts_are_exact_verified_and_idempotent(self) -> None:
        """All three localhost links update once and then remain unchanged."""
        scratch_root = Path.home() / 'tmp'
        scratch_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch_root) as temp_dir:
            root = Path(temp_dir)
            desktop = root / 'desktop'
            assets = root / 'stable-assets'
            desktop.mkdir()
            (desktop / 'Old BM26 Console.url').write_text(
                '[InternetShortcut]\nURL=http://localhost:6969/simulation/\n',
                encoding='ascii',
            )
            (desktop / 'Simulation.url').write_text(
                '[InternetShortcut]\nURL=https://example.invalid/\n',
                encoding='ascii',
            )
            (desktop / 'BM26 Simulation.lnk').write_bytes(b'retired')
            first = self.run_installer(desktop, assets)
            self.assertEqual(first.returncode, 0, first.stderr or first.stdout)
            self.assertIn('DESKTOP SHORTCUTS VERIFIED: updated=3 removed=3', first.stdout)
            self.assertIn('icons_updated=3', first.stdout)
            expected = {
                'Titanic Simulation.url': SHORTCUT_PLAN['simulation'],
                'Audio Companion.url': 'http://localhost:6966/',
                'CaptainPad Web.url': 'http://localhost:6967/',
            }
            for name, url in expected.items():
                lines = (desktop / name).read_text(encoding='ascii').splitlines()
                self.assertEqual(lines[0:2], ['[InternetShortcut]', f'URL={url}'])
                self.assertTrue(lines[2].startswith(f'IconFile={assets}'))
                self.assertEqual(lines[3], 'IconIndex=0')

            icons = sorted(assets.glob('*.ico'))
            self.assertEqual(len(icons), 3)
            self.assertEqual(len({icon.read_bytes() for icon in icons}), 3)
            self.assertFalse((desktop / 'Old BM26 Console.url').exists())
            self.assertFalse((desktop / 'Simulation.url').exists())
            self.assertFalse((desktop / 'BM26 Simulation.lnk').exists())

            second = self.run_installer(desktop, assets)
            self.assertEqual(second.returncode, 0, second.stderr or second.stdout)
            self.assertIn('updated=0 removed=0 icons_updated=0', second.stdout)

    def test_deploy_helper_requires_the_verification_banner(self) -> None:
        """A zero exit without verified shortcut content must still fail loudly."""
        entry = {
            'dest': r'C:\titanic\BM26-Titanic',
            'share_root': r'C:\titanic',
            'ssh_user': 'titanic',
        }
        process = subprocess.CompletedProcess(
            args=['powershell'], returncode=0, stdout='script returned early', stderr='')
        with mock.patch.object(DEPLOY, 'ssh_run', return_value=process):
            with self.assertRaises(SystemExit):
                DEPLOY.install_desktop_shortcuts(entry, SHORTCUT_PLAN)

    def test_deploy_helper_runs_shipped_installer_as_registered_user(self) -> None:
        """The full deploy must target the synced script and registered identity."""
        entry = {
            'dest': r'C:\titanic\BM26-Titanic',
            'share_root': r'C:\titanic',
            'ssh_user': 'titanic',
        }
        process = subprocess.CompletedProcess(
            args=['powershell'],
            returncode=0,
            stdout=f'DESKTOP SHORTCUTS VERIFIED: updated=0 plan={SHORTCUT_PLAN["hash"]}\n',
            stderr='',
        )
        with mock.patch.object(DEPLOY, 'ssh_run', return_value=process) as ssh_run:
            DEPLOY.install_desktop_shortcuts(entry, SHORTCUT_PLAN)
        remote_command = ssh_run.call_args.args[1]
        self.assertIn(r'deploy\setup\install_desktop_shortcuts.ps1', remote_command)
        self.assertIn('-ExpectedUser "titanic"', remote_command)
        self.assertIn('-LauncherProfile "prod"', remote_command)
        self.assertIn('-Scene "titanic"', remote_command)
        self.assertIn(r'-AssetsPath "C:\titanic\operator_shortcuts\icons"', remote_command)

    def test_installer_refuses_the_wrong_windows_identity(self) -> None:
        """Shortcut writes must not land on an unrelated account's desktop."""
        scratch_root = Path.home() / 'tmp'
        scratch_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch_root) as temp_dir:
            process = subprocess.run(
                [
                    'powershell',
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    str(SHORTCUT_SCRIPT),
                    '-ExpectedUser',
                    'definitely-not-the-current-user',
                    '-RepoRoot',
                    str(REPO_ROOT),
                    '-LauncherProfile',
                    'prod',
                    '-Scene',
                    'titanic',
                    '-AssetsPath',
                    str(Path(temp_dir) / 'assets'),
                    '-ExpectedPlanHash',
                    'a' * 64,
                    '-DesktopPath',
                    temp_dir,
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertNotEqual(process.returncode, 0)
            self.assertIn('Desktop shortcut identity mismatch', process.stderr)
            self.assertEqual(list(Path(temp_dir).iterdir()), [])

    def test_plan_uses_launcher_profile_and_config_ports_without_drift(self) -> None:
        """The dry-run resolver must match the launcher's authoritative URL."""
        plan = DEPLOY.resolve_shortcut_plan('test-no-overlay', {'profile': 'prod'}, 'titanic')
        self.assertEqual(plan['lightingProfile'], '2d_pixels')
        self.assertEqual(plan['simulation'], SHORTCUT_PLAN['simulation'])
        self.assertEqual(plan['audio'], SHORTCUT_PLAN['audio'])
        self.assertEqual(plan['captainpad'], SHORTCUT_PLAN['captainpad'])


class NoLaunchContractTest(unittest.TestCase):
    """Pin deployment/restart startup to the headless launcher contract."""

    def test_boot_supervisor_has_no_browser_open_path(self) -> None:
        """The supervisor must use --no-launch and never open browser tabs itself."""
        source = BOOT_SCRIPT.read_text(encoding='utf-8')
        self.assertIn(
            "$launchArgs = @($launcher, $profile, '--scene', $scene, '--no-launch')",
            source,
        )
        self.assertNotIn('Start-Process $t.Open', source)
        self.assertNotIn('BM26BrowserOpen', source)

    def test_start_verifies_no_launch_before_firing_scheduled_task(self) -> None:
        """A stale boot script fails before schtasks can start it."""
        process = subprocess.CompletedProcess(args=['ssh'], returncode=0, stdout='', stderr='')
        entry = {'dest': r'C:\titanic\BM26-Titanic'}
        with mock.patch.object(DEPLOY, 'ssh_run', return_value=process) as ssh_run:
            DEPLOY.start_stack(entry)
        commands = [call.args[1] for call in ssh_run.call_args_list]
        self.assertEqual(len(commands), 2)
        self.assertIn(
            "$launchArgs = @($launcher, $profile, '--scene', $scene, '--no-launch')",
            commands[0],
        )
        self.assertIn('boot_server.ps1', commands[0])
        self.assertIn('schtasks /Run', commands[1])


class RuntimeProvisionerScriptTest(unittest.TestCase):
    """Execute the ACL/persistence helper without touching Machine scope."""

    def run_script(self, arguments: list[str]) -> subprocess.CompletedProcess:
        """Run the provisioner with explicit isolated paths."""
        return subprocess.run(
            [
                'powershell',
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                str(PROVISION_SCRIPT),
                *arguments,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_prepare_finalize_and_process_scope_verification(self) -> None:
        """The helper protects a private dir, converges the file, and verifies."""
        scratch_root = Path.home() / 'tmp'
        scratch_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch_root) as temp_dir:
            root = Path(temp_dir)
            repo = root / 'repo'
            repo.mkdir()
            destination = root / 'private' / 'secrets.yaml'
            temporary = root / 'private' / 'secrets.yaml.bm26-new'
            common = [
                '-ExpectedUser',
                os.environ['USERNAME'],
                '-DestinationPath',
                str(destination),
                '-RepoRoot',
                str(repo),
            ]
            prepare = self.run_script([*common, '-PrepareDirectory'])
            self.assertEqual(prepare.returncode, 0, prepare.stderr or prepare.stdout)
            self.assertIn('BM26_SECRET_DIRECTORY_READY', prepare.stdout)

            payload = 'SinaAuth: owner-test\nMishaAuth: collaborator-test\n'
            payload += 'MARITIME_TERM_FOR_SAILIOR_PASS: bringup-test\n'
            temporary.write_text(payload, encoding='utf-8')
            finalize = self.run_script(
                [
                    *common,
                    '-SourceTempPath',
                    str(temporary),
                    '-EnvironmentTarget',
                    'Process',
                ]
            )
            self.assertEqual(finalize.returncode, 0, finalize.stderr or finalize.stdout)
            self.assertIn('BM26_SECRETS_PROVISIONED scope=Process', finalize.stdout)
            self.assertEqual(destination.read_text(encoding='utf-8'), payload)
            self.assertFalse(temporary.exists())

    def test_machine_scope_removes_a_stale_user_override(self) -> None:
        """A User path must not shadow the provisioned Machine path at reboot."""
        script = PROVISION_SCRIPT.read_text(encoding='utf-8')
        self.assertIn(
            "SetEnvironmentVariable('BM26_SECRETS', $null, 'User')",
            script,
        )


if __name__ == '__main__':
    unittest.main()
