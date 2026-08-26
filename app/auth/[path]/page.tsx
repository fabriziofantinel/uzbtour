import { notFound, redirect } from "next/navigation";
import { AuthView } from "@neondatabase/auth-ui";
import { authViewPaths, type AuthViewPath } from "@neondatabase/auth-ui/server";
import AuthProvider from "../auth-provider";
import "@neondatabase/auth-ui/css";

const allowedPaths = new Set<string>([
  authViewPaths.FORGOT_PASSWORD,
  authViewPaths.RESET_PASSWORD,
  authViewPaths.EMAIL_VERIFICATION,
  authViewPaths.CALLBACK
]);

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (path === authViewPaths.SIGN_IN) redirect("/login");
  if (!allowedPaths.has(path)) notFound();

  return (
    <main className="authUtilityPage">
      <AuthProvider>
        <AuthView path={path as AuthViewPath}/>
      </AuthProvider>
    </main>
  );
}
