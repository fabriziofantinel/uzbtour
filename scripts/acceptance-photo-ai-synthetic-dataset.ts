import { readFile } from "node:fs/promises";
import path from "node:path";
import { judgePhotoContest } from "../lib/platform/photo-contest-ai";
import { withAiTestReplay } from "../lib/platform/ai-test-replay";

type ExpectedVerdict = "eligible" | "ineligible";
type Fixture = {
  file: string;
  expected: ExpectedVerdict;
  difficulty: "easy" | "medium" | "hard";
  reason: string;
};
type Manifest = {
  dataset: string;
  theme: string;
  photoValidation: Record<string, unknown>;
  fixtures: Fixture[];
  acceptance: {
    minimum_classification_accuracy: number;
    eligible_score_must_exceed_ineligible_score: boolean;
    ineligible_total_score: number;
    repeat_runs: number;
    order_invariance_required: boolean;
  };
};
type Observation = {
  run: number;
  file: string;
  difficulty: Fixture["difficulty"];
  expected: ExpectedVerdict;
  actual: ExpectedVerdict;
  total: number;
  passed: boolean;
  themeReason: string;
  reason: string;
};

const fixtureDirectory = path.resolve("tests/fixtures/photo-ai/independence-square");

async function main() {
  const manifest = JSON.parse(
    await readFile(path.join(fixtureDirectory, "manifest.json"), "utf8"),
  ) as Manifest;
  const requestedRuns = Number(
    process.argv.find((value) => value.startsWith("--runs="))?.split("=")[1] ??
      manifest.acceptance.repeat_runs,
  );
  const fixtures = await Promise.all(
    manifest.fixtures.map(async (fixture) => ({
      ...fixture,
      bytes: new Uint8Array(await readFile(path.join(fixtureDirectory, fixture.file))),
    })),
  );
  if (fixtures.length % 2 !== 0) throw new Error("Il dataset deve contenere un numero pari di immagini");

  const observations = await withAiTestReplay<Observation[]>(`photo-independence-square-${requestedRuns}-runs-v1`, async () => {
    const recorded: Observation[] = [];
    for (let run = 1; run <= requestedRuns; run += 1) {
      for (let index = 0; index < fixtures.length; index += 2) {
        const pair = fixtures.slice(index, index + 2);
        const ordered = run % 2 === 0 ? [...pair].reverse() : pair;
        const evaluations = await judgePhotoContest({
          title: manifest.theme,
          instructions: `La fotografia deve raffigurare realmente ${manifest.theme}. Non sono sufficienti una piazza generica o un altro monumento dell'Uzbekistan.`,
          category: "luogo specifico",
          validationProfile: manifest.photoValidation,
          photos: ordered.map((fixture) => ({ entryId: fixture.file, bytes: fixture.bytes, contentType: "image/png" })),
        });
        for (const fixture of ordered) {
          const evaluation = evaluations.find((item) => item.entryId === fixture.file);
          if (!evaluation) throw new Error(`Valutazione assente per ${fixture.file}`);
          const actual: ExpectedVerdict = evaluation.eligible ? "eligible" : "ineligible";
          recorded.push({
            run, file: fixture.file, difficulty: fixture.difficulty, expected: fixture.expected, actual,
            total: evaluation.total,
            passed: actual === fixture.expected && (actual === "eligible" || evaluation.total === manifest.acceptance.ineligible_total_score),
            themeReason: evaluation.themeReason, reason: evaluation.reason,
          });
        }
      }
    }
    return recorded;
  });

  const fixtureResults = fixtures.map((fixture) => {
    const samples = observations.filter((item) => item.file === fixture.file);
    const totals = samples.map((item) => item.total);
    return {
      file: fixture.file,
      difficulty: fixture.difficulty,
      expected: fixture.expected,
      passedRuns: samples.filter((item) => item.passed).length,
      runs: samples.length,
      stableVerdict: new Set(samples.map((item) => item.actual)).size === 1,
      minScore: Math.min(...totals),
      maxScore: Math.max(...totals),
      scoreRange: Math.max(...totals) - Math.min(...totals),
    };
  });
  const passed = observations.filter((item) => item.passed).length;
  const falsePositives = observations.filter(
    (item) => item.expected === "ineligible" && item.actual === "eligible",
  ).length;
  const falseNegatives = observations.filter(
    (item) => item.expected === "eligible" && item.actual === "ineligible",
  ).length;
  const accuracy = passed / observations.length;
  const eligibleScores = observations.filter((item) => item.expected === "eligible").map((item) => item.total);
  const ineligibleScores = observations.filter((item) => item.expected === "ineligible").map((item) => item.total);
  const orderInvariant = fixtureResults.every((item) => item.stableVerdict);
  const scoreSeparation =
    Math.min(...eligibleScores) > Math.max(...ineligibleScores);
  const status =
    accuracy >= manifest.acceptance.minimum_classification_accuracy &&
    (!manifest.acceptance.order_invariance_required || orderInvariant) &&
    (!manifest.acceptance.eligible_score_must_exceed_ineligible_score || scoreSeparation)
      ? "passed"
      : "failed";

  console.log(
    JSON.stringify(
      {
        status,
        dataset: manifest.dataset,
        theme: manifest.theme,
        metrics: {
          images: fixtures.length,
          runs: requestedRuns,
          evaluations: observations.length,
          accuracy,
          falsePositives,
          falseNegatives,
          orderInvariant,
          scoreSeparation,
        },
        fixtures: fixtureResults,
        failures: observations.filter((item) => !item.passed),
      },
      null,
      2,
    ),
  );
  if (status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
