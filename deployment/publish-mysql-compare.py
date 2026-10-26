#!/usr/bin/python3 -I
"""Non-root, single-application publisher. Root installs this file read-only."""

import base64
import errno
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
from urllib.parse import quote
import pwd
import re
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import tarfile
import tempfile
import time

DEPLOY_USER = "mysql-compare-deploy"
APP_ROOT = Path("/var/www/mysql-compare")
RELEASES = APP_ROOT / "releases"
STATE = Path("/var/lib/mysql-compare-deploy")
INCOMING = STATE / "incoming"
SUDO = "/usr/bin/sudo"
SYSTEMCTL = "/usr/bin/systemctl"
UNITS = ("mysql-compare.service",)
APP_HOST = "mysql-compare.dogeow.com"
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_UNPACKED = 64 * 1024 * 1024
MAX_MEMBER = 8 * 1024 * 1024
MAX_MEMBERS = 10000
MIN_FREE_DISK = 1024 * 1024 * 1024
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
RUNTIME_DIRS = {"src", "dist-web", "node_modules"}
ROOT_FILES = {"package.json", "package-lock.json", "LICENSE"}
ROOT_REQUIRED = {"package.json", "package-lock.json", "src/web/index.mjs", "dist-web/index.html", "node_modules/express/package.json", "node_modules/mysql2/package.json", "node_modules/pg/package.json", "node_modules/redis/package.json", "node_modules/ssh2/package.json", "node_modules/uuid/package.json"}
PRIVATE_NAMES = {".git", ".ssh", ".codex", ".npmrc", ".gitconfig", "auth.json", "id_rsa", "id_ed25519"}


class DeployError(RuntimeError):
    pass


class RuntimeFiles(dict):
    def __init__(self, files, expanded_bytes):
        super().__init__(files)
        self.expanded_bytes = expanded_bytes


def require(condition, message):
    if not condition:
        raise DeployError(message)


def check_sha(revision):
    require(isinstance(revision, str) and SHA_RE.fullmatch(revision), "Invalid release SHA.")
    return revision


def allowed_member(name):
    path = PurePosixPath(name)
    parts = path.parts
    require(name and not path.is_absolute() and name == path.as_posix(), "Noncanonical archive path.")
    require(all(part not in ("", ".", "..") for part in parts), "Unsafe archive path.")
    require(not any(part.startswith(".env") or part in PRIVATE_NAMES for part in parts), "Private file in archive.")
    require(parts[0] in RUNTIME_DIRS or (len(parts) == 1 and name in ROOT_FILES), "Unexpected runtime path.")
    return path


def checked_directory(path, owner=None, root_immutable=False):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode), "Expected a real directory.")
    if owner is not None:
        require(info.st_uid == owner, "Directory owner mismatch.")
    if root_immutable:
        require(info.st_uid == 0 and not info.st_mode & 0o022, "Protected root directory is writable.")


def current_release():
    link = RELEASES / "current"
    require(link.is_symlink(), "The managed current link is missing.")
    value = os.readlink(link)
    require(SHA_RE.fullmatch(value), "Unexpected current release target.")
    checked_directory(RELEASES / value)
    return value


def switch_current(revision):
    # Only the inner releases/current link changes. Root owns the outer link.
    temporary = RELEASES / (".current-" + str(os.getpid()))
    require(not os.path.lexists(temporary), "Temporary activation path already exists.")
    os.symlink(revision, temporary)
    try:
        os.replace(temporary, RELEASES / "current")
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def runtime_environment():
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": str(STATE),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
    }


def run_silent(arguments, cwd=None, timeout=90):
    result = subprocess.run(arguments, cwd=cwd, env=runtime_environment(),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, check=False)
    require(result.returncode == 0, "A deployment command failed; private command output was suppressed.")
    return result.stdout


def restart_services():
    # The sudoers file authorizes exactly these one argument list.
    for unit in UNITS:
        run_silent([SUDO, "-n", SYSTEMCTL, "restart", unit], timeout=60)
        run_silent([SYSTEMCTL, "is-active", "--quiet", unit], timeout=15)


