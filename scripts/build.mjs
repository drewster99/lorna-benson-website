import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {rectifyArtwork} from './perspective.mjs';
const siteRoot=fileURLToPath(new URL('../',import.meta.url));
process.chdir(siteRoot);

const out = 'dist';
const origin = 'https://lornabenson.com';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const capitalize = s => s[0].toUpperCase()+s.slice(1);
const works = JSON.parse(await fs.readFile('content/works.json','utf8'));
const artist = JSON.parse(await fs.readFile('content/artist.json','utf8'));
const media = ['colored pencil','chalk pastel','graphite','watercolor'];
const listInWords = items => items.length<2?items.join(''):`${items.slice(0,-1).join(', ')} and ${items.at(-1)}`;
const mediaInWords = listInWords(media);
const numberWords = ['zero','one','two','three','four','five','six','seven','eight','nine'];
const mediumSlug = s => s.replaceAll(' ','-');
// What one work in each medium is called in prose ("one watercolor", "nine colored pencil drawings").
const mediumWorkNouns = {'colored pencil':['colored pencil drawing','colored pencil drawings'],'chalk pastel':['chalk pastel','chalk pastels'],'graphite':['graphite drawing','graphite drawings'],'watercolor':['watercolor','watercolors']};
const countInWords = n => numberWords[n] ?? String(n);
const mediumWorkCount = (medium,n) => `${countInWords(n)} ${mediumWorkNouns[medium][n===1?0:1]}`;
// Optional per-work facts; each renders on the work's page only when present in content/works.json.
const availabilityLabels = {'available':'Available','sold':'Sold','private-collection':'In a private collection','not-for-sale':'Not for sale'};
const sizeUnits = {in:{label:'in',unitCode:'INH'},cm:{label:'cm',unitCode:'CMT'}};
const workKeys = new Set(['slug','title','medium','source','sha256','alt','legacySource','artCorners','year','size','availability']);
const pipelineHash = hash(JSON.stringify({versions: sharp.versions, widths: [360,640,960,1280,'native'], webpQuality:82, jpegQuality:85, colourspace:'srgb', perspective:2, pipelineVersion:2})).slice(0,8);
const isPoint = p => Array.isArray(p) && p.length===2 && p.every(Number.isFinite);

/**
 * Sitemap lastmod: the committer date of the newest commit touching any build input. Every page is rendered
 * from the same inputs (one manifest, one template), so one date is honest for all of them, and reading it from
 * git keeps builds reproducible (file mtimes are reset by every checkout). A shallow clone could report the
 * wrong commit, so the full history is fetched first (Cloudflare Workers Builds clones shallowly); if that is
 * impossible the build stops rather than guessing.
 */
function committedContentDate(){
  const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
  if (git(['rev-parse','--is-shallow-repository'])!=='false') {
    console.log('Shallow clone: fetching full git history for sitemap lastmod.');
    execFileSync('git',['fetch','--unshallow','--quiet'],{stdio:'inherit'});
    if (git(['rev-parse','--is-shallow-repository'])!=='false') throw Error('Sitemap lastmod needs full git history, and git fetch --unshallow did not provide it.');
  }
  const date=git(['log','-1','--format=%cI','--','content','artwork','photos','scripts','src']);
  if (!date) throw Error('Sitemap lastmod needs at least one commit touching the build inputs.');
  return date;
}
const lastModified=committedContentDate();

async function verifiedOriginal(source, sha256, label) {
  const bytes = await fs.readFile(source);
  if (hash(bytes) !== sha256) throw Error('Original checksum mismatch: '+label);
  const m = await sharp(bytes).metadata();
  if (m.exif || m.xmp || m.iptc || m.tifftagPhotoshop) throw Error('Original needs metadata privacy review: '+label);
  return {width:m.width, height:m.height, bytes:bytes.length};
}

