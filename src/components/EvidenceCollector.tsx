import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useLanguage } from "@/lib/i18n";
import { Camera, Upload, X, Trash2, ArrowRight, ScanSearch, Loader2 } from "lucide-react";

export interface EvidenceItem {
  kind: "photo" | "video" | "file";
  mimeType: string;
  dataUrl: string;
  name?: string;
  aiAnalysis?: string;
  aiValid?: boolean;
}

const MAX_BYTES = 3_500_000; // keeps complaint documents small in the prototype
const VISION_MAX_EDGE = 1024; // keeps the multimodal payload inside gateway limits

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Shrink a photo to a bounded JPEG before it is sent to the vision model.
 * Phone photos are often 4000px wide (~5 MB of base64) which the gateway
 * rejects outright; 1024px is plenty for classifying civic infrastructure and
 * keeps the request small and fast.
 */
function downscaleForVision(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxEdge = Math.max(img.width, img.height);
      if (maxEdge <= VISION_MAX_EDGE) {
        resolve(dataUrl);
        return;
      }
      const scale = VISION_MAX_EDGE / maxEdge;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

interface Props {
  files: EvidenceItem[];
  onChange: (files: EvidenceItem[]) => void;
}

export function EvidenceCollector({ files, onChange }: Props) {
  const { t } = useLanguage();
  const analyzeImage = useAction(api.aiVision.analyzeImage);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [analyzingIdx, setAnalyzingIdx] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setStream(s);
      setCameraOpen(true);
      requestAnimationFrame(() => {
        const v = document.getElementById("civic-camera-video") as HTMLVideoElement | null;
        if (v) {
          v.srcObject = s;
          v.play().catch(() => {});
        }
      });
    } catch {
      setCameraError(t("evidence.cameraDenied"));
    }
  };

  const stopCamera = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setCameraOpen(false);
  };

  const analyze = async (item: EvidenceItem, index: number, next: EvidenceItem[]) => {
    setAnalyzingIdx(index);
    try {
      const shrunk = await downscaleForVision(item.dataUrl);
      const shrunkMime = shrunk.startsWith("data:image/jpeg")
        ? "image/jpeg"
        : item.mimeType;
      const res = await analyzeImage({
        imageBase64: shrunk.split(",")[1] ?? "",
        mimeType: shrunkMime,
      });
      const updated = [...next];
      updated[index] = {
        ...updated[index],
        aiAnalysis: res.description,
        aiValid: res.failed ? undefined : res.valid,
      };
      onChange(updated);
    } catch {
      const updated = [...next];
      updated[index] = {
        ...updated[index],
        aiAnalysis: t("evidence.analyseFailed"),
        aiValid: undefined,
      };
      onChange(updated);
    } finally {
      setAnalyzingIdx(null);
    }
  };

  const addPhoto = (dataUrl: string, mimeType: string, name: string) => {
    if (files.length >= 4) {
      setFileError(t("evidence.maxFiles"));
      return;
    }
    const item: EvidenceItem = { kind: "photo", mimeType, dataUrl, name };
    const next = [...files, item];
    onChange(next);
    void analyze(item, next.length - 1, next);
  };

  const capture = () => {
    const v = document.getElementById("civic-camera-video") as HTMLVideoElement | null;
    if (!v) return;
    const canvas = document.createElement("canvas");
    const maxW = 1280;
    const scale = Math.min(1, maxW / (v.videoWidth || maxW));
    canvas.width = Math.round((v.videoWidth || 1280) * scale);
    canvas.height = Math.round((v.videoHeight || 720) * scale);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    addPhoto(canvas.toDataURL("image/jpeg", 0.82), "image/jpeg", "camera-photo.jpg");
    stopCamera();
  };

  const handleFiles = async (list: File[]) => {
    setFileError(null);
    for (const file of list) {
      if (files.length >= 4) {
        setFileError(t("evidence.maxFiles"));
        break;
      }
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
        setFileError(t("evidence.wrongType"));
        continue;
      }
      if (file.size > MAX_BYTES) {
        setFileError(t("evidence.tooLarge"));
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        if (file.type.startsWith("video/")) {
          onChange([...files, { kind: "video", mimeType: file.type, dataUrl, name: file.name }]);
        } else {
          addPhoto(dataUrl, file.type || "image/jpeg", file.name || "photo.jpg");
        }
      } catch {
        setFileError(t("evidence.readFailed"));
      }
    }
  };

  const removeAt = (i: number) => {
    onChange(files.filter((_, idx) => idx !== i));
  };

  const photoItems = files.filter((f) => f.kind === "photo");
  const allPhotosValid = photoItems.length > 0 && photoItems.every((f) => f.aiValid === true);
  const anyPhotoInvalid = photoItems.some((f) => f.aiValid === false);

  return (
    <div className="space-y-4">
      {!cameraOpen ? (
        <div className="grid gap-3 sm:grid-cols-2">            <button
              type="button"
              onClick={startCamera}
              className="archive-frame flex items-center justify-center rounded-lg border border-border bg-card px-4 py-6 transition-colors hover:bg-accent"
            >
            <span className="archive-frame-inner flex items-center gap-3">
              <Camera className="size-5 text-primary" />
              <span className="font-serif text-base">{t("report.camera")}</span>
            </span>
          </button>
          <label className="archive-frame flex items-center justify-center rounded-lg border border-dashed border-border bg-card px-4 py-6 transition-colors hover:bg-accent">
            <span className="archive-frame-inner flex items-center gap-3">
              <Upload className="size-5 text-primary" />
              <span className="font-serif text-base">{t("report.upload")}</span>
            </span>
            <input
              type="file"
              accept="image/*,video/mp4,video/webm"
              multiple
              className="sr-only"
              onChange={(e) => {
                void handleFiles(Array.from(e.target.files ?? []).slice(0, 4));
                e.target.value = "";
              }}
            />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-lg border border-border bg-black">
            <video
              id="civic-camera-video"
              playsInline
              muted
              className="h-64 w-full object-cover sm:h-80"
            />
            <div className="pointer-events-none absolute inset-4 rounded border border-white/40" />
            <button
              type="button"
              onClick={stopCamera}
              className="absolute right-3 top-3 rounded-full bg-card/90 p-2 text-foreground shadow hover:bg-card"
              aria-label="Close camera"
            >
              <X className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={capture}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-serif text-base text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Camera className="size-4" /> {t("report.capture")}
          </button>
        </div>
      )}

      {cameraError && <p className="text-sm text-destructive">{cameraError}</p>}
      {fileError && <p className="text-sm text-destructive">{fileError}</p>}

      {files.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {files.map((f, i) => (
            <li key={i} className="archive-frame rounded-lg border border-border bg-card p-3">
              <div className="archive-frame-inner space-y-2">
                <div className="relative overflow-hidden rounded border border-border">
                  {f.kind === "video" ? (
                    <video src={f.dataUrl} controls className="aspect-square w-full object-cover" />
                  ) : (
                    <img src={f.dataUrl} alt={f.name ?? "evidence"} className="aspect-square w-full object-cover" />
                  )}
                  {analyzingIdx === i && (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-sm">
                      <Loader2 className="size-4 animate-spin" /> {t("report.analyzing")}
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs leading-snug text-muted-foreground">
                    {f.kind === "video" ? (
                      t("evidence.videoNoCheck")
                    ) : f.aiAnalysis ? (
                      <>
                        <ScanSearch className="mr-1 inline size-3.5 align-[-2px] text-primary" />
                        {f.aiAnalysis}
                      </>
                    ) : (
                      t("evidence.aiQueued")
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    aria-label="Remove"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {f.aiValid === false && (
                  <p className="rounded border border-amber-600/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
                    {t("evidence.aiBad")}
                  </p>
                )}
                {f.aiValid === true && (
                  <p className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
                    {t("evidence.aiGood")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && !anyPhotoInvalid && allPhotosValid && (
        <p className="flex items-center gap-2 text-sm text-primary">
          <ArrowRight className="size-4" /> {t("evidence.ready")}
        </p>
      )}
    </div>
  );
}