def inspect_archive(archive, revision):
    files = {}
    members = []
    total = 0
    manifest = None
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            require(len(members) < MAX_MEMBERS, "Too many archive members.")
            require(member.isfile(), "Archive links, devices and directory entries are forbidden.")
            require(member.size >= 0 and member.size <= MAX_MEMBER, "Archive member is too large.")
            require(member.name not in files, "Duplicate archive member.")
            total += member.size
            require(total <= MAX_UNPACKED, "Expanded runtime exceeds its limit.")
            if member.name == "deploy-manifest.json":
                require(manifest is None and member.size <= 8 * 1024 * 1024, "Invalid manifest.")
                manifest = json.loads(source.extractfile(member).read())
            else:
                allowed_member(member.name)
            files[member.name] = member.size
            members.append(member.name)
    require(isinstance(manifest, dict) and manifest.get("schema") == 1 and manifest.get("revision") == revision and manifest.get("application") == "mysql-compare-web" and SHA_RE.fullmatch(str(manifest.get("source_revision", ""))) and SHA_RE.fullmatch(str(manifest.get("workflow_revision", ""))),
            "Runtime manifest does not match this release.")
    expected = manifest.get("files")
    require(isinstance(expected, dict) and set(expected) == set(files) - {"deploy-manifest.json"},
            "Runtime manifest file list mismatch.")
    require(ROOT_REQUIRED <= set(expected), "Required runtime files are missing.")
    for name, digest in expected.items():
        require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest), "Invalid runtime checksum.")
    return RuntimeFiles(expected, total)


def extract_archive(archive, stage, expected):
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            if member.name == "deploy-manifest.json":
                continue
            require(member.isfile() and member.name in expected, "Runtime changed after inspection.")
            path = stage.joinpath(*allowed_member(member.name).parts)
            path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            digest = hashlib.sha256()
            with source.extractfile(member) as content, os.fdopen(fd, "wb") as target:
                copied = 0
                while True:
                    chunk = content.read(1024 * 1024)
                    if not chunk:
                        break
                    copied += len(chunk)
                    require(copied <= member.size and copied <= MAX_MEMBER, "Runtime member size changed.")
                    digest.update(chunk)
                    target.write(chunk)
                os.fchmod(target.fileno(), 0o644)
            require(copied == member.size and digest.hexdigest() == expected[member.name], "Runtime checksum failed.")
    # Keep non-secret provenance with this one runtime copy.
    with tarfile.open(archive, "r:gz") as source:
        data = source.extractfile("deploy-manifest.json").read()
    (stage / "deploy-manifest.json").write_bytes(data)
    os.chmod(stage / "deploy-manifest.json", 0o644)
    for directory, _, _ in os.walk(stage, followlinks=False):
        os.chmod(directory, 0o755)


class LocalTLSConnection(http.client.HTTPSConnection):
    def connect(self):
        self.sock = ssl.create_default_context().wrap_socket(
            socket.create_connection(("127.0.0.1", 443), timeout=10), server_hostname=APP_HOST)


def request(path):
    connection = LocalTLSConnection(APP_HOST, 443, timeout=10)
    try:
        connection.request("GET", path, headers={"Host": APP_HOST, "Connection": "close"})
        response = connection.getresponse()
        data = response.read(1024 * 1024 + 1)
        require(len(data) <= 1024 * 1024, "Health response exceeds its limit.")
        return response.status, data
    finally:
        connection.close()


def health(release):
    # No private Basic credential, connection record or runtime environment is read.
    status, body = request("/api/health")
    data = json.loads(body)
    require(status == 200 and data.get("ok") is True and data.get("data", {}).get("status") == "ok",
            "API TLS health failed.")
    for route in ("/", "/api/session", "/api/connections"):
        status, _ = request(route)
        require(status == 401, "Anonymous access was not rejected.")


def wait_for_health(release):
    last = None
    for attempt in range(8):
        try:
            health(release)
            return
        except (DeployError, OSError, ValueError, http.client.HTTPException) as error:
            last = error
            if attempt < 7:
                time.sleep(1)
    raise DeployError("API health checks failed after service startup.") from last


def remove_old_release(name):
    require(SHA_RE.fullmatch(name), "Unknown cleanup target.")
    path = RELEASES / name
    checked_directory(path)
    # Python uses fd-based symlink-safe rmtree; never follow the storage/.env links.
    require(shutil.rmtree.avoids_symlink_attacks, "Safe directory cleanup is unavailable.")
    shutil.rmtree(path)


def connection_count(runtime_uid, tables=(Path("/proc/net/tcp"), Path("/proc/net/tcp6"))):
    count = 0
    for table in tables:
        if not table.exists():
            continue
        for row in table.read_text().splitlines()[1:]:
            parts = row.split()
            require(len(parts) >= 8, "Unexpected socket table format.")
            if parts[3] == "01" and int(parts[7]) == runtime_uid:
                count += 1
    return count