const seen = new Set();
for (const w of works) {
  if (!/^[a-z0-9-]+$/.test(w.slug) || seen.has(w.slug) || !media.includes(w.medium) || !w.alt?.trim() || !w.title?.trim()) throw Error('Invalid artwork manifest: '+w.slug);
  if (!Array.isArray(w.artCorners) || w.artCorners.length!==4 || !w.artCorners.every(isPoint)) throw Error('Artwork needs four [x, y] artCorners: '+w.slug);
  const unknownKeys = Object.keys(w).filter(k=>!workKeys.has(k));
  if (unknownKeys.length) throw Error(`Unknown artwork field(s) ${unknownKeys.join(', ')}: ${w.slug}`);
  if (w.year!==undefined && !(Number.isInteger(w.year) && w.year>=1900 && w.year<=new Date().getFullYear())) throw Error('Artwork year must be a four-digit year, not in the future: '+w.slug);
  if (w.size!==undefined) {
    const {height, width, unit, ...extra} = w.size ?? {};
    if (Object.keys(extra).length || !Object.hasOwn(sizeUnits, unit) || ![height,width].every(n=>Number.isFinite(n) && n>0)) throw Error('Artwork size must be {"height": number, "width": number, "unit": "in" | "cm"}: '+w.slug);
  }
  if (w.availability!==undefined && !Object.hasOwn(availabilityLabels, w.availability)) throw Error(`Artwork availability must be one of ${Object.keys(availabilityLabels).join(', ')}: ${w.slug}`);
  seen.add(w.slug);
  w.photo = await verifiedOriginal(w.source, w.sha256, w.slug);
}
if (!artist.portrait?.alt?.trim()) throw Error('Artist portrait needs alternative text');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(artist.email ?? '')) throw Error('Artist needs a contact email');
if (!numberWords[media.length]) throw Error('Add a number word for '+media.length+' media');
for (const m of media) if (mediumWorkNouns[m]?.length!==2) throw Error('Medium needs singular and plural work nouns: '+m);
const portraitPhoto = await verifiedOriginal(artist.portrait.source, artist.portrait.sha256, 'artist portrait');
const {crop} = artist.portrait;
if (crop.left<0 || crop.top<0 || crop.left+crop.width>portraitPhoto.width || crop.top+crop.height>portraitPhoto.height) throw Error('Artist portrait crop is outside the photograph');

// Only this generated directory is replaced. Legacy materials, artwork and photos are never modified.
await fs.rm(out,{recursive:true,force:true});
await fs.mkdir(`${out}/assets`,{recursive:true});
await fs.mkdir(`${out}/originals`,{recursive:true});
const inventory=[];

/** Writes WebP and JPEG derivatives of a rendered image and returns what `picture` needs. */
async function derive(slug, render, {width, height, alt, fingerprint}) {
  const image = {slug, width, height, alt, base:`/assets/${slug}-${hash(fingerprint+pipelineHash).slice(0,10)}`};
  image.sizes=[...new Set([360,640,960,1280,width].filter(n=>n<=width))].sort((a,b)=>a-b);
  for (const size of image.sizes) {
    for (const format of ['webp','jpeg']) {
      const dest=`${out}${image.base}-${size}.${format}`;
      await render().resize({width:size,withoutEnlargement:true}).toColourspace('srgb')[format]({quality:format==='webp'?82:85}).toFile(dest);
      inventory.push({slug,width:size,format,bytes:(await fs.stat(dest)).size,path:dest});
    }
  }
  return image;
}

for (const w of works) {
  const {data, info} = await (await rectifyArtwork(w.source, w.artCorners)).raw().toBuffer({resolveWithObject:true});
  w.render = () => sharp(data,{raw:info});
  Object.assign(w, await derive(w.slug, w.render, {width:info.width, height:info.height, alt:w.alt, fingerprint:w.sha256+JSON.stringify(w.artCorners)}));
  await fs.copyFile(w.source,`${out}/originals/${w.slug}.jpeg`);
}
const renderPortrait = () => sharp(artist.portrait.source).extract(crop);
const portrait = await derive('lorna-benson', renderPortrait, {width:crop.width, height:crop.height, alt:artist.portrait.alt, fingerprint:artist.portrait.sha256+JSON.stringify(crop)});

/*
 * Share previews are 1200×630, the 1.91:1 large-card size that Facebook, LinkedIn and X display. Those platforms crop
 * any other shape, so the whole work sits on its mat inside the card instead: nothing is cropped and nothing is enlarged.
 */
