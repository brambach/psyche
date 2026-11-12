import { Component, lazy, StrictMode, Suspense, useEffect, useState, type ReactNode } from "react";
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

/**
 * The last line of defence: if anything throws while drawing, say so on the page with the error,
 * instead of React unmounting everything and leaving a blank white screen.
 */
class Crash extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Psyche crashed while drawing:", error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app crash" style={{ maxWidth: 720, margin: "64px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif", color: "#222" }}>
        <h1 style={{ fontSize: 22 }}>Psyche hit an error while drawing the page</h1>
        <p>The world is still running on the server. This is what went wrong in the browser:</p>
        <pre style={{ whiteSpace: "pre-wrap", background: "#f4f1ea", padding: 12, borderRadius: 6, fontSize: 13 }}>
          {String(error.message || error)}
          {"\n\n"}
          {(error.stack ?? "").split("\n").slice(1, 6).join("\n")}
        </pre>
        <p>
          <button onClick={() => location.reload()}>Reload</button>{" "}
          <a href="#/lab" onClick={() => setTimeout(() => location.reload(), 0)}>Open the lab instead</a>
        </p>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Crash>
      <Root />
    </Crash>
  </StrictMode>,
);
