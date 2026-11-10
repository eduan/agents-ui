//! Live metrics for the Claude Code conversation running in a terminal: status
//! and memory from its process, model/context/tokens/turns from its transcript.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::claude_sessions::{claude_config_dir, read_claude_sessions, read_process_table, resolve};
use crate::pty::AppState;

const STANDARD_CONTEXT_WINDOW: u64 = 200_000;
const LARGE_CONTEXT_WINDOW: u64 = 1_000_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMetrics {
    session_id: String,
    status: Option<String>,
    model: Option<String>,
    context_tokens: u64,
    context_window: u64,
    total_tokens: u64,
    turns: u64,
    memory_bytes: Option<u64>,
}

#[derive(Default)]
struct TranscriptStats {
    model: Option<String>,
    context_tokens: u64,
    total_tokens: u64,
    turns: u64,
    seen_messages: HashSet<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    is_sidechain: bool,
    #[serde(default)]
    is_meta: bool,
    message: Option<serde_json::Value>,
}

#[derive(Deserialize, Default)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

impl TranscriptStats {
    fn ingest_line(&mut self, line: &str) {
        let Ok(entry) = serde_json::from_str::<Entry>(line) else {
            return;
        };
        if entry.is_sidechain {
            return;
        }
        let Some(message) = entry.message else {
            return;
        };
        match entry.kind.as_str() {
            "assistant" => self.ingest_assistant(&message),
            "user" if !entry.is_meta && is_prompt(&message) => self.turns += 1,
            _ => {}
        }
    }

    fn ingest_assistant(&mut self, message: &serde_json::Value) {
        let Some(usage) = message.get("usage").and_then(|u| Usage::deserialize(u).ok()) else {
            return;
        };
        if let Some(model) = message.get("model").and_then(|m| m.as_str()) {
            self.model = Some(model.to_string());
        }
        self.context_tokens = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
        let id = message.get("id").and_then(|i| i.as_str()).unwrap_or_default();
        if id.is_empty() || self.seen_messages.insert(id.to_string()) {
            self.total_tokens += usage.input_tokens + usage.cache_creation_input_tokens + usage.output_tokens;
        }
    }
}

fn is_prompt(message: &serde_json::Value) -> bool {
    match message.get("content") {
        Some(serde_json::Value::String(text)) => !text.trim().is_empty(),
        Some(serde_json::Value::Array(blocks)) => {
            !blocks.is_empty()
                && !blocks.iter().any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
        }
        _ => false,
    }
}

/// `[1m]`-suffixed ids, Fable/Mythos, Opus/Sonnet 4.6+ and Haiku 5+ have a
/// 1M window; anything else is assumed 200K unless usage already exceeds it.
fn context_window_for(model: Option<&str>, context_tokens: u64) -> u64 {
    if context_tokens > STANDARD_CONTEXT_WINDOW || model.is_some_and(has_large_context) {
        LARGE_CONTEXT_WINDOW
    } else {
        STANDARD_CONTEXT_WINDOW
    }
}

fn has_large_context(model: &str) -> bool {
    if model.contains("[1m]") {
        return true;
    }
    let mut parts = model.trim_start_matches("claude-").split('-');
    let family = parts.next().unwrap_or_default();
    let major: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let minor: u32 = parts.next().and_then(|p| p.parse().ok()).filter(|m| *m < 100).unwrap_or(0);
    match family {
        "fable" | "mythos" => true,
        "opus" | "sonnet" => (major, minor) >= (4, 6),
        "haiku" => major >= 5,
        _ => false,
    }
}

struct CachedTranscript {
    path: PathBuf,
    offset: u64,
    stats: TranscriptStats,
}

fn transcript_cache() -> &'static Mutex<HashMap<String, CachedTranscript>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedTranscript>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn find_transcript(session_id: &str) -> Option<PathBuf> {
    let file_name = format!("{session_id}.jsonl");
    std::fs::read_dir(claude_config_dir()?.join("projects"))
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path().join(&file_name))
        .find(|path| path.is_file())
}

