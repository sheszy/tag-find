"use client";

import { useEffect, useRef, useState } from "react";

export default function AuthCallback() {
  const started = useRef(false);
  const [message, setMessage] = useState("Completing Google sign-in…");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function completeSignIn() {
      try {
        const callbackUrl = new URL(window.location.href);
        const providerError =
          callbackUrl.searchParams.get("error_description") ||
          callbackUrl.searchParams.get("error");
        const code = callbackUrl.searchParams.get("code");
        const codeVerifier = sessionStorage.getItem("locatelly_google_code_verifier");
        window.history.replaceState(null, "", "/auth/callback");
        if (providerError) throw new Error(providerError);
        if (!code || !codeVerifier) {
          throw new Error("The Google sign-in session expired. Please try again.");
        }

        const response = await fetch("/api/account/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "oauth-exchange", code, codeVerifier }),
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.session?.accessToken || !result.session?.refreshToken) {
          throw new Error(result.error || "Could not finish Google sign-in.");
        }

        const expiresIn = Number(result.session.expiresIn || 3600);
        localStorage.setItem("locatelly_account_session", JSON.stringify({
          ...result.session,
          expiresAt: Date.now() + expiresIn * 1000,
        }));
        sessionStorage.removeItem("locatelly_google_code_verifier");
        window.location.replace("/");
      } catch (error) {
        sessionStorage.removeItem("locatelly_google_code_verifier");
        setHasError(true);
        setMessage(error instanceof Error ? error.message : "Could not finish Google sign-in.");
      }
    }

    void completeSignIn();
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "#f7f0dd", color: "#1e293b" }}>
      <section style={{ width: "min(100%, 440px)", border: "3px solid #1e293b", background: "#fffaf0", padding: "28px", boxShadow: "8px 8px 0 #1e293b" }}>
        <h1 style={{ margin: 0, fontSize: "24px" }}>Locatelly sign-in</h1>
        <p role={hasError ? "alert" : "status"} style={{ lineHeight: 1.6 }}>{message}</p>
        {hasError && <a href="/" style={{ color: "#047857", fontWeight: 700 }}>Return to Locatelly</a>}
      </section>
    </main>
  );
}
