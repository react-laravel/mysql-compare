//! SQL script boundaries respect literals, comments, PostgreSQL dollar quoting,
//! and MySQL DELIMITER directives. Transaction control belongs to the importer.
use crate::drivers::dialect::SqlDialect;
fn identifier_byte(byte: u8) -> bool { byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$') || byte >= 0x80 }

pub fn statements(input: &str, dialect: SqlDialect) -> Result<Vec<String>, String> {
  let bytes = input.as_bytes(); let mut i = 0; let mut start = 0; let mut result = Vec::new();
  let mut delimiter = ";".to_string(); let mut quote: Option<(u8, bool)> = None;
  let mut dollar: Option<String> = None; let mut line_comment = false; let mut block_depth = 0u32;
  let mut executable_comment = false;
  while i < bytes.len() {
    if line_comment { if bytes[i] == b'\n' { line_comment = false; } i += 1; continue; }
    if block_depth > 0 {
      if bytes[i..].starts_with(b"/*") {
        if dialect == SqlDialect::Mysql { return Err("Nested MySQL block comments are unsupported; remove the nested comment before importing".into()); }
        block_depth += 1; i += 2;
      }
      else if bytes[i..].starts_with(b"*/") { block_depth -= 1; i += 2; }
      else { i += 1; }
      continue;
    }
    if let Some(tag) = &dollar {
      if bytes[i..].starts_with(tag.as_bytes()) { i += tag.len(); dollar = None; } else { i += 1; }
      continue;
    }
    if let Some((q, escapes)) = quote {
      if escapes && bytes[i] == b'\\' { i = (i + 2).min(bytes.len()); }
      else if bytes[i] == q {
        if bytes.get(i+1) == Some(&q) { i += 2; } else { quote = None; i += 1; }
      } else { i += 1; }
      continue;
    }
    if executable_comment && bytes[i..].starts_with(b"*/") { executable_comment = false; i += 2; continue; }
    let at_line_start = i == 0 || bytes[i-1] == b'\n';
    if at_line_start && dialect == SqlDialect::Mysql && !executable_comment {
      let end = input[i..].find('\n').map(|n| i+n).unwrap_or(bytes.len());
      let line = input[i..end].trim();
      if line.get(..9).is_some_and(|s| s.eq_ignore_ascii_case("DELIMITER")) && line.as_bytes().get(9).is_some_and(u8::is_ascii_whitespace) {
        if !first_keyword(&input[start..i]).is_empty() { return Err("DELIMITER must occur between statements".into()); }
        let next = line[9..].trim();
        if next.is_empty() || next.len() > 16 || next.chars().any(char::is_whitespace) { return Err("Invalid SQL delimiter".into()); }
        delimiter = next.into(); i = if end < bytes.len() { end+1 } else { end }; start=i; continue;
      }
    }
    let dash_comment = bytes[i..].starts_with(b"--") && (dialect == SqlDialect::Postgres || bytes.get(i + 2).map_or(true, |next| next.is_ascii_whitespace() || next.is_ascii_control()));
    if dash_comment || (dialect == SqlDialect::Mysql && bytes[i] == b'#') { line_comment=true; i+=if bytes[i]==b'#' {1} else {2}; continue; }
    if dialect == SqlDialect::Mysql && bytes[i..].starts_with(b"/*!") {
      if executable_comment { return Err("Nested executable SQL comments are unsupported".into()); }
      executable_comment = true; i += 3;
      while bytes.get(i).is_some_and(u8::is_ascii_digit) { i += 1; }
      continue;
    }
    if bytes[i..].starts_with(b"/*") {
      if executable_comment { return Err("Nested MySQL block comments are unsupported".into()); }
      block_depth=1; i+=2; continue;
    }
    if matches!(bytes[i], b'\''|b'"'|b'`') {
      let escapes = (dialect == SqlDialect::Mysql && bytes[i] != b'`') || (bytes[i] == b'\'' && i > 0 && matches!(bytes[i-1], b'E'|b'e') && (i<2 || !identifier_byte(bytes[i-2])));
      quote=Some((bytes[i], escapes)); i+=1; continue;
    }
    if dialect == SqlDialect::Postgres && bytes[i] == b'$' && (i == 0 || !identifier_byte(bytes[i-1])) {
      let mut end=i+1;
      while let Some(character) = input[end..].chars().next().filter(|c| c.is_alphanumeric() || *c == '_') { end+=character.len_utf8(); }
      let first=input[i+1..end].chars().next();
      if bytes.get(end)==Some(&b'$') && first.map_or(true, |character| character.is_alphabetic() || character == '_') {
        dollar=Some(input[i..=end].into()); i=end+1; continue;
      }
    }
    if bytes[i..].starts_with(delimiter.as_bytes()) {
      if executable_comment { return Err("Executable MySQL comments must contain one complete statement; use DELIMITER for stored routine bodies".into()); }
      push(&mut result, &input[start..i], dialect)?; i+=delimiter.len(); start=i;
    } else { i+=1; }
  }
  if quote.is_some() || dollar.is_some() || block_depth > 0 || executable_comment { return Err("Unterminated SQL literal or comment".into()); }
  push(&mut result, &input[start..], dialect)?;
  if result.is_empty() { return Err("SQL script contains no statements".into()); }
  Ok(result)
}
fn push(output: &mut Vec<String>, text: &str, dialect: SqlDialect) -> Result<(), String> {
  let keyword=first_keyword(text);
  if keyword.is_empty() { return Ok(()); }
  if matches!(keyword.as_str(), "BEGIN"|"START"|"COMMIT"|"ROLLBACK"|"SAVEPOINT"|"RELEASE"|"LOCK"|"UNLOCK"|"XA") ||
    (dialect == SqlDialect::Postgres && matches!(keyword.as_str(), "END"|"ABORT")) ||
    (keyword == "PREPARE" && text.to_ascii_uppercase().contains("TRANSACTION")) {
    return Err("Remove transaction and lock control statements; the importer manages its transaction".into());
  }
  if keyword=="SET" && text.to_ascii_uppercase().contains("AUTOCOMMIT") { return Err("SQL import cannot change autocommit".into()); }
  if keyword=="COPY" && text.to_ascii_uppercase().contains("STDIN") { return Err("COPY FROM STDIN is unsupported; import CSV or an INSERT script".into()); }
  output.push(text.trim().to_string()); Ok(())
}
pub fn first_keyword(text: &str) -> String {
  let mut s=text.trim_start_matches('\u{feff}').trim_start();
  loop {
    if s.starts_with("--") || s.starts_with('#') { s=s.split_once('\n').map(|(_,tail)|tail.trim_start()).unwrap_or(""); }
    else if s.starts_with("/*!") {
      s = s[3..].trim_start_matches(|c: char| c.is_ascii_digit()).trim_start();
    }
    else if s.starts_with("/*") {
      let bytes=s.as_bytes(); let mut index=2; let mut depth=1;
      while index<bytes.len() && depth>0 {
        if bytes[index..].starts_with(b"/*") { depth+=1; index+=2; }
        else if bytes[index..].starts_with(b"*/") { depth-=1; index+=2; }
        else { index+=1; }
      }
      s=if depth==0 { s[index..].trim_start() } else { "" };
    }
    else { break; }
  }
  s.chars().take_while(|c|c.is_ascii_alphabetic()).collect::<String>().to_ascii_uppercase()
}

#[cfg(test)] mod tests {
  use super::*;
  #[test] fn preserves_literals_comments_and_routine_bodies() {
    let mysql="-- comment;\nINSERT INTO t VALUES ('a;b', 'it''s');\nDELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\n# trailing;\nSELECT 3;";
    let parts=statements(mysql,SqlDialect::Mysql).unwrap(); assert_eq!(parts.len(),3); assert!(parts[1].contains("SELECT 1; SELECT 2;"));
    let pg="DO $body$ BEGIN PERFORM 1; END $body$; INSERT INTO t VALUES ('a;b');";
    assert_eq!(statements(pg,SqlDialect::Postgres).unwrap().len(),2);
    assert!(statements("SELECT 'open",SqlDialect::Mysql).is_err());
    assert!(statements("BEGIN; INSERT INTO t VALUES(1); COMMIT;",SqlDialect::Postgres).is_err());
  }
  #[test] fn unicode_and_escaped_literals_are_preserved() {
    let sql="INSERT INTO t VALUES ('中文;'); SELECT 'C:\\';";
    assert_eq!(statements(sql,SqlDialect::Postgres).unwrap().len(),2);
    assert_eq!(statements("SELECT E'it\\'s;here'; SELECT 2",SqlDialect::Postgres).unwrap().len(),2);
    assert_eq!(statements("DO $正文$ BEGIN PERFORM 1; END $正文$; SELECT 2;", SqlDialect::Postgres).unwrap().len(), 2);
    assert_eq!(statements("CREATE TABLE name$tag$ (id int); SELECT 2;", SqlDialect::Postgres).unwrap().len(), 2);
  }
  #[test] fn transaction_controls_cannot_hide_in_executable_comments_or_comment_like_arithmetic() {
    for sql in ["SELECT 1--1; COMMIT;", "/*!40101 COMMIT */;", "/*! SELECT 1; COMMIT; */;", "/*!40101 SET @@autocommit=1 */;"] {
      assert!(statements(sql, SqlDialect::Mysql).is_err(), "accepted {sql}");
    }
    assert_eq!(statements("SELECT 1--1; SELECT 2;", SqlDialect::Mysql).unwrap().len(), 2);
    assert_eq!(statements("SELECT 1; --comment without whitespace\n SELECT 2;", SqlDialect::Postgres).unwrap().len(), 2);
    assert!(statements("SELECT 1; /* outer /* nested */ COMMIT; */", SqlDialect::Mysql).is_err());
  }
  #[test] fn postgres_transaction_aliases_and_prepared_transactions_are_rejected() {
    for sql in ["END;", "ABORT;", "PREPARE TRANSACTION 'id';", "-- comment\nEND WORK;", "/* outer /* inner */ hidden */ END;"] {
      assert!(statements(sql, SqlDialect::Postgres).is_err(), "accepted {sql}");
    }
    assert_eq!(statements("PREPARE query AS SELECT 1;", SqlDialect::Postgres).unwrap().len(), 1);
  }
  #[test] fn versioned_mysql_routines_keep_custom_delimiters_and_literal_comments_intact() {
    let sql = "/*!40101 SET @OLD_VALUE=1 */;\nDELIMITER ;;\n/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 PROCEDURE p() BEGIN SELECT '/* comment */;'; SELECT 2; END */;;\nDELIMITER ;\nSELECT `column\\`; SELECT 3;";
    let parts = statements(sql, SqlDialect::Mysql).unwrap();
    assert_eq!(parts.len(), 4);
    assert!(parts[1].contains("SELECT 2; END */"));
    assert_eq!(first_keyword(parts[0].as_str()), "SET");
  }
}
