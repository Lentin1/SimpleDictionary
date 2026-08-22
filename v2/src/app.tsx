import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { answerVocabularyWord, answerWord, applyBookProofread, askLlm, checkIn, deleteBook, getBackupJson, getBookWords, getVocabularyWords, importBook, leaveStudy, leaveVocabularyStudy, loadLlmSettings, loadPronunciationSettings, loadSnapshot, nextVocabularyWord, nextWord, proofreadBook, renameBook, saveLlmSettings, savePronunciationSettings as savePronunciationSettingsCommand, saveSchedule, setActiveBook, setVocabularyWord, startStudy, startVocabularyStudy, synthesizePronunciation, undoAnswer, undoVocabularyAnswer } from "./backend";
import type { AppSnapshot, BookWord, ImportWordInput, LlmMessage, LlmSettings, PronunciationAudio, PronunciationPriority, PronunciationSettings, ProofreadIssue, ProofreadProgress, ScheduleDayInput, StudySessionSnapshot, View, VocabularyWord } from "./types";
import { parsePdfImport } from "../../lib/pdf-import";
import { shouldSubmitAiQuestion } from "./ai-input";
import { selectPronunciationVoice } from "./speech-voice";
import { studySenses } from "./word-meaning";
import { defaultShortcutBindings, findMatchingShortcut, findShortcutConflict, formatShortcut, loadShortcutBindings, normalizeShortcut, saveShortcutBindings, shouldIgnoreShortcutEvent, shortcutActionLabel, SHORTCUT_ACTIONS } from "./shortcuts";
import type { ShortcutAction, ShortcutBinding, ShortcutBindings } from "./shortcuts";

type ThemeMode = "system" | "light" | "dark";
type StudyWord = NonNullable<StudySessionSnapshot["current"]>;
type AiAudioEntry = { audio: HTMLAudioElement; url: string };
type ProofreadState = {
  book: AppSnapshot["books"][number];
  loading: boolean;
  issues: ProofreadIssue[];
  error?: string;
};

const AUTO_PRONOUNCE_STORAGE_KEY = "jian-ci-auto-pronounce-after-answer";
const AI_AUDIO_CACHE_LIMIT = 8;

const AI_SUGGESTIONS = [
  {
    label: "怎么记忆",
    prompt: "这个单词怎么记？请结合词义、发音或联想，给我一个简短好记的方法。",
  },
  {
    label: "怎么用",
    prompt: "这个单词怎么用？请说明常见搭配，并给出 2 个英文例句和中文翻译。",
  },
  {
    label: "派生词",
    prompt: "这个单词有哪些常见派生词？请按词性列出，并简要说明含义。",
  },
  {
    label: "词根",
    prompt: "请分析这个单词的词根、前缀或后缀，并说明它们如何帮助理解词义。",
  },
] as const;

const initialSnapshot: AppSnapshot = {
  appName: "简辞",
  currentBook: null,
  books: [],
  today: {
    date: "",
    studiedCount: 0,
    reviewCount: 0,
    targetCount: 0,
    checkedIn: false,
    studyChapters: [],
      reviewChapters: [],
    },
  schedule: [],
  history: [],
  migratedFromLegacy: false,
};

const emptyLlmSettings: LlmSettings = { endpoint: "", model: "", configured: false };
const defaultPronunciationSettings: PronunciationSettings = { enabled: true, model: "minimax-speech-2.8-turbo", voiceId: "English_PlayfulGirl", priority: "ai-first" };

function disposeAiAudioEntry({ audio, url }: AiAudioEntry) {
  audio.onplay = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  URL.revokeObjectURL(url);
}

function formatDate(date: string) {
  if (!date) return "今天";
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(parsed);
}

function progress(snapshot: AppSnapshot) {
  const { studiedCount, targetCount } = snapshot.today;
  return targetCount ? Math.min(100, Math.round((studiedCount / targetCount) * 100)) : 0;
}

