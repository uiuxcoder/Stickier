"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, CreditCard, Download, MapPin, PackageCheck, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MemberStickerCreator } from "@/components/member-sticker-creator";
import posthog from "posthog-js";

type DropStatus = "submitted" | "printing" | "shipped" | "delivered";

type StickerCard = {
  id: string;
  imageUrl: string;
  createdAt: number;
};

type MembershipDrop = {
  monthKey: string;
  stickerIds: string[];
  submittedAt: number;
  status: DropStatus;
};

type DashboardProps = {
  userId: string;
  isActive: boolean;
  currentPeriodEnd: number | null;
  remainingCreations: number;
  stickers: StickerCard[];
  shippingAddress: string[];
  drops: MembershipDrop[];
};

type MembershipAction = "address" | "payment" | "cancel" | "restart";
type ShipDialogStage = "review" | "confirmed";

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

function formatEndDate(timestamp: number | null) {
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000); // Convert from seconds to milliseconds
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function MemberDashboard({ isActive, currentPeriodEnd, remainingCreations, stickers, shippingAddress = [], drops }: DashboardProps) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const thisMonthKey = useMemo(() => monthKeyFromDate(new Date()), []);
  const thisMonthLabel = useMemo(() => monthLabelFromKey(thisMonthKey), [thisMonthKey]);
  const initialDrop = drops.find((drop) => drop.monthKey === thisMonthKey) ?? null;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentDrop, setCurrentDrop] = useState<MembershipDrop | null>(initialDrop);
  const [dropError, setDropError] = useState("");
  const [dropSubmitting, setDropSubmitting] = useState(false);
  const [shipConfirmOpen, setShipConfirmOpen] = useState(false);
  const [shipDialogStage, setShipDialogStage] = useState<ShipDialogStage>("review");
  const [shippingAddressConfirmed, setShippingAddressConfirmed] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [membershipAction, setMembershipAction] = useState<MembershipAction | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);

  const submittedIds = currentDrop?.stickerIds ?? [];
  const selectedCount = currentDrop ? currentDrop.stickerIds.length : selectedIds.length;
  const canPickForDrop = isActive && !currentDrop;
  const canShip = canPickForDrop && selectedIds.length === 2;
  const usedCreations = Math.max(0, MONTHLY_CREATIONS - Math.max(0, Math.min(MONTHLY_CREATIONS, remainingCreations)));
  const creationProgress = `${(usedCreations / MONTHLY_CREATIONS) * 100}%`;
  const selectionProgress = `${(selectedCount / 2) * 100}%`;

  const stickersById = useMemo(() => {
    return new Map(stickers.map((sticker) => [sticker.id, sticker]));
  }, [stickers]);

  function toggleSelected(id: string) {
    if (!canPickForDrop) return;
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 2) return current;
      return [...current, id];
    });
  }

  async function submitDrop() {
    if (!canShip || !shippingAddressConfirmed || shippingAddress.length === 0) return;
    setDropError("");
    setDropSubmitting(true);
    try {
      const response = await fetch("/api/membership/drop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stickerIds: selectedIds }),
      });
      const data = await response.json() as MembershipDrop & { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to submit this month’s stickers.");
      if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
        posthog.capture("membership_drop_submitted", { sticker_count: selectedIds.length });
      }
      setCurrentDrop(data);
      setShipDialogStage("confirmed");
    } catch (error) {
      setDropError(error instanceof Error ? error.message : "Unable to submit this month’s stickers.");
    } finally {
      setDropSubmitting(false);
    }
  }

  function setShipDialogOpen(open: boolean) {
    setShippingAddressConfirmed(false);
    setShipDialogStage("review");
    setShipConfirmOpen(open);
  }

  const orders = currentDrop
    ? [currentDrop, ...drops.filter((drop) => drop.monthKey !== currentDrop.monthKey)]
    : drops;

  return (
    <main className="club-shell">
      <header className="club-topbar">
        <Link className="club-logo" href="/">
          SALTY STICKER<sup>TM</sup>
        </Link>
        <div className="club-menu" aria-label="Account menu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="club-manage-trigger">Manage Membership <ChevronDown size={13} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="club-manage-menu">
              <DropdownMenuItem onSelect={() => setMembershipAction("address")}><MapPin /> Update shipping address</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMembershipAction("payment")}><CreditCard /> Update payment method</DropdownMenuItem>
              <DropdownMenuItem variant={isActive ? "destructive" : undefined} onSelect={() => setMembershipAction(isActive ? "cancel" : "restart")}>
                <XCircle /> {isActive ? "Cancel membership" : "Restart membership"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <form action="/api/auth/signout" method="post" onSubmit={() => posthog.reset()}>
            <button type="submit">Sign Out</button>
          </form>
        </div>
      </header>

      <section className="club-membership-overview">
        <div className="club-membership-title">
          <p className="club-kicker">Your membership</p>
          <h1>Sticker Club <span aria-hidden="true">✦</span></h1>
          <div className="club-membership-status">
            <strong className={isActive ? "club-active-badge" : "club-inactive-badge"}>
              {isActive ? "Active" : "Inactive"}
            </strong>
            <button type="button" className="club-how-trigger" onClick={() => setHowItWorksOpen(true)}>How it works</button>
          </div>
        </div>
        {!isActive ? (
          <div className="club-inactive" role="status">
            <h2>Membership inactive</h2>
            {currentPeriodEnd && (
              <p>Your membership ends on {formatEndDate(currentPeriodEnd)}. Your monthly drop is paused. New previews are available for 24 hours and are not saved unless you restart membership or purchase them.</p>
            )}
            {!currentPeriodEnd && (
              <p>Your monthly drop is paused. New previews are available for 24 hours and are not saved unless you restart membership or purchase them.</p>
            )}
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
                <strong>{selectedCount}<span>/ 2</span></strong>
                <p>Prints selected</p>
                <i aria-hidden="true"><span style={{ width: selectionProgress }} /></i>
              </article>
            </div>
          </>
        )}
      </section>

      <section className="club-gallery">
        <div className="club-gallery-head">
          <div>
            <h2>Your creations.</h2>
            <p>{canPickForDrop ? "Pick your favorites for this month." : "Your picks are locked for this month after shipping."}</p>
          </div>
          <div className="club-gallery-actions">
            <button type="button" className="club-primary-link" onClick={() => setCreatorOpen(true)}>Create a sticker</button>
            <Button className="club-ship-button" disabled={!canShip} onClick={() => setShipDialogOpen(true)}>
              Ship selected stickers
            </Button>
          </div>
        </div>
        {stickers.length === 0 ? (
          <div className="club-empty-gallery">
            <Sparkles size={18} />
            <p>No stickers yet. Make your first set to start your monthly drop.</p>
          </div>
        ) : (
          <div className="club-sticker-grid">
            {stickers.map((sticker) => {
              const isSelected = selectedIds.includes(sticker.id) || submittedIds.includes(sticker.id);
              const lockedBySubmission = submittedIds.length === 2 && !submittedIds.includes(sticker.id);
              return (
                <article className="club-sticker-card" key={sticker.id}>
                  <a
                    className="club-download-creation"
                    href={`/api/download-stickers?image_key=${encodeURIComponent(sticker.id)}`}
                    download
                    aria-label="Download creation as ZIP"
                    title="Download creation as ZIP"
                  >
                    <Download size={16} />
                  </a>
                  <img src={sticker.imageUrl} alt="Sticker creation preview" />
                  <div>
                    <p>{formatStickerDate(sticker.createdAt)}</p>
                    <button
                      type="button"
                      className={isSelected ? "selected" : ""}
                      onClick={() => toggleSelected(sticker.id)}
                      disabled={lockedBySubmission || (!isSelected && selectedIds.length >= 2) || !canPickForDrop}
                    >
                      {isSelected ? (
                        <>
                          Selected <Check size={14} />
                        </>
                      ) : (
                        "Add to my 2"
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="club-past" id="orders">
        <h2>Orders</h2>
        {orders.length === 0 ? (
          <p>Your monthly orders will appear here as soon as you submit them.</p>
        ) : (
          <div className="club-past-grid">
            {orders.map((order) => {
              return (
                <article key={`${order.monthKey}-${order.submittedAt}`}>
                  <header>
                    <h3>{monthLabelFromKey(order.monthKey)} order</h3>
                    <span>{statusLabel(order.status)}</span>
                  </header>
                  <div className="club-past-previews">
                    {order.stickerIds.map((id) => {
                      const sticker = stickersById.get(id);
                      if (!sticker) return null;
                      return <img key={id} src={sticker.imageUrl} alt="Ordered sticker preview" />;
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <Dialog open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
        <DialogContent className="club-how-modal">
          <DialogHeader>
            <DialogTitle>How Sticker Club works</DialogTitle>
            <DialogDescription>Create, choose, and ship your monthly favorites.</DialogDescription>
          </DialogHeader>
          <div className="club-how-steps">
            <article><strong>1</strong><div><h3>Make</h3><p>Create up to 20 sticker sheets this month.</p></div></article>
            <article><strong>2</strong><div><h3>Pick</h3><p>Select your favorite 2 from Your Creations.</p></div></article>
            <article><strong>3</strong><div><h3>Ship</h3><p>When all 2 are selected, submit them and we&apos;ll mail them to you.</p></div></article>
          </div>
        </DialogContent>
      </Dialog>

      <MemberStickerCreator
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        onCreated={() => startRefresh(() => router.refresh())}
      />

      <Dialog open={shipConfirmOpen} onOpenChange={setShipDialogOpen}>
        <DialogContent className="club-ship-modal" showCloseButton={false}>
          {shipDialogStage === "review" ? (
            <>
              <DialogHeader>
                <DialogTitle>Are you sure?</DialogTitle>
                <DialogDescription>
                  Confirm your 2 stickers and shipping address. Once submitted, your picks can&apos;t be changed.
                </DialogDescription>
              </DialogHeader>
              <div className="club-ship-preview-grid">
                {selectedIds.map((id) => {
                  const sticker = stickersById.get(id);
                  if (!sticker) return null;
                  return <img key={id} src={sticker.imageUrl} alt="Sticker selected for shipping" />;
                })}
              </div>
              <div className="club-shipping-confirmation">
                <div className="club-shipping-heading">
                  <MapPin size={18} />
                  <strong>Shipping to</strong>
                  {shippingAddress.length > 0 ? (
                    <form action="/api/account/portal" method="post">
                      <input type="hidden" name="action" value="address" />
                      <button type="submit">Change address</button>
                    </form>
                  ) : null}
                </div>
                {shippingAddress.length > 0 ? (
                  <>
                    <address>{shippingAddress.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</address>
                    <label htmlFor="confirm-shipping-address">
                      <input
                        id="confirm-shipping-address"
                        type="checkbox"
                        checked={shippingAddressConfirmed}
                        onChange={(event) => setShippingAddressConfirmed(event.target.checked)}
                      />
                      I confirm this shipping address is correct.
                    </label>
                  </>
                ) : (
                  <p>Add a shipping address before submitting this month&apos;s order.</p>
                )}
              </div>
              <div className="club-order-total">
                <span>Subtotal</span>
                <strong>$0.00</strong>
                <small>Included with your Sticker Club membership</small>
              </div>
              {dropError ? <p role="alert">{dropError}</p> : null}
              <DialogFooter className="club-ship-actions">
                <button type="button" className="club-secondary-button" onClick={() => setShipDialogOpen(false)}>
                  Keep editing
                </button>
                {shippingAddress.length > 0 ? (
                  <button type="button" className="club-primary-button" disabled={!shippingAddressConfirmed || dropSubmitting} onClick={() => void submitDrop()}>
                    {dropSubmitting ? "Submitting..." : "Confirm and ship"}
                  </button>
                ) : (
                  <form action="/api/account/portal" method="post">
                    <input type="hidden" name="action" value="address" />
                    <button type="submit" className="club-primary-button">Add shipping address</button>
                  </form>
                )}
              </DialogFooter>
            </>
          ) : (
            <div className="club-ship-success">
              <PackageCheck aria-hidden="true" />
              <DialogHeader>
                <DialogTitle>Your order is confirmed.</DialogTitle>
                <DialogDescription>
                  Your {thisMonthLabel} stickers are submitted. We&apos;ll send you an email confirmation when they&apos;ve been shipped.
                </DialogDescription>
              </DialogHeader>
              <div className="club-confirmed-address">
                <div><MapPin size={18} /><strong>Shipping to</strong></div>
                <address>{shippingAddress.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</address>
              </div>
              <div className="club-order-total">
                <span>Subtotal</span>
                <strong>$0.00</strong>
                <small>Included with your Sticker Club membership</small>
              </div>
              <button type="button" className="club-primary-button" onClick={() => setShipDialogOpen(false)}>Done</button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={membershipAction !== null} onOpenChange={(open) => { if (!open) setMembershipAction(null); }}>
        <DialogContent className="club-manage-modal">
          <DialogHeader>
            <DialogTitle>
              {membershipAction === "address" ? "Update shipping address" : membershipAction === "payment" ? "Update payment method" : membershipAction === "restart" ? "Restart membership" : "Cancel membership"}
            </DialogTitle>
            <DialogDescription>
              {membershipAction === "address"
                ? "Update the address Stripe will use for your future Sticker Club deliveries."
                : membershipAction === "payment"
                  ? "Update the payment method Stripe will use for future monthly charges."
                  : membershipAction === "restart"
                    ? "Restart your Sticker Club membership for $11.99/month and get access to unlimited digital downloads and 2 sticker sheets each month."
                    : "Your membership will remain active through the end of your current billing period, and you will not be charged next month. You can still use this month's 20-generation allowance and submit your 2 stickers for shipping if you haven't already."}
            </DialogDescription>
          </DialogHeader>
          <div className="club-manage-note">
            {membershipAction === "cancel" ? <PackageCheck size={20} /> : <CreditCard size={20} />}
            <p>{membershipAction === "cancel" ? "Your remaining current-period benefits stay available after you schedule cancellation." : membershipAction === "restart" ? "You'll be securely redirected to Stripe to complete your subscription." : "You'll continue securely in Stripe to save this change."}</p>
          </div>
          <DialogFooter className="club-manage-modal-actions">
            <button type="button" className="club-secondary-button" onClick={() => setMembershipAction(null)}>Go back</button>
            {membershipAction === "restart" ? (
              <button type="button" className="club-primary-button" onClick={() => { router.push("/membership"); setMembershipAction(null); }}>
                Continue to checkout
              </button>
            ) : membershipAction ? (
              <form action="/api/account/portal" method="post">
                <input type="hidden" name="action" value={membershipAction} />
                <button type="submit" className={membershipAction === "cancel" ? "club-danger-button" : "club-primary-button"}>
                  {membershipAction === "cancel" ? "Continue to cancellation" : "Continue to Stripe"}
                </button>
              </form>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
