// Public auth pages: login (/giris), first-run setup (/kurulum) and invite accept (/davet?t=token).
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Options {
  google: boolean;
  password: boolean;
  setupNeeded: boolean;
  dev: { email: string; name: string }[] | null;
}

const ERRORS: Record<string, string> = {
  yetki: "Bu Google hesabının erişim izni yok. Yöneticiden davet isteyin.",
  state: "Oturum doğrulanamadı. Tekrar deneyin.",
  token: "Google girişi başarısız. Tekrar deneyin.",
};

async function post(path: string, body: unknown): Promise<string | null> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) return null;
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "Bir hata oldu. Tekrar deneyin.";
}

function Shell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-2 size-12" />
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">{children}</CardContent>
      </Card>
    </main>
  );
}

function Field({ id, label, ...rest }: { id: string; label: string } & React.ComponentProps<"input">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...rest} />
    </div>
  );
}

const ErrorBox = ({ text }: { text: string | null }) =>
  text ? <p className="rounded-md bg-destructive/10 p-2 text-center text-sm text-destructive">{text}</p> : null;

function GoogleButton({ label = "Google ile giriş yap" }: { label?: string }) {
  return (
    <Button className="w-full" size="lg" asChild>
      <a href="/auth/google">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path
            fill="currentColor"
            d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.67 4.1-5.35 4.1a5.9 5.9 0 0 1 0-11.8c1.84 0 3.07.78 3.77 1.45l2.57-2.48C16.7 3.83 14.56 2.9 12 2.9a9.1 9.1 0 1 0 0 18.2c5.25 0 8.73-3.69 8.73-8.89 0-.6-.07-1.05-.15-1.5z"
          />
        </svg>
        {label}
      </a>
    </Button>
  );
}

function useOptions() {
  const [opts, setOpts] = useState<Options | null>(null);
  useEffect(() => {
    fetch("/auth/options")
      .then((r) => r.json())
      .then(setOpts)
      .catch(() => setOpts({ google: false, password: true, setupNeeded: false, dev: null }));
  }, []);
  return opts;
}

function useSubmit(run: (form: FormData) => Promise<string | null>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const err = await run(new FormData(e.currentTarget));
    setBusy(false);
    if (err) setError(err);
    else window.location.href = "/";
  };
  return { error, busy, onSubmit };
}

export default function LoginPage({ mode = "login" }: { mode?: "login" | "setup" | "invite" }) {
  if (mode === "setup") return <SetupForm />;
  if (mode === "invite") return <InviteForm />;
  return <LoginForm />;
}

function LoginForm() {
  const opts = useOptions();
  const urlError = new URLSearchParams(window.location.search).get("hata");
  const { error, busy, onSubmit } = useSubmit((f) => post("/auth/login", { email: f.get("email"), password: f.get("password") }));

  useEffect(() => {
    fetch("/api/me").then((r) => {
      if (r.ok) window.location.href = "/";
    });
  }, []);
  useEffect(() => {
    if (opts?.setupNeeded) window.location.href = "/kurulum";
  }, [opts]);

  return (
    <Shell title="Life Agile" description="Haftalık sprintlerle hayatı planla.">
      <ErrorBox text={error ?? (urlError ? (ERRORS[urlError] ?? "Giriş başarısız.") : null)} />
      {opts?.google && (
        <>
          <GoogleButton />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> veya e-posta ile <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <Field id="email" label="E-posta" type="email" autoComplete="email" required />
        <Field id="password" label="Şifre" type="password" autoComplete="current-password" required />
        <Button type="submit" className="w-full" size="lg" variant={opts?.google ? "secondary" : "default"} disabled={busy}>
          Giriş yap
        </Button>
      </form>
      {opts?.dev && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-center text-xs text-muted-foreground">Geliştirme girişi</p>
          {opts.dev.map((u) => (
            <Button key={u.email} variant="outline" className="w-full" asChild>
              <a href={`/auth/dev?email=${encodeURIComponent(u.email)}`}>{u.name} olarak gir</a>
            </Button>
          ))}
        </div>
      )}
    </Shell>
  );
}

function SetupForm() {
  const opts = useOptions();
  const { error, busy, onSubmit } = useSubmit((f) =>
    post("/auth/setup", { name: f.get("name"), email: f.get("email"), password: f.get("password") }),
  );
  useEffect(() => {
    if (opts && !opts.setupNeeded) window.location.href = "/giris";
  }, [opts]);

  return (
    <Shell title="Kurulum" description="İlk hesabı oluştur. Bu hesap yönetici olur ve diğer kişileri davet eder.">
      <ErrorBox text={error} />
      <form onSubmit={onSubmit} className="space-y-3">
        <Field id="name" label="İsim" autoComplete="name" required maxLength={60} />
        <Field id="email" label="E-posta" type="email" autoComplete="email" required />
        <Field id="password" label="Şifre (en az 8 karakter)" type="password" autoComplete="new-password" required minLength={8} />
        <Button type="submit" className="w-full" size="lg" disabled={busy || !opts?.setupNeeded}>
          Hesabı oluştur
        </Button>
      </form>
    </Shell>
  );
}

function InviteForm() {
  const token = new URLSearchParams(window.location.search).get("t") ?? "";
  const [invite, setInvite] = useState<{ email: string; name: string; google: boolean } | null | false>(null);
  const { error, busy, onSubmit } = useSubmit((f) =>
    post(`/auth/invite/${encodeURIComponent(token)}`, { name: f.get("name"), password: f.get("password") }),
  );
  useEffect(() => {
    fetch(`/auth/invite/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : false))
      .then(setInvite)
      .catch(() => setInvite(false));
  }, [token]);

  if (invite === false)
    return (
      <Shell title="Davet" description="Bu davet geçersiz, kullanılmış ya da süresi dolmuş.">
        <Button variant="outline" className="w-full" asChild>
          <a href="/giris">Giriş sayfasına git</a>
        </Button>
      </Shell>
    );
  if (!invite) return <Shell title="Davet" description="Yükleniyor…">{null}</Shell>;

  return (
    <Shell title="Davete hoş geldin" description={`${invite.email} için bir hesap oluştur.`}>
      <ErrorBox text={error} />
      <form onSubmit={onSubmit} className="space-y-3">
        <Field id="name" label="İsim" defaultValue={invite.name} autoComplete="name" required maxLength={60} />
        <Field id="password" label="Şifre (en az 8 karakter)" type="password" autoComplete="new-password" required minLength={8} />
        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          Hesabı oluştur
        </Button>
      </form>
    </Shell>
  );
}
