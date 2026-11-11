import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Game } from "./Game";
import "./styles.css";

// Three.js only loads when you open Founders.
const Founders = lazy(() => import("./founders/Founders").then((m) => ({ default: m.Founders })));
const History = lazy(() => import("./history/History").then((m) => ({ default: m.History })));

/** The live game at #/, the lab (every analysis view) at #/lab, Founders at #/founders, the causal history at #/history. */
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
  ) : hash.startsWith("#/history") ? (
    <Suspense fallback={<div className="app"><p className="empty">Reading the record...</p></div>}>
      <History />
    </Suspense>
  ) : hash.startsWith("#/lab") ? (
    <App />
  ) : (
    <Game />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
