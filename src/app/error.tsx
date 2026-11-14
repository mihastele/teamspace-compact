"use client";

import React, { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Client ErrorBoundary caught an unhandled error:", error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#0f172a",
        color: "#f8fafc",
      }}
    >
      <div
        style={{
          maxWidth: 600,
          width: "100%",
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
        }}
      >
        <h2 style={{ margin: "0 0 12px 0", fontSize: 18, color: "#f87171" }}>
          Something went wrong while loading this page
        </h2>
        <p style={{ margin: "0 0 16px 0", fontSize: 14, color: "#cbd5e1", lineHeight: 1.5 }}>
          {error?.message || "An unexpected error occurred."}
        </p>
        {error?.stack && (
          <pre
            style={{
              padding: 12,
              background: "#0f172a",
              borderRadius: 6,
              fontSize: 11,
              color: "#94a3b8",
              overflowX: "auto",
              maxHeight: 200,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {error.stack}
          </pre>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "8px 16px",
              background: "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: 6,
              fontWeight: 500,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            style={{
              padding: "8px 16px",
              background: "#334155",
              color: "#f8fafc",
              border: "none",
              borderRadius: 6,
              fontWeight: 500,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
