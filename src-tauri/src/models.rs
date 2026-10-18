use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub done: bool,
    pub sort: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub estimate_min: Option<i64>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub sched_start: Option<String>,
    pub sched_end: Option<String>,
    pub project_id: Option<String>,
    pub importance: i64,
    pub pinned: bool,
    pub pin_order: i64,
    pub manual_order: i64,
    pub recurrence: Option<serde_json::Value>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub subtasks: Vec<Subtask>,
    /// Total focused seconds across completed or stopped focus sessions.
    #[serde(default)]
    pub focus_sec: i64,
}

/// The user-editable fields of a task. Used for both create (id ignored) and update.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskInput {
    pub id: Option<String>,
    pub title: String,
    pub notes: String,
    pub estimate_min: Option<i64>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub sched_start: Option<String>,
    pub sched_end: Option<String>,
    pub project_id: Option<String>,
    pub importance: Option<i64>,
    pub recurrence: Option<serde_json::Value>,
    /// Create only: initial subtasks.
    pub subtasks: Vec<String>,
    /// Create only: pin immediately.
    pub pinned: bool,
}

/// Dates for the next instance of a recurring task, computed by the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NextOccurrence {
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub sched_start: Option<String>,
    pub sched_end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteResult {
    pub task: Task,
    pub next: Option<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub task_id: Option<String>,
    pub kind: String,
    pub planned_sec: i64,
    pub started_at: String,
    pub paused_at: Option<String>,
    pub paused_total_sec: i64,
    pub ended_at: Option<String>,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub tasks: Vec<Task>,
    pub projects: Vec<Project>,
    pub settings: std::collections::HashMap<String, String>,
    pub active_session: Option<FocusSession>,
    pub db_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportData {
    pub app: String,
    pub format_version: i64,
    pub exported_at: String,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    pub focus_sessions: Vec<FocusSession>,
    pub settings: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub projects: usize,
    pub tasks: usize,
    pub focus_sessions: usize,
}
