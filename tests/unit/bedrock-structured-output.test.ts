import type { ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, test } from "vitest";
import {
  BedrockStructuredOutputError,
  extractBedrockStructuredOutput,
} from "../../lib/platform/bedrock-structured-output";

describe("Bedrock structured output", () => {
  test("reads the requested tool input", () => {
    const content = [
      {
        toolUse: {
          toolUseId: "tool-1",
          name: "emit_travel_programme",
          input: { title: "Uzbekistan" },
        },
      },
    ] satisfies ContentBlock[];

    expect(
      extractBedrockStructuredOutput(content, {
        toolName: "emit_travel_programme",
        label: "il programma",
      }),
    ).toEqual({ title: "Uzbekistan" });
  });

  test("accepts a JSON text response as a zero-cost fallback", () => {
    const content = [{ text: '```json\n{"title":"Uzbekistan"}\n```' }] satisfies ContentBlock[];

    expect(extractBedrockStructuredOutput(content, { label: "il programma" })).toEqual({ title: "Uzbekistan" });
  });

  test("reports the model stop reason without exposing response content", () => {
    expect(() =>
      extractBedrockStructuredOutput([], {
        toolName: "emit_travel_programme",
        label: "il programma",
        stopReason: "max_tokens",
      }),
    ).toThrowError(
      new BedrockStructuredOutputError("Bedrock non ha restituito il programma in formato strutturato", "max_tokens"),
    );
  });
});
