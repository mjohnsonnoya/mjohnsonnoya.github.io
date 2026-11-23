// Entry point. `npm run build` compiles src/ to js/, and index.html loads js/main.js.
import { mountShapeAvatar } from './avatar.js';
import { mountHeatmap } from './heatmap.js';
const avatar = document.querySelector('#avatar');
const svg = avatar?.querySelector('svg');
if (avatar && svg) {
    const redraw = mountShapeAvatar(svg, 'assets/avatar.webp');
    avatar.addEventListener('click', redraw);
}
// The calendars' colors are in styles.css, under #anki-heatmap and #github-heatmap.
const anki = document.querySelector('#anki-heatmap');
if (anki) {
    void mountHeatmap(anki, {
        url: 'data/anki.json',
        label: 'Anki reviews',
        unit: ['review', 'reviews'],
    }).catch((error) => {
        console.error('Unable to display the Anki heatmap.', error);
    });
}
const github = document.querySelector('#github-heatmap');
if (github) {
    void mountHeatmap(github, {
        url: 'data/github.json',
        label: 'GitHub contributions',
        unit: ['contribution', 'contributions'],
    }).catch((error) => {
        console.error('Unable to display the GitHub heatmap.', error);
    });
}
//# sourceMappingURL=main.js.map