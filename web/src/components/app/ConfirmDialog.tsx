// Promise-based confirm with the shadcn AlertDialog, in place of window.confirm.
// Usage: const confirm = useConfirm(); if (!(await confirm({ title: "Görev silinsin mi?" }))) return;
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button for delete-like actions. Default true. */
  destructive?: boolean;
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConfirm outside ConfirmProvider");
  return v;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <AlertDialog open={!!opts} onOpenChange={(o) => !o && finish(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => finish(false)}>{opts?.cancelText ?? "Vazgeç"}</AlertDialogCancel>
            <AlertDialogAction
              variant={opts?.destructive === false ? "default" : "destructive"}
              onClick={() => finish(true)}
            >
              {opts?.confirmText ?? "Sil"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}
