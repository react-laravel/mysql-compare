//! Partition using the same typed key on both sides; database collations never
//! determine pairing. Oversized partitions split again before loading rows.
use super::{comparable_row, diff_rows, DATA_DIFF_SAMPLE_LIMIT};
use crate::drivers::{dialect::read_rows_sql, EngineDriver};
use crate::types::TableDataDiff;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const PARTITIONS: usize = 16;
#[cfg(not(test))]
const PARTITION_BYTES: u64 = 16 * 1024 * 1024;
#[cfg(test)]
const PARTITION_BYTES: u64 = 64 * 1024;

struct Scratch(PathBuf);
impl Drop for Scratch {
  fn drop(&mut self) {
    let _ = std::fs::remove_dir_all(&self.0);
  }
}

fn writers(directory: &Path, side: &str) -> Result<Vec<BufWriter<File>>, String> {
  (0..PARTITIONS)
    .map(|index| {
      OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(directory.join(format!("{side}-{index}")))
        .map(BufWriter::new)
        .map_err(|e| e.to_string())
    })
    .collect()
}

fn write_row(
  writers: &mut [BufWriter<File>],
  row: &HashMap<String, Value>,
  keys: &[String],
  depth: usize,
) -> Result<(), String> {
  let key = comparable_row(row, keys, keys).key;
  let bucket = (Sha256::digest(key.as_bytes())[depth] & 15) as usize;
  serde_json::to_writer(&mut writers[bucket], row).map_err(|e| e.to_string())?;
  writers[bucket].write_all(b"\n").map_err(|e| e.to_string())
}

fn flush(writers: &mut [BufWriter<File>]) -> Result<(), String> {
  for writer in writers {
    writer.flush().map_err(|e| e.to_string())?;
  }
  Ok(())
}

fn read_rows(path: &Path) -> Result<Vec<HashMap<String, Value>>, String> {
  let file = File::open(path).map_err(|e| e.to_string())?;
  BufReader::new(file)
    .lines()
    .map(|line| serde_json::from_str(&line.map_err(|e| e.to_string())?).map_err(|e| e.to_string()))
    .collect()
}

fn merge(into: &mut TableDataDiff, part: TableDataDiff) {
  into.source_row_count += part.source_row_count;
  into.target_row_count += part.target_row_count;
  into.source_only += part.source_only;
  into.target_only += part.target_only;
  into.modified += part.modified;
  into.identical += part.identical;
  if !part.comparable {
    into.comparable = false;
    into.reason = part.reason;
  }
  let remaining = DATA_DIFF_SAMPLE_LIMIT.saturating_sub(into.samples.len());
  into
    .samples
    .extend(part.samples.into_iter().take(remaining));
}

fn compare_partition(
  source: &Path,
  target: &Path,
  keys: &[String],
  columns: &[String],
  depth: usize,
) -> Result<TableDataDiff, String> {
  let bytes = source.metadata().map_err(|e| e.to_string())?.len()
    + target.metadata().map_err(|e| e.to_string())?.len();
  if bytes <= PARTITION_BYTES {
    return Ok(diff_rows(
      &read_rows(source)?,
      &read_rows(target)?,
      keys.to_vec(),
      columns.to_vec(),
      None,
    ));
  }
  if depth >= 32 {
    return Err("Comparison partition exceeds memory budget; check primary-key uniqueness".into());
  }
  let directory = source.with_extension("parts");
  std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
  let mut result = diff_rows(&[], &[], keys.to_vec(), columns.to_vec(), None);
  for (name, path) in [("source", source), ("target", target)] {
    let mut outputs = writers(&directory, name)?;
    for line in BufReader::new(File::open(path).map_err(|e| e.to_string())?).lines() {
      let row =
        serde_json::from_str(&line.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
      write_row(&mut outputs, &row, keys, depth)?;
    }
    flush(&mut outputs)?;
  }
  for index in 0..PARTITIONS {
    merge(
      &mut result,
      compare_partition(
        &directory.join(format!("source-{index}")),
        &directory.join(format!("target-{index}")),
        keys,
        columns,
        depth + 1,
      )?,
    );
  }
  std::fs::remove_dir_all(directory).map_err(|e| e.to_string())?;
  Ok(result)
}

pub async fn compare(
  source: Arc<EngineDriver>,
  source_db: &str,
  target: Arc<EngineDriver>,
  target_db: &str,
  table: &str,
  keys: Vec<String>,
  columns: Vec<String>,
) -> Result<TableDataDiff, String> {
  let directory = std::env::temp_dir().join(format!("mysql-compare-diff-{}", uuid::Uuid::new_v4()));
  let mut builder = std::fs::DirBuilder::new();
  #[cfg(unix)]
  {
    use std::os::unix::fs::DirBuilderExt;
    builder.mode(0o700);
  }
  builder.create(&directory).map_err(|e| e.to_string())?;
  let scratch = Scratch(directory);
  for (name, driver, database) in [("source", source, source_db), ("target", target, target_db)] {
    let mut output = writers(&scratch.0, name)?;
    let sql = read_rows_sql(driver.dialect()?, database, table, &[], None, None, None)?;
    let mut batches = driver.read_batches(database, sql, 200).await?;
    while let Some(batch) = batches.recv().await {
      for row in batch? {
        write_row(&mut output, &row, &keys, 0)?;
      }
    }
    flush(&mut output)?;
  }
  tokio::task::spawn_blocking(move || {
    let mut result = diff_rows(&[], &[], keys.clone(), columns.clone(), None);
    for index in 0..PARTITIONS {
      merge(
        &mut result,
        compare_partition(
          &scratch.0.join(format!("source-{index}")),
          &scratch.0.join(format!("target-{index}")),
          &keys,
          &columns,
          1,
        )?,
      );
    }
    Ok(result)
  })
  .await
  .map_err(|e| e.to_string())?
}
