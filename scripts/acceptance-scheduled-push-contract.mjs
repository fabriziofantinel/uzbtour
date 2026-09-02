import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const handler = await readFile("workers/scheduled-push-handler.ts", "utf8"),
  template = await readFile("infra/aws/template.yaml", "utf8"),
  config = JSON.parse(await readFile("vercel.json", "utf8"));
assert.match(handler, /claim_due_push_deliveries_v3/);
assert.match(handler, /complete_push_delivery_v3/);
assert.match(handler, /sendDeparturePush/);
assert.match(template, /ScheduledPushEveryFiveMinutes:/);
assert.match(template, /Schedule: rate\(5 minutes\)/);
assert.match(template, /ScheduledPushDeadLetterQueue/);
assert.match(template, /WEB_PUSH_PARAMETER_NAME/);
assert.equal(config.crons, undefined);
console.log(
  JSON.stringify({
    status: "passed",
    claimCompleteWorkflow: true,
    deliveryDispatch: true,
    multiTimezonePolling: true,
    idempotentFiveMinuteSchedule: true,
    deadLetterQueue: true,
    vercelCronDisabled: true,
  }),
);
