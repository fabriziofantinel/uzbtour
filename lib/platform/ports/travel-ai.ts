export type ExtractedTravelProgramme = {
  title: string;
  destinationCountry?: string;
  days: Array<{
    dayNumber: number;
    title: string;
    city?: string;
    activities: Array<{ title: string; type: string; confidence?: number }>;
    accommodation?: string;
  }>;
  usefulInformation: Array<{ category: string; title: string; body: string }>;
};

export interface TravelAi {
  extractProgramme(documentText: string): Promise<ExtractedTravelProgramme>;
}