const share = {width:1200, height:630, jpegQuality:84, matPad:16, layoutVersion:1};
const shareHash = hash(JSON.stringify({pipelineHash, share})).slice(0,10);
const shareColors = {paper:'#f6f1e7', wall:'#e9e2d3', mat:'#fffdf8', ink:'#243d32', accent:'#984c38'};
/** Composites a matted image into a box on a 1200×630 background and returns the og:image fields. */
async function shareImage(name, {render, fingerprint, alt, background, text='', box}) {
  const assetPath = `/assets/share-${name}-${hash(fingerprint+shareHash).slice(0,10)}.jpeg`;
  const {data, info} = await render().resize({width:box.width-2*share.matPad, height:box.height-2*share.matPad, fit:'inside', withoutEnlargement:true}).toColourspace('srgb')
    .extend({top:share.matPad, bottom:share.matPad, left:share.matPad, right:share.matPad, background:shareColors.mat}).png().toBuffer({resolveWithObject:true});
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${share.width}" height="${share.height}"><rect width="${share.width}" height="${share.height}" fill="${background}"/>${text}</svg>`;
  await sharp(Buffer.from(svg)).composite([{input:data, left:box.left+Math.round((box.width-info.width)/2), top:box.top+Math.round((box.height-info.height)/2)}]).jpeg({quality:share.jpegQuality, mozjpeg:true}).toFile(out+assetPath);
  inventory.push({slug:'share-'+name, width:share.width, format:'jpeg', bytes:(await fs.stat(out+assetPath)).size, path:out+assetPath});
  return {url:origin+assetPath, width:share.width, height:share.height, alt};
}
const artworkShares = new Map();
/** One share image per work, reused by its page and by any gallery it covers. */
async function artworkShare(w) {
  if (!artworkShares.has(w.slug)) artworkShares.set(w.slug, await shareImage(w.slug, {render:w.render, fingerprint:w.sha256+JSON.stringify(w.artCorners), alt:w.alt, background:shareColors.wall, box:{left:40, top:40, width:1120, height:550}}));
  return artworkShares.get(w.slug);
}
/** A name card for Home and About: the site's wordmark and two lines of heading on the left, a matted image on the right. */
async function nameCardShare(name, {render, fingerprint, imageAlt, eyebrow, lines}) {
  const {ink, accent} = shareColors;
  const text = `<path d="M72 92H560M72 538H560" stroke="${ink}" stroke-width="1.5"/><text x="72" y="168" font-family="sans-serif" font-size="19" letter-spacing="3" fill="${accent}">${esc(eyebrow.toUpperCase())}</text><text x="72" y="282" font-family="Georgia,serif" font-size="74" fill="${ink}">Lorna Benson</text>${lines.map((line,i)=>`<text x="72" y="${372+i*54}" font-family="Georgia,serif" font-size="40"${i===lines.length-1?' font-style="italic"':''} fill="${ink}">${esc(line)}</text>`).join('')}`;
  const alt = `Lorna Benson. ${lines.join(' ')} ${imageAlt}`;
  return shareImage(name, {render, fingerprint:fingerprint+text, alt, background:shareColors.paper, text, box:{left:612, top:44, width:548, height:542}});
}

// Each artwork's proportions drive the justified walls; CSP forbids inline styles, so they live in the stylesheet.
const ratioRules = works.map(w=>`.ar-${w.slug}{--ar:${(w.width/w.height).toFixed(4)};--native-width:${w.width}px}`).join('\n');
const css=Buffer.from(`${await fs.readFile('src/style.css','utf8')}\n/* Generated artwork proportions. */\n${ratioRules}\n`);
const cssPath=`/assets/style-${hash(css).slice(0,10)}.css`;
await fs.writeFile(out+cssPath,css);

const picture=(image,sizes,{loading='lazy',priority='auto',alt=image.alt}={}) => `<picture><source type="image/webp" srcset="${image.sizes.map(n=>`${image.base}-${n}.webp ${n}w`).join(', ')}" sizes="${sizes}"><img src="${image.base}-${image.sizes.find(n=>n>=640)||image.width}.jpeg" srcset="${image.sizes.map(n=>`${image.base}-${n}.jpeg ${n}w`).join(', ')}" sizes="${sizes}" width="${image.width}" height="${image.height}" alt="${esc(alt)}" loading="${loading}" decoding="async" fetchpriority="${priority}"></picture>`;
const arrow='<span aria-hidden="true">↗</span>';
const bySlug=slug=>{const w=works.find(x=>x.slug===slug);if(!w)throw Error('Unknown artwork: '+slug);return w;};
const count=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
// A justified row holds roughly this many pixels of height; sizes hints follow from each work's proportions.
const wallSizes=(w,rowHeight)=>`(max-width: 599px) min(calc(100vw - 40px), ${Math.round(w.width/w.height*240)}px), ${Math.round(w.width/w.height*rowHeight*1.25)}px`;

const wallItem=(w,i,{eager,captions,rowHeight})=>`<li class="wall-item ar-${w.slug}"><a class="wall-link" href="/work/${w.slug}/"><span class="mat">${picture(w,wallSizes(w,rowHeight),{loading:i<eager?'eager':'lazy',priority:i===0&&eager?'high':'auto',alt:captions?w.alt:`${w.title}: ${w.alt}`})}</span>${captions?`<span class="wall-caption"><span class="wall-title">${esc(w.title)}</span><span class="wall-medium">${esc(w.medium)}</span></span>`:''}</a></li>`;
/** A flowing wall for whole collections: rows wrap wherever they fill, so the last row may be short. */
function wall(list,{eager=0,captions=true,rowHeight=260,label='Artworks'}={}){
  return `<ul class="wall" aria-label="${esc(label)}">${list.map((w,i)=>wallItem(w,i,{eager,captions,rowHeight})).join('')}</ul>`;
}
/** A curated arrangement: every row spans the full width, so a hand-picked set never leaves a ragged row. */
function hang(rows,{eager=0,captions=true,rowHeight=220,label='Artworks'}={}){
  let index=0;
  return `<div class="hang${captions?'':' hang-compact'}" role="group" aria-label="${esc(label)}">${rows.map(row=>`<ul class="hang-row">${row.map(slug=>wallItem(bySlug(slug),index++,{eager,captions,rowHeight})).join('')}</ul>`).join('')}</div>`;
}

