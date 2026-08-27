# Autenticazione Cognito con username

## Obiettivo

Ogni persona accede con uno username univoco e una password personale. L'email
e' un dato di contatto e recupero, non un identificatore: piu' viaggiatori o
agenti possono quindi condividere la stessa casella email senza condividere
l'account.

Neon conserva utenti, ruoli, appartenenza ad agenzie, partenze e famiglie.
Amazon Cognito conserva esclusivamente credenziali e sessioni. Il collegamento
stabile e' `iam.user_identities(provider='cognito', subject=<Cognito sub>)`.

## Flussi

### Invito

1. L'agente o il superadmin assegna uno username e un'email al nuovo utente.
2. Neon crea un utente `invited` e un token monouso valido 14 giorni.
3. SES invia il link personale. Tre utenti con la stessa email ricevono tre
   messaggi e tre token indipendenti.
4. Il destinatario sceglie la password. Vercel valida il token, assume tramite
   OIDC il ruolo AWS limitato, crea l'utente Cognito e attiva il solo utente IAM
   associato al token.
5. L'app apre una sessione tramite cookie HttpOnly, Secure e SameSite=Lax.

### Login e rinnovo

Il browser invia username e password a una Route Handler Next.js. La route usa
`USER_PASSWORD_AUTH`, conserva access, ID e refresh token soltanto in cookie
HttpOnly e non espone i token a React. Il proxy rinnova i token scaduti con
`REFRESH_TOKEN_AUTH`. Il backend verifica la firma dell'ID token contro il JWKS
del pool e risolve il `sub` su Neon.

### Recupero password

L'utente indica lo username. `ForgotPassword` invia all'email verificata di
quello specifico account un link che apre `/auth/reset-password` con username e
codice gia' compilati; il codice resta visibile nella mail come fallback
manuale. Codice e nuova password vengono confermati con
`ConfirmForgotPassword`. La risposta iniziale resta generica per non rivelare
se lo username esiste.

Prima di autenticare Cognito, Neon distingue account non censito, invito ancora
da accettare, account disabilitato e agenzia sospesa. Dopo l'autenticazione la
stessa regola e' nuovamente applicata dal resolver del `sub`, quindi la
disattivazione dell'agenzia blocca anche sessioni gia' emesse alla richiesta
successiva.

## Configurazione

Output CloudFormation da impostare su Vercel:

```text
COGNITO_USER_POOL_ID=<CognitoUserPoolId>
COGNITO_WEB_CLIENT_ID=<CognitoWebClientId>
AWS_AUTH_ROLE_ARN=<VercelAuthBrokerRoleArn>
SES_INVITATION_SENDER=<InvitationSender>
```

Il pool deve rimanere username-only: non configurare `email` in
`AliasAttributes` o `UsernameAttributes`. Il client non ha un secret statico.
Le azioni amministrative e l'invio SES usano credenziali temporanee Vercel OIDC.
Il pool e' fissato esplicitamente al piano `LITE`; Neon Auth non e' un fallback
runtime e non deve essere riconfigurato dopo il cutover.

Prima del go-live, verificare l'identita' SES e richiedere l'uscita dalla sandbox
SES, oppure i messaggi potranno essere inviati soltanto a destinatari verificati.

## Ordine di rilascio

1. creare change set CloudFormation e revisionarlo;
2. applicare lo stack e verificare Cognito/SES;
3. applicare le migrazioni Neon 055 e 056;
4. configurare le quattro variabili Vercel;
5. emettere l'invito monouso del superuser e disattivare gli altri account;
6. distribuire il frontend;
7. eseguire test con tre username distinti sulla stessa email;
8. aggiornare la baseline consolidata soltanto dopo l'audit visivo approvato.
