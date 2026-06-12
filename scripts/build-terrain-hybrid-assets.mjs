import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const studyRoot = path.join(root, 'asset_studies', 'aoe_style_terrain_20260609');
const outRoot = path.join(root, 'web', 'assets', 'terrain_hybrid');

const matte = {
  r: 243,
  g: 237,
  b: 228,
  transparentDistance: 18,
  opaqueDistance: 70,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function emptyPngs(dir) {
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map(entry => fs.unlink(path.join(dir, entry.name))));
}

function alphaForPixel(r, g, b) {
  const dr = r - matte.r;
  const dg = g - matte.g;
  const db = b - matte.b;
  const distance = Math.sqrt(dr * dr + dg * dg + db * db);
  if (distance <= matte.transparentDistance) return 0;
  if (distance >= matte.opaqueDistance) return 255;
  return Math.round((distance - matte.transparentDistance) * 255 / (matte.opaqueDistance - matte.transparentDistance));
}

function addAlphaMatte(raw, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < raw.length; i += 3, o += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const a = alphaForPixel(r, g, b);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return out;
}

function trimBounds(rgba, width, height, alphaThreshold = 10, padding = 6) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  minX = clamp(minX - padding, 0, width - 1);
  minY = clamp(minY - padding, 0, height - 1);
  maxX = clamp(maxX + padding, 0, width - 1);
  maxY = clamp(maxY + padding, 0, height - 1);
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

async function cutSprite({ source, crop, outFile, maxWidth = null }) {
  const { data, info } = await sharp(source)
    .extract(crop)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = addAlphaMatte(data, info.width, info.height);
  const bounds = trimBounds(rgba, info.width, info.height);
  if (!bounds) return null;

  let image = sharp(rgba, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  }).extract(bounds);

  let outWidth = bounds.width;
  let outHeight = bounds.height;
  if (maxWidth && outWidth > maxWidth) {
    outHeight = Math.round(outHeight * maxWidth / outWidth);
    outWidth = maxWidth;
    image = image.resize({ width: maxWidth, kernel: sharp.kernel.lanczos3 });
  }

  await ensureDir(path.dirname(outFile));
  await image.png().toFile(outFile);
  return {
    file: path.relative(path.join(root, 'web'), outFile).replaceAll(path.sep, '/'),
    sourceCrop: crop,
    trim: bounds,
    width: outWidth,
    height: outHeight,
  };
}

