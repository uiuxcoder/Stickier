"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, PackageCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type DropStatus = "submitted" | "printing" | "shipped";

type StickerCard = {
  id: string;
  imageUrl: string;
  createdAt: number;
};

type StoredDrop = {
  monthKey: string;
  selectedIds: string[];
  submittedIds: string[];
  submittedAt: number | null;
  history: {
    monthKey: string;
    stickerIds: string[];
    submittedAt: number;
  }[];
};

type DashboardProps = {
  userId: string;
  email: string;
  isActive: boolean;
  remainingCreations: number;
  stickers: StickerCard[];
};

const MONTHLY_CREATIONS = 20;
const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthKeyFromDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFromKey(monthKey: string) {
  const month = Number(monthKey.split("-")[1]);
  return MONTH_LABELS[month - 1] || "Monthly";
}

function formatStickerDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}

function statusFromSubmittedAt(submittedAt: number): DropStatus {
  const elapsedMs = Date.now() - submittedAt;
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
  if (elapsedDays >= 5) return "shipped";
  if (elapsedDays >= 2) return "printing";
  return "submitted";
}

function statusLabel(status: DropStatus) {
  if (status === "submitted") return "Submitted";
  if (status === "printing") return "Printing";
  return "Shipped";
}

export function MemberDashboard({ userId, email, isActive, remainingCreations, stickers }: DashboardProps) {
  const localStorageKey = `stickier-club:${userId}`;
  const thisMonthKey = useMemo(() => monthKeyFromDate(new Date()), []);
  const thisMonthLabel = useMemo(() => monthLabelFromKey(thisMonthKey), [thisMonthKey]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const [history, setHistory] = useState<StoredDrop["history"]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [shipConfirmOpen, setShipConfirmOpen] = useState(false);

  useEffect(() => {
    let nextState: StoredDrop = {
      monthKey: thisMonthKey,
      selectedIds: [],
      submittedIds: [],
      submittedAt: null,
      history: [],
    };

    try {
      const raw = window.localStorage.getItem(localStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredDrop;
        const safeParsed: StoredDrop = {
          monthKey: typeof parsed.monthKey === "string" ? parsed.monthKey : thisMonthKey,
          selectedIds: Array.isArray(parsed.selectedIds) ? parsed.selectedIds : [],
          submittedIds: Array.isArray(parsed.submittedIds) ? parsed.submittedIds : [],
          submittedAt: typeof parsed.submittedAt === "number" ? parsed.submittedAt : null,
          history: Array.isArray(parsed.history) ? parsed.history : [],
        };

        if (safeParsed.monthKey !== thisMonthKey) {
          if (safeParsed.submittedIds.length === 3 && safeParsed.submittedAt) {
            safeParsed.history = [
              {
                monthKey: safeParsed.monthKey,
                stickerIds: safeParsed.submittedIds,
                submittedAt: safeParsed.submittedAt,
              },
              ...safeParsed.history,
            ];
          }
          nextState = {
            monthKey: thisMonthKey,
            selectedIds: [],
            submittedIds: [],
            submittedAt: null,
            history: safeParsed.history,
          };
        } else {
          nextState = safeParsed;
        }
      }
    } catch {
      // Ignore parse issues and reset to default state.
    }

    setSelectedIds(nextState.selectedIds);
    setSubmittedIds(nextState.submittedIds);
    setSubmittedAt(nextState.submittedAt);
    setHistory(nextState.history);
    setIsHydrated(true);
  }, [localStorageKey, thisMonthKey]);

  useEffect(() => {
    if (!isHydrated) return;
    const snapshot: StoredDrop = {
      monthKey: thisMonthKey,
      selectedIds,
      submittedIds,
      submittedAt,
      history,
    };
    window.localStorage.setItem(localStorageKey, JSON.stringify(snapshot));
  }, [history, isHydrated, localStorageKey, selectedIds, submittedAt, submittedIds, thisMonthKey]);

  const selectedCount = submittedIds.length === 3 ? submittedIds.length : selectedIds.length;
  const canPickForDrop = isActive && submittedIds.length === 0;
  const canShip = canPickForDrop && selectedIds.length === 3;
  const usedCreations = Math.max(0, MONTHLY_CREATIONS - Math.max(0, Math.min(MONTHLY_CREATIONS, remainingCreations)));
  const creationProgress = `${(usedCreations / MONTHLY_CREATIONS) * 100}%`;
  const selectionProgress = `${(selectedCount / 3) * 100}%`;

  const stickersById = useMemo(() => {
    return new Map(stickers.map((sticker) => [sticker.id, sticker]));
  }, [stickers]);

  function toggleSelected(id: string) {
    if (!canPickForDrop) return;
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  }

  function submitDrop() {
    if (!canShip) return;
    const now = Date.now();
    setSubmittedIds(selectedIds);
    setSubmittedAt(now);
    setShipConfirmOpen(false);
  }

  const currentDropStatus = submittedAt ? statusFromSubmittedAt(submittedAt) : null;
  const submittedStickerCards = submittedIds.map((id) => stickersById.get(id)).filter(Boolean) as StickerCard[];

  return (
    <main className="club-shell">
      <header className="club-topbar">
        <Link className="club-logo" href="/">
          STICKIER<sup>TM</sup>
        </Link>
        <p>Sticker Club</p>
        <div className="club-menu" aria-label="Account menu">
          <form action="/api/account/portal" method="post">
            <button type="submit">Manage Membership</button>
          </form>
          <form action="/api/auth/signout" method="post">
            <button type="submit">Sign Out</button>
          </form>
        </div>
      </header>

      <section className="club-membership-overview">
        <div className="club-membership-title">
          <p className="club-kicker">Your membership</p>
          <h1>Sticker Club <span aria-hidden="true">✦</span></h1>
          <strong className={isActive ? "club-active-badge" : "club-inactive-badge"}>
            {isActive ? "Active" : "Inactive"}
          </strong>
        </div>
        {!isActive ? (
          <div className="club-inactive" role="status">
            <h2>Membership inactive</h2>
            <p>Your monthly drop is paused. Restart membership to unlock 20 creations this month and choose your 3.</p>
            <Link className="club-primary-link" href="/membership">
              Restart membership <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <>
            <div className="club-metrics">
              <article>
                <strong>{usedCreations}<span>/ {MONTHLY_CREATIONS}</span></strong>
                <p>Creations used</p>
                <i aria-hidden="true"><span style={{ width: creationProgress }} /></i>
              </article>
              <article>
                <strong>{selectedCount}<span>/ 3</span></strong>
                <p>Prints selected</p>
                <i aria-hidden="true"><span style={{ width: selectionProgress }} /></i>
              </article>
            </div>
            <div className="club-actions-row">
              <small>{Math.max(0, remainingCreations)} creations left in {thisMonthLabel}</small>
              <Link className="club-primary-link" href="/?start=upload">
                Create a sticker
              </Link>
              {submittedIds.length === 3 ? (
                <div className="club-submitted-pill" role="status">
                  <PackageCheck size={16} />
                  Your {thisMonthLabel} drop is being made ✦
                </div>
              ) : selectedIds.length > 0 ? (
                <Button className="club-ship-button" disabled={!canShip} onClick={() => setShipConfirmOpen(true)}>
                  Ship my 3 stickers
                </Button>
              ) : null}
            </div>
            {submittedIds.length === 3 && currentDropStatus ? (
              <div className="club-submitted-block">
                <div className="club-submitted-meta">
                  <p>{thisMonthLabel} drop {statusLabel(currentDropStatus).toLowerCase()}</p>
                  <strong>{Math.max(0, remainingCreations)} sticker creations still available this month</strong>
                </div>
                <div className="club-submitted-previews">
                  {submittedStickerCards.map((sticker) => (
                    <img key={sticker.id} src={sticker.imageUrl} alt="Submitted sticker preview" />
                  ))}
                </div>
                <p className="club-status-line">Status: {statusLabel(currentDropStatus)}</p>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="club-gallery">
        <div className="club-gallery-head">
          <p className="club-kicker">Your archive</p>
          <h2>Your creations.</h2>
          <p>{canPickForDrop ? "Pick your favorites for this month." : "Your picks are locked for this month after shipping."}</p>
        </div>
        {stickers.length === 0 ? (
          <div className="club-empty-gallery">
            <Sparkles size={18} />
            <p>No stickers yet. Make your first set to start your monthly drop.</p>
            <Link className="club-primary-link" href="/?start=upload">
              Start making stickers
            </Link>
          </div>
        ) : (
          <div className="club-sticker-grid">
            {stickers.map((sticker) => {
              const isSelected = selectedIds.includes(sticker.id) || submittedIds.includes(sticker.id);
              const lockedBySubmission = submittedIds.length === 3 && !submittedIds.includes(sticker.id);
              return (
                <article className="club-sticker-card" key={sticker.id}>
                  <img src={sticker.imageUrl} alt="Sticker creation preview" />
                  <div>
                    <p>{formatStickerDate(sticker.createdAt)}</p>
                    <button
                      type="button"
                      className={isSelected ? "selected" : ""}
                      onClick={() => toggleSelected(sticker.id)}
                      disabled={lockedBySubmission || (!isSelected && selectedIds.length >= 3) || !canPickForDrop}
                    >
                      {isSelected ? (
                        <>
                          Selected <Check size={14} />
                        </>
                      ) : (
                        "Add to my 3"
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="club-how">
        <h2>How your membership works</h2>
        <div>
          <article>
            <h3>1. Make</h3>
            <p>Create up to 20 stickers this month.</p>
          </article>
          <article>
            <h3>2. Pick</h3>
            <p>Choose your favorite 3.</p>
          </article>
          <article>
            <h3>3. Ship</h3>
            <p>Submit your 3 anytime before month-end and we&apos;ll mail them to you.</p>
          </article>
        </div>
      </section>

      <section className="club-past" id="past-drops">
        <h2>Past drops</h2>
        {history.length === 0 ? (
          <p>Your submitted monthly drops will appear here.</p>
        ) : (
          <div className="club-past-grid">
            {history.map((drop) => {
              const status = statusFromSubmittedAt(drop.submittedAt);
              return (
                <article key={`${drop.monthKey}-${drop.submittedAt}`}>
                  <header>
                    <h3>{monthLabelFromKey(drop.monthKey)} drop</h3>
                    <span>{statusLabel(status)}</span>
                  </header>
                  <div className="club-past-previews">
                    {drop.stickerIds.map((id) => {
                      const sticker = stickersById.get(id);
                      if (!sticker) return null;
                      return <img key={id} src={sticker.imageUrl} alt="Past drop sticker preview" />;
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="club-account-tools" id="membership-settings">
        <div>
          <p className="club-kicker">Membership settings</p>
          <h2>Account &amp; delivery</h2>
          <p>Signed in as {email}. Billing and delivery details are securely managed by Stripe.</p>
        </div>
        <div className="club-account-actions">
          <form action="/api/account/portal" method="post">
            <button type="submit" name="action" value="address">Change shipping address</button>
          </form>
          <form action="/api/account/portal" method="post">
            <button type="submit" name="action" value="payment">Update credit card</button>
          </form>
          <form action="/api/account/portal" method="post">
            <button className="club-danger-action" type="submit" name="action" value="cancel">Cancel membership</button>
          </form>
        </div>
      </section>

      <Dialog open={shipConfirmOpen} onOpenChange={setShipConfirmOpen}>
        <DialogContent className="club-ship-modal" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Ready to send these?</DialogTitle>
            <DialogDescription>
              We&apos;ll make and mail these 3 as your {thisMonthLabel} Sticker Drop. Once submitted, your picks can&apos;t be changed.
            </DialogDescription>
          </DialogHeader>
          <div className="club-ship-preview-grid">
            {selectedIds.map((id) => {
              const sticker = stickersById.get(id);
              if (!sticker) return null;
              return <img key={id} src={sticker.imageUrl} alt="Sticker selected for shipping" />;
            })}
          </div>
          <DialogFooter className="club-ship-actions">
            <button type="button" className="club-secondary-button" onClick={() => setShipConfirmOpen(false)}>
              Keep editing
            </button>
            <button type="button" className="club-primary-button" onClick={submitDrop}>
              Yes, ship these 3
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
