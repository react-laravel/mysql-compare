# Web Deployment Guide

This project now supports browser deployment with two parts:

1. A frontend static bundle built by Vite into `dist-web/`
2. A standalone Node web server that exposes the existing database/SSH features over HTTP + SSE

The same web server can also serve the built frontend files directly.

## 1. Install Dependencies

```bash
npm install
```

## 2. Local Development

Run the API server in one terminal:

```bash
export MYSQL_COMPARE_SECRET='persist-a-random-32-byte-secret'
export MYSQL_COMPARE_WEB_USERNAME='admin'
export MYSQL_COMPARE_WEB_PASSWORD='use-a-long-unique-password'
export MYSQL_COMPARE_ALLOWED_ORIGINS='http://127.0.0.1:5173'
npm run web:server
```

Run the frontend dev server in another terminal:

```bash
npm run web:dev
```

Default addresses:

- Frontend dev server: Vite default address, usually `http://127.0.0.1:5173`
- Web API server: `http://127.0.0.1:3000`

The Vite dev server proxies `/api` to `http://127.0.0.1:3000`. Set
`MYSQL_COMPARE_WEB_API_PROXY` when the API uses another local address.

Example:

```bash
MYSQL_COMPARE_WEB_API_PROXY=http://127.0.0.1:3300 npm run web:dev
MYSQL_COMPARE_WEB_PORT=3300 MYSQL_COMPARE_ALLOWED_ORIGINS=http://127.0.0.1:5173 npm run web:server
```

## 3. Production Build

Build the browser bundle:

```bash
npm run web:build
```

Start the standalone web server:

```bash
npm run web:start
```

By default the server:

- requires HTTP Basic authentication
- issues a signed `HttpOnly`, `SameSite=Strict` browser session cookie after authentication
- isolates terminal and synchronization events by that server-issued session
- listens only on `127.0.0.1`
- listens on port `3000`
- serves API routes under `/api`
- serves static frontend files from `dist-web/` when that directory exists

## 4. Production Environment Variables

Required variables:

- `MYSQL_COMPARE_SECRET`: secret used to encrypt stored connection secrets in web mode
- `MYSQL_COMPARE_WEB_USERNAME`: HTTP Basic authentication username
- `MYSQL_COMPARE_WEB_PASSWORD`: HTTP Basic authentication password, at least 12 characters

Deployment variables:

- `MYSQL_COMPARE_WEB_HOST`: bind address; defaults to `127.0.0.1`
- `PORT` or `MYSQL_COMPARE_WEB_PORT`: web server port
- `MYSQL_COMPARE_ALLOWED_ORIGINS`: comma-separated exact browser origins. Required for non-loopback binding; non-loopback origins must use HTTPS
- `MYSQL_COMPARE_DATA_DIR`: directory used by the web server to persist connection metadata and SSH host fingerprints
- `MYSQL_COMPARE_JSON_LIMIT`: request body limit for large imports/uploads, default is `25mb`
- `MYSQL_COMPARE_SSH_HOST_KEYS`: JSON object of pinned SSH SHA256 fingerprints keyed by `host:port` or `connectionId:host:port`
- `VITE_WEB_API_BASE`: only needed when frontend and API are not served from the same origin

Example:

```bash
export PORT=8080
export MYSQL_COMPARE_WEB_PORT=8080
export MYSQL_COMPARE_SECRET='replace-this-with-a-long-random-secret'
export MYSQL_COMPARE_WEB_USERNAME='admin'
export MYSQL_COMPARE_WEB_PASSWORD='replace-this-with-a-long-unique-password'
export MYSQL_COMPARE_DATA_DIR='/var/lib/mysql-compare'
npm run web:build
npm run web:start
```

## 5. Reverse Proxy Example

If you deploy behind Nginx, point it at the Node web server.

Example:

```nginx
server {
    listen 443 ssl;
    server_name mysql-compare.example.com;

    ssl_certificate /etc/letsencrypt/live/mysql-compare.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mysql-compare.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
    }
}
```

`proxy_buffering off` is recommended so SSE progress streams stay responsive.

Keep the Node process bound to `127.0.0.1` behind Nginx and set:

```bash
export MYSQL_COMPARE_ALLOWED_ORIGINS='https://mysql-compare.example.com'
```

## 6. Verification

After the server starts, verify the health endpoint:

```bash
curl http://127.0.0.1:3000/api/health
```

Expected shape:

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "mode": "web"
  }
}
```

## 7. Web Mode Notes

The browser deployment reuses the existing DB/SSH service layer, but there are a few browser-specific differences:

- Table export and database export trigger browser downloads instead of Electron save dialogs
- Table import uses browser-selected file content and sends it to the web API server
- SSH file upload uses browser file or folder selection instead of native file paths
- SSH drag-and-drop upload is not supported in web mode; use the upload buttons instead
- SSH directory download is not yet supported in web mode
- In web mode, unknown SSH hosts are rejected. Pin the expected fingerprint before connecting, for example:

```bash
export MYSQL_COMPARE_SSH_HOST_KEYS='{"ssh.example.com:22":"SHA256:replace-with-known-fingerprint"}'
```

Desktop mode still asks before trusting a first-seen host. A changed fingerprint is always rejected.

## 8. Security Recommendations

- The server refuses to start without its encryption secret and Basic authentication credentials
- Store `MYSQL_COMPARE_DATA_DIR` on persistent storage with restricted permissions
- Put the service behind HTTPS in production; Basic credentials must never cross an unencrypted network
- Keep the default loopback bind and expose it through a reverse proxy, VPN, or private network
- Remember that the web server can reach your databases and SSH targets from the machine where it runs
