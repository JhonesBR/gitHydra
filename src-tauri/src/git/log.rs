use serde::{Deserialize, Serialize};

use crate::error::GitCommandError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogQuery {
    pub skip: u32,
    pub limit: u32,
    pub branch_filter: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitLogPage {
    pub commits: Vec<CommitNode>,
    pub refs: Vec<RefInfo>,
    pub next_skip: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitNode {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: i64,
    pub committer_date: i64,
    pub parents: Vec<String>,
    pub is_merge: bool,
}

#[derive(Debug, Serialize)]
pub enum RefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
    DetachedHead,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefInfo {
    pub name: String,
    pub kind: RefKind,
    pub target_sha: String,
    pub is_head: bool,
}

pub fn commit_log(
    repo: &git2::Repository,
    query: &LogQuery,
) -> Result<CommitLogPage, GitCommandError> {
    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;

    match &query.branch_filter {
        Some(names) => {
            for name in names {
                revwalk.push_ref(name)?;
            }
        }
        None => {
            revwalk.push_glob("refs/heads/*")?;
            revwalk.push_glob("refs/remotes/*")?;
        }
    }

    let skip = query.skip as usize;
    let limit = query.limit as usize;

    let mut commits = Vec::with_capacity(limit);
    let mut has_more = false;
    for (i, oid) in revwalk.skip(skip).enumerate() {
        if i == limit {
            has_more = true;
            break;
        }
        let commit = repo.find_commit(oid?)?;
        commits.push(to_commit_node(&commit));
    }

    Ok(CommitLogPage {
        commits,
        refs: collect_refs(repo)?,
        next_skip: has_more.then_some(query.skip + query.limit),
    })
}

fn to_commit_node(commit: &git2::Commit) -> CommitNode {
    let author = commit.author();
    let committer = commit.committer();
    let parents: Vec<String> = commit.parent_ids().map(|id| id.to_string()).collect();

    CommitNode {
        sha: commit.id().to_string(),
        short_sha: commit.id().to_string()[..7].to_string(),
        summary: commit.summary().ok().flatten().unwrap_or_default().to_string(),
        body: commit.body().ok().flatten().unwrap_or_default().to_string(),
        author_name: author.name().unwrap_or_default().to_string(),
        author_email: author.email().unwrap_or_default().to_string(),
        author_date: author.when().seconds(),
        committer_date: committer.when().seconds(),
        is_merge: parents.len() > 1,
        parents,
    }
}

fn collect_refs(repo: &git2::Repository) -> Result<Vec<RefInfo>, GitCommandError> {
    let head_target = repo.head().ok().and_then(|h| h.target());
    // Name-based, not sha-based: a freshly created branch points at the same
    // commit as the branch it was cut from, so comparing target shas would
    // mark both as "head" instead of just the one actually checked out.
    let current_branch = if repo.head_detached().unwrap_or(false) {
        None
    } else {
        repo.head().ok().and_then(|h| h.shorthand().ok().map(|s| s.to_string()))
    };
    let mut refs = Vec::new();

    for branch in repo.branches(Some(git2::BranchType::Local))? {
        let (branch, _) = branch?;
        push_ref(
            &mut refs,
            branch.into_reference(),
            RefKind::LocalBranch,
            current_branch.as_deref(),
        );
    }
    for branch in repo.branches(Some(git2::BranchType::Remote))? {
        let (branch, _) = branch?;
        push_ref(
            &mut refs,
            branch.into_reference(),
            RefKind::RemoteBranch,
            current_branch.as_deref(),
        );
    }
    for reference in repo.references_glob("refs/tags/*")? {
        push_ref(&mut refs, reference?, RefKind::Tag, current_branch.as_deref());
    }

    // No branch/tag points at HEAD when it's detached — synthesize a pseudo-ref
    // so the graph still shows *something* marking the current position.
    if let (true, Some(target)) = (repo.head_detached().unwrap_or(false), head_target) {
        refs.push(RefInfo {
            name: "HEAD".to_string(),
            kind: RefKind::DetachedHead,
            target_sha: target.to_string(),
            is_head: true,
        });
    }

    Ok(refs)
}

fn push_ref(
    refs: &mut Vec<RefInfo>,
    reference: git2::Reference,
    kind: RefKind,
    current_branch: Option<&str>,
) {
    let (Some(name), Some(target)) = (reference.shorthand().ok(), reference.target()) else {
        return;
    };
    let is_head = matches!(kind, RefKind::LocalBranch) && current_branch == Some(name);
    refs.push(RefInfo {
        name: name.to_string(),
        is_head,
        target_sha: target.to_string(),
        kind,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(repo: &git2::Repository, file: &str, msg: &str) {
        std::fs::write(repo.workdir().unwrap().join(file), msg).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();

        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let parent = repo.head().ok().and_then(|h| h.target());
        let tree = repo.find_tree(tree_id).unwrap();
        let parents: Vec<_> = parent.and_then(|oid| repo.find_commit(oid).ok()).into_iter().collect();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
            .unwrap();
    }

    #[test]
    fn paginates_commits_in_topological_order() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit(&repo, "a.txt", "first");
        commit(&repo, "a.txt", "second");
        commit(&repo, "a.txt", "third");

        let page1 = commit_log(
            &repo,
            &LogQuery {
                skip: 0,
                limit: 2,
                branch_filter: None,
            },
        )
        .unwrap();
        assert_eq!(page1.commits.len(), 2);
        assert_eq!(page1.commits[0].summary, "third");
        assert_eq!(page1.commits[1].summary, "second");
        assert_eq!(page1.next_skip, Some(2));

        let page2 = commit_log(
            &repo,
            &LogQuery {
                skip: 2,
                limit: 2,
                branch_filter: None,
            },
        )
        .unwrap();
        assert_eq!(page2.commits.len(), 1);
        assert_eq!(page2.commits[0].summary, "first");
        assert_eq!(page2.next_skip, None);

        assert!(page1.refs.iter().any(|r| r.is_head));
    }

    #[test]
    fn only_the_checked_out_branch_is_head_even_when_a_sibling_shares_its_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit(&repo, "a.txt", "first");
        let base_branch = repo.head().unwrap().shorthand().unwrap().to_string();
        let base_commit = repo.head().unwrap().peel_to_commit().unwrap();

        // "staging" is cut from the current branch with no new commits, so
        // both branches point at the exact same commit.
        repo.branch("staging", &base_commit, false).unwrap();
        repo.set_head("refs/heads/staging").unwrap();

        let page = commit_log(
            &repo,
            &LogQuery {
                skip: 0,
                limit: 10,
                branch_filter: None,
            },
        )
        .unwrap();

        let staging_ref = page.refs.iter().find(|r| r.name == "staging").unwrap();
        let base_ref = page.refs.iter().find(|r| r.name == base_branch).unwrap();
        assert!(staging_ref.is_head);
        assert!(!base_ref.is_head);
    }

    #[test]
    fn synthesizes_a_head_ref_when_detached() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit(&repo, "a.txt", "first");
        commit(&repo, "a.txt", "second");
        let target = repo.head().unwrap().target().unwrap();

        // attached: no synthetic ref, the branch itself carries is_head
        let attached = commit_log(&repo, &LogQuery { skip: 0, limit: 10, branch_filter: None }).unwrap();
        assert!(!attached.refs.iter().any(|r| matches!(r.kind, RefKind::DetachedHead)));

        repo.set_head_detached(target).unwrap();
        let detached = commit_log(&repo, &LogQuery { skip: 0, limit: 10, branch_filter: None }).unwrap();
        let head_ref = detached
            .refs
            .iter()
            .find(|r| matches!(r.kind, RefKind::DetachedHead))
            .expect("expected a synthesized HEAD ref");
        assert_eq!(head_ref.name, "HEAD");
        assert!(head_ref.is_head);
        assert_eq!(head_ref.target_sha, target.to_string());
    }
}
