// Settings: account (photo, password, theme), people and invites, notifications (Web Push), categories, source link.
import type { NotificationPrefs } from "@shared/types.ts";
import { Archive, ArchiveRestore, Bell, BellOff, LogOut, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { PasswordForm, PeopleSection, SourceLink } from "./AccountSections";
import { AvatarEditor } from "./AvatarEditor";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Notifications() {
  const { state } = useStore();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const supported = "serviceWorker" in navigator && "PushManager" in window;

  useEffect(() => {
    void api.get<NotificationPrefs>("/api/notification-prefs").then(setPrefs);
    if (supported) void navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then(setSub);
  }, [supported]);

  const update = async (patch: Partial<NotificationPrefs>) => {
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    setPrefs(await api.put<NotificationPrefs>("/api/notification-prefs", patch));
  };

  const enable = async () => {
    if (!state.vapidPublicKey) return toast.error("Sunucuda push anahtarı yok.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast.error("Bildirim izni verilmedi.");
    const reg = await navigator.serviceWorker.ready;
    const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey) });
    await api.post("/api/push/subscribe", s.toJSON());
    setSub(s);
    toast.success("Bildirimler bu cihazda açıldı.");
  };
  const disable = async () => {
    if (!sub) return;
    await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint });
    await sub.unsubscribe();
    setSub(null);
  };
  const test = async () => {
    const r = await api.post<{ sent: number }>("/api/push/test");
    if (r.sent === 0) toast.error("Gönderilecek cihaz bulunamadı.");
  };

  return (
    <Section title="Bildirimler" hint="Push bildirimleri cihaz bazlıdır. Her telefonda ayrıca açın.">
      {!supported ? (
        <p className="text-sm text-muted-foreground">
          {isIos && !isStandalone
            ? "iPhone'da bildirim için önce Paylaş → Ana Ekrana Ekle ile uygulamayı yükleyin, sonra buradan açın."
            : "Bu tarayıcı push bildirimlerini desteklemiyor."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sub ? (
            <>
              <Button variant="outline" size="sm" onClick={disable}>
                <BellOff className="size-4" /> Bu cihazda kapat
              </Button>
              <Button variant="ghost" size="sm" onClick={test}>
                Test bildirimi gönder
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={enable}>
              <Bell className="size-4" /> Bu cihazda bildirimleri aç
            </Button>
          )}
        </div>
      )}
      {prefs && (
        <div className="space-y-3 border-t pt-3">
          <Row label="Planlama hatırlatması" hint="Pazar 20:00, planlama başlamadıysa.">
            <Switch checked={prefs.planningReminder} onCheckedChange={(v) => update({ planningReminder: v })} />
          </Row>
          <Row label="Günlük özet" hint="Her sabah 08:30, bugünkü görevlerin.">
            <Switch checked={prefs.dailySummary} onCheckedChange={(v) => update({ dailySummary: v })} />
          </Row>
          <Row label="Saatli görev hatırlatması">
            <Select value={String(prefs.taskReminderMin)} onValueChange={(v) => update({ taskReminderMin: Number(v) })}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Kapalı</SelectItem>
                {[5, 10, 15, 30, 60].map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} dk önce
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Partner görev atadığında">
            <Switch checked={prefs.partnerChanges} onCheckedChange={(v) => update({ partnerChanges: v })} />
          </Row>
        </div>
      )}
    </Section>
  );
}

function Categories() {
  const { state } = useStore();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");
  const add = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api.post("/api/categories", { name, color });
    setName("");
  };
  return (
    <Section title="Kategoriler" hint="Arşivlenen kategori yeni görevlerde görünmez, geçmiş veride kalır.">
      <div className="space-y-1.5">
        {state.categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <input
              type="color"
              defaultValue={c.color}
              onBlur={(e) => e.target.value !== c.color && void api.patch(`/api/categories/${c.id}`, { color: e.target.value })}
              className="size-7 shrink-0 cursor-pointer rounded border bg-transparent"
              aria-label="Renk"
            />
            <Input
              defaultValue={c.name}
              className={c.archived ? "h-8 opacity-50" : "h-8"}
              onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && void api.patch(`/api/categories/${c.id}`, { name: e.target.value })}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => void api.patch(`/api/categories/${c.id}`, { archived: !c.archived })}
              aria-label={c.archived ? "Arşivden çıkar" : "Arşivle"}
            >
              {c.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            </Button>
          </div>
        ))}
      </div>
      <form onSubmit={add} className="flex items-center gap-2 border-t pt-3">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="size-7 shrink-0 rounded border bg-transparent" aria-label="Renk" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Yeni kategori" className="h-8" />
        <Button type="submit" size="sm" variant="secondary">
          <Plus className="size-4" /> Ekle
        </Button>
      </form>
    </Section>
  );
}

export default function SettingsPage() {
  const { state } = useStore();
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("la.theme") ?? "system";
    } catch {
      return "system";
    }
  });
  const applyTheme = (t: string) => {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("la.theme");
      else localStorage.setItem("la.theme", t);
    } catch {}
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  };
  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    window.location.href = "/giris";
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Section title="Hesap">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium">{state.me?.name}</p>
            <p className="text-xs text-muted-foreground">{state.me?.email}</p>
          </div>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut className="size-4" /> Çıkış
          </Button>
        </div>
        <AvatarEditor />
        <PasswordForm />
        <Row label="Tema">
          <Select value={theme} onValueChange={applyTheme}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">Sistem</SelectItem>
              <SelectItem value="light">Açık</SelectItem>
              <SelectItem value="dark">Koyu</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Section>
      <PeopleSection />
      <Notifications />
      <Categories />
      <SourceLink />
    </div>
  );
}
