//! Staging, unstaging and discarding *part* of a file — one hunk or a
//! hand-picked set of changed lines — like `git add -p` / `git apply --cached`.
//! The picked changes are rewritten into a patch containing only them, which
//! libgit2 applies to the index (stage/unstage) or the working directory
//! (discard). Unpicked removals become context, unpicked additions are dropped.

use std::borrow::Cow;
use std::collections::HashSet;
use std::io::Write;

use serde::Deserialize;

use crate::activity;
use crate::error::GitCommandError;

use super::{diff, working};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineAction {
    /// Unstaged lines go into the index.
    Stage,
    /// Staged lines are taken back out of the index; the workdir is untouched.
    Unstage,
    /// Unstaged lines are reverted in the working directory.
    Discard,
}

/// The changed lines to act on, by the numbers shown in the diff the user is
/// looking at: removed lines by their old-side number, added lines by their
/// new-side number. Each is unique on its side, so together they identify
/// every change in the file.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineSelection {
    pub old_lines: Vec<u32>,
    pub new_lines: Vec<u32>,
}

struct DiffLine {
    origin: char,
    old_no: Option<u32>,
    new_no: Option<u32>,
    content: Vec<u8>,
}

struct DiffHunk {
    old_start: u32,
    new_start: u32,
    lines: Vec<DiffLine>,
}

pub fn apply_lines(
    repo: &git2::Repository,
    path: &str,
    action: LineAction,
    selection: &LineSelection,
) -> Result<(), GitCommandError> {
    let diff = file_diff(repo, path, action == LineAction::Unstage)?;
    // Nothing left to act on (e.g. changed on disk since the diff was shown).
    let Some(delta) = diff.get_delta(0) else {
        return Ok(());
    };
    let binary = || {
        GitCommandError::Internal("binary files can only be staged or discarded as a whole".into())
    };
    // Binary detection may only happen once the content is loaded for the patch.
    let patch = match git2::Patch::from_diff(&diff, 0)? {
        Some(p) if p.delta().flags().is_binary() => return Err(binary()),
        Some(p) => p,
        None if delta.flags().is_binary() => return Err(binary()),
        None => return Ok(()),
    };
    let hunks = collect_hunks(&patch)?;

    let old: HashSet<u32> = selection.old_lines.iter().copied().collect();
    let new: HashSet<u32> = selection.new_lines.iter().copied().collect();
    let is_selected = |l: &DiffLine| match l.origin {
        '-' => l.old_no.is_some_and(|n| old.contains(&n)),
        '+' => l.new_no.is_some_and(|n| new.contains(&n)),
        _ => false,
    };

    let changes = hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter(|l| l.origin != ' ');
    let (total, picked) = changes.fold((0, 0), |(t, p), l| (t + 1, p + is_selected(l) as usize));
    if picked == 0 {
        return Ok(());
    }
    // Every change picked: the whole-file operations already cover new,
    // deleted and mode-changed files exactly, with no patch round trip.
    if picked == total {
        return match action {
            LineAction::Stage => working::stage_path(repo, path),
            LineAction::Unstage => working::unstage_path(repo, path),
            LineAction::Discard => working::discard_path(repo, path),
        };
    }

    // Stage applies the index→workdir diff forwards onto the index; unstage
    // and discard apply their diff in reverse onto its newer side.
    let reverse = action != LineAction::Stage;
    let (pre_file, post_file) = if reverse {
        (delta.new_file(), delta.old_file())
    } else {
        (delta.old_file(), delta.new_file())
    };
    let pre_exists = pre_file.exists();
    let mode = if pre_exists {
        pre_file.mode()
    } else {
        post_file.mode()
    };
    let Some(text) = build_patch(
        path,
        &hunks,
        is_selected,
        reverse,
        pre_exists,
        u32::from(mode),
    ) else {
        return Ok(());
    };

    let workdir = repo.workdir().unwrap_or_else(|| repo.path());
    let (flags, location) = match action {
        LineAction::Stage => ("--cached", git2::ApplyLocation::Index),
        LineAction::Unstage => ("--cached --reverse", git2::ApplyLocation::Index),
        LineAction::Discard => ("--reverse", git2::ApplyLocation::WorkDir),
    };
    activity::info(
        Some(workdir),
        format!("$ git apply {flags}  # {picked} of {total} changed lines in {path}"),
    );
    let result = git2::Diff::from_buffer(&text).and_then(|d| repo.apply(&d, location, None));
    if let Err(e) = &result {
        activity::error(Some(workdir), format!("git apply failed: {}", e.message()));
    }
    Ok(result?)
}

