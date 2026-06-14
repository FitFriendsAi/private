// Live camera scanner (web only).
//
// - mode "barcode": opens a live preview and continuously decodes via ZXing,
//   auto-capturing the moment a barcode is recognised (works on iOS Safari,
//   which has no native BarcodeDetector).
// - mode "label":   live preview that auto-captures when the frame is held
//   steady (sharp + still), plus a manual "Capture" button.
//
// Everything is built imperatively in the DOM (like the existing hidden-file-
// input flow) since react-native-web has no <video>. Always degrades to the
// caller's existing photo-capture flow: if the camera is unavailable/denied or
// ZXing can't start, it resolves { type: "fallback" }.

import { BrowserMultiFormatReader } from "@zxing/browser";

export type LiveScanMode = "barcode" | "label";

export type LiveScanResult =
  | { type: "barcode"; code: string; snapshot: string } // snapshot = JPEG data URL
  | { type: "image"; file: File }                         // captured label/meal photo
  | { type: "cancel" }                                    // user dismissed
  | { type: "fallback" };                                 // unsupported → use OS camera

function dataUrlToFile(dataUrl: string, name: string): File {
  const bstr = atob(dataUrl.split(",")[1]);
  const u8 = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
  return new File([u8], name, { type: "image/jpeg" });
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.textContent =
    "@keyframes flsweep{0%{transform:translateY(0)}50%{transform:translateY(var(--fl-h,180px))}100%{transform:translateY(0)}}" +
    "@keyframes flpulse{0%,100%{opacity:.4}50%{opacity:1}}";
  document.head.appendChild(s);
}

