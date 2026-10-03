# Lorna Benson — artist portfolio

A warm, accessible, art-first static website for Lorna Benson in Gladstone, Michigan. No runtime JavaScript, tracking, third-party fonts or framework. The 16 works and their titles/media are retained from the artist’s original **Kids’ Portraits** website.

## Develop and build

Use Node.js 22 or newer and npm:

```sh
npm ci --ignore-scripts
npm run build
npm run preview
```

Preview is **http://127.0.0.1:4318**. Set `PORT` if needed. `dist/` is the only deployment output; the builder never modifies `artwork/` or preserved old materials. Sharp uses prebuilt optional packages; keep optional dependencies enabled. Dependencies are exact-pinned with a lockfile. No runtime dependency is downloaded by visitors.

The build produces home, all-works gallery, three medium galleries, About/contact, sixteen detail pages, a real 404 page, sitemap, robots, security/cache headers and a name-only social preview. Navigation and filtering work without JavaScript. On each artwork page, **Open original photograph** deliberately loads the original JPEG; the browser’s image viewer supports native zoom and Back returns to the portfolio.

## Artwork pipeline and editing

- `content/works.json` is the single source of truth: exact title, medium, descriptive alternative text (also shown as each work’s description), stable route slug, source image, expected SHA-256 and `artCorners`. `legacySource` records provenance from the saved old website.
- `artCorners` are the artwork’s four corners in the original photograph (top-left, top-right, bottom-right, bottom-left, in source pixels), placed just inside the mat or paper edge. `scripts/perspective.mjs` straightens that quadrilateral into an upright rectangle, recovering the true proportions from the photo’s perspective (Zhang & He); when only one edge pair converges it assumes the 26 mm-equivalent phone lens the photos were taken with. Display images are therefore straightened and trimmed (no frame, wall, glare edges or hands); colors are not retouched. Each detail page still links the untouched original photograph.
- `content/artist.json` holds Lorna’s portrait (`photos/lorna-benson.jpeg`, confirmed by family), its SHA-256, alt text and display crop.
- `artwork/` contains byte-identical copies of the 16 previously published JPEG photographs. Original dimensions are 810×1080 or 1440×1080, not invented larger scans.
- `scripts/build.mjs` verifies source checksums and metadata, rejects invalid/duplicate slugs, unsupported media and missing alt text, rectifies each artwork from its corners, then generates responsive WebP and JPEG derivatives at 360, 640, 960, 1280 and native widths as appropriate. Never upscales. sRGB conversion, no color retouching, stripped derivative metadata. Per-work proportions are emitted into the hashed stylesheet (the CSP forbids inline styles) to drive the justified gallery walls.
- Responsive `picture/srcset/sizes`, explicit dimensions and below-fold lazy loading reduce payload and reserve layout space. Hashed derivative/style filenames use immutable caching. Original links are same-origin and only downloaded when chosen.
- To add/change a work: obtain publishable title/medium and approved photograph, inspect privacy metadata, add source and update its SHA-256 (`shasum -a 256 artwork/filename.jpeg`), add accurate alt text, measure `artCorners` on the photo, build and check the straightened result for edge slivers. Do not replace the originals with resized images.
- `src/style.css` controls the design; `src/_headers` carries CSP, permissions, referrer and caching policies. Templates and route generation live in the builder. `build-report.json` records generated sizes locally and is ignored.

## Cloudflare — connect after GitHub push

The Worker `lorna-benson-website` is deployed and serves `lornabenson.com` and `www.lornabenson.com` as custom domains declared in `wrangler.jsonc`. The workers.dev URL and preview URLs are disabled. The DNS zone holds no other records: the old cPanel/Namecheap web and mail records were removed on 2026-10-02.

### Recommended: Workers Builds + static assets

1. Cloudflare dashboard → Workers & Pages → create/import a Worker from the public GitHub repository `drewster99/lorna-benson-website`, branch `main`.
2. Root directory: repository root. Node version: **22** (set `NODE_VERSION=22` if needed).
3. Build command: `npm ci --ignore-scripts && npm run build`.
4. Deploy command: `npx wrangler deploy` (Wrangler is pinned in devDependencies; install devDependencies during build).
5. `wrangler.jsonc` names `lorna-benson-website`, serves `./dist` assets with trailing-slash HTML handling and real 404 handling. No worker JavaScript or secrets are required. Connect the build trigger for pushes to main.
6. Custom domains come from `routes` in `wrangler.jsonc`; `wrangler deploy` creates their DNS records. The canonical URLs use `https://lornabenson.com`.

Local configuration validation without deployment/authentication:

```sh
npm run check:deploy
```

Manual authenticated deployment, only when desired: `npm run deploy`.

### Alternative: Cloudflare Pages Git integration

Import the same repository, framework preset **None**, build command `npm ci --ignore-scripts && npm run build`, build output **dist**, root directory blank, Node 22. Pages can use generated `_headers`, `_redirects`, sitemap and `404.html`. The checked-in Wrangler configuration is for Workers static assets; Pages’ dashboard output setting is `dist` (do not deploy the repository root or old `out/`).

## Biography, sources and privacy

The old site had **no About the Artist** section. Hometown and residence of more than 50 years were supplied by Lorna’s family. The About write-up uses only those facts, the independent source below, and what is visible in the works themselves (subjects, media, her LKB initials); nothing else is invented:

- Clarissa Kell, Daily Press, September 7, 2019: [“‘Play’ mural unveiled in Gladstone”](https://www.dailypress.net/news/local-news/2019/09/play-mural-unveiled-in-gladstone/). Reports Lorna speaking at the unveiling and thanking community supporters. It does **not** establish that she created the mural; no such claim is made.

No verifiable additional awards, training or exhibition history was found in the regional search. Portrait subjects are not newly identified beyond legacy titles. The old public artist email is reused; street addresses, phone, private biography and people-finder data are not published. A name-only sharing preview avoids amplifying a child’s portrait. Contact availability should be reviewed by Lorna if the old email changes.

Preserved legacy `home.html`, `images.json`, `Home.webarchive`, `gallery/` and `out/` remain local and ignored. Audit, backups, CLI reviews and browser-test evidence are retained outside the repository in AgentSmith task evidence, never deployed. The artist photograph (`gallery/DSC_0030…`) was confirmed by family as Lorna and is published on Home and About. The uncaptioned watercolor flower (`gallery/IMG_3099…`) and unrelated template assets were not published. The 2016–2019 lornabenson.com (“Medieval Romances”) is not confirmed to be the same person and is not referenced.

## Quality checks

Run `npm audit` and `npm run check:deploy`. Review actual browsers at narrow phone, phone, tablet and laptop sizes; test the skip link, all medium filters, previous/next artwork, original image and email links. Check zoom, reduced motion, no horizontal overflow, contrast and useful image alternatives. No build command claims a live domain is deployed.

## Rights

All artwork rights reserved by Lorna Benson. Public repository access is not a grant to reproduce or reuse artwork. No permissive artwork license is added.
