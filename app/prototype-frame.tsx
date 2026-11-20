"use client";

import { useEffect, useRef, useState } from "react";

export function PrototypeFrame({ src }: { src: string }) {
  const [loading, setLoading] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const handleLoad = () => setLoading(false);
    frame.addEventListener("load", handleLoad);
    if (frame.contentDocument?.readyState === "complete") handleLoad();
    return () => frame.removeEventListener("load", handleLoad);
  }, [src]);

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
