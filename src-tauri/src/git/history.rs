//! Read-only history views: a file's history (following renames), blame,
//! and comparing two branches. All of it runs on the repo actor thread and
//! is paginated/capped so one request never walks unbounded history.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::GitCommandError;

use super::diff::{self, CommitDiff, FileDiff, FileStatus};
use super::log::{to_commit_node, CommitNode};

/// Commits a single file-history request may look at before handing back a
/// cursor: keeps a rarely-touched file in a huge repo from holding the actor
/// (and with it every other git op of the repo) for seconds.
const MAX_SCAN_PER_PAGE: usize = 20_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryQuery {
    pub path: String,
    /// Where the walk starts; HEAD when omitted.
    pub start_sha: Option<String>,
    pub cursor: Option<FileHistoryCursor>,
    pub limit: u32,
}

/// Where the previous page stopped: how many commits of the walk were
/// already seen (skipping them needs no diffing) and the file's name at that
/// point, since following renames changes it along the way.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryCursor {
    pub skip: u32,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub commit: CommitNode,
    /// The file's name in this commit.
    pub path: String,
    /// Its previous name, when this commit renamed it.
    pub old_path: Option<String>,
    pub status: FileStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryPage {
    pub entries: Vec<FileHistoryEntry>,
    pub next_cursor: Option<FileHistoryCursor>,
}

fn parse_oid(sha: &str) -> Result<git2::Oid, GitCommandError> {
    git2::Oid::from_str(sha).map_err(|_| GitCommandError::RepoNotFound {
        path: sha.to_string(),
    })
}

fn start_commit<'r>(
    repo: &'r git2::Repository,
    sha: Option<&str>,
) -> Result<git2::Commit<'r>, GitCommandError> {
    match sha.filter(|s| !s.is_empty()) {
        Some(sha) => Ok(repo.find_commit(parse_oid(sha)?)?),
        None => Ok(repo.head()?.peel_to_commit()?),
    }
}

fn blob_at(tree: &git2::Tree, path: &str) -> Option<git2::Oid> {
    tree.get_path(Path::new(path))
        .ok()
        .filter(|e| e.kind() != Some(git2::ObjectType::Tree))
        .map(|e| e.id())
}

/// The path `path` had in `parent` when `commit` renamed it, if it did.
/// Only called where the file appears out of nowhere, so the full-tree
/// rename detection runs once per rename, not once per commit.
fn renamed_from(
    repo: &git2::Repository,
    parent: &git2::Tree,
    tree: &git2::Tree,
    path: &str,
) -> Result<Option<String>, GitCommandError> {
    let mut diff = repo.diff_tree_to_tree(Some(parent), Some(tree), None)?;
    diff.find_similar(Some(git2::DiffFindOptions::new().renames(true)))?;
    Ok(diff.deltas().find_map(|d| {
        let new = d.new_file().path()?.to_string_lossy();
        (d.status() == git2::Delta::Renamed && new == path)
            .then(|| d.old_file().path().map(|p| p.to_string_lossy().into_owned()))
            .flatten()
    }))
}

