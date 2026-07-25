use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcResult<T: Serialize> {
  pub ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub data: Option<T>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

impl<T: Serialize> IpcResult<T> {
  pub fn ok(data: T) -> Self {
    Self {
      ok: true,
      data: Some(data),
      error: None,
    }
  }

  pub fn err(msg: impl Into<String>) -> Self {
    Self {
      ok: false,
      data: None,
      error: Some(msg.into()),
    }
  }
}

impl IpcResult<()> {
  pub fn ok_empty() -> Self {
    Self {
      ok: true,
      data: Some(()),
      error: None,
    }
  }
}

pub fn map_result<T: Serialize>(result: Result<T, String>) -> IpcResult<T> {
  match result {
    Ok(v) => IpcResult::ok(v),
    Err(e) => IpcResult::err(e),
  }
}