/// Parses only what was appended since the last call; a shrunken file is re-read.
fn refresh_transcript(cached: &mut CachedTranscript) {
    let Ok(mut file) = std::fs::File::open(&cached.path) else {
        return;
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if len < cached.offset {
        cached.offset = 0;
        cached.stats = TranscriptStats::default();
    }
    if len == cached.offset || file.seek(SeekFrom::Start(cached.offset)).is_err() {
        return;
    }
    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return;
    }
    let Some(last_newline) = buf.iter().rposition(|b| *b == b'\n') else {
        return;
    };
    for line in String::from_utf8_lossy(&buf[..last_newline]).lines() {
        cached.stats.ingest_line(line);
    }
    cached.offset += last_newline as u64 + 1;
}

fn transcript_metrics(session_id: &str) -> Option<(Option<String>, u64, u64, u64)> {
    let mut cache = transcript_cache().lock().ok()?;
    if !cache.contains_key(session_id) {
        let path = find_transcript(session_id)?;
        cache.insert(
            session_id.to_string(),
            CachedTranscript { path, offset: 0, stats: TranscriptStats::default() },
        );
    }
    let cached = cache.get_mut(session_id)?;
    refresh_transcript(cached);
    let stats = &cached.stats;
    Some((stats.model.clone(), stats.context_tokens, stats.total_tokens, stats.turns))
}

