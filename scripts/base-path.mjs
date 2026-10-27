export function normalizeBasePath(value = '/') {
  if (!/^\/[a-zA-Z0-9._~%/-]*$/.test(value)) {
    throw new Error('Base path must be a URL path such as / or /studio/.');
  }
  const parts = value.split('/').filter(Boolean);
  if (parts.some(part => ['.', '..'].includes(decodeURIComponent(part)))) {
    throw new Error('Base path cannot contain . or .. segments.');
  }
  return parts.length ? `/${parts.join('/')}/` : '/';
}

// Rewrite URL prefixes only in deployment copies. Keep the audited source files
// unchanged, including the runtime's frozen preview programs and their order.
export function localizeAssetPaths(source, basePath) {
  return source.replaceAll('/creator-prototype/assets/', `${normalizeBasePath(basePath)}creator-prototype/assets/`);
}
