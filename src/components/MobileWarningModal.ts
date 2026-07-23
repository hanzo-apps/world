import { t } from '@/services/i18n';
import { isMobileDevice } from '@/utils';
import { BaseModal } from './BaseModal';

const STORAGE_KEY = 'mobile-warning-dismissed';

export class MobileWarningModal extends BaseModal {
  private element: HTMLElement;

  constructor() {
    super();
    this.element = document.createElement('div');
    this.element.className = 'mobile-warning-overlay';
    this.element.innerHTML = `
      <div class="mobile-warning-modal">
        <div class="mobile-warning-header">
          <span class="mobile-warning-icon">📱</span>
          <span class="mobile-warning-title">${t('modals.mobileWarning.title')}</span>
        </div>
        <div class="mobile-warning-content">
          <p>${t('modals.mobileWarning.description')}</p>
          <p>${t('modals.mobileWarning.tip')}</p>
        </div>
        <div class="mobile-warning-footer">
          <label class="mobile-warning-remember">
            <input type="checkbox" id="mobileWarningRemember">
            <span>${t('modals.mobileWarning.dontShowAgain')}</span>
          </label>
          <button class="mobile-warning-btn">${t('modals.mobileWarning.gotIt')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.element);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.element.querySelector('.mobile-warning-btn')?.addEventListener('click', () => {
      this.hide();
    });
  }

  public show(): void {
    this.open();
  }

  public hide(): void {
    this.close();
  }

  protected mountOverlay(): HTMLElement {
    this.element.classList.add('active');
    return this.element;
  }

  // Persist the "don't show again" choice on any close (button, backdrop, or
  // Escape) — the checkbox reflects the user's intent regardless of how they
  // dismissed the modal.
  protected unmountOverlay(): void {
    const checkbox = this.element.querySelector('#mobileWarningRemember') as HTMLInputElement | null;
    if (checkbox?.checked) {
      localStorage.setItem(STORAGE_KEY, 'true');
    }
    this.element.classList.remove('active');
  }

  public static shouldShow(): boolean {
    if (localStorage.getItem(STORAGE_KEY) === 'true') return false;
    return isMobileDevice();
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}
