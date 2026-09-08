import type { ContentBlock } from "@aws-sdk/client-bedrock-runtime";

export class BedrockStructuredOutputError extends Error {
  constructor(
    message: string,
    readonly stopReason?: string,
  ) {
    super(stopReason ? `${message} (arresto modello: ${stopReason})` : message);
    this.name = "BedrockStructuredOutputError";
  }
}

function parseJsonText(value: string) {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return undefined;
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
    } catch {
      return undefined;
    }
  }
}

export function extractBedrockStructuredOutput(
  content: ContentBlock[] | undefined,
  options: { toolName?: string; label: string; stopReason?: string },
) {
  const toolUse = content
    ?.filter((block) => "toolUse" in block)
    .map((block) => block.toolUse)
    .find((tool) => tool?.input && (!options.toolName || tool.name === options.toolName));
  if (toolUse?.input) return toolUse.input;

  const text = content
    ?.filter((block) => "text" in block && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
  const parsedText = text ? parseJsonText(text) : undefined;
  if (parsedText !== undefined) return parsedText;

  throw new BedrockStructuredOutputError(
    `Bedrock non ha restituito ${options.label} in formato strutturato`,
    options.stopReason,
  );
}
