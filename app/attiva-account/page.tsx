"use client";

import { FormEvent, useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, LockKeyhole, Mail, UserCheck } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import "../login/login.css";
import "../login/login-fix.css";

type Invitation = { name: string; email: string };
export default function ActivateAccountPage() {
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(value);
    fetch("/api/auth/invitation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "inspect", token: value }) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body as Invitation; })
      .then(setInvitation).catch((caught) => setError(caught instanceof Error ? caught.message : "Invito non valido")).finally(() => setBusy(false));
  }, []);

  async function activate(event: FormEvent) {
    event.preventDefault();
    if (!invitation || password.length < 8 || password !== confirmPassword) { setError("Le password devono coincidere e contenere almeno 8 caratteri."); return; }
    setBusy(true); setError("");
    try {
      const registered = await authClient.signUp.email({ email: invitation.email, password, name: invitation.name });
      if (registered.error) {
        const signedIn = await authClient.signIn.email({ email: invitation.email, password });
        if (signedIn.error) throw new Error("L’account esiste già: usa la password esistente oppure recuperala dalla pagina di login.");
      }
      const activated = await fetch("/api/auth/invitation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", token }) });
      const body = await activated.json().catch(() => ({})) as { error?: string };
      if (!activated.ok) throw new Error(body.error || "Attivazione non riuscita");
      window.location.replace("/viaggio");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Attivazione non riuscita"); setBusy(false); }
  }

  return <main className="loginPage"><section className="loginStory"><div className="loginPattern"/><div className="loginBrand"><span>SMF</span> SMF Travel</div><div className="loginStoryCopy"><p>IL TUO VIAGGIO È PRONTO</p><h1>Attiva il tuo<br/><em>spazio personale.</em></h1></div></section><section className="loginPanel"><div className="loginBox"><span className="loginLock"><UserCheck/></span><p className="loginEyebrow">PRIMO ACCESSO</p><h2>{invitation ? `Benvenuto, ${invitation.name}` : "Verifica invito"}</h2>{busy && !invitation && <LoaderCircle className="spin"/>}{error && <p className="loginError"><CircleAlert/> {error}</p>}{invitation && <form onSubmit={activate}><label>Email</label><div className="codeInput"><Mail/><input value={invitation.email} readOnly/></div><label>Scegli la password</label><div className="codeInput"><LockKeyhole/><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required/></div><label>Ripeti la password</label><div className="codeInput"><LockKeyhole/><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} required/></div><button className="loginSubmit" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <UserCheck/>} Attiva account</button></form>}</div></section></main>;
}