const nav=(active,route)=>`<a class="skip" href="#main">Skip to content</a><header class="header wrap"><a class="wordmark" href="/">Lorna Benson<span>Artist · Gladstone, Michigan</span></a><nav aria-label="Main navigation"><a href="/gallery/" ${active==='gallery'?`aria-current="${route==='/gallery/'?'page':'true'}"`:''}>The work</a><a href="/about/" ${active==='about'?'aria-current="page"':''}>About the artist</a><a href="/about/#contact">Contact</a></nav></header>`;
const footer=`<footer class="footer"><div class="wrap footer-inner"><div><a class="footer-name" href="/">Lorna Benson</a><p>Portraits. People. The moments between.</p><a class="footer-email" href="mailto:${esc(artist.email)}">${esc(artist.email)}</a></div><div><a href="/gallery/">Explore the collection ${arrow}</a><p>© Lorna Benson. All artwork rights reserved.</p></div></div></footer>`;
/** Absolute URL of an image's largest JPEG derivative, for structured data and the image sitemap. */
const largestJpegURL=image=>`${origin}${image.base}-${image.sizes.at(-1)}.jpeg`;
const personId=`${origin}/#lorna-benson`;
const personReference={'@type':'Person','@id':personId,name:'Lorna Benson',url:`${origin}/`};
/** JSON-LD as a data block; `<` is escaped so no string in the data can close the script element. */
const jsonLd=data=>`<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org',...data}).replaceAll('<','\\u003c')}</script>`;

const routes=[];
/** Writes one HTML page. `images` are the page's own images, listed for it in the image sitemap. */
async function page(route,title,description,body,{share,active='',noindex=false,structuredData=null,images=[]}){
  if (!share?.url || !share.alt?.trim()) throw Error('Page needs a share image with alternative text: '+route);
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} | Lorna Benson</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#f6f1e7">${noindex?'<meta name="robots" content="noindex">':`<link rel="canonical" href="${origin}${route}">`}<meta property="og:title" content="${esc(title)} | Lorna Benson"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${origin}${route}"><meta property="og:image" content="${share.url}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="${share.width}"><meta property="og:image:height" content="${share.height}"><meta property="og:image:alt" content="${esc(share.alt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${share.url}"><meta name="twitter:image:alt" content="${esc(share.alt)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${cssPath}">${structuredData?jsonLd(structuredData):''}</head><body>${nav(active,route)}<main id="main">${body}</main>${footer}</body></html>`;
  const dest=route==='/404.html'?out+route:out+route+'index.html';await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,html);if(!noindex)routes.push({route,images});
}

const heroSelection=[['tree-huggers','happy-dance','hide-and-seek'],['little-blondie','best-friends']];
const featured=bySlug('look-what-i-caught');
const mediumCovers={'colored pencil':bySlug('christmas-pjs'),'chalk pastel':bySlug('brothers'),'graphite':bySlug('packer-fan'),'watercolor':bySlug('water-lily')};
const mediumNotes={
  'colored pencil':'Patient layers of color: tousled curls, flowered dresses, a brick hearth at Christmas.',
  'chalk pastel':'Soft, luminous color for sunlit shorelines, woodland days and warm embraces.',
  'graphite':'Every shade of gray, from a woodland backdrop to the stitching on a football jersey.',
  'watercolor':'Loose, luminous washes: a water lily glowing above its pads.',
};
for (const m of media) if (!mediumCovers[m] || !mediumNotes[m]?.trim()) throw Error('Medium needs a cover and a note: '+m);
const homeShare=await nameCardShare('home',{render:featured.render,fingerprint:featured.sha256+JSON.stringify(featured.artCorners),imageAlt:`Beside it, ${featured.title}: ${featured.alt}`,eyebrow:'Artist · Gladstone, Michigan',lines:['Everyday moments.','Lasting wonder.']});
const homeSelection=[['blowing-out-candles','brothers','first-attempt'],['christmas-pjs','little-em','not-out'],['big-brother','gracie-with-smore','attitude']];
const artistPerson={...personReference,jobTitle:'Artist',description:`Artist in Gladstone, Michigan, making children’s portraits and more in ${mediaInWords}.`,image:largestJpegURL(portrait),email:artist.email,address:{'@type':'PostalAddress',addressLocality:'Gladstone',addressRegion:'MI',addressCountry:'US'}};
const portraitSizes='(max-width: 599px) min(calc(100vw - 54px), 286px), (max-width: 899px) 360px, (max-width: 1099px) 280px, 340px';

