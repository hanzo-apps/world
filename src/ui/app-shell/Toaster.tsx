/**
 * Toaster — Tamagui-native toast surface using @hanzo/gui's <Toast> primitives.
 * Imperative callers may dispatch:
 *   window.dispatchEvent(new CustomEvent('hanzo:toast', { detail: { message } }))
 */

import { useEffect, useState } from 'react';
import { Toast, ToastProvider, ToastViewport, useToastController } from '@hanzo/gui';

interface IncomingToast {
  type?: 'info' | 'success' | 'error';
  message: string;
  durationMs?: number;
}

function ToastBridge() {
  const ctl = useToastController();
  useEffect(() => {
    const onEvt = (evt: Event) => {
      const detail = (evt as CustomEvent<IncomingToast>).detail;
      if (!detail?.message) return;
      ctl.show(detail.message, { duration: detail.durationMs ?? 4000 });
    };
    window.addEventListener('hanzo:toast', onEvt);
    return () => window.removeEventListener('hanzo:toast', onEvt);
  }, [ctl]);
  return null;
}

export function Toaster() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <ToastProvider swipeDirection="right">
      <Toast />
      <ToastBridge />
      <ToastViewport top={64} right={16} />
    </ToastProvider>
  );
}
