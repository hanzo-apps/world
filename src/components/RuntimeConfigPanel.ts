import { Panel } from './Panel';
import {
  RUNTIME_FEATURES,
  getRuntimeConfigSnapshot,
  getSecretState,
  isFeatureAvailable,
  isFeatureEnabled,
  setFeatureToggle,
  setSecretValue,
  subscribeRuntimeConfig,
  type RuntimeFeatureDefinition,
  type RuntimeSecretKey,
} from '@/services/runtime-config';
import { invokeTauri } from '@/services/tauri-bridge';
import { escapeHtml } from '@/utils/sanitize';
import { isDesktopRuntime } from '@/services/runtime';

interface RuntimeConfigPanelOptions {
  mode?: 'full' | 'alert';
}

export class RuntimeConfigPanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  private readonly mode: 'full' | 'alert';

  constructor(options: RuntimeConfigPanelOptions = {}) {
    super({ id: 'runtime-config', title: 'Desktop Configuration', showCount: false });
    this.mode = options.mode ?? (isDesktopRuntime() ? 'alert' : 'full');
    this.unsubscribe = subscribeRuntimeConfig(() => this.render());
    this.render();
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  protected render(): void {
    const snapshot = getRuntimeConfigSnapshot();
    const desktop = isDesktopRuntime();

    if (desktop && this.mode === 'alert') {
      const totalFeatures = RUNTIME_FEATURES.length;
      const availableFeatures = RUNTIME_FEATURES.filter((feature) => isFeatureAvailable(feature.id)).length;
      const missingFeatures = Math.max(0, totalFeatures - availableFeatures);
      const missingSecrets = Array.from(
        new Set(
          RUNTIME_FEATURES
            .flatMap((feature) => feature.requiredSecrets)
            .filter((key) => !getSecretState(key).valid),
        ),
      );

      const alertTitle = missingFeatures > 0 ? 'Settings not configured' : 'Desktop settings configured';
      const alertClass = missingFeatures > 0 ? 'warn' : 'ok';
      const missingPreview = missingSecrets.length > 0
        ? missingSecrets.slice(0, 4).join(', ')
        : 'None';
      const missingTail = missingSecrets.length > 4 ? ` +${missingSecrets.length - 4} more` : '';

      this.content.innerHTML = `
        <section class="runtime-alert runtime-alert-${alertClass}">
          <h3>${alertTitle}</h3>
          <p>
            ${availableFeatures}/${totalFeatures} features available · ${Object.keys(snapshot.secrets).length} local secrets configured.
          </p>
          <p class="runtime-alert-missing">
            Missing keys: ${escapeHtml(`${missingPreview}${missingTail}`)}
          </p>
          <button type="button" class="runtime-open-settings-btn" data-open-settings>
            Open Settings
          </button>
        </section>
      `;
      this.attachListeners();
      return;
    }

    this.content.innerHTML = `
      <div class="runtime-config-summary">
        ${desktop ? 'Desktop mode' : 'Web mode (read-only, server-managed credentials)'} · ${Object.keys(snapshot.secrets).length} local secrets configured · ${RUNTIME_FEATURES.filter(f => isFeatureAvailable(f.id)).length}/${RUNTIME_FEATURES.length} features available
      </div>
      <div class="runtime-config-list">
        ${RUNTIME_FEATURES.map(feature => this.renderFeature(feature)).join('')}
      </div>
    `;

    this.attachListeners();
  }

  private renderFeature(feature: RuntimeFeatureDefinition): string {
    const enabled = isFeatureEnabled(feature.id);
    const available = isFeatureAvailable(feature.id);
    const secrets = feature.requiredSecrets.map((key) => this.renderSecretRow(key)).join('');
    const desktop = isDesktopRuntime();
    const fallbackClass = available ? 'ok' : 'fallback';

    return `
      <section class="runtime-feature ${available ? 'available' : 'degraded'}">
        <header class="runtime-feature-header">
          <label>
            <input type="checkbox" data-toggle="${feature.id}" ${enabled ? 'checked' : ''} ${desktop ? '' : 'disabled'}>
            <span>${escapeHtml(feature.name)}</span>
          </label>
          <span class="runtime-pill ${available ? 'ok' : 'warn'}">${available ? 'Ready' : 'Fallback'}</span>
        </header>
        <p class="runtime-feature-desc">${escapeHtml(feature.description)}</p>
        <div class="runtime-secrets">${secrets}</div>
        <p class="runtime-feature-fallback ${fallbackClass}">${escapeHtml(feature.fallback)}</p>
      </section>
    `;
  }

  private renderSecretRow(key: RuntimeSecretKey): string {
    const state = getSecretState(key);
    const status = !state.present ? 'Missing' : state.valid ? `Valid (${state.source})` : 'Looks invalid';
    return `
      <div class="runtime-secret-row">
        <code>${escapeHtml(key)}</code>
        <span class="runtime-secret-status ${state.valid ? 'ok' : 'warn'}">${escapeHtml(status)}</span>
        <input type="password" data-secret="${key}" placeholder="Set secret" autocomplete="off" ${isDesktopRuntime() ? '' : 'disabled'}>
      </div>
    `;
  }

  private attachListeners(): void {
    if (!isDesktopRuntime()) return;

    if (this.mode === 'alert') {
      this.content.querySelector<HTMLButtonElement>('[data-open-settings]')?.addEventListener('click', () => {
        void invokeTauri<void>('open_settings_window_command').catch((error) => {
          console.warn('[runtime-config] Failed to open settings window', error);
        });
      });
      return;
    }

    this.content.querySelectorAll<HTMLInputElement>('input[data-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const featureId = input.dataset.toggle as RuntimeFeatureDefinition['id'] | undefined;
        if (!featureId) return;
        setFeatureToggle(featureId, input.checked);
      });
    });

    this.content.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.secret as RuntimeSecretKey | undefined;
        if (!key) return;
        void setSecretValue(key, input.value);
        input.value = '';
      });
    });
  }
}