/// `git log --follow -- <path>`, one page at a time. Whether a commit
/// touched the file is decided by comparing blob ids of that one path in
/// each tree (no diff); rename detection only runs where the file appears.
/// Merges are listed only when the file differs from every parent (git's
/// default history simplification).
pub fn file_history(
    repo: &git2::Repository,
    query: &FileHistoryQuery,
) -> Result<FileHistoryPage, GitCommandError> {
    let start = start_commit(repo, query.start_sha.as_deref())?;
    let mut walk = repo.revwalk()?;
    walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
    walk.push(start.id())?;

    let (skip, mut path) = match &query.cursor {
        Some(c) => (c.skip as usize, c.path.clone()),
        None => (0, query.path.clone()),
    };
    let limit = query.limit.max(1) as usize;
    let mut entries = Vec::new();
    let mut seen = skip;

    for oid in walk.skip(skip) {
        if entries.len() == limit || seen - skip == MAX_SCAN_PER_PAGE {
            return Ok(FileHistoryPage {
                entries,
                next_cursor: Some(FileHistoryCursor {
                    skip: seen as u32,
                    path,
                }),
            });
        }
        seen += 1;
        let commit = repo.find_commit(oid?)?;
        let tree = commit.tree()?;
        let Some(blob) = blob_at(&tree, &path) else {
            continue;
        };

        let parents: Vec<git2::Commit> = commit.parents().collect();
        let (status, old_path) = match parents.as_slice() {
            [] => (FileStatus::Added, None),
            [parent] => {
                let parent_tree = parent.tree()?;
                match blob_at(&parent_tree, &path) {
                    Some(prev) if prev == blob => continue,
                    Some(_) => (FileStatus::Modified, None),
                    None => match renamed_from(repo, &parent_tree, &tree, &path)? {
                        Some(old) => (FileStatus::Renamed, Some(old)),
                        None => (FileStatus::Added, None),
                    },
                }
            }
            merge_parents => {
                let mut same_as_a_parent = false;
                for p in merge_parents {
                    if blob_at(&p.tree()?, &path) == Some(blob) {
                        same_as_a_parent = true;
                        break;
                    }
                }
                if same_as_a_parent {
                    continue;
                }
                (FileStatus::Modified, None)
            }
        };

        entries.push(FileHistoryEntry {
            commit: to_commit_node(&commit),
            path: path.clone(),
            old_path: old_path.clone(),
            status,
        });
        // Older commits know the file by its previous name.
        if let Some(old) = old_path {
            path = old;
        }
    }

    Ok(FileHistoryPage {
        entries,
        next_cursor: None,
    })
}

/// One file's diff in one commit (against its first parent), following a
/// rename when `old_path` is given. `None` when the commit didn't touch it.
pub fn commit_file_diff(
    repo: &git2::Repository,
    sha: &str,
    path: &str,
    old_path: Option<&str>,
) -> Result<Option<FileDiff>, GitCommandError> {
    let commit = repo.find_commit(parse_oid(sha)?)?;
    let tree = commit.tree()?;
    let parent_tree = commit.parent(0).ok().map(|p| p.tree()).transpose()?;

    let mut opts = diff::full_context_opts();
    opts.pathspec(path).disable_pathspec_match(true);
    if let Some(old) = old_path {
        opts.pathspec(old);
    }
    let mut d = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;
    if old_path.is_some() {
        d.find_similar(Some(git2::DiffFindOptions::new().renames(true)))?;
    }
    Ok(diff::diff_to_file_list(&d)?
        .into_iter()
        .find(|f| f.path == path))
}

