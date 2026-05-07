import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export default function AuthControl() {
  const { user, signIn, signOut, loading } = useAuth();
  const toast = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the user menu when clicking outside.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (loading) {
    return <div className="auth-btn auth-btn-skeleton" aria-hidden />;
  }

  if (user) {
    const display = user.email ?? "Account";
    return (
      <div className="auth-control" ref={menuRef}>
        <button
          type="button"
          className="auth-btn auth-btn-user"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
        >
          <span className="auth-btn-avatar">👤</span>
          <span className="auth-btn-label">{emailLocalPart(display)}</span>
        </button>
        {menuOpen && (
          <div className="auth-menu">
            <p className="auth-menu-email" title={display}>{display}</p>
            <button
              type="button"
              className="auth-menu-item"
              onClick={async () => {
                setMenuOpen(false);
                await signOut();
                toast("Signed out", "info");
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await signIn(trimmed);
      setSent(true);
    } catch (err) {
      toast((err as Error).message || "Could not send the magic link", "error");
    }
    setSubmitting(false);
  }

  function closeModal() {
    setModalOpen(false);
    // Reset after the transition would have ended; safe to do immediately
    // since the modal unmounts.
    setSent(false);
    setEmail("");
  }

  return (
    <>
      <button
        type="button"
        className="auth-btn"
        onClick={() => setModalOpen(true)}
      >
        Sign in
      </button>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal auth-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="detail-close"
              onClick={closeModal}
              aria-label="Close"
            >
              ✕
            </button>

            {sent ? (
              <>
                <h2>Check your email</h2>
                <p className="modal-desc">
                  We sent a sign-in link to <strong>{email.trim()}</strong>.
                  Open it on this device to finish signing in.
                </p>
                <p className="auth-fineprint">
                  Didn't get it? Check your spam folder, or close this and try again with a different email.
                </p>
              </>
            ) : (
              <>
                <h2>Sign in to Fiberspot</h2>
                <p className="modal-desc">
                  We'll email you a one-time magic link. No password needed.
                </p>
                <form onSubmit={handleSubmit}>
                  <label>
                    Email
                    <input
                      type="email"
                      required
                      autoFocus
                      value={email}
                      onChange={(ev) => setEmail(ev.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-primary full"
                    disabled={submitting}
                  >
                    {submitting ? "Sending..." : "Send magic link"}
                  </button>
                </form>
                <p className="auth-fineprint">
                  Anonymous use stays available — signing in just lets you keep your spots and lifts your daily limits.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
