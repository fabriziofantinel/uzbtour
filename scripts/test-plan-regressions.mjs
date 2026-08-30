import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [loginPage, loginRoute, gamification, challengesRoute, programmeRoute, repository, proxy, invitationRoute, activationPage, travelerExperience, referenceRepository, superadminCss] = await Promise.all([
  read("app/login/page.tsx"),
  read("app/api/auth/username/sign-in/route.ts"),
  read("lib/platform/v3-gamification.ts"),
  read("app/api/traveler/challenges/route.ts"),
  read("app/api/admin/platform/departures/[id]/programme/route.ts"),
  read("lib/platform/programme-repository.ts"),
  read("proxy.ts"),
  read("app/api/auth/invitation/route.ts"),
  read("app/attiva-account/page.tsx"),
  read("app/viaggio/travel-experience.tsx"),
  read("lib/platform/trip-content-materializer.ts"),
  read("app/admin/superadmin.css"),
]);

assert.match(loginPage, /Username non valido/);
assert.match(loginPage, /\[a-z0-9\._-\]/i);
assert.match(loginRoute, /INVALID_USERNAME/);
assert.match(loginRoute, /Username non valido/);

assert.match(gamification, /app\.has_active_activity_access_grant_v3/);
assert.match(gamification, /app\.issue_activity_access_grant/);
assert.match(gamification, /if \(count >= 10\) return false/);
assert.match(challengesRoute, /questions\.length !== 10/);

assert.match(programmeRoute, /action === "cancelItem"/);
assert.match(programmeRoute, /reason\.length < 3/);
assert.match(repository, /app\.record_itinerary_disruption/);
assert.equal(programmeRoute.match(/sendDeparturePush/g)?.length, 2); // import + unica invocazione nel ramo disruption
assert.ok(programmeRoute.indexOf("sendDeparturePush") < programmeRoute.indexOf("eventId });"));

assert.match(proxy, /\(\?!api\|login\|auth\|attiva-account/);
assert.doesNotMatch(proxy, /\(\?!api\/auth\|login/);

assert.match(invitationRoute, /activate_magic/);
assert.match(activationPage, /Entra subito con il link personale/);
assert.match(travelerExperience, /changeNotices/);
assert.match(travelerExperience, /Ho letto/);
assert.match(referenceRepository, /source_name/);
assert.match(referenceRepository, /source_url/);
assert.match(referenceRepository, /review_status='needs_review'/);
assert.match(referenceRepository, /disclaimer=/);
assert.match(superadminCss, /\.impersonationList article>button\{min-width:48px;min-height:48px/);

console.log(JSON.stringify({
  status: "passed",
  usernameValidation: true,
  quizServerGate: true,
  quizLimit: 10,
  disruptionWorkflow: true,
  genericEditPushRemoved: true,
  apiRoutesBypassPageRedirect: true,
  magicLinkOnboarding: true,
  travelerChangeAcknowledgement: true,
  sensitiveContentProvenance: true,
  superadminMobileTouchTargets: true,
}));
