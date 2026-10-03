const canonicalOrigin = 'https://lornabenson.com';
const redirectedHostname = 'www.lornabenson.com';

/**
 * Permanently redirects every request for www.lornabenson.com to the same path and query on the
 * canonical apex. This is its own Worker so the apex can be an assets-only Worker: static asset
 * routing cannot match on host, and a Worker that runs first is billed for every asset request.
 */
export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.hostname !== redirectedHostname) {
      // Only the www custom domain should reach this Worker; redirecting any other host to the apex could loop.
      return new Response(`Not served by this Worker: ${url.hostname}\n`, {status: 421});
    }
    return Response.redirect(`${canonicalOrigin}${url.pathname}${url.search}`, 301);
  },
};
