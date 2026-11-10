//! Finds the Claude Code conversation running in each terminal, from the
//! per-process files Claude Code writes to `~/.claude/sessions/<pid>.json`.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;

use serde::Deserialize;
use tauri::State;

use crate::pty::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSessionFile {
    pid: u32,
    session_id: String,
    #[serde(default)]
    job_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

/// The process currently running a conversation, from its session file.
#[derive(Clone)]
pub(crate) struct ConversationProcess {
    pub pid: u32,
    pub status: Option<String>,
}

#[derive(Default)]
pub(crate) struct ClaudeSessions {
    by_pid: HashMap<u32, String>,
    // Daemon (`kind: bg`) conversations, keyed by the short id `claude attach` takes.
    by_job: HashMap<String, String>,
    by_session: HashMap<String, ConversationProcess>,
}

impl ClaudeSessions {
    pub(crate) fn process_of(&self, session_id: &str) -> Option<&ConversationProcess> {
        self.by_session.get(session_id)
    }
}

pub(crate) struct Process {
    ppid: u32,
    pub rss_kb: Option<u64>,
    args: String,
}

#[tauri::command]
pub async fn claude_session_ids(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let roots = state.session_child_pids();
        if roots.is_empty() {
            return HashMap::new();
        }
        resolve(&roots, &read_process_table(), &read_claude_sessions())
    })
    .await
    .map_err(|e| format!("claude session lookup failed: {e}"))
}

pub(crate) fn read_process_table() -> HashMap<u32, Process> {
    match std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,rss=,command="])
        .output()
    {
        Ok(output) if output.status.success() => parse_process_table(&String::from_utf8_lossy(&output.stdout)),
        _ => HashMap::new(),
    }
}

fn parse_process_table(table: &str) -> HashMap<u32, Process> {
    let mut processes = HashMap::new();
    for line in table.lines() {
        let Some((pid, rest)) = line.trim_start().split_once(char::is_whitespace) else {
            continue;
        };
        let rest = rest.trim_start();
        let (ppid, rest) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
        let rest = rest.trim_start();
        let (rss, args) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
        let (Ok(pid), Ok(ppid)) = (pid.parse::<u32>(), ppid.parse::<u32>()) else {
            continue;
        };
        processes.insert(
            pid,
            Process { ppid, rss_kb: rss.parse::<u64>().ok(), args: args.trim().to_string() },
        );
    }
    processes
}

pub(crate) fn claude_config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude"))
}

pub(crate) fn read_claude_sessions() -> ClaudeSessions {
    let Some(entries) = claude_config_dir().and_then(|dir| std::fs::read_dir(dir.join("sessions")).ok()) else {
        return ClaudeSessions::default();
    };
    let files = entries.filter_map(|entry| {
        let path = entry.ok()?.path();
        if path.extension()? != "json" {
            return None;
        }
        serde_json::from_str::<ClaudeSessionFile>(&std::fs::read_to_string(path).ok()?).ok()
    });
    collect_sessions(files)
}

fn collect_sessions(files: impl IntoIterator<Item = ClaudeSessionFile>) -> ClaudeSessions {
    let mut sessions = ClaudeSessions::default();
    for file in files {
        if let Some(job_id) = file.job_id.filter(|j| !j.is_empty()) {
            sessions.by_job.insert(job_id, file.session_id.clone());
        }
        sessions.by_session.insert(
            file.session_id.clone(),
            ConversationProcess { pid: file.pid, status: file.status },
        );
        sessions.by_pid.insert(file.pid, file.session_id);
    }
    sessions
}

/// The `<id>` of a `claude attach <id>` command line.
fn attach_target(args: &str) -> Option<&str> {
    let mut tokens = args.split_whitespace();
    let program = tokens.next()?;
    if program.rsplit('/').next() != Some("claude") || tokens.next() != Some("attach") {
        return None;
    }
    tokens.next().filter(|id| !id.starts_with('-'))
}

