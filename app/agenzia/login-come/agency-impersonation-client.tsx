"use client";

import { ArrowLeft, LogIn, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { accessibleBrandColor, validBrandColor } from "@/lib/platform/branding-ui";

type Traveler = { id:string; name:string; username:string; email:string; status:string; agencyName:string; departureTitles:string[] };

export default function AgencyImpersonationClient({ users, primaryColor }: { users: Traveler[]; primaryColor: string }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Traveler|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = useMemo(() => users.filter((user) =>
    [user.name,user.username,user.email,...user.departureTitles].join(" ").toLowerCase().includes(query.toLowerCase())
  ), [query, users]);
  async function loginAs() {
    if (!selected) return;
    setBusy(true); setError("");
    const response = await fetch("/api/admin/platform/agency-impersonation", {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({targetUserId:selected.id}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "Accesso non riuscito"); setBusy(false); return; }
    window.location.href = result.redirectUrl;
  }
  const brand = validBrandColor(primaryColor);
  const style = { "--agency-ui": brand, "--agency-on-ui": accessibleBrandColor(brand) } as CSSProperties;
  return <main className="agencyLoginAs" style={style}>
    <header><a href="/agenzia"><ArrowLeft/> Pannello agenzia</a><div><small>SESSIONE DI ASSISTENZA</small><h1>Login come viaggiatore</h1><p>Puoi accedere solo come viaggiatore associato ai viaggi della tua agenzia.</p></div></header>
    <section>
      <label className="agencyLoginSearch"><Search/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Cerca viaggiatore o viaggio"/></label>
      {error && <p className="agencyLoginError" role="alert">{error}</p>}
      <div className="agencyLoginList">{filtered.map((user)=><article key={user.id}>
        <div><b>{user.name}</b><span>{user.username || user.email}</span><small>{user.departureTitles.join(" · ")}</small></div>
        <button disabled={user.status!=="active"} onClick={()=>setSelected(user)}><LogIn/> Accedi come</button>
      </article>)}</div>
      {!filtered.length && <p>Nessun viaggiatore disponibile.</p>}
    </section>
    {selected && <div className="agencyLoginOverlay" onMouseDown={(e)=>{if(e.target===e.currentTarget)setSelected(null)}}><div role="dialog" aria-modal="true">
      <button className="close" aria-label="Chiudi" onClick={()=>setSelected(null)}><X/></button><h2>Accedere come {selected.name}?</h2>
      <p>La sessione avrà esattamente le autorizzazioni del viaggiatore.</p><footer><button onClick={()=>setSelected(null)}>Annulla</button><button onClick={loginAs} disabled={busy}>{busy?"Accesso…":"Conferma accesso"}</button></footer>
    </div></div>}
  </main>;
}
