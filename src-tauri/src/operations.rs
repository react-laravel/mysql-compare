use std::collections::HashMap;
use std::future::Future;
use std::time::{Duration, Instant};
use parking_lot::Mutex;
use tokio::sync::watch;

#[derive(Clone)]
pub struct Cancellation(watch::Sender<bool>);
impl Cancellation {
  pub(crate) fn new() -> Self { Self(watch::channel(false).0) }
  pub fn cancel(&self) { self.0.send_replace(true); }
  pub fn check(&self) -> Result<(), String> {
    if *self.0.borrow() { Err("Operation canceled; already committed changes are retained".into()) } else { Ok(()) }
  }
  async fn cancelled(&self) {
    let mut rx = self.0.subscribe();
    while !*rx.borrow_and_update() {
      if rx.changed().await.is_err() { break; }
    }
  }
}
tokio::task_local! { static CURRENT: Cancellation; }
pub fn current() -> Option<Cancellation> { CURRENT.try_with(Clone::clone).ok() }
thread_local! { static BLOCKING: std::cell::RefCell<Option<Cancellation>> = const { std::cell::RefCell::new(None) }; }
pub fn check() -> Result<(), String> { current().or_else(|| BLOCKING.with(|c|c.borrow().clone())).map_or(Ok(()), |c| c.check()) }
pub fn with_cancellation<T>(cancellation: Option<Cancellation>, work: impl FnOnce() -> T) -> T {
  struct Reset(Option<Cancellation>);
  impl Drop for Reset { fn drop(&mut self) { BLOCKING.with(|c| *c.borrow_mut() = self.0.take()); } }
  let _reset=Reset(BLOCKING.with(|c|c.replace(cancellation)));
  work()
}

struct Entry { cancellation: Cancellation, started: bool, created: Instant }
#[derive(Default)]
pub struct Operations { entries: Mutex<HashMap<String, Entry>> }
impl Operations {
  pub fn cancel(&self, id: &str) -> Result<(), String> {
    validate_id(id)?;
    let mut entries = self.entries.lock();
    entries.retain(|_, e| e.started || e.created.elapsed() < Duration::from_secs(60));
    if let Some(entry) = entries.get(id) { entry.cancellation.cancel(); }
    else {
      if entries.len() >= 256 { return Err("Too many operations".into()); }
      let cancellation = Cancellation::new(); cancellation.cancel();
      entries.insert(id.into(), Entry { cancellation, started: false, created: Instant::now() });
    }
    Ok(())
  }
  pub async fn run<T>(&self, id: Option<&str>, future: impl Future<Output = Result<T, String>>) -> Result<T, String> {
    let id = id.map(str::to_owned).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    validate_id(&id)?;
    let cancellation = {
      let mut entries = self.entries.lock();
      entries.retain(|_, e| e.started || e.created.elapsed() < Duration::from_secs(60));
      if entries.get(&id).is_some_and(|e| e.started) { return Err("Operation ID is already active".into()); }
      if entries.len() >= 256 && !entries.contains_key(&id) { return Err("Too many operations".into()); }
      let entry = entries.entry(id.clone()).or_insert_with(|| Entry { cancellation: Cancellation::new(), started: false, created: Instant::now() });
      entry.started = true;
      entry.cancellation.clone()
    };
    let _cleanup = Cleanup { operations: self, id };
    cancellation.check()?;
    CURRENT.scope(cancellation.clone(), async {
      tokio::select! { biased;
        _ = cancellation.cancelled() => cancellation.check().and_then(|_| Err("Operation canceled".into())),
        result = future => result,
      }
    }).await
  }
}
struct Cleanup<'a> { operations: &'a Operations, id: String }
impl Drop for Cleanup<'_> { fn drop(&mut self) { self.operations.entries.lock().remove(&self.id); } }
fn validate_id(id: &str) -> Result<(), String> {
  if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') { Err("Invalid operation ID".into()) } else { Ok(()) }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[tokio::test]
  async fn cancellation_drops_future_and_cleans_registry() {
    let operations = Operations::default();
    let future = operations.run(Some("running"), std::future::pending::<Result<(), String>>());
    let cancel = async { tokio::task::yield_now().await; operations.cancel("running").unwrap(); };
    let (result, _) = tokio::join!(future, cancel);
    assert!(result.unwrap_err().contains("canceled"));
    assert!(operations.entries.lock().is_empty());
  }
  #[tokio::test]
  async fn cancellation_before_registration_never_executes_work() {
    let operations = Operations::default(); operations.cancel("before").unwrap();
    let result = operations.run(Some("before"), async { panic!("must not run"); #[allow(unreachable_code)] Ok(()) }).await;
    assert!(result.is_err()); assert!(operations.entries.lock().is_empty());
  }
}