/// For each (terminal id, shell pid), the conversation of the nearest Claude
/// Code process in that shell's process tree.
pub(crate) fn resolve(
    roots: &[(String, u32)],
    processes: &HashMap<u32, Process>,
    sessions: &ClaudeSessions,
) -> HashMap<String, String> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, process) in processes {
        children.entry(process.ppid).or_default().push(*pid);
    }
    for kids in children.values_mut() {
        kids.sort_unstable();
    }

    let mut found = HashMap::new();
    for (terminal_id, root) in roots {
        let mut queue = VecDeque::from([*root]);
        let mut seen = HashSet::new();
        while let Some(pid) = queue.pop_front() {
            if !seen.insert(pid) {
                continue;
            }
            if let Some(session_id) = sessions.by_pid.get(&pid) {
                found.insert(terminal_id.clone(), session_id.clone());
                break;
            }
            if let Some(job) = processes.get(&pid).and_then(|p| attach_target(&p.args)) {
                let session_id = sessions.by_job.get(job).cloned().unwrap_or_else(|| job.to_string());
                found.insert(terminal_id.clone(), session_id);
                break;
            }
            if let Some(kids) = children.get(&pid) {
                queue.extend(kids);
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS: &str = "\
  100     1  90000 /Applications/Agents UI.app/Contents/MacOS/agents-ui
  200   100   4000 /bin/agsh
  201   200 512000 /Users/me/.local/bin/claude --dangerously-skip-permissions
  300   100   4000 /bin/agsh
  301   300  60000 claude attach d03e89b3
  400   100   4000 /bin/agsh
  401   400   8000 /usr/bin/vim notes.md
  500   100   4000 /bin/agsh
  501   500  60000 claude attach ffff0000
  600   100   4000 /bin/agsh
  601   600   3000 /bin/bash
  602   601 125000 claude
";

    fn session(pid: u32, session_id: &str, job_id: Option<&str>) -> ClaudeSessionFile {
        ClaudeSessionFile {
            pid,
            session_id: session_id.to_string(),
            job_id: job_id.map(str::to_string),
            status: Some("busy".to_string()),
        }
    }

    fn known_sessions() -> ClaudeSessions {
        collect_sessions([
            session(201, "cfc0ee05-e766-41bf-ab43-893edaacd0e7", None),
            session(25754, "d03e89b3-4ae6-43a8-97d9-7a320a1ad5e9", Some("d03e89b3")),
            session(602, "7090b1a1-857b-4b5d-82d7-c6db7fd7369f", None),
        ])
    }

    fn lookup(root: u32) -> Option<String> {
        let found = resolve(&[("tab".to_string(), root)], &parse_process_table(PS), &known_sessions());
        found.get("tab").cloned()
    }

    #[test]
    fn resolve_claude_running_in_terminal_returns_its_session_id() {
        assert_eq!(lookup(200).as_deref(), Some("cfc0ee05-e766-41bf-ab43-893edaacd0e7"));
    }

    #[test]
    fn resolve_claude_attach_to_daemon_session_returns_full_session_id() {
        assert_eq!(lookup(300).as_deref(), Some("d03e89b3-4ae6-43a8-97d9-7a320a1ad5e9"));
    }

    #[test]
    fn resolve_claude_attach_to_unknown_job_returns_job_id() {
        assert_eq!(lookup(500).as_deref(), Some("ffff0000"));
    }

    #[test]
    fn resolve_claude_nested_in_subshell_returns_its_session_id() {
        assert_eq!(lookup(600).as_deref(), Some("7090b1a1-857b-4b5d-82d7-c6db7fd7369f"));
    }

    #[test]
    fn resolve_terminal_without_claude_returns_nothing() {
        assert_eq!(lookup(400), None);
    }

    #[test]
    fn resolve_terminal_whose_shell_is_gone_returns_nothing() {
        assert_eq!(lookup(999), None);
    }

    #[test]
    fn resolve_each_terminal_gets_only_its_own_conversation() {
        let roots = [("a".to_string(), 200), ("b".to_string(), 300), ("c".to_string(), 400)];
        let found = resolve(&roots, &parse_process_table(PS), &known_sessions());
        assert_eq!(found.len(), 2);
        assert_eq!(found["a"], "cfc0ee05-e766-41bf-ab43-893edaacd0e7");
        assert_eq!(found["b"], "d03e89b3-4ae6-43a8-97d9-7a320a1ad5e9");
    }

    #[test]
    fn parse_process_table_reads_resident_memory_and_full_command() {
        let processes = parse_process_table(PS);
        assert_eq!(processes[&201].rss_kb, Some(512000));
        assert_eq!(processes[&100].args, "/Applications/Agents UI.app/Contents/MacOS/agents-ui");
    }

    #[test]
    fn process_of_daemon_conversation_returns_its_process_and_status() {
        let process = known_sessions().process_of("d03e89b3-4ae6-43a8-97d9-7a320a1ad5e9").cloned().unwrap();
        assert_eq!(process.pid, 25754);
        assert_eq!(process.status.as_deref(), Some("busy"));
    }

    #[test]
    fn attach_target_ignores_other_claude_commands() {
        assert_eq!(attach_target("claude attach d03e89b3"), Some("d03e89b3"));
        assert_eq!(attach_target("/usr/local/bin/claude attach abc"), Some("abc"));
        assert_eq!(attach_target("claude --resume abc"), None);
        assert_eq!(attach_target("claude attach --help"), None);
        assert_eq!(attach_target("notclaude attach abc"), None);
    }
}