await page('/','Portraits of everyday wonder',`Children’s portraits and more in ${mediaInWords} by Gladstone, Michigan artist Lorna Benson.`,`
<section class="hero wrap">
  <div class="hero-copy">
    <p class="eyebrow">Kids’ Portraits · Michigan’s Upper Peninsula</p>
    <h1>Everyday moments.<br><em>Lasting wonder.</em></h1>
    <p class="intro">Children’s portraits by Lorna Benson, in colored pencil, chalk pastel and graphite. A birthday wish blown at full force. A frog in each hand. Best friends, shoulder to shoulder.</p>
    <div class="hero-actions"><a class="button" href="/gallery/">Explore the collection ${arrow}</a><a class="text-link" href="/about/">Meet the artist</a></div>
  </div>
  ${hang(heroSelection,{eager:5,captions:false,label:'Selected portraits'})}
</section>
<section class="feature" aria-labelledby="feature-title">
  <div class="wrap feature-inner">
    <a class="feature-art" href="/work/${featured.slug}/"><span class="mat">${picture(featured,'(max-width: 899px) calc(100vw - 56px), min(54vw, 730px)',{alt:featured.title})}</span></a>
    <div class="feature-copy">
      <p class="eyebrow">Featured work</p>
      <h2 id="feature-title">${esc(featured.title)}</h2>
      <p class="feature-medium">${esc(capitalize(featured.medium))}</p>
      <p>${esc(featured.alt)}</p>
      <a class="button light" href="/work/${featured.slug}/">Look closer ${arrow}</a>
    </div>
  </div>
</section>
<section class="section wrap" aria-labelledby="media-title">
  <div class="section-heading"><div><p class="eyebrow">Ways of seeing</p><h2 id="media-title">One artist, <em>${numberWords[media.length]} media.</em></h2></div></div>
  <ul class="media-grid">${media.map(m=>{const cover=mediumCovers[m];const n=works.filter(w=>w.medium===m).length;return `<li><a class="medium-card" href="/gallery/${mediumSlug(m)}/"><span class="medium-image">${picture(cover,'(max-width: 599px) calc(100vw - 40px), (max-width: 1099px) 46vw, 22vw',{alt:''})}</span><span class="medium-copy"><span class="medium-name">${esc(capitalize(m))}</span><span class="medium-count">${count(n,'work')}</span><span class="medium-note">${esc(mediumNotes[m])}</span></span></a></li>`;}).join('')}</ul>
</section>
<section class="section wrap collection-preview" aria-labelledby="selected">
  <div class="section-heading"><div><p class="eyebrow">From the collection</p><h2 id="selected">Small moments, <em>fully seen.</em></h2></div><a class="text-link" href="/gallery/">View all ${works.length} works ${arrow}</a></div>
  ${hang(homeSelection,{rowHeight:300,label:'More portraits'})}
</section>
<section class="artist-teaser" aria-labelledby="artist-title">
  <div class="wrap artist-teaser-inner">
    <div class="portrait-frame">${picture(portrait,portraitSizes)}</div>
    <div>
      <p class="eyebrow">The artist</p>
      <h2 id="artist-title">Rooted in Gladstone.<br><em>Drawn to people.</em></h2>
      <p>Lorna Benson has called Gladstone, Michigan home for more than 50 years. Her portraits turn an attentive, affectionate eye toward childhood, friendship and family.</p>
      <a class="button" href="/about/">About Lorna ${arrow}</a>
    </div>
  </div>
</section>`,{share:homeShare,structuredData:artistPerson});

