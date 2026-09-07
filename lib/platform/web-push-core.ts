import webpush from "web-push";
import { getSql } from "@/lib/db";

type PushKind = "quiz_unlock" | "disruption" | "departure_reminder" | "chat_message" | "post_trip_review";
const copy: Record<PushKind, { title: string; body: string; url: string }> = {
  quiz_unlock: {
    title: "Il quiz di oggi è disponibile",
    body: "Il capogruppo può sbloccare le domande della giornata.",
    url: "/viaggio?tab=sfide",
  },
  disruption: {
    title: "Aggiornamento importante sul programma",
    body: "L'agenzia ha modificato una tappa del viaggio. Consulta il programma aggiornato.",
    url: "/viaggio?tab=programma",
  },
  departure_reminder: {
    title: "Il viaggio sta per iniziare",
    body: "Programma e documenti sono pronti anche per la consultazione offline.",
    url: "/viaggio?tab=documenti",
  },
  chat_message: {
    title: "Nuovo messaggio dall’agenzia",
    body: "Apri la chat operativa del tuo viaggio.",
    url: "/viaggio?tab=chat",
  },
  post_trip_review: {
    title: "Com’è andato il viaggio?",
    body: "Dedica un minuto alla valutazione complessiva e condividi la tua esperienza con l’agenzia.",
    url: "/viaggio?tab=valutazione",
  },
};

function notificationIcon(logoUrl: unknown) {
  const source = String(logoUrl || "");
  if (!/^r2:\/\/agencies\/[0-9a-f-]{36}\/branding\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(source))
    return "/icons/icon-192.png";
  return `/api/pwa/icon?size=192&source=${encodeURIComponent(Buffer.from(source, "utf8").toString("base64url"))}`;
}

export async function sendDeparturePush(input: { departureId: string; kind: PushKind; body?: string }) {
  const subject = process.env.WEB_PUSH_SUBJECT,
    vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !vapidPublic || !vapidPrivate) throw new Error("Configurazione VAPID incompleta");
  webpush.setVapidDetails(subject, vapidPublic, vapidPrivate);
  const subscriptions =
    await getSql()`SELECT id::text,endpoint,p256dh,auth_secret,agency_logo_url FROM app.list_departure_branded_web_push_subscriptions_v3(${input.departureId}::uuid)`;
  const message = {
    ...copy[input.kind],
    body: input.body || copy[input.kind].body,
    tag: `${input.kind}-${input.departureId}`,
    icon: notificationIcon(subscriptions[0]?.agency_logo_url),
  };
  let sent = 0,
    revoked = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: String(subscription.endpoint),
            keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth_secret) },
          },
          JSON.stringify(message),
          { TTL: 86400, urgency: input.kind === "disruption" ? "high" : "normal" },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 401 || status === 403 || status === 404 || status === 410) {
          await getSql()`SELECT app.revoke_web_push_subscription_v3(${String(subscription.id)}::uuid)`;
          revoked += 1;
        } else throw error;
      }
    }),
  );
  return { sent, revoked };
}

export async function sendPartyPush(input: {
  departureId: string;
  partyId: string;
  kind: "chat_message";
  body?: string;
}) {
  const subject = process.env.WEB_PUSH_SUBJECT,
    vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !vapidPublic || !vapidPrivate) return { sent: 0, revoked: 0 };
  webpush.setVapidDetails(subject, vapidPublic, vapidPrivate);
  const subscriptions =
    await getSql()`SELECT id::text,endpoint,p256dh,auth_secret,agency_logo_url FROM app.list_party_branded_web_push_subscriptions_v3(${input.departureId}::uuid,${input.partyId}::uuid)`;
  const message = {
    ...copy[input.kind],
    body: input.body || copy[input.kind].body,
    tag: `chat-${input.partyId}`,
    icon: notificationIcon(subscriptions[0]?.agency_logo_url),
  };
  let sent = 0,
    revoked = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: String(subscription.endpoint),
            keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth_secret) },
          },
          JSON.stringify(message),
          { TTL: 3600, urgency: "normal" },
        );
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 401 || status === 403 || status === 404 || status === 410) {
          await getSql()`SELECT app.revoke_web_push_subscription_v3(${String(subscription.id)}::uuid)`;
          revoked++;
        } else throw error;
      }
    }),
  );
  return { sent, revoked };
}

export async function sendNoticePush(input: {
  noticeId: string;
  departureId: string;
  travelerId?: string;
  severity: "information" | "important" | "urgent";
  title?: string;
}) {
  const subject = process.env.WEB_PUSH_SUBJECT;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !vapidPublic || !vapidPrivate) return { sent: 0, revoked: 0 };
  webpush.setVapidDetails(subject, vapidPublic, vapidPrivate);
  const subscriptions = await getSql()`SELECT id::text,endpoint,p256dh,auth_secret,agency_logo_url
    FROM app.list_notice_branded_web_push_subscriptions_v3(
      ${input.noticeId}::uuid,${input.travelerId ?? null}::uuid
    )`;
  let sent = 0;
  let revoked = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      const message = {
        title: input.severity === "urgent" ? "Comunicazione urgente sul viaggio" : input.title || "Nuova comunicazione",
        body:
          input.severity === "urgent"
            ? "Apri l'app per consultare e confermare la comunicazione."
            : "L'agenzia ha pubblicato una nuova comunicazione per la partenza.",
        url: "/viaggio?tab=programma",
        tag: `notice-${input.noticeId}`,
        icon: notificationIcon(subscription.agency_logo_url),
      };
      try {
        await webpush.sendNotification(
          {
            endpoint: String(subscription.endpoint),
            keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth_secret) },
          },
          JSON.stringify(message),
          { TTL: 86400, urgency: input.severity === "urgent" ? "high" : "normal" },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 401 || status === 403 || status === 404 || status === 410) {
          await getSql()`SELECT app.revoke_web_push_subscription_v3(${String(subscription.id)}::uuid)`;
          revoked += 1;
        } else throw error;
      }
    }),
  );
  return { sent, revoked };
}
