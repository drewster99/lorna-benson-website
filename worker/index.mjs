const canonicalHost = 'lornabenson.com';
const wwwHost = `www.${canonicalHost}`;

/**
 * Serves the static site from `dist/`, permanently redirecting the www host to the canonical
 * apex so each page has exactly one public address. Static asset routing cannot match on host,
 * which is why this runs before the asset handler.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === wwwHost) {
      url.hostname = canonicalHost;
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