/** Gallery meta description: names the count in words and the works themselves, so no page reads "Explore 1 watercolor work". */
function galleryDescription(medium,list){
  if (!medium) return `All ${list.length} works by Gladstone, Michigan artist Lorna Benson in ${mediaInWords}, most of them portraits of childhood.`;
  const lead=`${capitalize(mediumWorkCount(medium,list.length))} by Gladstone, Michigan artist Lorna Benson`;
  const titles=list.map(w=>w.title);
  return titles.length<=3?`${lead}: ${listInWords(titles)}.`:`${lead}, including ${listInWords(titles.slice(0,3))}.`;
}
for (const medium of [null,...media]) {
  const list=medium?works.filter(w=>w.medium===medium):works;const route=medium?`/gallery/${mediumSlug(medium)}/`:'/gallery/';
  const filters=[['All works',works.length,'/gallery/'],...media.map(m=>[capitalize(m),works.filter(w=>w.medium===m).length,`/gallery/${mediumSlug(m)}/`])];
  await page(route,medium?capitalize(mediumWorkNouns[medium][1]):'The work',galleryDescription(medium,list),`
<section class="page-intro wrap">
  <p class="eyebrow">The collection</p>
  <h1>${medium?`Lorna Benson <em>in ${esc(medium)}.</em>`:'The joy of <em>being little.</em>'}</h1>
  <p class="intro">${medium?`${esc(capitalize(mediumWorkCount(medium,list.length)))}. ${esc(mediumNotes[medium])}`:`A birthday wish, a shared adventure, a quiet smile. ${works.length} works by Lorna Benson in ${mediaInWords}, most of them portraits of childhood.`}</p>
</section>
<section class="gallery-section wrap" aria-label="Artwork gallery">
  <nav class="filters" aria-label="Browse by medium">${filters.map(([label,n,url])=>`<a href="${url}" ${url===route?'aria-current="page"':''}>${label} <span>${n}</span></a>`).join('')}</nav>
  <h2 class="visually-hidden">Artworks</h2>
  ${wall(list,{eager:4})}
  <p class="photo-note">Each work is shown straightened and trimmed from a photograph of the framed original; colors are not retouched. Every work’s page links to that untouched photograph.</p>
</section>`,{active:'gallery',share:await artworkShare(medium?mediumCovers[medium]:bySlug(heroSelection[0][0]))});
}

const detailSizes=w=>{const r=w.width/w.height;return `(max-width: 799px) calc(100vw - 72px), min(calc(100vw - 200px), ${Math.round(r*72)}vh, ${w.width}px)`;};
const sizeInWords=({height,width,unit})=>`${height} × ${width} ${sizeUnits[unit].label}`;
/** Year, size and availability of the original, each shown only when recorded in content/works.json. */
function workFacts(w){
  const facts=[
    w.year!==undefined&&['Year',esc(w.year)],
    w.size!==undefined&&['Size (height × width)',esc(sizeInWords(w.size))],
    w.availability!==undefined&&['Original',esc(availabilityLabels[w.availability])+(w.availability==='available'?` · <a href="/about/#contact">Ask Lorna</a>`:'')],
  ].filter(Boolean);
  return facts.length?`<dl class="detail-facts">${facts.map(([term,detail])=>`<div><dt>${term}</dt><dd>${detail}</dd></div>`).join('')}</dl>`:'';
}
function artworkStructuredData(w,url){
  const quantity=n=>({'@type':'QuantitativeValue',value:n,unitCode:sizeUnits[w.size.unit].unitCode});
  return {'@type':'VisualArtwork','@id':`${url}#artwork`,name:w.title,url,image:largestJpegURL(w),description:w.alt,artMedium:w.medium,creator:personReference,copyrightHolder:personReference,
    ...(w.year!==undefined&&{dateCreated:String(w.year)}),
    ...(w.size!==undefined&&{height:quantity(w.size.height),width:quantity(w.size.width)})};
}
for(let i=0;i<works.length;i++){
  const w=works[i],previous=works[(i+works.length-1)%works.length],next=works[(i+1)%works.length];
  const neighbor=(x,label)=>`<a href="/work/${x.slug}/"><span class="neighbor-thumb">${picture(x,'96px',{alt:''})}</span><span class="neighbor-text"><span>${label}</span>${esc(x.title)}</span></a>`;
  const route=`/work/${w.slug}/`;
  await page(route,w.title,`${w.title}, a ${mediumWorkNouns[w.medium][0]} by Lorna Benson. ${w.alt}`,`
<section class="detail">
  <div class="wrap"><a class="back-link" href="/gallery/">← Back to the collection</a></div>
  <div class="detail-wall"><figure class="detail-art ar-${w.slug}"><span class="mat">${picture(w,detailSizes(w),{loading:'eager',priority:'high'})}</span></figure></div>
  <div class="wrap detail-body">
    <div class="detail-heading">
      <p class="eyebrow">The collection · ${String(i+1).padStart(2,'0')} of ${works.length}</p>
      <h1>${esc(w.title)}</h1>
      <p class="detail-meta">${esc(capitalize(w.medium))} · Lorna Benson</p>
      <p class="detail-description">${esc(w.alt)}</p>
      ${workFacts(w)}
    </div>
    <div class="original-bar">
      <div><h2>See it in its frame.</h2><p>The untouched photograph this view was made from, frame and all.<br>JPEG · ${w.photo.width} × ${w.photo.height} pixels · ${Math.round(w.photo.bytes/1024)} KB</p></div>
      <a class="button outline" href="/originals/${w.slug}.jpeg">Open original photograph ${arrow}</a>
    </div>
    <nav class="work-pagination" aria-label="Previous and next artwork">${neighbor(previous,'← Previous work')}${neighbor(next,'Next work →')}</nav>
  </div>
</section>`,{active:'gallery',share:await artworkShare(w),structuredData:artworkStructuredData(w,origin+route),images:[w]});
}

