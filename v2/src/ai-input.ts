export type AiInputKey = {
  key: string;
  isComposing: boolean;
  keyCode: number;
};

export function shouldSubmitAiQuestion(event: AiInputKey, compositionActive: boolean) {
  return event.key === "Enter" && !compositionActive && !event.isComposing && event.keyCode !== 229;
}
