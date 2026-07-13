<?php

namespace Deployer;

require 'recipe/common.php';

set('application', 'mysql-compare');
set('keep_releases', 2);
set('git_tty', false);
set('workspace_root', __DIR__);
set('writable_mode', 'chmod');
set('writable_recursive', true);
set('writable_chmod_mode', '0775');
set('verify_base_url', getenv('VERIFY_BASE_URL') ?: 'https://mysql-compare.dogeow.com');
set('local_healthcheck_base_url', 'http://127.0.0.1:' . (getenv('PORT') ?: '3006'));
set('runtime_env_file', getenv('MYSQL_COMPARE_ENV_FILE') ?: '/etc/mysql-compare/web.env');
set('pm2_home', getenv('PM2_HOME') ?: '/var/www/.pm2');
add('shared_dirs', ['logs']);
add('writable_dirs', ['logs']);

localhost('production')
    ->set('deploy_path', getenv('DEPLOY_PATH') ?: '/var/www/mysql-compare')
    ->set('pm2_app', getenv('PM2_APP') ?: 'mysql-compare');

task('deploy:update_code', function () {
    $workspaceRoot = rtrim(get('workspace_root'), '/');
    run('mkdir -p {{release_path}}');
    run('rsync -a --exclude=.git --exclude=node_modules --exclude=dist --exclude=dist-web --exclude=out --exclude=.next --exclude=coverage --exclude=logs --exclude=releases --exclude=current --exclude=client/node_modules --exclude=server/node_modules --exclude=client/dist ' . $workspaceRoot . '/ {{release_path}}/');
});

task('deploy:runtime_files', function () {
    run(<<<'BASH'
bash -lc '
set -euo pipefail
mkdir -p "{{deploy_path}}/logs" "{{deploy_path}}/shared"
for file in .env .env.local .env.production .env.production.local .npmrc; do
  if [ -f "{{deploy_path}}/$file" ]; then
    cp "{{deploy_path}}/$file" "{{release_path}}/$file"
  fi
done
'
BASH);
});

task('deploy:vendors', function () {
    run('cd {{release_path}} && npm ci --ignore-scripts');
});

task('deploy:build', function () {
    run('cd {{release_path}} && NODE_OPTIONS=--max-old-space-size=4096 npm run web:build');
});

task('pm2:restart', function () {
    run(<<<'BASH'
bash -lc '
set -euo pipefail
app_name="{{pm2_app}}"
runtime_cwd="{{current_path}}"
ecosystem_path="{{current_path}}/ecosystem.config.cjs"
runtime_env_file="{{runtime_env_file}}"
pm2_home="{{pm2_home}}"

if [ ! -r "$runtime_env_file" ]; then
  echo "Required runtime environment file is not readable: $runtime_env_file" >&2
  exit 1
fi

set -a
. "$runtime_env_file"
set +a

for variable in MYSQL_COMPARE_SECRET MYSQL_COMPARE_WEB_USERNAME MYSQL_COMPARE_WEB_PASSWORD MYSQL_COMPARE_ALLOWED_ORIGINS; do
  if [ -z "${!variable:-}" ]; then
    echo "Required runtime variable is missing: $variable" >&2
    exit 1
  fi
done

MYSQL_COMPARE_DATA_DIR="${MYSQL_COMPARE_DATA_DIR:-{{deploy_path}}/shared/data}"
export MYSQL_COMPARE_DATA_DIR
mkdir -p "$MYSQL_COMPARE_DATA_DIR" "$pm2_home"
chmod 0700 "$MYSQL_COMPARE_DATA_DIR" "$pm2_home"

pm2_untracked() { env -u RUNNER_TRACKING_ID PM2_HOME="$pm2_home" pm2 "$@"; }
if pm2_untracked info "$app_name" >/dev/null 2>&1; then
  env -u RUNNER_TRACKING_ID PM2_HOME="$pm2_home" PM2_CWD="$runtime_cwd" APP_ROOT="{{deploy_path}}" PORT="${PORT:-3006}" pm2 restart "$ecosystem_path" --only "$app_name" --update-env
else
  env -u RUNNER_TRACKING_ID PM2_HOME="$pm2_home" PM2_CWD="$runtime_cwd" APP_ROOT="{{deploy_path}}" PORT="${PORT:-3006}" pm2 start "$ecosystem_path" --only "$app_name" --update-env
fi
pm2_untracked save
chmod 0600 "$pm2_home/dump.pm2"
pm2_untracked status
'
BASH);
});

task('deploy:healthcheck', function () {
    run(<<<'BASH'
bash -lc '
set -euo pipefail
for i in 1 2 3 4 5; do
  if curl --noproxy "*" -fsS -o /dev/null -w "local HTTP=%{http_code}\n" "{{local_healthcheck_base_url}}/api/health"; then
    break
  fi
  sleep 1
  if [ "$i" = 5 ]; then exit 1; fi
done
if [ -n "{{verify_base_url}}" ]; then
  curl -fsS -o /dev/null -w "public HTTP=%{http_code}\n" "{{verify_base_url}}/api/health"
fi
'
BASH);
});

task('deploy', [
    'deploy:info', 'deploy:setup', 'deploy:lock', 'deploy:release',
    'deploy:update_code', 'deploy:runtime_files', 'deploy:shared', 'deploy:writable',
    'deploy:vendors', 'deploy:build', 'deploy:symlink', 'pm2:restart',
    'deploy:healthcheck', 'deploy:unlock', 'deploy:cleanup', 'deploy:success',
]);

after('deploy:failed', 'deploy:unlock');
after('rollback', 'pm2:restart');
