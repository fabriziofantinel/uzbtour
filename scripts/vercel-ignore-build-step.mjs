import { execFileSync } from "node:child_process";

const deploymentInputs = [
  /^app\//,
  /^components\//,
  /^lib\//,
  /^public\//,
  /^workers\//,
  /^proxy\.ts$/,
  /^instrumentation(?:-client)?\.ts$/,
  /^next\.config\.[^.]+$/,
  /^package(?:-lock)?\.json$/,
  /^tsconfig\.json$/,
  /^vercel\.json$/,
];

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function changedFiles(base = "HEAD^", head = "HEAD") {
  try {
    git("rev-parse", "--verify", base);
  } catch {
    const branch = process.env.VERCEL_GIT_COMMIT_REF;
    const fetchArgs = ["fetch", "--no-tags", "--deepen=1", "origin"];
    if (branch) fetchArgs.push(branch);
    git(...fetchArgs);
  }

  return git("diff", "--name-only", base, head)
    .split(/\r?\n/u)
    .map((file) => file.trim())
    .filter(Boolean);
}

try {
  const files = changedFiles(process.argv[2], process.argv[3]);
  const requiresDeployment = files.some((file) => deploymentInputs.some((pattern) => pattern.test(file)));

  if (requiresDeployment) {
    console.log("Modifiche runtime rilevate: il deployment Vercel deve proseguire.");
    process.exit(1);
  }

  console.log("Nessuna modifica runtime: il deployment Vercel viene ignorato.");
  process.exit(0);
} catch (error) {
  console.error("Impossibile determinare le modifiche: il deployment prosegue per sicurezza.", error.message);
  process.exit(1);
}
