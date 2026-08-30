import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [loginPage, loginRoute, gamification, challengesRoute, programmeRoute, repository] = await Promise.all([
  read("app/login/page.tsx"),
  read("app/api/auth/username/sign-in/route.ts"),
  read("lib/platform/v3-gamification.ts"),
  read("app/api/traveler/challenges/route.ts"),
  read("app/api/admin/platform/departures/[id]/programme/route.ts"),
  read("lib/platform/programme-repository.ts"),
]);

assert.match(loginPage, /Username non valido/);
assert.match(loginPage, /\[a-z0-9\._-\]/i);
assert.match(loginRoute, /INVALID_USERNAME/);
assert.match(loginRoute, /Username non valido/);

assert.match(gamification, /activity_access_grants/);
assert.match(gamification, /app\.issue_activity_access_grant/);
assert.match(gamification, /available_at<=clock_timestamp\(\)/);
assert.match(gamification, /if \(count >= 10\) return false/);
assert.match(challengesRoute, /questions\.length !== 10/);

assert.match(programmeRoute, /action === "cancelItem"/);
assert.match(programmeRoute, /reason\.length < 3/);
assert.match(repository, /app\.record_itinerary_disruption/);
assert.equal(programmeRoute.match(/sendDeparturePush/g)?.length, 2); // import + unica invocazione nel ramo disruption
assert.ok(programmeRoute.indexOf("sendDeparturePush") < programmeRoute.indexOf("eventId });"));

console.log(JSON.stringify({
  status: "passed",
  usernameValidation: true,
  quizServerGate: true,
  quizLimit: 10,
  disruptionWorkflow: true,
  genericEditPushRemoved: true,
}));