/// `git diff <from_sha> <to_sha>`: tree against tree, whatever lies between.
pub fn tree_diff(
    repo: &git2::Repository,
    from_sha: &str,
    to_sha: &str,
) -> Result<CommitDiff, GitCommandError> {
    let from = repo.find_commit(parse_oid(from_sha)?)?.tree()?;
    let to = repo.find_commit(parse_oid(to_sha)?)?.tree()?;
    let mut d = repo.diff_tree_to_tree(Some(&from), Some(&to), Some(&mut diff::full_context_opts()))?;
    d.find_similar(Some(git2::DiffFindOptions::new().renames(true)))?;
    Ok(CommitDiff {
        sha: to_sha.to_string(),
        parent_shas: vec![from_sha.to_string()],
        files: diff::diff_to_file_list(&d)?,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameHunk {
    /// 1-based line in the blamed version of the file.
    pub start_line: u32,
    pub line_count: u32,
    pub sha: String,
    /// The file's path in that commit, when it was named differently.
    pub orig_path: Option<String>,
}

/// One window of a file's blame: the file is blamed in chunks of lines so a
/// big file shows its top right away and the rest loads as it's scrolled.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameChunk {
    /// The commit that was blamed (HEAD resolved).
    pub sha: String,
    pub total_lines: u32,
    pub start_line: u32,
    pub lines: Vec<String>,
    /// Consecutive lines from the same commit, merged into one hunk.
    pub hunks: Vec<BlameHunk>,
    /// Every commit the hunks point at, once each.
    pub commits: Vec<CommitNode>,
}

pub fn blame(
    repo: &git2::Repository,
    path: &str,
    sha: Option<&str>,
    start_line: u32,
    max_lines: u32,
) -> Result<BlameChunk, GitCommandError> {
    let commit = start_commit(repo, sha)?;
    let entry = commit.tree()?.get_path(Path::new(path))?;
    let blob = repo.find_blob(entry.id())?;
    if blob.is_binary() {
        return Err(GitCommandError::Internal(format!("{path} is a binary file")));
    }
    let text = String::from_utf8_lossy(blob.content());
    let all: Vec<&str> = text.lines().collect();
    let total = all.len() as u32;
    let start = start_line.max(1);
    let end = start.saturating_add(max_lines.max(1) - 1).min(total);

    let mut chunk = BlameChunk {
        sha: commit.id().to_string(),
        total_lines: total,
        start_line: start,
        lines: Vec::new(),
        hunks: Vec::new(),
        commits: Vec::new(),
    };
    if start > end {
        return Ok(chunk);
    }
    chunk.lines = all[(start - 1) as usize..end as usize]
        .iter()
        .map(|l| l.to_string())
        .collect();

    let mut opts = git2::BlameOptions::new();
    opts.newest_commit(commit.id())
        .use_mailmap(true)
        .min_line(start as usize)
        .max_line(end as usize);
    let blame = repo.blame_file(Path::new(path), Some(&mut opts))?;

    let mut seen = HashSet::new();
    for h in blame.iter() {
        let first = (h.final_start_line() as u32).max(start);
        let last = (h.final_start_line() + h.lines_in_hunk()) as u32 - 1;
        let last = last.min(end);
        if h.lines_in_hunk() == 0 || first > last {
            continue;
        }
        let id = h.final_commit_id();
        let orig_path = h
            .path()
            .map(|p| p.to_string_lossy().into_owned())
            .filter(|p| p != path);
        match chunk.hunks.last_mut() {
            Some(prev)
                if prev.sha == id.to_string() && prev.start_line + prev.line_count == first =>
            {
                prev.line_count += last - first + 1;
            }
            _ => chunk.hunks.push(BlameHunk {
                start_line: first,
                line_count: last - first + 1,
                sha: id.to_string(),
                orig_path,
            }),
        }
        if seen.insert(id) {
            chunk.commits.push(to_commit_node(&repo.find_commit(id)?));
        }
    }
    Ok(chunk)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCompare {
    pub a_sha: String,
    pub b_sha: String,
    pub merge_base: Option<String>,
    /// `git log b..a` (capped at the requested limit).
    pub only_in_a: Vec<CommitNode>,
    /// `git log a..b` (capped).
    pub only_in_b: Vec<CommitNode>,
    /// Uncapped counts.
    pub only_in_a_total: u32,
    pub only_in_b_total: u32,
}

fn walk_excluding(
    repo: &git2::Repository,
    include: git2::Oid,
    exclude: git2::Oid,
    limit: usize,
) -> Result<Vec<CommitNode>, GitCommandError> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
    walk.push(include)?;
    walk.hide(exclude)?;
    walk.take(limit)
        .map(|oid| Ok(to_commit_node(&repo.find_commit(oid?)?)))
        .collect()
}

/// Branch menus name remote-only branches without their remote ("feature"
/// for origin/feature), so fall back to origin's copy.
fn resolve_branch(repo: &git2::Repository, name: &str) -> Result<git2::Oid, GitCommandError> {
    let object = repo
        .revparse_single(name)
        .or_else(|e| repo.revparse_single(&format!("origin/{name}")).map_err(|_| e))?;
    Ok(object.peel_to_commit()?.id())
}

/// Commits on either side of two refs since they diverged — the revwalks
/// hide the other side, so they stop at the merge base instead of walking
/// all of history.
pub fn compare_refs(
    repo: &git2::Repository,
    a: &str,
    b: &str,
    limit: u32,
) -> Result<BranchCompare, GitCommandError> {
    let a_id = resolve_branch(repo, a)?;
    let b_id = resolve_branch(repo, b)?;
    let (ahead, behind) = repo.graph_ahead_behind(a_id, b_id)?;
    let merge_base = match repo.merge_base(a_id, b_id) {
        Ok(oid) => Some(oid.to_string()),
        Err(e) if e.code() == git2::ErrorCode::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    Ok(BranchCompare {
        a_sha: a_id.to_string(),
        b_sha: b_id.to_string(),
        merge_base,
        only_in_a: walk_excluding(repo, a_id, b_id, limit as usize)?,
        only_in_b: walk_excluding(repo, b_id, a_id, limit as usize)?,
        only_in_a_total: ahead as u32,
        only_in_b_total: behind as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig() -> git2::Signature<'static> {
        git2::Signature::now("Test", "test@example.com").unwrap()
    }

    /// Commits the given files (None deletes) on top of HEAD.
    fn commit(repo: &git2::Repository, files: &[(&str, Option<&str>)], msg: &str) -> git2::Oid {
        let mut index = repo.index().unwrap();
        for (path, content) in files {
            let full = repo.workdir().unwrap().join(path);
            match content {
                Some(c) => {
                    std::fs::write(&full, c).unwrap();
                    index.add_path(Path::new(path)).unwrap();
                }
                None => {
                    std::fs::remove_file(&full).unwrap();
                    index.remove_path(Path::new(path)).unwrap();
                }
            }
        }
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parents: Vec<_> = repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .and_then(|oid| repo.find_commit(oid).ok())
            .into_iter()
            .collect();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig(), &sig(), msg, &tree, &parent_refs)
            .unwrap()
    }

    fn query(path: &str, cursor: Option<FileHistoryCursor>, limit: u32) -> FileHistoryQuery {
        FileHistoryQuery {
            path: path.into(),
            start_sha: None,
            cursor,
            limit,
        }
    }

    fn summaries(page: &FileHistoryPage) -> Vec<String> {
        page.entries.iter().map(|e| e.commit.summary.clone()).collect()
    }

    const BODY: &str = "line one\nline two\nline three\nline four\nline five\n";

    #[test]
    fn file_history_follows_renames() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit(&repo, &[("old.txt", Some(BODY))], "create");
        commit(&repo, &[("other.txt", Some("x\n"))], "unrelated");
        commit(&repo, &[("old.txt", Some(&format!("{BODY}line six\n")))], "edit old");
        commit(
            &repo,
            &[("old.txt", None), ("new.txt", Some(&format!("{BODY}line six\n")))],
            "rename",
        );
        commit(&repo, &[("new.txt", Some(&format!("{BODY}line six\nline seven\n")))], "edit new");

        let page = file_history(&repo, &query("new.txt", None, 300)).unwrap();
        assert_eq!(summaries(&page), ["edit new", "rename", "edit old", "create"]);
        assert_eq!(page.next_cursor, None);
        let rename = &page.entries[1];
        assert!(matches!(rename.status, FileStatus::Renamed));
        assert_eq!(rename.path, "new.txt");
        assert_eq!(rename.old_path.as_deref(), Some("old.txt"));
        assert_eq!(page.entries[2].path, "old.txt");
        assert!(matches!(page.entries[3].status, FileStatus::Added));

        // Per-commit diff of the renamed file shows the rename, not an add.
        let d = commit_file_diff(&repo, &rename.commit.sha, "new.txt", Some("old.txt"))
            .unwrap()
            .unwrap();
        assert!(matches!(d.status, FileStatus::Renamed));
        assert_eq!(d.old_path.as_deref(), Some("old.txt"));
        let d = commit_file_diff(&repo, &page.entries[0].commit.sha, "new.txt", None)
            .unwrap()
            .unwrap();
        assert!(d.patch.contains("+line seven"));
    }

    #[test]
    fn file_history_paginates_with_a_cursor_that_keeps_the_followed_name() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit(&repo, &[("a.txt", Some(BODY))], "c1");
        commit(&repo, &[("a.txt", Some(&format!("{BODY}2\n")))], "c2");
        commit(&repo, &[("a.txt", None), ("b.txt", Some(&format!("{BODY}2\n")))], "c3 rename");
        commit(&repo, &[("b.txt", Some(&format!("{BODY}3\n")))], "c4");

        let first = file_history(&repo, &query("b.txt", None, 2)).unwrap();
        assert_eq!(summaries(&first), ["c4", "c3 rename"]);
        let cursor = first.next_cursor.clone().unwrap();
        assert_eq!(cursor.path, "a.txt");

        let second = file_history(&repo, &query("b.txt", Some(cursor), 2)).unwrap();
        assert_eq!(summaries(&second), ["c2", "c1"]);
        assert_eq!(second.next_cursor, None);
    }

    #[test]
    fn blame_attributes_lines_and_merges_hunks() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        let first = commit(&repo, &[("f.txt", Some("a\nb\nc\nd\n"))], "first");
        let second = commit(&repo, &[("f.txt", Some("a\nB\nC\nd\ne\n"))], "second");

        let chunk = blame(&repo, "f.txt", None, 1, 1000).unwrap();
        assert_eq!(chunk.sha, second.to_string());
        assert_eq!(chunk.total_lines, 5);
        assert_eq!(chunk.lines, ["a", "B", "C", "d", "e"]);
        let spans: Vec<(u32, u32, String)> = chunk
            .hunks
            .iter()
            .map(|h| (h.start_line, h.line_count, h.sha.clone()))
            .collect();
        assert_eq!(
            spans,
            [
                (1, 1, first.to_string()),
                (2, 2, second.to_string()),
                (4, 1, first.to_string()),
                (5, 1, second.to_string()),
            ]
        );
        assert_eq!(chunk.commits.len(), 2);

        // Blaming at the older commit sees only its lines.
        let old = blame(&repo, "f.txt", Some(&first.to_string()), 1, 1000).unwrap();
        assert_eq!(old.total_lines, 4);
        assert!(old.hunks.iter().all(|h| h.sha == first.to_string()));

        // A window covers just its lines, clamped to the file.
        let window = blame(&repo, "f.txt", None, 2, 2).unwrap();
        assert_eq!(window.lines, ["B", "C"]);
        assert_eq!(window.hunks.len(), 1);
        assert_eq!((window.hunks[0].start_line, window.hunks[0].line_count), (2, 2));
        let tail = blame(&repo, "f.txt", None, 5, 100).unwrap();
        assert_eq!(tail.lines, ["e"]);
    }

    #[test]
    fn compare_lists_commits_on_each_side_since_the_merge_base() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        let base = commit(&repo, &[("f.txt", Some("base\n"))], "base");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        commit(&repo, &[("m.txt", Some("1\n"))], "main 1");
        commit(&repo, &[("m.txt", Some("2\n"))], "main 2");
        repo.branch("feature", &repo.find_commit(base).unwrap(), false).unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force())).unwrap();
        let feat = commit(&repo, &[("x.txt", Some("x\n"))], "feature 1");

        let cmp = compare_refs(&repo, "feature", &main, 100).unwrap();
        assert_eq!(cmp.merge_base, Some(base.to_string()));
        assert_eq!(cmp.only_in_a.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), ["feature 1"]);
        assert_eq!(
            cmp.only_in_b.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(),
            ["main 2", "main 1"]
        );
        assert_eq!((cmp.only_in_a_total, cmp.only_in_b_total), (1, 2));

        // Capped lists keep the real totals.
        let capped = compare_refs(&repo, "feature", &main, 1).unwrap();
        assert_eq!(capped.only_in_b.len(), 1);
        assert_eq!(capped.only_in_b_total, 2);

        // A remote-only branch is found by its short name.
        repo.reference("refs/remotes/origin/remote-only", feat, true, "test").unwrap();
        let remote = compare_refs(&repo, "remote-only", &main, 100).unwrap();
        assert_eq!(remote.a_sha, feat.to_string());

        // Aggregate diff from the merge base: only the feature side's file.
        let d = tree_diff(&repo, &base.to_string(), &feat.to_string()).unwrap();
        assert_eq!(d.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["x.txt"]);
    }
}