export async function startLiveScan(opts: { mode: LiveScanMode; accent?: string }): Promise<LiveScanResult> {
  const { mode } = opts;
  const accent = opts.accent || "#34d399";

  if (typeof document === "undefined" || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { type: "fallback" };
  }

  injectStyles();

  return new Promise<LiveScanResult>((resolve) => {
    let settled = false;
    let raf = 0;
    let ownStream: MediaStream | null = null;
    let controls: { stop: () => void } | null = null;

    // ── Overlay DOM ──────────────────────────────────────────────────────────
    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:center;overflow:hidden;";

    const video = document.createElement("video");
    video.setAttribute("playsinline", "true");
    (video as any).playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;";
    root.appendChild(video);

    // Dim scrim so the framed cut-out reads as the target area
    const scrim = document.createElement("div");
    scrim.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0.45);";
    root.appendChild(scrim);

    // Scan frame
    const frameW = Math.min(window.innerWidth * 0.8, 360);
    const frameH = mode === "barcode" ? Math.round(frameW * 0.62) : Math.min(window.innerHeight * 0.6, frameW * 1.25);
    const frame = document.createElement("div");
    frame.style.cssText =
      `position:relative;width:${frameW}px;height:${frameH}px;border-radius:18px;overflow:hidden;` +
      `box-shadow:0 0 0 9999px rgba(0,0,0,0.45);`;
    root.appendChild(frame);

    const corner = (css: string) => {
      const c = document.createElement("div");
      c.style.cssText = `position:absolute;width:28px;height:28px;border-color:${accent};${css}`;
      frame.appendChild(c);
    };
    corner(`top:10px;left:10px;border-top:3px solid ${accent};border-left:3px solid ${accent};border-top-left-radius:8px`);
    corner(`top:10px;right:10px;border-top:3px solid ${accent};border-right:3px solid ${accent};border-top-right-radius:8px`);
    corner(`bottom:10px;left:10px;border-bottom:3px solid ${accent};border-left:3px solid ${accent};border-bottom-left-radius:8px`);
    corner(`bottom:10px;right:10px;border-bottom:3px solid ${accent};border-right:3px solid ${accent};border-bottom-right-radius:8px`);

    if (mode === "barcode") {
      const sweepWrap = document.createElement("div");
      sweepWrap.style.cssText =
        `position:absolute;left:0;right:0;top:0;--fl-h:${frameH - 4}px;animation:flsweep 2.4s ease-in-out infinite;`;
      const line = document.createElement("div");
      line.style.cssText = `height:2.5px;background:${accent};box-shadow:0 0 10px ${accent};`;
      sweepWrap.appendChild(line);
      frame.appendChild(sweepWrap);
    }

    // Status
    const status = document.createElement("div");
    status.style.cssText =
      "position:absolute;left:0;right:0;bottom:120px;text-align:center;color:#fff;" +
      "font-family:-apple-system,Manrope,system-ui,sans-serif;font-size:15px;font-weight:600;padding:0 24px;";
    status.textContent = mode === "barcode" ? "Point at a barcode" : "Hold steady to capture";
    root.appendChild(status);

    // Buttons
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "position:absolute;left:0;right:0;bottom:40px;display:flex;gap:12px;justify-content:center;padding:0 24px;";
    const mkBtn = (label: string, primary: boolean) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "font-family:-apple-system,Manrope,system-ui,sans-serif;font-size:15px;font-weight:700;border:none;" +
        "border-radius:14px;padding:14px 20px;cursor:pointer;" +
        (primary ? `background:${accent};color:#0a0a0a;` : "background:rgba(255,255,255,0.16);color:#fff;");
      return b;
    };

    // Close (X)
    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Close scanner");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText =
      "position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:20px;border:none;cursor:pointer;" +
      "background:rgba(255,255,255,0.16);color:#fff;font-size:18px;line-height:40px;";
    root.appendChild(closeBtn);

    document.body.appendChild(root);

    // ── lifecycle ────────────────────────────────────────────────────────────
    const finish = (result: LiveScanResult) => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(raf);
      try { controls?.stop(); } catch {}
      try { ownStream?.getTracks().forEach(t => t.stop()); } catch {}
      try { (video.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop()); } catch {}
      try { document.body.removeChild(root); } catch {}
      resolve(result);
    };

    const snapshot = (): string => {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(video, 0, 0, w, h);
      return c.toDataURL("image/jpeg", 0.85);
    };

    closeBtn.onclick = () => finish({ type: "cancel" });

    // ── mode: barcode (continuous ZXing) ─────────────────────────────────────
    if (mode === "barcode") {
      const photoBtn = mkBtn("Take a photo instead", false);
      photoBtn.onclick = () => finish({ type: "fallback" });
      btnRow.appendChild(photoBtn);
      root.appendChild(btnRow);

      const reader = new BrowserMultiFormatReader();
      reader
        .decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          video,
          (result) => {
            if (result && !settled) {
              const snap = snapshot();
              finish({ type: "barcode", code: result.getText(), snapshot: snap });
            }
          },
        )
        .then((c) => { controls = c; })
        .catch(() => finish({ type: "fallback" }));
      return;
    }

    // ── mode: label (getUserMedia + steady auto-capture) ─────────────────────
    const captureBtn = mkBtn("Capture", true);
    captureBtn.onclick = () => finish({ type: "image", file: dataUrlToFile(snapshot(), "label.jpg") });
    btnRow.appendChild(captureBtn);
    root.appendChild(btnRow);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (settled) { stream.getTracks().forEach(t => t.stop()); return; }
        ownStream = stream;
        video.srcObject = stream;
        video.play().catch(() => {});

        // Detect a sharp, still frame: low frame-to-frame difference held for ~1s.
        const small = document.createElement("canvas");
        small.width = 64; small.height = 48;
        const sctx = small.getContext("2d", { willReadFrequently: true })!;
        let prev: Uint8ClampedArray | null = null;
        let stableSince = 0;
        const startedAt = performance.now();

        const loop = () => {
          if (settled) return;
          if (video.readyState >= 2 && video.videoWidth) {
            sctx.drawImage(video, 0, 0, 64, 48);
            const cur = sctx.getImageData(0, 0, 64, 48).data;
            if (prev) {
              let diff = 0;
              for (let i = 0; i < cur.length; i += 4) diff += Math.abs(cur[i] - prev[i]);
              const meanDiff = diff / (64 * 48);
              const now = performance.now();
              if (meanDiff < 6) {
                if (!stableSince) stableSince = now;
                else if (now - stableSince > 900 && now - startedAt > 1800) {
                  status.textContent = "Captured";
                  finish({ type: "image", file: dataUrlToFile(snapshot(), "label.jpg") });
                  return;
                } else {
                  status.textContent = "Hold steady…";
                }
              } else {
                stableSince = 0;
                status.textContent = "Point at the nutrition label";
              }
            }
            prev = new Uint8ClampedArray(cur);
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch(() => finish({ type: "fallback" }));
  });
}
