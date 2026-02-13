import './styles/main.css';
import './styles/settings-window.css';
import { RuntimeConfigPanel } from '@/components/RuntimeConfigPanel';
import { loadDesktopSecrets } from '@/services/runtime-config';
import { tryInvokeTauri } from '@/services/tauri-bridge';

function setActionStatus(message: string, tone: 'ok' | 'error' = 'ok'): void {
  const statusEl = document.getElementById('settingsActionStatus');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.classList.remove('ok', 'error');
  statusEl.classList.add(tone);
}

async function invokeDesktopAction(command: string, successLabel: string): Promise<void> {
  const result = await tryInvokeTauri<string>(command);
  if (result) {
    setActionStatus(`${successLabel}: ${result}`, 'ok');
    return;
  }

  setActionStatus(`Failed to run ${command}. Check desktop log.`, 'error');
}

async function initSettingsWindow(): Promise<void> {
  await loadDesktopSecrets();

  const mount = document.getElementById('settingsApp');
  if (!mount) return;

  const panel = new RuntimeConfigPanel({ mode: 'full' });
  const panelElement = panel.getElement();
  panelElement.classList.remove('resized', 'span-2', 'span-3', 'span-4');
  panelElement.classList.add('settings-runtime-panel');
  mount.appendChild(panelElement);

  window.addEventListener('beforeunload', () => panel.destroy());

  const openLogsBtn = document.getElementById('openLogsBtn');
  openLogsBtn?.addEventListener('click', () => {
    void invokeDesktopAction('open_logs_folder', 'Opened logs folder');
  });

  const openSidecarLogBtn = document.getElementById('openSidecarLogBtn');
  openSidecarLogBtn?.addEventListener('click', () => {
    void invokeDesktopAction('open_sidecar_log_file', 'Opened API log');
  });

  setActionStatus('Use File -> Settings to configure desktop keys.', 'ok');
}

void initSettingsWindow();
