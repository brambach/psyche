// Pictures of the world: a small one to keep with a save, and a postcard to share.

/** The town's canvas, if there is one on screen. */
const stage = () => document.querySelector<HTMLCanvasElement>(".g-stage canvas");

/** A small JPEG of what is on screen now, as a data URL, to keep with a save. */
export function thumbnail(width = 384): string | undefined {
  const src = stage();
  if (!src || !src.width || !src.height) return undefined;
  try {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = Math.round(width * 0.5625);
    const g = c.getContext("2d")!;
    // Cover: fill the frame, cropping whichever way the screen is longer.
    const k = Math.max(c.width / src.width, c.height / src.height);
    const w = src.width * k, h = src.height * k;
    g.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
    return c.toDataURL("image/jpeg", 0.72);
  } catch {
    return undefined;
  }
}

export interface Caption {
  /** "Hollow Bay" */
  title: string;
  /** "Year 3, autumn · 15 people" */
  line: string;
  /** "region-11" */
  code?: string;
}

/**
 * A postcard: the view as it is, with a quiet band along the bottom saying where and when this is.
 * Returns a PNG as a blob (or undefined if the picture could not be read).
 */
export async function postcard(caption?: Caption): Promise<Blob | undefined> {
  const src = stage();
  if (!src || !src.width || !src.height) return undefined;
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0);
  if (caption) {
    const u = c.height / 100;
    const band = g.createLinearGradient(0, c.height - 22 * u, 0, c.height);
    band.addColorStop(0, "rgba(6,10,14,0)");
    band.addColorStop(1, "rgba(6,10,14,0.78)");
    g.fillStyle = band;
    g.fillRect(0, c.height - 22 * u, c.width, 22 * u);
    const display = '"Bricolage Grotesque", "Avenir Next", "Segoe UI", system-ui, sans-serif';
    const mono = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = "alphabetic";
    g.fillStyle = "#f4f6f4";
    g.font = `700 ${4.6 * u}px ${display}`;
    g.fillText(caption.title, 4 * u, c.height - 7.6 * u);
    g.fillStyle = "rgba(244,246,244,0.82)";
    g.font = `${2.2 * u}px ${mono}`;
    g.fillText(caption.line, 4 * u, c.height - 3.8 * u);
    g.textAlign = "right";
    g.fillStyle = "#ffd34d";
    g.font = `700 ${2.6 * u}px ${display}`;
    g.fillText("Psyche", c.width - 4 * u, c.height - 7.2 * u);
    if (caption.code) {
      g.fillStyle = "rgba(244,246,244,0.7)";
      g.font = `${2 * u}px ${mono}`;
      g.fillText(caption.code, c.width - 4 * u, c.height - 3.8 * u);
    }
  }
  return new Promise((done) => c.toBlob((b) => done(b ?? undefined), "image/png"));
}

/** Hand the browser a file to save. */
export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
