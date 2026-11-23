// Calendar heatmap of a daily count (Anki reviews, GitHub contributions), drawn as SVG from a
// JSON file written by a script in scripts/. It shows as many whole weeks as fit the width,
// up to a year, so phones get the most recent months at the same cell size.
// Each cell gets a class from level-0 (no activity) to level-4; styles.css colors the levels
// per calendar, with separate light and dark palettes.
const SVG_NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 24 * 60 * 60 * 1000;
const GAP = 2; // px between cells
const MIN_CELL = 9; // px; narrow screens show fewer weeks rather than smaller cells
const MAX_WEEKS = 53;
const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const rangeLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
function formatCount(value, [singular, plural]) {
    return `${value.toLocaleString('en-US')} ${value === 1 ? singular : plural}`;
}
/** Fetches the data and draws the heatmap into `root` (a <figure>). */
export async function mountHeatmap(root, options) {
    const response = await fetch(options.url);
    if (!response.ok) {
        throw new Error(`Failed to load ${options.url}: HTTP ${response.status}.`);
    }
    const data = (await response.json());
    const { counts } = data;
    const startTime = Date.parse(`${data.start}T00:00:00Z`);
    const lastDay = counts.length - 1; // index of data.updated, the last day exported
    const dateOf = (dayIndex) => new Date(startTime + dayIndex * DAY_MS);
    const countAt = (dayIndex) => (dayIndex >= 0 && dayIndex <= lastDay ? counts[dayIndex] : 0);
    // Color levels: quartiles of the active days in the past 53 weeks, whatever width is shown.
    // Each cut is the top of its level, so a level is never skipped when counts are small.
    const activeCounts = counts.slice(-MAX_WEEKS * 7).filter((value) => value > 0).sort((a, b) => a - b);
    const quantile = (percentile) => (activeCounts[Math.floor(percentile * (activeCounts.length - 1))] ?? 1);
    const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)];
    const colorLevel = (value) => (value === 0 ? 0 : 1 + thresholds.filter((threshold) => value > threshold).length);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'heatmap-grid');
    svg.setAttribute('role', 'img');
    const tooltip = document.createElement('div');
    tooltip.className = 'heatmap-tip';
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.hidden = true;
    root.replaceChildren(svg, tooltip);
    let drawnWidth = 0;
    function draw() {
        const width = Math.floor(root.clientWidth);
        if (!width || width === drawnWidth)
            return;
        drawnWidth = width;
        const weeks = Math.max(1, Math.min(MAX_WEEKS, Math.floor((width + GAP) / (MIN_CELL + GAP))));
        const cellSize = (width - (weeks - 1) * GAP) / weeks;
        const height = 7 * cellSize + 6 * GAP;
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        // Rows run Sunday to Saturday; the last column holds the last exported day.
        const firstDay = lastDay - dateOf(lastDay).getUTCDay() - (weeks - 1) * 7;
        const cells = document.createDocumentFragment();
        for (let column = 0; column < weeks; column++) {
            const x = column * (cellSize + GAP);
            for (let row = 0; row < 7; row++) {
                const dayIndex = firstDay + column * 7 + row;
                if (dayIndex > lastDay)
                    break;
                const rect = document.createElementNS(SVG_NS, 'rect');
                rect.setAttribute('x', x.toFixed(2));
                rect.setAttribute('y', (row * (cellSize + GAP)).toFixed(2));
                rect.setAttribute('width', cellSize.toFixed(2));
                rect.setAttribute('height', cellSize.toFixed(2));
                rect.setAttribute('rx', '2');
                rect.setAttribute('class', `level-${colorLevel(countAt(dayIndex))}`);
                rect.dataset.dayIndex = String(dayIndex);
                cells.append(rect);
            }
        }
        svg.replaceChildren(cells);
        svg.setAttribute('aria-label', `Calendar of ${options.label} per day from ${rangeLabel.format(dateOf(Math.max(firstDay, 0)))} to ${rangeLabel.format(dateOf(lastDay))}.`);
        hideTooltip();
    }
    let activeRect = null;
    function showTooltip(rect) {
        const dayIndex = Number(rect.dataset.dayIndex);
        const count = countAt(dayIndex);
        activeRect?.classList.remove('is-active');
        activeRect = rect;
        rect.classList.add('is-active');
        const value = document.createElement('strong');
        value.textContent = count === 0 ? `No ${options.unit[1]}` : formatCount(count, options.unit);
        tooltip.replaceChildren(value, ` ${dateLabel.format(dateOf(dayIndex))}`);
        tooltip.hidden = false;
        // Center over the cell, but keep the whole tooltip inside the figure.
        const box = rect.getBoundingClientRect();
        const frame = root.getBoundingClientRect();
        const halfWidth = tooltip.offsetWidth / 2;
        const centerX = Math.min(Math.max(box.left + box.width / 2 - frame.left, halfWidth), frame.width - halfWidth);
        tooltip.style.left = `${centerX}px`;
        tooltip.style.top = `${box.top - frame.top}px`;
    }
    function hideTooltip() {
        activeRect?.classList.remove('is-active');
        activeRect = null;
        tooltip.hidden = true;
    }
    svg.addEventListener('pointerover', (event) => {
        if (event.target instanceof SVGRectElement)
            showTooltip(event.target);
    });
    // A mouse hides it on leaving; a tap keeps it until the next tap elsewhere.
    svg.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'mouse')
            hideTooltip();
    });
    document.addEventListener('pointerdown', (event) => {
        if (!(event.target instanceof Node && svg.contains(event.target)))
            hideTooltip();
    });
    draw();
    new ResizeObserver(draw).observe(root);
}
//# sourceMappingURL=heatmap.js.map