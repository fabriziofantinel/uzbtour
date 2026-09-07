"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, LogIn, Search, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import type { ImpersonationUser } from "@/lib/platform/superadmin-repository";

const agencyRoleLabels: Record<string, string> = {
  owner: "Titolare",
  admin: "Amministratore",
  editor: "Agente",
  viewer: "Lettura",
};

export default function ImpersonationRegistry({ initialUsers }: { initialUsers: ImpersonationUser[] }) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "agency" | "traveler" | "superadmin" | "invited">("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selectedUser, setSelectedUser] = useState<ImpersonationUser | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const users = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("it");
    return initialUsers.filter((user) => {
      const roleMatches =
        roleFilter === "all" ||
        (roleFilter === "agency" && user.agencyRoles.length > 0) ||
        (roleFilter === "traveler" && user.isTraveler) ||
        (roleFilter === "superadmin" && user.platformRole === "superadmin") ||
        (roleFilter === "invited" && user.status === "invited");
      const queryMatches =
        !needle ||
        [user.name, user.username, user.email, user.phone, ...user.agencyNames].some((value) =>
          value.toLocaleLowerCase("it").includes(needle),
        );
      return roleMatches && queryMatches;
    });
  }, [initialUsers, query, roleFilter]);
  const roleCounts = useMemo(
    () => ({
      all: initialUsers.length,
      agency: initialUsers.filter((user) => user.agencyRoles.length > 0).length,
      traveler: initialUsers.filter((user) => user.isTraveler).length,
      superadmin: initialUsers.filter((user) => user.platformRole === "superadmin").length,
      invited: initialUsers.filter((user) => user.status === "invited").length,
    }),
    [initialUsers],
  );

  useEffect(() => {
    if (!selectedUser) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setSelectedUser(null);
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
          ) ?? [],
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [selectedUser, busy]);

  async function impersonate(user: ImpersonationUser) {
    setBusy(user.id);
    setError("");
    try {
      const response = await fetch("/api/admin/platform/impersonation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: user.id }),
      });
      const result = (await response.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
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
        <div>
          <small>CONTROLLO ACCESSI</small>
          <h1>Login come utente</h1>
          <p>Verifica l’applicazione usando esattamente il profilo e i permessi di un utente censito.</p>
        </div>
      </section>
      <div className="impersonationWarning">
        <ShieldCheck />
        <span>
          <b>Sessione controllata</b>
          <small>
            Non servono le credenziali dell’utente. Una fascia viola consentirà sempre di tornare al superadmin.
          </small>
        </span>
      </div>
      {error && !selectedUser && (
        <div className="superadminMessage error" role="alert">
          <CircleAlert size={18} />
          {error}
        </div>
      )}
      <div className="impersonationFilters" role="group" aria-label="Filtra gli utenti per ruolo">
        <button
          type="button"
          className={roleFilter === "all" ? "active" : ""}
          aria-pressed={roleFilter === "all"}
          onClick={() => setRoleFilter("all")}
        >
          Tutti <b>{roleCounts.all}</b>
        </button>
        <button
          type="button"
          className={roleFilter === "agency" ? "active" : ""}
          aria-pressed={roleFilter === "agency"}
          onClick={() => setRoleFilter("agency")}
        >
          Agenzia <b>{roleCounts.agency}</b>
        </button>
        <button
          type="button"
          className={roleFilter === "traveler" ? "active" : ""}
          aria-pressed={roleFilter === "traveler"}
          onClick={() => setRoleFilter("traveler")}
        >
          Viaggiatori <b>{roleCounts.traveler}</b>
        </button>
        <button
          type="button"
          className={roleFilter === "superadmin" ? "active" : ""}
          aria-pressed={roleFilter === "superadmin"}
          onClick={() => setRoleFilter("superadmin")}
        >
          Superadmin <b>{roleCounts.superadmin}</b>
        </button>
        <button
          type="button"
          className={roleFilter === "invited" ? "active" : ""}
          aria-pressed={roleFilter === "invited"}
          onClick={() => setRoleFilter("invited")}
        >
          Da attivare <b>{roleCounts.invited}</b>
        </button>
      </div>
      <div className="registryTools impersonationTools">
        <label className="userSearch" htmlFor="user-search">
          <Search />
          <span className="srOnly">Cerca utente</span>
          <input
            id="user-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, username, agenzia o telefono…"
            autoComplete="off"
          />
        </label>
        <span className="registryResultCount" aria-live="polite">
          {users.length} {users.length === 1 ? "utente" : "utenti"}
        </span>
        {(query || roleFilter !== "all") && (
          <button
            type="button"
            className="registryClear"
            onClick={() => {
              setQuery("");
              setRoleFilter("all");
            }}
          >
            <X /> Azzera filtri
          </button>
        )}
      </div>
      <section className="impersonationList">
        {users.map((user) => (
          <article key={user.id}>
            <i>{user.initials || user.name.slice(0, 2).toUpperCase()}</i>
            <span className="impersonationIdentity">
              <strong>{user.name}</strong>
              <small>
                @{user.username} · {user.email || "Email non indicata"}
              </small>
              <em>{user.agencyNames.length ? user.agencyNames.join(" · ") : "Nessuna agenzia associata"}</em>
            </span>
            <span className="impersonationRoles">
              {user.platformRole === "superadmin" && (
                <b>
                  <ShieldCheck /> Superadmin
                </b>
              )}
              {user.agencyRoles.map((role) => (
                <b key={role}>
                  <UsersRound /> {agencyRoleLabels[role] || role}
                </b>
              ))}
              {user.isTraveler && (
                <b>
                  <UserRound /> Viaggiatore
                </b>
              )}
              {user.status === "invited" && <b className="pending">Invitato</b>}
            </span>
            <button
              type="button"
              onClick={() => {
                setError("");
                setSelectedUser(user);
              }}
              disabled={Boolean(busy)}
              title={user.status === "invited" ? "Accedi al profilo prima dell’attivazione" : undefined}
              aria-label={`Accedi come ${user.name}`}
            >
              <LogIn /> Accedi come
            </button>
          </article>
        ))}
        {users.length === 0 && (
          <div className="registryEmpty">
            <UserRound />
            <h2>Nessun utente trovato</h2>
            <p>Nessun profilo corrisponde ai filtri selezionati{query ? ` e alla ricerca “${query}”` : ""}.</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setRoleFilter("all");
              }}
            >
              <X /> Azzera filtri
            </button>
          </div>
        )}
      </section>
      {selectedUser && (
        <div
          className="agencyDeleteBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setSelectedUser(null);
          }}
        >
          <section
            ref={dialogRef}
            className="agencyDeleteDialog impersonationDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="impersonation-title"
          >
            <button
              type="button"
              className="agencyDeleteClose"
              aria-label="Chiudi"
              disabled={Boolean(busy)}
              onClick={() => setSelectedUser(null)}
            >
              <X />
            </button>
            <i>
              <LogIn />
            </i>
            <small>SESSIONE TEMPORANEA</small>
            <h2 id="impersonation-title">Accedere come {selectedUser.name}?</h2>
            <p>
              La nuova sessione avrà gli stessi ruoli e permessi di questo utente. Potrai tornare in qualsiasi momento
              al profilo superadmin.
            </p>
            <div className="impersonationTarget">
              <UserRound />
              <span>
                <b>{selectedUser.name}</b>
                <small>{selectedUser.email || "Email non indicata"}</small>
              </span>
            </div>
            {error && (
              <div className="superadminMessage error dialogMessage" role="alert">
                <CircleAlert size={18} />
                {error}
              </div>
            )}
            <div>
              <button
                ref={cancelRef}
                type="button"
                className="secondary"
                disabled={Boolean(busy)}
                onClick={() => setSelectedUser(null)}
              >
                Annulla
              </button>
              <button
                type="button"
                className="confirmImpersonation"
                disabled={Boolean(busy)}
                onClick={() => void impersonate(selectedUser)}
              >
                {busy === selectedUser.id ? (
                  <>
                    <LoaderCircle className="spin" /> Accesso in corso…
                  </>
                ) : (
                  <>
                    <LogIn /> Avvia sessione
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
