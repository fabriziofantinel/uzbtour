"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, UserRound } from "lucide-react";

export default function UsernameRecovery({
  initialUsername = "",
  initialCode = "",
  confirmInitially = false,
}: {
  initialUsername?: string;
  initialCode?: string;
  confirmInitially?: boolean;
}) {
  const [step, setStep] = useState<"request" | "confirm" | "done">(confirmInitially ? "confirm" : "request");
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState(initialCode);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passwordValid =
    password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await fetch("/api/auth/username/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      setStep("confirm");
    } catch {
      setError("Connessione non disponibile. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/username/confirm-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), code: code.trim(), password }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Ripristino non riuscito");
      setStep("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ripristino non riuscito");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done")
    return (
      <div role="status">
        <CheckCircle2 />
        <h2>Password aggiornata</h2>
        <p>Ora puoi accedere usando il tuo username e la nuova password.</p>
      </div>
    );

  return (
    <form onSubmit={step === "request" ? requestReset : confirmReset}>
      <label htmlFor="recovery-username">Username</label>
      <div className="codeInput">
        <UserRound />
        <input
          id="recovery-username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          readOnly={step === "confirm"}
          required
          minLength={3}
          maxLength={80}
        />
      </div>
      {step === "confirm" && (
        <>
          <p>
            Se lo username è valido, abbiamo inviato un link e un codice all’email associata a questo specifico account.
          </p>
          <label htmlFor="recovery-code">Codice ricevuto</label>
          <div className="codeInput">
            <KeyRound />
            <input
              id="recovery-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              minLength={4}
              maxLength={12}
            />
          </div>
          <label htmlFor="recovery-password">Nuova password</label>
          <div className="codeInput">
            <KeyRound />
            <input
              id="recovery-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
              maxLength={256}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Nascondi password" : "Mostra password"}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
          </div>
          <p className={password && !passwordValid ? "activationHint invalid" : "activationHint"}>
            Almeno 10 caratteri, una maiuscola, una minuscola e un numero.
          </p>
        </>
      )}
      {error && (
        <p className="loginError" role="alert">
          {error}
        </p>
      )}
      <button
        className="loginSubmit"
        type="submit"
        disabled={busy || !username.trim() || (step === "confirm" && (!code.trim() || !passwordValid))}
      >
        {busy ? <LoaderCircle className="spin" /> : <KeyRound />}
        {step === "request" ? "Invia il link di ripristino" : "Salva la nuova password"}
      </button>
    </form>
  );
}
