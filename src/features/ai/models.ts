import type { AiModel, AiProvider } from "./types";

export const AI_MODELS: Record<AiProvider, AiModel[]> = {
  openai: [
    { id: "gpt-4o", label: "GPT-4o", recommended: true },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
  ],
  google: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", recommended: true },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", recommended: true },
    { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
  ],
};

export function defaultModelFor(provider: AiProvider): string {
  return AI_MODELS[provider].find((m) => m.recommended)?.id ?? AI_MODELS[provider][0].id;
}

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  google: "Google",
  anthropic: "Anthropic",
};
