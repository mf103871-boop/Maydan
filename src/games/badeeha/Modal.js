import React from "../../design/react.js";
import { wait } from "../../shared/fx/index.js";
const { useState, useEffect, useRef } = React;
const hBeta = React.createElement;

export function MaydanModal({ title, onClose, children, bottom = !1 }) {
  const modalRef = useRef(null),
    previousFocusRef = useRef(null),
    // الإغلاق يمرّ بحالة is-closing (~180ms) ثم يستدعي onClose؛ المرجع يُبقي معالج Escape محدّثًا.
    [closing, setClosing] = useState(!1),
    closeRef = useRef(null);
  const requestClose = () => {
    if (closing) return;
    (setClosing(!0), window.setTimeout(() => onClose(), wait(180)));
  };
  closeRef.current = requestClose;
  return (
    useEffect(() => {
      previousFocusRef.current = document.activeElement;
      const modal = modalRef.current;
      if (!modal) return;
      const focusable = () =>
          Array.from(
            modal.querySelectorAll(
              "button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex='-1'])",
            ),
          ),
        first = focusable()[0];
      first && window.setTimeout(() => first.focus(), 0);
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          (event.preventDefault(), closeRef.current && closeRef.current());
          return;
        }
        if (event.key !== "Tab") return;
        const items = focusable();
        if (!items.length) return;
        const firstItem = items[0],
          lastItem = items[items.length - 1];
        event.shiftKey && document.activeElement === firstItem
          ? (event.preventDefault(), lastItem.focus())
          : !event.shiftKey &&
            document.activeElement === lastItem &&
            (event.preventDefault(), firstItem.focus());
      };
      return (
        document.addEventListener("keydown", onKeyDown),
        () => {
          document.removeEventListener("keydown", onKeyDown);
          const previous = previousFocusRef.current;
          previous && typeof previous.focus == "function" && previous.focus();
        }
      );
    }, []),
    hBeta(
      "div",
      {
        className: `m-modal-layer ${bottom ? "is-bottom" : ""} ${closing ? "is-closing" : ""}`,
        role: "presentation",
        onClick: requestClose,
      },
      hBeta(
        "section",
        {
          ref: modalRef,
          className: "m-modal",
          "data-design-screen": "system.dialog",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": title,
          onClick: (event) => event.stopPropagation(),
        },
        hBeta(
          "div",
          { "data-design-id": "header", className: "m-modal-head" },
          hBeta("h2", null, title),
          hBeta(
            "button",
            { "data-design-id": "close", "data-design-required": "true", type: "button", className: "m-icon-btn", onClick: requestClose, "aria-label": "إغلاق" },
            "✕",
          ),
        ),
        children,
      ),
    )
  );
}
