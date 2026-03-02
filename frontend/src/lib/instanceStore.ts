const STORAGE_KEY = 'ropcode_instances';
const URL_PARAM_KEY = 'instances';

export interface RopcodeInstance {
  id: string;
  label: string;
  url: string;
  isLocal: boolean;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Build the local instance from current window.location */
function buildLocalInstance(): RopcodeInstance {
  const origin = window.location.origin;
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
  return {
    id: 'local',
    label: `Local (:${port})`,
    url: origin,
    isLocal: true,
  };
}

/** Read instances from localStorage, always ensuring local instance exists */
export function getInstances(): RopcodeInstance[] {
  const local = buildLocalInstance();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved: RopcodeInstance[] = JSON.parse(raw);
      const remotes = saved.filter((i) => !i.isLocal);
      return [local, ...remotes];
    }
  } catch {
    // ignore parse errors
  }
  return [local];
}

/** Save instances to localStorage (always includes local) */
function saveInstances(instances: RopcodeInstance[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(instances));
  } catch {
    // storage full or unavailable
  }
}

/** Add a remote instance. Returns the updated list. */
export function addInstance(url: string, label?: string): RopcodeInstance[] {
  const instances = getInstances();
  const normalizedUrl = url.replace(/\/+$/, '');
  const derivedLabel = label || (() => {
    try {
      const u = new URL(normalizedUrl);
      return u.host;
    } catch {
      return normalizedUrl;
    }
  })();
  const newInstance: RopcodeInstance = {
    id: generateId(),
    label: derivedLabel,
    url: normalizedUrl,
    isLocal: false,
  };
  const updated = [...instances, newInstance];
  saveInstances(updated);
  return updated;
}

/** Remove a remote instance by id. Returns the updated list. */
export function removeInstance(id: string): RopcodeInstance[] {
  const instances = getInstances();
  const updated = instances.filter((i) => i.id !== id || i.isLocal);
  saveInstances(updated);
  return updated;
}

/** Get the current instance (matching window.location.origin) */
export function getCurrentInstance(): RopcodeInstance {
  return buildLocalInstance();
}

/**
 * Navigate to a different instance.
 * Encodes the full instance list into the target URL as a query param
 * so the target page can merge it into its own localStorage.
 */
export function switchToInstance(instance: RopcodeInstance): void {
  const instances = getInstances();
  // Collect all instances except the target, marking them as remote
  const toPass = instances
    .filter((i) => i.url !== instance.url)
    .map((i) => ({ ...i, isLocal: false }));
  const targetUrl = new URL(instance.url);
  if (toPass.length > 0) {
    targetUrl.searchParams.set(URL_PARAM_KEY, btoa(JSON.stringify(toPass)));
  }
  window.location.href = targetUrl.toString();
}

/**
 * On page load, check URL for instance list param and merge into localStorage.
 * Call this once in App.tsx initialization.
 */
export function mergeInstancesFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get(URL_PARAM_KEY);
    if (!encoded) return;

    const incoming: RopcodeInstance[] = JSON.parse(atob(encoded));
    const current = getInstances();
    const currentUrls = new Set(current.map((i) => i.url));

    let merged = [...current];
    for (const inst of incoming) {
      if (!currentUrls.has(inst.url)) {
        merged.push({ ...inst, isLocal: false });
      }
    }
    saveInstances(merged);

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete(URL_PARAM_KEY);
    window.history.replaceState({}, '', cleanUrl.toString());
  } catch {
    // ignore errors
  }
}
