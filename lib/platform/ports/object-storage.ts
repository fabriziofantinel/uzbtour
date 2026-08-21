export type StoredObject = {
  provider: "vercel_blob" | "r2";
  bucket: string;
  key: string;
  sizeBytes: number;
  contentType: string;
};

export interface ObjectStorage {
  put(key: string, body: Blob, contentType: string): Promise<StoredObject>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
