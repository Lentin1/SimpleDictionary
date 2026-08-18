export type ShortcutAction = "answerUnknown" | "answerKnown" | "advance" | "undo" | "pronounce" | "openAi";

export type ShortcutBinding = {
  key: string;
  code: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};

export type ShortcutBindings = Record<ShortcutAction, ShortcutBinding>;

export type ShortcutEventLike = {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export const SHORTCUT_STORAGE_KEY = "jian-ci-shortcuts-v1";

export const SHORTCUT_ACTIONS: ReadonlyArray<{ action: ShortcutAction; label: string; description: string }> = [
  { action: "answerUnknown", label: "不认识", description: "查看释义并放到队尾" },
  { action: "answerKnown", label: "认识", description: "查看释义并记录进度" },
  { action: "advance", label: "查看释义 / 下一个", description: "揭示答案或进入下一个单词" },
  { action: "undo", label: "撤销选择", description: "撤销最近一次答题" },
  { action: "pronounce", label: "播放发音", description: "播放当前单词的系统发音" },
  { action: "openAi", label: "打开 AI", description: "打开当前单词的 AI 助教" },
];

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  answerUnknown: { key: "ArrowLeft", code: "ArrowLeft", meta: false, ctrl: false, alt: false, shift: false },
  answerKnown: { key: "ArrowRight", code: "ArrowRight", meta: false, ctrl: false, alt: false, shift: false },
  advance: { key: "Space", code: "Space", meta: false, ctrl: false, alt: false, shift: false },
  undo: { key: "Z", code: "KeyZ", meta: false, ctrl: false, alt: false, shift: false },
  pronounce: { key: "P", code: "KeyP", meta: false, ctrl: false, alt: false, shift: false },
  openAi: { key: "A", code: "KeyA", meta: false, ctrl: false, alt: false, shift: false },
};

const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "OS", "Shift"]);

function cloneDefaults(): ShortcutBindings {
  return Object.fromEntries(Object.entries(DEFAULT_SHORTCUTS).map(([action, binding]) => [action, { ...binding }])) as ShortcutBindings;
}

export function defaultShortcutBindings() {
  return cloneDefaults();
}

function codeForKey(key: string) {
  if (key === "Space") return "Space";
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}

export function normalizeKey(key: string, code = "") {
  if (key === " " || key === "Spacebar" || code === "Space") return "Space";
  if (key === "Esc") return "Escape";
  if (MODIFIER_KEYS.has(key)) return key;
  if (/^Arrow(?:Left|Right|Up|Down)$/.test(key)) return key;
  if (key.length === 1) return key.toUpperCase();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return key;
}

export function normalizeShortcut(event: ShortcutEventLike): ShortcutBinding | null {
  const key = normalizeKey(event.key, event.code);
  if (!key || MODIFIER_KEYS.has(event.key) || MODIFIER_KEYS.has(key)) return null;
  return {
    key,
    code: event.code || codeForKey(key),
    meta: Boolean(event.metaKey),
    ctrl: Boolean(event.ctrlKey),
    alt: Boolean(event.altKey),
    shift: Boolean(event.shiftKey),
  };
}

export function isValidShortcut(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<ShortcutBinding>;
  return typeof binding.key === "string"
    && binding.key.length > 0
    && !MODIFIER_KEYS.has(binding.key)
    && typeof binding.code === "string"
    && binding.code.length > 0
    && typeof binding.meta === "boolean"
    && typeof binding.ctrl === "boolean"
    && typeof binding.alt === "boolean"
    && typeof binding.shift === "boolean";
}

export function parseShortcutBindings(raw: string | null | undefined): ShortcutBindings {
  if (!raw) return cloneDefaults();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) return cloneDefaults();
    const values = (parsed as { shortcuts?: unknown }).shortcuts;
    if (!values || typeof values !== "object") return cloneDefaults();
    const candidate = values as Partial<ShortcutBindings>;
    if (!SHORTCUT_ACTIONS.every(({ action }) => isValidShortcut(candidate[action]))) return cloneDefaults();
    const shortcuts = Object.fromEntries(SHORTCUT_ACTIONS.map(({ action }) => [action, { ...(candidate[action] as ShortcutBinding) }])) as ShortcutBindings;
    if (SHORTCUT_ACTIONS.some(({ action }) => findShortcutConflict(shortcuts, action, shortcuts[action]))) return cloneDefaults();
    return shortcuts;
  } catch {
    return cloneDefaults();
  }
}

export function serializeShortcutBindings(shortcuts: ShortcutBindings) {
  return JSON.stringify({ version: 1, shortcuts });
}

export function loadShortcutBindings() {
  try {
    return parseShortcutBindings(window.localStorage.getItem(SHORTCUT_STORAGE_KEY));
  } catch {
    return cloneDefaults();
  }
}

export function saveShortcutBindings(shortcuts: ShortcutBindings) {
  try {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, serializeShortcutBindings(shortcuts));
  } catch {
    // Shortcut preferences are optional; learning data is stored by the desktop backend.
  }
}

export function matchesShortcut(event: ShortcutEventLike, shortcut: ShortcutBinding) {
  const eventKey = normalizeKey(event.key, event.code);
  const sameKey = shortcut.code && event.code ? shortcut.code === event.code : shortcut.key === eventKey;
  return sameKey
    && Boolean(event.metaKey) === shortcut.meta
    && Boolean(event.ctrlKey) === shortcut.ctrl
    && Boolean(event.altKey) === shortcut.alt
    && Boolean(event.shiftKey) === shortcut.shift;
}

export function findShortcutConflict(shortcuts: ShortcutBindings, action: ShortcutAction, candidate: ShortcutBinding) {
  return SHORTCUT_ACTIONS.find(({ action: otherAction }) => otherAction !== action && matchesShortcut(candidate, shortcuts[otherAction]))?.action ?? null;
}

export function shortcutActionLabel(action: ShortcutAction) {
  return SHORTCUT_ACTIONS.find((item) => item.action === action)?.label ?? action;
}

export function formatShortcut(shortcut: ShortcutBinding) {
  const modifiers = [
    shortcut.meta ? "⌘" : "",
    shortcut.ctrl ? "⌃" : "",
    shortcut.alt ? "⌥" : "",
    shortcut.shift ? "⇧" : "",
  ].filter(Boolean);
  const keyLabels: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Escape: "Esc",
    Enter: "↵",
    Tab: "Tab",
    Backspace: "⌫",
    Delete: "⌫",
    Space: "Space",
  };
  return [...modifiers, keyLabels[shortcut.key] ?? shortcut.key].join(" ");
}

export function isEditableTarget(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function shouldIgnoreShortcutEvent(event: ShortcutEventLike & { target?: EventTarget | null; isComposing?: boolean; keyCode?: number }) {
  return Boolean(event.isComposing) || event.keyCode === 229 || isEditableTarget(event.target ?? null);
}

export function findMatchingShortcut(event: ShortcutEventLike, shortcuts: ShortcutBindings) {
  return SHORTCUT_ACTIONS.find(({ action }) => matchesShortcut(event, shortcuts[action]))?.action ?? null;
}
