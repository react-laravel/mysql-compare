#!/usr/bin/env python3
"""Start disposable loopback SQL servers, run contracts, and always stop them."""
import os
import pathlib
import socket
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
PG_BIN = pathlib.Path(os.environ.get('MYSQL_COMPARE_PG_BIN', '/opt/homebrew/opt/postgresql@14/bin'))
MYSQL_BIN = pathlib.Path(os.environ.get('MYSQL_COMPARE_MYSQL_BIN', '/opt/homebrew/opt/mysql/bin'))


def port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def run(args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def main():
    run(['cargo', 'test', '--manifest-path', ROOT / 'src-tauri/Cargo.toml', '--locked', '--offline', '--lib', '--no-run'], cwd=ROOT)
    env = os.environ.copy()
    mysql_port, pg_port = port(), port()
    env['MYSQL_COMPARE_MYSQL_TEST_PORT'] = str(mysql_port)
    env['MYSQL_COMPARE_PG_TEST_PORT'] = str(pg_port)
    mysql = None
    pg_started = False
    with tempfile.TemporaryDirectory(prefix='mysql-compare-contract-') as directory:
        work = pathlib.Path(directory)
        pg_data, mysql_data = work / 'pg', work / 'mysql'
        mysql_data.mkdir()
        with (work / 'setup.log').open('w') as log:
            try:
                run([PG_BIN / 'initdb', '-D', pg_data, '-U', 'contract_test', '-A', 'trust', '--no-locale', '--encoding=UTF8'], stdout=log, stderr=log)
                hba = pg_data / 'pg_hba.conf'
                hba.write_text('host all browse_user,browse_other_user 127.0.0.1/32 scram-sha-256\n' + hba.read_text())
                run([PG_BIN / 'pg_ctl', '-D', pg_data, '-l', work / 'postgres.log', '-o', f'-p {pg_port} -h 127.0.0.1 -k {work}', '-w', 'start'], stdout=log, stderr=log)
                pg_started = True
                run([PG_BIN / 'createdb', '-h', '127.0.0.1', '-p', pg_port, '-U', 'contract_test', 'contracts'])
                run([MYSQL_BIN / 'mysqld', '--no-defaults', '--initialize-insecure', f'--datadir={mysql_data}'], stdout=log, stderr=log)
                mysql = subprocess.Popen([str(MYSQL_BIN / 'mysqld'), '--no-defaults', f'--datadir={mysql_data}', f'--port={mysql_port}', '--bind-address=127.0.0.1', f'--socket={work}/mysql.sock', f'--pid-file={work}/mysql.pid', '--mysqlx=OFF'], stdout=log, stderr=log)
                for _ in range(100):
                    try:
                        with socket.create_connection(('127.0.0.1', mysql_port), timeout=.2):
                            break
                    except OSError:
                        if mysql.poll() is not None:
                            raise RuntimeError('Disposable MySQL exited during startup')
                        time.sleep(.1)
                run([MYSQL_BIN / 'mysql', '--no-defaults', '-h', '127.0.0.1', '-P', mysql_port, '-u', 'root', '-e', 'CREATE DATABASE contracts'])
                run(['cargo', 'test', '--manifest-path', ROOT / 'src-tauri/Cargo.toml', '--locked', '--offline', '--lib', 'data_contract_tests', '--', '--ignored', '--nocapture'], cwd=ROOT, env=env)
            except Exception:
                log.flush()
                print((work / 'setup.log').read_text()[-5000:])
                raise
            finally:
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
