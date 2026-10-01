#!/usr/bin/env python3
"""Start disposable loopback SQL servers, run contracts, and always stop them."""
import os
import pathlib
import socket
import ssl
import threading
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
PG_BIN = pathlib.Path(os.environ.get('MYSQL_COMPARE_PG_BIN', '/opt/homebrew/opt/postgresql@14/bin'))
MYSQL_BIN = pathlib.Path(os.environ.get('MYSQL_COMPARE_MYSQL_BIN', '/opt/homebrew/opt/mysql/bin'))
REDIS_BIN = pathlib.Path(os.environ.get('MYSQL_COMPARE_REDIS_BIN', '/opt/homebrew/bin/redis-server'))


def port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def run(args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, **kwargs)


class RedisTlsProbe:
    """Minimal RESP endpoint: proves transport verification, not Redis semantics."""
    def __init__(self, cert, key):
        self.listener = socket.socket()
        self.listener.bind(('127.0.0.1', 0))
        self.listener.listen(8)
        self.listener.settimeout(.2)
        self.port = self.listener.getsockname()[1]
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.load_cert_chain(cert, key)
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while not self.stop.is_set():
            try:
                client, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            try:
                client.settimeout(5)
                with self.context.wrap_socket(client, server_side=True) as secured:
                    reader = secured.makefile('rb')
                    while not self.stop.is_set():
                        header = reader.readline()
                        if not header:
                            break
                        if not header.startswith(b'*'):
                            break
                        arguments = []
                        for _ in range(int(header[1:].strip())):
                            size = int(reader.readline()[1:].strip())
                            arguments.append(reader.read(size))
                            reader.read(2)
                        command = arguments[0].upper()
                        secured.sendall(b'+PONG\r\n' if command == b'PING' else b'+OK\r\n')
            except (OSError, ValueError):
                client.close()

    def close(self):
        self.stop.set()
        self.listener.close()
        self.thread.join(timeout=6)


def main():
    run(['cargo', 'test', '--manifest-path', ROOT / 'src-tauri/Cargo.toml', '--locked', '--offline', '--lib', '--no-run'], cwd=ROOT)
    env = os.environ.copy()
    mysql_port, pg_port = port(), port()
    env['MYSQL_COMPARE_MYSQL_TEST_PORT'] = str(mysql_port)
    env['MYSQL_COMPARE_PG_TEST_PORT'] = str(pg_port)
    mysql = None
    pg_started = False
    redis_tls = None
    redis_server = None
    with tempfile.TemporaryDirectory(prefix='mysql-compare-contract-') as directory:
        work = pathlib.Path(directory)
        pg_data, mysql_data = work / 'pg', work / 'mysql'
        mysql_data.mkdir()
        with (work / 'setup.log').open('w') as log:
            try:
                # Disposable CA and IP-only server certificate prove successful
                # verification plus fail-closed untrusted CA/hostname behavior.
                ca_key, ca_cert = work / 'ca.key', work / 'ca.crt'
                server_key, server_csr, server_cert = work / 'server.key', work / 'server.csr', work / 'server.crt'
                extensions = work / 'server.ext'
                extensions.write_text('subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n')
                run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Disposable Compare CA', '-keyout', ca_key, '-out', ca_cert], stdout=log, stderr=log)
                run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-keyout', server_key, '-out', server_csr], stdout=log, stderr=log)
                run(['openssl', 'x509', '-req', '-in', server_csr, '-CA', ca_cert, '-CAkey', ca_key, '-CAcreateserial', '-days', '1', '-extfile', extensions, '-out', server_cert], stdout=log, stderr=log)
                server_key.chmod(0o600)
                ca_key.chmod(0o600)
                env['MYSQL_COMPARE_TEST_CA_PEM'] = str(ca_cert)
                redis_tls = RedisTlsProbe(server_cert, server_key)
                env['MYSQL_COMPARE_REDIS_TLS_TEST_PORT'] = str(redis_tls.port)
                run([PG_BIN / 'initdb', '-D', pg_data, '-U', 'contract_test', '-A', 'trust', '--no-locale', '--encoding=UTF8'], stdout=log, stderr=log)
                with (pg_data / 'postgresql.conf').open('a') as config:
                    config.write(f"\nssl=on\nssl_cert_file='{server_cert}'\nssl_key_file='{server_key}'\n")
                hba = pg_data / 'pg_hba.conf'
                hba.write_text('host all browse_user,browse_other_user 127.0.0.1/32 scram-sha-256\n' + hba.read_text())
                run([PG_BIN / 'pg_ctl', '-D', pg_data, '-l', work / 'postgres.log', '-o', f'-p {pg_port} -h 127.0.0.1 -k {work}', '-w', 'start'], stdout=log, stderr=log)
                pg_started = True
                run([PG_BIN / 'createdb', '-h', '127.0.0.1', '-p', pg_port, '-U', 'contract_test', 'contracts'])
                run([MYSQL_BIN / 'mysqld', '--no-defaults', '--initialize-insecure', f'--datadir={mysql_data}'], stdout=log, stderr=log)
                mysql = subprocess.Popen([str(MYSQL_BIN / 'mysqld'), '--no-defaults', f'--datadir={mysql_data}', f'--port={mysql_port}', '--bind-address=127.0.0.1', f'--socket={work}/mysql.sock', f'--pid-file={work}/mysql.pid', '--mysqlx=OFF', f'--ssl-ca={ca_cert}', f'--ssl-cert={server_cert}', f'--ssl-key={server_key}'], stdout=log, stderr=log)
                for _ in range(100):
                    try:
                        with socket.create_connection(('127.0.0.1', mysql_port), timeout=.2):
                            break
                    except OSError:
                        if mysql.poll() is not None:
                            raise RuntimeError('Disposable MySQL exited during startup')
                        time.sleep(.1)
                run([MYSQL_BIN / 'mysql', '--no-defaults', '-h', '127.0.0.1', '-P', mysql_port, '-u', 'root', '-e', 'CREATE DATABASE contracts'])
                redis_port = port()
                env['MYSQL_COMPARE_REDIS_TEST_PORT'] = str(redis_port)
                redis_server = subprocess.Popen([str(REDIS_BIN), '--bind', '127.0.0.1', '--port', str(redis_port), '--save', '', '--appendonly', 'no', '--dir', str(work)], stdout=log, stderr=log)
                for _ in range(100):
                    try:
                        with socket.create_connection(('127.0.0.1', redis_port), timeout=.2):
                            break
                    except OSError:
                        if redis_server.poll() is not None:
                            raise RuntimeError('Disposable Redis exited during startup')
                        time.sleep(.1)

                run(['cargo', 'test', '--manifest-path', ROOT / 'src-tauri/Cargo.toml', '--locked', '--offline', '--lib', 'data_contract_tests', '--', '--ignored', '--nocapture'], cwd=ROOT, env=env)
            except Exception:
                log.flush()
                print((work / 'setup.log').read_text()[-5000:])
                raise
            finally:
                if redis_tls is not None:
                    redis_tls.close()
                if redis_server is not None:
                    redis_server.terminate()
                    try:
                        redis_server.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        redis_server.kill()
                        redis_server.wait()
                if mysql is not None:
                    mysql.terminate()
                    try:
                        mysql.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        mysql.kill()
                        mysql.wait()
                if pg_started:
                    run([PG_BIN / 'pg_ctl', '-D', pg_data, '-m', 'immediate', '-w', 'stop'], stdout=log, stderr=log)


if __name__ == '__main__':
    main()
