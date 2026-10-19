// Where the backend lives. The page is static (GitHub Pages); the shared ledger,
// files and AI run on a Cloudflare Worker named in <meta name="api-base">.
// Leave it empty to use same-origin /api (e.g. a local dev server with the API).
export const API = (() => {
  const m = document.querySelector('meta[name="api-base"]')?.content?.trim() || '';
  return m && !m.endsWith('/') ? m + '/' : m;
})();