#[tauri::command]
pub async fn claude_session_metrics(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Option<ClaudeMetrics>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let roots: Vec<(String, u32)> =
            state.session_child_pids().into_iter().filter(|(id, _)| *id == terminal_id).collect();
        if roots.is_empty() {
            return None;
        }
        let processes = read_process_table();
        let sessions = read_claude_sessions();
        let session_id = resolve(&roots, &processes, &sessions).remove(&terminal_id)?;
        let process = sessions.process_of(&session_id);
        let memory_bytes = process
            .and_then(|p| processes.get(&p.pid))
            .and_then(|p| p.rss_kb)
            .map(|kb| kb * 1024);
        let (model, context_tokens, total_tokens, turns) =
            transcript_metrics(&session_id).unwrap_or((None, 0, 0, 0));
        Some(ClaudeMetrics {
            context_window: context_window_for(model.as_deref(), context_tokens),
            status: process.and_then(|p| p.status.clone()),
            session_id,
            model,
            context_tokens,
            total_tokens,
            turns,
            memory_bytes,
        })
    })
    .await
    .map_err(|e| format!("claude metrics lookup failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assistant(id: &str, model: &str, input: u64, cache_create: u64, cache_read: u64, output: u64) -> String {
        format!(
            r#"{{"type":"assistant","isSidechain":false,"message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":{input},"cache_creation_input_tokens":{cache_create},"cache_read_input_tokens":{cache_read},"output_tokens":{output}}}}}}}"#
        )
    }

    fn ingest(lines: &[String]) -> TranscriptStats {
        let mut stats = TranscriptStats::default();
        for line in lines {
            stats.ingest_line(line);
        }
        stats
    }

    #[test]
    fn ingest_line_assistant_turn_sets_model_and_context_in_use() {
        let stats = ingest(&[assistant("m1", "claude-opus-5-5", 4, 9, 437_229, 2_328)]);
        assert_eq!(stats.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(stats.context_tokens, 437_242);
    }

    #[test]
    fn ingest_line_message_split_across_lines_counts_tokens_once() {
        let line = assistant("m1", "claude-opus-5-5", 10, 20, 1_000, 5);
        let stats = ingest(&[line.clone(), line]);
        assert_eq!(stats.total_tokens, 35);
    }

    #[test]
    fn ingest_line_total_tokens_exclude_cache_reads_across_messages() {
        let stats = ingest(&[
            assistant("m1", "claude-opus-5-5", 10, 20, 1_000, 5),
            assistant("m2", "claude-opus-5-5", 1, 2, 2_000, 3),
        ]);
        assert_eq!(stats.total_tokens, 41);
        assert_eq!(stats.context_tokens, 2_003);
    }

    #[test]
    fn ingest_line_counts_user_prompts_only() {
        let stats = ingest(&[
            r#"{"type":"user","message":{"role":"user","content":"fix the bug"}}"#.to_string(),
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"and this"}]}}"#.to_string(),
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#.to_string(),
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"<local-command-stdout>"}}"#.to_string(),
            r#"{"type":"user","isSidechain":true,"message":{"role":"user","content":"subagent task"}}"#.to_string(),
        ]);
        assert_eq!(stats.turns, 2);
    }

    #[test]
    fn ingest_line_sidechain_assistant_does_not_change_main_context() {
        let mut sidechain = assistant("s1", "claude-haiku-5-5", 1, 1, 50, 1);
        sidechain = sidechain.replace(r#""isSidechain":false"#, r#""isSidechain":true"#);
        let stats = ingest(&[assistant("m1", "claude-opus-5-5", 1, 1, 100, 1), sidechain]);
        assert_eq!(stats.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(stats.context_tokens, 102);
    }

    #[test]
    fn ingest_line_garbage_or_other_entry_types_are_ignored() {
        let stats = ingest(&[
            "not json".to_string(),
            r#"{"type":"system","subtype":"init"}"#.to_string(),
            r#"{"type":"attachment"}"#.to_string(),
        ]);
        assert_eq!((stats.turns, stats.total_tokens, stats.context_tokens), (0, 0, 0));
        assert!(stats.model.is_none());
    }

    #[test]
    fn refresh_transcript_reads_only_appended_complete_lines_and_restarts_when_shrunk() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("agents-ui-transcript-{}.jsonl", std::process::id()));
        let prompt = r#"{"type":"user","message":{"role":"user","content":"hi"}}"#;
        std::fs::write(&path, format!("{prompt}\n{prompt}\n")).unwrap();
        let mut cached = CachedTranscript { path: path.clone(), offset: 0, stats: TranscriptStats::default() };

        refresh_transcript(&mut cached);
        assert_eq!(cached.stats.turns, 2);

        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        write!(file, "{}", &prompt[..20]).unwrap();
        refresh_transcript(&mut cached);
        assert_eq!(cached.stats.turns, 2, "a partial line is not parsed yet");

        writeln!(file, "{}", &prompt[20..]).unwrap();
        refresh_transcript(&mut cached);
        assert_eq!(cached.stats.turns, 3);

        std::fs::write(&path, format!("{prompt}\n")).unwrap();
        refresh_transcript(&mut cached);
        assert_eq!(cached.stats.turns, 1, "a rewritten, shorter file is read from the start");

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn context_window_for_current_models_is_one_million() {
        for model in ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-4-6", "claude-sonnet-4-6"] {
            assert_eq!(context_window_for(Some(model), 10), LARGE_CONTEXT_WINDOW, "{model}");
        }
    }

    #[test]
    fn context_window_for_older_models_is_two_hundred_thousand() {
        for model in ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5", "claude-3-7-sonnet"] {
            assert_eq!(context_window_for(Some(model), 10), STANDARD_CONTEXT_WINDOW, "{model}");
        }
    }

    #[test]
    fn context_window_for_usage_beyond_standard_window_is_one_million() {
        assert_eq!(context_window_for(Some("claude-haiku-4-5"), 250_000), LARGE_CONTEXT_WINDOW);
        assert_eq!(context_window_for(None, 250_000), LARGE_CONTEXT_WINDOW);
    }

    #[test]
    fn context_window_for_unknown_model_is_two_hundred_thousand() {
        assert_eq!(context_window_for(None, 10), STANDARD_CONTEXT_WINDOW);
    }
}
