import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, Camera, Keyboard, Loader2 } from "lucide-react";

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

// Detect iOS/Safari — live video scanning is unreliable there; use photo-capture instead.
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

type Mode = "photo" | "live" | "manual";

/** Resize a File to a canvas with max side ≤ maxPx and return a data URL.
 *  Also applies any EXIF rotation by relying on CSS image-orientation (Safari handles it). */
function fileToResizedDataUrl(file: File, maxPx = 1400): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
      const w = Math.round((img.naturalWidth || img.width) * scale);
      const h = Math.round((img.naturalHeight || img.height) * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}

export function BarcodeScanner({ open, onClose, onScan }: BarcodeScannerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manualCode, setManualCode] = useState("");
  const [mode, setMode] = useState<Mode>("photo");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  // Default to "photo" on iOS, "live" on everything else
  useEffect(() => {
    if (open) {
      setMode(isIOS() ? "photo" : "live");
      setError("");
      setManualCode("");
    }
  }, [open]);

  // ── Live camera mode (desktop / Android Chrome) ─────────────────────────────
  useEffect(() => {
    if (!open || mode !== "live") return;
    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | null = null;
    setError("");

    reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
      if (result) {
        onScan(result.getText());
        onClose();
      }
    })
      .then((c) => { controls = c; })
      .catch(() => {
        // Fall back to photo-capture if live scanning isn't supported
        setMode("photo");
      });

    return () => { controls?.stop(); };
  }, [open, mode]);

  // ── Photo-capture mode ────────────────────────────────────────────────────
  async function handleFileCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setError("");

    try {
      // ① Native BarcodeDetector (Safari 17+, Chrome) — fastest path
      if ("BarcodeDetector" in window) {
        const detector = new (window as any).BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "qr_code", "data_matrix", "itf"],
        });
        const bitmap = await createImageBitmap(file);
        const results: any[] = await detector.detect(bitmap);
        if (results.length > 0) {
          onScan(results[0].rawValue);
          onClose();
          return;
        }
        // BarcodeDetector found nothing — fall through to ZXing
      }

      // ② ZXing — resize image first so iOS 12MP photos don't blow up the canvas
      const dataUrl = await fileToResizedDataUrl(file, 1400);
      const reader = new BrowserMultiFormatReader();
      // decodeFromImageUrl creates a new <img>, sets src, waits for load, then decodes
      const result = await (reader as any).decodeFromImageUrl(dataUrl);

      if (result) {
        onScan(result.getText());
        onClose();
      } else {
        setError("No barcode found. Try a clearer photo or enter the number manually.");
      }
    } catch {
      setError("Couldn't read barcode. Try a clearer photo or enter the number manually.");
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleManualSubmit() {
    const code = manualCode.trim();
    if (code) {
      onScan(code);
      onClose();
      setManualCode("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-primary" />
            Scan Barcode
          </DialogTitle>
        </DialogHeader>

        {/* Mode switcher */}
        <div className="flex gap-2 mb-3">
          <Button
            variant={mode === "photo" ? "default" : "outline"}
            size="sm"
            onClick={() => { setMode("photo"); setError(""); }}
          >
            <Camera className="w-3 h-3 mr-1" /> Photo
          </Button>
          <Button
            variant={mode === "live" ? "default" : "outline"}
            size="sm"
            onClick={() => { setMode("live"); setError(""); }}
          >
            <ScanLine className="w-3 h-3 mr-1" /> Live
          </Button>
          <Button
            variant={mode === "manual" ? "default" : "outline"}
            size="sm"
            onClick={() => { setMode("manual"); setError(""); }}
          >
            <Keyboard className="w-3 h-3 mr-1" /> Manual
          </Button>
        </div>

        {/* ── Photo capture ── */}
        {mode === "photo" && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileCapture}
            />
            <Button
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={scanning}
            >
              {scanning ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reading barcode…</>
              ) : (
                <><Camera className="w-4 h-4 mr-2" /> Take Photo of Barcode</>
              )}
            </Button>
            {error && <p className="text-destructive text-sm text-center">{error}</p>}
            <p className="text-xs text-muted-foreground text-center">
              Point your camera at the barcode and take a photo
            </p>
          </div>
        )}

        {/* ── Live camera ── */}
        {mode === "live" && (
          <div className="relative">
            <video
              ref={videoRef}
              className="w-full rounded-lg aspect-square object-cover bg-black"
              playsInline
              muted
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border-2 border-primary rounded-lg opacity-60" />
            </div>
            {error && <p className="text-destructive text-sm mt-2 text-center">{error}</p>}
            <p className="text-xs text-muted-foreground text-center mt-2">
              Point camera at barcode — auto-detects
            </p>
          </div>
        )}

        {/* ── Manual entry ── */}
        {mode === "manual" && (
          <div className="space-y-3">
            <Input
              placeholder="Enter barcode number"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
              autoFocus
            />
            <Button
              className="w-full"
              onClick={handleManualSubmit}
              disabled={!manualCode.trim()}
            >
              Look Up
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
