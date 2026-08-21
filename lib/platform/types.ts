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
    trips: Array<{
      id: string;
      title: string;
      status: string;
      departures: Array<{
        id: string;
        code: string;
        title: string;
        startsOn: string;
        endsOn: string;
        status: string;
        partyCount: number;
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
