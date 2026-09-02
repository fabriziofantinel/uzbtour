import "server-only";

import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  RevokeTokenCommand,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const COGNITO_ACCESS_COOKIE = "smf_cognito_access";
export const COGNITO_ID_COOKIE = "smf_cognito_id";
export const COGNITO_REFRESH_COOKIE = "smf_cognito_refresh";

let publicClient: CognitoIdentityProviderClient | null = null;
let adminClient: CognitoIdentityProviderClient | null = null;
let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function config() {
  const region = process.env.AWS_REGION?.trim();
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  const clientId = process.env.COGNITO_WEB_CLIENT_ID?.trim();
  if (!region || !userPoolId || !clientId) throw new Error("Cognito non configurato");
  return { region, userPoolId, clientId };
}

export function isCognitoConfigured() {
  return Boolean(process.env.AWS_REGION && process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_WEB_CLIENT_ID);
}

function getPublicClient() {
  const { region } = config();
  publicClient ??= new CognitoIdentityProviderClient({ region });
  return publicClient;
}

function getAdminClient() {
  const { region } = config();
  const roleArn = process.env.AWS_AUTH_ROLE_ARN?.trim();
  if (!roleArn) throw new Error("Ruolo Cognito OIDC non configurato");
  adminClient ??= new CognitoIdentityProviderClient({
    region,
    credentials: awsCredentialsProvider({ roleArn }),
  });
  return adminClient;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function setCognitoCookies(response: NextResponse, result: AuthenticationResultType) {
  if (!result.AccessToken || !result.IdToken) throw new Error("Token Cognito mancanti");
  response.cookies.set(COGNITO_ACCESS_COOKIE, result.AccessToken, cookieOptions(result.ExpiresIn ?? 3600));
  response.cookies.set(COGNITO_ID_COOKIE, result.IdToken, cookieOptions(result.ExpiresIn ?? 3600));
  if (result.RefreshToken)
    response.cookies.set(COGNITO_REFRESH_COOKIE, result.RefreshToken, cookieOptions(30 * 24 * 60 * 60));
}

export function clearCognitoCookies(response: NextResponse) {
  for (const name of [COGNITO_ACCESS_COOKIE, COGNITO_ID_COOKIE, COGNITO_REFRESH_COOKIE]) {
    response.cookies.set(name, "", cookieOptions(0));
  }
}

export async function signInWithUsername(username: string, password: string) {
  const { clientId } = config();
  const result = await getPublicClient().send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  );
  if (result.ChallengeName) throw new Error(`Cognito challenge non gestita: ${result.ChallengeName}`);
  if (!result.AuthenticationResult) throw new Error("Autenticazione Cognito incompleta");
  return result.AuthenticationResult;
}

export async function refreshCognitoTokens(refreshToken: string) {
  const { clientId } = config();
  const result = await getPublicClient().send(
    new InitiateAuthCommand({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: clientId,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  );
  if (!result.AuthenticationResult) throw new Error("Rinnovo sessione Cognito incompleto");
  return result.AuthenticationResult;
}

export async function revokeCognitoRefreshToken(refreshToken: string) {
  const { clientId } = config();
  await getPublicClient().send(new RevokeTokenCommand({ ClientId: clientId, Token: refreshToken }));
}

export async function getCognitoIdentity() {
  if (!isCognitoConfigured()) return null;
  const idToken = (await cookies()).get(COGNITO_ID_COOKIE)?.value;
  if (!idToken) return null;
  const { userPoolId, clientId } = config();
  verifier ??= CognitoJwtVerifier.create({ userPoolId, tokenUse: "id", clientId });
  try {
    const payload = await verifier.verify(idToken);
    if (!payload.sub) return null;
    return {
      subject: String(payload.sub),
      username: String(payload["cognito:username"] ?? ""),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? payload["cognito:username"] ?? "Utente"),
    };
  } catch {
    return null;
  }
}

function attribute(attributes: Array<{ Name?: string; Value?: string }> | undefined, name: string) {
  return attributes?.find((item) => item.Name === name)?.Value ?? "";
}

export async function createOrUpdateInvitedCognitoUser(input: {
  username: string;
  email: string;
  name: string;
  password: string;
}) {
  const { userPoolId } = config();
  const client = getAdminClient();
  let user;
  try {
    user = await client.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: input.username }));
    const existingEmail = attribute(user.UserAttributes, "email").toLocaleLowerCase("en-US");
    if (existingEmail !== input.email.toLocaleLowerCase("en-US")) throw new Error("Username già assegnato");
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "UserNotFoundException") throw error;
    const created = await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: input.username,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: input.email },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: input.name },
        ],
      }),
    );
    user = { UserAttributes: created.User?.Attributes };
  }
  await client.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: input.username,
      UserAttributes: [
        { Name: "email", Value: input.email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: input.name },
      ],
    }),
  );
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: input.username,
      Password: input.password,
      Permanent: true,
    }),
  );
  const subject = attribute(user.UserAttributes, "sub");
  if (!subject) {
    const fetched = await client.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: input.username }));
    const fetchedSubject = attribute(fetched.UserAttributes, "sub");
    if (!fetchedSubject) throw new Error("Identificatore Cognito mancante");
    return fetchedSubject;
  }
  return subject;
}

export async function requestPasswordReset(username: string) {
  const { clientId } = config();
  await getPublicClient().send(new ForgotPasswordCommand({ ClientId: clientId, Username: username }));
}

export async function confirmPasswordReset(username: string, code: string, password: string) {
  const { clientId } = config();
  await getPublicClient().send(
    new ConfirmForgotPasswordCommand({
      ClientId: clientId,
      Username: username,
      ConfirmationCode: code,
      Password: password,
    }),
  );
}
