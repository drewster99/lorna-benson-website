# lornabenson.com — decisions

Decisions made by Andrew (site owner). Follow them; change only with his explicit consent. See README.md for build/pipeline details.

- **Hosting:** Cloudflare Worker `lorna-benson-website` serving `dist/` as static assets. `lornabenson.com` and `www.lornabenson.com` are Worker custom domains declared in `wrangler.jsonc`; workers.dev and preview URLs are off. The Cloudflare DNS zone contains no other records (old Namecheap cPanel web/mail records were deleted 2026-10-02; backup at `../lornabenson.com-dns-backup-2026-10-02.txt`).
- **No email on the domain:** lornabenson.com has no mailboxes; mail records were removed deliberately.
- **Artwork display is cropped:** each work is shown straightened and trimmed out of its frame/wall photo using `artCorners` in `content/works.json`. Originals in `artwork/` stay byte-identical and are linked from every detail page.
- **Artist photo:** `photos/lorna-benson.jpeg` is Lorna (confirmed). Use it on Home and About.
- **Biography uses known facts only:** Gladstone, Michigan, 50+ years; the 2019 Daily Press “Play” mural story; and what is visible in the works. Do not invent training, awards, quotes or history. The 2016–2019 “Medieval Romances” lornabenson.com is not confirmed to be her; do not reference it.
- **Removed copy:** the About-page note “The artist’s hometown and length of residence were provided by her family. Artwork titles and media are retained from her original website.” must not return.
- **Public repo:** `drewster99/lorna-benson-website` is public (`__PUBLIC_REPO`).
