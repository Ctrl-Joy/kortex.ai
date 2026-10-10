import type { IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, RefreshCw, ShieldAlert, SwitchCamera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScanState = "idle" | "starting" | "scanning" | "denied" | "no-camera" | "in-use" | "insecure" | "error";

const REPEAT_SUPPRESS_MS = 2500;

/**
 * Real barcode scanning with ZXing (EAN-13, EAN-8, UPC-A, UPC-E).
 * Works with a phone's rear camera or a laptop webcam. The backend also
 * debounces repeated reads, so a burst of callbacks never doubles quantities.
 */
export function BarcodeScanner({ onDetected, active }: { onDetected: (code: string) => void; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [state, setState] = useState<ScanState>("idle");
  const [error, setError] = useState<string>("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIdx, setDeviceIdx] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  onDetectedRef.current = onDetected;

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    if (!window.isSecureContext) {
      setState("insecure");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("no-camera");
      return;
    }
    setState("starting");
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      const chosen = deviceIdx != null ? devices[deviceIdx] : undefined;
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: chosen
          ? { deviceId: { exact: chosen.deviceId } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      };
      controlsRef.current = await reader.decodeFromConstraints(constraints, videoRef.current!, (result) => {
        if (!result) return;
        const code = result.getText();
        const now = Date.now();
        if (lastRef.current && lastRef.current.code === code && now - lastRef.current.at < REPEAT_SUPPRESS_MS) return;
        lastRef.current = { code, at: now };
        setFlash(true);
        setTimeout(() => setFlash(false), 350);
        onDetectedRef.current(code);
      });
      setState("scanning");
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "videoinput"));
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") setState("denied");
      else if (name === "NotFoundError" || name === "OverconstrainedError") setState("no-camera");
      else if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") setState("in-use");
      else {
        setState("error");
        setError((err as Error)?.message ?? "Unknown camera error");
      }
    }
  }, [deviceIdx, devices, stop]);

  useEffect(() => {
    if (active) void start();
    else stop();
    return stop;
    // restart only when activation or chosen device changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, deviceIdx]);

  const message: Record<Exclude<ScanState, "idle" | "starting" | "scanning">, { title: string; body: string }> = {
    denied: {
      title: "Camera permission denied",
      body: "Allow camera access in your browser’s site settings, then retry. You can also type the barcode or pick from the catalogue below.",
    },
    "no-camera": { title: "No camera found", body: "This device has no available camera. Use manual entry or the catalogue below." },
    "in-use": {
      title: "Camera is being used by another app",
      body: "Windows lets only one app use a webcam at a time. On the demo laptop that is usually the KORTEX vision service — release it from Live Monitoring (“Release webcam”), scan with a phone instead, or type the code below.",
    },
    insecure: {
      title: "Camera needs a secure connection",
      body: "Browsers only allow cameras on HTTPS or localhost. Open the HTTPS address shown by the KORTEX dev server, or use manual entry.",
    },
    error: { title: "Camera unavailable", body: error || "Another app may be using the camera." },
  };

  const problem =
    state === "denied" || state === "no-camera" || state === "in-use" || state === "insecure" || state === "error" ? message[state] : null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-black" style={{ ["--scan-h" as string]: "100%" }}>
      <div className="relative aspect-[4/3] w-full sm:aspect-video">
        <video ref={videoRef} className={cn("h-full w-full object-cover", !active || problem ? "opacity-0" : "opacity-100")} muted playsInline />
        {active && state === "scanning" && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-[12%] top-1/2 h-[38%] -translate-y-1/2 rounded-lg border-2 border-accent/70 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]">
              <div className="absolute inset-x-2 top-0 h-0.5 animate-scan-line bg-accent/90 shadow-[0_0_12px_2px_rgb(34_211_238/0.6)]" style={{ ["--scan-h" as string]: "calc(100% - 2px)" }} />
            </div>
            <p className="absolute bottom-3 left-0 right-0 text-center text-xs font-medium text-white/90 drop-shadow">
              Align the barcode inside the frame
            </p>
          </div>
        )}
        {flash && <div className="pointer-events-none absolute inset-0 animate-fade-in bg-ok/25" />}
        {(state === "starting" || (!active && !problem)) && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted">
            <span className="flex items-center gap-2">
              <Camera className="size-4" /> {state === "starting" ? "Starting camera…" : "Scanner paused"}
            </span>
          </div>
        )}
        {problem && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface px-6 text-center">
            {state === "denied" || state === "insecure" || state === "in-use" ? <ShieldAlert className="size-6 text-warn" /> : <CameraOff className="size-6 text-subtle" />}
            <p className="text-sm font-semibold text-fg">{problem.title}</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted">{problem.body}</p>
            {state !== "insecure" && (
              <Button size="sm" variant="outline" className="mt-1" onClick={() => void start()}>
                <RefreshCw /> Retry camera
              </Button>
            )}
          </div>
        )}
      </div>
      {devices.length > 1 && state === "scanning" && (
        <button
          className="absolute right-2 top-2 grid size-9 cursor-pointer place-items-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
          onClick={() => setDeviceIdx((i) => ((i ?? 0) + 1) % devices.length)}
          aria-label="Switch camera"
        >
          <SwitchCamera className="size-4" />
        </button>
      )}
    </div>
  );
}
