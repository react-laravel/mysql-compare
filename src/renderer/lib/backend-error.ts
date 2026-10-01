export function describeBackendError(raw: string, chinese: boolean): string {
  let hint: [string, string] | undefined
  if (raw.startsWith('SSH_HOST_KEY_STORE_')) hint = ['Saved SSH trust data is invalid or changed. Restore a trusted backup, then restart.', 'SSH 信任记录损坏或被外部更改。请恢复可信备份并重启应用。']
  else if (raw.startsWith('SSH_HOST_KEY_CHALLENGE:') || /SSH host key (was not trusted|mismatch)/i.test(raw)) hint = ['Verify the SSH fingerprint through a trusted channel, then reconnect.', '请通过可信渠道核对 SSH 指纹，再重新连接。']
  else if (/keychain|credential store/i.test(raw)) hint = ['Unlock the system credential store and restart the application.', '请解锁系统钥匙串或凭据存储，并重启应用。']
  else if (/certificate|TLS|SSL|peer.*name/i.test(raw)) hint = ['Check the TLS mode, certificate authority and server name in connection settings.', '请检查连接设置中的 TLS 模式、CA 证书和服务器名称。']
  else if (/access denied|authentication failed|password authentication|WRONGPASS/i.test(raw)) hint = ['Check the username, password and database permissions in connection settings.', '请检查连接设置中的用户名、密码及数据库权限。']
  else if (/timed? ?out|timeout|exceeded the .*limit|connection refused/i.test(raw)) hint = ['Retry, or check connectivity and narrow the query.', '请重试，或检查网络并缩小查询范围。']
  else if (/CSV.*(column|field)|column count|Unknown import column|Row .*values/i.test(raw)) hint = ['Review the import header, column mapping and separator before retrying.', '请核对导入文件表头、列映射与分隔符后重试。']
  if (!hint) return raw
  const friendly = hint[chinese ? 1 : 0]
  // A second host-key challenge may arise if a server changes identity during retry.
  // Keep its opaque challenge out of a raw toast; the next connection opens the native review.
  return raw.startsWith('SSH_HOST_KEY_CHALLENGE:') ? friendly : `${friendly}\n${raw}`
}
