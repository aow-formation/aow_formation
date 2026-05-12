/**
 * tile_1x1 이미지에 마름모(아이소메트릭 다이아몬드) 마스크 적용
 * 직사각형 이미지 → 마름모 형태 (외부 픽셀 알파=0)
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── PNG 인코더 ──────────────────────────────────────────────────────────────
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c>>>1)^(0xEDB88320&-(c&1)); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const ci = Buffer.alloc(4); ci.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, ci]);
}
function encodePNG(rgba, W, H) {
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4);
  ihdr[8]=8; ihdr[9]=6; // 8-bit RGBA
  const rowLen = 1 + W * 4;
  const raw = Buffer.alloc(H * rowLen);
  for (let y = 0; y < H; y++) {
    raw[y * rowLen] = 0; // filter None
    rgba.copy(raw, y * rowLen + 1, y * W * 4, (y+1) * W * 4);
  }
  return Buffer.concat([sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, {level:9})),
    pngChunk('IEND', Buffer.alloc(0))]);
}

// ── PNG 디코더 ──────────────────────────────────────────────────────────────
function readU32(buf, off) { return (buf[off]<<24|buf[off+1]<<16|buf[off+2]<<8|buf[off+3])>>>0; }
function paeth(a,b,c) {
  const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc ? a : pb<=pc ? b : c;
}
function decodePNG(buf) {
  if (buf.toString('hex',0,8) !== '89504e470d0a1a0a') throw new Error('Not PNG');
  let off=8, W, H, depth, colorType;
  const idats=[];
  while (off < buf.length) {
    const len=readU32(buf,off); off+=4;
    const type=buf.toString('ascii',off,off+4); off+=4;
    const data=buf.slice(off,off+len); off+=len+4;
    if (type==='IHDR') { W=readU32(data,0); H=readU32(data,4); depth=data[8]; colorType=data[9]; }
    else if (type==='IDAT') idats.push(data);
    else if (type==='IEND') break;
  }
  if (depth!==8) throw new Error('Only 8-bit PNG supported');

  const bpp = {0:1,2:3,3:1,4:2,6:4}[colorType];
  if (!bpp) throw new Error('Unsupported color type: '+colorType);

  const raw  = zlib.inflateSync(Buffer.concat(idats));
  const rgba = Buffer.alloc(W*H*4, 0);
  const prev = Buffer.alloc(W*bpp, 0);
  let pos=0;

  for (let y=0; y<H; y++) {
    const filter = raw[pos++];
    const cur = Buffer.alloc(W*bpp);
    for (let i=0; i<W*bpp; i++) {
      const v=raw[pos+i];
      const a=i>=bpp?cur[i-bpp]:0, b=prev[i], c=i>=bpp?prev[i-bpp]:0;
      cur[i] = filter===0?v : filter===1?(v+a)&0xff : filter===2?(v+b)&0xff
             : filter===3?(v+Math.floor((a+b)/2))&0xff : (v+paeth(a,b,c))&0xff;
    }
    pos += W*bpp;
    cur.copy(prev);

    for (let x=0; x<W; x++) {
      const d=(y*W+x)*4;
      if      (colorType===6) { rgba[d]=cur[x*4]; rgba[d+1]=cur[x*4+1]; rgba[d+2]=cur[x*4+2]; rgba[d+3]=cur[x*4+3]; }
      else if (colorType===2) { rgba[d]=cur[x*3]; rgba[d+1]=cur[x*3+1]; rgba[d+2]=cur[x*3+2]; rgba[d+3]=255; }
      else if (colorType===0) { rgba[d]=rgba[d+1]=rgba[d+2]=cur[x]; rgba[d+3]=255; }
      else if (colorType===4) { rgba[d]=rgba[d+1]=rgba[d+2]=cur[x*2]; rgba[d+3]=cur[x*2+1]; }
    }
  }
  return { W, H, rgba };
}

// ── 다이아몬드 마스크 적용 ──────────────────────────────────────────────────
function applyDiamondMask(rgba, W, H) {
  const cx=W/2, cy=H/2;
  for (let y=0; y<H; y++) {
    for (let x=0; x<W; x++) {
      // |x-cx|/(W/2) + |y-cy|/(H/2) <= 1 이면 내부
      const inside = Math.abs(x-cx)/cx + Math.abs(y-cy)/cy <= 1.0;
      if (!inside) rgba[(y*W+x)*4+3] = 0; // 외부: 투명
    }
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
const SRC  = 'C:/codex/Age of war/assets/terrain_tiles_v3/tile_1x1';
const DST1 = 'C:/codex/Age of war/assets/terrain_tiles_v3/tile_1x1';       // 제자리 덮어쓰기
const DST2 = 'C:/Claude/Age of war/web/assets/terrain_tiles_v3/tile_1x1';  // 게임 폴더 동기

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.png')) files.push(p);
  }
})(SRC);

let done=0, skipped=0, errors=0;
for (const src of files) {
  try {
    const rel = path.relative(SRC, src);
    let img;
    try { img = decodePNG(fs.readFileSync(src)); }
    catch(e) { console.warn(`  SKIP (decode error): ${rel} — ${e.message}`); skipped++; continue; }

    applyDiamondMask(img.rgba, img.W, img.H);
    const png = encodePNG(img.rgba, img.W, img.H);

    // 저장 1: codex (제자리)
    fs.writeFileSync(path.join(DST1, rel), png);

    // 저장 2: 게임 웹 폴더
    const dst2path = path.join(DST2, rel);
    fs.mkdirSync(path.dirname(dst2path), {recursive:true});
    fs.writeFileSync(dst2path, png);

    done++;
    console.log(`  OK: ${rel} (${img.W}×${img.H})`);
  } catch(e) {
    console.error(`  ERR: ${path.relative(SRC,src)} — ${e.message}`);
    errors++;
  }
}
console.log(`\n완료: ${done}개 처리, ${skipped}개 스킵, ${errors}개 오류`);
