// Profile photo: pick an image, crop it to a circle (drag + zoom), upload 256x256. Independent of the Google photo.
import { Camera, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useConfirm } from "../ConfirmDialog";
import { UserAvatar } from "../common";

const VIEW = 240; // crop preview size in px
const OUT = 256; // uploaded image size in px
const MAX_BYTES = 200 * 1024;

function encode(canvas: HTMLCanvasElement): string {
  // WebP first; Safari versions without WebP encoding return PNG, then use JPEG.
  for (const q of [0.88, 0.75, 0.6]) {
    let url = canvas.toDataURL("image/webp", q);
    if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", q);
    if ((url.length * 3) / 4 < MAX_BYTES) return url;
  }
  return canvas.toDataURL("image/jpeg", 0.5);
}

function Cropper({ src, onCancel, onDone }: { src: string; onCancel: () => void; onDone: (dataUrl: string) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);

  // Scale so the image covers the circle at zoom 1.
  const base = img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1;
  const w = img ? img.naturalWidth * base * zoom : 0;
  const h = img ? img.naturalHeight * base * zoom : 0;
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(Math.max(p.x, (VIEW - w) / 2), (w - VIEW) / 2),
    y: Math.min(Math.max(p.y, (VIEW - h) / 2), (h - VIEW) / 2),
  });
  const view = clamp(pos);

  const save = () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d")!;
    const k = OUT / VIEW;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, ((VIEW - w) / 2 + view.x) * k, ((VIEW - h) / 2 + view.y) * k, w * k, h * k);
    onDone(encode(canvas));
  };

  return (
    <>
      <div className="flex flex-col items-center gap-4 p-4">
        <div
          className="relative touch-none overflow-hidden rounded-full bg-muted ring-1 ring-border select-none"
          style={{ width: VIEW, height: VIEW, cursor: "grab" }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: view.x, py: view.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
          }}
          onPointerUp={() => (drag.current = null)}
        >
          {img && (
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{ width: w, height: h, left: (VIEW - w) / 2 + view.x, top: (VIEW - h) / 2 + view.y }}
            />
          )}
        </div>
        <label className="flex w-full max-w-60 items-center gap-2 text-xs text-muted-foreground">
          Yakınlaştır
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
        </label>
        <p className="text-xs text-muted-foreground">Fotoğrafı sürükleyerek konumlandırın.</p>
      </div>
      <DialogFooter className="border-t p-4">
        <Button variant="ghost" onClick={onCancel}>
          Vazgeç
        </Button>
        <Button onClick={save} disabled={!img}>
          Kaydet
        </Button>
      </DialogFooter>
    </>
  );
}

export function AvatarEditor() {
  const { state } = useStore();
  const ask = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const custom = !!state.me?.avatarUrl?.startsWith("/api/avatars/");

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Lütfen bir resim seçin.");
    const r = new FileReader();
    r.onload = () => setSrc(String(r.result));
    r.readAsDataURL(file);
  };
  const upload = async (dataUrl: string) => {
    await api.put("/api/me/avatar", { dataUrl });
    setSrc(null);
    toast.success("Profil fotoğrafı güncellendi.");
  };
  const reset = async () => {
    const ok = await ask({
      title: "Google fotoğrafına dönülsün mü?",
      description: "Yüklediğiniz fotoğraf silinir.",
      confirmText: "Google fotoğrafına dön",
    });
    if (ok) await api.del("/api/me/avatar");
  };

  return (
    <div className="flex items-center gap-3">
      <button className="group relative" onClick={() => input.current?.click()} aria-label="Fotoğrafı değiştir">
        <UserAvatar user={state.me ?? undefined} className="size-14 text-lg" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Camera className="size-5" />
        </span>
      </button>
      <div className="flex flex-col items-start gap-1">
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          <Camera className="size-4" /> Fotoğrafı değiştir
        </Button>
        {custom && (
          <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-3.5" /> Google fotoğrafına dön
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Dialog open={!!src} onOpenChange={(o) => !o && setSrc(null)}>
        <DialogContent className="gap-0 p-0 sm:max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader className="border-b p-4">
            <DialogTitle>Profil fotoğrafı</DialogTitle>
            <DialogDescription>Bu fotoğraf Google fotoğrafınızın yerine görünür.</DialogDescription>
          </DialogHeader>
          {src && <Cropper src={src} onCancel={() => setSrc(null)} onDone={(d) => void upload(d)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
