/// KILL QUERY can corrupt a MyISAM table during REPAIR/OPTIMIZE. Reject these
/// statements before a cancellable operation begins, including executable
/// version comments and both MySQL backslash-escape modes.
pub fn assert_safe_mysql_cancellation(sql: &str) -> Result<(), String> {
  for escapes in [true, false] {
    let words = words_outside_literals(sql, escapes, 0);
    for (index, word) in words.iter().enumerate() {
      if matches!(word.as_str(), "REPAIR" | "OPTIMIZE") {
        let mut next = index + 1;
        if words.get(next).is_some_and(|word| matches!(word.as_str(), "LOCAL" | "NO_WRITE_TO_BINLOG")) { next += 1; }
        if words.get(next).is_some_and(|word| word == "TABLE") {
          return Err("REPAIR TABLE / OPTIMIZE TABLE do not support safe cancellation. Please use a native database client for these maintenance operations. / 这些维护操作不支持安全取消，请用原生数据库客户端执行".into());
        }
      }
    }
  }
  Ok(())
}

fn words_outside_literals(sql: &str, escapes: bool, depth: usize) -> Vec<String> {
  // Nested executable comments are not valid MySQL syntax. Fail closed rather
  // than recursing without a bound on malformed renderer input.
  if depth >= 16 { return vec!["REPAIR".into(), "TABLE".into()]; }
  let chars: Vec<char> = sql.chars().collect();
  let mut words = Vec::new();
  let mut i = 0;
  while i < chars.len() {
    if matches!(chars[i], '\'' | '"' | '`') {
      let quote = chars[i];
      i += 1;
      while i < chars.len() {
        if escapes && chars[i] == '\\' { i += 2; continue; }
        if chars[i] == quote {
          i += 1;
          if i < chars.len() && chars[i] == quote { i += 1; continue; }
          break;
        }
        i += 1;
      }
      continue;
    }
    if chars[i] == '#' || (chars[i] == '-' && chars.get(i + 1) == Some(&'-') && chars.get(i + 2).map_or(true, |c| c.is_ascii_whitespace() || c.is_ascii_control())) {
      while i < chars.len() && chars[i] != '\n' { i += 1; }
      continue;
    }
    if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
      let start = i + 2;
      let executable = chars.get(start) == Some(&'!') || (chars.get(start) == Some(&'M') && chars.get(start + 1) == Some(&'!'));
      let mut end = start;
      while end + 1 < chars.len() && !(chars[end] == '*' && chars[end + 1] == '/') { end += 1; }
      if executable {
        let inner: String = chars[start..end].iter().collect();
        words.extend(words_outside_literals(&inner, escapes, depth + 1));
      }
      i = (end + 2).min(chars.len());
      continue;
    }
    if chars[i].is_ascii_alphabetic() || chars[i] == '_' {
      let start = i;
      i += 1;
      while i < chars.len() && (chars[i].is_ascii_alphanumeric() || matches!(chars[i], '_' | '$')) { i += 1; }
      words.push(chars[start..i].iter().collect::<String>().to_ascii_uppercase());
      continue;
    }
    i += 1;
  }
  words
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn rejects_direct_modified_and_versioned_maintenance() {
    for sql in ["REPAIR TABLE items", "optimize local TABLE items", "REPAIR NO_WRITE_TO_BINLOG TABLE items", "OPTIMIZE /* normal comment */ TABLE items", "/*!80000 OPTIMIZE TABLE items */", "/*M!100100 REPAIR TABLE items */", "SELECT 1; REPAIR TABLE items", "OPTIMIZE /*!80000 LOCAL */ TABLE items"] {
      assert!(assert_safe_mysql_cancellation(sql).is_err(), "{sql}");
    }
  }
  #[test]
  fn preserves_literals_identifiers_and_nonexecuting_comments() {
    for sql in ["SELECT 'OPTIMIZE TABLE' AS label", "SELECT 'REPAIR TABLE'", "SELECT `OPTIMIZE TABLE` FROM items", "SELECT 1 /* OPTIMIZE TABLE items */", "-- REPAIR TABLE items\nSELECT 1", "# OPTIMIZE TABLE items\nSELECT 1"] {
      assert!(assert_safe_mysql_cancellation(sql).is_ok(), "{sql}");
    }
  }
  #[test]
  fn backslash_mode_does_not_hide_a_maintenance_statement() {
    assert!(assert_safe_mysql_cancellation("SELECT 'a\\'; OPTIMIZE TABLE items; SELECT 'done'").is_err());
  }
}
