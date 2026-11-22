// Entry point. `npm run build` compiles src/ to js/, and index.html loads js/main.js.
import { mountShapeAvatar } from './avatar.js';
import { mountHeatmap } from './heatmap.js';

const avatar = document.querySelector<HTMLButtonElement>('#avatar');
const svg = avatar?.querySelector('svg');
if (avatar && svg) {
  const redraw = mountShapeAvatar(svg, 'assets/avatar.webp');
  avatar.addEventListener('click', redraw);
}

// Each heatmap gets its own one-hue ramp, so the two scales aren't read as one.
const anki = document.querySelector<HTMLElement>('#anki-heatmap');
if (anki) {
  void mountHeatmap(anki, {
    url: 'data/anki.json',
    label: 'Anki reviews',
    unit: ['review', 'reviews'],
    colors: ['#ebebeb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
  }).catch((error: unknown) => {
    console.error('Unable to display the Anki heatmap.', error);
  });
}

const github = document.querySelector<HTMLElement>('#github-heatmap');
if (github) {
  void mountHeatmap(github, {
    url: 'data/github.json',
    label: 'GitHub contributions',
    unit: ['contribution', 'contributions'],
    // GitHub's default light-theme contribution palette from Primer.
    colors: ['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329'],
  }).catch((error: unknown) => {
    console.error('Unable to display the GitHub heatmap.', error);
  });
}