/// Same full-context diff the staging view shows (so line numbers match),
/// limited to the one file.
fn file_diff<'r>(
    repo: &'r git2::Repository,
    path: &str,
    staged: bool,
) -> Result<git2::Diff<'r>, GitCommandError> {
    let mut opts = diff::full_context_opts();
    opts.pathspec(path).disable_pathspec_match(true);
    if staged {
        // Unborn HEAD: everything in the index is a staged addition.
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        Ok(repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?)
    } else {
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
        Ok(repo.diff_index_to_workdir(None, Some(&mut opts))?)
    }
}

fn collect_hunks(patch: &git2::Patch) -> Result<Vec<DiffHunk>, GitCommandError> {
    let mut hunks = Vec::with_capacity(patch.num_hunks());
    for h in 0..patch.num_hunks() {
        let (hunk, count) = patch.hunk(h)?;
        let mut lines = Vec::with_capacity(count);
        for i in 0..count {
            let line = patch.line_in_hunk(h, i)?;
            // The "\ No newline at end of file" markers are skipped: a line's
            // own content already tells whether it ends in a newline.
            if matches!(line.origin(), ' ' | '+' | '-') {
                lines.push(DiffLine {
                    origin: line.origin(),
                    old_no: line.old_lineno(),
                    new_no: line.new_lineno(),
                    content: line.content().to_vec(),
                });
            }
        }
        hunks.push(DiffHunk {
            old_start: hunk.old_start(),
            new_start: hunk.new_start(),
            lines,
        });
    }
    Ok(hunks)
}

type PatchLine<'a> = (u8, Cow<'a, [u8]>);

/// Unified diff containing only the selected changes, applicable to the
/// diff's old side (or its new side when `reverse`). `None` when no hunk is
/// left with a change in it.
fn build_patch(
    path: &str,
    hunks: &[DiffHunk],
    is_selected: impl Fn(&DiffLine) -> bool,
    reverse: bool,
    pre_exists: bool,
    mode: u32,
) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    // How far the post-image has drifted from the pre-image after the hunks
    // emitted so far — later hunk headers have to account for it.
    let mut offset: i64 = 0;
    for hunk in hunks {
        let mut lines: Vec<PatchLine> = Vec::with_capacity(hunk.lines.len());
        for line in &hunk.lines {
            let origin = match (line.origin, reverse) {
                ('+', true) => '-',
                ('-', true) => '+',
                (o, _) => o,
            };
            let content = Cow::Borrowed(line.content.as_slice());
            match origin {
                ' ' => lines.push((b' ', content)),
                '-' if is_selected(line) => lines.push((b'-', content)),
                // Unpicked removal: the line stays, as context.
                '-' => lines.push((b' ', content)),
                '+' if is_selected(line) => lines.push((b'+', content)),
                // Unpicked addition: never happens.
                _ => {}
            }
        }
        if lines.iter().all(|(kind, _)| *kind == b' ') {
            continue;
        }
        let lines = fix_missing_newlines(lines);

        let pre_count = lines.iter().filter(|(k, _)| *k != b'+').count() as i64;
        let post_count = lines.iter().filter(|(k, _)| *k != b'-').count() as i64;
        let pre_start = i64::from(if reverse {
            hunk.new_start
        } else {
            hunk.old_start
        });
        // An empty side is numbered by the line *before* it (`-0,0` for an empty file).
        let pre_first = if pre_count == 0 {
            pre_start + 1
        } else {
            pre_start
        };
        let post_first = pre_first + offset;
        let post_start = if post_count == 0 {
            post_first - 1
        } else {
            post_first
        };
        offset += post_count - pre_count;

        let _ = writeln!(
            body,
            "@@ -{pre_start},{pre_count} +{post_start},{post_count} @@"
        );
        for (kind, content) in &lines {
            body.push(*kind);
            body.extend_from_slice(content);
            if !content.ends_with(b"\n") {
                body.extend_from_slice(b"\n\\ No newline at end of file\n");
            }
        }
    }
    if body.is_empty() {
        return None;
    }

    let quoted = quote_path(path);
    let mut out = Vec::with_capacity(body.len() + 128);
    let _ = writeln!(out, "diff --git {} {}", quoted("a/"), quoted("b/"));
    if pre_exists {
        // Without a mode libgit2 writes the result back as a plain 100644
        // blob; the blob ids here aren't checked, only the mode is used.
        let _ = writeln!(out, "index 0000000..0000000 {mode:o}\n--- {}", quoted("a/"));
    } else {
        let _ = writeln!(out, "new file mode {mode:o}\n--- /dev/null");
    }
    let _ = writeln!(out, "+++ {}", quoted("b/"));
    out.extend_from_slice(&body);
    Some(out)
}

