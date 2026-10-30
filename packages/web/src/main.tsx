import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Three.js only loads when you open Founders.
const Founders = lazy(() => import("./founders/Founders").then((m) => ({ default: m.Founders })));

/** Two worlds: Kettle Island at #/, Founders at #/founders. */
function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.startsWith("#/founders") ? (
    <Suspense fallback={<div className="app"><p className="empty">Rowing out to the islet...</p></div>}>
      <Founders />
    </Suspense>
  ) : (
    <App />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
