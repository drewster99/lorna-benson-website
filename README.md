# Lorna Benson — artist portfolio

A warm, accessible, art-first static website for Lorna Benson in Gladstone, Michigan. No client-side JavaScript (the Content Security Policy blocks scripts), tracking, third-party fonts or framework; the only code that runs is a separate server-side Cloudflare Worker that redirects www to the apex domain; the site itself is served as static assets. Works published on the artist’s original **Kids’ Portraits** website keep their titles and media from it. **Water Lily** (watercolor) came from an unpublished upload on the old site; its title and medium are confirmed.

## Develop and build

Use Node.js 22 or newer and npm:

```sh
npm ci --ignore-scripts
npm run build
npm run preview
```

Preview is **http://127.0.0.1:4318**. Set `PORT` if needed. `dist/` is the only deployment output; the builder never modifies `artwork/` or preserved old materials. Sharp uses prebuilt optional packages; keep optional dependencies enabled. Dependencies are exact-pinned with a lockfile. No runtime dependency is downloaded by visitors. The preview server only serves files from `dist/`; it does not apply `_headers`, `_redirects`, the www→apex redirect or Cloudflare’s trailing-slash redirects.

The build produces home, all-works gallery, one gallery per medium, About/contact, one detail page per work, a real 404 page, sitemap, robots, SVG and ICO favicons, security/cache headers, a 301 redirect from the legacy `/home.html` to `/`, and a text-only social preview image (name, tagline and location; no artwork). Navigation and filtering work without JavaScript. On each artwork page, **Open original photograph** deliberately loads the original JPEG; the browser’s image viewer supports native zoom and Back returns to the portfolio.

## Artwork pipeline and editing

- `content/works.json` is the single source of truth: exact title, medium, descriptive alternative text (also shown as each work’s description), stable route slug, source image, expected SHA-256 and `artCorners`. `legacySource` records provenance from the saved old website.
- `artCorners` are the artwork’s four corners in the original photograph (top-left, top-right, bottom-right, bottom-left, in source pixels), placed just inside the mat or paper edge. `scripts/perspective.mjs` straightens that quadrilateral into an upright rectangle, recovering the true proportions from the photo’s perspective (Zhang & He); when the focal length cannot be measured (an edge pair is nearly parallel, or the estimate is implausible) it assumes the 26 mm-equivalent phone lens the photos were taken with. Display images are therefore straightened and trimmed (no frame, wall, glare edges or hands); colors are not retouched. Each detail page still links the untouched original photograph.
- `content/artist.json` holds Lorna’s contact email and her portrait (`photos/lorna-benson.jpeg`, confirmed by family), its SHA-256, alt text and display crop.
- `artwork/` contains byte-identical copies of each work’s `legacySource` photograph from the saved old website (Water Lily’s was an unpublished upload; the others were published there). Original dimensions are 810×1080 or 1440×1080, not invented larger scans.
- `scripts/build.mjs` verifies each original’s SHA-256 and rejects any that still carry EXIF, XMP, IPTC or Photoshop metadata; rejects invalid or duplicate slugs, unsupported media, missing titles or alt text and malformed `artCorners` (`scripts/perspective.mjs` also rejects corners outside the photograph); and checks the portrait’s alt text and crop bounds, the artist email, and that every medium has a cover and a note. It then straightens each artwork from its corners and generates responsive WebP and JPEG derivatives at 360, 640, 960 and 1280 pixels wide plus the straightened image’s full width, skipping any wider than that. Straightening restores true proportions, so a foreshortened side can come out somewhat larger than it appears in the photograph; derivatives are never enlarged beyond the straightened image. sRGB conversion, no color retouching, stripped derivative metadata. Per-work proportions are emitted into the hashed stylesheet (the CSP forbids inline styles) to drive the justified gallery walls.
- Responsive `picture/srcset/sizes`, explicit dimensions and below-fold lazy loading reduce payload and reserve layout space. Hashed derivative/style filenames use immutable caching. Original links are same-origin and only downloaded when chosen.
- To add/change a work: obtain publishable title/medium and approved photograph, inspect privacy metadata, add source and update its SHA-256 (`shasum -a 256 artwork/filename.jpeg`), add accurate alt text, measure `artCorners` on the photo, build and check the straightened result for edge slivers. For a new medium, also add it to `media`, `mediumCovers` and `mediumNotes` in `scripts/build.mjs`, and to the About page’s “Ways of seeing” paragraph. Do not replace the originals with resized images.
- `src/style.css` controls the design; `src/_headers` carries HSTS (one year, apex only), CSP, permissions, referrer and caching policies. Templates and route generation live in the builder. `build-report.json` records generated sizes locally and is ignored.

## Cloudflare

