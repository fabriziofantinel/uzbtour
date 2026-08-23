"use client";

import { useEffect, useState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";

type Identity = {
  name: string;
  impersonation: { actorName: string; expiresAt: string } | null;
};

export default function ImpersonationBanner() {
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (active) setIdentity(payload?.user ?? null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!identity?.impersonation) return null;
  return (
    <aside className="impersonationBanner" role="status">
      <span><ShieldCheck size={17}/><b>{identity.impersonation.actorName}</b> sta operando come <strong>{identity.name}</strong></span>
      <form action="/api/auth/impersonation/stop" method="post">
        <button type="submit"><LogIn size={16}/> Torna al superadmin</button>
      </form>
    </aside>
  );
}
