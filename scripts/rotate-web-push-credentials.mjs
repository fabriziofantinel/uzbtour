import { spawnSync } from "node:child_process";
import webpush from "web-push";

const parameterName = process.env.WEB_PUSH_PARAMETER_NAME || "/smf-travel/production/web-push";
const subject = process.env.WEB_PUSH_SUBJECT || "mailto:ai.fabrizio.fantinel@gmail.com";
const keys = webpush.generateVAPIDKeys();
const powershell = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const npxScript = `${process.env.LOCALAPPDATA}\\Programs\\nodejs\\npx.ps1`;
const awsCli = `${process.env.ProgramFiles}\\Amazon\\AWSCLIV2\\aws.exe`;

function run(command, args, label, secretValues = []) {
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    const safeError = secretValues.reduce(
      (message, secret) => message.replaceAll(secret, "[REDACTED]"),
      result.stderr?.toString().trim() || result.error?.message || "",
    );
    throw new Error(`${label} non riuscita: ${safeError || "errore CLI senza dettagli"}`);
  }
}

const vercelValues = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: { value: keys.publicKey, sensitive: false },
  VAPID_PRIVATE_KEY: { value: keys.privateKey, sensitive: true },
  WEB_PUSH_SUBJECT: { value: subject, sensitive: false },
};

for (const [name, config] of Object.entries(vercelValues)) {
  run(
    process.platform === "win32" ? powershell : "npx",
    process.platform === "win32"
      ? [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          npxScript,
          "vercel",
          "env",
          "add",
          name,
          "production,preview,development",
          "--value",
          config.value,
          "--yes",
          "--force",
          config.sensitive ? "--sensitive" : "--no-sensitive",
        ]
      : [
          "vercel",
          "env",
          "add",
          name,
          "production,preview,development",
          "--value",
          config.value,
          "--yes",
          "--force",
          config.sensitive ? "--sensitive" : "--no-sensitive",
        ],
    `Aggiornamento Vercel ${name}`,
    [config.value],
  );
}

run(
  process.platform === "win32" ? awsCli : "aws",
  [
    "ssm",
    "put-parameter",
    "--name",
    parameterName,
    "--type",
    "SecureString",
    "--overwrite",
    "--value",
    JSON.stringify({ subject, publicKey: keys.publicKey, privateKey: keys.privateKey }),
  ],
  "Aggiornamento del parametro AWS",
  [keys.publicKey, keys.privateKey],
);

console.log(JSON.stringify({ status: "rotated", vercel: true, awsParameter: parameterName }));