def wait_for_idle():
    # The dedicated runtime UID makes inbound HTTP/SSE and outbound DB/SSH
    # sockets visible as counts, without reading process memory or credentials.
    uid = pwd.getpwnam("mysql-compare").pw_uid
    quiet = 0
    for attempt in range(30):
        if connection_count(uid) == 0:
            quiet += 1
            if quiet >= 5:
                return
        else:
            quiet = 0
        if attempt < 29:
            time.sleep(1)
    raise DeployError("A database, SSH, SSE or HTTP connection is active; publish after disconnecting it.")


def publish(revision):
    check_sha(revision)
    old = current_release()
    require(old != revision, "This release is already active.")
    require(not os.path.lexists(RELEASES / revision), "Release directory already exists.")
    # Unknown content must not be silently deleted to satisfy a release-count claim.
    allowed = {old, "current"}
    require(all(path.name in allowed or path.name.startswith(".") for path in RELEASES.iterdir()),
            "Unexpected existing release directory; review it before publishing.")
    archive = INCOMING / (revision + ".tar.gz")
    info = archive.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_size <= MAX_ARCHIVE,
            "Incoming runtime permissions are invalid.")
    try:
        expected = inspect_archive(archive, revision)
        require(shutil.disk_usage(RELEASES).free >= expected.expanded_bytes + MIN_FREE_DISK,
                "Insufficient disk space: preserve at least 1 GiB free after extracting this runtime.")
    except BaseException:
        archive.unlink()
        raise
    stage = Path(tempfile.mkdtemp(prefix=".prepare-" + revision + "-", dir=RELEASES))
    accepted = False
    activated = False
    final = RELEASES / revision
    try:
        extract_archive(archive, stage, expected)
        os.rename(stage, final)
        # Refuse to restart until the dedicated runtime UID has no established
        # inbound or outbound sockets for five consecutive checks.
        wait_for_idle()
        switch_current(revision)
        activated = True
        restart_services()
        wait_for_health(final)
        accepted = True
        remove_old_release(old)
        print(json.dumps({"published": revision, "healthy": True, "retained_releases": 1,
                          "persistent_data_modified": False, "runtime_credentials_read": False}))
    except BaseException:
        if activated and not accepted:
            switch_current(old)
            restart_services()
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        if not accepted and final.exists() and current_release() != revision:
            remove_old_release(revision)
        if archive.exists():
            archive.unlink()


def receive(revision, source):
    check_sha(revision)
    # Serialize commands with the publish lock and keep at most one upload.
    # A failed CI job must not accumulate arbitrary 32 MiB archives on B.
    for previous in INCOMING.iterdir():
        require(re.fullmatch(r"[0-9a-f]{40}\.tar\.gz", previous.name), "Unknown incoming entry.")
        info = previous.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid(), "Unsafe incoming entry.")
        previous.unlink()
    require(shutil.disk_usage(INCOMING).free >= MAX_ARCHIVE + MIN_FREE_DISK,
            "Insufficient upload space: preserve the maximum upload allowance and 1 GiB free.")
    target = INCOMING / (revision + ".tar.gz")
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as destination:
            total = 0
            while True:
                part = source.read(1024 * 1024)
                if not part:
                    break
                total += len(part)
                require(total <= MAX_ARCHIVE, "Compressed runtime exceeds its upload limit.")
                destination.write(part)
            require(total > 0, "Empty runtime upload.")
        print(json.dumps({"received": revision, "compressed_bytes": total}))
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def main(arguments):
    os.umask(0o027)
    require(os.geteuid() != 0 and os.geteuid() == pwd.getpwnam(DEPLOY_USER).pw_uid,
            "This program only runs as the non-root MySQL Compare deploy account.")
    require(len(arguments) == 2 and arguments[0] in {"receive", "publish", "validate"}, "Invalid deployment command.")
    command, revision = arguments
    check_sha(revision)
    checked_directory(APP_ROOT, root_immutable=True)
    require((APP_ROOT / "current").is_symlink() and os.readlink(APP_ROOT / "current") == "releases/current",
            "The protected outer current link is not configured.")
    checked_directory(INCOMING, owner=os.geteuid())
    lock = STATE / "publish.lock"
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, "r+") as file:
        require(stat.S_ISREG(os.fstat(file.fileno()).st_mode), "Invalid publish lock.")
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if command == "receive":
            receive(revision, sys.stdin.buffer)
        elif command == "validate":
            wait_for_health(APP_ROOT / "current")
            print(json.dumps({"healthy": True, "current": current_release(), "persistent_data_modified": False}))
        else:
            publish(revision)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except BaseException as error:
        if isinstance(error, DeployError):
            print(str(error), file=sys.stderr)
        else:
            print("MySQL Compare publish did not complete; inspect protected deployment logs.", file=sys.stderr)
        sys.exit(1)
