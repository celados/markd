import {
  LuCheck as Check,
  LuCloud as Cloud,
  LuLogIn as LogIn,
  LuLogOut as LogOut,
  LuMail as Mail,
  LuRotateCcw as RotateCcw,
} from "@/icons/icons.tsrx";
import { useEffect, useState } from "octane";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Spinner } from "@/components/ui/Spinner";
import { cloudDesktop } from "@/lib/desktop-services";
import { DesktopError } from "@/lib/desktop";
import { invalidatePublishStatus } from "@/lib/queryClient";
import type { CloudAccount, OtpChallenge } from "@/lib/types";

type Step = "account" | "email" | "code";
type BusyAction = "request" | "verify" | "signout" | null;

type CloudAccountCardProps = {
  onAccountChange: (account: CloudAccount | null) => void;
};

export function CloudAccountCard(props: CloudAccountCardProps) @{
  const { onAccountChange } = props;
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [step, setStep] = useState<Step>("account");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const updateAccount = (next: CloudAccount | null) => {
    invalidatePublishStatus();
    setAccount(next);
    onAccountChange(next);
    window.dispatchEvent(
      new CustomEvent("riffle:cloud-account", {
        detail: { signedIn: Boolean(next) },
      }),
    );
  };

  useEffect(() => {
    let disposed = false;
    void cloudDesktop
      .accountStatus()
      .then((status) => {
        if (!disposed) updateAccount(status.account);
      })
      .catch((cause) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => {
      setResendIn((value) => Math.max(0, value - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const message = (cause: unknown) =>
    cause instanceof DesktopError
      ? cause.message
      : cause instanceof Error
        ? cause.message
        : String(cause);

  const requestCode = async () => {
    setBusy("request");
    setError(null);
    try {
      const next = await cloudDesktop.requestOtp(email.trim());
      setChallenge(next);
      setEmail(next.email);
      setCode("");
      setResendIn(next.resendAfter);
      setStep("code");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const verifyCode = async () => {
    if (!challenge) return;
    setBusy("verify");
    setError(null);
    try {
      const next = await cloudDesktop.verifyOtp(challenge.challengeId, code);
      updateAccount(next);
      setStep("account");
      setChallenge(null);
      setCode("");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy("signout");
    setError(null);
    try {
      await cloudDesktop.signOut();
      updateAccount(null);
      setEmail("");
    } catch (cause) {
      if (locallySignedOut(cause)) {
        updateAccount(null);
        setEmail("");
      }
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  <div className="rounded-xl bg-panel p-1">
      <div className="rounded-[10px] bg-bg px-3.5 py-3">
        @if (step === "account") {
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-panel text-muted">
              @if (loading) {
                <Spinner size={14} />
              } @else if (account) {
                <span className="text-[12px] font-semibold uppercase text-ink">
                  {account.email.slice(0, 1)}
                </span>
              } @else {
                <Cloud size={16} strokeWidth={1.7} />
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[12.5px] font-semibold text-ink">
                  {loading ? "Checking account…" : (account?.email ?? "Not signed in")}
                </p>
                @if (account?.plan === "cloud") {
                  <StatusBadge tone="cloud">Cloud</StatusBadge>
                }
              </div>
              <p className="mt-0.5 text-[10.5px] text-faint">
                {account
                  ? "Publishing is connected to this Riffle account."
                  : "Your local notes stay available without an account."}
              </p>
            </div>
            @if (account) {
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={Boolean(busy)}
                loading={busy === "signout"}
                onClick={signOut}
              >
                @if (busy !== "signout") {
                  <LogOut size={13} strokeWidth={1.8} />
                }
                {busy ? "Signing out…" : "Sign out"}
              </Button>
            } @else {
              <Button
                variant="primary"
                size="sm"
                className="shrink-0"
                disabled={loading}
                onClick={() => {
                  setError(null);
                  setStep("email");
                }}
              >
                <LogIn size={13} strokeWidth={1.8} />
                Sign in
              </Button>
            }
          </div>
        }

        @if (step === "email") {
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void requestCode();
            }}
          >
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-panel text-muted">
                <Mail size={13.5} strokeWidth={1.8} />
              </span>
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Sign in with email</p>
                <p className="mt-0.5 text-[10.5px] text-faint">
                  We’ll send a six-digit code. No password needed.
                </p>
              </div>
            </div>
            <label className="mt-3 block">
              <span className="sr-only">Email address</span>
              <Input
                autoFocus
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                disabled={Boolean(busy)}
                placeholder="you@example.com"
                onInput={(event) => setEmail(event.currentTarget.value)}
              />
            </label>
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() => setStep("account")}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="ml-auto"
                disabled={Boolean(busy) || !email.trim()}
                loading={busy === "request"}
              >
                {busy ? "Sending…" : "Send code"}
              </Button>
            </div>
          </form>
        }

        @if (step === "code" && challenge) {
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void verifyCode();
            }}
          >
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-panel text-muted">
                <Check size={13.5} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-ink">Check your email</p>
                <p className="mt-0.5 truncate text-[10.5px] text-faint">
                  Code sent to {challenge.email}
                </p>
              </div>
            </div>
            <label className="mt-3 block">
              <span className="sr-only">Six-digit verification code</span>
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                disabled={Boolean(busy)}
                placeholder="000000"
                onInput={(event) => setCode(event.currentTarget.value.replace(/\D/g, ""))}
                className="h-11 text-center font-mono text-[18px] font-semibold tracking-[0.32em]"
              />
            </label>
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() => {
                  setError(null);
                  setStep("email");
                }}
              >
                Change email
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={Boolean(busy) || resendIn > 0}
                loading={busy === "request"}
                onClick={() => void requestCode()}
              >
                @if (busy !== "request") {
                  <RotateCcw size={12} strokeWidth={1.8} />
                }
                {busy === "request"
                  ? "Sending…"
                  : resendIn > 0
                    ? `Resend in ${resendIn}s`
                    : "Resend"}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="ml-auto"
                disabled={Boolean(busy) || code.length !== 6}
                loading={busy === "verify"}
              >
                {busy === "verify" ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </form>
        }

        @if (error) {
          <p role="alert" className="mt-3 border-t border-line-soft pt-2.5 text-[10.5px] leading-4 text-danger">
            {error}
          </p>
        }
      </div>
  </div>
}

function locallySignedOut(cause: unknown): boolean {
  if (!(cause instanceof DesktopError)) return false;
  return Boolean(
    cause.details &&
    typeof cause.details === "object" &&
    "localSignedOut" in cause.details &&
    cause.details.localSignedOut === true,
  );
}
