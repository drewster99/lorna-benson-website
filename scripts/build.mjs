import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
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
const pipelineHash = hash(JSON.stringify({versions: sharp.versions, widths: [360,640,960,1280,'native'], webpQuality:82, jpegQuality:85, colourspace:'srgb', perspective:2, pipelineVersion:2})).slice(0,8);
const isPoint = p => Array.isArray(p) && p.length===2 && p.every(Number.isFinite);

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
  seen.add(w.slug);
  w.photo = await verifiedOriginal(w.source, w.sha256, w.slug);
}
if (!artist.portrait?.alt?.trim()) throw Error('Artist portrait needs alternative text');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(artist.email ?? '')) throw Error('Artist needs a contact email');
if (!numberWords[media.length]) throw Error('Add a number word for '+media.length+' media');
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
  Object.assign(w, await derive(w.slug, () => sharp(data,{raw:info}), {width:info.width, height:info.height, alt:w.alt, fingerprint:w.sha256+JSON.stringify(w.artCorners)}));
  await fs.copyFile(w.source,`${out}/originals/${w.slug}.jpeg`);
}
const portrait = await derive('lorna-benson', () => sharp(artist.portrait.source).extract(crop), {width:crop.width, height:crop.height, alt:artist.portrait.alt, fingerprint:artist.portrait.sha256+JSON.stringify(crop)});

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
const routes=[];
async function page(route,title,description,body,active='',noindex=false){
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} | Lorna Benson</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#f6f1e7">${noindex?'<meta name="robots" content="noindex">':`<link rel="canonical" href="${origin}${route}">`}<meta property="og:title" content="${esc(title)} | Lorna Benson"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${origin}${route}"><meta property="og:image" content="${origin}/social.png"><meta property="og:image:alt" content="Lorna Benson — Artist, Gladstone, Michigan"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${cssPath}"></head><body>${nav(active,route)}<main id="main">${body}</main>${footer}</body></html>`;
  const dest=route==='/404.html'?out+route:out+route+'index.html';await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,html);if(!noindex)routes.push(route);
}

const salon=[['tree-huggers','happy-dance','hide-and-seek'],['little-blondie','best-friends']];
const featured=bySlug('look-what-i-caught');
const mediumCovers={'colored pencil':bySlug('christmas-pjs'),'chalk pastel':bySlug('brothers'),'graphite':bySlug('packer-fan'),'watercolor':bySlug('water-lily')};
const mediumNotes={
  'colored pencil':'Patient layers of color: tousled curls, flowered dresses, a brick hearth at Christmas.',
  'chalk pastel':'Soft, luminous color for sunlit shorelines, woodland days and warm embraces.',
  'graphite':'Every shade of gray, from a woodland backdrop to the stitching on a football jersey.',
  'watercolor':'Loose, luminous washes: a water lily glowing above its pads.',
};
const homeSelection=[['blowing-out-candles','brothers','first-attempt'],['christmas-pjs','little-em','not-out'],['big-brother','gracie-with-smore','attitude']];
const portraitSizes='(max-width: 799px) min(calc(100vw - 40px), 420px), 360px';

await page('/','Portraits of everyday wonder',`Children’s portraits and more in ${mediaInWords} by Gladstone, Michigan artist Lorna Benson.`,`
<section class="hero wrap">
  <div class="hero-copy">
    <p class="eyebrow">Kids’ Portraits · Michigan’s Upper Peninsula</p>
    <h1>Everyday moments.<br><em>Lasting wonder.</em></h1>
    <p class="intro">A birthday wish blown at full force. A frog in each hand. Best friends, shoulder to shoulder. Children’s portraits by Lorna Benson, in colored pencil, chalk pastel and graphite.</p>
    <div class="hero-actions"><a class="button" href="/gallery/">Explore the collection ${arrow}</a><a class="text-link" href="/about/">Meet the artist</a></div>
  </div>
  <div class="salon">${hang(salon,{eager:5,captions:false,label:'Selected portraits'})}</div>
</section>
<section class="feature" aria-labelledby="feature-title">
  <div class="wrap feature-inner">
    <a class="feature-art" href="/work/${featured.slug}/"><span class="mat">${picture(featured,'(max-width: 799px) calc(100vw - 40px), 54vw')}</span></a>
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
  <ul class="media-grid">${media.map(m=>{const cover=mediumCovers[m];const n=works.filter(w=>w.medium===m).length;return `<li><a class="medium-card" href="/gallery/${mediumSlug(m)}/"><span class="medium-image">${picture(cover,'(max-width: 799px) calc(100vw - 40px), 30vw',{alt:''})}</span><span class="medium-copy"><span class="medium-name">${esc(capitalize(m))}</span><span class="medium-count">${count(n,'work')}</span><span class="medium-note">${esc(mediumNotes[m])}</span></span></a></li>`;}).join('')}</ul>
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
</section>`);

for (const medium of [null,...media]) {
  const list=medium?works.filter(w=>w.medium===medium):works;const route=medium?`/gallery/${mediumSlug(medium)}/`:'/gallery/';
  const filters=[['All works',works.length,'/gallery/'],...media.map(m=>[capitalize(m),works.filter(w=>w.medium===m).length,`/gallery/${mediumSlug(m)}/`])];
  await page(route,medium?`${capitalize(medium)} works`:'The work',`Explore ${count(list.length,`${medium??'original'} work`)} by Lorna Benson. View each artwork in detail.`,`
<section class="page-intro wrap">
  <p class="eyebrow">The collection</p>
  <h1>${medium?`In <em>${esc(medium)}.</em>`:'The joy of <em>being little.</em>'}</h1>
  <p class="intro">${medium?`${count(list.length,'work')} in ${esc(medium)} by Lorna Benson.`:`A birthday wish, a shared adventure, a quiet smile. ${works.length} works in ${mediaInWords}, most of them portraits of childhood.`}</p>
</section>
<section class="gallery-section wrap" aria-label="Artwork gallery">
  <nav class="filters" aria-label="Browse by medium">${filters.map(([label,n,url])=>`<a href="${url}" ${url===route?'aria-current="page"':''}>${label} <span>${n}</span></a>`).join('')}</nav>
  <h2 class="visually-hidden">Artworks</h2>
  ${wall(list,{eager:4})}
  <p class="photo-note">Each work is shown straightened and trimmed from a photograph of the framed original; colors are not retouched. Every work’s page links to that untouched photograph.</p>
</section>`,'gallery');
}

