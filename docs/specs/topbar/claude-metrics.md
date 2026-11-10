# Claude metrics in the top bar

## Problem
The top bar shows machine health (CPU, MEM, DISK) but nothing about the Claude Code conversation running in the active terminal. Is it working, which model is it on, how full is its context, how much has it used? Answering that meant switching into the terminal or running `/status`.

## Decision
When the active terminal runs a Claude Code conversation, the top bar adds, after DISK, in the same label/value style:

| Label | Value | Source |
|---|---|---|
| CLAUDE | `Working` / `Idle` / other status | `status` in `~/.claude/sessions/<pid>.json` (`busy` shows as Working, `idle` as Idle, anything else capitalized) |
| MODEL | the model id without the `claude-` prefix, e.g. `opus-5-5` | `message.model` of the latest assistant entry in the transcript |
| CTX | percentage of the context window in use | the latest assistant entry's `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, divided by the model's context window |
| TOK | total tokens of the conversation | sum, over distinct assistant messages (deduplicated by `message.id`), of `input + cache_creation + output` tokens. Cache reads are excluded so the history isn't counted again on every turn. |
| MEM | resident memory of the Claude process | RSS from `ps` for that session's process (the daemon process for `claude attach`) |
| TURN | number of user prompts | user entries that are not meta, not sidechain and not tool results |

- **Finding the conversation:** the conversation is found exactly as for the session prefix in the sidebar (`docs/specs/sidebar/claude-session-prefix.md`). The transcript is `<projects dir>/*/<sessionId>.jsonl` under `~/.claude` (or `$CLAUDE_CONFIG_DIR`).
- **Context window:** 1,000,000 tokens for current models (Opus 4.6 and later, Sonnet 4.6 and later, Haiku 5.5, Fable, Mythos). 200,000 tokens for Haiku 4.5 and older models. If the tokens in use ever exceed the window assumed for a model, the 1M window is used.
- **Reading the transcript:** transcripts reach several MB, so they are read incrementally. Each file's byte offset and running totals are cached, and only complete new lines are parsed. A file that shrinks is re-read from the start.
- **When it shows:** the frontend polls `claude_session_metrics` every 3s, only while the window is visible, keyed to the active terminal. It shows nothing when the terminal has no Claude conversation. Nothing is persisted.
- Hovering an item shows the exact numbers.

## Alternatives considered
- **Statusline hooks or `/status` scraping:** these need per-user configuration or terminal-output parsing. The session files and transcripts already hold the data.
- **Re-reading the whole transcript on every poll:** reads megabytes every 3s.
- **Counting cache reads in TOK:** the number then grows with every turn by the size of the whole history and stops meaning "tokens used".

## Contracts
A new Tauri command: `claude_session_metrics({ terminalId }) -> { sessionId, status, model, contextTokens, contextWindow, totalTokens, turns, memoryBytes } | null`. It only reads Claude Code's files.

## Rollout & risk
Frontend plus a new command; there is no persisted-state change. If Claude Code's file formats change, fields go missing or the group stops showing; nothing else breaks. To roll back, revert the commit.

## Acceptance criteria
1. With the active terminal running Claude Code, the top bar shows CLAUDE, MODEL, CTX, TOK, MEM and TURN after DISK.
2. CLAUDE reads Working while the conversation is busy and Idle when it is waiting for input.
3. CTX matches the latest assistant turn's input + cache tokens divided by the model's window (for example, 437k on Opus 5.5 shows 44%).
4. TOK counts each assistant message once, even though the transcript splits it across several lines.
5. TURN counts user prompts and ignores tool results, meta entries and sidechains.
6. A terminal without Claude Code shows no Claude group.
7. A large transcript is read once, and later polls only read what was appended.
