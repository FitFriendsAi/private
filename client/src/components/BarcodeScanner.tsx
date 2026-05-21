import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, Keyboard } from "lucide-react";

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

export function BarcodeScanner({ open, onClose, onScan }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [mode, setMode] = useState<"camera" | "manual">("camera");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || mode !== "camera") return;

    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;
    setError("");
    let controls: { stop: () => void } | null = null;

    reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
      if (result) {
        onScan(result.getText());
        onClose();
      }
    }).then((c) => {
      controls = c;
    }).catch(() => {
      setError("Camera not available. Use manual entry below.");
      setMode("manual");
    });

    return () => {
      controls?.stop();
    };
  }, [open, mode]);

  function handleManualSubmit() {
    if (manualCode.trim()) {
      onScan(manualCode.trim());
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

        <div className="flex gap-2 mb-3">
          <Button variant={mode === "camera" ? "default" : "outline"} size="sm" onClick={() => setMode("camera")}>Camera</Button>
          <Button variant={mode === "manual" ? "default" : "outline"} size="sm" onClick={() => setMode("manual")}>
            <Keyboard className="w-3 h-3 mr-1" /> Manual
          </Button>
        </div>

        {mode === "camera" ? (
          <div className="relative">
            <video ref={videoRef} className="w-full rounded-lg aspect-square object-cover bg-black" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border-2 border-primary rounded-lg opacity-60" />
            </div>
            {error && <p className="text-destructive text-sm mt-2">{error}</p>}
            <p className="text-xs text-muted-foreground text-center mt-2">Point camera at barcode</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              placeholder="Enter barcode number"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
              autoFocus
            />
            <Button className="w-full" onClick={handleManualSubmit} disabled={!manualCode.trim()}>
              Look Up
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