const detailSizes=w=>{const r=w.width/w.height;return `(max-width: 799px) calc(100vw - 72px), min(calc(100vw - 200px), ${Math.round(r*72)}vh, ${w.width}px)`;};
for(let i=0;i<works.length;i++){
  const w=works[i],previous=works[(i+works.length-1)%works.length],next=works[(i+1)%works.length];
  const neighbor=(x,label)=>`<a href="/work/${x.slug}/"><span class="neighbor-thumb">${picture(x,'96px',{alt:''})}</span><span class="neighbor-text"><span>${label}</span>${esc(x.title)}</span></a>`;
  await page(`/work/${w.slug}/`,w.title,`${w.title}, a ${w.medium} work by Lorna Benson. ${w.alt}`,`
<section class="detail">
  <div class="wrap"><a class="back-link" href="/gallery/">← Back to the collection</a></div>
  <div class="detail-wall"><figure class="detail-art ar-${w.slug}"><span class="mat">${picture(w,detailSizes(w),{loading:'eager',priority:'high'})}</span></figure></div>
  <div class="wrap detail-body">
    <div class="detail-heading">
      <p class="eyebrow">The collection · ${String(i+1).padStart(2,'0')} of ${works.length}</p>
      <h1>${esc(w.title)}</h1>
      <p class="detail-meta">${esc(capitalize(w.medium))} · Lorna Benson</p>
      <p class="detail-description">${esc(w.alt)}</p>
    </div>
    <div class="original-bar">
      <div><h2>See it in its frame.</h2><p>The untouched photograph this view was made from, frame and all.<br>JPEG · ${w.photo.width} × ${w.photo.height} pixels · ${Math.round(w.photo.bytes/1024)} KB</p></div>
      <a class="button outline" href="/originals/${w.slug}.jpeg">Open original photograph ${arrow}</a>
    </div>
    <nav class="work-pagination" aria-label="Previous and next artwork">${neighbor(previous,'← Previous work')}${neighbor(next,'Next work →')}</nav>
  </div>
</section>`,'gallery');
}

const sourceURL='https://www.dailypress.net/news/local-news/2019/09/play-mural-unveiled-in-gladstone/';
await page('/about/','About the artist','Meet Gladstone, Michigan artist Lorna Benson, whose children’s portraits celebrate friendship, family and everyday life.',`
<section class="about-hero wrap">
  <div class="portrait-frame large">${picture(portrait,'(max-width: 799px) min(calc(100vw - 40px), 460px), 440px',{loading:'eager',priority:'high'})}</div>
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
  <aside class="about-aside" aria-label="Collection at a glance">
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
</section>`,'about');

await page('/404.html','Page not found','Return to Lorna Benson’s art collection.',`<section class="page-intro wrap"><p class="eyebrow">404 · Page not found</p><h1>Let’s find <em>the art.</em></h1><p class="intro">This page isn’t in the collection. The artwork is just a click away.</p><a class="button" href="/gallery/">Explore the collection ${arrow}</a></section>`,'',true);
await fs.writeFile(`${out}/sitemap.xml`,`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(r=>`<url><loc>${origin}${r}</loc></url>`).join('')}</urlset>`);
await fs.writeFile(`${out}/robots.txt`,`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
await fs.writeFile(`${out}/favicon.svg`,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="16" fill="#243d32"/><text x="40" y="53" text-anchor="middle" font-family="Georgia,serif" font-size="38" fill="#f6f1e7">LB</text></svg>');
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#f6f1e7"/><path d="M80 90H1120M80 540H1120" stroke="#243d32"/><text x="80" y="230" font-family="Georgia,serif" font-size="85" fill="#243d32">Lorna Benson</text><text x="80" y="350" font-family="Georgia,serif" font-size="48" fill="#243d32">Everyday moments. Lasting wonder.</text><text x="80" y="465" font-family="sans-serif" font-size="25" fill="#984c38">ARTIST · GLADSTONE, MICHIGAN</text></svg>')).png().toFile(`${out}/social.png`);
const iconPng=await sharp(`${out}/favicon.svg`).resize(32,32).png().toBuffer();
const icoHeader=Buffer.alloc(22);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);icoHeader[6]=32;icoHeader[7]=32;icoHeader.writeUInt16LE(1,10);icoHeader.writeUInt16LE(32,12);icoHeader.writeUInt32LE(iconPng.length,14);icoHeader.writeUInt32LE(22,18);await fs.writeFile(`${out}/favicon.ico`,Buffer.concat([icoHeader,iconPng]));
await fs.copyFile('src/_headers',`${out}/_headers`);
await fs.writeFile(`${out}/_redirects`,'/home.html / 301\n');
await fs.writeFile('build-report.json',JSON.stringify({pages:routes.length,artworks:works.length,originalBytes:works.reduce((s,w)=>s+w.photo.bytes,0),derivatives:inventory},null,2));
console.log(`BUILD SUCCESS: ${routes.length} pages, ${works.length} hash-verified originals, ${inventory.length} derivatives; legacy files untouched.`);
