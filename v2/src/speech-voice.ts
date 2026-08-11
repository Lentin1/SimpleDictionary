export type SpeechVoiceLike = {
  name: string;
  lang: string;
};

export function selectPronunciationVoice<T extends SpeechVoiceLike>(voices: readonly T[]): T | undefined {
  return voices.find((voice) => voice.name.trim().toLowerCase().includes("samantha"))
    ?? voices.find((voice) => /^en-US$/i.test(voice.lang))
    ?? voices.find((voice) => /^en\b/i.test(voice.lang));
}
