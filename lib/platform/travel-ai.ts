import { extractTravelProgrammeWithBedrock } from "./bedrock-travel-ai";
import { extractTravelProgrammeWithGemini } from "./gemini-travel-ai";
import { getPlatformProviderConfig } from "./provider-config";

export async function extractTravelProgramme(documentBytes: Uint8Array, filename: string) {
  if (getPlatformProviderConfig().travelAi === "bedrock") {
    return extractTravelProgrammeWithBedrock(documentBytes, filename);
  }
  return extractTravelProgrammeWithGemini(documentBytes, filename);
}
