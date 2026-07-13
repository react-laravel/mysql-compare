module.exports = {
  apps: [{
    name: process.env.PM2_APP || "mysql-compare",
    cwd: process.env.PM2_CWD || __dirname,
    script: "node_modules/.bin/tsx",
    args: "src/web/index.ts",
    interpreter: "node",
    env: {
      NODE_ENV: "production",
      PORT: process.env.PORT || "3006",
      MYSQL_COMPARE_SECRET: process.env.MYSQL_COMPARE_SECRET,
      MYSQL_COMPARE_WEB_USERNAME: process.env.MYSQL_COMPARE_WEB_USERNAME,
      MYSQL_COMPARE_WEB_PASSWORD: process.env.MYSQL_COMPARE_WEB_PASSWORD,
      MYSQL_COMPARE_ALLOWED_ORIGINS: process.env.MYSQL_COMPARE_ALLOWED_ORIGINS,
      MYSQL_COMPARE_DATA_DIR: process.env.MYSQL_COMPARE_DATA_DIR,
      PATH: "/home/actions-runner/.nvm/versions/node/v24.16.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
    },
    error_file: (process.env.APP_ROOT || "/var/www/mysql-compare") + "/logs/error.log",
    out_file: (process.env.APP_ROOT || "/var/www/mysql-compare") + "/logs/out.log",
    merge_logs: true,
    max_memory_restart: "512M",
  }],
};
