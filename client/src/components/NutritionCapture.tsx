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

export function NutritionCapture({ open, onClose, onResult }: NutritionCaptureProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function processFile(file: File) {
    setError("");
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setPreview(dataUrl);

      const [header, base64] = dataUrl.split(",");
      const mediaType = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";

      setLoading(true);
      try {
        const data = await apiRequest<NutritionData>("POST", "/api/food/scan-label", { imageBase64: base64, mediaType });
        onResult(data);
        onClose();
        setPreview(null);
      } catch {
        setError("Could not parse label. Try a clearer photo or use manual entry.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
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
                <span className="text-sm">Claude is reading the label...</span>
              </div>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
            {!loading && (
              <Button variant="outline" className="w-full" onClick={() => setPreview(null)}>Try again</Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Take a photo of the nutrition facts label, or upload an existing image.</p>

            <Button className="w-full" onClick={() => cameraRef.current?.click()}>
              <Camera className="w-4 h-4 mr-2" /> Take Photo
            </Button>
            <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" /> Upload Image
            </Button>

            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
