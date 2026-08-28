export type AgencyRole = "owner" | "admin" | "editor" | "viewer";
export type ObjectStorageProvider = "vercel-blob" | "r2";
export type JobQueueProvider = "database" | "sqs";
export type TravelAiProvider = "gemini" | "bedrock";

export type PlatformProviderConfig = {
  objectStorage: ObjectStorageProvider;
  jobQueue: JobQueueProvider;
  travelAi: TravelAiProvider;
};

export type PlatformOverview = {
  actor: { id: string; name: string };
  providers: PlatformProviderConfig;
  agencies: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    role: AgencyRole;
    primaryColor: string;
    logoUrl: string;
    trips: Array<{
      id: string;
      title: string;
      status: string;
      destinationCountry: string;
      startsOn: string | null;
      endsOn: string | null;
      contentGeneration: {
        status: string;
        readySections: number;
        expectedSections: number;
        contestTitles: string[];
        errorMessage: string | null;
        updatedAt: string | null;
      } | null;
      departures: Array<{
        id: string;
        code: string;
        title: string;
        startsOn: string;
        endsOn: string;
        status: string;
        partyCount: number;
        travelerNames: string[];
      }>;
    }>;
  }>;
  recentImports: Array<{
    id: string;
    agencyId: string;
    templateId: string;
    tripTitle: string;
    fileName: string;
    status: string;
    createdAt: string;
    errorMessage: string | null;
  }>;
};

export type PlatformImportReview = {
  id: string;
  agencyId: string;
  templateId: string;
  status: string;
  draft: import("./import-schema").TravelProgrammeDraft | null;
  errorMessage: string | null;
  model: string | null;
  createdAt: string;
  tripTitle: string;
  sourceFileName: string;
  normalizedFileName: string | null;
};
