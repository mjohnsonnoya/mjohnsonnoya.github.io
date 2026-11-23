// Circular portrait rebuilt in the browser from translucent circles by hill climbing.
// Each step tries random circles, adjusts the best candidate, and adds it to the picture.
// The error is weighted toward the face and measured only inside the portrait circle,
// but shapes may spill past it, out to CONFIG.bleed. Circles are drawn as SVG.

interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  weight: number;
}

type RGB = [red: number, green: number, blue: number];
type Circle = [x: number, y: number, radius: number]; // working pixels

interface Shape {
  circle: Circle;
  color: RGB;
}

interface Evaluation {
  error: number; // change in weighted image error; lower is better
  color: RGB;
}

const CONFIG = {
  totalShapes: 4000,
  candidates: 48,      // random circles tried per step
  mutations: 120,      // hill-climb steps per circle
  maxFails: 40,        // stop climbing after this many non-improving steps
  alpha: 0.6,          // shape opacity
  bleed: 0.15,         // how far shapes may reach past the portrait circle, as a fraction of its radius
  maxRadius: 0.4,      // largest circle, as a fraction of the portrait radius; keeps the edge broken up
  minRadius: 0.02,     // smallest circle, same units; stops circles from copying single pixels
  smoothing: 1,        // light blur passes on the photo first, so circles fit features, not pixel noise
  // Normalized coordinates (0..1) in the square source image.
  face: { cx: 0.495, cy: 0.45, rx: 0.21, ry: 0.24, weight: 12 } as Ellipse,
  head: { cx: 0.495, cy: 0.35, rx: 0.23, ry: 0.34, weight: 3 } as Ellipse,
  sampling: { face: 0.6, head: 0.15 }, // remainder is uniform over the portrait circle
  duration: 20000,     // ms for the build-up animation
  easing: 2,           // >1 = slow blocky start, fast detailed finish
};

const SVG_NS = 'http://www.w3.org/2000/svg';

// The portrait builds up out of the page's background, so it seems to appear from nothing.
// That color depends on the device's light or dark setting (styles.css), so it is read
// each time the drawing starts.
function pageColor(): RGB {
  const channels = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) ?? [];
  const [red = 255, green = 255, blue = 255] = channels.map(Number);
  return [red, green, blue];
}