function gridCrop(width, height, cols, rows, col, row) {
  const left = Math.round(col * width / cols);
  const top = Math.round(row * height / rows);
  const right = Math.round((col + 1) * width / cols);
  const bottom = Math.round((row + 1) * height / rows);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

async function extractTransitions(manifest) {
  const source = path.join(studyRoot, '06_transitions', 'transitions_sheet.png');
  const meta = await sharp(source).metadata();
  const outDir = path.join(outRoot, 'transitions');
  await ensureDir(outDir);

  const pairs = [
    { key: 'grass_dirt', tiles: ['grassland', 'plain'] },
    { key: 'grass_forest', tiles: ['grassland', 'mountain'] },
    { key: 'dirt_road', tiles: ['plain', 'road'] },
    { key: 'dirt_farm', tiles: ['plain', 'farm'] },
    { key: 'grass_gravel', tiles: ['grassland', 'gravel'] },
  ];
  const shapes = [
    'edge_00',
    'edge_01',
    'edge_02',
    'corner_00',
    'corner_01',
    'corner_inner',
    'patch_00',
  ];

  for (const pair of pairs) {
    const pairDir = path.join(outDir, pair.key);
    await emptyPngs(pairDir);
    const sprites = [];
    for (let col = 0; col < shapes.length; col += 1) {
      const name = shapes[col];
      const outFile = path.join(pairDir, `${name}.png`);
      const sprite = await cutSprite({
        source,
        crop: gridCrop(meta.width, meta.height, shapes.length, pairs.length, col, pairs.indexOf(pair)),
        outFile,
        maxWidth: 420,
      });
      if (sprite) sprites.push({ ...sprite, name, role: name.startsWith('edge') ? 'edge' : 'corner' });
    }
    manifest.transitions[pair.key] = {
      tiles: pair.tiles,
      sprites,
    };
  }
}

async function extractDoodads(manifest) {
  const source = path.join(studyRoot, '02_doodads', 'doodads_sheet.png');
  const outDir = path.join(outRoot, 'doodads');
  await ensureDir(outDir);

  const rows = [
    {
      category: 'pebbles',
      top: 28,
      height: 150,
      cols: 8,
      terrain: ['plain', 'road', 'wetland'],
      scale: [0.22, 0.38],
    },
    {
      category: 'grass_tufts',
      top: 188,
      height: 150,
      cols: 5,
      width: 960,
      terrain: ['plain', 'grassland', 'mountain'],
      scale: [0.20, 0.34],
    },
    {
      category: 'flowers',
      top: 188,
      height: 150,
      cols: 3,
      left: 960,
      width: 576,
      terrain: ['grassland'],
      scale: [0.18, 0.30],
    },
    {
      category: 'shrubs',
      top: 350,
      height: 165,
      cols: 6,
      terrain: ['grassland', 'mountain'],
      scale: [0.24, 0.44],
    },
    {
      category: 'twigs_leaf_litter',
      top: 522,
      height: 130,
      cols: 6,
      terrain: ['plain', 'mountain'],
      scale: [0.24, 0.42],
    },
    {
      category: 'cracks_mud',
      top: 678,
      height: 126,
      cols: 6,
      terrain: ['plain', 'road'],
      scale: [0.28, 0.50],
    },
    {
      category: 'mossy_stones',
      top: 830,
      height: 165,
      cols: 6,
      terrain: ['mountain', 'wetland', 'grassland'],
      scale: [0.26, 0.48],
    },
  ];

  for (const row of rows) {
    const categoryDir = path.join(outDir, row.category);
    await emptyPngs(categoryDir);
    manifest.doodads[row.category] = {
      terrain: row.terrain,
      scale: row.scale,
      sprites: [],
    };
    const left = row.left ?? 0;
    const width = row.width ?? 1536;
    for (let col = 0; col < row.cols; col += 1) {
      const crop = gridCrop(width, row.height, row.cols, 1, col, 0);
      crop.left += left;
      crop.top += row.top;
      const name = `${row.category}_${String(col).padStart(2, '0')}`;
      const sprite = await cutSprite({
        source,
        crop,
        outFile: path.join(categoryDir, `${name}.png`),
        maxWidth: 220,
      });
      if (sprite) manifest.doodads[row.category].sprites.push({ ...sprite, name });
    }
  }
}

async function extractBaseReferences(manifest) {
  const source = path.join(studyRoot, '01_base_terrain', 'base_terrain_sheet.png');
  const outDir = path.join(outRoot, 'base');
  await ensureDir(outDir);
  await emptyPngs(outDir);

  const crops = [
    ['bright_grass_00', 0, 0, 384, 220],
    ['bright_grass_01', 384, 0, 384, 220],
    ['bright_grass_02', 768, 0, 384, 220],
    ['bright_grass_03', 1152, 0, 384, 220],
    ['dark_grass_00', 0, 205, 384, 225],
    ['dark_grass_01', 384, 205, 384, 225],
    ['dark_grass_02', 768, 205, 384, 225],
    ['dry_grass_00', 0, 407, 256, 200],
    ['dry_grass_01', 256, 407, 256, 200],
    ['dirt_00', 512, 407, 256, 200],
    ['dirt_01', 768, 407, 256, 200],
    ['dirt_02', 1024, 407, 256, 200],
    ['dirt_03', 1280, 407, 256, 200],
    ['road_00', 0, 588, 256, 220],
    ['road_01', 256, 588, 256, 220],
    ['road_02', 512, 588, 256, 220],
    ['road_03', 768, 588, 256, 220],
    ['gravel_00', 1024, 588, 256, 220],
    ['gravel_01', 1280, 588, 256, 220],
    ['rocky_ground_00', 0, 775, 384, 249],
    ['rocky_ground_01', 384, 775, 384, 249],
    ['farm_00', 768, 775, 384, 249],
    ['farm_01', 1152, 775, 384, 249],
  ];

  for (const [name, left, top, width, height] of crops) {
    const sprite = await cutSprite({
      source,
      crop: { left, top, width, height },
      outFile: path.join(outDir, `${name}.png`),
      maxWidth: 520,
    });
    if (sprite) manifest.base[name] = sprite;
  }
}

async function main() {
  await ensureDir(outRoot);
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceStudy: path.relative(root, studyRoot).replaceAll(path.sep, '/'),
    notes: [
      'Runtime candidates generated from exploratory study sheets.',
      'Base sprites are reference/fallback candidates; current battlefield base still uses world-coordinate textures.',
      'Transition sprites are transparent overlays used on 3x3 terrain patch boundaries.',
    ],
    base: {},
    transitions: {},
    doodads: {},
  };

  await extractBaseReferences(manifest);
  await extractTransitions(manifest);
  await extractDoodads(manifest);

  await fs.writeFile(
    path.join(outRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
