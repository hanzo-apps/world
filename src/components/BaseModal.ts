// BaseModal — the shared behavior every full-screen overlay modal needs, and
// nothing more:
//   • backdrop click (on the overlay itself) closes,
//   • Escape closes (the key listener lives only while the modal is open),
//   • a basic focus trap: focus the first focusable element on open and restore
//     focus to whatever the user had focused, on close.
//
// It is deliberately agnostic about HOW the overlay becomes visible. Subclasses
// implement mountOverlay()/unmountOverlay() to either toggle `.active` on a
// persistent element (SignalModal, MobileWarningModal) or create/remove an
// ephemeral one (SearchModal, StoryModal). open()/close() are the one canonical
// lifecycle; a subclass maps its public methods (show/hide/open/close) onto them.

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export abstract class BaseModal {
  /** The visible overlay element while open; null while closed. */
  protected overlay: HTMLElement | null = null;
  private previouslyFocused: HTMLElement | null = null;
  private opened = false;

  /** Reveal the overlay and return it: create it (ephemeral), or add `.active`
   *  to a persistent element and return that. */
  protected abstract mountOverlay(): HTMLElement;
  /** Hide the overlay: remove `.active`, or detach the element. */
  protected abstract unmountOverlay(): void;

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    const overlay = this.mountOverlay();
    this.overlay = overlay;
    overlay.addEventListener('click', this.onBackdropClick);
    document.addEventListener('keydown', this.onKeydown);
    this.focusFirst();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    document.removeEventListener('keydown', this.onKeydown);
    this.overlay?.removeEventListener('click', this.onBackdropClick);
    this.unmountOverlay();
    this.overlay = null;
    this.previouslyFocused?.focus?.();
    this.previouslyFocused = null;
  }

  private focusFirst(): void {
    this.overlay?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
  }

  private readonly onBackdropClick = (e: MouseEvent): void => {
    if (e.target === this.overlay) this.close();
  };

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  };
}
