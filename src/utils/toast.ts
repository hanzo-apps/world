// The ONE transient notification. A single `.toast-notification` element (styled in
// main.css) fades in, holds ~3s, then fades out; a new toast replaces any prior one
// so a burst never stacks. UI-only, no state — call it from anywhere that needs a
// brief, non-blocking confirmation.
export function toast(message: string): void {
  document.querySelector('.toast-notification')?.remove();
  const el = document.createElement('div');
  el.className = 'toast-notification';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}