/// Only the very last line of a file may lack a newline. Picking a subset of
/// changes can put a line that used to be last in front of others (e.g. an
/// unpicked removal of the old last line followed by a picked addition), so
/// such lines get their newline back: an added line simply gains one, a
/// context line is replaced by itself with one.
fn fix_missing_newlines(lines: Vec<PatchLine>) -> Vec<PatchLine> {
    let last_post = lines.iter().rposition(|(kind, _)| *kind != b'-');
    let mut fixed = Vec::with_capacity(lines.len() + 1);
    for (i, (kind, content)) in lines.into_iter().enumerate() {
        if kind == b'-' || content.ends_with(b"\n") || Some(i) == last_post {
            fixed.push((kind, content));
            continue;
        }
        let mut with_newline = content.to_vec();
        with_newline.push(b'\n');
        if kind == b' ' {
            fixed.push((b'-', content));
        }
        fixed.push((b'+', Cow::Owned(with_newline)));
    }
    fixed
}

/// Paths are C-quoted like git does when they contain characters a patch
/// header can't hold verbatim. Returns a formatter taking the `a/`/`b/` prefix.
fn quote_path(path: &str) -> impl Fn(&str) -> String + '_ {
    let needs_quoting = path
        .bytes()
        .any(|b| b < 0x20 || b == b'"' || b == b'\\' || b >= 0x7f);
    move |prefix| {
        if !needs_quoting {
            return format!("{prefix}{path}");
        }
        let mut q = String::from("\"");
        q.push_str(prefix);
        for b in path.bytes() {
            match b {
                b'"' => q.push_str("\\\""),
                b'\\' => q.push_str("\\\\"),
                b'\t' => q.push_str("\\t"),
                b'\n' => q.push_str("\\n"),
                0x20..=0x7e => q.push(b as char),
                _ => q.push_str(&format!("\\{b:03o}")),
            }
        }
        q.push('"');
        q
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Repo with `files` committed. autocrlf is pinned off so results don't
    /// depend on the machine's global git config.
    fn repo_with(dir: &Path, files: &[(&str, &str)]) -> git2::Repository {
        let repo = git2::Repository::init(dir).unwrap();
        repo.config()
            .unwrap()
            .set_bool("core.autocrlf", false)
            .unwrap();
        let mut index = repo.index().unwrap();
        for (name, content) in files {
            std::fs::write(dir.join(name), content).unwrap();
            index.add_path(Path::new(name)).unwrap();
        }
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();
        drop(tree);
        repo
    }

    fn index_content(repo: &git2::Repository, path: &str) -> String {
        let index = repo.index().unwrap();
        let entry = index.get_path(Path::new(path), 0).expect("path in index");
        String::from_utf8(repo.find_blob(entry.id).unwrap().content().to_vec()).unwrap()
    }

    fn disk(repo: &git2::Repository, path: &str) -> String {
        std::fs::read_to_string(repo.workdir().unwrap().join(path)).unwrap()
    }

    fn write(repo: &git2::Repository, path: &str, content: &str) {
        std::fs::write(repo.workdir().unwrap().join(path), content).unwrap();
    }

    fn sel(old: &[u32], new: &[u32]) -> LineSelection {
        LineSelection {
            old_lines: old.to_vec(),
            new_lines: new.to_vec(),
        }
    }

    const TEN: &str = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";

    #[test]
    fn stages_only_the_selected_added_and_removed_lines() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", TEN)]);
        // remove 2, change 5 → five, add "x" after 9
        write(&repo, "f.txt", "1\n3\n4\nfive\n6\n7\n8\n9\nx\n10\n");

        // Only the removal of line 2 and the added "x" (new line 9).
        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[2], &[9])).unwrap();

        assert_eq!(
            index_content(&repo, "f.txt"),
            "1\n3\n4\n5\n6\n7\n8\n9\nx\n10\n"
        );
        assert_eq!(disk(&repo, "f.txt"), "1\n3\n4\nfive\n6\n7\n8\n9\nx\n10\n");
    }

    #[test]
    fn stages_one_hunk_out_of_several() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", TEN)]);
        write(&repo, "f.txt", "one\n2\n3\n4\n5\n6\n7\n8\n9\nten\n");

        // The second "hunk": line 10 → ten.
        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[10], &[10])).unwrap();
        assert_eq!(
            index_content(&repo, "f.txt"),
            "1\n2\n3\n4\n5\n6\n7\n8\n9\nten\n"
        );

        // Then the first one, which leaves nothing unstaged.
        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[1], &[1])).unwrap();
        assert_eq!(index_content(&repo, "f.txt"), disk(&repo, "f.txt"));
        assert!(working::working_status(&repo).unwrap().unstaged.is_empty());
    }

    #[test]
    fn unstages_lines_of_a_partially_staged_file() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", TEN)]);
        write(&repo, "f.txt", "1\na\n2\n3\n4\n5\n6\n7\n8\nb\n9\n10\nc\n");
        working::stage_path(&repo, "f.txt").unwrap();
        // A further unstaged edit on top of what's staged.
        write(
            &repo,
            "f.txt",
            "1\na\n2\n3\n4\n5\n6\n7\n8\nb\n9\n10\nc\nd\n",
        );

        // Staged diff (HEAD→index): a = new 2, b = new 10, c = new 13. Unstage b.
        apply_lines(&repo, "f.txt", LineAction::Unstage, &sel(&[], &[10])).unwrap();

        assert_eq!(
            index_content(&repo, "f.txt"),
            "1\na\n2\n3\n4\n5\n6\n7\n8\n9\n10\nc\n"
        );
        assert_eq!(
            disk(&repo, "f.txt"),
            "1\na\n2\n3\n4\n5\n6\n7\n8\nb\n9\n10\nc\nd\n"
        );
    }

    #[test]
    fn discards_selected_lines_from_the_working_directory_only() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", TEN)]);
        write(&repo, "f.txt", "1\n2\nstaged\n3\n4\n5\n6\n7\n8\n9\n10\n");
        working::stage_path(&repo, "f.txt").unwrap();
        write(
            &repo,
            "f.txt",
            "1\n2\nstaged\n3\n4\nkeep\n5\n6\n7\n8\n9\ndrop\n10\n",
        );

        // Unstaged diff (index→workdir): keep = new 6, drop = new 12.
        apply_lines(&repo, "f.txt", LineAction::Discard, &sel(&[], &[12])).unwrap();

        assert_eq!(
            disk(&repo, "f.txt"),
            "1\n2\nstaged\n3\n4\nkeep\n5\n6\n7\n8\n9\n10\n"
        );
        assert_eq!(
            index_content(&repo, "f.txt"),
            "1\n2\nstaged\n3\n4\n5\n6\n7\n8\n9\n10\n"
        );
    }

    #[test]
    fn discarding_a_removed_line_restores_it() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", TEN)]);
        write(&repo, "f.txt", "1\n2\n4\n5\n6\n7\n8\n10\n");

        apply_lines(&repo, "f.txt", LineAction::Discard, &sel(&[3], &[])).unwrap();
        assert_eq!(disk(&repo, "f.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n10\n");
    }

    #[test]
    fn handles_a_last_line_without_newline() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", "a\nb\nc")]);
        write(&repo, "f.txt", "A\nb\nc\nd");

        // Only the "d" appended after the old newline-less last line: "c"
        // has to gain its newline for "d" to follow it.
        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[], &[4])).unwrap();
        assert_eq!(index_content(&repo, "f.txt"), "a\nb\nc\nd");

        // Now only "a" → "A" is left; staging the removal alone drops "a".
        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[1], &[])).unwrap();
        assert_eq!(index_content(&repo, "f.txt"), "b\nc\nd");
    }

    #[test]
    fn keeps_the_missing_newline_when_only_other_lines_are_staged() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", "a\nb\nc")]);
        write(&repo, "f.txt", "A\nb\nc\n");

        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[1], &[1])).unwrap();
        assert_eq!(index_content(&repo, "f.txt"), "A\nb\nc");
    }

    #[test]
    fn unstaging_the_removal_of_a_newline_less_last_line_gives_it_a_newline() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", "a\nx")]);
        write(&repo, "f.txt", "a\ny\n");
        working::stage_path(&repo, "f.txt").unwrap();

        // Staged: "-x" (no newline) then "+y". Bringing x back puts it in
        // front of y, so it can't stay newline-less.
        apply_lines(&repo, "f.txt", LineAction::Unstage, &sel(&[2], &[])).unwrap();
        assert_eq!(index_content(&repo, "f.txt"), "a\nx\ny\n");
    }

    #[test]
    fn stages_part_of_a_new_untracked_file() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", TEN)]);
        write(&repo, "new.txt", "one\ntwo\nthree\n");

        apply_lines(&repo, "new.txt", LineAction::Stage, &sel(&[], &[1, 3])).unwrap();
        assert_eq!(index_content(&repo, "new.txt"), "one\nthree\n");
        assert_eq!(disk(&repo, "new.txt"), "one\ntwo\nthree\n");

        // Unstaging one of them keeps the file added with what's left.
        apply_lines(&repo, "new.txt", LineAction::Unstage, &sel(&[], &[2])).unwrap();
        assert_eq!(index_content(&repo, "new.txt"), "one\n");
    }

    #[test]
    fn stages_part_of_a_deleted_file() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", "a\nb\nc\n")]);
        std::fs::remove_file(tmp.path().join("f.txt")).unwrap();

        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[2], &[])).unwrap();
        assert_eq!(index_content(&repo, "f.txt"), "a\nc\n");

        // Discarding part of what's still deleted brings the file back with it.
        apply_lines(&repo, "f.txt", LineAction::Discard, &sel(&[1], &[])).unwrap();
        assert_eq!(disk(&repo, "f.txt"), "a\n");
    }

    #[test]
    fn selecting_every_change_falls_back_to_whole_file_operations() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", "a\n")]);
        write(&repo, "new.txt", "x\ny\n");

        apply_lines(&repo, "new.txt", LineAction::Stage, &sel(&[], &[1, 2])).unwrap();
        assert_eq!(index_content(&repo, "new.txt"), "x\ny\n");

        apply_lines(&repo, "new.txt", LineAction::Unstage, &sel(&[], &[1, 2])).unwrap();
        assert!(repo
            .index()
            .unwrap()
            .get_path(Path::new("new.txt"), 0)
            .is_none());

        apply_lines(&repo, "new.txt", LineAction::Discard, &sel(&[], &[1, 2])).unwrap();
        assert!(!tmp.path().join("new.txt").exists());
    }

    #[test]
    fn preserves_crlf_line_endings() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", "a\r\nb\r\nc\r\n")]);
        write(&repo, "f.txt", "a\r\nB\r\nc\r\nd\r\ne\r\n");

        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[], &[4])).unwrap();
        assert_eq!(index_content(&repo, "f.txt"), "a\r\nb\r\nc\r\nd\r\n");

        apply_lines(&repo, "f.txt", LineAction::Discard, &sel(&[2], &[2])).unwrap();
        assert_eq!(disk(&repo, "f.txt"), "a\r\nb\r\nc\r\nd\r\ne\r\n");
    }

    #[test]
    fn works_with_autocrlf_converting_line_endings() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", "a\nb\nc\n")]);
        repo.config()
            .unwrap()
            .set_bool("core.autocrlf", true)
            .unwrap();
        write(&repo, "f.txt", "a\r\nB\r\nc\r\nd\r\ne\r\n");

        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[], &[4])).unwrap();
        assert_eq!(index_content(&repo, "f.txt"), "a\nb\nc\nd\n");

        apply_lines(&repo, "f.txt", LineAction::Discard, &sel(&[2], &[2])).unwrap();
        assert_eq!(disk(&repo, "f.txt"), "a\r\nb\r\nc\r\nd\r\ne\r\n");
    }

    #[test]
    fn handles_paths_with_spaces_and_unicode() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("my file ç.txt", "a\nb\n")]);
        write(&repo, "my file ç.txt", "A\nb\nc\n");

        apply_lines(&repo, "my file ç.txt", LineAction::Stage, &sel(&[], &[3])).unwrap();
        assert_eq!(index_content(&repo, "my file ç.txt"), "a\nb\nc\n");
    }

    #[test]
    fn keeps_the_executable_bit() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("run.sh", "a\nb\n")]);
        let script = tmp.path().join("run.sh");
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        working::stage_path(&repo, "run.sh").unwrap();
        write(&repo, "run.sh", "A\nb\nc\n");

        apply_lines(&repo, "run.sh", LineAction::Stage, &sel(&[], &[3])).unwrap();
        let index = repo.index().unwrap();
        let entry = index.get_path(Path::new("run.sh"), 0).unwrap();
        assert_eq!(entry.mode, 0o100755);
    }

    #[test]
    fn rejects_binary_files_and_ignores_empty_selections() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = repo_with(tmp.path(), &[("f.txt", "a\n")]);
        std::fs::write(tmp.path().join("bin.dat"), [0u8, 1, 2, 0]).unwrap();
        assert!(apply_lines(&repo, "bin.dat", LineAction::Stage, &sel(&[], &[1])).is_err());

        write(&repo, "f.txt", "b\n");
        apply_lines(&repo, "f.txt", LineAction::Stage, &sel(&[], &[])).unwrap();
        assert_eq!(index_content(&repo, "f.txt"), "a\n");
    }
}
