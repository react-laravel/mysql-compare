//! A narrow implementation of OpenSSH's atomic replacement extension.
//! ssh2 0.9 does not expose posix_rename. Use a separately negotiated SFTP
//! channel on the same verified SSH session, without shell commands or FFI.
//! https://github.com/openssh/openssh-portable/blob/master/PROTOCOL#L381
use std::io::{Read, Write};

const MAX_PACKET: usize = 256 * 1024;
const EXTENSION: &[u8] = b"posix-rename@openssh.com";

fn send_frame(writer: &mut impl Write, payload: &[u8]) -> Result<(), String> {
  if payload.is_empty() || payload.len() > MAX_PACKET { return Err("SFTP atomic replacement request exceeds the protocol limit".into()); }
  writer.write_all(&(payload.len() as u32).to_be_bytes()).and_then(|_| writer.write_all(payload)).and_then(|_| writer.flush()).map_err(|e| format!("Send SFTP atomic replacement: {e}"))
}
fn read_frame(reader: &mut impl Read) -> Result<Vec<u8>, String> {
  let mut length = [0u8; 4];
  reader.read_exact(&mut length).map_err(|e| format!("Read SFTP response length: {e}"))?;
  let length = u32::from_be_bytes(length) as usize;
  if length == 0 || length > MAX_PACKET { return Err("Invalid or oversized SFTP atomic replacement response".into()); }
  let mut payload = vec![0; length];
  reader.read_exact(&mut payload).map_err(|e| format!("Read SFTP response: {e}"))?;
  Ok(payload)
}
fn word(bytes: &[u8], offset: &mut usize) -> Result<u32, String> {
  let end = offset.checked_add(4).filter(|end| *end <= bytes.len()).ok_or("Truncated SFTP response")?;
  let value = u32::from_be_bytes(bytes[*offset..end].try_into().map_err(|_| "Invalid SFTP integer")?);
  *offset = end; Ok(value)
}
fn string<'a>(bytes: &'a [u8], offset: &mut usize) -> Result<&'a [u8], String> {
  let length = word(bytes, offset)? as usize;
  let end = offset.checked_add(length).filter(|end| *end <= bytes.len()).ok_or("Truncated SFTP string")?;
  let value = &bytes[*offset..end]; *offset = end; Ok(value)
}
fn append_string(bytes: &mut Vec<u8>, value: &[u8]) -> Result<(), String> {
  if value.len() > MAX_PACKET { return Err("Remote path exceeds the SFTP protocol limit".into()); }
  bytes.extend_from_slice(&(value.len() as u32).to_be_bytes()); bytes.extend_from_slice(value); Ok(())
}
fn replace_channel(channel: &mut (impl Read + Write), source: &str, destination: &str) -> Result<(), String> {
  crate::operations::check()?;
  send_frame(channel, &[1, 0, 0, 0, 3])?; // SSH_FXP_INIT, version 3
  let hello = read_frame(channel)?;
  if hello.first() != Some(&2) { return Err("Expected the SFTP version response".into()); }
  let mut offset = 1;
  if word(&hello, &mut offset)? != 3 { return Err("Atomic replacement requires SFTP version 3 with the OpenSSH POSIX rename extension".into()); }
  let mut supported = false;
  while offset < hello.len() {
    let name = string(&hello, &mut offset)?;
    let version = string(&hello, &mut offset)?;
    if name == EXTENSION && version == b"1" { supported = true; }
  }
  if !supported { return Err("Server does not support safe atomic SFTP replacement; the original file was preserved".into()); }
  crate::operations::check()?;
  let mut request = vec![200, 0, 0, 0, 1]; // SSH_FXP_EXTENDED, request ID 1
  append_string(&mut request, EXTENSION)?;
  append_string(&mut request, source.as_bytes())?;
  append_string(&mut request, destination.as_bytes())?;
  send_frame(channel, &request)?;
  let status = read_frame(channel)?;
  if status.first() != Some(&101) { return Err("Expected the SFTP atomic replacement status response".into()); }
  let mut offset = 1;
  if word(&status, &mut offset)? != 1 { return Err("SFTP atomic replacement response ID did not match".into()); }
  let code = word(&status, &mut offset)?;
  let message = string(&status, &mut offset)?;
  let _language = string(&status, &mut offset)?;
  if offset != status.len() { return Err("Unexpected trailing bytes in SFTP atomic replacement status".into()); }
  if code != 0 { return Err(format!("SFTP atomic replacement was refused (status {code}): {}. The original file was preserved", String::from_utf8_lossy(message).chars().take(1024).collect::<String>())); }
  Ok(())
}

pub(super) fn replace(session: &ssh2::Session, source: &str, destination: &str) -> Result<(), String> {
  let mut channel = session.channel_session().map_err(|e| format!("Open SFTP atomic replacement channel: {e}"))?;
  channel.subsystem("sftp").map_err(|e| format!("Start SFTP atomic replacement: {e}"))?;
  let result = replace_channel(&mut channel, source, destination);
  // Renaming has committed once STATUS OK arrives. Closing this protocol
  // channel cannot change the successful outcome.
  let _ = channel.send_eof(); let _ = channel.close(); let _ = channel.wait_close();
  result
}

#[cfg(test)]
mod tests {
  use super::*;
  struct Duplex { input: std::io::Cursor<Vec<u8>>, output: Vec<u8> }
  impl Read for Duplex { fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> { self.input.read(bytes) } }
  impl Write for Duplex {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> { self.output.extend_from_slice(bytes); Ok(bytes.len()) }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
  }
  fn peer(extension: bool, id: u32, status_code: u32) -> Duplex {
    let mut hello = vec![2, 0, 0, 0, 3];
    if extension { append_string(&mut hello, EXTENSION).unwrap(); append_string(&mut hello, b"1").unwrap(); }
    let mut status = vec![101]; status.extend_from_slice(&id.to_be_bytes()); status.extend_from_slice(&status_code.to_be_bytes());
    append_string(&mut status, b"message").unwrap(); append_string(&mut status, b"").unwrap();
    let mut input = Vec::new(); send_frame(&mut input, &hello).unwrap(); send_frame(&mut input, &status).unwrap();
    Duplex { input: std::io::Cursor::new(input), output: Vec::new() }
  }
  #[test] fn replacement_requires_advertised_extension_matching_request_and_success_status() {
    let mut unsupported = peer(false, 1, 0);
    assert!(replace_channel(&mut unsupported, "/temp", "/target").unwrap_err().contains("does not support"));
    assert_eq!(unsupported.output.len(), 9); // INIT only, no rename request
    assert!(replace_channel(&mut peer(true, 2, 0), "/temp", "/target").is_err());
    assert!(replace_channel(&mut peer(true, 1, 3), "/temp", "/target").is_err());
    replace_channel(&mut peer(true, 1, 0), "/temp", "/target").unwrap();
  }
  #[test] fn malformed_and_oversized_frames_are_rejected_before_allocation() {
    assert!(read_frame(&mut &(u32::MAX.to_be_bytes())[..]).is_err());
    assert!(read_frame(&mut &[0, 0, 0, 8, 2, 0][..]).is_err());
    let mut offset = 0;
    assert!(string(&[0, 0, 0, 9, b'x'], &mut offset).is_err());
  }
}
