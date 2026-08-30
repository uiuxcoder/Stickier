"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type FlowStage = "photos" | "details" | "mood" | "generating" | "reveal" | "confirmation";

const FLOW_STAGES: FlowStage[] = ["photos", "details", "mood", "generating", "reveal", "confirmation"];

export function SiteFooter() {
  const pathname = usePathname();
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [isStudioFlowStage, setIsStudioFlowStage] = useState(false);

  useEffect(() => {
    if (pathname !== "/") {
      setIsStudioFlowStage(false);
      return;
    }

    const checkStage = () => {
      const shell = document.querySelector("main.shell");
      if (!shell) {
        setIsStudioFlowStage(false);
        return;
      }
      const inFlow = FLOW_STAGES.some((stage) => shell.classList.contains(stage));
      setIsStudioFlowStage(inFlow);
    };

    checkStage();

    const observer = new MutationObserver(checkStage);
    const shell = document.querySelector("main.shell");
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, [pathname]);

  const legalTarget = isStudioFlowStage ? "_blank" : undefined;
  const legalRel = isStudioFlowStage ? "noopener noreferrer" : undefined;

  const supportTitle = useMemo(
    () => (isStudioFlowStage ? "Support without leaving your flow" : "Need help?"),
    [isStudioFlowStage]
  );

  return (
    <>
      <footer className="site-footer">
        <a href="/privacy" target={legalTarget} rel={legalRel}>Privacy</a>
        <a href="/terms" target={legalTarget} rel={legalRel}>Terms</a>
        <a href="/refunds" target={legalTarget} rel={legalRel}>Refunds</a>
        <button type="button" className="footer-support" onClick={() => setIsSupportOpen(true)}>Support</button>
      </footer>

      {isSupportOpen ? (
        <div className="support-overlay" role="presentation" onClick={() => setIsSupportOpen(false)}>
          <aside
            className="support-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="support-kicker">STICKIER SUPPORT</p>
            <h2 id="support-title">{supportTitle}</h2>
            <p>
              Email us and we will help with orders, downloads, billing, or anything else.
              We usually reply within one business day.
            </p>
            <a className="support-email" href="mailto:hello@saltysticker.com">hello@saltysticker.com</a>
            <button type="button" className="support-close" onClick={() => setIsSupportOpen(false)}>
              Close
            </button>
          </aside>
        </div>
      ) : null}
    </>
  );
}
