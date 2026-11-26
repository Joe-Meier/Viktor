"use client";

import dynamic from "next/dynamic";

// Threads live in localStorage, so the app renders in the browser only.
const UncleApp = dynamic(() => import("./UncleApp"), {
  ssr: false,
  loading: () => <div className="boot">Loading threads…</div>,
});

export default function ClientApp() {
  return <UncleApp />;
}
