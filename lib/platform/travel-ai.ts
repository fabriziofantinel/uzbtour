import { extractTravelProgrammeWithBedrock } from "./bedrock-travel-ai";

export async function extractTravelProgramme(documentBytes: Uint8Array, filename: string) {
  return extractTravelProgrammeWithBedrock(documentBytes, filename);
}
