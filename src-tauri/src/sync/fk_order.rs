use std::collections::{HashMap, HashSet, VecDeque};

/// Kahn topological sort: parents (to_table) before dependents (from_table).
pub fn order_tables_by_foreign_keys(
  tables: &[String],
  edges: &[(String, String)],
) -> Vec<String> {
  let selected: HashSet<_> = tables.iter().cloned().collect();
  let mut indegree: HashMap<String, usize> = tables.iter().map(|t| (t.clone(), 0)).collect();
  let mut graph: HashMap<String, Vec<String>> = HashMap::new();

  for (from, to) in edges {
    if from == to {
      continue;
    }
    if !selected.contains(from) || !selected.contains(to) {
      continue;
    }
    // edge: to -> from (parent first)
    graph.entry(to.clone()).or_default().push(from.clone());
    *indegree.entry(from.clone()).or_default() += 1;
    indegree.entry(to.clone()).or_default();
  }

  let mut queue: VecDeque<String> = VecDeque::new();
  for t in tables {
    if *indegree.get(t).unwrap_or(&0) == 0 {
      queue.push_back(t.clone());
    }
  }

  let mut ordered = Vec::new();
  let mut seen = HashSet::new();
  while let Some(node) = queue.pop_front() {
    if !seen.insert(node.clone()) {
      continue;
    }
    ordered.push(node.clone());
    if let Some(children) = graph.get(&node) {
      for child in children {
        if let Some(deg) = indegree.get_mut(child) {
          *deg = deg.saturating_sub(1);
          if *deg == 0 {
            queue.push_back(child.clone());
          }
        }
      }
    }
  }

  for t in tables {
    if !seen.contains(t) {
      ordered.push(t.clone());
    }
  }
  ordered
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parents_before_children() {
    let tables = vec!["child".into(), "parent".into()];
    let edges = vec![("child".into(), "parent".into())];
    let ordered = order_tables_by_foreign_keys(&tables, &edges);
    assert!(ordered.iter().position(|t| t == "parent") < ordered.iter().position(|t| t == "child"));
  }
}
