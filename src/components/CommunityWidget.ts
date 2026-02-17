const DISMISSED_KEY = 'wm-community-dismissed';
const DISCUSSION_URL = 'https://github.com/koala73/worldmonitor/discussions/94';

export function mountCommunityWidget(): void {
  if (localStorage.getItem(DISMISSED_KEY) === 'true') return;

  const widget = document.createElement('div');
  widget.className = 'community-widget';
  widget.innerHTML = `
    <div class="cw-pill">
      <div class="cw-dot"></div>
      <span class="cw-text">Join the Discussion</span>
      <a class="cw-cta" href="${DISCUSSION_URL}" target="_blank" rel="noopener">Open Discussion</a>
      <button class="cw-close" aria-label="Close">&times;</button>
    </div>
    <button class="cw-dismiss">Don't show again</button>
  `;

  const dismiss = () => {
    widget.classList.add('cw-hiding');
    setTimeout(() => widget.remove(), 300);
  };

  widget.querySelector('.cw-close')!.addEventListener('click', dismiss);

  widget.querySelector('.cw-dismiss')!.addEventListener('click', () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    dismiss();
  });

  document.body.appendChild(widget);
}
