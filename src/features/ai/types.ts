export type AiProvider = "openai" | "anthropic" | "google";

export type AiModel = {
  id: string;
  label: string;
  recommended?: boolean;
};

export type AiSettings = {
  provider: AiProvider;
  apiKeys: Record<AiProvider, string>;
  commitMessageModel: string;
  commitMessageCustomInstructions: string;
};
