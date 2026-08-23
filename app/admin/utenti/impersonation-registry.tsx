"use client";

import { useMemo, useState } from "react";
import { CircleAlert, LoaderCircle, LogIn, Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import type { ImpersonationUser } from "@/lib/platform/superadmin-repository";

const agencyRoleLabels: Record<string, string> = {
  owner: "Titolare", admin: "Amministratore", editor: "Agente", viewer: "Lettura",
};

export default function ImpersonationRegistry({ initialUsers }: { initialUsers: ImpersonationUser[] }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const users = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("it");
    if (!needle) return initialUsers;
    return initialUsers.filter((user) => [user.name, user.email, ...user.agencyNames]
      .some((value) => value.toLocaleLowerCase("it").includes(needle)));
  }, [initialUsers, query]);

  async function impersonate(user: ImpersonationUser) {
    if (!window.confirm(`Vuoi entrare nell’applicazione come ${user.name}?`)) return;
    setBusy(user.id);
    setError("");
    try {
      const response = await fetch("/api/admin/platform/impersonation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: user.id }),
      });
      const result = await response.json().catch(() => ({})) as { redirectUrl?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Avvio sessione non riuscito");
      window.location.assign(result.redirectUrl || "/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Avvio sessione non riuscito");
      setBusy("");
    }
  }

  return (
    <div className="superadminShell">
      <section className="registryHead">
        <div><small>CONTROLLO ACCESSI</small><h1>Login come utente</h1><p>Verifica l’applicazione usando esattamente il profilo e i permessi di un utente censito.</p></div>
      </section>
      <div className="impersonationWarning"><ShieldCheck/><span><b>Sessione controllata</b><small>Non servono le credenziali dell’utente. Una fascia viola consentirà sempre di tornare al superadmin.</small></span></div>
      {error && <div className="superadminMessage error"><CircleAlert size={18}/>{error}</div>}
      <label className="userSearch"><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca per nome, email o agenzia…"/></label>
      <section className="impersonationList">
        {users.map((user) => (
          <article key={user.id}>
            <i>{user.initials || user.name.slice(0, 2).toUpperCase()}</i>
            <span className="impersonationIdentity">
              <strong>{user.name}</strong><small>{user.email || "Email non indicata"}</small>
              <em>{user.agencyNames.length ? user.agencyNames.join(" · ") : "Nessuna agenzia associata"}</em>
            </span>
            <span className="impersonationRoles">
              {user.platformRole === "superadmin" && <b><ShieldCheck/> Superadmin</b>}
              {user.agencyRoles.map((role) => <b key={role}><UsersRound/> {agencyRoleLabels[role] || role}</b>)}
              {user.isTraveler && <b><UserRound/> Viaggiatore</b>}
              {user.status === "invited" && <b className="pending">Invitato</b>}
            </span>
            <button onClick={() => impersonate(user)} disabled={Boolean(busy)}>
              {busy === user.id ? <LoaderCircle className="spin"/> : <LogIn/>} Accedi come
            </button>
          </article>
        ))}
        {users.length === 0 && <div className="registryEmpty"><UserRound/><h2>Nessun utente trovato</h2><p>Modifica i criteri di ricerca.</p></div>}
      </section>
    </div>
  );
}
