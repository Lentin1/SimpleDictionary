use chrono::{Local, Timelike};
use rusqlite::{params, types::ValueRef, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fmt;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const LEGACY_STATE: &str = "simple-dictionary-state.json";

#[derive(Debug)]
pub enum DbError {
    Io(std::io::Error),
    Sql(rusqlite::Error),
    Json(serde_json::Error),
    Message(String),
}

impl fmt::Display for DbError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "IO error: {error}"),
            Self::Sql(error) => write!(formatter, "SQLite error: {error}"),
            Self::Json(error) => write!(formatter, "JSON error: {error}"),
            Self::Message(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DbError {}
impl From<std::io::Error> for DbError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
impl From<rusqlite::Error> for DbError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}
impl From<serde_json::Error> for DbError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Clone)]
pub struct DbState {
    pub path: PathBuf,
    pub legacy_path: PathBuf,
}

impl DbState {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, DbError> {
        let legacy_dir = legacy_application_support_dir()?;
        Ok(Self {
            path: app_data_dir.join("jian-ci.sqlite3"),
            legacy_path: legacy_dir.join(LEGACY_STATE),
        })
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookSummary {
    pub id: String,
    pub name: String,
    pub note: String,
    pub word_count: i64,
    pub chapter_count: i64,
    pub mastered_count: i64,
    pub active: bool,
    pub chapters: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodayOverview {
    pub date: String,
    pub studied_count: i64,
    pub review_count: i64,
    pub target_count: i64,
    pub checked_in: bool,
    pub study_chapters: Vec<String>,
    pub review_chapters: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub date: String,
    pub studied_count: i64,
    pub review_count: i64,
    pub target_count: i64,
    pub checked_in: bool,
    pub completed: bool,
    pub hourly_counts: Vec<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub app_name: String,
    pub current_book: Option<BookSummary>,
    pub books: Vec<BookSummary>,
    pub today: TodayOverview,
    pub schedule: Vec<ScheduleDaySnapshot>,
    pub history: Vec<HistoryRecord>,
    pub migrated_from_legacy: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudyWord {
    pub key: String,
    pub word: String,
    pub chapter: String,
    pub phonetic: String,
    pub part: String,
    pub meaning: String,
    pub definition: String,
    pub example: String,
    pub translation: String,
    pub tag: String,
    pub senses: Vec<StudySense>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudySense {
    pub part: String,
    pub meaning: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudySessionSnapshot {
    pub mode: String,
    pub date: String,
    pub active: bool,
    pub completed: bool,
    pub revealed: bool,
    pub current: Option<StudyWord>,
    pub answer: Option<String>,
    pub remaining_count: i64,
    pub known_count: i64,
    pub unknown_count: i64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportWordInput {
    pub legacy_id: Option<String>,
    pub chapter: String,
    pub word: String,
    pub phonetic: Option<String>,
    pub part: Option<String>,
    pub meaning: Option<String>,
    pub definition: Option<String>,
    pub example: Option<String>,
    pub translation: Option<String>,
    pub tag: Option<String>,
    pub senses: Option<Vec<StudySense>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDayInput {
    pub day_index: i64,
    pub date: Option<String>,
    pub study_chapters: Vec<String>,
    pub review_chapters: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDaySnapshot {
    pub day_index: i64,
    pub date: Option<String>,
    pub study_chapters: Vec<String>,
    pub review_chapters: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    pub endpoint: String,
    pub model: String,
    pub configured: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessageInput {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LlmAskInput {
    pub word: StudyWord,
    pub answer: Option<String>,
    pub messages: Vec<LlmMessageInput>,
}

const KEYCHAIN_SERVICE: &str = "com.vocabflow.jianci.llm";
const KEYCHAIN_ACCOUNT: &str = "jian-ci";

pub fn initialize(state: &DbState) -> Result<(), DbError> {
    let connection = Connection::open(&state.path)?;
    connection.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS books (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS words (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          legacy_id TEXT NOT NULL,
          chapter TEXT NOT NULL,
          word TEXT NOT NULL,
          phonetic TEXT NOT NULL DEFAULT '',
          part TEXT NOT NULL DEFAULT '',
          meaning TEXT NOT NULL DEFAULT '',
          definition TEXT NOT NULL DEFAULT '',
          example TEXT NOT NULL DEFAULT '',
          translation TEXT NOT NULL DEFAULT '',
          tag TEXT NOT NULL DEFAULT '',
          senses_json TEXT NOT NULL DEFAULT '[]',
          order_index INTEGER NOT NULL,
          UNIQUE(book_id, legacy_id)
        );
        CREATE INDEX IF NOT EXISTS words_book_chapter_order ON words(book_id, chapter, order_index);
        CREATE TABLE IF NOT EXISTS progress (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          word_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'new',
          last_studied_at TEXT,
          due_at TEXT,
          times_seen INTEGER NOT NULL DEFAULT 0,
          correct_count INTEGER NOT NULL DEFAULT 0,
          incorrect_count INTEGER NOT NULL DEFAULT 0,
          extra_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY(book_id, word_key)
        );
        CREATE TABLE IF NOT EXISTS schedule_days (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          day_index INTEGER NOT NULL,
          date TEXT,
          study_chapters_json TEXT NOT NULL DEFAULT '[]',
          review_chapters_json TEXT NOT NULL DEFAULT '[]',
          payload_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY(book_id, day_index)
        );
        CREATE TABLE IF NOT EXISTS study_history (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY(book_id, date)
        );
        CREATE TABLE IF NOT EXISTS study_sessions (
          book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          payload_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          reason TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        "#,
    )?;

    let has_books: i64 =
        connection.query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))?;
    if has_books == 0 && state.legacy_path.exists() {
        migrate_legacy(&connection, &state.legacy_path)?;
    }
    ensure_default_book(&connection)?;
    if reconcile_history_with_progress(&connection)? {
        let payload = backup_payload(&connection)?;
        connection.execute(
            "INSERT INTO snapshots(created_at, reason, payload_json) VALUES(?1, ?2, ?3)",
            params![now(), "修复迁移后的今日学习记录", payload.to_string()],
        )?;
    }
    Ok(())
}

pub fn load_snapshot(state: &DbState) -> Result<AppSnapshot, DbError> {
    let connection = Connection::open(&state.path)?;
    let books = load_books(&connection)?;
    let current_book = books
        .iter()
        .find(|book| book.active)
        .cloned()
        .or_else(|| books.first().cloned());
    let today = load_today(&connection, current_book.as_ref())?;
    let schedule = current_book
        .as_ref()
        .map(|book| load_schedule_for_book(&connection, &book.id))
        .transpose()?
        .unwrap_or_default();
    let history = current_book
        .as_ref()
        .map(|book| load_history_for_book(&connection, &book.id))
        .transpose()?
        .unwrap_or_default();
    Ok(AppSnapshot {
        app_name: "简辞".to_string(),
        current_book,
        books,
        today,
        schedule,
        history,
        migrated_from_legacy: state.legacy_path.exists(),
    })
}

pub fn set_active_book(state: &DbState, book_id: &str) -> Result<AppSnapshot, DbError> {
    let connection = Connection::open(&state.path)?;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute("UPDATE books SET active = 0", [])?;
    let changed = transaction.execute(
        "UPDATE books SET active = 1, updated_at = ?2 WHERE id = ?1",
        params![book_id, now()],
    )?;
    if changed == 0 {
        return Err(DbError::Message(format!("词书不存在: {book_id}")));
    }
    transaction.execute("INSERT INTO meta(key, value) VALUES('active_book_id', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![book_id])?;
    transaction.commit()?;
    create_snapshot(state, "切换当前词书")?;
    load_snapshot(state)
}

pub fn backup_json(state: &DbState) -> Result<String, DbError> {
    let connection = Connection::open(&state.path)?;
    let payload = backup_payload(&connection)?;
    Ok(serde_json::to_string_pretty(&payload)?)
}

pub fn get_book_words(state: &DbState, book_id: &str) -> Result<Vec<StudyWord>, DbError> {
    let connection = Connection::open(&state.path)?;
    let exists: Option<String> = connection
        .query_row(
            "SELECT id FROM books WHERE id = ?1",
            params![book_id],
            |row| row.get(0),
        )
        .optional()?;
    if exists.is_none() {
        return Err(DbError::Message("词书不存在".to_string()));
    }
    let mut statement = connection.prepare("SELECT legacy_id, word, chapter, phonetic, part, meaning, definition, example, translation, tag, senses_json FROM words WHERE book_id = ?1 ORDER BY order_index")?;
    let rows = statement.query_map(params![book_id], |row| {
        Ok(StudyWord {
            key: row.get(0)?,
            word: row.get(1)?,
            chapter: row.get(2)?,
            phonetic: row.get(3)?,
            part: row.get(4)?,
            meaning: row.get(5)?,
            definition: row.get(6)?,
            example: row.get(7)?,
            translation: row.get(8)?,
            tag: row.get(9)?,
            senses: parse_senses(&row.get::<_, String>(10)?),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

pub fn check_in(state: &DbState, date: &str) -> Result<AppSnapshot, DbError> {
    let connection = Connection::open(&state.path)?;
    let book_id = active_book_id(&connection)?;
    let raw: String = connection
        .query_row(
            "SELECT payload_json FROM study_history WHERE book_id = ?1 AND date = ?2",
            params![book_id, date],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| DbError::Message("这一天还没有学习记录".to_string()))?;
    let mut payload = serde_json::from_str::<Value>(&raw)?;
    let studied_count = history_studied_count(&payload);
    let target_count = value_i64(&payload, "targetCount")
        .filter(|count| *count > 0)
        .unwrap_or_else(|| scheduled_target_count_for_date(&connection, &book_id, date));
    if target_count <= 0 || studied_count < target_count {
        return Err(DbError::Message(format!(
            "还差 {} 个单词，完成当天任务后才能打卡",
            (target_count - studied_count).max(0)
        )));
    }
    if let Some(object) = payload.as_object_mut() {
        object.insert("targetCount".to_string(), json!(target_count));
        object.insert("completed".to_string(), json!(true));
        object.insert("checkedIn".to_string(), json!(true));
    }
    connection.execute(
        "UPDATE study_history SET payload_json = ?3 WHERE book_id = ?1 AND date = ?2",
        params![book_id, date, payload.to_string()],
    )?;
    create_snapshot(state, &format!("{date} 打卡"))?;
    load_snapshot(state)
}

pub fn create_snapshot(state: &DbState, reason: &str) -> Result<i64, DbError> {
    let connection = Connection::open(&state.path)?;
    let payload = backup_payload(&connection)?;
    connection.execute(
        "INSERT INTO snapshots(created_at, reason, payload_json) VALUES(?1, ?2, ?3)",
        params![now(), reason, payload.to_string()],
    )?;
    Ok(connection.last_insert_rowid())
}

pub fn get_llm_settings(state: &DbState) -> Result<LlmSettings, DbError> {
    let connection = Connection::open(&state.path)?;
    let endpoint = meta_value(&connection, "llm_endpoint").unwrap_or_default();
    let model = meta_value(&connection, "llm_model").unwrap_or_default();
    Ok(LlmSettings {
        configured: !endpoint.trim().is_empty() && !model.trim().is_empty(),
        endpoint,
        model,
    })
}

pub fn save_llm_settings(
    state: &DbState,
    endpoint: &str,
    model: &str,
    api_key: &str,
) -> Result<LlmSettings, DbError> {
    let endpoint = endpoint.trim();
    let model = model.trim();
    if endpoint.is_empty() || model.is_empty() {
        return Err(DbError::Message("请填写 API 地址和模型名称".to_string()));
    }
    normalize_chat_endpoint(endpoint)?;
    let connection = Connection::open(&state.path)?;
    connection.execute("INSERT INTO meta(key, value) VALUES('llm_endpoint', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![endpoint])?;
    connection.execute("INSERT INTO meta(key, value) VALUES('llm_model', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![model])?;
    if !api_key.trim().is_empty() {
        keychain_save(api_key.trim())?;
    }
    create_snapshot(state, "保存 AI 接口设置")?;
    get_llm_settings(state)
}

pub fn ask_llm(state: &DbState, input: LlmAskInput) -> Result<String, DbError> {
    let settings = get_llm_settings(state)?;
    if !settings.configured {
        return Err(DbError::Message(
            "请先在 AI 面板配置接口地址和模型".to_string(),
        ));
    }
    let endpoint = normalize_chat_endpoint(&settings.endpoint)?;
    let messages: Vec<Value> = input.messages.iter().rev().take(12).collect::<Vec<_>>().into_iter().rev().filter_map(|message| {
        let role = message.role.trim();
        let content = message.content.trim();
        if (role == "user" || role == "assistant") && !content.is_empty() {
            Some(json!({ "role": role, "content": content.chars().take(2000).collect::<String>() }))
        } else {
            None
        }
    }).collect();
    if messages.is_empty() {
        return Err(DbError::Message("请输入想问的问题".to_string()));
    }
    let answer = match input.answer.as_deref() {
        Some("known") => "认识",
        Some("unknown") => "不认识",
        _ => "未选择",
    };
    let word = &input.word;
    let system_prompt = [
        Some("你是中文背单词应用“简辞”里的英语单词助教。".to_string()),
        Some(
            "只围绕当前单词回答，优先使用简洁自然的中文；必要时给英文例句并附中文解释。"
                .to_string(),
        ),
        Some("不要虚构词义。如果问题超出当前词，请简短提醒并拉回当前词。".to_string()),
        Some(format!("当前词：{}", word.word)),
        (!word.phonetic.is_empty()).then(|| format!("音标：{}", word.phonetic)),
        (!word.part.is_empty() || !word.meaning.is_empty())
            .then(|| format!("词性与释义：{} {}", word.part, word.meaning)),
        (!word.example.is_empty()).then(|| format!("词书例句：{}", word.example)),
        (!word.translation.is_empty()).then(|| format!("例句翻译：{}", word.translation)),
        Some(format!("用户刚才选择：{}", answer)),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n");
    let mut request_messages = vec![json!({ "role": "system", "content": system_prompt })];
    request_messages.extend(messages);
    let request_body =
        json!({ "model": settings.model, "messages": request_messages, "stream": false })
            .to_string();
    let mut command = Command::new("/usr/bin/curl");
    command.args([
        "--silent",
        "--show-error",
        "--max-time",
        "45",
        "--connect-timeout",
        "10",
        "-w",
        "\n%{http_code}",
        "-X",
        "POST",
        "-H",
        "Content-Type: application/json",
    ]);
    let api_key = keychain_read()?;
    if api_key.is_some() {
        command.args(["-H", "@-"]);
    }
    command.args(["--data-raw", &request_body, &endpoint]);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| DbError::Message(format!("无法启动 curl：{error}")))?;
    if let Some(api_key) = api_key {
        if let Some(mut stdin) = child.stdin.take() {
            writeln!(stdin, "Authorization: Bearer {api_key}")?;
        }
    } else {
        drop(child.stdin.take());
    }
    let output = child
        .wait_with_output()
        .map_err(|error| DbError::Message(format!("无法读取 curl 响应：{error}")))?;
    if !output.status.success() {
        return Err(DbError::Message(
            "无法连接 LLM API，请检查接口地址和网络".to_string(),
        ));
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let (body, status) = raw.rsplit_once('\n').unwrap_or((raw.as_ref(), "200"));
    let status_code = status.trim().parse::<u16>().unwrap_or(500);
    let payload: Value = serde_json::from_str(body)
        .map_err(|_| DbError::Message("LLM API 返回格式无法识别".to_string()))?;
    if status_code >= 400 {
        let message = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("LLM API 请求失败");
        return Err(DbError::Message(message.chars().take(300).collect()));
    }
    let content = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"));
    let text = match content {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string(),
        _ => String::new(),
    };
    if text.is_empty() {
        return Err(DbError::Message("LLM API 没有返回可显示的文本".to_string()));
    }
    Ok(text)
}

pub fn start_study(state: &DbState, mode: &str) -> Result<StudySessionSnapshot, DbError> {
    start_study_for_date(state, mode, None)
}

pub fn start_study_for_date(
    state: &DbState,
    mode: &str,
    task_date: Option<&str>,
) -> Result<StudySessionSnapshot, DbError> {
    let normalized_mode = if mode == "review" { "review" } else { "learn" };
    let connection = Connection::open(&state.path)?;
    let book_id = active_book_id(&connection)?;
    let date = task_date
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(today);
    let existing: Option<String> = connection
        .query_row(
            "SELECT payload_json FROM study_sessions WHERE book_id = ?1",
            params![book_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(payload) = existing {
        let value: Value = serde_json::from_str(&payload)?;
        let same_mode = value.get("mode").and_then(Value::as_str) == Some(normalized_mode);
        let same_date = value.get("date").and_then(Value::as_str) == Some(date.as_str());
        let completed = value
            .get("completed")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let has_queue = value
            .get("queue")
            .and_then(Value::as_array)
            .map(|queue| !queue.is_empty())
            .unwrap_or(false);
        if same_mode && same_date && (completed || has_queue) {
            return session_snapshot(&connection, &book_id, value);
        }
    }

    let chapters = scheduled_chapters(&connection, &book_id, &date, normalized_mode)?;
    let queue = pending_word_keys(&connection, &book_id, &chapters, normalized_mode)?;
    let completed = queue.is_empty();
    let payload = json!({
        "mode": normalized_mode,
        "date": date,
        "queue": queue,
        "active": !completed,
        "completed": completed,
        "revealed": false,
        "answer": null,
        "knownCount": 0,
        "unknownCount": 0,
    });
    save_session(&connection, &book_id, &payload)?;
    session_snapshot(&connection, &book_id, payload)
}

pub fn answer_word(
    state: &DbState,
    word_key: &str,
    known: bool,
) -> Result<StudySessionSnapshot, DbError> {
    let connection = Connection::open(&state.path)?;
    let book_id = active_book_id(&connection)?;
    let session_raw: String = connection
        .query_row(
            "SELECT payload_json FROM study_sessions WHERE book_id = ?1",
            params![book_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| DbError::Message("当前没有学习会话".to_string()))?;
    let mut payload: Value = serde_json::from_str(&session_raw)?;
    {
        let queue = payload
            .get_mut("queue")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| DbError::Message("学习队列损坏".to_string()))?;
        let current_key = queue
            .first()
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| DbError::Message("当前没有待学习单词".to_string()))?;
        if current_key != word_key {
            return Err(DbError::Message(
                "当前单词已变化，请重新打开学习会话".to_string(),
            ));
        }
    }
    if payload.get("answer").and_then(Value::as_str).is_some() {
        return Err(DbError::Message("请先进入下一个单词".to_string()));
    }
    let previous_progress: Option<(String, Option<String>, Option<String>, i64, i64, i64, String)> = connection.query_row(
        "SELECT status, last_studied_at, due_at, times_seen, correct_count, incorrect_count, extra_json FROM progress WHERE book_id = ?1 AND word_key = ?2",
        params![book_id, word_key],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
    ).optional()?;
    let now_value = now();
    let status = if known { "mastered" } else { "review" };
    connection.execute(
        "INSERT INTO progress(book_id, word_key, status, last_studied_at, times_seen, correct_count, incorrect_count) VALUES(?1, ?2, ?3, ?4, 1, ?5, ?6) ON CONFLICT(book_id, word_key) DO UPDATE SET status = excluded.status, last_studied_at = excluded.last_studied_at, times_seen = progress.times_seen + 1, correct_count = progress.correct_count + excluded.correct_count, incorrect_count = progress.incorrect_count + excluded.incorrect_count",
        params![book_id, word_key, status, now_value, if known { 1 } else { 0 }, if known { 0 } else { 1 }],
    )?;
    let mode = payload
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("learn");
    let task_date = payload
        .get("date")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(today);
    let history_before: Option<String> = connection
        .query_row(
            "SELECT payload_json FROM study_history WHERE book_id = ?1 AND date = ?2",
            params![book_id, task_date],
            |row| row.get(0),
        )
        .optional()?;
    record_daily_history(
        &connection,
        &book_id,
        &task_date,
        mode,
        word_key,
        known,
        previous_progress.as_ref().map(|record| record.0.as_str()),
    )?;
    let known_count = payload
        .get("knownCount")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        + i64::from(known);
    let unknown_count = payload
        .get("unknownCount")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        + i64::from(!known);
    if let Some(object) = payload.as_object_mut() {
        object.insert("knownCount".to_string(), json!(known_count));
        object.insert("unknownCount".to_string(), json!(unknown_count));
        object.insert(
            "answer".to_string(),
            json!(if known { "known" } else { "unknown" }),
        );
        object.insert("revealed".to_string(), json!(true));
        object.insert("active".to_string(), json!(true));
        object.insert("completed".to_string(), json!(false));
        object.insert(
            "previousProgress".to_string(),
            previous_progress
                .map(
                    |(
                        status,
                        last_studied_at,
                        due_at,
                        times_seen,
                        correct_count,
                        incorrect_count,
                        extra_json,
                    )| {
                        json!({
                            "status": status,
                            "lastStudiedAt": last_studied_at,
                            "dueAt": due_at,
                            "timesSeen": times_seen,
                            "correctCount": correct_count,
                            "incorrectCount": incorrect_count,
                            "extraJson": extra_json,
                        })
                    },
                )
                .unwrap_or(Value::Null),
        );
        object.insert(
            "previousHistory".to_string(),
            history_before.map(Value::String).unwrap_or(Value::Null),
        );
    }
    save_session(&connection, &book_id, &payload)?;
    create_snapshot(
        state,
        if known {
            "回答认识"
        } else {
            "回答不认识"
        },
    )?;
    session_snapshot(&connection, &book_id, payload)
}

pub fn undo_answer(state: &DbState) -> Result<StudySessionSnapshot, DbError> {
    let connection = Connection::open(&state.path)?;
    let book_id = active_book_id(&connection)?;
    let raw: String = connection
        .query_row(
            "SELECT payload_json FROM study_sessions WHERE book_id = ?1",
            params![book_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| DbError::Message("当前没有学习会话".to_string()))?;
    let mut payload: Value = serde_json::from_str(&raw)?;
    let answer = payload
        .get("answer")
        .and_then(Value::as_str)
        .ok_or_else(|| DbError::Message("当前没有可撤销的选择".to_string()))?
        .to_string();
    let word_key = payload
        .get("queue")
        .and_then(Value::as_array)
        .and_then(|queue| queue.first())
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| DbError::Message("当前没有待学习单词".to_string()))?;
    let history_date = payload
        .get("date")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(today);
    let previous_history = payload.get("previousHistory").cloned();
    let transaction = connection.unchecked_transaction()?;
    match payload.get("previousProgress") {
        Some(Value::Object(previous)) => {
            transaction.execute(
                "INSERT INTO progress(book_id, word_key, status, last_studied_at, due_at, times_seen, correct_count, incorrect_count, extra_json) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(book_id, word_key) DO UPDATE SET status = excluded.status, last_studied_at = excluded.last_studied_at, due_at = excluded.due_at, times_seen = excluded.times_seen, correct_count = excluded.correct_count, incorrect_count = excluded.incorrect_count, extra_json = excluded.extra_json",
                params![
                    book_id,
                    word_key,
                    previous.get("status").and_then(Value::as_str).unwrap_or("new"),
                    previous.get("lastStudiedAt").and_then(Value::as_str),
                    previous.get("dueAt").and_then(Value::as_str),
                    previous.get("timesSeen").and_then(Value::as_i64).unwrap_or(0),
                    previous.get("correctCount").and_then(Value::as_i64).unwrap_or(0),
                    previous.get("incorrectCount").and_then(Value::as_i64).unwrap_or(0),
                    previous.get("extraJson").and_then(Value::as_str).unwrap_or("{}"),
                ],
            )?;
        }
        _ => {
            transaction.execute(
                "DELETE FROM progress WHERE book_id = ?1 AND word_key = ?2",
                params![book_id, word_key],
            )?;
        }
    }
    match previous_history {
        Some(Value::String(previous)) => {
            transaction.execute(
                "INSERT INTO study_history(book_id, date, payload_json) VALUES(?1, ?2, ?3) ON CONFLICT(book_id, date) DO UPDATE SET payload_json = excluded.payload_json",
                params![book_id, history_date, previous],
            )?;
        }
        Some(Value::Null) => {
            transaction.execute(
                "DELETE FROM study_history WHERE book_id = ?1 AND date = ?2",
                params![book_id, history_date],
            )?;
        }
        None => {}
        Some(_) => {}
    }
    if let Some(object) = payload.as_object_mut() {
        let known_count = object
            .get("knownCount")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let unknown_count = object
            .get("unknownCount")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        object.insert(
            "knownCount".to_string(),
            json!(if answer == "known" {
                (known_count - 1).max(0)
            } else {
                known_count
            }),
        );
        object.insert(
            "unknownCount".to_string(),
            json!(if answer == "unknown" {
                (unknown_count - 1).max(0)
            } else {
                unknown_count
            }),
        );
        object.insert("answer".to_string(), Value::Null);
        object.insert("revealed".to_string(), json!(false));
        object.insert("active".to_string(), json!(true));
        object.insert("completed".to_string(), json!(false));
        object.insert("previousProgress".to_string(), Value::Null);
        object.insert("previousHistory".to_string(), Value::Null);
    }
    save_session(&transaction, &book_id, &payload)?;
    transaction.commit()?;
    create_snapshot(state, "撤销本次选择")?;
    let connection = Connection::open(&state.path)?;
    session_snapshot(&connection, &book_id, payload)
}

pub fn next_word(state: &DbState) -> Result<StudySessionSnapshot, DbError> {
    let connection = Connection::open(&state.path)?;
    let book_id = active_book_id(&connection)?;
    let raw: String = connection
        .query_row(
            "SELECT payload_json FROM study_sessions WHERE book_id = ?1",
            params![book_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| DbError::Message("当前没有学习会话".to_string()))?;
    let mut payload: Value = serde_json::from_str(&raw)?;
    let answer = payload
        .get("answer")
        .and_then(Value::as_str)
        .ok_or_else(|| DbError::Message("请先选择认识或不认识".to_string()))?
        .to_string();
    let remaining_count = {
        let queue = payload
            .get_mut("queue")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| DbError::Message("学习队列损坏".to_string()))?;
        let current = queue
            .first()
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| DbError::Message("当前没有待学习单词".to_string()))?;
        queue.remove(0);
        if answer == "unknown" {
            queue.push(Value::String(current));
        }
        queue.len()
    };
    if let Some(object) = payload.as_object_mut() {
        object.insert("answer".to_string(), Value::Null);
        object.insert("revealed".to_string(), json!(false));
        object.insert("active".to_string(), json!(remaining_count > 0));
        object.insert("completed".to_string(), json!(remaining_count == 0));
        object.insert("previousProgress".to_string(), Value::Null);
        object.insert("previousHistory".to_string(), Value::Null);
    }
    save_session(&connection, &book_id, &payload)?;
    session_snapshot(&connection, &book_id, payload)
}

pub fn leave_study(state: &DbState) -> Result<StudySessionSnapshot, DbError> {
    let connection = Connection::open(&state.path)?;
    let book_id = active_book_id(&connection)?;
    let raw: String = connection
        .query_row(
            "SELECT payload_json FROM study_sessions WHERE book_id = ?1",
            params![book_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| DbError::Message("当前没有学习会话".to_string()))?;
    let mut payload: Value = serde_json::from_str(&raw)?;
    let has_answer = payload.get("answer").and_then(Value::as_str).is_some();
    if let Some(object) = payload.as_object_mut() {
        object.insert("active".to_string(), json!(false));
        object.insert("revealed".to_string(), json!(has_answer));
    }
    save_session(&connection, &book_id, &payload)?;
    session_snapshot(&connection, &book_id, payload)
}

pub fn rename_book(
    state: &DbState,
    book_id: &str,
    name: &str,
    note: &str,
) -> Result<AppSnapshot, DbError> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err(DbError::Message("词书名称不能为空".to_string()));
    }
    let connection = Connection::open(&state.path)?;
    let changed = connection.execute(
        "UPDATE books SET name = ?1, note = ?2, updated_at = ?3 WHERE id = ?4",
        params![clean_name, note.trim(), now(), book_id],
    )?;
    if changed == 0 {
        return Err(DbError::Message("词书不存在".to_string()));
    }
    create_snapshot(state, "修改词书名称")?;
    load_snapshot(state)
}

pub fn delete_book(state: &DbState, book_id: &str) -> Result<AppSnapshot, DbError> {
    let connection = Connection::open(&state.path)?;
    let transaction = connection.unchecked_transaction()?;
    let was_active: i64 = transaction
        .query_row(
            "SELECT active FROM books WHERE id = ?1",
            params![book_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| DbError::Message("词书不存在".to_string()))?;
    let deleted = transaction.execute("DELETE FROM books WHERE id = ?1", params![book_id])?;
    if deleted == 0 {
        return Err(DbError::Message("词书不存在".to_string()));
    }
    let has_active: Option<String> = transaction
        .query_row(
            "SELECT id FROM books WHERE active = 1 ORDER BY created_at LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if was_active != 0 || has_active.is_none() {
        if let Some(replacement) = transaction
            .query_row(
                "SELECT id FROM books ORDER BY created_at LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            transaction.execute(
                "UPDATE books SET active = CASE WHEN id = ?1 THEN 1 ELSE 0 END",
                params![replacement],
            )?;
            transaction.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES('active_book_id', ?1)",
                params![replacement],
            )?;
        } else {
            transaction.execute("INSERT INTO books(id, name, note, created_at, updated_at, active) VALUES('empty-book', '我的词书', '还没有导入词书', ?1, ?1, 1)", params![now()])?;
            transaction.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES('active_book_id', 'empty-book')",
                [],
            )?;
        }
    }
    transaction.commit()?;
    create_snapshot(state, "删除词书")?;
    load_snapshot(state)
}

pub fn import_book(
    state: &DbState,
    name: &str,
    note: &str,
    words: Vec<ImportWordInput>,
) -> Result<AppSnapshot, DbError> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err(DbError::Message("词书名称不能为空".to_string()));
    }
    if words.is_empty() {
        return Err(DbError::Message("词书至少需要一个单词".to_string()));
    }
    let connection = Connection::open(&state.path)?;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute("UPDATE books SET active = 0", [])?;
    let book_id = format!(
        "book-{}",
        Local::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let stamp = now();
    transaction.execute("INSERT INTO books(id, name, note, created_at, updated_at, active) VALUES(?1, ?2, ?3, ?4, ?4, 1)", params![book_id, clean_name, note.trim(), stamp])?;
    let mut chapters = Vec::new();
    for (index, word) in words.iter().enumerate() {
        if word.word.trim().is_empty() {
            continue;
        }
        let legacy_id = word
            .legacy_id
            .clone()
            .unwrap_or_else(|| (index + 1).to_string());
        if !chapters
            .iter()
            .any(|chapter: &String| chapter == &word.chapter)
        {
            chapters.push(word.chapter.clone());
        }
        let senses = word
            .senses
            .as_ref()
            .map(|value| serde_json::to_string(value))
            .transpose()?
            .unwrap_or_else(|| "[]".to_string());
        transaction.execute(
            "INSERT INTO words(book_id, legacy_id, chapter, word, phonetic, part, meaning, definition, example, translation, tag, senses_json, order_index) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![book_id, legacy_id, word.chapter.trim(), word.word.trim(), word.phonetic.as_deref().unwrap_or_default(), word.part.as_deref().unwrap_or_default(), word.meaning.as_deref().unwrap_or_default(), word.definition.as_deref().unwrap_or_default(), word.example.as_deref().unwrap_or_default(), word.translation.as_deref().unwrap_or_default(), word.tag.as_deref().unwrap_or("TOEFL"), senses, index as i64],
        )?;
    }
    let start_date = today();
    for (index, chapter) in chapters.iter().enumerate() {
        let date = add_days(&start_date, index as i64);
        transaction.execute("INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json, review_chapters_json, payload_json) VALUES(?1, ?2, ?3, ?4, '[]', '{}')", params![book_id, index as i64, date, json!([chapter]).to_string()])?;
    }
    transaction.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES('active_book_id', ?1)",
        params![book_id],
    )?;
    transaction.commit()?;
    create_snapshot(state, "导入新词书")?;
    load_snapshot(state)
}

pub fn get_schedule(state: &DbState) -> Result<Vec<ScheduleDaySnapshot>, DbError> {
    let connection = Connection::open(&state.path)?;
    let book_id = active_book_id(&connection)?;
    load_schedule_for_book(&connection, &book_id)
}

fn load_schedule_for_book(
    connection: &Connection,
    book_id: &str,
) -> Result<Vec<ScheduleDaySnapshot>, DbError> {
    let mut statement = connection.prepare("SELECT day_index, date, study_chapters_json, review_chapters_json FROM schedule_days WHERE book_id = ?1 ORDER BY day_index")?;
    let rows = statement.query_map(params![book_id], |row| {
        Ok(ScheduleDaySnapshot {
            day_index: row.get(0)?,
            date: row.get(1)?,
            study_chapters: string_array(&row.get::<_, String>(2)?),
            review_chapters: string_array(&row.get::<_, String>(3)?),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_schedule(
    state: &DbState,
    start_date: &str,
    days: Vec<ScheduleDayInput>,
) -> Result<Vec<ScheduleDaySnapshot>, DbError> {
    let connection = Connection::open(&state.path)?;
    let book_id = active_book_id(&connection)?;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "DELETE FROM schedule_days WHERE book_id = ?1",
        params![book_id],
    )?;
    for day in days {
        let date = day.date.or_else(|| add_days(start_date, day.day_index));
        transaction.execute("INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json, review_chapters_json, payload_json) VALUES(?1, ?2, ?3, ?4, ?5, '{}')", params![book_id, day.day_index, date, json!(day.study_chapters).to_string(), json!(day.review_chapters).to_string()])?;
    }
    transaction.commit()?;
    create_snapshot(state, "修改章节计划")?;
    get_schedule(state)
}

fn load_books(connection: &Connection) -> Result<Vec<BookSummary>, DbError> {
    let mut statement = connection.prepare(
        "SELECT b.id, b.name, b.note, b.active, COUNT(w.id), COUNT(DISTINCT w.chapter), COALESCE((SELECT COUNT(*) FROM progress p WHERE p.book_id = b.id AND p.status = 'mastered'), 0) FROM books b LEFT JOIN words w ON w.book_id = b.id GROUP BY b.id ORDER BY b.active DESC, b.created_at ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(BookSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            note: row.get(2)?,
            active: row.get::<_, i64>(3)? != 0,
            word_count: row.get(4)?,
            chapter_count: row.get(5)?,
            mastered_count: row.get(6)?,
            chapters: Vec::new(),
        })
    })?;
    let mut books = rows.collect::<Result<Vec<_>, _>>()?;
    let mut chapter_statement = connection.prepare(
        "SELECT chapter FROM words WHERE book_id = ?1 GROUP BY chapter ORDER BY MIN(order_index)",
    )?;
    for book in &mut books {
        let chapters = chapter_statement
            .query_map(params![book.id.as_str()], |row| row.get::<_, String>(0))?;
        book.chapters = chapters.collect::<Result<Vec<_>, _>>()?;
    }
    Ok(books)
}

fn load_today(
    connection: &Connection,
    book: Option<&BookSummary>,
) -> Result<TodayOverview, DbError> {
    let date = Local::now().format("%Y-%m-%d").to_string();
    let Some(book) = book else {
        return Ok(TodayOverview {
            date,
            studied_count: 0,
            review_count: 0,
            target_count: 0,
            checked_in: false,
            study_chapters: vec![],
            review_chapters: vec![],
        });
    };
    let history: Option<String> = connection
        .query_row(
            "SELECT payload_json FROM study_history WHERE book_id = ?1 AND date = ?2",
            params![book.id, date],
            |row| row.get(0),
        )
        .optional()?;
    let history = history
        .and_then(|payload| serde_json::from_str::<Value>(&payload).ok())
        .unwrap_or_else(|| json!({}));
    let schedule: Option<(String, String)> = connection.query_row("SELECT study_chapters_json, review_chapters_json FROM schedule_days WHERE book_id = ?1 AND date = ?2", params![book.id, date], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
    let (study_chapters, review_chapters) = schedule
        .map(|(study, review)| (string_array(&study), string_array(&review)))
        .unwrap_or_default();
    Ok(TodayOverview {
        date,
        studied_count: value_i64(&history, "studiedCount").unwrap_or(0),
        review_count: value_i64(&history, "reviewedCount").unwrap_or(0),
        target_count: {
            let scheduled_target =
                scheduled_target_count(connection, &book.id, &study_chapters, &review_chapters);
            if scheduled_target > 0 {
                scheduled_target
            } else {
                value_i64(&history, "targetCount").unwrap_or(0)
            }
        },
        checked_in: history
            .get("checkedIn")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        study_chapters,
        review_chapters,
    })
}

fn load_history_for_book(
    connection: &Connection,
    book_id: &str,
) -> Result<Vec<HistoryRecord>, DbError> {
    let mut statement = connection
        .prepare("SELECT date, payload_json FROM study_history WHERE book_id = ?1 ORDER BY date")?;
    let rows = statement.query_map(params![book_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut records = Vec::new();
    for row in rows {
        let (date, raw) = row?;
        let payload = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
        let studied_count = history_studied_count(&payload);
        let review_count = value_i64(&payload, "reviewedCount").unwrap_or_else(|| {
            history_array_len_aliases(&payload, &["reviewedWordKeys", "reviewedWordIds"])
        });
        let target_count = value_i64(&payload, "targetCount").unwrap_or(0);
        let checked_in = payload
            .get("checkedIn")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let completed = payload
            .get("completed")
            .and_then(Value::as_bool)
            .unwrap_or(target_count > 0 && studied_count >= target_count);
        let mut hourly_counts = payload
            .get("hourlyCounts")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .map(|value| value.as_i64().unwrap_or(0))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        hourly_counts.resize(24, 0);
        records.push(HistoryRecord {
            date,
            studied_count,
            review_count,
            target_count,
            checked_in,
            completed,
            hourly_counts,
        });
    }
    Ok(records)
}

fn history_array_len_aliases(payload: &Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| {
            payload
                .get(*key)
                .and_then(Value::as_array)
                .map(|values| values.len() as i64)
        })
        .unwrap_or(0)
}

fn history_keys(payload: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_array))
        .map(|values| {
            values
                .iter()
                .filter_map(|value| match value {
                    Value::String(value) => Some(value.clone()),
                    Value::Number(value) => Some(value.to_string()),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn history_studied_count(payload: &Value) -> i64 {
    value_i64(payload, "studiedCount").unwrap_or_else(|| {
        let learned = history_array_len_aliases(payload, &["learnedWordKeys", "learnedWordIds"]);
        let reviewed_count = payload
            .get("reviewedWordKeys")
            .or_else(|| payload.get("reviewedWordIds"))
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|key| {
                        !payload
                            .get("learnedWordKeys")
                            .and_then(Value::as_array)
                            .map(|items| items.iter().any(|item| item.as_str() == Some(key)))
                            .unwrap_or(false)
                    })
                    .count() as i64
            })
            .unwrap_or(0);
        learned + reviewed_count
    })
}

/// Legacy/web progress can contain a same-day mastered timestamp without the
/// matching daily history key. Reconcile that gap once the SQLite store opens.
/// This is deliberately limited to scheduled learning chapters and same-day
/// mastered progress, so it cannot turn an unrelated old word into a new task.
fn reconcile_history_with_progress(connection: &Connection) -> Result<bool, DbError> {
    let schedules = {
        let mut statement = connection.prepare(
            "SELECT book_id, date, study_chapters_json FROM schedule_days WHERE date IS NOT NULL AND date != ''",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let mut changed = false;

    for (book_id, date, study_raw) in schedules {
        let study_chapters = string_array(&study_raw);
        if study_chapters.is_empty() {
            continue;
        }
        let candidates = {
            let mut statement = connection.prepare(
                "SELECT w.legacy_id, w.chapter, p.status, p.last_studied_at FROM words w LEFT JOIN progress p ON p.book_id = w.book_id AND p.word_key = w.legacy_id WHERE w.book_id = ?1 ORDER BY w.order_index",
            )?;
            let rows = statement.query_map(params![book_id.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let candidate_keys: Vec<String> = candidates
            .into_iter()
            .filter(|(_, chapter, status, last_studied_at)| {
                study_chapters.iter().any(|item| item == chapter)
                    && status.as_deref() == Some("mastered")
                    && last_studied_at
                        .as_deref()
                        .map(|value| value.starts_with(&date))
                        .unwrap_or(false)
            })
            .map(|(word_key, _, _, _)| word_key)
            .collect();
        if candidate_keys.is_empty() {
            continue;
        }

        let existing: Option<String> = connection
            .query_row(
                "SELECT payload_json FROM study_history WHERE book_id = ?1 AND date = ?2",
                params![book_id.as_str(), date.as_str()],
                |row| row.get(0),
            )
            .optional()?;
        let mut payload = existing
            .and_then(|value| serde_json::from_str::<Value>(&value).ok())
            .unwrap_or_else(|| json!({}));
        let mut learned_keys = history_keys(&payload, &["learnedWordKeys", "learnedWordIds"]);
        let reviewed_keys = history_keys(&payload, &["reviewedWordKeys", "reviewedWordIds"]);
        let mut added = false;
        for word_key in candidate_keys {
            if learned_keys.contains(&word_key) || reviewed_keys.contains(&word_key) {
                continue;
            }
            learned_keys.push(word_key);
            added = true;
        }
        if !added {
            continue;
        }

        let mut all_keys = learned_keys.clone();
        for key in &reviewed_keys {
            if !all_keys.contains(key) {
                all_keys.push(key.clone());
            }
        }
        let target_count = daily_target_count(connection, &book_id, &date, &all_keys);
        if let Some(object) = payload.as_object_mut() {
            object.insert("learnedWordKeys".to_string(), json!(learned_keys));
            object.insert("studiedCount".to_string(), json!(all_keys.len()));
            object.insert("targetCount".to_string(), json!(target_count));
            object.insert(
                "completed".to_string(),
                json!(target_count > 0 && all_keys.len() as i64 >= target_count),
            );
            object
                .entry("checkedIn".to_string())
                .or_insert(json!(false));
        }
        connection.execute(
            "INSERT INTO study_history(book_id, date, payload_json) VALUES(?1, ?2, ?3) ON CONFLICT(book_id, date) DO UPDATE SET payload_json = excluded.payload_json",
            params![book_id, date, payload.to_string()],
        )?;
        changed = true;
    }
    Ok(changed)
}

fn record_daily_history(
    connection: &Connection,
    book_id: &str,
    date: &str,
    mode: &str,
    word_key: &str,
    known: bool,
    previous_status: Option<&str>,
) -> Result<(), DbError> {
    let existing: Option<String> = connection
        .query_row(
            "SELECT payload_json FROM study_history WHERE book_id = ?1 AND date = ?2",
            params![book_id, date],
            |row| row.get(0),
        )
        .optional()?;
    let mut payload = existing
        .and_then(|value| serde_json::from_str::<Value>(&value).ok())
        .unwrap_or_else(|| json!({}));
    let mut learned_keys = history_keys(&payload, &["learnedWordKeys", "learnedWordIds"]);
    let mut reviewed_keys = history_keys(&payload, &["reviewedWordKeys", "reviewedWordIds"]);
    let target = if mode == "review" {
        &mut reviewed_keys
    } else {
        &mut learned_keys
    };
    let was_completed = target.iter().any(|key| key == word_key);
    if known {
        if !target.iter().any(|key| key == word_key) {
            target.push(word_key.to_string());
        }
    } else {
        target.retain(|key| key != word_key);
        if previous_status == Some("mastered") && mode == "learn" {
            learned_keys.retain(|key| key != word_key);
        }
    }
    let mut all_keys = learned_keys.clone();
    for key in &reviewed_keys {
        if !all_keys.contains(key) {
            all_keys.push(key.clone());
        }
    }
    let mut hourly_counts = payload
        .get("hourlyCounts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| (0..24).map(|_| json!(0)).collect());
    while hourly_counts.len() < 24 {
        hourly_counts.push(json!(0));
    }
    if known {
        let hour = Local::now().hour() as usize;
        let current = hourly_counts[hour].as_i64().unwrap_or(0);
        if !was_completed {
            hourly_counts[hour] = json!(current + 1);
        }
    }
    let target_count = daily_target_count(connection, book_id, date, &all_keys);
    if let Some(object) = payload.as_object_mut() {
        object.insert("learnedWordKeys".to_string(), json!(learned_keys));
        object.insert("reviewedWordKeys".to_string(), json!(reviewed_keys.clone()));
        object.insert("studiedCount".to_string(), json!(all_keys.len()));
        object.insert("reviewedCount".to_string(), json!(reviewed_keys.len()));
        object.insert("targetCount".to_string(), json!(target_count));
        object.insert(
            "completed".to_string(),
            json!(target_count > 0 && all_keys.len() as i64 >= target_count),
        );
        object.insert("hourlyCounts".to_string(), Value::Array(hourly_counts));
        object
            .entry("checkedIn".to_string())
            .or_insert(json!(false));
    }
    connection.execute("INSERT INTO study_history(book_id, date, payload_json) VALUES(?1, ?2, ?3) ON CONFLICT(book_id, date) DO UPDATE SET payload_json = excluded.payload_json", params![book_id, date, payload.to_string()])?;
    Ok(())
}

fn scheduled_target_count(
    connection: &Connection,
    book_id: &str,
    study_chapters: &[String],
    review_chapters: &[String],
) -> i64 {
    scheduled_target_keys(connection, book_id, study_chapters, review_chapters).len() as i64
}

fn scheduled_target_keys(
    connection: &Connection,
    book_id: &str,
    study_chapters: &[String],
    review_chapters: &[String],
) -> Vec<String> {
    if study_chapters.is_empty() && review_chapters.is_empty() {
        return Vec::new();
    }
    let mut statement = match connection.prepare(
        "SELECT w.legacy_id, w.chapter, COALESCE(p.status, '')
         FROM words w
         LEFT JOIN progress p ON p.book_id = w.book_id AND p.word_key = w.legacy_id
         WHERE w.book_id = ?1",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = match statement.query_map(params![book_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    }) {
        Ok(rows) => rows,
        Err(_) => return Vec::new(),
    };
    let mut keys = Vec::new();
    for row in rows {
        let Ok((key, chapter, status)) = row else {
            continue;
        };
        let is_review = review_chapters
            .iter()
            .any(|candidate| candidate == &chapter);
        let is_study = study_chapters.iter().any(|candidate| candidate == &chapter);
        if is_review || (is_study && status != "mastered") {
            keys.push(key);
        }
    }
    keys
}

fn scheduled_target_count_for_date(connection: &Connection, book_id: &str, date: &str) -> i64 {
    let schedule: Option<(String, String)> = connection.query_row("SELECT study_chapters_json, review_chapters_json FROM schedule_days WHERE book_id = ?1 AND date = ?2", params![book_id, date], |row| Ok((row.get(0)?, row.get(1)?))).optional().ok().flatten();
    schedule
        .map(|(study, review)| {
            scheduled_target_count(
                connection,
                book_id,
                &string_array(&study),
                &string_array(&review),
            )
        })
        .unwrap_or(0)
}

fn daily_target_count(
    connection: &Connection,
    book_id: &str,
    date: &str,
    completed_keys: &[String],
) -> i64 {
    let schedule: Option<(String, String)> = connection
        .query_row(
            "SELECT study_chapters_json, review_chapters_json FROM schedule_days WHERE book_id = ?1 AND date = ?2",
            params![book_id, date],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    let Some((study, review)) = schedule else {
        return 0;
    };
    let study_chapters = string_array(&study);
    let review_chapters = string_array(&review);
    let mut target_keys =
        scheduled_target_keys(connection, book_id, &study_chapters, &review_chapters);
    for key in completed_keys {
        if target_keys.iter().any(|candidate| candidate == key) {
            continue;
        }
        let chapter: Option<String> = connection
            .query_row(
                "SELECT chapter FROM words WHERE book_id = ?1 AND legacy_id = ?2",
                params![book_id, key],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if chapter.is_some_and(|chapter| {
            study_chapters.iter().any(|candidate| candidate == &chapter)
                || review_chapters
                    .iter()
                    .any(|candidate| candidate == &chapter)
        }) {
            target_keys.push(key.clone());
        }
    }
    target_keys.len() as i64
}

fn active_book_id(connection: &Connection) -> Result<String, DbError> {
    connection
        .query_row(
            "SELECT id FROM books WHERE active = 1 ORDER BY created_at LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| DbError::Message("没有可用词书".to_string()))
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn scheduled_chapters(
    connection: &Connection,
    book_id: &str,
    date: &str,
    mode: &str,
) -> Result<Vec<String>, DbError> {
    let column = if mode == "review" {
        "review_chapters_json"
    } else {
        "study_chapters_json"
    };
    let sql = format!("SELECT {column} FROM schedule_days WHERE book_id = ?1 AND date = ?2");
    let raw: Option<String> = connection
        .query_row(&sql, params![book_id, date], |row| row.get(0))
        .optional()?;
    if let Some(raw) = raw {
        return Ok(string_array(&raw));
    }
    if mode == "learn" {
        let first_chapter: Option<String> = connection
            .query_row(
                "SELECT chapter FROM words WHERE book_id = ?1 ORDER BY order_index LIMIT 1",
                params![book_id],
                |row| row.get(0),
            )
            .optional()?;
        return Ok(first_chapter.into_iter().collect());
    }
    Ok(Vec::new())
}

fn pending_word_keys(
    connection: &Connection,
    book_id: &str,
    chapters: &[String],
    mode: &str,
) -> Result<Vec<String>, DbError> {
    let mut statement = connection
        .prepare("SELECT legacy_id, chapter FROM words WHERE book_id = ?1 ORDER BY order_index")?;
    let rows = statement.query_map(params![book_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut keys = Vec::new();
    for row in rows {
        let (key, chapter) = row?;
        if !chapters.iter().any(|candidate| candidate == &chapter) {
            continue;
        }
        if mode == "learn" {
            let status: Option<String> = connection
                .query_row(
                    "SELECT status FROM progress WHERE book_id = ?1 AND word_key = ?2",
                    params![book_id, key],
                    |value| value.get(0),
                )
                .optional()?;
            if status.as_deref() == Some("mastered") {
                continue;
            }
        }
        keys.push(key);
    }
    Ok(keys)
}

fn save_session(connection: &Connection, book_id: &str, payload: &Value) -> Result<(), DbError> {
    connection.execute("INSERT INTO study_sessions(book_id, payload_json, updated_at) VALUES(?1, ?2, ?3) ON CONFLICT(book_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at", params![book_id, payload.to_string(), now()])?;
    Ok(())
}

fn session_snapshot(
    connection: &Connection,
    book_id: &str,
    payload: Value,
) -> Result<StudySessionSnapshot, DbError> {
    let mode = string_value(&payload, "mode").unwrap_or_else(|| "learn".to_string());
    let date = string_value(&payload, "date").unwrap_or_else(today);
    let queue = payload
        .get("queue")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let current_key = queue.first().and_then(Value::as_str);
    let current = match current_key {
        Some(key) => load_word(connection, book_id, key)?,
        None => None,
    };
    Ok(StudySessionSnapshot {
        mode,
        date,
        active: payload
            .get("active")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        completed: payload
            .get("completed")
            .and_then(Value::as_bool)
            .unwrap_or(queue.is_empty()),
        revealed: payload
            .get("revealed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        answer: payload
            .get("answer")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        current,
        remaining_count: queue.len() as i64,
        known_count: payload
            .get("knownCount")
            .and_then(Value::as_i64)
            .unwrap_or(0),
        unknown_count: payload
            .get("unknownCount")
            .and_then(Value::as_i64)
            .unwrap_or(0),
    })
}

fn load_word(
    connection: &Connection,
    book_id: &str,
    key: &str,
) -> Result<Option<StudyWord>, DbError> {
    connection.query_row("SELECT legacy_id, word, chapter, phonetic, part, meaning, definition, example, translation, tag, senses_json FROM words WHERE book_id = ?1 AND legacy_id = ?2", params![book_id, key], |row| {
        Ok(StudyWord { key: row.get(0)?, word: row.get(1)?, chapter: row.get(2)?, phonetic: row.get(3)?, part: row.get(4)?, meaning: row.get(5)?, definition: row.get(6)?, example: row.get(7)?, translation: row.get(8)?, tag: row.get(9)?, senses: parse_senses(&row.get::<_, String>(10)?) })
    }).optional().map_err(DbError::from)
}

fn migrate_legacy(connection: &Connection, legacy_path: &Path) -> Result<(), DbError> {
    let raw = std::fs::read_to_string(legacy_path)?;
    let root: Value = serde_json::from_str(&raw)?;
    let books = normalize_books(&root);
    if books.is_empty() {
        return Ok(());
    }
    let transaction = connection.unchecked_transaction()?;
    let stamp = now();
    let active_id = root
        .get("activeBookId")
        .and_then(Value::as_str)
        .or_else(|| {
            books
                .first()
                .and_then(|book| book.get("id").and_then(Value::as_str))
        });
    for (book_index, book) in books.iter().enumerate() {
        let book_id =
            string_value(book, "id").unwrap_or_else(|| format!("legacy-book-{book_index}"));
        let name = string_value(book, "name")
            .or_else(|| string_value(&root, "bookName"))
            .unwrap_or_else(|| "导入词书".to_string());
        let note = string_value(book, "note")
            .or_else(|| string_value(&root, "bookNote"))
            .unwrap_or_default();
        transaction.execute("INSERT OR IGNORE INTO books(id, name, note, created_at, updated_at, active) VALUES(?1, ?2, ?3, ?4, ?4, ?5)", params![book_id, name, note, stamp, if Some(book_id.as_str()) == active_id { 1 } else { 0 }])?;
        let words = book
            .get("words")
            .or_else(|| {
                if book_index == 0 {
                    root.get("words")
                } else {
                    None
                }
            })
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (order_index, word) in words.iter().enumerate() {
            let legacy_id =
                string_value(word, "id").unwrap_or_else(|| (order_index + 1).to_string());
            let senses = word.get("senses").cloned().unwrap_or_else(|| json!([]));
            transaction.execute(
                "INSERT OR REPLACE INTO words(book_id, legacy_id, chapter, word, phonetic, part, meaning, definition, example, translation, tag, senses_json, order_index) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![book_id, legacy_id, string_value(word, "chapter").unwrap_or_default(), string_value(word, "word").unwrap_or_default(), string_value(word, "phonetic").unwrap_or_default(), string_value(word, "part").unwrap_or_default(), string_value(word, "meaning").unwrap_or_default(), string_value(word, "definition").unwrap_or_default(), string_value(word, "example").unwrap_or_default(), string_value(word, "translation").unwrap_or_default(), string_value(word, "tag").unwrap_or_default(), senses.to_string(), order_index as i64],
            )?;
        }
        migrate_progress(
            &transaction,
            book_id.as_str(),
            book.get("progress").or_else(|| {
                if book_index == 0 {
                    root.get("progress")
                } else {
                    None
                }
            }),
        );
        migrate_schedule(
            &transaction,
            book_id.as_str(),
            book.get("schedule").or_else(|| {
                if book_index == 0 {
                    root.get("schedule")
                } else {
                    None
                }
            }),
        );
        migrate_history(
            &transaction,
            book_id.as_str(),
            book.get("studyHistory").or_else(|| {
                if book_index == 0 {
                    root.get("studyHistory")
                } else {
                    None
                }
            }),
        );
        migrate_session(
            &transaction,
            book_id.as_str(),
            book.get("session").or_else(|| {
                if book_index == 0 {
                    root.get("session")
                } else {
                    None
                }
            }),
        );
    }
    if let Some(active_id) = active_id {
        transaction.execute(
            "UPDATE books SET active = CASE WHEN id = ?1 THEN 1 ELSE 0 END",
            params![active_id],
        )?;
        transaction.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES('active_book_id', ?1)",
            params![active_id],
        )?;
    }
    transaction.execute("INSERT INTO meta(key, value) VALUES('legacy_migrated_at', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![stamp])?;
    transaction.commit()?;
    Ok(())
}

fn migrate_progress(transaction: &rusqlite::Transaction<'_>, book_id: &str, value: Option<&Value>) {
    let Some(progress) = value.and_then(Value::as_object) else {
        return;
    };
    for (word_key, state) in progress {
        let status = string_value(state, "status").unwrap_or_else(|| "new".to_string());
        let last =
            string_value(state, "lastStudiedAt").or_else(|| string_value(state, "lastStudied"));
        let extra = state.to_string();
        let _ = transaction.execute("INSERT OR REPLACE INTO progress(book_id, word_key, status, last_studied_at, extra_json) VALUES(?1, ?2, ?3, ?4, ?5)", params![book_id, word_key, status, last, extra]);
    }
}

fn migrate_schedule(transaction: &rusqlite::Transaction<'_>, book_id: &str, value: Option<&Value>) {
    let Some(schedule) = value else {
        return;
    };
    let days = schedule
        .get("days")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let start_date = string_value(schedule, "startDate");
    for (index, day) in days.iter().enumerate() {
        let date = start_date
            .as_deref()
            .and_then(|start| add_days(start, index as i64));
        let study = day.get("study").cloned().unwrap_or_else(|| json!([]));
        let review = day.get("review").cloned().unwrap_or_else(|| json!([]));
        let _ = transaction.execute("INSERT OR REPLACE INTO schedule_days(book_id, day_index, date, study_chapters_json, review_chapters_json, payload_json) VALUES(?1, ?2, ?3, ?4, ?5, ?6)", params![book_id, index as i64, date, study.to_string(), review.to_string(), day.to_string()]);
    }
}

fn migrate_history(transaction: &rusqlite::Transaction<'_>, book_id: &str, value: Option<&Value>) {
    let Some(history) = value.and_then(Value::as_object) else {
        return;
    };
    for (date, payload) in history {
        let _ = transaction.execute(
            "INSERT OR REPLACE INTO study_history(book_id, date, payload_json) VALUES(?1, ?2, ?3)",
            params![book_id, date, payload.to_string()],
        );
    }
}

fn migrate_session(transaction: &rusqlite::Transaction<'_>, book_id: &str, value: Option<&Value>) {
    let Some(session) = value.and_then(Value::as_object) else {
        return;
    };
    let Some(mode) = session
        .get("mode")
        .and_then(Value::as_str)
        .filter(|mode| *mode == "learn" || *mode == "review")
    else {
        return;
    };
    let mut queue: Vec<Value> = session
        .get("queue")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| match value {
            Value::String(value) => Some(Value::String(value.clone())),
            Value::Number(value) => Some(Value::String(value.to_string())),
            _ => None,
        })
        .collect();
    if queue.is_empty() {
        if let Some(current) = session.get("currentId").and_then(|value| match value {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            _ => None,
        }) {
            queue.push(Value::String(current));
        }
    }
    let answer = session
        .get("lastAnswer")
        .and_then(Value::as_str)
        .filter(|answer| *answer == "known" || *answer == "unknown")
        .map(|answer| Value::String(answer.to_string()))
        .unwrap_or(Value::Null);
    let revealed = session
        .get("revealed")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || answer.is_string();
    let payload = json!({
        "mode": mode,
        "date": session
            .get("date")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .unwrap_or_else(today),
        "queue": queue,
        "active": session.get("active").and_then(Value::as_bool).unwrap_or(true),
        "completed": session.get("completed").and_then(Value::as_bool).unwrap_or(false),
        "revealed": revealed,
        "answer": answer,
        "knownCount": 0,
        "unknownCount": 0,
    });
    let _ = transaction.execute("INSERT OR REPLACE INTO study_sessions(book_id, payload_json, updated_at) VALUES(?1, ?2, ?3)", params![book_id, payload.to_string(), now()]);
}

fn ensure_default_book(connection: &Connection) -> Result<(), DbError> {
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }
    let id = "empty-book";
    connection.execute("INSERT INTO books(id, name, note, created_at, updated_at, active) VALUES(?1, ?2, ?3, ?4, ?4, 1)", params![id, "我的词书", "还没有导入词书", now()])?;
    Ok(())
}

fn backup_payload(connection: &Connection) -> Result<Value, DbError> {
    Ok(json!({
        "format": "jian-ci-backup",
        "version": 1,
        "exportedAt": now(),
        "books": query_rows(connection, "SELECT id, name, note, created_at, updated_at, active FROM books ORDER BY created_at", &["id", "name", "note", "createdAt", "updatedAt", "active"] )?,
        "words": query_rows(connection, "SELECT book_id, legacy_id, chapter, word, phonetic, part, meaning, definition, example, translation, tag, senses_json, order_index FROM words ORDER BY book_id, order_index", &["bookId", "legacyId", "chapter", "word", "phonetic", "part", "meaning", "definition", "example", "translation", "tag", "sensesJson", "orderIndex"] )?,
        "progress": query_rows(connection, "SELECT book_id, word_key, status, last_studied_at, due_at, times_seen, correct_count, incorrect_count, extra_json FROM progress ORDER BY book_id, word_key", &["bookId", "wordKey", "status", "lastStudiedAt", "dueAt", "timesSeen", "correctCount", "incorrectCount", "extraJson"] )?,
        "scheduleDays": query_rows(connection, "SELECT book_id, day_index, date, study_chapters_json, review_chapters_json, payload_json FROM schedule_days ORDER BY book_id, day_index", &["bookId", "dayIndex", "date", "studyChaptersJson", "reviewChaptersJson", "payloadJson"] )?,
        "studyHistory": query_rows(connection, "SELECT book_id, date, payload_json FROM study_history ORDER BY book_id, date", &["bookId", "date", "payloadJson"] )?,
        "studySessions": query_rows(connection, "SELECT book_id, payload_json, updated_at FROM study_sessions ORDER BY book_id", &["bookId", "payloadJson", "updatedAt"] )?,
    }))
}

fn query_rows(connection: &Connection, sql: &str, columns: &[&str]) -> Result<Vec<Value>, DbError> {
    let mut statement = connection.prepare(sql)?;
    let mut rows = statement.query([])?;
    let mut result = Vec::new();
    while let Some(row) = rows.next()? {
        let mut object = Map::new();
        for (index, column) in columns.iter().enumerate() {
            let value = match row.get_ref(index)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(value) => json!(value),
                ValueRef::Real(value) => json!(value),
                ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
                ValueRef::Blob(value) => Value::String(format!("base64:{}", base64_like(value))),
            };
            object.insert((*column).to_string(), value);
        }
        result.push(Value::Object(object));
    }
    Ok(result)
}

fn base64_like(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn normalize_books(root: &Value) -> Vec<Value> {
    match root.get("books") {
        Some(Value::Array(books)) => books.clone(),
        Some(Value::Object(books)) => books.values().cloned().collect(),
        _ => vec![root.clone()],
    }
}

fn string_value(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn parse_senses(raw: &str) -> Vec<StudySense> {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| {
            Some(StudySense {
                part: string_value(&value, "part")?,
                meaning: string_value(&value, "meaning")?,
            })
        })
        .filter(|sense| !sense.part.trim().is_empty() && !sense.meaning.trim().is_empty())
        .collect()
}

fn value_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

fn string_array(raw: &str) -> Vec<String> {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.as_str().map(ToString::to_string))
        .collect()
}

fn add_days(start: &str, offset: i64) -> Option<String> {
    chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
        .ok()
        .map(|date| {
            (date + chrono::Duration::days(offset))
                .format("%Y-%m-%d")
                .to_string()
        })
}

fn now() -> String {
    Local::now().to_rfc3339()
}

fn meta_value(connection: &Connection, key: &str) -> Option<String> {
    connection
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()
}

fn normalize_chat_endpoint(raw: &str) -> Result<String, DbError> {
    let trimmed = raw.trim().trim_end_matches('/');
    let is_local_http = trimmed.starts_with("http://localhost")
        || trimmed.starts_with("http://127.0.0.1")
        || trimmed.starts_with("http://[::1]");
    if !trimmed.starts_with("https://") && !is_local_http {
        return Err(DbError::Message(
            "接口必须使用 HTTPS；本机 localhost 接口可以使用 HTTP".to_string(),
        ));
    }
    if trimmed.ends_with("/chat/completions") {
        Ok(trimmed.to_string())
    } else if trimmed.ends_with("/v1") {
        Ok(format!("{trimmed}/chat/completions"))
    } else {
        Ok(format!("{trimmed}/v1/chat/completions"))
    }
}

fn keychain_read() -> Result<Option<String>, DbError> {
    let output = Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ])
        .output()?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!value.is_empty()).then_some(value))
}

fn keychain_save(value: &str) -> Result<(), DbError> {
    let output = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
            value,
            "-U",
        ])
        .output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(DbError::Message(
            "无法写入 macOS 钥匙串，请检查钥匙串权限".to_string(),
        ))
    }
}

fn legacy_application_support_dir() -> Result<PathBuf, DbError> {
    let home =
        std::env::var_os("HOME").ok_or_else(|| DbError::Message("无法定位用户目录".to_string()))?;
    Ok(PathBuf::from(home).join("Library/Application Support/vocab-flow"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_test_state(prefix: &str) -> (std::path::PathBuf, DbState) {
        let path = std::env::temp_dir().join(format!(
            "{prefix}-{}-{}.sqlite3",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let state = DbState {
            path: path.clone(),
            legacy_path: path.with_extension("legacy.json"),
        };
        initialize(&state).unwrap();
        (path, state)
    }

    fn remove_test_db(path: &std::path::Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn migrates_existing_legacy_state_without_mutating_it() {
        let legacy_path = legacy_application_support_dir().unwrap().join(LEGACY_STATE);
        if !legacy_path.exists() {
            return;
        }
        let path = std::env::temp_dir().join(format!(
            "jian-ci-test-{}-{}.sqlite3",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let state = DbState {
            path: path.clone(),
            legacy_path,
        };
        initialize(&state).unwrap();
        let snapshot = load_snapshot(&state).unwrap();
        assert!(!snapshot.books.is_empty());
        assert!(snapshot.books.iter().any(|book| book.word_count >= 2000));
        let backup = backup_json(&state).unwrap();
        assert!(backup.contains("jian-ci-backup"));
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn reconciles_same_day_mastery_into_learning_history_without_duplicates() {
        let path = std::env::temp_dir().join(format!(
            "jian-ci-history-repair-test-{}-{}.sqlite3",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let state = DbState {
            path: path.clone(),
            legacy_path: path.with_extension("legacy.json"),
        };
        initialize(&state).unwrap();
        let date = today();
        let connection = Connection::open(&state.path).unwrap();
        connection
            .execute(
                "INSERT INTO words(book_id, legacy_id, chapter, word, order_index) VALUES('empty-book', '1', 'List 01', 'one', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json) VALUES('empty-book', 0, ?1, '[\"List 01\"]')",
                params![date],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO progress(book_id, word_key, status, last_studied_at) VALUES('empty-book', '1', 'mastered', ?1)",
                params![format!("{date}T10:00:00+08:00")],
            )
            .unwrap();

        assert!(reconcile_history_with_progress(&connection).unwrap());
        assert!(!reconcile_history_with_progress(&connection).unwrap());
        assert_eq!(load_snapshot(&state).unwrap().today.studied_count, 1);

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn unknown_answer_is_moved_to_queue_tail_until_known() {
        let path = std::env::temp_dir().join(format!(
            "jian-ci-queue-test-{}-{}.sqlite3",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let state = DbState {
            path: path.clone(),
            legacy_path: path.with_extension("legacy.json"),
        };
        initialize(&state).unwrap();
        let connection = Connection::open(&state.path).unwrap();
        connection.execute("INSERT INTO words(book_id, legacy_id, chapter, word, order_index) VALUES('empty-book', '1', 'List 01', 'one', 0), ('empty-book', '2', 'List 01', 'two', 1)", []).unwrap();
        connection.execute("INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json) VALUES('empty-book', 0, ?1, '[\"List 01\"]')", params![today()]).unwrap();
        drop(connection);

        let first = start_study(&state, "learn").unwrap();
        assert_eq!(first.current.as_ref().unwrap().word, "one");
        let second = answer_word(&state, "1", false).unwrap();
        assert_eq!(second.current.as_ref().unwrap().word, "one");
        let third = next_word(&state).unwrap();
        assert_eq!(third.current.as_ref().unwrap().word, "two");
        let fourth = answer_word(&state, "2", true).unwrap();
        assert_eq!(fourth.current.as_ref().unwrap().word, "two");
        let fifth = next_word(&state).unwrap();
        assert_eq!(fifth.current.as_ref().unwrap().word, "one");
        let sixth = answer_word(&state, "1", true).unwrap();
        assert_eq!(sixth.current.as_ref().unwrap().word, "one");
        let finished = next_word(&state).unwrap();
        assert!(finished.completed);
        assert!(finished.current.is_none());

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn undo_answer_restores_progress_and_reveals_choice_again() {
        let path = std::env::temp_dir().join(format!(
            "jian-ci-undo-test-{}-{}.sqlite3",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let state = DbState {
            path: path.clone(),
            legacy_path: path.with_extension("legacy.json"),
        };
        initialize(&state).unwrap();
        let connection = Connection::open(&state.path).unwrap();
        connection.execute("INSERT INTO words(book_id, legacy_id, chapter, word, order_index) VALUES('empty-book', '1', 'List 01', 'one', 0)", []).unwrap();
        connection.execute("INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json) VALUES('empty-book', 0, ?1, '[\"List 01\"]')", params![today()]).unwrap();
        drop(connection);

        start_study(&state, "learn").unwrap();
        let answered = answer_word(&state, "1", true).unwrap();
        assert_eq!(answered.answer.as_deref(), Some("known"));
        assert_eq!(load_snapshot(&state).unwrap().today.studied_count, 1);
        let undone = undo_answer(&state).unwrap();
        assert!(undone.answer.is_none());
        assert!(!undone.revealed);
        assert_eq!(undone.known_count, 0);
        let connection = Connection::open(&state.path).unwrap();
        let progress_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM progress WHERE book_id = 'empty-book' AND word_key = '1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(progress_count, 0);
        assert_eq!(load_snapshot(&state).unwrap().today.studied_count, 0);

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn completed_history_can_be_checked_in() {
        let path = std::env::temp_dir().join(format!(
            "jian-ci-checkin-test-{}-{}.sqlite3",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let state = DbState {
            path: path.clone(),
            legacy_path: path.with_extension("legacy.json"),
        };
        initialize(&state).unwrap();
        let connection = Connection::open(&state.path).unwrap();
        connection
            .execute(
                "INSERT INTO words(book_id, legacy_id, chapter, word, order_index) VALUES('empty-book', '1', 'List 01', 'one', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json) VALUES('empty-book', 0, ?1, '[\"List 01\"]')",
                params![today()],
            )
            .unwrap();
        drop(connection);

        start_study(&state, "learn").unwrap();
        answer_word(&state, "1", true).unwrap();
        next_word(&state).unwrap();
        assert!(!load_snapshot(&state).unwrap().today.checked_in);
        let checked = check_in(&state, &today()).unwrap();
        assert!(checked.today.checked_in);

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn imports_and_reads_multiple_word_senses() {
        let path = std::env::temp_dir().join(format!(
            "jian-ci-senses-test-{}-{}.sqlite3",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let state = DbState {
            path: path.clone(),
            legacy_path: path.with_extension("legacy.json"),
        };
        initialize(&state).unwrap();
        let snapshot = import_book(
            &state,
            "多词性测试",
            "",
            vec![ImportWordInput {
                legacy_id: Some("1".to_string()),
                chapter: "List 01".to_string(),
                word: "light".to_string(),
                phonetic: Some("[laɪt]".to_string()),
                part: Some("n. adj.".to_string()),
                meaning: Some("光；轻的".to_string()),
                definition: None,
                example: None,
                translation: None,
                tag: Some("TOEFL".to_string()),
                senses: Some(vec![
                    StudySense {
                        part: "n.".to_string(),
                        meaning: "光".to_string(),
                    },
                    StudySense {
                        part: "adj.".to_string(),
                        meaning: "轻的".to_string(),
                    },
                ]),
            }],
        )
        .unwrap();
        let book_id = snapshot.current_book.unwrap().id;
        let words = get_book_words(&state, &book_id).unwrap();
        assert_eq!(words[0].senses.len(), 2);
        assert_eq!(words[0].senses[1].part, "adj.");
        assert_eq!(words[0].senses[1].meaning, "轻的");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn migrated_session_converts_legacy_numeric_queue() {
        let (path, state) = new_test_state("jian-ci-session-migration-test");
        let date = today();
        let connection = Connection::open(&state.path).unwrap();
        connection
            .execute(
                "INSERT INTO words(book_id, legacy_id, chapter, word, order_index) VALUES('empty-book', '1', 'List 01', 'one', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json) VALUES('empty-book', 0, ?1, '[\"List 01\"]')",
                params![date],
            )
            .unwrap();
        let transaction = connection.unchecked_transaction().unwrap();
        migrate_session(
            &transaction,
            "empty-book",
            Some(&json!({
                "mode": "learn",
                "currentId": 1,
                "revealed": false,
                "lastAnswer": "known",
                "queue": [1],
                "date": date,
                "active": false
            })),
        );
        transaction.commit().unwrap();
        drop(connection);

        let resumed = start_study(&state, "learn").unwrap();
        assert_eq!(resumed.current.as_ref().unwrap().key, "1");
        assert_eq!(resumed.answer.as_deref(), Some("known"));
        assert!(resumed.revealed);

        remove_test_db(&path);
    }

    #[test]
    fn leaving_after_answer_keeps_answer_revealed_for_resume() {
        let (path, state) = new_test_state("jian-ci-leave-session-test");
        let connection = Connection::open(&state.path).unwrap();
        connection
            .execute(
                "INSERT INTO words(book_id, legacy_id, chapter, word, order_index) VALUES('empty-book', '1', 'List 01', 'one', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json) VALUES('empty-book', 0, ?1, '[\"List 01\"]')",
                params![today()],
            )
            .unwrap();
        drop(connection);

        start_study(&state, "learn").unwrap();
        let answered = answer_word(&state, "1", true).unwrap();
        assert!(answered.revealed);
        let left = leave_study(&state).unwrap();
        assert!(!left.active);
        assert!(left.revealed);
        assert_eq!(left.answer.as_deref(), Some("known"));

        let resumed = start_study(&state, "learn").unwrap();
        assert!(!resumed.active);
        assert!(resumed.revealed);
        assert_eq!(resumed.answer.as_deref(), Some("known"));

        remove_test_db(&path);
    }

    #[test]
    fn scheduled_target_excludes_mastered_learning_words() {
        let (path, state) = new_test_state("jian-ci-target-count-test");
        let connection = Connection::open(&state.path).unwrap();
        connection
            .execute(
                "INSERT INTO words(book_id, legacy_id, chapter, word, order_index) VALUES('empty-book', '1', 'List 01', 'one', 0), ('empty-book', '2', 'List 01', 'two', 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json) VALUES('empty-book', 0, ?1, '[\"List 01\"]')",
                params![today()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO progress(book_id, word_key, status) VALUES('empty-book', '1', 'mastered')",
                [],
            )
            .unwrap();
        drop(connection);

        let snapshot = load_snapshot(&state).unwrap();
        assert_eq!(snapshot.today.target_count, 1);
        let session = start_study(&state, "learn").unwrap();
        assert_eq!(session.current.as_ref().unwrap().key, "2");

        remove_test_db(&path);
    }

    #[test]
    fn explicit_empty_learning_schedule_does_not_fallback_to_first_chapter() {
        let (path, state) = new_test_state("jian-ci-empty-schedule-test");
        let connection = Connection::open(&state.path).unwrap();
        connection
            .execute(
                "INSERT INTO words(book_id, legacy_id, chapter, word, order_index) VALUES('empty-book', '1', 'List 01', 'one', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json) VALUES('empty-book', 0, ?1, '[]')",
                params![today()],
            )
            .unwrap();
        drop(connection);

        let session = start_study(&state, "learn").unwrap();
        assert!(session.completed);
        assert!(session.current.is_none());

        remove_test_db(&path);
    }

    #[test]
    fn daily_history_preserves_legacy_id_aliases() {
        let (path, state) = new_test_state("jian-ci-history-alias-test");
        let date = today();
        let connection = Connection::open(&state.path).unwrap();
        connection
            .execute(
                "INSERT INTO words(book_id, legacy_id, chapter, word, order_index) VALUES('empty-book', '1', 'List 01', 'one', 0), ('empty-book', '2', 'List 01', 'two', 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO schedule_days(book_id, day_index, date, study_chapters_json) VALUES('empty-book', 0, ?1, '[\"List 01\"]')",
                params![date],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO study_history(book_id, date, payload_json) VALUES('empty-book', ?1, '{\"learnedWordIds\":[1],\"studiedCount\":1}')",
                params![date],
            )
            .unwrap();

        record_daily_history(&connection, "empty-book", &date, "learn", "2", true, None).unwrap();
        let raw: String = connection
            .query_row(
                "SELECT payload_json FROM study_history WHERE book_id = 'empty-book' AND date = ?1",
                params![date],
                |row| row.get(0),
            )
            .unwrap();
        let payload: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(history_keys(&payload, &["learnedWordKeys"]), vec!["1", "2"]);
        assert_eq!(value_i64(&payload, "studiedCount"), Some(2));

        drop(connection);
        remove_test_db(&path);
    }
}
