export type Lab = "anthropic" | "openai" | "google" | "meta" | "xai" | "mistral" | "unknown";

export interface LabStyle {
  /** Short name shown in the UI, e.g. "Claude" rather than the lab name "anthropic". */
  label: string;
  color: string;
}

export const LAB_STYLES: Record<Lab, LabStyle> = {
  anthropic: { label: "Claude", color: "#D97757" },
  openai: { label: "OpenAI", color: "#10A37F" },
  google: { label: "Gemini", color: "#4285F4" },
  meta: { label: "Llama", color: "#0668E1" },
  xai: { label: "Grok", color: "#1D1D1F" },
  mistral: { label: "Mistral", color: "#FA520F" },
  unknown: { label: "Agent", color: "#8B8B8B" },
};

export function isLab(value: string): value is Lab {
  return value in LAB_STYLES;
}