/** Starts drawing `src` into `svg`. Returns a function that restarts the drawing. */
export function mountShapeAvatar(svg: SVGSVGElement, src: string): () => void {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // fill-opacity on the group is inherited and applied to each circle separately.
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('fill-opacity', String(CONFIG.alpha));
  svg.replaceChildren(layer);

  // The working canvas contains the square source image plus padding for spilled circles.
  let sourceSize = 0;
  let padding = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let centerX = 0;
  let centerY = 0;
  let portraitRadius = 0;
  let outerRadius = 0;
  let minRadius = 1;
  let maxRadius = 1;
  let targetPixels = new Float32Array(0);
  let currentPixels = new Float32Array(0);
  let pixelWeights = new Float32Array(0);

  // Per-row prefix sums, with a stride of canvasWidth + 1, let us score circles efficiently.
  let prefixWeights = new Float64Array(0);
  let prefixRedResidual = new Float64Array(0);
  let prefixGreenResidual = new Float64Array(0);
  let prefixBlueResidual = new Float64Array(0);
  let prefixErrorDelta = new Float64Array(0);

  // Reused scratch space: rasterize() writes the covered x range for each affected row.
  let rowSpans = new Int32Array(0);
  let firstRow = 0;
  let lastRow = -1;

  let isPrepared = false;
  let shapes: Shape[] = [];
  let drawnCount = 0;
  let startTime = 0;
  let animationFrameId = 0;

  const image = new Image();
  image.src = src;
  void image.decode().then(() => {
    prepare();
    isPrepared = true;
    start();
  }).catch((error: unknown) => {
    console.error(`Unable to render the avatar from ${src}.`, error);
  });
  // The circles' colors are worked out against the page color, so start over if it changes.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', start);

  function prepare(): void {
    sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    padding = Math.ceil(CONFIG.bleed * sourceSize / 2);
    canvasWidth = sourceSize + 2 * padding;
    canvasHeight = canvasWidth;
    centerX = canvasWidth / 2;
    centerY = centerX;
    portraitRadius = sourceSize / 2;
    outerRadius = portraitRadius + padding;
    minRadius = CONFIG.minRadius * portraitRadius;
    maxRadius = CONFIG.maxRadius * portraitRadius;

    // Let the SVG overhang the button by the same proportion as the working canvas padding.
    const overhangPercent = 100 * padding / sourceSize;
    svg.setAttribute('viewBox', `0 0 ${canvasWidth} ${canvasHeight}`);
    Object.assign(svg.style, {
      left: `${-overhangPercent}%`,
      top: `${-overhangPercent}%`,
      width: `${100 + 2 * overhangPercent}%`,
      height: `${100 + 2 * overhangPercent}%`,
    });

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('A 2D canvas context is required to draw the avatar.');
    context.drawImage(
      image,
      (image.naturalWidth - sourceSize) / 2, (image.naturalHeight - sourceSize) / 2,
      sourceSize, sourceSize,
      padding, padding, sourceSize, sourceSize,
    );
    const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight).data;
    const pixelCount = canvasWidth * canvasHeight;
    targetPixels = new Float32Array(pixelCount * 3);
    currentPixels = new Float32Array(pixelCount * 3);
    pixelWeights = new Float32Array(pixelCount);
    rowSpans = new Int32Array(canvasHeight * 2);
    for (let pixel = 0, rgbaIndex = 0; pixel < pixelCount; pixel++, rgbaIndex += 4) {
      targetPixels[pixel * 3] = imageData[rgbaIndex];
      targetPixels[pixel * 3 + 1] = imageData[rgbaIndex + 1];
      targetPixels[pixel * 3 + 2] = imageData[rgbaIndex + 2];
    }
    smooth(CONFIG.smoothing);
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const pixelX = x + 0.5;
        const pixelY = y + 0.5;
        // Pixels outside the portrait keep a weight of zero.
        if (Math.hypot(pixelX - centerX, pixelY - centerY) > portraitRadius + 0.5) continue;
        const normalizedX = (pixelX - padding) / sourceSize;
        const normalizedY = (pixelY - padding) / sourceSize;
        pixelWeights[y * canvasWidth + x] = 1
          + (CONFIG.face.weight - 1) * ellipseWeight(normalizedX, normalizedY, CONFIG.face)
          + (CONFIG.head.weight - 1) * ellipseWeight(normalizedX, normalizedY, CONFIG.head);
      }
    }
    const prefixLength = (canvasWidth + 1) * canvasHeight;
    prefixWeights = new Float64Array(prefixLength);
    prefixRedResidual = new Float64Array(prefixLength);
    prefixGreenResidual = new Float64Array(prefixLength);
    prefixBlueResidual = new Float64Array(prefixLength);
    prefixErrorDelta = new Float64Array(prefixLength);
    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        prefixWeights[y * (canvasWidth + 1) + x + 1] =
          prefixWeights[y * (canvasWidth + 1) + x] + pixelWeights[y * canvasWidth + x];
      }
    }
  }

  // Separable [1 2 1]/4 blur over the photo square (edges clamped), `passes` times.
  function smooth(passes: number): void {
    const buffer = new Float32Array(targetPixels.length);
    const firstPixel = padding;
    const lastPixel = padding + sourceSize - 1;
    const indexOf = (x: number, y: number): number => (y * canvasWidth + x) * 3;
    for (let pass = 0; pass < passes; pass++) {
      for (let vertical = 0; vertical < 2; vertical++) {
        const from = vertical ? buffer : targetPixels;
        const to = vertical ? targetPixels : buffer;
        for (let y = firstPixel; y <= lastPixel; y++) {
          for (let x = firstPixel; x <= lastPixel; x++) {
            const before = vertical
              ? indexOf(x, Math.max(firstPixel, y - 1))
              : indexOf(Math.max(firstPixel, x - 1), y);
            const after = vertical
              ? indexOf(x, Math.min(lastPixel, y + 1))
              : indexOf(Math.min(lastPixel, x + 1), y);
            const center = indexOf(x, y);
            for (let channel = 0; channel < 3; channel++) {
              to[center + channel] = 0.25 * from[before + channel]
                + 0.5 * from[center + channel] + 0.25 * from[after + channel];
            }
          }
        }
      }
    }
  }

  // Soft ellipse membership: 1 inside, fading to 0 just past the rim.
  function ellipseWeight(x: number, y: number, ellipse: Ellipse): number {
    const dx = (x - ellipse.cx) / ellipse.rx;
    const dy = (y - ellipse.cy) / ellipse.ry;
    const blend = Math.min(1, Math.max(0, (1.2 - Math.sqrt(dx * dx + dy * dy)) / 0.35));
    return blend * blend * (3 - 2 * blend);
  }

  function start(): void {
    if (!isPrepared) return;
    shapes = [];
    drawnCount = 0;
    resetCurrent();
    for (let y = 0; y < canvasHeight; y++) rebuildRow(y);
    layer.replaceChildren();
    startTime = performance.now();
    cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(frame);
  }

  function frame(now: number): void {
    const budgetEnd = now + 10;
    while (shapes.length < CONFIG.totalShapes && performance.now() < budgetEnd) addShape();
    const progress = Math.min(1, (now - startTime) / CONFIG.duration);
    const dueCount = reduceMotion
      ? CONFIG.totalShapes
      : Math.floor(CONFIG.totalShapes * Math.pow(progress, CONFIG.easing));
    const nextDrawnCount = Math.min(dueCount, shapes.length);
    if (nextDrawnCount > drawnCount) {
      const batch = document.createDocumentFragment();
      for (; drawnCount < nextDrawnCount; drawnCount++) {
        batch.append(circleElement(shapes[drawnCount]));
      }
      layer.append(batch);
    }
    if (drawnCount < CONFIG.totalShapes) animationFrameId = requestAnimationFrame(frame);
  }

  function resetCurrent(): void {
    const [red, green, blue] = pageColor();
    for (let pixel = 0; pixel < canvasWidth * canvasHeight; pixel++) {
      currentPixels[pixel * 3] = red;
      currentPixels[pixel * 3 + 1] = green;
      currentPixels[pixel * 3 + 2] = blue;
    }
  }

  function addShape(): void {
    const shape = search(shapes.length / CONFIG.totalShapes);
    if (!shape) return;
    commit(shape.circle, shape.color);
    shapes.push(shape);
  }

  // Find the best circle and color to add to the picture as it stands.
  // `progress` (0..1) sets how large the random starting candidates tend to be.
  function search(progress: number): Shape | null {
    let best: Shape | null = null;
    let bestError = Infinity;
    for (let candidate = 0; candidate < CONFIG.candidates; candidate++) {
      const circle = randomCircle(progress);
      const evaluation = evaluate(circle);
      if (evaluation && evaluation.error < bestError) {
        bestError = evaluation.error;
        best = { circle, color: evaluation.color };
      }
    }
    if (!best) return null;
    for (let mutation = 0, fails = 0; mutation < CONFIG.mutations && fails < CONFIG.maxFails; mutation++) {
      const circle = mutate(best.circle);
      const evaluation = evaluate(circle);
      if (evaluation && evaluation.error < bestError) {
        bestError = evaluation.error;
        best = { circle, color: evaluation.color };
        fails = 0;
      } else {
        fails++;
      }
    }
    return best;
  }

  // Circles start large and shrink as the drawing fills in; most are centered on the face.
  function randomCircle(progress: number): Circle {
    const shrink = 1 - 0.75 * progress;
    const sample = Math.random();
    const sampling = CONFIG.sampling;
    let x: number;
    let y: number;
    let spread: number;
    if (sample < sampling.face + sampling.head) {
      const ellipse = sample < sampling.face ? CONFIG.face : CONFIG.head;
      const radius = Math.sqrt(Math.random());
      const angle = Math.random() * Math.PI * 2;
      x = padding + (ellipse.cx + ellipse.rx * radius * Math.cos(angle)) * sourceSize;
      y = padding + (ellipse.cy + ellipse.ry * radius * Math.sin(angle)) * sourceSize;
      spread = 0.35 * ellipse.rx * sourceSize * shrink;
    } else {
      const radius = portraitRadius * Math.sqrt(Math.random());
      const angle = Math.random() * Math.PI * 2;
      x = centerX + radius * Math.cos(angle);
      y = centerY + radius * Math.sin(angle);
      spread = 0.2 * sourceSize * shrink;
    }
    return fit([x, y, minRadius + spread * Math.pow(Math.random(), 1.4)]);
  }

  // Clamp the radius and move the center in place so the whole circle fits the spill limit.
  function fit(circle: Circle): Circle {
    circle[2] = Math.min(maxRadius, Math.max(minRadius, circle[2]));
    const dx = circle[0] - centerX;
    const dy = circle[1] - centerY;
    const distance = Math.hypot(dx, dy);
    const limit = outerRadius - circle[2];
    if (distance > limit) {
      circle[0] = centerX + dx * limit / distance;
      circle[1] = centerY + dy * limit / distance;
    }
    return circle;
  }

  function randomOffset(): number {
    return (Math.random() + Math.random() + Math.random() - 1.5) * 1.3;
  }

  function mutate(circle: Circle): Circle {
    const next: Circle = [...circle];
    const amplitude = Math.max(1.2, 0.3 * circle[2]);
    if (Math.random() < 0.6) {
      next[0] += randomOffset() * amplitude;
      next[1] += randomOffset() * amplitude;
    } else {
      next[2] += randomOffset() * amplitude * 0.6;
    }
    return fit(next);
  }

  // Overwrites the shared rowSpans, firstRow, and lastRow scratch buffers for this circle.
  // Returns false if the circle covers no pixel centers.
  function rasterize(circle: Circle): boolean {
    const [x, y, radius] = circle;
    const radiusSquared = radius * radius;
    firstRow = Math.max(0, Math.ceil(y - radius - 0.5));
    lastRow = Math.min(canvasHeight - 1, Math.floor(y + radius - 0.5));
    let coversPixels = false;
    for (let row = firstRow; row <= lastRow; row++) {
      const dy = row + 0.5 - y;
      const halfWidthSquared = radiusSquared - dy * dy;
      let firstX = 1;
      let lastX = 0;
      if (halfWidthSquared >= 0) {
        const halfWidth = Math.sqrt(halfWidthSquared);
        firstX = Math.max(0, Math.ceil(x - halfWidth - 0.5));
        lastX = Math.min(canvasWidth - 1, Math.floor(x + halfWidth - 0.5));
      }
      rowSpans[row * 2] = firstX;
      rowSpans[row * 2 + 1] = lastX;
      if (lastX >= firstX) coversPixels = true;
    }
    return coversPixels;
  }

  // Painting color k at opacity a turns pixel c into (1-a)c + a k. With d = t - (1-a)c,
  // the weighted error change over the shape is
  //   sum w(|d|^2 - |t-c|^2) - 2a k . sum w d + a^2 |k|^2 sum w,
  // so running sums along each row score a candidate in O(rows), not O(pixels).
  function rebuildRow(y: number): void {
    const retainedOpacity = 1 - CONFIG.alpha;
    const rowStart = y * (canvasWidth + 1);
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let errorSum = 0;
    for (let x = 0, pixel = y * canvasWidth; x < canvasWidth; x++, pixel++) {
      const index = pixel * 3;
      const weight = pixelWeights[pixel];
      const targetRed = targetPixels[index];
      const targetGreen = targetPixels[index + 1];
      const targetBlue = targetPixels[index + 2];
      const currentRed = currentPixels[index];
      const currentGreen = currentPixels[index + 1];
      const currentBlue = currentPixels[index + 2];
      const redResidual = targetRed - retainedOpacity * currentRed;
      const greenResidual = targetGreen - retainedOpacity * currentGreen;
      const blueResidual = targetBlue - retainedOpacity * currentBlue;
      const redError = targetRed - currentRed;
      const greenError = targetGreen - currentGreen;
      const blueError = targetBlue - currentBlue;
      redSum += weight * redResidual;
      greenSum += weight * greenResidual;
      blueSum += weight * blueResidual;
      errorSum += weight * (redResidual * redResidual + greenResidual * greenResidual
        + blueResidual * blueResidual - redError * redError - greenError * greenError - blueError * blueError);
      prefixRedResidual[rowStart + x + 1] = redSum;
      prefixGreenResidual[rowStart + x + 1] = greenSum;
      prefixBlueResidual[rowStart + x + 1] = blueSum;
      prefixErrorDelta[rowStart + x + 1] = errorSum;
    }
  }

  function clampChannel(value: number): number {
    return Math.min(255, Math.max(0, value));
  }

  // Returns both outputs explicitly; rasterize() reuses the shared row scratch buffers.
  function evaluate(circle: Circle): Evaluation | null {
    if (!rasterize(circle)) return null;
    const alpha = CONFIG.alpha;
    let weightSum = 0;
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let errorSum = 0;
    for (let row = firstRow; row <= lastRow; row++) {
      const firstX = rowSpans[row * 2];
      const lastX = rowSpans[row * 2 + 1];
      if (lastX < firstX) continue;
      const rowStart = row * (canvasWidth + 1);
      const left = rowStart + firstX;
      const right = rowStart + lastX + 1;
      weightSum += prefixWeights[right] - prefixWeights[left];
      redSum += prefixRedResidual[right] - prefixRedResidual[left];
      greenSum += prefixGreenResidual[right] - prefixGreenResidual[left];
      blueSum += prefixBlueResidual[right] - prefixBlueResidual[left];
      errorSum += prefixErrorDelta[right] - prefixErrorDelta[left];
    }
    if (weightSum <= 0) return null;
    const red = clampChannel(redSum / (alpha * weightSum));
    const green = clampChannel(greenSum / (alpha * weightSum));
    const blue = clampChannel(blueSum / (alpha * weightSum));
    const error = errorSum - 2 * alpha * (red * redSum + green * greenSum + blue * blueSum)
      + alpha * alpha * (red * red + green * green + blue * blue) * weightSum;
    return { error, color: [red, green, blue] };
  }

  // Blend a circle into the current pixels and update the row sums it touched.
  function commit(circle: Circle, color: RGB): void {
    rasterize(circle);
    const alpha = CONFIG.alpha;
    for (let row = firstRow; row <= lastRow; row++) {
      const firstX = rowSpans[row * 2];
      const lastX = rowSpans[row * 2 + 1];
      for (let x = firstX, index = (row * canvasWidth + firstX) * 3; x <= lastX; x++, index += 3) {
        currentPixels[index] += alpha * (color[0] - currentPixels[index]);
        currentPixels[index + 1] += alpha * (color[1] - currentPixels[index + 1]);
        currentPixels[index + 2] += alpha * (color[2] - currentPixels[index + 2]);
      }
      rebuildRow(row);
    }
  }

  function circleElement(shape: Shape): SVGCircleElement {
    const element = document.createElementNS(SVG_NS, 'circle');
    const [x, y, radius] = shape.circle;
    const [red, green, blue] = shape.color;
    element.setAttribute('cx', x.toFixed(1));
    element.setAttribute('cy', y.toFixed(1));
    element.setAttribute('r', radius.toFixed(1));
    element.setAttribute('fill', `rgb(${Math.round(red)},${Math.round(green)},${Math.round(blue)})`);
    return element;
  }

  return start;
}
