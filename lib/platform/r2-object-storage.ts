import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PlatformRequestError } from "./errors";
import type {
  DownloadedObject,
  ObjectStorage,
  StoredObject,
  UploadAuthorization,
} from "./ports/object-storage";

const MIN_EXPIRY_SECONDS = 30;
const MAX_EXPIRY_SECONDS = 60 * 60;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new PlatformRequestError(`Storage R2 non configurato: manca ${name}`);
  return value;
}

function r2Endpoint(accountId: string) {
  const jurisdiction = process.env.R2_JURISDICTION?.trim().toLowerCase();
  if (!jurisdiction) return `https://${accountId}.r2.cloudflarestorage.com`;
  if (!["eu", "us", "fedramp"].includes(jurisdiction)) {
    throw new PlatformRequestError("R2_JURISDICTION non valida");
  }
  return `https://${accountId}.${jurisdiction}.r2.cloudflarestorage.com`;
}

function validKey(key: string) {
  if (
    !key || key.length > 700 || key.startsWith("/") || key.endsWith("/") ||
    key.includes("\\") || key.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new PlatformRequestError("Percorso del file non valido");
  }
  return key;
}

function validExpiry(seconds: number) {
  if (!Number.isInteger(seconds) || seconds < MIN_EXPIRY_SECONDS || seconds > MAX_EXPIRY_SECONDS) {
    throw new PlatformRequestError("Durata dell’autorizzazione storage non valida");
  }
  return seconds;
}

export class R2ObjectStorage implements ObjectStorage {
  readonly provider = "r2" as const;
  readonly bucket: string;
  private readonly client: S3Client;

  constructor() {
    const accountId = requiredEnvironment("R2_ACCOUNT_ID");
    this.bucket = requiredEnvironment("R2_BUCKET");
    this.client = new S3Client({
      region: "auto",
      endpoint: r2Endpoint(accountId),
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
      },
    });
  }

  async createUploadAuthorization(
    key: string,
    contentType: string,
    expiresInSeconds: number
  ): Promise<UploadAuthorization> {
    validKey(key);
    validExpiry(expiresInSeconds);
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(["content-type"]),
      }
    );
    return {
      provider: this.provider,
      bucket: this.bucket,
      key,
      url,
      method: "PUT",
      headers: { "Content-Type": contentType },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async head(key: string): Promise<StoredObject> {
    validKey(key);
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      provider: this.provider,
      bucket: this.bucket,
      key,
      sizeBytes: result.ContentLength ?? 0,
      contentType: result.ContentType ?? "application/octet-stream",
    };
  }

  async get(key: string): Promise<DownloadedObject> {
    validKey(key);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new PlatformRequestError("File privato non trovato");
    const bytes = await result.Body.transformToByteArray();
    return {
      provider: this.provider,
      bucket: this.bucket,
      key,
      bytes,
      sizeBytes: result.ContentLength ?? bytes.byteLength,
      contentType: result.ContentType ?? "application/octet-stream",
    };
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<StoredObject> {
    validKey(key);
    if (!bytes.byteLength) throw new PlatformRequestError("Il file da salvare è vuoto");
    if (!contentType.trim()) throw new PlatformRequestError("Content-Type del file mancante");
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }));
    return {
      provider: this.provider,
      bucket: this.bucket,
      key,
      sizeBytes: bytes.byteLength,
      contentType,
    };
  }

  async createDownloadUrl(
    key: string,
    expiresInSeconds: number,
    options?: { contentDisposition?: string; contentType?: string }
  ) {
    validKey(key);
    validExpiry(expiresInSeconds);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options?.contentDisposition,
        ResponseContentType: options?.contentType,
      }),
      { expiresIn: expiresInSeconds }
    );
  }

  async delete(key: string) {
    validKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
