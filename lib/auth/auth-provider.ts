import "server-only";

import type { AuthenticationResultType } from "@aws-sdk/client-cognito-identity-provider";
import type { NextResponse } from "next/server";
import {
  COGNITO_ID_COOKIE,
  COGNITO_REFRESH_COOKIE,
  clearCognitoCookies,
  confirmPasswordReset,
  createOrUpdateInvitedCognitoUser,
  getCognitoIdentity,
  isCognitoConfigured,
  refreshCognitoTokens,
  requestPasswordReset,
  revokeCognitoRefreshToken,
  setCognitoCookies,
  signInWithUsername,
} from "./cognito";

export type AuthIdentity = {
  subject: string;
  username: string;
  email: string;
  name: string;
};

export interface AuthProvider {
  readonly idCookie: string;
  readonly refreshCookie: string;
  isConfigured(): boolean;
  signIn(username: string, password: string): Promise<AuthenticationResultType>;
  refresh(refreshToken: string): Promise<AuthenticationResultType>;
  revoke(refreshToken: string): Promise<void>;
  identity(): Promise<AuthIdentity | null>;
  setCookies(response: NextResponse, result: AuthenticationResultType): void;
  clearCookies(response: NextResponse): void;
  requestPasswordReset(username: string): Promise<void>;
  confirmPasswordReset(username: string, code: string, password: string): Promise<void>;
  provisionInvitedUser(input: { username: string; email: string; name: string; password: string }): Promise<string>;
}

const cognitoProvider: AuthProvider = {
  idCookie: COGNITO_ID_COOKIE,
  refreshCookie: COGNITO_REFRESH_COOKIE,
  isConfigured: isCognitoConfigured,
  signIn: signInWithUsername,
  refresh: refreshCognitoTokens,
  revoke: revokeCognitoRefreshToken,
  identity: getCognitoIdentity,
  setCookies: setCognitoCookies,
  clearCookies: clearCognitoCookies,
  requestPasswordReset,
  confirmPasswordReset,
  provisionInvitedUser: createOrUpdateInvitedCognitoUser,
};

export function getAuthProvider(): AuthProvider {
  const provider = process.env.AUTH_PROVIDER?.trim().toLowerCase() || "cognito";
  if (provider !== "cognito") throw new Error(`Provider di autenticazione non supportato: ${provider}`);
  return cognitoProvider;
}

export const AUTH_ID_COOKIE = cognitoProvider.idCookie;
export const AUTH_REFRESH_COOKIE = cognitoProvider.refreshCookie;