const sourceURL='https://www.dailypress.net/news/local-news/2019/09/play-mural-unveiled-in-gladstone/';
await page('/about/','About the artist','Meet Gladstone, Michigan artist Lorna Benson, whose children’s portraits celebrate friendship, family and everyday life.',`
<section class="about-hero wrap">
  <div class="portrait-frame">${picture(portrait,'(max-width: 599px) min(calc(100vw - 54px), 286px), (max-width: 899px) 360px, (max-width: 1099px) 340px, 420px',{loading:'eager',priority:'high'})}</div>
  <div class="about-intro">
    <p class="eyebrow">About the artist</p>
    <h1>A sense of place.<br><em>An eye for people.</em></h1>
    <p class="intro">Lorna Benson is an artist in Gladstone, Michigan, on the shore of Little Bay de Noc in the Upper Peninsula. She has made the community her home for more than 50 years.</p>
  </div>
</section>
<section class="about-layout wrap">
  <div class="prose">
    <h2>Childhood, as it happens.</h2>
    <p>Lorna’s Kids’ Portraits are about the moments families hold onto: a birthday wish blown at full force, a proud boy holding up a frog in each hand, three best friends standing shoulder to shoulder, a little Packers fan at the foot of a tree, and a slide into home plate that’s much too close to call.</p>
    <p>Her children aren’t stiff studio sitters. They grin into the sun, hug, giggle, slide and dance, and she draws them that way, with the patience to get every curl, freckle and grin right.</p>
    <h2>Ways of seeing.</h2>
    <p>In <a href="/gallery/colored-pencil/">colored pencil</a>, she works in fine detail: the pattern of a flowered dress, the speckled blue behind a tousled head of curls, the mortar lines of a brick hearth at Christmas. Her <a href="/gallery/chalk-pastel/">chalk pastels</a> are softer and warmer, full of sunlit shorelines, woodland greens and warm embraces. In <a href="/gallery/graphite/">graphite</a>, she builds a whole woodland in shades of gray. And in <a href="/gallery/watercolor/">watercolor</a>, loose washes bloom into a water lily glowing above its pads.</p>
    <p>Look closely and you’ll often find her initials, LKB, tucked into a corner.</p>
  </div>
  <aside aria-label="Collection at a glance">
    <dl class="facts">
      <div><dt>Home</dt><dd>Gladstone, Michigan</dd></div>
      <div><dt>On this site</dt><dd>${works.length} works</dd></div>
      <div><dt>Media</dt><dd>${media.map(m=>`${capitalize(m)} (${works.filter(w=>w.medium===m).length})`).join('<br>')}</dd></div>
    </dl>
  </aside>
</section>
<section class="wrap about-strip" aria-label="From the collection">${hang([['little-blondie','happy-dance','tree-huggers']],{captions:false,rowHeight:300,label:'From the collection'})}</section>
<section class="about-layout wrap">
  <div class="prose">
    <h2>A connection to community.</h2>
    <p>In September 2019, the <cite>Daily Press</cite> reported that Lorna Benson spoke at the unveiling of Gladstone’s “Play” mural, thanking the organizations, businesses and residents who supported the project and its artists.</p>
    <p class="source-note">Community story: <a href="${sourceURL}">“‘Play’ mural unveiled in Gladstone,” <cite>Daily Press</cite>, September 7, 2019 ${arrow}</a>. The mural is a community project; it is not presented here as Lorna’s artwork.</p>
    <section class="contact" id="contact" aria-labelledby="contact-title"><p class="eyebrow">Say hello</p><h2 id="contact-title">Let’s talk about art.</h2><p>For questions about the work, get in touch by email.</p><a class="button" href="mailto:${esc(artist.email)}">Email Lorna ${arrow}</a><p class="contact-address">${esc(artist.email)}</p></section>
  </div>
</section>`,{active:'about',share:await nameCardShare('about',{render:renderPortrait,fingerprint:artist.portrait.sha256+JSON.stringify(crop),imageAlt:`Beside it, her portrait: ${artist.portrait.alt}`,eyebrow:'About the artist',lines:['A sense of place.','An eye for people.']}),structuredData:{'@type':'ProfilePage',mainEntity:artistPerson},images:[portrait]});

