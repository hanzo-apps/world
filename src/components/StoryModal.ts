import type { StoryData } from '@/services/story-data';
import { generateStoryImage } from '@/services/story-data';

let modalEl: HTMLElement | null = null;
let currentImage: string | null = null;

export function openStoryModal(data: StoryData): void {
  closeStoryModal();

  modalEl = document.createElement('div');
  modalEl.className = 'story-modal-overlay';
  modalEl.innerHTML = `
    <div class="story-modal">
      <div class="story-modal-content">
        <div class="story-loading">
          <div class="story-spinner"></div>
          <span>Generating ${data.countryName} story...</span>
        </div>
      </div>
      <div class="story-actions" style="display:none">
        <button class="story-btn story-download">Download PNG</button>
        <button class="story-btn story-share">Share</button>
        <button class="story-btn story-close">Close</button>
      </div>
    </div>
  `;

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeStoryModal();
  });
  modalEl.querySelector('.story-close')?.addEventListener('click', closeStoryModal);
  modalEl.querySelector('.story-download')?.addEventListener('click', downloadStory);
  modalEl.querySelector('.story-share')?.addEventListener('click', () => shareStory(data.countryName));

  document.body.appendChild(modalEl);

  generateStoryImage(data).then(image => {
    if (!modalEl) return;
    if (!image) {
      const content = modalEl.querySelector('.story-modal-content');
      if (content) content.innerHTML = '<div class="story-error">Failed to generate story. Try again.</div>';
      return;
    }
    currentImage = image;
    const content = modalEl.querySelector('.story-modal-content');
    if (content) content.innerHTML = `<img class="story-image" src="${image}" alt="${data.countryName} Intelligence Story" />`;
    const actions = modalEl.querySelector('.story-actions') as HTMLElement;
    if (actions) actions.style.display = 'flex';
  });
}

export function closeStoryModal(): void {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
    currentImage = null;
  }
}

function downloadStory(): void {
  if (!currentImage) return;
  const a = document.createElement('a');
  a.href = currentImage;
  a.download = `worldmonitor-story-${Date.now()}.png`;
  a.click();
}

async function shareStory(countryName: string): Promise<void> {
  if (!currentImage) return;

  try {
    const resp = await fetch(currentImage);
    const blob = await resp.blob();
    const file = new File([blob], `${countryName.toLowerCase()}-worldmonitor.png`, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: `${countryName} — WorldMonitor`,
        text: `Current intelligence snapshot for ${countryName}`,
        files: [file],
      });
      return;
    }
  } catch {
    // Web Share API not available or cancelled
  }

  // Fallback: copy image to clipboard
  try {
    const resp = await fetch(currentImage);
    const blob = await resp.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
    const btn = modalEl?.querySelector('.story-share');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => { if (btn) btn.textContent = 'Share'; }, 2000);
    }
  } catch {
    // Clipboard API not available
    downloadStory();
  }
}
