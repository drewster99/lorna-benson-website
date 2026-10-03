import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
const siteRoot=fileURLToPath(new URL('../',import.meta.url));
process.chdir(siteRoot);

const out = 'dist';
const origin = 'https://lornabenson.com';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const works = JSON.parse(await fs.readFile('content/works.json','utf8'));
const media = ['colored pencil','chalk pastel','graphite'];
const mediumSlug = s => s.replaceAll(' ','-');
const pipelineHash = hash(JSON.stringify({versions: sharp.versions, widths: [360,640,960,'native'], webpQuality:82, jpegQuality:85, colourspace:'srgb', pipelineVersion:1})).slice(0,8);
const seen = new Set();
for (const w of works) {
  if (!/^[a-z0-9-]+$/.test(w.slug) || seen.has(w.slug) || !media.includes(w.medium) || !w.alt?.trim() || !w.title?.trim()) throw Error('Invalid artwork manifest: '+w.slug);
  seen.add(w.slug);
  const bytes = await fs.readFile(w.source);
  if (hash(bytes) !== w.sha256) throw Error('Original artwork checksum mismatch: '+w.slug);
  const m = await sharp(bytes).metadata();
  if (m.exif || m.xmp || m.iptc || m.tifftagPhotoshop) throw Error('Original needs metadata privacy review: '+w.slug);
  w.width=m.width; w.height=m.height; w.bytes=bytes.length;
}
// Only this generated directory is replaced. Legacy materials and artwork are never modified.
await fs.rm(out,{recursive:true,force:true});
await fs.mkdir(`${out}/assets`,{recursive:true});
await fs.mkdir(`${out}/originals`,{recursive:true});
let inventory=[];
for (const w of works) {
  w.sizes=[...new Set([360,640,960,w.width].filter(n=>n<=w.width))].sort((a,b)=>a-b);
  w.base=`/assets/${w.slug}-${w.sha256.slice(0,10)}-${pipelineHash}`;
  for (const width of w.sizes) {
    for (const format of ['webp','jpeg']) {
      const dest=`${out}${w.base}-${width}.${format}`;
      await sharp(w.source).resize({width,withoutEnlargement:true}).toColourspace('srgb')[format]({quality:format==='webp'?82:85}).toFile(dest);
      inventory.push({slug:w.slug,width,format,bytes:(await fs.stat(dest)).size,path:dest});
    }
  }
  await fs.copyFile(w.source,`${out}/originals/${w.slug}.jpeg`);
}
const css=await fs.readFile('src/style.css');
const cssPath=`/assets/style-${hash(css).slice(0,10)}.css`;
await fs.writeFile(out+cssPath,css);
const picture=(w,sizes,loading='lazy',cls='',priority='auto') => `<picture class="${w.width>w.height?'landscape':'portrait'}"><source type="image/webp" srcset="${w.sizes.map(n=>`${w.base}-${n}.webp ${n}w`).join(', ')}" sizes="${sizes}"><img class="${cls}" src="${w.base}-${w.sizes.find(n=>n>=640)||w.width}.jpeg" srcset="${w.sizes.map(n=>`${w.base}-${n}.jpeg ${n}w`).join(', ')}" sizes="${sizes}" width="${w.width}" height="${w.height}" alt="${esc(w.alt)}" loading="${loading}" decoding="async" fetchpriority="${priority}"></picture>`;
const arrow='<span aria-hidden="true">↗</span>';
const nav=(active,route)=>`<a class="skip" href="#main">Skip to content</a><header class="header wrap"><a class="wordmark" href="/">Lorna Benson<span>Artist · Gladstone, Michigan</span></a><nav aria-label="Main navigation"><a href="/gallery/" ${active==='gallery'?`aria-current="${route==='/gallery/'?'page':'true'}"`:''}>The work</a><a href="/about/" ${active==='about'?'aria-current="page"':''}>About the artist</a><a href="/about/#contact">Contact ${arrow}</a></nav></header>`;
const footer=`<footer class="footer wrap"><div><a class="footer-name" href="/">Lorna Benson</a><p>Portraits. People. The moments between.</p></div><div><a href="/gallery/">Explore the collection ${arrow}</a><p>© Lorna Benson. All artwork rights reserved.</p></div></footer>`;
const routes=[];
async function page(route,title,description,body,active='',noindex=false){
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} | Lorna Benson</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#f6f1e7">${noindex?'<meta name="robots" content="noindex">':`<link rel="canonical" href="${origin}${route}">`}<meta property="og:title" content="${esc(title)} | Lorna Benson"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${origin}${route}"><meta property="og:image" content="${origin}/social.png"><meta property="og:image:alt" content="Lorna Benson — Artist, Gladstone, Michigan"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${cssPath}"></head><body>${nav(active,route)}<main id="main">${body}</main>${footer}</body></html>`;
  const dest=route==='/404.html'?out+route:out+route+'index.html';await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,html);if(!noindex)routes.push(route);
}
const cardSizes = w => {const r=w.width/w.height;return `(max-width: 599px) min(calc(100vw - 84px), ${410*r}px), (max-width: 999px) min(calc((100vw - 80px) / 2 - 40px), ${290*r}px), (max-width: 1399px) min(calc((100vw - 144px) / 3 - 40px), ${300*r}px), min(379px, ${325*r}px)`;};
const detailSizes = w => {const r=w.width/w.height;return `(max-width: 599px) min(calc(100vw - 72px), ${70*r}vh), (max-width: 799px) min(calc(100vw - 88px), ${70*r}vh), (max-width: 999px) min(calc(100vw - 120px), ${75*r}vh), min(calc(100vw - 144px), 1256px, ${75*r}vh)`;};
function cards(list,eager=3){return `<ul class="grid">${list.map((w,i)=>`<li><a class="art-card" href="/work/${w.slug}/"><figure><div class="art-image">${picture(w,cardSizes(w),i<eager?'eager':'lazy')}</div><figcaption><div><h3>${esc(w.title)}</h3><p>${esc(w.medium)}</p></div><span class="card-arrow" aria-hidden="true">↗</span></figcaption></figure></a></li>`).join('')}</ul>`;}
const featured=works.find(w=>w.slug==='tree-huggers');
await page('/','Portraits of everyday wonder','Children’s portraits in colored pencil, chalk pastel and graphite by Gladstone, Michigan artist Lorna Benson.',`<section class="hero wrap"><div class="hero-copy"><p class="eyebrow">A life in art · Michigan’s Upper Peninsula</p><h1>Everyday moments.<br><em>Lasting wonder.</em></h1><p class="intro">The delight of a small discovery. The warmth of a familiar face. Children’s portraits by Lorna Benson, in colored pencil, chalk pastel and graphite.</p><a class="button" href="/gallery/">Discover the work <span aria-hidden="true">↗</span></a><p class="hero-note">A collection of ${works.length} portraits, made to be looked at closely.</p></div><figure class="hero-art"><a href="/work/${featured.slug}/" aria-label="Explore Tree Huggers">${picture(featured,'(max-width: 599px) calc(100vw - 40px), (max-width: 799px) calc(100vw - 56px), (max-width: 999px) calc(52.83vw - 45.43px), (max-width: 1399px) calc(52.83vw - 71.85px), 668px','eager','','high')}</a><figcaption><span>${esc(featured.title)} <span class="caption-dot">/</span> ${esc(featured.medium)}</span><a href="/work/${featured.slug}/">Look closer ${arrow}</a></figcaption></figure></section><div class="collection-band"><div class="wrap"><span>Kids’ Portraits</span><span>Colored pencil <b>·</b> Chalk pastel <b>·</b> Graphite</span><span>${works.length} works</span></div></div><section class="section wrap" aria-labelledby="selected"><div class="section-heading"><div><p class="eyebrow">From the collection</p><h2 id="selected">Small moments, <em>fully seen.</em></h2></div><a class="text-link" href="/gallery/">View all ${works.length} works ${arrow}</a></div>${cards([works[2],works[0],works[3]],0)}</section><section class="about-teaser wrap"><p class="eyebrow">The artist & the place</p><div><h2>Rooted in Gladstone.<br><em>Connected by art.</em></h2><p>Lorna Benson has called Gladstone, Michigan home for more than 50 years. Her collection turns an attentive eye toward childhood, friendship and everyday life.</p><a class="text-link" href="/about/">Meet the artist ${arrow}</a></div></section>`);
for (const medium of [null,...media]) {
 const list=medium?works.filter(w=>w.medium===medium):works;const route=medium?`/gallery/${mediumSlug(medium)}/`:'/gallery/';
 const filters=[['All works',works.length,'/gallery/'],...media.map(m=>[m[0].toUpperCase()+m.slice(1),works.filter(w=>w.medium===m).length,`/gallery/${mediumSlug(m)}/`])];
 await page(route,medium?`${medium[0].toUpperCase()+medium.slice(1)} portraits`:'The work',`Explore ${list.length} ${medium||'children’s'} ${list.length===1?'portrait':'portraits'} by Lorna Benson. View each artwork in detail.`,`<section class="page-intro wrap"><p class="eyebrow">The collection / Kids’ Portraits</p><h1>${medium?`${esc(medium[0].toUpperCase()+medium.slice(1))}<em> portraits.</em>`:'The joy of <em>being little.</em>'}</h1><p class="intro">${medium?`${list.length} ${list.length===1?'portrait':'portraits'} in ${esc(medium)}, from the Kids’ Portraits collection.`:`A birthday wish, a shared adventure, a quiet smile. ${works.length} portraits of childhood, in three expressive media.`}</p></section><section class="gallery-section wrap" aria-label="Artwork gallery"><nav class="filters" aria-label="Browse by medium">${filters.map(([label,n,url])=>`<a href="${url}" ${url===route?'aria-current="page"':''}>${label} <span>${n}</span></a>`).join('')}</nav><p class="gallery-count">${list.length} ${list.length===1?'work':'works'} <span>· Select a portrait to look closer</span></p><h2 class="visually-hidden">Artworks</h2>${cards(list)}<p class="photo-note">Presented as photographed, including their frames. Every work can be opened at the full resolution of the photograph held in this collection.</p></section>`,'gallery');
}
const sourceURL='https://www.dailypress.net/news/local-news/2019/09/play-mural-unveiled-in-gladstone/';
await page('/about/','About the artist','Meet Gladstone, Michigan artist Lorna Benson, whose children’s portraits explore friendship, family and everyday life.',`<section class="page-intro wrap"><p class="eyebrow">About the artist</p><h1>A sense of place.<br><em>An eye for people.</em></h1></section><section class="about-layout wrap"><div class="about-marker"><span class="monogram" aria-hidden="true">LB</span><p>Lorna Benson<br><span>Artist · Gladstone, Michigan</span></p></div><div class="prose"><h2>Art close to home.</h2><p>Lorna Benson is an artist in Gladstone, in Michigan’s Upper Peninsula. She has lived in the community for more than 50 years.</p><p>The work gathered here celebrates childhood: birthday candles and balloons, fishing trips, close friends and small discoveries. Her children’s portraits use colored pencil, chalk pastel and graphite, each bringing a different texture to a familiar moment.</p><h2>A connection to community.</h2><p>In September 2019, the <cite>Daily Press</cite> reported that Lorna Benson spoke at the unveiling of Gladstone’s “Play” mural, thanking the organizations, businesses and residents who supported the project and its artists.</p><p class="source-note">Community story: <a href="${sourceURL}">“‘Play’ mural unveiled in Gladstone,” <cite>Daily Press</cite>, September 7, 2019 ${arrow}</a>. The mural is a community project; it is not presented here as Lorna’s artwork.</p><section class="contact" id="contact" aria-labelledby="contact-title"><p class="eyebrow">Say hello</p><h2 id="contact-title">Let’s talk about art.</h2><p>For questions about the work, get in touch by email.</p><a class="button" href="mailto:klbenson2261@charter.net">Email Lorna ${arrow}</a><p class="contact-address">klbenson2261@charter.net</p></section></div></section>`,'about');
for(let i=0;i<works.length;i++){
 const w=works[i],previous=works[(i+works.length-1)%works.length],next=works[(i+1)%works.length];
 await page(`/work/${w.slug}/`,w.title,`${w.title}, ${w.medium} artwork by Lorna Benson. See a large photograph and open the original-resolution image.`,`<section class="detail wrap"><a class="back-link" href="/gallery/">← Back to the collection</a><div class="detail-heading"><div><p class="eyebrow">Kids’ Portraits / ${String(i+1).padStart(2,'0')} of ${works.length}</p><h1>${esc(w.title)}</h1></div><p>${esc(w.medium)}<br><span>Lorna Benson</span></p></div><figure class="detail-art">${picture(w,detailSizes(w),'eager','','high')}<figcaption>Photographed in its frame. Displayed without cropping or retouching.</figcaption></figure><div class="original-bar"><div><h2>Take a closer look.</h2><p>Full resolution of the photograph in this collection.<br>JPEG · ${w.width} × ${w.height} pixels · ${Math.round(w.bytes/1024)} KB</p></div><a class="button outline" href="/originals/${w.slug}.jpeg">Open original photograph ${arrow}</a></div><nav class="work-pagination" aria-label="Previous and next artwork"><a href="/work/${previous.slug}/"><span>← Previous work</span>${esc(previous.title)}</a><a href="/work/${next.slug}/"><span>Next work →</span>${esc(next.title)}</a></nav></section>`,'gallery');
}
await page('/404.html','Page not found','Return to Lorna Benson’s art collection.',`<section class="page-intro wrap"><p class="eyebrow">404 / Page not found</p><h1>Let’s find <em>the art.</em></h1><p>This page isn’t in the collection. The artwork is just a click away.</p><a class="button" href="/gallery/">Explore the collection ${arrow}</a></section>`,'',true);
await fs.writeFile(`${out}/sitemap.xml`,`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(r=>`<url><loc>${origin}${r}</loc></url>`).join('')}</urlset>`);
await fs.writeFile(`${out}/robots.txt`,`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
await fs.writeFile(`${out}/favicon.svg`,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="16" fill="#243d32"/><text x="40" y="53" text-anchor="middle" font-family="Georgia,serif" font-size="38" fill="#f6f1e7">LB</text></svg>');
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#f6f1e7"/><path d="M80 90H1120M80 540H1120" stroke="#243d32"/><text x="80" y="230" font-family="Georgia,serif" font-size="85" fill="#243d32">Lorna Benson</text><text x="80" y="350" font-family="Georgia,serif" font-size="48" fill="#243d32">Everyday moments. Lasting wonder.</text><text x="80" y="465" font-family="sans-serif" font-size="25" fill="#984c38">ARTIST · GLADSTONE, MICHIGAN</text></svg>')).png().toFile(`${out}/social.png`);
const iconPng=await sharp(`${out}/favicon.svg`).resize(32,32).png().toBuffer();
const icoHeader=Buffer.alloc(22);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);icoHeader[6]=32;icoHeader[7]=32;icoHeader.writeUInt16LE(1,10);icoHeader.writeUInt16LE(32,12);icoHeader.writeUInt32LE(iconPng.length,14);icoHeader.writeUInt32LE(22,18);await fs.writeFile(`${out}/favicon.ico`,Buffer.concat([icoHeader,iconPng]));
await fs.copyFile('src/_headers',`${out}/_headers`);
await fs.writeFile(`${out}/_redirects`,'/home.html / 301\n');
await fs.writeFile('build-report.json',JSON.stringify({pages:routes.length,artworks:works.length,originalBytes:works.reduce((s,w)=>s+w.bytes,0),derivatives:inventory},null,2));
console.log(`BUILD SUCCESS: ${routes.length} pages, ${works.length} hash-verified originals, ${inventory.length} derivatives; legacy files untouched.`);
