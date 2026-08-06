import { invoke } from "@tauri-apps/api/core";
import type {
  AppSnapshot,
  BookWord,
  ImportWordInput,
  LlmMessage,
  LlmSettings,
  ScheduleDayInput,
  StudySessionSnapshot,
  StudyWord,
} from "./types";

export function loadSnapshot() {
  return invoke<AppSnapshot>("get_app_snapshot");
}

export function setActiveBook(bookId: string) {
  return invoke<AppSnapshot>("set_active_book", { bookId });
}

export function getBookWords(bookId: string) {
  return invoke<BookWord[]>("get_book_words", { bookId });
}

export function getBackupJson() {
  return invoke<string>("get_backup_json");
}

export function checkIn(date: string) {
  return invoke<AppSnapshot>("check_in", { date });
}

export function renameBook(bookId: string, name: string, note: string) {
  return invoke<AppSnapshot>("rename_book", { bookId, name, note });
}

export function deleteBook(bookId: string) {
  return invoke<AppSnapshot>("delete_book", { bookId });
}

export function importBook(name: string, note: string, words: ImportWordInput[]) {
  return invoke<AppSnapshot>("import_book", { name, note, words });
}

export function saveSchedule(startDate: string, days: ScheduleDayInput[]) {
  return invoke("save_schedule", { startDate, days });
}

export function loadLlmSettings() {
  return invoke<LlmSettings>("get_llm_settings");
}

export function saveLlmSettings(endpoint: string, model: string, apiKey: string) {
  return invoke<LlmSettings>("save_llm_settings", { endpoint, model, apiKey });
}

export function askLlm(
  word: StudyWord & { key: string },
  answer: StudySessionSnapshot["answer"],
  messages: LlmMessage[],
) {
  return invoke<string>("ask_llm", { input: { word, answer, messages } });
}

export function startStudy(mode: "learn" | "review", date?: string) {
  return invoke<StudySessionSnapshot>("start_study", { mode, date: date ?? null });
}

export function answerWord(wordKey: string, known: boolean) {
  return invoke<StudySessionSnapshot>("answer_word", { wordKey, known });
}

export function nextWord() {
  return invoke<StudySessionSnapshot>("next_word");
}

export function undoAnswer() {
  return invoke<StudySessionSnapshot>("undo_answer");
}

export function leaveStudy() {
  return invoke<StudySessionSnapshot>("leave_study");
}
