import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const region = process.env.AWS_BEDROCK_GROUNDING_REGION || "us-east-1";
const modelId = process.env.AWS_BEDROCK_GROUNDING_MODEL || "us.amazon.nova-2-lite-v1:0";
const response = await new BedrockRuntimeClient({ region, maxAttempts: 3 }).send(
  new ConverseCommand({
    modelId,
    system: [{ text: "Usa esclusivamente fonti ufficiali e restituisci una risposta molto breve con citazioni." }],
    messages: [
      { role: "user", content: [{ text: "Qual è il numero unico europeo di emergenza? Verifica su europa.eu." }] },
    ],
    toolConfig: { tools: [{ systemTool: { name: "nova_grounding" } }] },
    inferenceConfig: { maxTokens: 180, temperature: 0 },
  }),
);
const content = response.output?.message?.content || [];
const urls = content.flatMap((block) =>
  "citationsContent" in block
    ? (block.citationsContent?.citations || []).map((citation) => citation.location?.web?.url).filter(Boolean)
    : [],
);
if (!content.some((block) => "text" in block && block.text) || urls.length === 0)
  throw new Error("Grounding privo di risposta o citazioni");
const allowed = urls.filter((url) => {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname.endsWith("europa.eu") || hostname.split(".").includes("gov");
});
if (allowed.length === 0) throw new Error(`Grounding privo di fonti ufficiali: ${urls.join(", ")}`);
console.log(
  JSON.stringify({
    status: "passed",
    region,
    modelId,
    citations: urls.length,
    allowed: allowed.length,
    usage: response.usage,
  }),
);
