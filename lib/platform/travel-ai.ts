import { extractTravelProgrammeWithBedrock } from "./bedrock-travel-ai";
import { extractTravelProgrammeWithGemini } from "./gemini-travel-ai";
import { getPlatformProviderConfig } from "./provider-config";

export async function extractTravelProgramme(pdf: Uint8Array, filename: string) {
  if (getPlatformProviderConfig().travelAi === "bedrock") {
    return extractTravelProgrammeWithBedrock(pdf, filename);
  }
  return extractTravelProgrammeWithGemini(pdf, filename);
}
