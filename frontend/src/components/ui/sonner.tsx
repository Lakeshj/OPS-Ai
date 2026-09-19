"use client";

import { useEffect, useState } from "react";
import {
  ToastContainer,
  cssTransition,
  type Theme,
} from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { toast } from "@/lib/toast";

const FadeIn = cssTransition({
  enter: "opsai-toast-enter",
  exit: "opsai-toast-exit",
  collapse: true,
  collapseDuration: 280,
});

/**
 * OpsAi toast host — premium surfaces opposite the app theme:
 * dark app → light toast; light app → dark toast.
 * Soft fade-in for stacked notifications.
 */
export function Toaster() {
  const [toastTheme, setToastTheme] = useState<Theme>("light");
  const [mode, setMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const sync = () => {
      const appDark = document.documentElement.classList.contains("dark");
      setMode(appDark ? "dark" : "light");
      setToastTheme(appDark ? "light" : "dark");
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <ToastContainer
      position="top-right"
      autoClose={4200}
      hideProgressBar={false}
      newestOnTop
      stacked
      closeOnClick
      rtl={false}
      pauseOnFocusLoss
      draggable
      pauseOnHover
      theme={toastTheme}
      transition={FadeIn}
      limit={5}
      style={{ zIndex: 99999 }}
      toastClassName={`opsai-toast opsai-toast--${mode}`}
      progressClassName="opsai-toast-progress"
      className={`opsai-toast-container opsai-toast-container--${mode}`}
    />
  );
}

export { toast };
