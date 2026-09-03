"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CreditCard,
  Download,
  MapPin,
  PackageCheck,
  Settings,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  email: string;
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
const MONTHLY_PRINTS = 2;
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthKeyFromDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFromKey(monthKey: string) {
  const month = Number(monthKey.split("-")[1]);
  return MONTH_LABELS[month - 1] || "Monthly";
}

function formatStickerDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function statusLabel(status: DropStatus) {
  if (status === "submitted") return "Submitted";
  if (status === "printing") return "Printing";
  if (status === "shipped") return "Shipped";
  return "Delivered";
}

function getRenewalLabel(currentPeriodEnd: number | null) {
  const date = currentPeriodEnd
    ? new Date(currentPeriodEnd * 1000)
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0));
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function MemberDashboardV2({
  email,
  isActive,
  currentPeriodEnd,
  remainingCreations,
  stickers,
  shippingAddress = [],
  drops,
}: DashboardProps) {
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
  const canShip = canPickForDrop && selectedIds.length === MONTHLY_PRINTS;
  const usedCreations = Math.max(0, MONTHLY_CREATIONS - Math.max(0, Math.min(MONTHLY_CREATIONS, remainingCreations)));
  const creationProgress = `${(usedCreations / MONTHLY_CREATIONS) * 100}%`;
  const initials = email.slice(0, 2).toUpperCase();

  const stickersById = useMemo(() => {
    return new Map(stickers.map((sticker) => [sticker.id, sticker]));
  }, [stickers]);

  const orders = currentDrop
    ? [currentDrop, ...drops.filter((drop) => drop.monthKey !== currentDrop.monthKey)]
    : drops;

  function toggleSelected(id: string) {
    if (!canPickForDrop) return;
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MONTHLY_PRINTS) return current;
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
        posthog.capture("membership_drop_submitted", { sticker_count: selectedIds.length, account_variant: "v2" });
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

  return (
    <main className="account-v2-shell">
      <header className="account-v2-topbar">
        <Link className="account-v2-wordmark" href="/">
          SALTY STICKER<sup>TM</sup>
        </Link>
        <nav className="account-v2-topnav" aria-label="Account navigation">
          <button type="button" onClick={() => setHowItWorksOpen(true)}>How it works</button>
          <a href="mailto:hello@saltysticker.com">Help</a>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="account-v2-avatar" type="button" aria-label="Open account menu">{initials}</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="account-v2-menu">
              <DropdownMenuItem onSelect={() => setMembershipAction("address")}><MapPin /> Update shipping address</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMembershipAction("payment")}><CreditCard /> Update payment method</DropdownMenuItem>
              <DropdownMenuItem variant={isActive ? "destructive" : undefined} onSelect={() => setMembershipAction(isActive ? "cancel" : "restart")}>
                <XCircle /> {isActive ? "Cancel membership" : "Restart membership"}
              </DropdownMenuItem>
              <form action="/api/auth/signout" method="post" onSubmit={() => posthog.reset()}>
                <button type="submit">Sign out</button>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </header>

      <div className="account-v2-main">
        <section className="account-v2-membership-row">
          <div>
            <p className="account-v2-kicker">
              <span aria-hidden="true" /> Sticker Club · {isActive ? "Active" : "Inactive"}
            </p>
            <h1>Your {thisMonthLabel} picks.</h1>
            <p className="account-v2-intro">
              {isActive
                ? `Create up to ${MONTHLY_CREATIONS} sticker sheets, then choose ${MONTHLY_PRINTS} favorites to print and ship this month.`
                : "Restart your membership to create new sticker sheets and receive your next monthly shipment."}
            </p>
          </div>

          <aside className="account-v2-plan-facts" aria-label="Membership usage">
            {isActive ? (
              <>
                <div className="account-v2-plan-title">
                  <strong>{usedCreations} of {MONTHLY_CREATIONS} created</strong>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="account-v2-manage">Manage plan</button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="account-v2-menu">
                      <DropdownMenuItem onSelect={() => setMembershipAction("address")}><MapPin /> Update shipping address</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setMembershipAction("payment")}><CreditCard /> Update payment method</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setMembershipAction("cancel")}><XCircle /> Cancel membership</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="account-v2-usage">
                  <div className="account-v2-usage-copy">
                    <span>{remainingCreations} creations remaining</span>
                    <span>{Math.round((usedCreations / MONTHLY_CREATIONS) * 100)}% used</span>
                  </div>
                  <div className="account-v2-meter" aria-hidden="true"><span style={{ width: creationProgress }} /></div>
                </div>
                <p className="account-v2-renewal">Allowance resets {getRenewalLabel(currentPeriodEnd)} · {MONTHLY_PRINTS} prints included</p>
              </>
            ) : (
              <div className="account-v2-inactive-plan">
                <strong>Membership paused</strong>
                <p>Your monthly allowance and shipment are currently inactive.</p>
                <Link href="/membership">Restart membership</Link>
              </div>
            )}
          </aside>
        </section>

        <section className="account-v2-steps" aria-label="Monthly sticker process">
          <div className="account-v2-step" data-state={stickers.length ? "done" : "current"}>
            <span className="account-v2-step-number">{stickers.length ? "✓" : "1"}</span>
            <span><strong>Create</strong><small>{stickers.length ? `${stickers.length} sheets ready` : "Make your first sheet"}</small></span>
          </div>
          <div className="account-v2-step" data-state={currentDrop ? "done" : stickers.length ? "current" : "upcoming"}>
            <span className="account-v2-step-number">{currentDrop ? "✓" : "2"}</span>
            <span><strong>Choose {MONTHLY_PRINTS}</strong><small>{selectedCount} of {MONTHLY_PRINTS} selected</small></span>
          </div>
          <div className="account-v2-step" data-state={currentDrop ? "done" : "upcoming"}>
            <span className="account-v2-step-number">{currentDrop ? "✓" : "3"}</span>
            <span><strong>Review &amp; ship</strong><small>{currentDrop ? statusLabel(currentDrop.status) : "Confirm your address"}</small></span>
          </div>
        </section>

        <section className="account-v2-workspace">
          <div className="account-v2-workspace-header">
            <div>
              <h2>{currentDrop ? `${thisMonthLabel} picks submitted` : `Choose ${MONTHLY_PRINTS} favorites`}</h2>
              <p>{currentDrop ? "Your picks are locked while we prepare your shipment." : "Select any sheet to add it to this month’s shipment."}</p>
            </div>
            <button className="account-v2-action" type="button" disabled={!isActive} onClick={() => setCreatorOpen(true)}>+ Create new sticker</button>
          </div>

          {stickers.length === 0 ? (
            <div className="account-v2-empty">
              <p>No sticker sheets yet. Create your first one to begin this month’s picks.</p>
              <button type="button" disabled={!isActive} onClick={() => setCreatorOpen(true)}>Create a sticker</button>
            </div>
          ) : (
            <div className="account-v2-pick-grid" aria-label="Your sticker creations">
              {stickers.map((sticker, index) => {
                const isSelected = selectedIds.includes(sticker.id) || submittedIds.includes(sticker.id);
                const lockedBySubmission = submittedIds.length === MONTHLY_PRINTS && !submittedIds.includes(sticker.id);
                return (
                  <article className="account-v2-pick" data-selected={isSelected} key={sticker.id}>
                    <div className="account-v2-artboard">
                      <img src={sticker.imageUrl} alt={`Sticker sheet ${stickers.length - index} preview`} />
                      <span className="account-v2-check" aria-hidden="true"><Check /></span>
                    </div>
                    <div className="account-v2-pick-meta">
                      <span>
                        <strong>Sticker sheet {String(stickers.length - index).padStart(2, "0")}</strong>
                        <small>Created {formatStickerDate(sticker.createdAt)}</small>
                      </span>
                      <a href={`/api/download-stickers?image_key=${encodeURIComponent(sticker.id)}`} download aria-label="Download sticker sheet" title="Download sticker sheet"><Download /></a>
                    </div>
                    <button
                      className="account-v2-select"
                      type="button"
                      aria-pressed={isSelected}
                      disabled={lockedBySubmission || (!isSelected && selectedIds.length >= MONTHLY_PRINTS) || !canPickForDrop}
                      onClick={() => toggleSelected(sticker.id)}
                    >
                      {isSelected ? "Selected ✓" : "Select this sheet"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          {isActive ? (
            <div className="account-v2-selection-bar">
              <div>
                <strong>{selectedCount} / {MONTHLY_PRINTS}</strong>
                <span>
                  {currentDrop
                    ? `Your ${thisMonthLabel} order is ${statusLabel(currentDrop.status).toLowerCase()}.`
                    : selectedCount === 0
                      ? `Choose ${MONTHLY_PRINTS} sheets to continue.`
                      : selectedCount < MONTHLY_PRINTS
                        ? `${MONTHLY_PRINTS - selectedCount} more favorite${MONTHLY_PRINTS - selectedCount === 1 ? "" : "s"} to go.`
                        : "Your picks are ready to review."}
                </span>
              </div>
              <button
                type="button"
                disabled={!currentDrop && !canShip}
                onClick={() => currentDrop
                  ? document.getElementById("accountv2-orders")?.scrollIntoView({ behavior: "smooth" })
                  : setShipDialogOpen(true)}
              >
                {currentDrop ? "View order" : "Review & ship"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="account-v2-orders" id="accountv2-orders">
          <h2>Previous orders</h2>
          {orders.length === 0 ? (
            <div className="account-v2-order-empty">
              <span>No sticker shipments yet. Your first order will appear here after checkout.</span>
              <a href="mailto:hello@saltysticker.com">Shipping help</a>
            </div>
          ) : (
            <div className="account-v2-order-list">
              {orders.map((order) => (
                <article key={`${order.monthKey}-${order.submittedAt}`}>
                  <div><h3>{monthLabelFromKey(order.monthKey)} order</h3><span>{statusLabel(order.status)}</span></div>
                  <div>
                    {order.stickerIds.map((id) => {
                      const sticker = stickersById.get(id);
                      return sticker ? <img key={id} src={sticker.imageUrl} alt="Ordered sticker sheet preview" /> : null;
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
        <DialogContent className="account-v2-modal">
          <DialogHeader>
            <DialogTitle>How Sticker Club works</DialogTitle>
            <DialogDescription>Create, choose, and ship your monthly favorites.</DialogDescription>
          </DialogHeader>
          <div className="account-v2-how-steps">
            <article><strong>1</strong><div><h3>Create</h3><p>Make up to {MONTHLY_CREATIONS} sticker sheets this month.</p></div></article>
            <article><strong>2</strong><div><h3>Choose {MONTHLY_PRINTS}</h3><p>Select your favorite sheets for this month’s shipment.</p></div></article>
            <article><strong>3</strong><div><h3>Review &amp; ship</h3><p>Confirm your picks and shipping address.</p></div></article>
          </div>
        </DialogContent>
      </Dialog>

      <MemberStickerCreator
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        onCreated={() => startRefresh(() => router.refresh())}
      />

      <Dialog open={shipConfirmOpen} onOpenChange={setShipDialogOpen}>
        <DialogContent className="account-v2-modal account-v2-ship-modal" showCloseButton={false}>
          {shipDialogStage === "review" ? (
            <>
              <DialogHeader>
                <DialogTitle>Review your picks</DialogTitle>
                <DialogDescription>Confirm your {MONTHLY_PRINTS} sticker sheets and shipping address. Your picks can’t be changed after submission.</DialogDescription>
              </DialogHeader>
              <div className="account-v2-ship-previews">
                {selectedIds.map((id) => {
                  const sticker = stickersById.get(id);
                  return sticker ? <img key={id} src={sticker.imageUrl} alt="Sticker sheet selected for shipping" /> : null;
                })}
              </div>
              <div className="account-v2-shipping-address">
                <div><MapPin /><strong>Shipping to</strong></div>
                {shippingAddress.length > 0 ? (
                  <>
                    <address>{shippingAddress.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</address>
                    <label htmlFor="account-v2-confirm-address">
                      <input id="account-v2-confirm-address" type="checkbox" checked={shippingAddressConfirmed} onChange={(event) => setShippingAddressConfirmed(event.target.checked)} />
                      I confirm this shipping address is correct.
                    </label>
                  </>
                ) : (
                  <p>Add a shipping address before submitting this month’s order.</p>
                )}
              </div>
              {dropError ? <p className="account-v2-error" role="alert">{dropError}</p> : null}
              <DialogFooter className="account-v2-modal-actions">
                <button type="button" className="account-v2-secondary" onClick={() => setShipDialogOpen(false)}>Keep editing</button>
                {shippingAddress.length > 0 ? (
                  <button type="button" className="account-v2-primary" disabled={!shippingAddressConfirmed || dropSubmitting} onClick={() => void submitDrop()}>
                    {dropSubmitting ? "Submitting..." : "Confirm & ship"}
                  </button>
                ) : (
                  <form action="/api/account/portal" method="post">
                    <input type="hidden" name="action" value="address" />
                    <button type="submit" className="account-v2-primary">Add shipping address</button>
                  </form>
                )}
              </DialogFooter>
            </>
          ) : (
            <div className="account-v2-ship-success">
              <PackageCheck />
              <DialogHeader>
                <DialogTitle>Your order is confirmed.</DialogTitle>
                <DialogDescription>Your {thisMonthLabel} stickers are submitted. We’ll email you when they ship.</DialogDescription>
              </DialogHeader>
              <button type="button" className="account-v2-primary" onClick={() => setShipDialogOpen(false)}>Done</button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={membershipAction !== null} onOpenChange={(open) => { if (!open) setMembershipAction(null); }}>
        <DialogContent className="account-v2-modal">
          <DialogHeader>
            <DialogTitle>
              {membershipAction === "address" ? "Update shipping address" : membershipAction === "payment" ? "Update payment method" : membershipAction === "restart" ? "Restart membership" : "Cancel membership"}
            </DialogTitle>
            <DialogDescription>
              {membershipAction === "address"
                ? "Update the address used for future Sticker Club deliveries."
                : membershipAction === "payment"
                  ? "Update the payment method used for future monthly charges."
                  : membershipAction === "restart"
                    ? "Restart your Sticker Club membership for $11.99/month and receive two sticker sheets each month."
                  : "Your membership will remain active through the end of the current billing period."}
            </DialogDescription>
          </DialogHeader>
          <div className="account-v2-manage-note">
            <Settings />
            <p>{membershipAction === "cancel" ? "You can still use your current-period benefits after scheduling cancellation." : membershipAction === "restart" ? "You’ll continue securely to restart your membership." : "You’ll continue securely in Stripe to save this change."}</p>
          </div>
          <DialogFooter className="account-v2-modal-actions">
            <button type="button" className="account-v2-secondary" onClick={() => setMembershipAction(null)}>Go back</button>
            {membershipAction === "restart" ? (
              <button type="button" className="account-v2-primary" onClick={() => { router.push("/membership"); setMembershipAction(null); }}>
                Continue to checkout
              </button>
            ) : membershipAction ? (
              <form action="/api/account/portal" method="post">
                <input type="hidden" name="action" value={membershipAction} />
                <button type="submit" className={membershipAction === "cancel" ? "account-v2-danger" : "account-v2-primary"}>
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
