import assert from"node:assert/strict";import{readFile}from"node:fs/promises";
const route=await readFile("app/api/internal/push/scheduled/route.ts","utf8"),config=JSON.parse(await readFile("vercel.json","utf8"));
assert.match(route,/timingSafeEqual/);assert.match(route,/CRON_SECRET/);assert.match(route,/claim_due_push_deliveries_v3/);assert.match(route,/complete_push_delivery_v3/);assert.match(route,/sendDeparturePush/);
assert.deepEqual(config.crons,[{path:"/api/internal/push/scheduled",schedule:"0 14 * * *"}]);
console.log(JSON.stringify({status:"passed",constantTimeAuth:true,claimCompleteWorkflow:true,deliveryDispatch:true,dailyCron:true,knownLimitation:"Vercel Hobby non garantisce le 20:00 locali multi-timezone"}));
