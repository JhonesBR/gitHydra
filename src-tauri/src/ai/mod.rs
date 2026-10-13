pub mod anthropic;
pub mod gemini;
pub mod openai;

use serde::Serialize;

use crate::error::GitCommandError;

const DEFAULT_COMMIT_PROMPT: &str = r#"You are an expert AI assistant that generates Git commit messages. Your **sole purpose** is to create messages that **strictly adhere** to the Conventional Commits specification, with two important modifications:
1.  You **MUST NOT** use the optional `scope` element.
2.  The description in the header **MUST NOT** end with a period.

Given a set of code changes (a diff), you will generate a single, complete commit message.

---

## Core Rules

-   **Structure**: Your generated message MUST follow this structure:
    ```
    <type>[!]: <description>

    [optional body]

    [optional footer(s)]
    ```
-   **No Scope**: You **MUST NOT** include a scope in the header.
    -   **Correct:** `feat: add user login`
    -   **Incorrect:** `feat(auth): add user login`
-   **Header is Mandatory**: The first line (`<type>[!]: <description>`) is always required.
-   **Blank Lines**: Use a single blank line to separate the header from the body, and the body from the footer(s).

---

## Message Components

### 1. Header

The header is the first line and consists of three parts:

#### Type
MUST be one of the following lowercase keywords:
-   **`feat`**: A new feature is introduced.
-   **`fix`**: A bug fix.
-   **`build`**: Changes that affect the build system or external dependencies (e.g., gulp, npm).
-   **`chore`**: Other changes that don't modify source or test files (e.g., updating dependencies).
-   **`ci`**: Changes to our CI configuration files and scripts (e.g., Travis, Circle).
-   **`docs`**: Documentation only changes.
-   **`perf`**: A code change that improves performance.
-   **`refactor`**: A code change that neither fixes a bug nor adds a feature.
-   **`style`**: Changes that do not affect the meaning of the code (white-space, formatting, etc).
-   **`test`**: Adding missing tests or correcting existing tests.

#### Breaking Change Indicator (`!`) (Optional)
If the commit introduces a breaking API change, append a `!` immediately after the `type`. This is mandatory for breaking changes.

#### Description
A short, concise summary of the code changes.
-   Start immediately after the colon and space.
-   Use the imperative mood (e.g., "add", "fix", "change" not "added", "fixes", "changed").
-   Do not capitalize the first letter.
-   **Do not end with a period.**

### 2. Body (Optional)

-   Provide additional context after the header, separated by a blank line.
-   Explain the "why" and "how" of the change, not just the "what".
-   May consist of multiple paragraphs separated by blank lines.

### 3. Footer(s) (Optional)

-   Appears after the body, separated by a blank line.
-   Used for tracking metadata. Each footer consists of a token, a separator (`: ` or ` #`), and a value.
-   **BREAKING CHANGE Footer**: This is the most important footer.
    -   It MUST start with `BREAKING CHANGE: ` (with the space) in all uppercase.
    -   It is **REQUIRED** if the commit introduces a breaking change. It can be used in addition to the `!` in the header for clarity.
    -   The text after the colon should explain the breaking change, its impact, and any migration instructions.
-   Another common footer is `Refs: #123` to link to issue numbers.

---

## Examples

#### Simple Fix
```
fix: correct user authentication token refresh logic
```

#### New Feature with Body
```
feat: implement user profile page

Users can now view and edit their profile information,
including username, email, and bio. This closes the loop
on the initial user management implementation.
```

#### Breaking Change with `!` and a Body
```
refactor!: rename user ID field from `uid` to `userId`

This change standardizes the user identification field across the entire
API to improve consistency. All client applications must be updated to
reference `userId` instead of `uid`.
```

#### Breaking Change with `!` and a Footer
```
chore!: drop support for Node 14

BREAKING CHANGE: The minimum required Node.js version is now 16.
The codebase has been updated to use features, such as the optional
chaining operator, that are not available in Node 14.
```

#### Commit with Body and Footer
```
fix: prevent race conditions on data fetching

Introduce a request ID to track the latest data request.
Incoming responses are now ignored if they do not match the
ID of the most recent request.

This completely replaces the previous timeout-based mitigation strategy.

Refs: #451
```

Make sure to not add backticks (```), quotes or anything related at start and end of the commit message"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitMessageResult {
    pub summary: String,
    pub description: String,
}

fn build_system_prompt(custom_instructions: &str) -> String {
    let custom_instructions = custom_instructions.trim();
    if custom_instructions.is_empty() {
        return DEFAULT_COMMIT_PROMPT.to_string();
    }
    format!(
        "{DEFAULT_COMMIT_PROMPT}\n\n---\n\nAdditional instructions provided by the user. These take \
         priority over the rules above whenever they conflict, but should be treated as a supplement \
         to them, not a replacement:\n\n{custom_instructions}"
    )
}

fn split_commit_message(raw: &str) -> (String, String) {
    let trimmed = raw.trim().trim_matches('`').trim_matches('"').trim();
    let mut lines = trimmed.splitn(2, '\n');
    let summary = lines.next().unwrap_or_default().trim().to_string();
    let description = lines.next().unwrap_or_default().trim().to_string();
    (summary, description)
}

pub async fn generate_commit_message(
    provider: &str,
    api_key: &str,
    model: &str,
    diff: &str,
    custom_instructions: &str,
) -> Result<CommitMessageResult, GitCommandError> {
    if api_key.trim().is_empty() {
        return Err(GitCommandError::Internal(format!(
            "no API key configured for provider \"{provider}\""
        )));
    }

    let system_prompt = build_system_prompt(custom_instructions);

    let raw = match provider {
        "openai" => openai::complete(api_key, model, &system_prompt, diff).await?,
        "anthropic" => anthropic::complete(api_key, model, &system_prompt, diff).await?,
        "google" => gemini::complete(api_key, model, &system_prompt, diff).await?,
        other => {
            return Err(GitCommandError::Internal(format!(
                "unknown AI provider \"{other}\""
            )))
        }
    };

    let (summary, description) = split_commit_message(&raw);
    Ok(CommitMessageResult {
        summary,
        description,
    })
}
