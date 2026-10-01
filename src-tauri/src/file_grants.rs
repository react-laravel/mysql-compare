use std::{collections::HashMap, path::{Path, PathBuf}, time::{Duration, Instant}};
use parking_lot::Mutex;

struct Grant { purpose: String, path: PathBuf, identity: PathBuf, issued: Instant }
#[derive(Default)]
pub struct FileGrants(Mutex<HashMap<String, Grant>>);
fn identity(path: &Path) -> Result<PathBuf, String> {
  if !path.is_absolute() { return Err("Local path must be absolute".into()); }
  if path.exists() { path.canonicalize().map_err(|e| e.to_string()) }
  else {
    let name = path.file_name().ok_or("Invalid local path")?;
    Ok(path.parent().ok_or("Invalid local path")?.canonicalize().map_err(|e| e.to_string())?.join(name))
  }
}
impl FileGrants {
  #[cfg(test)]
  pub fn issue(&self, purpose: &str, path: &Path) -> Result<String, String> {
    self.issue_many(purpose, &[path.to_path_buf()]).map(|mut ids| ids.remove(0))
  }
  pub fn issue_many(&self, purpose: &str, paths: &[PathBuf]) -> Result<Vec<String>, String> {
    let identities = paths.iter().map(|path| identity(path)).collect::<Result<Vec<_>, _>>()?;
    let mut grants = self.0.lock();
    grants.retain(|_, g| g.issued.elapsed() < Duration::from_secs(300));
    if grants.len() + paths.len() > 128 { return Err("Too many unused file selections; select at most 128 files".into()); }
    let mut ids = Vec::with_capacity(paths.len());
    for (path, identity) in paths.iter().zip(identities) {
      let id = uuid::Uuid::new_v4().to_string();
      grants.insert(id.clone(), Grant { purpose: purpose.into(), path: path.clone(), identity, issued: Instant::now() });
      ids.push(id);
    }
    Ok(ids)
  }
  pub fn consume(&self, id: Option<&str>, purpose: &str, path: &str) -> Result<PathBuf, String> {
    self.consume_many(&[(id, purpose, path)]).map(|mut paths| paths.remove(0))
  }
  pub fn consume_many(&self, requests: &[(Option<&str>, &str, &str)]) -> Result<Vec<PathBuf>, String> {
    let mut grants = self.0.lock();
    let mut ids = std::collections::HashSet::new();
    let mut resolved = Vec::with_capacity(requests.len());
    for (id, purpose, path) in requests {
      let id = id.ok_or("Choose the local path using the system file dialog")?;
      if !ids.insert(id) { return Err("A file selection may only be used once per operation".into()); }
      let grant = grants.get(id).ok_or("File selection expired or already used; select the file again")?;
      if grant.issued.elapsed() > Duration::from_secs(300) || grant.purpose != *purpose || grant.path != Path::new(path) || grant.identity != identity(Path::new(path))? {
        return Err("Local path does not match this operation's system file selection".into());
      }
      resolved.push(grant.identity.clone());
    }
    for id in ids { grants.remove(id); }
    Ok(resolved)
  }

}
#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn grants_are_exact_purpose_bound_and_single_use() {
    let dir = std::env::temp_dir(); let file = dir.join(format!("grant-test-{}", uuid::Uuid::new_v4()));
    let grants = FileGrants::default(); let id = grants.issue("export_table", &file).unwrap();
    let path = file.to_str().unwrap();
    assert!(grants.consume(None, "export_table", path).is_err());
    assert!(grants.consume(Some(&id), "upload", path).is_err());
    assert!(grants.consume(Some(&id), "export_table", dir.to_str().unwrap()).is_err());
    grants.consume(Some(&id), "export_table", path).unwrap();
    assert!(grants.consume(Some(&id), "export_table", path).is_err());
  }
  #[cfg(unix)]
  #[test]
  fn replacing_selected_path_with_symlink_is_rejected() {
    use std::os::unix::fs::symlink;
    let dir = std::env::temp_dir().join(format!("grant-link-{}", uuid::Uuid::new_v4())); std::fs::create_dir(&dir).unwrap();
    let source = dir.join("source"); let other = dir.join("other"); std::fs::write(&source, "a").unwrap(); std::fs::write(&other, "b").unwrap();
    let grants=FileGrants::default(); let id=grants.issue("import_table", &source).unwrap();
    std::fs::remove_file(&source).unwrap(); symlink(&other, &source).unwrap();
    assert!(grants.consume(Some(&id), "import_table", source.to_str().unwrap()).is_err());
    std::fs::remove_dir_all(dir).unwrap();
  }
  #[test]
  fn batch_validation_does_not_consume_valid_selection_when_another_is_invalid() {
    let dir = std::env::temp_dir();
    let one = dir.join(format!("grant-one-{}", uuid::Uuid::new_v4()));
    let two = dir.join(format!("grant-two-{}", uuid::Uuid::new_v4()));
    let grants = FileGrants::default();
    let ids = grants.issue_many("ssh_upload_entries", &[one.clone(), two.clone()]).unwrap();
    assert!(grants.consume_many(&[(Some(&ids[0]), "ssh_upload_entries", one.to_str().unwrap()), (Some("unknown"), "ssh_upload_entries", two.to_str().unwrap())]).is_err());
    assert!(grants.consume_many(&[(Some(&ids[0]), "ssh_upload_entries", one.to_str().unwrap()), (Some(&ids[0]), "ssh_upload_entries", one.to_str().unwrap())]).is_err());
    let paths = grants.consume_many(&[(Some(&ids[0]), "ssh_upload_entries", one.to_str().unwrap()), (Some(&ids[1]), "ssh_upload_entries", two.to_str().unwrap())]).unwrap();
    assert_eq!(paths.len(), 2);
    assert!(grants.consume(Some(&ids[0]), "ssh_upload_entries", one.to_str().unwrap()).is_err());
  }
}
