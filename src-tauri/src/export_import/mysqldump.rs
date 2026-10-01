use std::{io::{Read, Write}, path::PathBuf, process::{Child, Command, Stdio}, time::Duration};
use super::ExportFile;
use crate::{drivers::connection_options, types::{ConnectionConfig, ExportDatabaseRequest, ExportDatabaseResult}};

struct Scratch(PathBuf);
impl Drop for Scratch { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }
struct Process(Child);
impl Drop for Process { fn drop(&mut self) { let _=self.0.kill(); let _=self.0.wait(); } }
fn option(value: &str) -> String {
  format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r").replace('\t', "\\t"))
}
fn private_file(path: &std::path::Path, content: &[u8]) -> Result<(), String> {
  let mut options=std::fs::OpenOptions::new(); options.write(true).create_new(true);
  #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
  let mut file=options.open(path).map_err(|e| e.to_string())?;
  file.write_all(content).map_err(|e| e.to_string())?; file.sync_all().map_err(|e| e.to_string())
}
fn executable() -> Result<PathBuf, String> {
  // Resolve only installation locations. Never execute a renderer supplied name or search PATH.
  #[cfg(target_os="macos")]
  let candidates=["/opt/homebrew/bin/mysqldump", "/usr/local/bin/mysqldump", "/usr/local/mysql/bin/mysqldump"];
  #[cfg(all(unix,not(target_os="macos")))]
  let candidates=["/usr/bin/mysqldump", "/usr/local/bin/mysqldump"];
  #[cfg(windows)]
  let candidates=["C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe", "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe", "C:\\Program Files\\MySQL\\MySQL Server 9.0\\bin\\mysqldump.exe"];
  for candidate in candidates {
    let Ok(path)=std::fs::canonicalize(candidate) else {continue};
    let meta=path.metadata().map_err(|e|e.to_string())?;
    if !meta.is_file() {continue;}
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; let mode=meta.permissions().mode(); if mode & 0o022 != 0 || mode & 0o111 == 0 {continue;} }
    return Ok(path);
  }
  Err("mysqldump was not found in a trusted installation location; install the MySQL client or use built-in export".into())
}
fn isolate_client_configuration(cmd: &mut Command, credentials: &std::path::Path, scratch: &std::path::Path) {
  cmd.arg(format!("--defaults-file={}", credentials.display()))
    .env_remove("MYSQL_PWD")
    .env("MYSQL_TEST_LOGIN_FILE", scratch.join("disabled-login.cnf"));
}
pub async fn export(req: &ExportDatabaseRequest, destination: &str, host: &str, port: u16, conn: &ConnectionConfig) -> Result<ExportDatabaseResult,String> {
  let tls=connection_options::verified_tls(conn, conn.use_ssh.then_some(port))?;
  let req=req.clone(); let destination=destination.to_string(); let host=host.to_string(); let conn=conn.clone();
  let cancellation=crate::operations::current();
  tokio::task::spawn_blocking(move || {
    let directory=std::env::temp_dir().join(format!("mysql-compare-dump-{}",uuid::Uuid::new_v4()));
    let mut builder=std::fs::DirBuilder::new();
    #[cfg(unix)] {use std::os::unix::fs::DirBuilderExt; builder.mode(0o700);}
    builder.create(&directory).map_err(|e|e.to_string())?; let scratch=Scratch(directory);
    let (username,password)=connection_options::credentials(&conn,&req.database);
    let mut config=format!("[client]\nhost={}\nport={}\nuser={}\npassword={}\nprotocol=tcp\nssl-mode={}\n", option(&host),port,option(username),option(password),if tls {"VERIFY_IDENTITY"} else {"DISABLED"});
    if let Some(pem)=conn.tls_ca_pem.as_deref().filter(|p|!p.trim().is_empty()) {
      let ca=scratch.0.join("ca.pem"); private_file(&ca,pem.as_bytes())?; config.push_str(&format!("ssl-ca={}\n",option(ca.to_str().ok_or("Invalid certificate path")?)));
    }
    let credentials=scratch.0.join("client.cnf");private_file(&credentials,config.as_bytes())?;
    let file=ExportFile::new(&destination)?;
    let output=file.writer.as_ref().unwrap().get_ref().try_clone().map_err(|e|e.to_string())?;
    let stderr_path=scratch.0.join("stderr");private_file(&stderr_path,b"")?;
    let stderr=std::fs::OpenOptions::new().write(true).open(&stderr_path).map_err(|e|e.to_string())?;
    if let Some(c)=&cancellation {c.check()?;}
    let mut cmd=Command::new(executable()?);
    // --defaults-file excludes ordinary option files. MySQL still reads .mylogin.cnf,
    // so MYSQL_TEST_LOGIN_FILE below points to a nonexistent file inside our private directory.
    // This also works with MySQL 8.0, which predates --no-login-paths.
    isolate_client_configuration(&mut cmd, &credentials, &scratch.0);
    cmd.arg("--single-transaction").arg("--hex-blob").arg("--complete-insert").arg("--skip-lock-tables");
    if req.include_data==Some(false) {cmd.arg("--no-data");}
    if req.include_create_table==Some(false) {cmd.arg("--no-create-info");}
    cmd.arg("--").arg(&req.database).stdout(output).stderr(Stdio::from(stderr));
    let mut process=Process(cmd.spawn().map_err(|e|e.to_string())?);
    let status=loop {
      if let Some(c)=&cancellation {c.check()?;}
      if let Some(status)=process.0.try_wait().map_err(|e|e.to_string())? {break status;}
      std::thread::sleep(Duration::from_millis(50));
    };
    if !status.success() {
      let mut error=String::new(); std::fs::File::open(stderr_path).map_err(|e|e.to_string())?.take(64*1024).read_to_string(&mut error).map_err(|e|e.to_string())?;
      return Err(format!("mysqldump failed: {error}"));
    }
    if let Some(c)=&cancellation {c.check()?;}
    file.finish()?;
    Ok(ExportDatabaseResult { canceled:false,file_path:Some(destination),tables_exported:0,rows_exported:0,backend:Some("mysqldump".into()),rows_count_accurate:Some(false) })
  }).await.map_err(|e|e.to_string())?
}
#[cfg(test)] mod tests {
  use super::*;
  #[test] fn options_cannot_escape_credentials_section() {
    assert_eq!(option("a\n[evil]\r\"\\"),"\"a\\n[evil]\\r\\\"\\\\\"");
  }
  #[cfg(unix)] #[test] fn temporary_credentials_are_private() {
    use std::os::unix::fs::PermissionsExt;
    let path=std::env::temp_dir().join(format!("cnf-test-{}",uuid::Uuid::new_v4())); private_file(&path,b"secret").unwrap();
    assert_eq!(path.metadata().unwrap().permissions().mode() & 0o777,0o600); std::fs::remove_file(path).unwrap();
  }
  #[test] fn password_environment_is_removed_and_login_path_file_is_isolated() {
    let root = std::env::temp_dir().join(format!("dump-config-test-{}", uuid::Uuid::new_v4()));
    let mut command = Command::new("mysqldump");
    isolate_client_configuration(&mut command, &root.join("client.cnf"), &root);
    let environment: std::collections::HashMap<_, _> = command.get_envs().map(|(key, value)| (key.to_string_lossy().into_owned(), value.map(|v| v.to_os_string()))).collect();
    assert_eq!(environment["MYSQL_PWD"], None);
    assert_eq!(environment["MYSQL_TEST_LOGIN_FILE"].as_deref(), Some(root.join("disabled-login.cnf").as_os_str()));
    assert!(!root.exists());
    assert_eq!(command.get_args().next().unwrap(), format!("--defaults-file={}", root.join("client.cnf").display()).as_str());
  }
}
