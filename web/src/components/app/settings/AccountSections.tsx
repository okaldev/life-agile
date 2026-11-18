// Settings: own password, people and invite links (admin), source link (AGPL-3.0). See openwiki/requirements.md (Accounts).
import type { Invite } from "@shared/types.ts";
import { Copy, ExternalLink, KeyRound, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { UserAvatar } from "../common";

export function PasswordForm() {
  const [has, setHas] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void api.get<{ hasPassword: boolean }>("/api/me/password").then((r) => setHas(r.hasPassword));
  }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("again")) return toast.error("Şifreler aynı değil.");
    try {
      await api.put("/api/me/password", { current: f.get("current") ?? "", password: f.get("password") });
      toast.success(has ? "Şifre değişti." : "Şifre belirlendi. Artık e-posta ve şifreyle de girebilirsin.");
      setHas(true);
      setOpen(false);
    } catch {}
  };
  if (has === null) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm">Şifre</p>
          <p className="text-xs text-muted-foreground">{has ? "E-posta ve şifreyle giriş açık." : "Şifre yok. Sadece Google ile giriş yapabilirsin."}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          <KeyRound className="size-4" /> {has ? "Değiştir" : "Şifre belirle"}
        </Button>
      </div>
      {open && (
        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-3">
          {has && <Input name="current" type="password" placeholder="Mevcut şifre" autoComplete="current-password" required />}
          <Input name="password" type="password" placeholder="Yeni şifre (8+)" autoComplete="new-password" minLength={8} required />
          <Input name="again" type="password" placeholder="Yeni şifre tekrar" autoComplete="new-password" minLength={8} required />
          <Button type="submit" size="sm" className="sm:col-span-3 sm:justify-self-end">
            Kaydet
          </Button>
        </form>
      )}
    </div>
  );
}

export function PeopleSection() {
  const { state } = useStore();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const admin = !!state.me?.isAdmin;
  const load = () => void api.get<Invite[]>("/api/admin/invites").then(setInvites);
  useEffect(() => {
    if (admin) load();
  }, [admin]);

  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast.success("Link kopyalandı."),
      () => toast.error("Kopyalanamadı. Linki elle seç."),
    );
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const r = await api.post<{ url: string }>("/api/admin/invites", { name: f.get("name"), email: f.get("email") });
      setLink(r.url);
      form.reset();
      load();
    } catch {}
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="font-medium">Kişiler</h3>
        <p className="text-xs text-muted-foreground">
          {admin ? "Yeni kişiyi davet linkiyle ekle. Linki kendin gönder; 7 gün geçerli ve tek kullanımlık." : "Yeni kişileri yönetici davet eder."}
        </p>
      </div>
      <ul className="space-y-2">
        {state.users.map((u) => (
          <li key={u.id} className="flex items-center gap-2 text-sm">
            <UserAvatar user={u} className="size-6" />
            <span className="flex-1">
              {u.name} <span className="text-xs text-muted-foreground">{u.email}</span>
            </span>
            {u.isAdmin && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Yönetici</span>}
          </li>
        ))}
      </ul>
      {admin && (
        <>
          <form onSubmit={create} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <Input name="name" placeholder="İsim" required maxLength={60} />
            <Input name="email" type="email" placeholder="E-posta" required />
            <Button type="submit" size="sm" className="h-9">
              <UserPlus className="size-4" /> Davet linki
            </Button>
          </form>
          {link && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
              <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
              <Button size="sm" variant="secondary" onClick={() => copy(link)}>
                <Copy className="size-4" /> Kopyala
              </Button>
            </div>
          )}
          {invites.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Bekleyen davetler</p>
              {invites.map((i) => (
                <div key={i.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">
                    {i.name} <span className="text-xs text-muted-foreground">{i.email} · {shortDate(i.expiresAt.slice(0, 10))} tarihine kadar</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Daveti iptal et"
                    onClick={() => void api.del(`/api/admin/invites/${i.id}`).then(load)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** AGPL-3.0: users of a network service get a link to the source. */
export function SourceLink() {
  const { state } = useStore();
  if (!state.sourceUrl) return null;
  return (
    <p className="text-center text-xs text-muted-foreground">
      Life Agile açık kaynaklıdır (AGPL-3.0).{" "}
      <a href={state.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
        Kaynak kodu <ExternalLink className="size-3" />
      </a>
    </p>
  );
}
