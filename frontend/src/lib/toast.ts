"use client";

/**
 * App-wide toast API — react-toastify under the hood.
 * Kept compatible with existing `import { toast } from "sonner"` call sites
 * (including toast.message used across workflows).
 */
import {
  toast as rtToast,
  type Id,
  type ToastContent,
  type ToastOptions,
} from "react-toastify";

const baseOptions: ToastOptions = {
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
  progress: undefined,
};

type Message = ToastContent;

const merge = (options?: ToastOptions): ToastOptions => ({
  ...baseOptions,
  ...options,
  hideProgressBar: options?.hideProgressBar ?? false,
});

const toastFn = (message: Message, options?: ToastOptions): Id =>
  rtToast(message, merge(options));

export const toast = Object.assign(toastFn, {
  success: (message: Message, options?: ToastOptions): Id =>
    rtToast.success(message, merge(options)),
  error: (message: Message, options?: ToastOptions): Id =>
    rtToast.error(message, merge(options)),
  info: (message: Message, options?: ToastOptions): Id =>
    rtToast.info(message, merge(options)),
  warning: (message: Message, options?: ToastOptions): Id =>
    rtToast.warning(message, merge(options)),
  warn: (message: Message, options?: ToastOptions): Id =>
    rtToast.warn(message, merge(options)),
  /** Sonner-compatible neutral toast */
  message: (message: Message, options?: ToastOptions): Id =>
    rtToast(message, merge(options)),
  loading: (message: Message, options?: ToastOptions): Id =>
    rtToast.loading(message, merge(options)),
  promise: rtToast.promise.bind(rtToast),
  dismiss: (id?: Id) => rtToast.dismiss(id),
  isActive: (id: Id) => rtToast.isActive(id),
  update: rtToast.update,
  done: rtToast.done,
});

export default toast;
