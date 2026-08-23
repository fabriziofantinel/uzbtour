"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { NeonAuthUIProvider } from "@neondatabase/auth-ui";
import { authClient } from "@/lib/auth/client";

const italianAuthLabels = {
  EMAIL: "Email",
  EMAIL_PLACEHOLDER: "nome@esempio.it",
  EMAIL_REQUIRED: "L’indirizzo email è obbligatorio",
  FORGOT_PASSWORD: "Password dimenticata",
  FORGOT_PASSWORD_ACTION: "Invia il link di ripristino",
  FORGOT_PASSWORD_DESCRIPTION: "Inserisci la tua email per impostare una nuova password",
  FORGOT_PASSWORD_EMAIL: "Controlla la tua email: ti abbiamo inviato il link di ripristino.",
  RESET_PASSWORD: "Imposta una nuova password",
  RESET_PASSWORD_ACTION: "Salva la nuova password",
  RESET_PASSWORD_DESCRIPTION: "Inserisci e conferma la nuova password",
  RESET_PASSWORD_SUCCESS: "Password aggiornata correttamente",
  NEW_PASSWORD: "Nuova password",
  NEW_PASSWORD_PLACEHOLDER: "Nuova password",
  NEW_PASSWORD_REQUIRED: "La nuova password è obbligatoria",
  CONFIRM_PASSWORD: "Conferma password",
  CONFIRM_PASSWORD_PLACEHOLDER: "Conferma password",
  CONFIRM_PASSWORD_REQUIRED: "La conferma della password è obbligatoria",
  PASSWORDS_DO_NOT_MATCH: "Le password non coincidono",
  REQUEST_FAILED: "Operazione non riuscita. Riprova."
};

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      basePath="/auth"
      redirectTo="/viaggio"
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => router.refresh()}
      Link={Link}
      signUp={false}
      defaultTheme="light"
      localization={italianAuthLabels}
    >
      {children}
    </NeonAuthUIProvider>
  );
}
