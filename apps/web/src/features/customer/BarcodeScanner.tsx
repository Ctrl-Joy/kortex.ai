import { Camera, CameraOff, RefreshCw, ShieldAlert, SwitchCamera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScanState = "idle" | "starting" | "scanning" | "denied" | "no-camera" | "in-use" | "insecure" | "error";

// A code counts again only after it has been out of view this long, so holding
// one item in front of the camera never adds extra units.
const REARM_AFTER_ABSENT_MS = 1200;
const DECODE_INTERVAL_MS = 110; // ~9 decode attempts per second
// Region inside the on-screen guide box that is actually decoded (fractions of the frame).
const BAND = { x: 0.08, y: 0.27, w: 0.84, h: 0.46 };
const MAX_BAND_WIDTH = 960;

type Decoder = (canvas: HTMLCanvasElement) => Promise<string | null>;

interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
}

/** Prefer the browser's native BarcodeDetector (fast, where available), else ZXing. */
async function createDecoder(): Promise<{ decode: Decoder; engine: string }> {
  const NativeCtor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => NativeBarcodeDetector })
    .BarcodeDetector;
  const formats = ["ean_13", "ean_8", "upc_a", "upc_e"];
  if (NativeCtor) {
    try {
      const supported: string[] = await (NativeCtor as unknown as { getSupportedFormats(): Promise<string[]> }).getSupportedFormats();
      if (formats.some((f) => supported.includes(f))) {
        const detector = new NativeCtor({ formats: formats.filter((f) => supported.includes(f)) });
        return {
          engine: "native",
          decode: async (canvas) => (await detector.detect(canvas))[0]?.rawValue ?? null,
        };
      }
    } catch {
      /* fall back to ZXing */
    }
  }
  const [{ HTMLCanvasElementLuminanceSource }, zx] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map();
  hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
    zx.BarcodeFormat.EAN_13,
    zx.BarcodeFormat.EAN_8,
    zx.BarcodeFormat.UPC_A,
    zx.BarcodeFormat.UPC_E,
  ]);
  hints.set(zx.DecodeHintType.TRY_HARDER, true);
  const reader = new zx.MultiFormatReader();
  reader.setHints(hints);
  return {
    engine: "zxing",
    decode: async (canvas) => {
      try {
        const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(new HTMLCanvasElementLuminanceSource(canvas)));
        return reader.decodeWithState(bitmap).getText();
      } catch {
        return null; // NotFound / checksum / format errors: no barcode in this frame
      } finally {
        reader.reset();
      }
    },
  };
}

/**
 * Real barcode scanning (EAN-13, EAN-8, UPC-A, UPC-E) from a phone's rear
 * camera or a laptop webcam. Only the guide-box region is decoded, on a
 * throttled loop, so the video preview stays smooth. The backend also
 * debounces repeated reads, so a burst of detections never doubles quantities.
 */
export function BarcodeScanner({ onDetected, active }: { onDetected: (code: string) => void; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  const lastRef = useRef<{ code: string; seenAt: number } | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [state, setState] = useState<ScanState>("idle");
  const [error, setError] = useState<string>("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIdx, setDeviceIdx] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  onDetectedRef.current = onDetected;

  const stop = useCallback(() => {
    runIdRef.current += 1;
    if (loopRef.current) clearTimeout(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    const runId = runIdRef.current;
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
      const chosen = deviceIdx != null ? devices[deviceIdx] : undefined;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(chosen ? { deviceId: { exact: chosen.deviceId } } : { facingMode: { ideal: "environment" } }),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      if (runId !== runIdRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      // Ask for continuous autofocus where the camera supports it (sharper barcodes).
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[] };
      if (caps.focusMode?.includes("continuous")) {
        track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const { decode } = await createDecoder();
      setState("scanning");
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === "videoinput")))
        .catch(() => {});

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const tick = async () => {
        if (runId !== runIdRef.current) return;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (vw && vh && video.readyState >= 2) {
          // The <video> uses object-cover, so map the on-screen guide box back
          // through the crop to source pixels.
          const cw = video.clientWidth || vw;
          const ch = video.clientHeight || vh;
          const cover = Math.max(cw / vw, ch / vh);
          const visW = cw / cover;
          const visH = ch / cover;
          const sx = (vw - visW) / 2 + visW * BAND.x;
          const sy = (vh - visH) / 2 + visH * BAND.y;
          const sw = visW * BAND.w;
          const sh = visH * BAND.h;
          const scale = Math.min(1, MAX_BAND_WIDTH / sw);
          canvas.width = Math.round(sw * scale);
          canvas.height = Math.round(sh * scale);
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          const code = await decode(canvas);
          if (code && runId === runIdRef.current) {
            const now = Date.now();
            const last = lastRef.current;
            const stillInView = last && last.code === code && now - last.seenAt < REARM_AFTER_ABSENT_MS;
            lastRef.current = { code, seenAt: now };
            if (!stillInView) {
              setFlash(true);
              setTimeout(() => setFlash(false), 350);
              onDetectedRef.current(code);
            }
          }
        }
        if (runId === runIdRef.current) loopRef.current = window.setTimeout(tick, DECODE_INTERVAL_MS);
      };
      loopRef.current = window.setTimeout(tick, DECODE_INTERVAL_MS);
    } catch (err) {
      if (runId !== runIdRef.current) return;
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
    else {
      stop();
      setState("idle");
    }
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
    <div className="relative overflow-hidden rounded-xl border border-line bg-black">
      <div className="relative aspect-[4/3] w-full sm:aspect-video">
        <video ref={videoRef} className={cn("h-full w-full object-cover", !active || problem ? "opacity-0" : "opacity-100")} muted playsInline />
        {active && state === "scanning" && (
          <div className="pointer-events-none absolute inset-0">
            {/* Guide box matches the decoded region (BAND) */}
            <div
              className="absolute rounded-lg border-2 border-accent/70 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]"
              style={{ left: `${BAND.x * 100}%`, top: `${BAND.y * 100}%`, width: `${BAND.w * 100}%`, height: `${BAND.h * 100}%` }}
            >
              <div className="absolute inset-x-2 top-1/2 h-0.5 bg-accent/80 shadow-[0_0_12px_2px_rgb(34_211_238/0.6)]" />
            </div>
            <p className="absolute bottom-3 left-0 right-0 text-center text-xs font-medium text-white/90 drop-shadow">
              Fill the frame with the barcode · hold steady 10–20 cm away
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
            {state === "denied" || state === "insecure" || state === "in-use" ? (
              <ShieldAlert className="size-6 text-warn" />
            ) : (
              <CameraOff className="size-6 text-subtle" />
            )}
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
