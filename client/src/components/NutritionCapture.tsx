import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Upload, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface NutritionData {
  name: string;
  brand?: string;
  servingSizeG: number;
  servingUnit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sodiumMg?: number;
  sugarG?: number;
}

interface NutritionCaptureProps {
  open: boolean;
  onClose: () => void;
  onResult: (data: NutritionData) => void;
}

/**
 * Resize an image File to max 1600px on the long side and return it as a
 * base64 JPEG string + media type. Keeps file size well under Claude's
 * ~5 MB image limit (full-res iPhone photos can be 8–15 MB).
 */
function resizeImageForClaude(file: File, maxPx = 1600, quality = 0.85): Promise<{ base64: string; mediaType: string }> {
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
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const base64 = dataUrl.split(",")[1];
      resolve({ base64, mediaType: "image/jpeg" });
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}

export function NutritionCapture({ open, onClose, onResult }: NutritionCaptureProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function processFile(file: File) {
    setError("");

    // Show a low-res preview immediately so the user sees feedback
    const previewUrl = URL.createObjectURL(file);
    const previewImg = new Image();
    previewImg.onload = () => {
      const canvas = document.createElement("canvas");
      const MAX = 400;
      const scale = Math.min(1, MAX / Math.max(previewImg.width, previewImg.height));
      canvas.width = Math.round(previewImg.width * scale);
      canvas.height = Math.round(previewImg.height * scale);
      canvas.getContext("2d")!.drawImage(previewImg, 0, 0, canvas.width, canvas.height);
      setPreview(canvas.toDataURL("image/jpeg", 0.7));
      URL.revokeObjectURL(previewUrl);
    };
    previewImg.src = previewUrl;

    setLoading(true);
    try {
      // Resize before sending — full-res iPhone photos (8–15 MB) exceed Claude's limit
      const { base64, mediaType } = await resizeImageForClaude(file);
      const data = await apiRequest<NutritionData>("POST", "/api/food/scan-label", { imageBase64: base64, mediaType });
      onResult(data);
      onClose();
      setPreview(null);
    } catch {
      setError("Could not parse label. Try a clearer photo or use manual entry.");
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            Scan Nutrition Label
          </DialogTitle>
        </DialogHeader>

        {preview ? (
          <div className="space-y-3">
            <img src={preview} alt="preview" className="w-full rounded-lg max-h-64 object-contain" />
            {loading && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Reading the label…</span>
              </div>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
            {!loading && (
              <Button variant="outline" className="w-full" onClick={() => { setPreview(null); setError(""); }}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Take a photo of the nutrition facts label, or upload an existing image.
            </p>

            <Button className="w-full" onClick={() => cameraRef.current?.click()}>
              <Camera className="w-4 h-4 mr-2" /> Take Photo
            </Button>
            <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" /> Upload Image
            </Button>

            {/* capture="environment" opens the rear camera on mobile */}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
