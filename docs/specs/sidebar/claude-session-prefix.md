# Claude session prefix in the session list

## Problem
Several terminals each run a Claude Code conversation, and nothing in the sidebar says which conversation is which. To `claude attach`, `claude --resume` or match a transcript, you had to dig the ID out of `ps` or `~/.claude`.

## Decision
- Each sidebar row that runs Claude Code shows the first 6 characters of its conversation ID in parentheses before the title, for example `(cfc0ee) Agents UI`. The tooltip shows the full ID.
- The ID comes from the files Claude Code writes per process, `~/.claude/sessions/<pid>.json` (or `$CLAUDE_CONFIG_DIR/sessions`), which hold `pid`, `sessionId` and, for daemon conversations, `jobId`.
- The backend (`claude_session_ids`, `src-tauri/src/claude_sessions.rs`) takes one `ps` snapshot, walks each terminal's process tree from its shell, and uses the nearest process that:
  - has a session file, which gives its `sessionId`; or
  - is a `claude attach <job>` client, which gives the `sessionId` of the daemon file with that `jobId`, or `<job>` itself when no such file exists.
- The frontend polls every 4s and updates only when the result changes. The value is a label only and is never persisted.
- It shows the **current** conversation: a daemon job keeps its `attach` handle while its conversation ID changes (after `/clear` or a resume), and the prefix follows the conversation.

## Alternatives considered
- Parsing `--resume <id>` from the launch command: it misses fresh conversations and `attach`, and it goes stale after `/clear`.
- Claude Code hooks or the MCP connection reporting the ID: they need per-user configuration and don't cover conversations that were already running.
- Reading the `CLAUDE_CODE_SESSION_ID` environment variable of child processes: macOS limits reading other processes' environment, while the session files are written for exactly this kind of discovery.

## Contracts
A new Tauri command, `claude_session_ids() -> { [terminalSessionId]: claudeSessionId }`. The app only reads the Claude Code session files and never writes them.

## Rollout & risk
- No persisted-state or schema change.
- Each poll costs one `ps` and reading a few small JSON files, run off the main thread.
- Persistent (zellij) terminals are not covered: their processes live under the zellij server, not the terminal's shell.
- If the Claude Code file format changes, the prefix just stops showing; nothing breaks.
- To roll back, revert the commit.

## Acceptance criteria
1. A terminal running `claude` shows `(xxxxxx)` with the first 6 characters of its `sessionId`.
2. A terminal running `claude attach <job>` shows the prefix of that job's current conversation.
3. A terminal running `claude attach` for a job with no session file shows the job's prefix.
4. `claude` started from a subshell inside the terminal is still found.
5. A terminal without Claude Code shows no prefix.
6. Each terminal shows only its own conversation, never another terminal's.

Criteria 1 to 6 are covered by the unit tests in `src-tauri/src/claude_sessions.rs`. The prefix formatting is covered by `tests/claudeSessionIds.test.ts`. Behavior in the app is checked by hand.
