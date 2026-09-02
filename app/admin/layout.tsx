import Link from "next/link";
import { redirect } from "next/navigation";
import { Accessibility, Building2, Gauge, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { PlatformAuthorizationError, requireSuperAdmin } from "@/lib/platform/authorization";
import "./superadmin.css";
import "./agency-branding.css";
import "../smf-2026.css";

export const dynamic = "force-dynamic";

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  let actor;
  try {
    actor = await requireSuperAdmin();
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) redirect("/");
    throw error;
  }

  return (
    <main className="superadminPage">
      <a className="agidSkipLink" href="#main-content">
        Salta al contenuto principale
      </a>
      <header className="superadminTopbar">
        <Link className="superadminBrand" href="/admin">
          <span>SMF</span>
          <div>
            <strong>SMF Travel</strong>
            <small>SUPERADMIN</small>
          </div>
        </Link>
        <nav aria-label="Navigazione superadmin">
          <Link href="/admin">
            <Gauge size={17} /> Riepilogo
          </Link>
          <Link href="/admin/agenzie">
            <Building2 size={17} /> Agenzie
          </Link>
          <Link href="/admin/utenti">
            <LogIn size={17} /> Login come
          </Link>
          <Link href="/accessibilita">
            <Accessibility size={17} /> Accessibilità
          </Link>
        </nav>
        <div className="superadminActor">
          <ShieldCheck size={17} />
          <b>{actor.name}</b>
          <form action="/api/auth/logout" method="post">
            <button aria-label="Esci" title="Esci">
              <LogOut size={17} />
            </button>
          </form>
        </div>
      </header>
      <div id="main-content" tabIndex={-1}>
        {children}
      </div>
    </main>
  );
}
