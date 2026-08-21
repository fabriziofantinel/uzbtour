export type StoredObject = {
  provider: "vercel_blob" | "r2";
  bucket: string;
  key: string;
  sizeBytes: number;
  contentType: string;
};

export type UploadAuthorization = {
  provider: StoredObject["provider"];
  bucket: string;
  key: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

export type DownloadedObject = StoredObject & {
  bytes: Uint8Array;
};

export interface ObjectStorage {
  readonly provider: StoredObject["provider"];
  readonly bucket: string;
  createUploadAuthorization(
    key: string,
    contentType: string,
    expiresInSeconds: number
  ): Promise<UploadAuthorization>;
  head(key: string): Promise<StoredObject>;
  get(key: string): Promise<DownloadedObject>;
  createDownloadUrl(
    key: string,
    expiresInSeconds: number,
    options?: { contentDisposition?: string; contentType?: string }
  ): Promise<string>;
  delete(key: string): Promise<void>;
}