export function App() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [view, setView] = useState<View>("today");
  const [aiOpen, setAiOpen] = useState(false);
  const [llmSettings, setLlmSettings] = useState(emptyLlmSettings);
  const [llmSettingsLoaded, setLlmSettingsLoaded] = useState(false);
  const [pronunciationSettings, setPronunciationSettings] = useState(defaultPronunciationSettings);
  const [pronunciationSettingsLoaded, setPronunciationSettingsLoaded] = useState(false);
  const [aiConversation, setAiConversation] = useState<{ wordKey: string; messages: LlmMessage[] } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [studySession, setStudySession] = useState<StudySessionSnapshot | null>(null);
  const [vocabularyWords, setVocabularyWords] = useState<VocabularyWord[]>([]);
  const [bookPreview, setBookPreview] = useState<{ book: AppSnapshot["books"][number]; words: BookWord[] } | null>(null);
  const [proofreadState, setProofreadState] = useState<ProofreadState | null>(null);
  const [proofreadProgress, setProofreadProgress] = useState<ProofreadProgress | null>(null);
  const [proofreadCollapsed, setProofreadCollapsed] = useState(false);
  const [proofreadWindowSize, setProofreadWindowSize] = useState<"compact" | "large">("compact");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("jian-ci-sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = window.localStorage.getItem("jian-ci-theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  const [autoPronounceAfterAnswer, setAutoPronounceAfterAnswer] = useState(() => {
    try {
      return window.localStorage.getItem(AUTO_PRONOUNCE_STORAGE_KEY) === "enabled";
    } catch {
      return false;
    }
  });
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>(() => loadShortcutBindings());
  const [speakingWordKey, setSpeakingWordKey] = useState<string | null>(null);
  const [pronunciationStatus, setPronunciationStatus] = useState<{ wordKey: string; kind: "fallback"; message: string } | null>(null);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false);
  const speechTimerRef = useRef<number | null>(null);
  const speechWatchdogRef = useRef<number | null>(null);
  const speechAttemptRef = useRef(0);
  const speechRequestRef = useRef(0);
  const speechVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const aiAudioRef = useRef<HTMLAudioElement | null>(null);
  const aiAudioCacheRef = useRef(new Map<string, AiAudioEntry>());
  const aiAudioPendingRef = useRef(new Map<string, Promise<AiAudioEntry>>());

  const clearAiAudio = useCallback(() => {
    const audio = aiAudioRef.current;
    if (!audio) return;
    audio.onplay = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.currentTime = 0;
    aiAudioRef.current = null;
  }, []);

  const clearAiAudioCache = useCallback(() => {
    clearAiAudio();
    for (const entry of aiAudioCacheRef.current.values()) disposeAiAudioEntry(entry);
    aiAudioCacheRef.current.clear();
  }, [clearAiAudio]);

  useEffect(() => {
    loadSnapshot().then(setSnapshot);
    getVocabularyWords()
      .then(setVocabularyWords)
      .catch(() => setVocabularyWords([]));
    loadLlmSettings()
      .then(setLlmSettings)
      .catch(() => setLlmSettings(emptyLlmSettings))
      .finally(() => setLlmSettingsLoaded(true));
    loadPronunciationSettings()
      .then(setPronunciationSettings)
      .catch(() => setPronunciationSettings(defaultPronunciationSettings))
      .finally(() => setPronunciationSettingsLoaded(true));
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<ProofreadProgress>("proofread-progress", (event) => {
      if (active) setProofreadProgress(event.payload);
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("jian-ci-theme", theme);
    } catch {
      // Theme persistence is optional; learning data is stored by the desktop backend.
    }
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("jian-ci-sidebar", sidebarCollapsed ? "collapsed" : "expanded");
    } catch {
      // Sidebar preference is optional; learning data is stored by the desktop backend.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_PRONOUNCE_STORAGE_KEY, autoPronounceAfterAnswer ? "enabled" : "disabled");
    } catch {
      // Pronunciation preference is optional; learning data is stored by the desktop backend.
    }
  }, [autoPronounceAfterAnswer]);

  useEffect(() => {
    saveShortcutBindings(shortcuts);
  }, [shortcuts]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
    const synthesis = window.speechSynthesis;
    const updateVoices = () => {
      speechVoicesRef.current = synthesis.getVoices();
    };
    updateVoices();
    synthesis.addEventListener("voiceschanged", updateVoices);
    return () => synthesis.removeEventListener("voiceschanged", updateVoices);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    clearAiAudio();
    speechRequestRef.current += 1;
    if (speechTimerRef.current !== null) {
      window.clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    if (speechWatchdogRef.current !== null) {
      window.clearTimeout(speechWatchdogRef.current);
      speechWatchdogRef.current = null;
    }
  }, [clearAiAudio, studySession?.current?.key, view]);

  useEffect(() => () => {
    speechRequestRef.current += 1;
    if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
    if (speechWatchdogRef.current !== null) window.clearTimeout(speechWatchdogRef.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    clearAiAudioCache();
  }, [clearAiAudioCache]);

  const percent = progress(snapshot);
  const effectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.dataset.effectiveTheme = effectiveTheme;
  }, [effectiveTheme]);

  const speakSystemWord = useCallback((word: StudyWord, request: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setSpeakingWordKey((current) => current === word.key ? null : current);
      return;
    }
    const synthesis = window.speechSynthesis;
    if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
    if (speechWatchdogRef.current !== null) window.clearTimeout(speechWatchdogRef.current);
    synthesis.cancel();
    synthesis.resume();
    const voices = speechVoicesRef.current.length ? speechVoicesRef.current : synthesis.getVoices();
    const pronunciationVoice = selectPronunciationVoice(voices);
    const maxAttempts = 4;

    const startAttempt = (attempt: number) => {
      if (request !== speechRequestRef.current) return;
      const activeAttempt = ++speechAttemptRef.current;
      let started = false;
      const clearWatchdog = () => {
        if (speechWatchdogRef.current !== null) {
          window.clearTimeout(speechWatchdogRef.current);
          speechWatchdogRef.current = null;
        }
      };
      const retry = () => {
        if (request !== speechRequestRef.current || activeAttempt !== speechAttemptRef.current || started) return;
        clearWatchdog();
        if (attempt >= maxAttempts) {
          setSpeakingWordKey((current) => current === word.key ? null : current);
          return;
        }
        synthesis.cancel();
        synthesis.resume();
        speechTimerRef.current = window.setTimeout(() => {
          speechTimerRef.current = null;
          startAttempt(attempt + 1);
        }, attempt * 120);
      };

      const utterance = new SpeechSynthesisUtterance(word.word);
      if (pronunciationVoice) {
        utterance.voice = pronunciationVoice;
        utterance.lang = pronunciationVoice.lang;
      } else {
        utterance.lang = "en-US";
      }
      utterance.rate = 0.82;
      utterance.pitch = 1;
      utterance.onstart = () => {
        if (request !== speechRequestRef.current || activeAttempt !== speechAttemptRef.current) return;
        started = true;
        clearWatchdog();
        setSpeakingWordKey(word.key);
      };
      utterance.onend = () => {
        if (activeAttempt !== speechAttemptRef.current) return;
        clearWatchdog();
        setSpeakingWordKey((current) => current === word.key ? null : current);
      };
      utterance.onerror = () => {
        if (activeAttempt !== speechAttemptRef.current) return;
        if (!started) retry();
        else setSpeakingWordKey((current) => current === word.key ? null : current);
      };
      try {
        synthesis.resume();
        synthesis.speak(utterance);
      } catch {
        retry();
        return;
      }
      speechWatchdogRef.current = window.setTimeout(() => {
        speechWatchdogRef.current = null;
        if (!started) retry();
      }, 700);
    };

    setSpeakingWordKey(word.key);
    speechTimerRef.current = window.setTimeout(() => {
      speechTimerRef.current = null;
      if (request !== speechRequestRef.current) return;
      startAttempt(1);
    }, 40);
  }, []);

  const preloadAiAudio = useCallback((word: StudyWord) => {
    const cacheKey = JSON.stringify([
      snapshot.currentBook?.id ?? "",
      word.key,
      word.word,
      llmSettings.endpoint,
      pronunciationSettings.model,
      pronunciationSettings.voiceId,
    ]);
    const cached = aiAudioCacheRef.current.get(cacheKey);
    if (cached) {
      aiAudioCacheRef.current.delete(cacheKey);
      aiAudioCacheRef.current.set(cacheKey, cached);
      return Promise.resolve(cached);
    }
    const pending = aiAudioPendingRef.current.get(cacheKey);
    if (pending) return pending;
    const request = (async () => {
      const result: PronunciationAudio = await synthesizePronunciation(word.word);
      const hex = result.audioHex.trim();
      if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("MiniMax 音频数据无效");
      const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((pair) => Number.parseInt(pair, 16)));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || "audio/mpeg" }));
      const entry: AiAudioEntry = { audio: new Audio(url), url };
      entry.audio.preload = "auto";
      entry.audio.load();
      aiAudioCacheRef.current.set(cacheKey, entry);
      while (aiAudioCacheRef.current.size > AI_AUDIO_CACHE_LIMIT) {
        const oldestKey = aiAudioCacheRef.current.keys().next().value as string | undefined;
        if (!oldestKey) break;
        const oldestEntry = aiAudioCacheRef.current.get(oldestKey);
        aiAudioCacheRef.current.delete(oldestKey);
        if (oldestEntry) disposeAiAudioEntry(oldestEntry);
      }
      return entry;
    })();
    aiAudioPendingRef.current.set(cacheKey, request);
    void request.then(
      () => { if (aiAudioPendingRef.current.get(cacheKey) === request) aiAudioPendingRef.current.delete(cacheKey); },
      () => { if (aiAudioPendingRef.current.get(cacheKey) === request) aiAudioPendingRef.current.delete(cacheKey); },
    );
    return request;
  }, [llmSettings.endpoint, pronunciationSettings.model, pronunciationSettings.voiceId, snapshot.currentBook?.id]);

  useEffect(() => {
    const word = studySession?.current;
    const shouldPreload = view === "learn"
      && Boolean(word)
      && pronunciationSettings.enabled
      && pronunciationSettings.priority === "ai-first"
      && llmSettings.endpoint.trim().length > 0;
    if (!shouldPreload || !word) return;
    void preloadAiAudio(word).catch(() => {
      // The click path will show the diagnostic and fall back to the existing voice.
    });
  }, [llmSettings.endpoint, preloadAiAudio, pronunciationSettings.enabled, pronunciationSettings.priority, studySession, view]);

  const speakAiWord = useCallback(async (word: StudyWord, request: number, fallback: () => void) => {
    try {
      const entry = await preloadAiAudio(word);
      if (request !== speechRequestRef.current) return;
      clearAiAudio();
      const { audio } = entry;
      audio.currentTime = 0;
      aiAudioRef.current = audio;
      audio.onplay = () => {
        if (request === speechRequestRef.current && aiAudioRef.current === audio) setSpeakingWordKey(word.key);
      };
      audio.onended = () => {
        if (request !== speechRequestRef.current || aiAudioRef.current !== audio) return;
        aiAudioRef.current = null;
        setSpeakingWordKey((current) => current === word.key ? null : current);
      };
      audio.onerror = () => {
        if (aiAudioRef.current === audio) aiAudioRef.current = null;
        fallback();
      };
      setSpeakingWordKey(word.key);
      await audio.play();
    } catch (error) {
      if (request === speechRequestRef.current) {
        const message = error instanceof Error ? error.message : String(error);
        setPronunciationStatus({ wordKey: word.key, kind: "fallback", message: `MiniMax 失败，已回退现有语音：${message}` });
        fallback();
      }
    }
  }, [clearAiAudio, preloadAiAudio]);

  const speakWord = useCallback((word: StudyWord) => {
    const request = ++speechRequestRef.current;
    if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
    if (speechWatchdogRef.current !== null) window.clearTimeout(speechWatchdogRef.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    clearAiAudio();
    const aiFirst = pronunciationSettings.enabled
      && pronunciationSettings.priority === "ai-first"
      && llmSettings.endpoint.trim().length > 0;
    setPronunciationStatus(null);
    if (aiFirst) {
      void speakAiWord(word, request, () => speakSystemWord(word, request));
    } else {
      speakSystemWord(word, request);
    }
  }, [clearAiAudio, llmSettings.endpoint, pronunciationSettings.enabled, pronunciationSettings.priority, speakAiWord, speakSystemWord]);

  async function chooseBook(bookId: string) {
    const next = await setActiveBook(bookId);
    setSnapshot(next);
    setVocabularyWords(await getVocabularyWords());
  }

  async function editBook(bookId: string, name: string, note: string) {
    setSnapshot(await renameBook(bookId, name, note));
  }

  async function removeBook(bookId: string) {
    setSnapshot(await deleteBook(bookId));
    setVocabularyWords(await getVocabularyWords());
  }

  async function addBook(name: string, note: string, words: ImportWordInput[]) {
    setSnapshot(await importBook(name, note, words));
    setVocabularyWords(await getVocabularyWords());
  }

  async function savePlan(days: ScheduleDayInput[]) {
    if (!snapshot.today.date) return;
    await saveSchedule(snapshot.today.date, days);
    setSnapshot(await loadSnapshot());
  }

  async function saveAiSettings(endpoint: string, model: string, apiKey: string) {
    const next = await saveLlmSettings(endpoint, model, apiKey);
    setLlmSettings(next);
  }

  async function savePronunciationSettings(settings: PronunciationSettings) {
    const next = await savePronunciationSettingsCommand(settings);
    setPronunciationSettings(next);
  }

  async function openBookPreview(bookId: string) {
    const book = snapshot.books.find((item) => item.id === bookId);
    if (!book) return;
    setBookPreview({ book, words: await getBookWords(bookId) });
  }

  async function startBookProofread(bookId: string) {
    const book = snapshot.books.find((item) => item.id === bookId);
    if (!book) return;
    setProofreadCollapsed(false);
    setProofreadProgress({ bookId, completed: 0, total: book.wordCount, issuesFound: 0 });
    setProofreadState({ book, loading: true, issues: [] });
    try {
      const issues = await proofreadBook(bookId);
      setProofreadState({ book, loading: false, issues, error: undefined });
      setProofreadProgress(null);
    } catch (error) {
      setProofreadState({ book, loading: false, issues: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function applyProofreadChanges(bookId: string, changes: ProofreadIssue[]) {
    try {
      const next = await applyBookProofread(bookId, changes);
      setSnapshot(next);
      if (bookPreview?.book.id === bookId) {
        const book = next.books.find((item) => item.id === bookId);
        if (book) setBookPreview({ book, words: await getBookWords(bookId) });
      }
      setProofreadState(null);
      setProofreadProgress(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportBackup() {
    const payload = await getBackupJson();
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jian-ci-backup-${snapshot.today.date || "today"}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleCheckIn(date: string) {
    try {
      setSnapshot(await checkIn(date));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function openStudy(mode: "learn" | "review", date?: string) {
    const next = await startStudy(mode, date);
    setSpeakingWordKey(null);
    setAiConversation(null);
    setStudySession(next);
    setRevealed(next.revealed);
    setView("learn");
  }

  async function openVocabularyStudy() {
    const next = await startVocabularyStudy();
    setSpeakingWordKey(null);
    setAiConversation(null);
    setStudySession(next);
    setRevealed(next.revealed);
    setView("learn");
  }

  async function toggleVocabularyWord(wordKey: string, saved: boolean) {
    const nextWords = await setVocabularyWord(wordKey, saved);
    setVocabularyWords(nextWords);
    if (!saved && studySession?.mode === "vocabulary" && studySession.current?.key === wordKey) {
      if (studySession.remainingCount <= 1) {
        setStudySession(null);
        setRevealed(false);
        setAiConversation(null);
        setView("vocabulary");
        return;
      }
      const nextSession = await startVocabularyStudy();
      setStudySession(nextSession);
      setRevealed(nextSession.revealed);
      setAiConversation(null);
      if (nextSession.completed) setView("vocabulary");
    }
  }

  const handleAnswer = useCallback(async (known: boolean) => {
    if (!studySession?.current) return;
    const answeredWord = studySession.current;
    const next = studySession.mode === "vocabulary"
      ? await answerVocabularyWord(answeredWord.key, known)
      : await answerWord(answeredWord.key, known);
    setStudySession(next);
    setRevealed(next.revealed);
    if (autoPronounceAfterAnswer) speakWord(answeredWord);
  }, [autoPronounceAfterAnswer, speakWord, studySession]);

  const handleNext = useCallback(async () => {
    setSpeakingWordKey(null);
    setAiConversation(null);
    const vocabularyMode = studySession?.mode === "vocabulary";
    const next = vocabularyMode ? await nextVocabularyWord() : await nextWord();
    setStudySession(next);
    setRevealed(next.revealed);
    if (next.completed) {
      setSnapshot(await loadSnapshot());
      setView(vocabularyMode ? "vocabulary" : "today");
    }
  }, [studySession]);

  const handleUndo = useCallback(async () => {
    try {
      const next = studySession?.mode === "vocabulary" ? await undoVocabularyAnswer() : await undoAnswer();
      setStudySession(next);
      setRevealed(next.revealed);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [studySession]);

  async function handleLeave() {
    if (studySession) {
      if (studySession.mode === "vocabulary") await leaveVocabularyStudy();
      else await leaveStudy();
    }
    setSpeakingWordKey(null);
    setAiConversation(null);
    setSnapshot(await loadSnapshot());
    setView(studySession?.mode === "vocabulary" ? "vocabulary" : "today");
  }

  useEffect(() => {
    if (view !== "learn") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcutEvent(event)) return;
      if (!studySession?.current) return;
      const action = findMatchingShortcut(event, shortcuts);
      if (!action) return;
      event.preventDefault();
      if (action === "answerUnknown" && !revealed) {
        void handleAnswer(false);
      } else if (action === "answerKnown" && !revealed) {
        void handleAnswer(true);
      } else if (action === "advance" && revealed) {
        void handleNext();
      } else if (action === "undo" && revealed) {
        void handleUndo();
      } else if (action === "pronounce") {
        speakWord(studySession.current);
      } else if (action === "openAi") {
        setAiOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAnswer, handleNext, handleUndo, revealed, shortcuts, speakWord, studySession, view]);

  const aiWordKey = studySession?.current?.key ?? null;
  const aiMessages = aiWordKey && aiConversation?.wordKey === aiWordKey ? aiConversation.messages : [];
  const vocabularyKeys = new Set(vocabularyWords.map((word) => word.key));

  return (
    <main className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"} data-view={view}>
      <aside className="sidebar">
        <div className="sidebar-toolbar">
          <div className="sidebar-title" aria-label="简辞">
            <strong>简辞</strong>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <SidebarPanelIcon />
          </button>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <p className="nav-section-label">学习</p>
          <button className={view === "today" ? "nav-item active" : "nav-item"} onClick={() => setView("today")} title={sidebarCollapsed ? "今日学习" : undefined}>
            <span className="nav-icon"><NavIcon name="today" /></span>
            <span>今日学习</span>
            <b>{snapshot.today.studiedCount} / {snapshot.today.targetCount || "—"}</b>
          </button>
          <p className="nav-section-label">词汇</p>
          <button className={view === "books" ? "nav-item active" : "nav-item"} onClick={() => setView("books")} title={sidebarCollapsed ? "我的词书" : undefined}>
            <span className="nav-icon"><NavIcon name="books" /></span>
            <span>我的词书</span>
          </button>
          <button className={view === "vocabulary" ? "nav-item active" : "nav-item"} onClick={() => setView("vocabulary")} title={sidebarCollapsed ? `生词本（${vocabularyWords.length}）` : undefined}>
            <span className="nav-icon"><NavIcon name="vocabulary" /></span>
            <span>生词本</span>
            <b>{vocabularyWords.length}</b>
          </button>
          <p className="nav-section-label">偏好</p>
          <button className={view === "settings" ? "nav-item active" : "nav-item"} onClick={() => setView("settings")} title={sidebarCollapsed ? "设置" : undefined}>
            <span className="nav-icon"><NavIcon name="settings" /></span>
            <span>设置</span>
          </button>
        </nav>

      </aside>

      <section className={view === "learn" ? "content learning-content" : "content"}>
        {view === "today" && <header className="topbar">
          <div>
            <p className="eyebrow">{formatDate(snapshot.today.date)}</p>
            <h1>{timeGreeting()}</h1>
          </div>
        </header>}

        {view === "today" && (
          <TodayPage snapshot={snapshot} percent={percent} onStart={(mode, date) => void openStudy(mode, date)} onSaveSchedule={savePlan} onCheckIn={handleCheckIn} />
        )}
        {view === "books" && (
          <BooksPage snapshot={snapshot} onChoose={chooseBook} onRename={editBook} onDelete={removeBook} onImport={addBook} onView={openBookPreview} onProofread={startBookProofread} proofreadBookId={proofreadState?.loading ? proofreadState.book.id : null} onExport={exportBackup} />
        )}
        {view === "vocabulary" && (
          <VocabularyPage
            bookName={snapshot.currentBook?.name ?? "当前词书"}
            words={vocabularyWords}
            speakingWordKey={speakingWordKey}
            onPronounce={speakWord}
            onRemove={(wordKey) => void toggleVocabularyWord(wordKey, false)}
            onStart={() => void openVocabularyStudy()}
          />
        )}
        {view === "settings" && (
          <SettingsPage
            key={`${llmSettingsLoaded}|${pronunciationSettingsLoaded}`}
            theme={theme}
            effectiveTheme={effectiveTheme}
            onThemeChange={setTheme}
            autoPronounceAfterAnswer={autoPronounceAfterAnswer}
            onAutoPronounceChange={setAutoPronounceAfterAnswer}
            shortcuts={shortcuts}
            onShortcutChange={(action, shortcut) => setShortcuts((current) => ({ ...current, [action]: shortcut }))}
            onResetShortcuts={() => setShortcuts(defaultShortcutBindings())}
            llmSettings={llmSettings}
            llmSettingsLoaded={llmSettingsLoaded}
            onSaveAiSettings={saveAiSettings}
            pronunciationSettings={pronunciationSettings}
            pronunciationSettingsLoaded={pronunciationSettingsLoaded}
            onSavePronunciationSettings={savePronunciationSettings}
          />
        )}
        {view === "learn" && (
          <StudyPage
            session={studySession}
            snapshot={snapshot}
            percent={percent}
            revealed={revealed}
            onAnswer={(known) => void handleAnswer(known)}
            onNext={() => void handleNext()}
            onUndo={() => void handleUndo()}
            onBack={() => void handleLeave()}
            onAi={() => setAiOpen((open) => !open)}
            autoPronounceAfterAnswer={autoPronounceAfterAnswer}
            onAutoPronounceChange={setAutoPronounceAfterAnswer}
            speakingWordKey={speakingWordKey}
            pronunciationStatus={pronunciationStatus}
            onPronounce={speakWord}
            shortcuts={shortcuts}
            saved={Boolean(studySession?.current && vocabularyKeys.has(studySession.current.key))}
            onToggleSaved={(wordKey, saved) => void toggleVocabularyWord(wordKey, saved)}
          />
        )}
      </section>

      {aiOpen && <><button type="button" className="ai-drawer-backdrop" tabIndex={-1} aria-label="关闭 AI 面板" onClick={() => setAiOpen(false)} /><AiDrawer key={`${llmSettings.endpoint}|${llmSettings.model}|${llmSettings.configured}`} word={studySession?.current ?? null} answer={studySession?.answer ?? null} settings={llmSettings} messages={aiMessages} onMessagesChange={(messages) => { if (aiWordKey) setAiConversation({ wordKey: aiWordKey, messages }); }} onSaveSettings={saveAiSettings} onClose={() => setAiOpen(false)} /></>}
      {bookPreview && <BookPreview book={bookPreview.book} words={bookPreview.words} savedKeys={vocabularyKeys} onToggleSaved={(wordKey, saved) => void toggleVocabularyWord(wordKey, saved)} onClose={() => setBookPreview(null)} />}
      {proofreadState && <ProofreadDialog key={`${proofreadState.book.id}|${proofreadState.loading}|${proofreadState.issues.map((issue) => issue.key).join(",")}`} state={proofreadState} progress={proofreadProgress} collapsed={proofreadCollapsed} windowSize={proofreadWindowSize} onToggleCollapsed={() => setProofreadCollapsed((collapsed) => !collapsed)} onToggleSize={() => setProofreadWindowSize((size) => size === "compact" ? "large" : "compact")} onRetry={() => void startBookProofread(proofreadState.book.id)} onClose={() => { setProofreadState(null); setProofreadProgress(null); }} onApply={(changes) => void applyProofreadChanges(proofreadState.book.id, changes)} />}
    </main>
  );
}

function SunIcon() {
  return <svg className="theme-icon sun-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>;
}

function MoonIcon() {
  return <svg className="theme-icon moon-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8a8.5 8.5 0 1 0 11.3 11.3Z" /></svg>;
}

function SystemThemeIcon() {
  return <svg className="theme-icon system-theme-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
}

function SidebarPanelIcon() {
  return <svg className="sidebar-panel-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M9 4v16" /><path d="m6.4 10.2-1.8 1.8 1.8 1.8" /></svg>;
}

function NavIcon({ name }: { name: "today" | "books" | "vocabulary" | "settings" }) {
  const paths = {
    today: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3.5 2" /></>,
    books: <><path d="M5 4.5h11.5A2.5 2.5 0 0 1 19 7v12H7.5A2.5 2.5 0 0 1 5 16.5v-12Z" /><path d="M5 16.5A2.5 2.5 0 0 1 7.5 14H19M9 8h6" /></>,
    vocabulary: <><path d="M7 4h10a2 2 0 0 1 2 2v14l-7-4-7 4V6a2 2 0 0 1 2-2Z" /><path d="M9 8h6" /></>,
    settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function SettingsPage({ theme, effectiveTheme, onThemeChange, autoPronounceAfterAnswer, onAutoPronounceChange, shortcuts, onShortcutChange, onResetShortcuts, llmSettings, llmSettingsLoaded, onSaveAiSettings, pronunciationSettings, pronunciationSettingsLoaded, onSavePronunciationSettings }: { theme: ThemeMode; effectiveTheme: "light" | "dark"; onThemeChange: (theme: ThemeMode) => void; autoPronounceAfterAnswer: boolean; onAutoPronounceChange: (enabled: boolean) => void; shortcuts: ShortcutBindings; onShortcutChange: (action: ShortcutAction, shortcut: ShortcutBinding) => void; onResetShortcuts: () => void; llmSettings: LlmSettings; llmSettingsLoaded: boolean; onSaveAiSettings: (endpoint: string, model: string, apiKey: string) => Promise<void>; pronunciationSettings: PronunciationSettings; pronunciationSettingsLoaded: boolean; onSavePronunciationSettings: (settings: PronunciationSettings) => Promise<void> }) {
  const [endpoint, setEndpoint] = useState(llmSettings.endpoint);
  const [model, setModel] = useState(llmSettings.model);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(pronunciationSettings.enabled);
  const [ttsModel, setTtsModel] = useState(pronunciationSettings.model);
  const [ttsVoiceId, setTtsVoiceId] = useState(pronunciationSettings.voiceId);
  const [ttsPriority, setTtsPriority] = useState<PronunciationPriority>(pronunciationSettings.priority);
  const [ttsSaving, setTtsSaving] = useState(false);
  const [ttsSaveStatus, setTtsSaveStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function handleSaveAiSettings() {
    setSaving(true);
    setSaveStatus(null);
    try {
      await onSaveAiSettings(endpoint, model, apiKey);
      setApiKey("");
      setSaveStatus({ kind: "success", message: "AI 配置已保存" });
    } catch (error) {
      setSaveStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePronunciationSettings() {
    setTtsSaving(true);
    setTtsSaveStatus(null);
    try {
      await onSavePronunciationSettings({ enabled: ttsEnabled, model: ttsModel, voiceId: ttsVoiceId, priority: ttsPriority });
      setTtsSaveStatus({ kind: "success", message: "AI 发音设置已保存" });
    } catch (error) {
      setTtsSaveStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTtsSaving(false);
    }
  }

  const themeOptions: Array<{ value: ThemeMode; label: string; description: string }> = [
    { value: "system", label: "跟随系统", description: `当前使用${effectiveTheme === "dark" ? "深色" : "浅色"}外观` },
    { value: "light", label: "浅色", description: "始终使用白天模式" },
    { value: "dark", label: "深色", description: "始终使用黑夜模式" },
  ];

  return (
    <div className="settings-page page-stack">
      <section className="page-heading settings-heading">
        <div><p className="eyebrow">软件设置</p><h2>按你的习惯使用简辞</h2></div>
        <p>外观和学习偏好仅保存在本机，不会改动词书或学习进度。</p>
      </section>

      <section className="settings-card">
        <div className="settings-card-heading"><div><p className="eyebrow">外观</p><h3>颜色模式</h3></div><span>可随 macOS 实时切换</span></div>
        <div className="theme-option-grid" aria-label="颜色模式">
          {themeOptions.map((option) => (
            <button type="button" className={theme === option.value ? `theme-option ${option.value} selected` : `theme-option ${option.value}`} aria-pressed={theme === option.value} key={option.value} onClick={() => onThemeChange(option.value)}>
              <span className="theme-option-icon" aria-hidden="true">{option.value === "system" ? <SystemThemeIcon /> : option.value === "light" ? <SunIcon /> : <MoonIcon />}</span>
              <span className="theme-option-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
              <span className="theme-option-state" aria-hidden="true">{theme === option.value ? "✓ 已选择" : ""}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-card setting-row">
        <div><p className="eyebrow">学习</p><h3>答题后自动发音</h3><p>选择“认识”或“不认识”后，按上面的语音优先级自动播放；原有的 macOS 系统语音仍会保留。</p></div>
        <label className="auto-pronounce-toggle setting-switch"><input type="checkbox" checked={autoPronounceAfterAnswer} onChange={(event) => onAutoPronounceChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span><span>{autoPronounceAfterAnswer ? "已开启" : "已关闭"}</span></label>
      </section>

      <section className="settings-card">
        <div className="settings-card-heading"><div><p className="eyebrow">AI 发音</p><h3>MiniMax 语音合成</h3></div><span>{!pronunciationSettingsLoaded ? "正在读取" : ttsEnabled ? "已启用" : "已关闭"}</span></div>
        <p className="settings-card-description">AI 发音与 AI 助教共用同一个接口地址和 macOS 钥匙串里的 API Key。默认使用 MiniMax Speech-2.8-Turbo 与 English_PlayfulGirl，失败时保留现有语音作为兜底。</p>
        <div className="settings-form">
          <label className="settings-input"><span>启用 MiniMax AI 发音</span><span className="auto-pronounce-toggle"><input type="checkbox" checked={ttsEnabled} onChange={(event) => { setTtsEnabled(event.target.checked); setTtsSaveStatus(null); }} disabled={!pronunciationSettingsLoaded} /><span className="toggle-track" aria-hidden="true"><span /></span><span>{ttsEnabled ? "已开启" : "已关闭"}</span></span></label>
          <label className="settings-input"><span>MiniMax 模型 ID</span><input value={ttsModel} onChange={(event) => { setTtsModel(event.target.value); setTtsSaveStatus(null); }} placeholder="minimax-speech-2.8-turbo" disabled={!pronunciationSettingsLoaded} /></label>
          <label className="settings-input"><span>MiniMax 音色 ID</span><input value={ttsVoiceId} onChange={(event) => { setTtsVoiceId(event.target.value); setTtsSaveStatus(null); }} placeholder="English_PlayfulGirl" disabled={!pronunciationSettingsLoaded} /></label>
          <div className="settings-input settings-input-wide"><span>语音优先级</span><div className="settings-priority-grid" role="group" aria-label="语音优先级"><button type="button" className={ttsPriority === "ai-first" ? "selected" : ""} onClick={() => { setTtsPriority("ai-first"); setTtsSaveStatus(null); }}>AI 发音优先<small>MiniMax 失败时使用现有语音</small></button><button type="button" className={ttsPriority === "system-first" ? "selected" : ""} onClick={() => { setTtsPriority("system-first"); setTtsSaveStatus(null); }}>现有语音优先<small>保留当前语音，AI 作为独立配置</small></button></div></div>
        </div>
        <div className="settings-save-row"><p>接口地址和 API Key 请在下面的“AI 助教”配置中填写；TokenDance 等网关会自动使用对应的 MiniMax T2A 路径。</p><div><span className={ttsSaveStatus ? `settings-status ${ttsSaveStatus.kind}` : "settings-status"} role="status" aria-live="polite">{ttsSaveStatus?.message}</span><button type="button" className="primary-button" onClick={() => void handleSavePronunciationSettings()} disabled={ttsSaving || !pronunciationSettingsLoaded}>{ttsSaving ? "正在保存…" : "保存 AI 发音设置"}</button></div></div>
      </section>

      <ShortcutSettings shortcuts={shortcuts} onChange={onShortcutChange} onReset={onResetShortcuts} />

      <section className="settings-card">
        <div className="settings-card-heading"><div><p className="eyebrow">AI 助教</p><h3>模型与接口</h3></div><span>{!llmSettingsLoaded ? "正在读取" : llmSettings.configured ? "已配置" : "尚未配置"}</span></div>
        <div className="settings-form">
          <label className="settings-input"><span>OpenAI 兼容接口</span><input type="url" value={endpoint} onChange={(event) => { setEndpoint(event.target.value); setSaveStatus(null); }} placeholder="https://api.example.com/v1" disabled={!llmSettingsLoaded} /></label>
          <label className="settings-input"><span>模型名称</span><input value={model} onChange={(event) => { setModel(event.target.value); setSaveStatus(null); }} placeholder="gpt-4o-mini" disabled={!llmSettingsLoaded} /></label>
          <label className="settings-input settings-input-wide"><span>API Key</span><input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setSaveStatus(null); }} placeholder={llmSettings.configured ? "留空则保留钥匙串中的原密钥" : "保存到 macOS 钥匙串"} autoComplete="off" disabled={!llmSettingsLoaded} /></label>
        </div>
        <div className="settings-save-row">
          <p>地址必须使用 HTTPS；localhost 可使用 HTTP。密钥不会写入词书或备份。</p>
          <div><span className={saveStatus ? `settings-status ${saveStatus.kind}` : "settings-status"} role="status" aria-live="polite">{saveStatus?.message}</span><button type="button" className="primary-button" onClick={() => void handleSaveAiSettings()} disabled={saving || !llmSettingsLoaded}>{saving ? "正在保存…" : "保存 AI 配置"}</button></div>
        </div>
      </section>
    </div>
  );
}

function ShortcutSettings({ shortcuts, onChange, onReset }: { shortcuts: ShortcutBindings; onChange: (action: ShortcutAction, shortcut: ShortcutBinding) => void; onReset: () => void }) {
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recordingAction) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcutEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecordingAction(null);
        setError(null);
        return;
      }

      const shortcut = normalizeShortcut(event);
      if (!shortcut) {
        setError("请按下一个具体按键，不能只使用修饰键");
        return;
      }
      const conflict = findShortcutConflict(shortcuts, recordingAction, shortcut);
      if (conflict) {
        setError(`“${formatShortcut(shortcut)}”已分配给${shortcutActionLabel(conflict)}`);
        return;
      }
      onChange(recordingAction, shortcut);
      setRecordingAction(null);
      setError(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onChange, recordingAction, shortcuts]);

  function startRecording(action: ShortcutAction) {
    setRecordingAction(action);
    setError(null);
  }

  function cancelRecordingOnBlur(action: ShortcutAction) {
    if (recordingAction === action) {
      setRecordingAction(null);
      setError(null);
    }
  }

  function handleCaptureKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, action: ShortcutAction) {
    if (recordingAction !== action) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function reset() {
    onReset();
    setRecordingAction(null);
    setError(null);
  }

  return (
    <section className="settings-card shortcut-settings">
      <div className="settings-card-heading"><div><p className="eyebrow">学习操作</p><h3>快捷键</h3><p className="settings-card-description">点击按键框后按下新的单键或组合键，修改会立即生效并保存在本机。</p></div><button type="button" className="link-button shortcut-reset" onClick={reset}>恢复默认</button></div>
      <div className="shortcut-list" aria-label="学习快捷键">
        {SHORTCUT_ACTIONS.map(({ action, label, description }) => (
          <div className="shortcut-row" key={action}>
            <div className="shortcut-copy"><strong>{label}</strong><small>{description}</small></div>
            <button type="button" className={recordingAction === action ? "shortcut-capture recording" : "shortcut-capture"} onClick={() => startRecording(action)} onBlur={() => cancelRecordingOnBlur(action)} onKeyDown={(event) => handleCaptureKeyDown(event, action)} aria-label={`设置${label}快捷键`} aria-live="polite">{recordingAction === action ? "请按键…" : formatShortcut(shortcuts[action])}</button>
          </div>
        ))}
      </div>
      {error && <p className="shortcut-error" role="alert">{error}</p>}
    </section>
  );
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了，先好好休息吧";
  if (hour < 11) return "早上好，慢慢开启今天的学习";
  if (hour < 14) return "中午好，记得留一点时间休息";
  if (hour < 19) return "下午好，保持自己的节奏";
  if (hour < 23) return "晚上好，今天也辛苦了";
  return "夜深了，先休息，明天再继续吧";
}

function TodayPage({ snapshot, percent, onStart, onSaveSchedule, onCheckIn }: { snapshot: AppSnapshot; percent: number; onStart: (mode: "learn" | "review", date?: string) => void; onSaveSchedule: (days: ScheduleDayInput[]) => Promise<void>; onCheckIn: (date: string) => Promise<void> }) {
  const [editingPlan, setEditingPlan] = useState(false);
  const [selectedDate, setSelectedDate] = useState(snapshot.today.date);
  const today = snapshot.today;
  const activeDate = selectedDate || today.date;
  const selectedPlan = snapshot.schedule.find((day) => day.date === activeDate);
  const selectedIsToday = activeDate === today.date;
  const selectedIsFuture = activeDate > today.date;
  const selectedStudyChapters = selectedIsToday ? today.studyChapters : selectedPlan?.studyChapters ?? [];
  const selectedReviewChapters = selectedIsToday ? today.reviewChapters : selectedPlan?.reviewChapters ?? [];
  const selectedDateLabel = selectedIsToday ? "今日" : activeDate;
  const calendarDates = buildWeekDates(today.date);
  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">今日计划</p>
            <h2>把今天的章节学完</h2>
          </div>
          <span className="date-mark">{today.date.slice(5).replace("-", " / ")}</span>
        </div>
        <div className="calendar-strip" aria-label="学习日历">
          {calendarDates.map((date) => {
            const record = snapshot.history.find((item) => item.date === date.date);
            const isToday = date.date === today.date;
            return (
              <div className={isToday ? "calendar-day today" : "calendar-day"} key={date.date}>
                <small>{date.weekday}</small>
                <strong>{date.day}</strong>
                <span className={record?.checkedIn ? "calendar-dot done" : "calendar-dot"} />
                <em>{record?.studiedCount ? `${record.studiedCount} 词` : ""}</em>
              </div>
            );
          })}
        </div>
        <div className="hero-footer">
          <div className="hero-progress-summary">
            <span className="eyebrow">{snapshot.currentBook?.name ?? "当前词书"}</span>
            <strong>{today.studiedCount} / {today.targetCount} 个单词</strong>
            <div className="hero-progress-track" aria-label={`今日进度 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>
          </div>
          <div className="hero-actions">
            {today.targetCount > 0 && today.studiedCount >= today.targetCount && !today.checkedIn && <button className="secondary-button" onClick={() => void onCheckIn(today.date)}>今日打卡</button>}
            <button className="primary-button" onClick={() => onStart("learn")}>进入学习 <span>→</span></button>
          </div>
        </div>
      </section>

      <CalendarExplorer snapshot={snapshot} selectedDate={activeDate} onSelectDate={setSelectedDate} onCheckIn={onCheckIn} />

      <div className="two-column-grid">
        <button className="task-card review" onClick={() => onStart("review", activeDate)} disabled={selectedIsFuture || selectedReviewChapters.length === 0}>
          <span className="task-icon">↻</span>
          <div><small>{selectedDateLabel} · 按章节复习</small><strong>{selectedReviewChapters.length ? selectedReviewChapters.join("、") : selectedIsFuture ? "未来计划暂不可开始" : "该日没有安排复习"}</strong></div>
          <span className="arrow">→</span>
        </button>
        <button className="task-card learn" onClick={() => onStart("learn", activeDate)} disabled={selectedIsFuture || selectedStudyChapters.length === 0}>
          <span className="task-icon">＋</span>
          <div><small>{selectedDateLabel} · 学习新词</small><strong>{selectedStudyChapters.length ? selectedStudyChapters.join("、") : selectedIsFuture ? "未来计划暂不可开始" : "该日没有安排新词"}</strong></div>
          <span className="arrow">→</span>
        </button>
      </div>

      <section className="plan-summary">
        <div><p className="eyebrow">章节学习计划</p><strong>每天可安排多个学习章节和复习章节</strong><p>{today.studyChapters.length ? `今天学习 ${today.studyChapters.join("、")}` : "今天暂未安排新词"} · {today.reviewChapters.length ? `复习 ${today.reviewChapters.join("、")}` : "暂无复习章节"}</p></div>
        <button className="secondary-button plan-edit-button" onClick={() => setEditingPlan((value) => !value)}>{editingPlan ? "收起计划" : "编辑章节计划"}</button>
      </section>
      {editingPlan && <ScheduleEditor snapshot={snapshot} onSave={onSaveSchedule} onClose={() => setEditingPlan(false)} />}
    </div>
  );
}

const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

function buildWeekDates(dateKey: string) {
  const safeDateKey = dateKey || new Date().toISOString().slice(0, 10);
  const anchor = new Date(`${safeDateKey}T12:00:00`);
  const mondayOffset = (anchor.getDay() + 6) % 7;
  anchor.setDate(anchor.getDate() - mondayOffset);
  return weekDays.map((weekday, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() + index);
    return { weekday, day: date.getDate(), date: date.toISOString().slice(0, 10) };
  });
}

function buildMonthDates(dateKey: string) {
  const safeDateKey = dateKey || new Date().toISOString().slice(0, 10);
  const first = new Date(`${safeDateKey.slice(0, 7)}-01T12:00:00`);
  const offset = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return { weekday: weekDays[index % 7], day: date.getDate(), date: date.toISOString().slice(0, 10), inMonth: date.getMonth() === new Date(`${safeDateKey}T12:00:00`).getMonth() };
  });
}

function recordFor(snapshot: AppSnapshot, date: string) {
  return snapshot.history.find((item) => item.date === date);
}

function calendarStatus(snapshot: AppSnapshot, date: string) {
  const record = recordFor(snapshot, date);
  if (record?.checkedIn) return "done";
  if (record?.completed) return "completed";
  if (record?.studiedCount) return "progress";
  return date > snapshot.today.date ? "future" : "missed";
}

function CalendarExplorer({ snapshot, selectedDate, onSelectDate, onCheckIn }: { snapshot: AppSnapshot; selectedDate: string; onSelectDate: (date: string) => void; onCheckIn: (date: string) => Promise<void> }) {
  const effectiveToday = snapshot.today.date || new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState<"month" | "week" | "day">("week");
  const activeCursor = selectedDate || effectiveToday;
  const selectedRecord = recordFor(snapshot, activeCursor);
  const isPast = activeCursor < effectiveToday;
  const isToday = activeCursor === effectiveToday;
  const dates = range === "month" ? buildMonthDates(activeCursor) : range === "week" ? buildWeekDates(activeCursor) : buildWeekDates(activeCursor).filter((item) => item.date === activeCursor);
  const cursorDate = new Date(`${activeCursor}T12:00:00`);
  const title = range === "month" ? `${cursorDate.getFullYear()} 年 ${cursorDate.getMonth() + 1} 月` : range === "week" ? `第 ${cursorDate.getMonth() + 1} 月 · 本周` : `${cursorDate.getMonth() + 1} 月 ${cursorDate.getDate()} 日`;
  function move(direction: number) {
    const date = new Date(`${activeCursor}T12:00:00`);
    if (range === "month") date.setMonth(date.getMonth() + direction);
    else if (range === "week") date.setDate(date.getDate() + direction * 7);
    else date.setDate(date.getDate() + direction);
    onSelectDate(date.toISOString().slice(0, 10));
  }
  return (
    <section className="calendar-explorer">
      <div className="calendar-explorer-heading"><div><p className="eyebrow">学习日历</p><h3>{title}</h3></div><div className="calendar-explorer-actions"><div className="calendar-range-switcher" role="tablist" aria-label="日历范围">{(["month", "week", "day"] as const).map((value) => <button key={value} role="tab" aria-selected={range === value} className={range === value ? "selected" : ""} onClick={() => setRange(value)}>{value === "month" ? "月" : value === "week" ? "周" : "日"}</button>)}</div><button className="calendar-nav-button" onClick={() => move(-1)} aria-label="上一个时间段">‹</button><button className="calendar-nav-button" onClick={() => onSelectDate(snapshot.today.date)}>今天</button><button className="calendar-nav-button" onClick={() => move(1)} aria-label="下一个时间段">›</button></div></div>
      {range === "month" && <div className="calendar-month-labels">{weekDays.map((day) => <span key={day}>{day}</span>)}</div>}
      {range !== "day" && <div className={range === "month" ? "calendar-month-grid" : "calendar-explorer-week"}>{dates.map((item) => { const status = calendarStatus(snapshot, item.date); const record = recordFor(snapshot, item.date); return <button type="button" className={`calendar-explorer-day ${status} ${item.date === snapshot.today.date ? "today" : ""} ${item.date === activeCursor ? "selected" : ""} ${"inMonth" in item && !item.inMonth ? "outside" : ""}`} aria-pressed={item.date === activeCursor} key={item.date} onClick={() => onSelectDate(item.date)}><small>{range === "week" ? item.weekday : ""}</small><strong>{item.day}</strong><span>{record?.studiedCount ? `${record.studiedCount} 词` : ""}</span><i /></button>; })}</div>}
      {range === "day" && <DayChart record={recordFor(snapshot, activeCursor)} date={activeCursor} />}
      <div className={`calendar-explorer-footer ${selectedRecord?.checkedIn ? "done" : ""}`}>
        <span>{selectedRecord?.checkedIn ? `${isToday ? "今日" : activeCursor} 已打卡` : selectedRecord?.completed ? `${isToday ? "今日" : activeCursor} 任务已完成` : isToday ? `今日已学 ${selectedRecord?.studiedCount ?? snapshot.today.studiedCount} / ${selectedRecord?.targetCount || snapshot.today.targetCount} 个单词` : isPast ? `${activeCursor} 尚未完成` : `${activeCursor} 尚未开始`}</span>
        <div className="calendar-explorer-day-actions">
          {isPast && selectedRecord?.completed && !selectedRecord.checkedIn && <button className="primary-button" onClick={() => void onCheckIn(activeCursor)}>补上打卡</button>}
          {isToday && selectedRecord?.completed && !selectedRecord.checkedIn && <button className="secondary-button" onClick={() => void onCheckIn(effectiveToday)}>今日打卡</button>}
        </div>
      </div>
    </section>
  );
}

function DayChart({ record, date }: { record?: AppSnapshot["history"][number]; date: string }) {
  const values = record?.hourlyCounts ?? Array.from({ length: 24 }, () => 0);
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => [index / 23 * 100, 88 - value / max * 68] as const);
  const path = smoothChartPath(points);
  return <div className="day-chart-panel"><div className="day-chart-heading"><div><strong>{date === new Date().toISOString().slice(0, 10) ? "今日学习曲线" : `${date} 学习曲线`}</strong><span>{values.reduce((sum, value) => sum + value, 0)} 个单词 · 按完成时间统计</span></div><span className={record?.checkedIn ? "calendar-status-pill done" : "calendar-status-pill"}>{record?.checkedIn ? "已打卡" : record?.completed ? "已完成" : "未完成"}</span></div><div className="day-chart"><svg viewBox="0 0 100 100" role="img" aria-label="按小时统计的学习单词数量"><line x1="0" y1="88" x2="100" y2="88" /><line x1="0" y1="53" x2="100" y2="53" /><line x1="0" y1="18" x2="100" y2="18" /><path d={path} /></svg><div className="day-chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></div></div>;
}

function smoothChartPath(points: ReadonlyArray<readonly [number, number]>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middle = (previous[0] + current[0]) / 2;
    path += ` C ${middle} ${previous[1]}, ${middle} ${current[1]}, ${current[0]} ${current[1]}`;
  }
  return path;
}

function ScheduleEditor({ snapshot, onSave, onClose }: { snapshot: AppSnapshot; onSave: (days: ScheduleDayInput[]) => Promise<void>; onClose: () => void }) {
  const chapters = snapshot.currentBook?.chapters ?? [];
  const initialDays: ScheduleDayInput[] = snapshot.schedule.length
    ? snapshot.schedule.map((day) => ({ dayIndex: day.dayIndex, date: day.date, studyChapters: day.studyChapters, reviewChapters: day.reviewChapters }))
    : chapters.slice(0, 14).map((chapter, index) => ({ dayIndex: index, date: scheduleDate(snapshot.today.date, index), studyChapters: [chapter], reviewChapters: [] }));
  const [days, setDays] = useState<ScheduleDayInput[]>(initialDays);
  const [saving, setSaving] = useState(false);

  function toggleChapter(dayIndex: number, field: "studyChapters" | "reviewChapters", chapter: string) {
    setDays((current) => current.map((day) => {
      if (day.dayIndex !== dayIndex) return day;
      const selected = day[field].includes(chapter);
      return { ...day, [field]: selected ? day[field].filter((value) => value !== chapter) : [...day[field], chapter] };
    }));
  }

  async function commit() {
    setSaving(true);
    try {
      await onSave(days);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="schedule-editor">
      <div className="schedule-editor-heading"><div><p className="eyebrow">按天安排</p><h3>学习与复习章节</h3><p>同一天可以选择多个章节；高亮表示已经选中。</p></div><button className="drawer-close-button" onClick={onClose} aria-label="关闭章节计划">×</button></div>
      <div className="schedule-day-list">
        {days.map((day) => (
          <article className={day.date === snapshot.today.date ? "schedule-day today" : "schedule-day"} key={day.dayIndex}>
            <div className="schedule-day-heading"><strong>第 {day.dayIndex + 1} 天</strong><span>{day.date ?? "待定"}{day.date === snapshot.today.date ? " · 今天" : ""}</span></div>
            <div className="schedule-field"><span>学习新词</span><div className="chapter-chip-list">{chapters.map((chapter) => <button type="button" className={day.studyChapters.includes(chapter) ? "chapter-chip selected" : "chapter-chip"} aria-pressed={day.studyChapters.includes(chapter)} onClick={() => toggleChapter(day.dayIndex, "studyChapters", chapter)} key={`study-${day.dayIndex}-${chapter}`}>{chapter}</button>)}</div></div>
            <div className="schedule-field"><span>复习章节</span><div className="chapter-chip-list">{chapters.map((chapter) => <button type="button" className={day.reviewChapters.includes(chapter) ? "chapter-chip selected" : "chapter-chip"} aria-pressed={day.reviewChapters.includes(chapter)} onClick={() => toggleChapter(day.dayIndex, "reviewChapters", chapter)} key={`review-${day.dayIndex}-${chapter}`}>{chapter}</button>)}</div></div>
          </article>
        ))}
      </div>
      <div className="schedule-editor-actions"><span>计划会保存到本机，不会改变已有学习记录。</span><button className="primary-button" onClick={() => void commit()} disabled={saving}>{saving ? "正在保存" : "保存章节计划"}</button></div>
    </section>
  );
}

function scheduleDate(start: string, offset: number) {
  const date = new Date(`${start}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function BooksPage({ snapshot, onChoose, onRename, onDelete, onImport, onView, onProofread, proofreadBookId, onExport }: { snapshot: AppSnapshot; onChoose: (id: string) => void; onRename: (id: string, name: string, note: string) => void; onDelete: (id: string) => void; onImport: (name: string, note: string, words: ImportWordInput[]) => void; onView: (id: string) => Promise<void>; onProofread: (id: string) => Promise<void>; proofreadBookId: string | null; onExport: () => Promise<void> }) {
  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const words = file.name.toLowerCase().endsWith(".pdf")
      ? (await parsePdfImport(file, 1)).imported.map((word) => ({ legacyId: String(word.id), chapter: word.chapter, word: word.word, phonetic: word.phonetic, part: word.part, meaning: word.meaning, senses: word.senses, example: word.example, tag: word.tag }))
      : parseTxtBook(await file.text());
    if (!words.length) {
      window.alert("没有识别到单词。格式示例：\n[List 01]\nsummary | [ˈsʌməri] | 总结；概要 | n. |");
      return;
    }
    const name = file.name.replace(/\.txt$/i, "").trim() || "导入词书";
    onImport(name, "从本地 TXT 导入", words);
  }

  function handleRename(book: AppSnapshot["books"][number]) {
    const name = window.prompt("词书名称", book.name)?.trim();
    if (!name) return;
    const note = window.prompt("词书备注", book.note) ?? book.note;
    onRename(book.id, name, note);
  }

  function handleDelete(book: AppSnapshot["books"][number]) {
    if (window.confirm(`确定删除“${book.name}”吗？这套词书的学习进度也会删除。`)) onDelete(book.id);
  }

  return (
    <div className="page-stack">
      <section className="page-heading"><p className="eyebrow">本地词书</p><h2>我的词书</h2><p>词书、学习进度与章节计划保存在本机，更新词书不会覆盖已经完成的学习记录。</p></section>
      <div className="book-list">
        {snapshot.books.map((book) => (
          <article className={book.active ? "book-card active" : "book-card"} key={book.id}>
            <div className="book-card-icon">▤</div>
            <div className="book-card-copy"><h3>{book.name}</h3><p>{book.wordCount} 个单词 · {book.chapterCount} 个章节</p><small>{book.masteredCount} 个已掌握</small></div>
            <div className="book-card-actions">{book.active ? <span className="active-label">正在使用</span> : <button onClick={() => onChoose(book.id)}>切换</button>}<button onClick={() => void onView(book.id)}>查看词书</button><button disabled={proofreadBookId !== null} onClick={() => void onProofread(book.id)}>{proofreadBookId === book.id ? "校对中…" : "AI 校对"}</button><button onClick={() => handleRename(book)}>改名</button><button className="danger-button" onClick={() => handleDelete(book)}>删除</button></div>
          </article>
        ))}
      </div>
      <section className="import-card"><div><p className="eyebrow">导入与备份</p><h3>管理本地词书</h3><p>TXT 使用“[List 01]”章节标题，下一行填写“单词 | 音标 | 中文释义 | 词性 | 例句”。导入会创建独立词书，不会覆盖已有进度。</p></div><div className="import-actions"><button className="secondary-button" onClick={() => void onExport()}>导出备份</button><label className="primary-button file-button">导入 TXT / PDF<input type="file" accept=".txt,.pdf,text/plain,application/pdf" onChange={handleImport} /></label></div></section>
    </div>
  );
}

function parseTxtBook(raw: string): ImportWordInput[] {
  let chapter = "未分类";
  const words: ImportWordInput[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^\[([^\]]+)\]$/);
    if (heading) {
      chapter = heading[1].trim();
      continue;
    }
    const columns = line.split("|").map((column) => column.trim());
    if (columns.length < 2) continue;
    const [word, phonetic, meaning, part, example] = columns;
    if (!word || !meaning) continue;
    words.push({ chapter, word, phonetic, meaning, part, example, tag: "自定义" });
  }
  return words;
}

function VocabularyPage({ bookName, words, speakingWordKey, onPronounce, onRemove, onStart }: { bookName: string; words: VocabularyWord[]; speakingWordKey: string | null; onPronounce: (word: VocabularyWord) => void; onRemove: (wordKey: string) => void; onStart: () => void }) {
  const [query, setQuery] = useState("");
  const [chapter, setChapter] = useState("全部章节");
  const chapters = Array.from(new Set(words.map((word) => word.chapter).filter(Boolean)));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleWords = words.filter((word) => {
    const matchesChapter = chapter === "全部章节" || word.chapter === chapter;
    const matchesQuery = !normalizedQuery || [word.word, word.phonetic, word.part, word.meaning, word.definition]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    return matchesChapter && matchesQuery;
  });

  return (
    <div className="vocabulary-page page-stack">
      <section className="page-heading vocabulary-heading">
        <div><p className="eyebrow">当前词书 · {bookName}</p><h2>生词本</h2><p>手动收藏的单词会留在这里，答题不会自动移除。</p></div>
        <div className="vocabulary-heading-action"><strong>{words.length}</strong><span>个生词</span><button className="primary-button" onClick={onStart} disabled={!words.length}>开始复习</button></div>
      </section>
      {!words.length ? (
        <section className="vocabulary-empty">
          <span className="vocabulary-empty-icon"><BookmarkIcon filled={false} /></span>
          <h3>还没有收藏生词</h3>
          <p>在学习卡或当前词书预览中点击书签，即可加入生词本。</p>
          <button className="primary-button" disabled>暂无可复习生词</button>
        </section>
      ) : (
        <>
          <section className="vocabulary-toolbar">
            <label className="vocabulary-search"><span>搜索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="单词、词性或释义" /></label>
            <label><span>章节</span><select value={chapter} onChange={(event) => setChapter(event.target.value)}><option>全部章节</option>{chapters.map((name) => <option key={name}>{name}</option>)}</select></label>
            <span className="vocabulary-result-count">显示 {visibleWords.length} 个</span>
          </section>
          <section className="vocabulary-list" aria-label="生词列表">
            {visibleWords.map((word) => (
              <article className="vocabulary-card" key={word.key}>
                <div className="vocabulary-word-main"><div className="vocabulary-word-title"><h3>{word.word}</h3><button type="button" className={`pronounce-button ${speakingWordKey === word.key ? "is-speaking" : ""}`} aria-label={`播放 ${word.word} 的发音`} onClick={() => onPronounce(word)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l4 3V7l-4 3H4Z" /><path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" /></svg></button></div><p className="phonetic-small">{word.phonetic || "暂无音标"}</p></div>
                <div className="vocabulary-meaning"><div className="meaning-list">{studySenses(word).map((sense, index) => <div className="meaning-line" key={`${word.key}-${sense.part}-${index}`}><b>{sense.part}</b><strong>{sense.meaning}</strong></div>)}</div></div>
                <div className="vocabulary-meta"><span>{word.chapter || "未分类"}</span><small>{formatAddedAt(word.addedAt)}加入</small></div>
                <button className="vocabulary-remove" type="button" onClick={() => onRemove(word.key)}><BookmarkIcon filled />移除</button>
              </article>
            ))}
            {!visibleWords.length && <div className="vocabulary-filter-empty">没有匹配的生词，试试其他关键词或章节。</div>}
          </section>
        </>
      )}
    </div>
  );
}

function formatAddedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return <svg className="bookmark-icon" viewBox="0 0 24 24" aria-hidden="true"><path className={filled ? "bookmark-fill" : undefined} d="M6 3.8A1.8 1.8 0 0 1 7.8 2h8.4A1.8 1.8 0 0 1 18 3.8V22l-6-3.9L6 22V3.8Z" /></svg>;
}

function BookPreview({ book, words, savedKeys, onToggleSaved, onClose }: { book: AppSnapshot["books"][number]; words: BookWord[]; savedKeys: Set<string>; onToggleSaved: (wordKey: string, saved: boolean) => void; onClose: () => void }) {
  const [chapter, setChapter] = useState("全部章节");
  const visibleWords = chapter === "全部章节" ? words : words.filter((word) => word.chapter === chapter);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="book-preview-modal" role="dialog" aria-modal="true" aria-label={`${book.name}词书内容`}>
        <div className="drawer-heading"><div><p className="eyebrow">词书内容</p><h2>{book.name}</h2><p className="modal-subtitle">{book.wordCount} 个单词 · {book.chapterCount} 个章节 · 已掌握 {book.masteredCount} 个</p></div><button onClick={onClose} aria-label="关闭词书预览">×</button></div>
        <div className="book-preview-toolbar"><label>查看章节<select value={chapter} onChange={(event) => setChapter(event.target.value)}><option>全部章节</option>{book.chapters.map((name) => <option key={name}>{name}</option>)}</select></label><span>{visibleWords.length} 个词条</span></div>
        <div className={book.active ? "book-word-table has-vocabulary-actions" : "book-word-table"} role="table">
          <div className="book-word-row book-word-header" role="row"><span>单词</span><span>音标</span><span>词性</span><span>中文释义</span>{book.active && <span>收藏</span>}</div>
          {visibleWords.map((word) => <div className="book-word-row" role="row" key={word.key}><strong>{word.word}</strong><span className="phonetic-small">{word.phonetic || "—"}</span><span>{word.part || "—"}</span><span>{word.meaning || word.definition || "—"}</span>{book.active && <button type="button" className={savedKeys.has(word.key) ? "bookmark-button saved" : "bookmark-button"} aria-label={savedKeys.has(word.key) ? `从生词本移除 ${word.word}` : `将 ${word.word} 加入生词本`} title={savedKeys.has(word.key) ? "移除生词" : "收藏生词"} onClick={() => onToggleSaved(word.key, !savedKeys.has(word.key))}><BookmarkIcon filled={savedKeys.has(word.key)} /></button>}</div>)}
        </div>
      </section>
    </div>
  );
}

function ProofreadDialog({ state, progress, collapsed, windowSize, onToggleCollapsed, onToggleSize, onRetry, onClose, onApply }: { state: ProofreadState; progress: ProofreadProgress | null; collapsed: boolean; windowSize: "compact" | "large"; onToggleCollapsed: () => void; onToggleSize: () => void; onRetry: () => void; onClose: () => void; onApply: (changes: ProofreadIssue[]) => void }) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(state.issues.map((issue) => issue.key)));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!state.loading) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.loading]);

  const selectedIssues = state.issues.filter((issue) => selectedKeys.has(issue.key));
  const allSelected = state.issues.length > 0 && selectedIssues.length === state.issues.length;
  const currentProgress = progress?.bookId === state.book.id ? progress : null;
  const total = currentProgress?.total ?? state.book.wordCount;
  const completed = Math.min(currentProgress?.completed ?? 0, total);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  function toggleIssue(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className={`proofread-window ${windowSize} ${collapsed ? "collapsed" : ""}`} role="dialog" aria-label="AI 词书校对">
        <div className="drawer-heading"><div><p className="eyebrow">AI 词书校对</p><h2>{state.book.name}</h2><p className="modal-subtitle">{state.loading ? `后台逐批检查 · ${completed} / ${total}` : state.error ? "校对中断，词书未修改" : `校对完成 · 发现 ${state.issues.length} 项`}</p></div><div className="proofread-heading-actions"><button type="button" onClick={onToggleSize} aria-label="切换校对窗口大小">{windowSize === "compact" ? "放大" : "缩小"}</button><button type="button" onClick={onToggleCollapsed}>{collapsed ? "展开" : "收起"}</button>{!state.loading && <button type="button" onClick={onClose} aria-label="关闭 AI 词书校对">×</button>}</div></div>
        {!collapsed && (state.error ? (
          <div className="proofread-empty" role="alert"><strong>校对没有完成</strong><p className="proofread-error-message">{state.error}</p><p>已检查 {completed} / {total} 个词条。已完成的批次会保留，当前词书没有被修改。</p><button className="secondary-button" type="button" onClick={onRetry}>{completed > 0 ? "从断点继续" : "重新校对"}</button></div>
        ) : state.loading ? (
          <div className="proofread-loading" role="status"><div className="proofread-spinner" aria-hidden="true" /><strong>{completed > 0 ? "正在从断点继续校对" : `正在逐批检查 ${total} 个词条…`}</strong><p>已检查 {completed} / {total} 个词条 · 发现 {currentProgress?.issuesFound ?? 0} 项 · {percent}%</p><div className="proofread-progress-bar" aria-label={`校对进度 ${percent}%`}><span style={{ width: `${percent}%` }} /></div><p>已开始请求 AI · 已用时 {elapsedSeconds} 秒</p><p>每批完成后会保存断点；网络波动或 AI 返回异常时最多自动尝试 3 次，失败后可手动从断点继续。词书完成后只显示建议，不会自动修改。</p></div>
        ) : state.issues.length === 0 ? (
          <div className="proofread-empty"><strong>没有发现足够明确的问题</strong><p>AI 没有找到可以确信需要修改的拼写、词性或词义错误。词书未发生改变。</p></div>
        ) : (
          <>
            <div className="proofread-toolbar"><label><input type="checkbox" checked={allSelected} onChange={() => setSelectedKeys(allSelected ? new Set() : new Set(state.issues.map((issue) => issue.key)))} /> 全选</label><span>发现 {state.issues.length} 项 · 已选择 {selectedIssues.length} 项</span></div>
            <div className="proofread-list">
              {state.issues.map((issue) => (
                <article className={selectedKeys.has(issue.key) ? "proofread-issue selected" : "proofread-issue"} key={issue.key}>
                  <label className="proofread-issue-check"><input type="checkbox" checked={selectedKeys.has(issue.key)} onChange={() => toggleIssue(issue.key)} /><span /></label>
                  <div className="proofread-issue-content">
                    <div className="proofread-issue-heading"><strong>{issue.originalWord}</strong><span>{issue.category}</span><small>{issue.reason}</small></div>
                    <div className="proofread-diff-grid">
                      {issue.originalWord !== issue.correctedWord && <div><small>单词</small><del>{issue.originalWord || "—"}</del><b>→ {issue.correctedWord}</b></div>}
                      {issue.originalPart !== issue.correctedPart && <div><small>词性</small><del>{issue.originalPart || "—"}</del><b>→ {issue.correctedPart || "—"}</b></div>}
                      {issue.originalMeaning !== issue.correctedMeaning && <div><small>词义</small><del>{issue.originalMeaning || "—"}</del><b>→ {issue.correctedMeaning || "—"}</b></div>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ))}
        {!collapsed && <div className="proofread-footer"><span>{state.loading ? "词书尚未修改" : state.error ? "词书尚未修改" : "只会应用勾选项目，原学习进度和单词标识会保留。"}</span><div>{!state.loading && <button className="secondary-button" onClick={onClose}>关闭</button>}{!state.loading && state.issues.length > 0 && <button className="primary-button" onClick={() => onApply(selectedIssues)} disabled={!selectedIssues.length}>确认应用所选修正</button>}</div></div>}
    </section>
  );
}

function StudyPage({ session, snapshot, percent, revealed, onAnswer, onNext, onUndo, onBack, onAi, autoPronounceAfterAnswer, onAutoPronounceChange, speakingWordKey, pronunciationStatus, onPronounce, shortcuts, saved, onToggleSaved }: { session: StudySessionSnapshot | null; snapshot: AppSnapshot; percent: number; revealed: boolean; onAnswer: (known: boolean) => void; onNext: () => void; onUndo: () => void; onBack: () => void; onAi: () => void; autoPronounceAfterAnswer: boolean; onAutoPronounceChange: (enabled: boolean) => void; speakingWordKey: string | null; pronunciationStatus: { wordKey: string; kind: "fallback"; message: string } | null; onPronounce: (word: StudyWord) => void; shortcuts: ShortcutBindings; saved: boolean; onToggleSaved: (wordKey: string, saved: boolean) => void }) {
  const word = session?.current;
  const vocabularyMode = session?.mode === "vocabulary";
  const sessionDate = vocabularyMode ? "生词本" : session?.date && snapshot.today.date ? taskDateLabel(session.date, snapshot.today.date) : "今日计划";

  return (
    <div className="study-page">
      <div className="study-heading"><div><p className="eyebrow">{sessionDate} · {vocabularyMode ? "专项复习" : session?.mode === "review" ? "复习" : "学习"} · {word?.chapter ?? "按章节"}</p><h2>{vocabularyMode ? "复习生词" : session?.mode === "review" ? "复习旧词" : "学习新词"}</h2></div><div className="study-heading-actions"><span>{session?.remainingCount ?? 0} 个待完成</span><label className="auto-pronounce-toggle" title="确认认识或不认识后自动播放当前单词"><input type="checkbox" checked={autoPronounceAfterAnswer} onChange={(event) => onAutoPronounceChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span><span>答题后发音</span></label><button className="secondary-button" onClick={onBack}>{vocabularyMode ? "退出复习" : "退出学习"}</button></div></div>
      <article className={revealed ? "study-card revealed" : "study-card"}>
        <div className="study-card-top"><span className="tag">{word?.tag || "TOEFL"}</span><div className="study-card-tools">{word && <button type="button" className={saved ? "bookmark-button saved" : "bookmark-button"} aria-label={saved ? `从生词本移除 ${word.word}` : `将 ${word.word} 加入生词本`} title={saved ? "移除生词" : "收藏生词"} onClick={() => onToggleSaved(word.key, !saved)}><BookmarkIcon filled={saved} /></button>}<button className="ai-trigger" onClick={onAi}>问问 AI</button></div></div>
      {word ? <div className="word-center"><h2>{word.word}</h2><div className="phonetic-row"><p className="phonetic">{word.phonetic}</p><button type="button" className={`pronounce-button ${speakingWordKey === word.key ? "is-speaking" : ""}`} aria-label={`播放 ${word.word} 的发音`} title="按设置中的语音优先级播放；AI 失败时回退到现有语音" onClick={() => onPronounce(word)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l4 3V7l-4 3H4Z" /><path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" /></svg></button></div>{pronunciationStatus?.wordKey === word.key && <p className={`pronunciation-status ${pronunciationStatus.kind}`} role="status" aria-live="polite">{pronunciationStatus.message}</p>}{revealed ? <div className="meaning-list" aria-label="词性和释义">{studySenses(word).map((sense, index) => <div className="meaning-line" key={`${sense.part}-${index}`}><b>{sense.part}</b><strong>{sense.meaning}</strong></div>)}</div> : <p className="hint">先回想它的意思，再选择你的答案</p>}</div> : <div className="word-center empty-state"><h2>今天完成了</h2><p className="meaning">这一章节的任务已完成</p></div>}
        {word && (!revealed ? <div className="answer-grid"><button className="answer unknown" onClick={() => onAnswer(false)}><strong>不认识</strong><small>查看释义，并放到队尾复习</small></button><button className="answer known" onClick={() => onAnswer(true)}><strong>认识</strong><small>查看释义，并继续下一个</small></button></div> : <div className="revealed-actions"><span className="answer-status">{session?.answer === "unknown" ? `✓ 已加入${vocabularyMode ? "本轮" : "本章"}队尾` : `✓ 已记录${vocabularyMode ? "单词掌握状态" : "本章学习进度"}`}</span><div className="revealed-action-buttons"><button className="secondary-button undo-button" onClick={onUndo}>撤销选择 <kbd>{formatShortcut(shortcuts.undo)}</kbd></button><button className="primary-button next-button" onClick={onNext}>下一个单词 <kbd>{formatShortcut(shortcuts.advance)}</kbd> <span>→</span></button></div></div>)}
      </article>
      <p className="keyboard-hint">使用键盘 <kbd>{formatShortcut(shortcuts.answerUnknown)}</kbd> 不认识 · <kbd>{formatShortcut(shortcuts.answerKnown)}</kbd> 认识 · <kbd>{formatShortcut(shortcuts.advance)}</kbd> 下一个 · <kbd>{formatShortcut(shortcuts.undo)}</kbd> 撤销 · <kbd>{formatShortcut(shortcuts.pronounce)}</kbd> 发音 · <kbd>{formatShortcut(shortcuts.openAi)}</kbd> 打开 AI</p>
      {vocabularyMode ? <section className="progress-panel study-lower-panel vocabulary-round-progress">
        <div className="section-heading"><div><p className="eyebrow">本轮进度</p><h2>{snapshot.currentBook?.name ?? "当前词书"}</h2></div><span className="progress-percent">{session?.knownCount ?? 0} 个认识</span></div>
        <div className="progress-foot"><span>不认识的单词会移到队尾，直到答对</span><span>{session?.remainingCount ?? 0} 个待完成</span></div>
      </section> : <section className="progress-panel study-lower-panel">
        <div className="section-heading"><div><p className="eyebrow">今日进度</p><h2>{snapshot.currentBook?.name ?? "当前词书"}</h2></div><span className="progress-percent">{percent}%</span></div>
        <div className="progress-bar"><span style={{ width: `${percent}%` }} /></div>
        <div className="progress-foot"><span>{snapshot.today.studiedCount} / {snapshot.today.targetCount} 个今日计划单词</span><span>{Math.max(0, snapshot.today.targetCount - snapshot.today.studiedCount)} 个待完成</span></div>
      </section>}
      <section className="wordbook-summary"><div><p className="eyebrow">我的词书</p><h3>{snapshot.currentBook?.name ?? "当前词书"}</h3><p>{snapshot.currentBook?.wordCount ?? 0} 个单词 · {snapshot.currentBook?.chapterCount ?? 0} 个章节 · 已掌握 {snapshot.currentBook?.masteredCount ?? 0} 个</p></div><button className="secondary-button">查看词书</button></section>
    </div>
  );
}

function taskDateLabel(date: string, today: string) {
  if (date === today) return "今日计划";
  if (date < today) return "补做任务";
  return "今日计划";
}

function AiDrawer({ word, answer, settings, messages, onMessagesChange, onSaveSettings, onClose }: { word: StudySessionSnapshot["current"]; answer: StudySessionSnapshot["answer"]; settings: LlmSettings; messages: LlmMessage[]; onMessagesChange: (messages: LlmMessage[]) => void; onSaveSettings: (endpoint: string, model: string, apiKey: string) => Promise<void>; onClose: () => void }) {
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(!settings.configured);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const questionInputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    if (settingsOpen) return undefined;
    const frame = window.requestAnimationFrame(() => questionInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [settingsOpen]);

  useEffect(() => {
    if (settingsOpen) return;
    const frame = window.requestAnimationFrame(() => {
      conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, settingsOpen, thinking]);

  async function saveSettings() {
    try {
      await onSaveSettings(endpoint, model, apiKey);
      setApiKey("");
      setSettingsOpen(false);
    } catch (error) {
      onMessagesChange([...messages, { role: "assistant", content: error instanceof Error ? error.message : String(error) }]);
    }
  }

  async function send(rawQuestion: string) {
    const content = rawQuestion.trim();
    if (!content || !word || thinking) return;
    const nextMessages: LlmMessage[] = [...messages, { role: "user", content }];
    onMessagesChange(nextMessages);
    setQuestion("");
    setThinking(true);
    try {
      // Let the pending state paint before starting the native LLM request.
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const reply = await askLlm(word, answer, nextMessages);
      onMessagesChange([...nextMessages, { role: "assistant", content: reply.trim() }]);
    } catch (error) {
      onMessagesChange([...nextMessages, { role: "assistant", content: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <aside className="ai-drawer">
      <div className="drawer-heading">
        <div><h2>AI英語先生</h2></div>
        <button onClick={onClose} aria-label="关闭 AI 面板">×</button>
      </div>
      <div className="ai-word-context"><strong>{word?.word ?? "当前单词"}</strong><span>{word?.part} · {word?.meaning}</span></div>
      {settingsOpen ? (
        <div className="ai-settings-form">
          <p className="eyebrow">首次使用先配置</p>
          <label>OpenAI 兼容接口<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://api.example.com/v1" /></label>
          <label>模型名称<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4o-mini" /></label>
          <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="保存到 macOS 钥匙串" /></label>
          <button className="primary-button" onClick={() => void saveSettings()}>保存配置</button>
          <small>地址必须使用 HTTPS；localhost 可使用 HTTP。密钥不会写入词书或备份。</small>
        </div>
      ) : (
        <>
          <div className="ai-conversation">
            <div className="ai-message assistant"><AiMessageContent content="你可以问我这个词的用法、近义词，或让它出一道小测验。" /></div>
            <div className="ai-thread" aria-live="polite">
              {messages.map((message, index) => <div className={message.role === "user" ? "ai-message user" : "ai-message assistant"} key={message.role + "-" + index}><AiMessageContent content={message.content} /></div>)}
              {thinking && <div className="ai-message assistant ai-thinking" role="status"><AiMessageContent content="思考中…" /></div>}
            </div>
            <div className="ai-conversation-end" ref={conversationEndRef} aria-hidden="true" />
          </div>
          <div className="ai-suggestion-list" aria-label="快捷提问">
            {AI_SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion.label} title={suggestion.prompt} onClick={() => void send(suggestion.prompt)} disabled={thinking || !word}>{suggestion.label}</button>)}
          </div>
          <div className="ai-input-row">
            <input
              ref={questionInputRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onKeyDown={(event) => {
                if (!shouldSubmitAiQuestion(event.nativeEvent, composingRef.current)) return;
                event.preventDefault();
                void send(question);
              }}
              placeholder="问问这个词……"
            />
            <button onClick={() => void send(question)} disabled={thinking}>发送</button>
          </div>
          <div className="ai-drawer-footer"><small>API 密钥由 macOS 钥匙串保护。</small><button className="link-button" onClick={() => setSettingsOpen(true)}>修改配置</button></div>
        </>
      )}
    </aside>
  );
}

function AiMessageContent({ content }: { content: string }) {
  return <div className="ai-message-content">{content.split(/\r?\n/).map((line, index) => {
    const text = line.trim();
    if (!text) return <span className="ai-markdown-gap" aria-hidden="true" key={`gap-${index}`} />;

    const heading = text.match(/^#{1,3}\s+(.+)$/);
    if (heading) return <p className="ai-markdown-heading" key={`heading-${index}`}>{renderInlineAiMarkdown(heading[1])}</p>;

    const bullet = text.match(/^[-*•]\s+(.+)$/);
    if (bullet) return <p className="ai-markdown-list" key={`bullet-${index}`}><span>•</span><span>{renderInlineAiMarkdown(bullet[1])}</span></p>;

    const numbered = text.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) return <p className="ai-markdown-list" key={`numbered-${index}`}><span>{numbered[1]}.</span><span>{renderInlineAiMarkdown(numbered[2])}</span></p>;

    return <p key={`paragraph-${index}`}>{renderInlineAiMarkdown(text)}</p>;
  })}</div>;
}

function renderInlineAiMarkdown(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g).filter(Boolean).map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={`strong-${index}`}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={`code-${index}`}>{token.slice(1, -1)}</code>;
    }
    if (token.startsWith("*") && token.endsWith("*")) {
      return <em key={`em-${index}`}>{token.slice(1, -1)}</em>;
    }
    return token;
  });
}
