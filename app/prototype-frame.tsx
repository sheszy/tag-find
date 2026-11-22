"use client";

import { useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PrototypeFrame({ src }: { src: string }) {
  const [loading, setLoading] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const installPromptRef = useRef<InstallPromptEvent | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const handleLoad = () => {
      setLoading(false);
      frame.contentWindow?.postMessage(
        {
          type: "locatelly-install-state",
          outcome: window.matchMedia("(display-mode: standalone)").matches
            ? "installed"
            : installPromptRef.current
              ? "available"
              : "unavailable",
        },
        window.location.origin,
      );
    };

    frame.addEventListener("load", handleLoad);
    if (frame.contentDocument?.readyState === "complete") handleLoad();
    return () => frame.removeEventListener("load", handleLoad);
  }, [src]);

  useEffect(() => {
    const postState = (outcome: string) => {
      frameRef.current?.contentWindow?.postMessage(
        { type: "locatelly-install-state", outcome },
        window.location.origin,
      );
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      installPromptRef.current = event as InstallPromptEvent;
      postState("available");
    };

    const handleInstalled = () => {
      installPromptRef.current = null;
      postState("installed");
    };

    const handleMessage = async (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin
        || event.source !== frameRef.current?.contentWindow
        || event.data?.type !== "locatelly-install-request"
      ) {
        return;
      }

      const prompt = installPromptRef.current;
      if (!prompt) {
        postState("unavailable");
        return;
      }

      installPromptRef.current = null;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        postState(choice.outcome);
      } catch (error) {
        console.error("Could not open the Locatelly install prompt:", error);
        postState("error");
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return (
    <div className="frame-shell" aria-busy={loading}>
      {loading && (
        <div className="frame-skeleton" role="status" aria-label="Loading Locatelly">
          <div className="frame-skeleton-header skeleton-block" />
          <div className="frame-skeleton-grid">
            <div className="skeleton-block" />
            <div className="skeleton-block" />
            <div className="skeleton-block" />
          </div>
          <div className="skeleton-block frame-skeleton-content" />
          <span className="sr-only">Loading your saved Locatelly dashboard…</span>
        </div>
      )}
      <iframe
        ref={frameRef}
        className="app-frame"
        src={src}
        title="Locatelly dashboard"
        allow="camera; geolocation; accelerometer; gyroscope"
        onLoad={() => setLoading(false)}
      />
    </div>
  );
}
