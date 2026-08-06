mod db;

use db::{
    AppSnapshot, DbState, ImportWordInput, LlmAskInput, LlmSettings, ScheduleDayInput,
    ScheduleDaySnapshot, StudySessionSnapshot,
};
use tauri::Manager;

#[tauri::command]
fn get_app_snapshot(state: tauri::State<'_, DbState>) -> Result<AppSnapshot, String> {
    db::load_snapshot(&state).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_active_book(
    book_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<AppSnapshot, String> {
    db::set_active_book(&state, &book_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_backup_json(state: tauri::State<'_, DbState>) -> Result<String, String> {
    db::backup_json(&state).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_book_words(
    book_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<db::StudyWord>, String> {
    db::get_book_words(&state, &book_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn check_in(date: String, state: tauri::State<'_, DbState>) -> Result<db::AppSnapshot, String> {
    db::check_in(&state, &date).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_snapshot(reason: String, state: tauri::State<'_, DbState>) -> Result<i64, String> {
    db::create_snapshot(&state, &reason).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_llm_settings(state: tauri::State<'_, DbState>) -> Result<LlmSettings, String> {
    db::get_llm_settings(&state).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_llm_settings(
    endpoint: String,
    model: String,
    api_key: String,
    state: tauri::State<'_, DbState>,
) -> Result<LlmSettings, String> {
    db::save_llm_settings(&state, &endpoint, &model, &api_key).map_err(|error| error.to_string())
}

#[tauri::command]
async fn ask_llm(input: LlmAskInput, state: tauri::State<'_, DbState>) -> Result<String, String> {
    // curl and Keychain access are blocking operations. Keep them off Tauri's
    // main thread so macOS does not show the beachball while the model replies.
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        db::ask_llm(&state, input).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("AI 请求线程异常：{error}"))?
}

#[tauri::command]
fn start_study(
    mode: String,
    date: Option<String>,
    state: tauri::State<'_, DbState>,
) -> Result<StudySessionSnapshot, String> {
    let result = match date.as_deref() {
        Some(date) => db::start_study_for_date(&state, &mode, Some(date)),
        None => db::start_study(&state, &mode),
    };
    result.map_err(|error| error.to_string())
}

#[tauri::command]
fn answer_word(
    word_key: String,
    known: bool,
    state: tauri::State<'_, DbState>,
) -> Result<StudySessionSnapshot, String> {
    db::answer_word(&state, &word_key, known).map_err(|error| error.to_string())
}

#[tauri::command]
fn undo_answer(state: tauri::State<'_, DbState>) -> Result<StudySessionSnapshot, String> {
    db::undo_answer(&state).map_err(|error| error.to_string())
}

#[tauri::command]
fn next_word(state: tauri::State<'_, DbState>) -> Result<StudySessionSnapshot, String> {
    db::next_word(&state).map_err(|error| error.to_string())
}

#[tauri::command]
fn leave_study(state: tauri::State<'_, DbState>) -> Result<StudySessionSnapshot, String> {
    db::leave_study(&state).map_err(|error| error.to_string())
}

#[tauri::command]
fn rename_book(
    book_id: String,
    name: String,
    note: String,
    state: tauri::State<'_, DbState>,
) -> Result<AppSnapshot, String> {
    db::rename_book(&state, &book_id, &name, &note).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_book(book_id: String, state: tauri::State<'_, DbState>) -> Result<AppSnapshot, String> {
    db::delete_book(&state, &book_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn import_book(
    name: String,
    note: String,
    words: Vec<ImportWordInput>,
    state: tauri::State<'_, DbState>,
) -> Result<AppSnapshot, String> {
    db::import_book(&state, &name, &note, words).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_schedule(state: tauri::State<'_, DbState>) -> Result<Vec<ScheduleDaySnapshot>, String> {
    db::get_schedule(&state).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_schedule(
    start_date: String,
    days: Vec<ScheduleDayInput>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<ScheduleDaySnapshot>, String> {
    db::save_schedule(&state, &start_date, days).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let state = DbState::new(app_data_dir)?;
            db::initialize(&state)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_snapshot,
            set_active_book,
            get_backup_json,
            get_book_words,
            check_in,
            create_snapshot,
            get_llm_settings,
            save_llm_settings,
            ask_llm,
            start_study,
            answer_word,
            undo_answer,
            next_word,
            leave_study,
            rename_book,
            delete_book,
            import_book,
            get_schedule,
            save_schedule
        ])
        .run(tauri::generate_context!())
        .expect("error while running 简辞");
}
