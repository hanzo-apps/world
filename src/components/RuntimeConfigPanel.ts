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
import { escapeHtml } from '@/utils/sanitize';
import { isDesktopRuntime } from '@/services/runtime';

export class RuntimeConfigPanel extends Panel {
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({ id: 'runtime-config', title: 'Desktop Configuration', showCount: false });
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
