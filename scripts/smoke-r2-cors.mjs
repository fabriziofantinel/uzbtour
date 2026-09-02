import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} non configurata`);
  return value;
}

const accountId = required("R2_ACCOUNT_ID");
const bucket = required("R2_BUCKET");
const jurisdiction = required("R2_JURISDICTION");
const origin = process.env.R2_TEST_ORIGIN?.trim() || "https://smf-travel.vercel.app";
const endpoint = `https://${accountId}.${jurisdiction}.r2.cloudflarestorage.com`;
const key = `smoke-tests/${randomUUID()}.txt`;
const body = new TextEncoder().encode("SMF Travel R2 smoke test");

const client = new S3Client({
  region: "auto",
  endpoint,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
});

try {
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "text/plain" }),
    { expiresIn: 60, signableHeaders: new Set(["content-type"]) },
  );
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "text/plain", Origin: origin },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const responseText = await response.text();
    const code = responseText.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "Unknown";
    const message = responseText.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? "Nessun dettaglio";
    const signedParameterNames = [...new URL(url).searchParams.keys()].sort();
    throw new Error(
      `PUT R2 non riuscito: HTTP ${response.status}, ${code}, ${message}; parametri: ${signedParameterNames.join(",")}`,
    );
  }

  const stored = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (stored.ContentLength !== body.byteLength) {
    throw new Error(`Dimensione R2 inattesa: ${stored.ContentLength ?? "assente"}`);
  }

  const allowOrigin = response.headers.get("access-control-allow-origin");
  if (allowOrigin !== origin) {
    throw new Error(`CORS R2 non valido: origine restituita ${allowOrigin ?? "assente"}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      status: response.status,
      allowOrigin,
      etagExposed: response.headers.has("etag"),
      sizeBytes: stored.ContentLength,
    }),
  );
} finally {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
}
