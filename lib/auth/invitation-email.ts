import "server-only";

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

let client: SESv2Client | null = null;

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character,
  );
}

export async function sendTravelerInvitation(input: {
  email: string;
  name: string;
  username: string;
  activationUrl: string;
}) {
  const region = process.env.AWS_REGION?.trim();
  const roleArn = process.env.AWS_AUTH_ROLE_ARN?.trim();
  const sender = process.env.SES_INVITATION_SENDER?.trim();
  if (!region || !roleArn || !sender) return false;
  client ??= new SESv2Client({ region, credentials: awsCredentialsProvider({ roleArn }) });
  const name = escapeHtml(input.name);
  const username = escapeHtml(input.username);
  const activationUrl = escapeHtml(input.activationUrl);
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: sender,
      Destination: { ToAddresses: [input.email] },
      Content: {
        Simple: {
          Subject: { Data: "Il tuo invito a SMF Travel", Charset: "UTF-8" },
          Body: {
            Text: {
              Data: `Ciao ${input.name},\n\nil tuo username è ${input.username}. Attiva il tuo account usando questo link personale:\n${input.activationUrl}\n\nIl link scade tra 14 giorni.`,
              Charset: "UTF-8",
            },
            Html: {
              Data: `<p>Ciao ${name},</p><p>il tuo username è <strong>${username}</strong>.</p><p><a href="${activationUrl}">Attiva il tuo account</a></p><p>Il link è personale e scade tra 14 giorni.</p>`,
              Charset: "UTF-8",
            },
          },
        },
      },
    }),
  );
  return true;
}

export async function sendCommunicationReminder(input: {
  email: string;
  name: string;
  communicationTitle: string;
  appUrl: string;
}) {
  const region = process.env.AWS_REGION?.trim();
  const roleArn = process.env.AWS_AUTH_ROLE_ARN?.trim();
  const sender = process.env.SES_INVITATION_SENDER?.trim();
  if (!region || !roleArn || !sender || !input.email.trim()) return false;
  client ??= new SESv2Client({ region, credentials: awsCredentialsProvider({ roleArn }) });
  const name = escapeHtml(input.name);
  const title = escapeHtml(input.communicationTitle);
  const appUrl = escapeHtml(input.appUrl);
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: sender,
      Destination: { ToAddresses: [input.email] },
      Content: {
        Simple: {
          Subject: { Data: "Comunicazione del tuo viaggio da leggere", Charset: "UTF-8" },
          Body: {
            Text: {
              Data: `Ciao ${input.name},\n\nla comunicazione "${input.communicationTitle}" è ancora da leggere. Apri l'app per consultarla e confermare la presa visione:\n${input.appUrl}`,
              Charset: "UTF-8",
            },
            Html: {
              Data: `<p>Ciao ${name},</p><p>la comunicazione <strong>${title}</strong> è ancora da leggere.</p><p><a href="${appUrl}">Apri l'app e conferma la presa visione</a></p>`,
              Charset: "UTF-8",
            },
          },
        },
      },
    }),
  );
  return true;
}