Two Workers, both declared in the repo. The assets-only Worker `lorna-benson-website` (`wrangler.jsonc`) serves `dist/` on the custom domain `lornabenson.com`; no Worker script runs for site requests, so they are free and never count against the Workers request limit. The Worker `lorna-benson-www-redirect` (`wrangler.www-redirect.jsonc`, `worker/www-redirect.mjs`) owns `www.lornabenson.com` and 301-redirects it to the same path and query on `https://lornabenson.com`; it is separate because static asset routing cannot match on host, and running a script before assets would bill every asset request. workers.dev and preview URLs are disabled on both. Besides the two Worker records, the DNS zone holds only “this domain sends and receives no email” records, added 2026-10-03: null MX (`0 .`), SPF `v=spf1 -all`, a revoked DKIM wildcard (`*._domainkey` `v=DKIM1; p=`) and DMARC `p=reject` with strict alignment. The old cPanel/Namecheap web and mail records were removed on 2026-10-02.

### Continuous deployment: Workers Builds (not connected yet)

1. Cloudflare dashboard → Workers & Pages → `lorna-benson-website` → Settings → Builds → Connect; choose the public GitHub repository `drewster99/lorna-benson-website`, branch `main`. The Worker name must match `name` in `wrangler.jsonc` or the build fails.
2. Root directory: repository root. Node version: **22** (set `NODE_VERSION=22` if needed).
3. Build command: `npm ci --ignore-scripts && npm run build`.
4. Deploy command: `npx wrangler deploy` (Wrangler is pinned in devDependencies; install devDependencies during build). This deploys only `lorna-benson-website`; never use `npm run deploy` here, because Builds forces the Worker name and would upload the redirect Worker over the site. Deploy the redirect Worker manually (`npx wrangler deploy --config wrangler.www-redirect.jsonc`) when its code or config changes.
5. `wrangler.jsonc` names `lorna-benson-website` and is assets-only (no `main`, no binding, no `run_worker_first`): Cloudflare applies `_headers`, `_redirects`, trailing-slash handling and the 404 page directly. No secrets are required. Connect the build trigger for pushes to main.
6. Custom domains come from `routes` in each config; `wrangler deploy` creates their DNS records and removes any custom domain no longer listed for that Worker. Outside an interactive terminal it also silently takes over a hostname held by another Worker, so never list `www.lornabenson.com` in `wrangler.jsonc`. The canonical URLs use `https://lornabenson.com`.

Local configuration validation without deployment/authentication:

```sh
npm run check:deploy
```

Manual authenticated deployment, only when desired: `npm run deploy` (redirect Worker first, then the site; the order matters).

## Biography, sources and privacy

The old site had **no About the Artist** section. Hometown and residence of more than 50 years were supplied by Lorna’s family. The About write-up uses only those facts, the independent source below, and what is visible in the works themselves (subjects, media, her LKB initials); nothing else is invented:

- Clarissa Kell, Daily Press, September 7, 2019: [“‘Play’ mural unveiled in Gladstone”](https://www.dailypress.net/news/local-news/2019/09/play-mural-unveiled-in-gladstone/). Reports Lorna speaking at the unveiling and thanking community supporters. It does **not** establish that she created the mural; no such claim is made.

No verifiable additional awards, training or exhibition history was found in the regional search. Portrait subjects are not newly identified beyond legacy titles. The old public artist email (`content/artist.json`) is shown in the site footer and the About contact section; street addresses, phone, private biography and people-finder data are not published. A text-only sharing preview (no artwork) avoids amplifying a child’s portrait. Contact availability should be reviewed by Lorna if the old email changes.

Preserved legacy `home.html`, `images.json`, `Home.webarchive`, `gallery/` and `out/` remain local and ignored. Audit, backups, CLI reviews and browser-test evidence are retained outside the repository in AgentSmith task evidence, never deployed. The artist photograph (`gallery/DSC_0030…`) was confirmed by family as Lorna and is published on Home and About. The uncaptioned watercolor (`gallery/IMG_3099…`) is published as “Water Lily” (watercolor); title and medium confirmed by the owner. Unrelated template assets were not published. The 2016–2019 lornabenson.com (“Medieval Romances”) is not confirmed to be the same person and is not referenced.

## Quality checks

Run `npm audit` and `npm run check:deploy`. Review actual browsers at narrow phone, phone, tablet and laptop sizes; test the skip link, all medium filters, previous/next artwork, original image and email links. Check zoom, reduced motion, no horizontal overflow, contrast and useful image alternatives. No build command claims a live domain is deployed.

After a deploy, spot-check live headers and redirects:

```sh
curl -sI https://lornabenson.com/ | grep -iE 'content-security-policy|strict-transport-security'
curl -sI https://www.lornabenson.com/gallery/   # 301 → https://lornabenson.com/gallery/
curl -sI https://lornabenson.com/home.html      # 301 → /
```

## Rights

All artwork rights reserved by Lorna Benson. Public repository access is not a grant to reproduce or reuse artwork. No permissive artwork license is added.
