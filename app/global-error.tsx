"use client";

import { useEffect } from "react";

/** Replaces the root layout when it fails, so it carries its own minimal styles. Follows the OS colour scheme. */
export default function GlobalError({ error, retry, reset }: { error: unknown; retry?: () => void; reset?: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "Canvas",
          color: "CanvasText",
          colorScheme: "light dark",
        }}
      >
        <title>Something went wrong | TipMUSD</title>
        <main style={{ maxWidth: 440, padding: 24 }}>
          <h1 style={{ fontSize: 32, margin: 0, letterSpacing: "-0.02em" }}>Something went wrong</h1>
          <p style={{ fontSize: 17, opacity: 0.75, lineHeight: 1.5 }}>TipMUSD hit a problem loading this page. No money moved because of it.</p>
          <button
            type="button"
            onClick={() => (retry ?? reset)?.()}
            style={{ marginTop: 16, minHeight: 48, padding: "0 24px", borderRadius: 999, border: 0, background: "#cf3d0b", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