await page('/404.html','Page not found','Return to Lorna Benson’s art collection.',`<section class="page-intro wrap"><p class="eyebrow">404 · Page not found</p><h1>Let’s find <em>the art.</em></h1><p class="intro">This page isn’t in the collection. The artwork is just a click away.</p><a class="button" href="/gallery/">Explore the collection ${arrow}</a></section>`,{share:homeShare,noindex:true});
await fs.writeFile(`${out}/sitemap.xml`,`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${routes.map(({route,images})=>`<url><loc>${origin}${route}</loc><lastmod>${lastModified}</lastmod>${images.map(image=>`<image:image><image:loc>${esc(largestJpegURL(image))}</image:loc></image:image>`).join('')}</url>`).join('')}</urlset>`);

// llms.txt (llmstxt.org): the same verified facts as the About page. Cloudflare serves .txt without a charset, so it must stay ASCII.
const llmsWorkLine=w=>{
  const facts=[capitalize(mediumWorkNouns[w.medium][0]),w.year!==undefined&&String(w.year),w.size!==undefined&&`${w.size.height} x ${w.size.width} ${sizeUnits[w.size.unit].label} (height x width)`,w.availability!==undefined&&`original: ${availabilityLabels[w.availability].toLowerCase()}`].filter(Boolean);
  return `- [${w.title}](${origin}/work/${w.slug}/): ${facts.join(', ')}. ${w.alt}`;
};
const llmsText=`# Lorna Benson

> Lorna Benson is an artist in Gladstone, Michigan, on Little Bay de Noc in Michigan's Upper Peninsula, and has made Gladstone her home for more than 50 years. This site shows ${works.length} of her works in ${mediaInWords}, most of them portraits of childhood.

- Contact: ${artist.email} (email). The site does not describe commissions, prices or sales; for questions about the work, contact Lorna by email.
- Look closely and her initials, LKB, are often tucked into a corner of a work.
- Each work is shown straightened and trimmed from a photograph of the framed original; colors are not retouched. Every artwork page links that untouched photograph.
- All artwork rights reserved by Lorna Benson.

## About

- [About the artist](${origin}/about/): Biography, the media she works in, and how to get in touch.
- [Home](${origin}/): Selected works and an introduction to the artist.

## Media

- [All works](${origin}/gallery/): All ${works.length} works on the site.
${media.map(m=>{const n=works.filter(w=>w.medium===m).length;return `- [${capitalize(m)}](${origin}/gallery/${mediumSlug(m)}/): ${capitalize(mediumWorkCount(m,n))}. ${mediumNotes[m]}`;}).join('\n')}

## Works

${works.map(llmsWorkLine).join('\n')}

## Optional

- [Daily Press: "'Play' mural unveiled in Gladstone" (September 7, 2019)](${sourceURL}): Reports that Lorna Benson spoke at the unveiling of Gladstone's "Play" mural, thanking the organizations, businesses and residents who supported the project and its artists. The mural is a community project; it is not presented as her artwork.
- [Sitemap](${origin}/sitemap.xml): Every page, with its images.
`;
if (/[^\x00-\x7F]/.test(llmsText)) throw Error('llms.txt must be ASCII (Cloudflare serves .txt without a charset): '+llmsText.match(/[^\x00-\x7F]/)[0]);
await fs.writeFile(`${out}/llms.txt`,llmsText);
await fs.writeFile(`${out}/robots.txt`,`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
await fs.writeFile(`${out}/favicon.svg`,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="16" fill="#243d32"/><text x="40" y="53" text-anchor="middle" font-family="Georgia,serif" font-size="38" fill="#f6f1e7">LB</text></svg>');
const iconPng=await sharp(`${out}/favicon.svg`).resize(32,32).png().toBuffer();
const icoHeader=Buffer.alloc(22);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);icoHeader[6]=32;icoHeader[7]=32;icoHeader.writeUInt16LE(1,10);icoHeader.writeUInt16LE(32,12);icoHeader.writeUInt32LE(iconPng.length,14);icoHeader.writeUInt32LE(22,18);await fs.writeFile(`${out}/favicon.ico`,Buffer.concat([icoHeader,iconPng]));
await fs.copyFile('src/_headers',`${out}/_headers`);
await fs.writeFile(`${out}/_redirects`,'/home.html / 301\n');
await fs.writeFile('build-report.json',JSON.stringify({pages:routes.length,artworks:works.length,originalBytes:works.reduce((s,w)=>s+w.photo.bytes,0),derivatives:inventory},null,2));
console.log(`BUILD SUCCESS: ${routes.length} pages, ${works.length} hash-verified originals, ${inventory.length} derivatives; legacy files untouched.`);
