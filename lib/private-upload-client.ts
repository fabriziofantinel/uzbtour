"use client";

type UploadAuthorization = {
  key: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
};

function imageContentType(file: File) {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  if (extension === "pdf") return "application/pdf";
  return "application/octet-stream";
}

async function responseJson<T>(response: Response): Promise<T> {
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Preparazione del caricamento non riuscita");
  return result;
}

function putFile(authorization: UploadAuthorization, file: Blob, onProgress?: (percentage: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(authorization.method, authorization.url);
    Object.entries(authorization.headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("Connessione allo storage R2 non riuscita"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(
          new Error(
            request.status === 403
              ? "R2 ha rifiutato il file. Controlla CORS o riprova."
              : "Caricamento del file su R2 non riuscito",
          ),
        );
      }
    };
    request.send(file);
  });
}

async function optimizeAiPhoto(file: File) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Ottimizzazione della foto non disponibile");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Compressione della foto non riuscita"))),
        "image/jpeg",
        0.82,
      ),
    );
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

export async function uploadPrivateFile(input: {
  endpoint: string;
  file: File;
  payload: Record<string, unknown>;
  onProgress?: (percentage: number) => void;
  optimizeForAi?: boolean;
}) {
  const file = input.optimizeForAi ? await optimizeAiPhoto(input.file) : input.file;
  const contentType = imageContentType(file);
  const authorization = await responseJson<UploadAuthorization>(
    await fetch(input.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input.payload,
        originalName: file.name,
        contentType,
        sizeBytes: file.size,
      }),
    }),
  );
  await putFile(authorization, file, input.onProgress);
  return { key: authorization.key, contentType };
}
