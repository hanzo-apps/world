import type { StoryData } from '@/services/story-data';
import { renderStoryToCanvas } from '@/services/story-renderer';
import { generateStoryDeepLink, getShareUrls, shareTexts } from '@/services/story-share';

let modalEl: HTMLElement | null = null;
let currentDataUrl: string | null = null;
let currentBlob: Blob | null = null;
let currentData: StoryData | null = null;

export function openStoryModal(data: StoryData): void {
  closeStoryModal();
  currentData = data;

  modalEl = document.createElement('div');
  modalEl.className = 'story-modal-overlay';
  modalEl.innerHTML = `
    <div class="story-modal">
      <div class="story-header">
        <h3>Share Intelligence Story</h3>
      </div>
      <div class="story-modal-content">
        <div class="story-loading">
          <div class="story-spinner"></div>
          <span>Generating story...</span>
        </div>
      </div>
      <div class="story-actions" style="display:none">
        <button class="story-btn story-save">💾 Save PNG</button>
        <button class="story-btn story-whatsapp">📱 WhatsApp</button>
        <button class="story-btn story-twitter">🐦 X / Twitter</button>
        <button class="story-btn story-linkedin">💼 LinkedIn</button>
        <button class="story-btn story-copy">📋 Copy Link</button>
        <button class="story-btn story-close">✕ Close</button>
      </div>
      <div class="story-deep-link" style="display:none">
        <input type="text" class="deep-link-input" readonly />
        <button class="story-btn story-copy-link">Copy</button>
      </div>
    </div>
  `;

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeStoryModal();
  });
  modalEl.querySelector('.story-close')?.addEventListener('click', closeStoryModal);
  modalEl.querySelector('.story-save')?.addEventListener('click', downloadStory);
  modalEl.querySelector('.story-whatsapp')?.addEventListener('click', () => currentData && shareWhatsApp(currentData));
  modalEl.querySelector('.story-twitter')?.addEventListener('click', () => currentData && shareTwitter(currentData));
  modalEl.querySelector('.story-linkedin')?.addEventListener('click', () => currentData && shareLinkedIn(currentData));
  modalEl.querySelector('.story-copy')?.addEventListener('click', () => currentData && copyDeepLink(currentData));
  modalEl.querySelector('.story-copy-link')?.addEventListener('click', () => {
    const input = modalEl?.querySelector('.deep-link-input') as HTMLInputElement;
    if (input) {
      navigator.clipboard.writeText(input.value);
      flashButton('.story-copy-link', 'Copied!', 'Copy');
    }
  });

  document.body.appendChild(modalEl);

  requestAnimationFrame(async () => {
    if (!modalEl) return;
    try {
      await renderAndDisplay(data);
    } catch (err) {
      console.error('[StoryModal] Render error:', err);
      const content = modalEl?.querySelector('.story-modal-content');
      if (content) content.innerHTML = '<div class="story-error">Failed to generate story.</div>';
    }
  });
}

async function renderAndDisplay(data: StoryData): Promise<void> {
  const canvas = await renderStoryToCanvas(data);
  currentDataUrl = canvas.toDataURL('image/png');
  
  const binStr = atob(currentDataUrl.split(',')[1] ?? '');
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  currentBlob = new Blob([bytes], { type: 'image/png' });

  const content = modalEl?.querySelector('.story-modal-content');
  if (content) {
    content.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'story-image';
    img.src = currentDataUrl;
    img.alt = `${data.countryName} Intelligence Story`;
    content.appendChild(img);
  }
  
  const actions = modalEl?.querySelector('.story-actions') as HTMLElement;
  if (actions) actions.style.display = 'flex';
  
  const deepLinkSection = modalEl?.querySelector('.story-deep-link') as HTMLElement;
  if (deepLinkSection) {
    deepLinkSection.style.display = 'flex';
    const input = deepLinkSection.querySelector('.deep-link-input') as HTMLInputElement;
    if (input) input.value = generateStoryDeepLink(data.countryCode);
  }
}

export function closeStoryModal(): void {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
    currentDataUrl = null;
    currentBlob = null;
    currentData = null;
  }
}

function downloadStory(): void {
  if (!currentDataUrl) return;
  const a = document.createElement('a');
  a.href = currentDataUrl;
  a.download = `worldmonitor-${currentData?.countryCode.toLowerCase() || 'story'}-${Date.now()}.png`;
  a.click();
  flashButton('.story-save', 'Saved!', '💾 Save PNG');
}

async function shareWhatsApp(data: StoryData): Promise<void> {
  if (!currentBlob) {
    downloadStory();
    return;
  }

  const file = new File([currentBlob], `${data.countryCode.toLowerCase()}-worldmonitor.png`, { type: 'image/png' });
  const urls = getShareUrls(data);

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ 
        text: shareTexts.whatsapp(data).replace('\n\n', '\n'), 
        files: [file] 
      });
      return;
    } catch { /* user cancelled */ }
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': currentBlob }),
    ]);
    flashButton('.story-whatsapp', 'Image copied!', '📱 WhatsApp');
  } catch {
    downloadStory();
    flashButton('.story-whatsapp', 'Saved!', '📱 WhatsApp');
  }
  window.open(urls.whatsapp, '_blank');
}

async function shareTwitter(data: StoryData): Promise<void> {
  const urls = getShareUrls(data);
  window.open(urls.twitter, '_blank');
  flashButton('.story-twitter', 'Opening...', '🐦 X / Twitter');
}

async function shareLinkedIn(data: StoryData): Promise<void> {
  const urls = getShareUrls(data);
  window.open(urls.linkedin, '_blank');
  flashButton('.story-linkedin', 'Opening...', '💼 LinkedIn');
}

async function copyDeepLink(data: StoryData): Promise<void> {
  const link = generateStoryDeepLink(data.countryCode);
  await navigator.clipboard.writeText(link);
  flashButton('.story-copy', 'Link copied!', '📋 Copy Link');
}

function flashButton(selector: string, flashText: string, originalText: string): void {
  const btn = modalEl?.querySelector(selector) as HTMLButtonElement;
  if (btn) {
    btn.textContent = flashText;
    setTimeout(() => { if (btn) btn.textContent = originalText; }, 2500);
  }
}
