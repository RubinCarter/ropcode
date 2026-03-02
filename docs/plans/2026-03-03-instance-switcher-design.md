# Instance Switcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to switch between multiple Ropcode instances (local + remote) by clicking the `:port` badge in the titlebar.

**Architecture:** A Popover-based dropdown (using Radix DropdownMenu) replaces the static `:port` span. Instance list is persisted in localStorage. Switching navigates via `window.location.href`. Instance list is synced across origins via URL parameter on navigation.

**Tech Stack:** React, Radix UI DropdownMenu, localStorage, Zustand-free (pure localStorage + React state)

---

### Task 1: Create instance storage utility

**Files:**
- Create: `frontend/src/lib/instanceStore.ts`

**Step 1: Create the instance store module**

```typescript
// frontend/src/lib/instanceStore.ts

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
      // Filter out any stale local entries, re-add current local
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
  // Normalize URL: remove trailing slash
  const normalizedUrl = url.replace(/\/+$/, '');
  // Derive label from URL if not provided
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
  // Encode remote instances only (target will build its own local)
  const remotes = instances.filter((i) => !i.isLocal);
  const targetUrl = new URL(instance.url);
  if (remotes.length > 0) {
    targetUrl.searchParams.set(URL_PARAM_KEY, btoa(JSON.stringify(remotes)));
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

    // Merge: add any instances we don't already have
    let merged = [...current];
    for (const inst of incoming) {
      if (!currentUrls.has(inst.url)) {
        merged.push({ ...inst, isLocal: false });
      }
    }
    saveInstances(merged);

    // Clean the URL param without triggering navigation
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete(URL_PARAM_KEY);
    window.history.replaceState({}, '', cleanUrl.toString());
  } catch {
    // ignore errors
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/lib/instanceStore.ts
git commit -m "feat: add instance storage utility for multi-instance switching"
```

---

### Task 2: Create InstanceSwitcher dropdown component

**Files:**
- Create: `frontend/src/components/InstanceSwitcher.tsx`

**Step 1: Create the component**

```tsx
// frontend/src/components/InstanceSwitcher.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Check, Plus, X, Server } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getInstances,
  addInstance,
  removeInstance,
  switchToInstance,
  type RopcodeInstance,
} from '@/lib/instanceStore';

export const InstanceSwitcher: React.FC = () => {
  const [instances, setInstances] = useState<RopcodeInstance[]>(() => getInstances());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [open, setOpen] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const currentOrigin = window.location.origin;
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

  // Refresh instances when dropdown opens
  useEffect(() => {
    if (open) {
      setInstances(getInstances());
    } else {
      // Reset form when dropdown closes
      setShowAddForm(false);
      setNewUrl('');
      setNewLabel('');
    }
  }, [open]);

  // Auto-focus URL input when add form appears
  useEffect(() => {
    if (showAddForm && urlInputRef.current) {
      // Small delay to ensure the DOM has rendered
      setTimeout(() => urlInputRef.current?.focus(), 50);
    }
  }, [showAddForm]);

  const handleAdd = () => {
    const trimmedUrl = newUrl.trim();
    if (!trimmedUrl) return;

    // Basic URL validation
    try {
      new URL(trimmedUrl);
    } catch {
      return; // Invalid URL, do nothing
    }

    const updated = addInstance(trimmedUrl, newLabel.trim() || undefined);
    setInstances(updated);
    setNewUrl('');
    setNewLabel('');
    setShowAddForm(false);
  };

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const updated = removeInstance(id);
    setInstances(updated);
  };

  const handleSwitch = (instance: RopcodeInstance) => {
    if (instance.url === currentOrigin) return; // Already on this instance
    switchToInstance(instance);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowAddForm(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="text-[11px] text-muted-foreground font-mono px-2.5 py-1.5 rounded-md bg-accent/50 border border-border/50 hover:bg-accent/80 transition-colors window-no-drag cursor-pointer"
        >
          :{port}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 window-no-drag">
        {instances.map((instance) => {
          const isCurrent = instance.url === currentOrigin;
          return (
            <DropdownMenuItem
              key={instance.id}
              onClick={() => handleSwitch(instance)}
              className="flex items-center justify-between gap-2 cursor-pointer"
              disabled={isCurrent}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isCurrent ? (
                  <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                ) : (
                  <Server className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-sm truncate">{instance.label}</span>
              </div>
              {!instance.isLocal && (
                <button
                  onClick={(e) => handleRemove(e, instance.id)}
                  className="p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors flex-shrink-0"
                  title="Remove instance"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        {!showAddForm ? (
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              setShowAddForm(true);
            }}
            className="cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 mr-2" />
            <span className="text-sm">Add Instance</span>
          </DropdownMenuItem>
        ) : (
          <div className="p-2 space-y-2" onClick={(e) => e.stopPropagation()}>
            <input
              ref={urlInputRef}
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="http://192.168.1.100:5173"
              className="flex h-8 w-full rounded-md border px-2 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 bg-transparent"
              style={{
                borderColor: 'var(--color-input)',
                color: 'var(--color-foreground)',
              }}
            />
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Name (optional)"
              className="flex h-8 w-full rounded-md border px-2 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 bg-transparent"
              style={{
                borderColor: 'var(--color-input)',
                color: 'var(--color-foreground)',
              }}
            />
            <button
              onClick={handleAdd}
              disabled={!newUrl.trim()}
              className="w-full h-7 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add
            </button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
```

**Step 2: Commit**

```bash
git add frontend/src/components/InstanceSwitcher.tsx
git commit -m "feat: add InstanceSwitcher dropdown component"
```

---

### Task 3: Integrate InstanceSwitcher into CustomTitlebar

**Files:**
- Modify: `frontend/src/components/CustomTitlebar.tsx:549-553`

**Step 1: Replace static port badge with InstanceSwitcher**

In `CustomTitlebar.tsx`, add import at top:
```typescript
import { InstanceSwitcher } from '@/components/InstanceSwitcher';
```

Replace lines 549-553 (the static port span):
```tsx
{/* Port indicator */}
{typeof window !== 'undefined' && window.location.port && (
  <span className="text-[11px] text-muted-foreground font-mono px-2.5 py-1.5 rounded-md bg-accent/50 border border-border/50">
    :{window.location.port}
  </span>
)}
```

With:
```tsx
{/* Instance Switcher (port indicator + dropdown) */}
{typeof window !== 'undefined' && window.location.port && (
  <InstanceSwitcher />
)}
```

**Step 2: Commit**

```bash
git add frontend/src/components/CustomTitlebar.tsx
git commit -m "feat: replace static port badge with InstanceSwitcher in titlebar"
```

---

### Task 4: Integrate InstanceSwitcher into MobileHeader

**Files:**
- Modify: `frontend/src/components/mobile/MobileHeader.tsx:17-24`

**Step 1: Replace static port display with InstanceSwitcher**

Add import:
```typescript
import { InstanceSwitcher } from '@/components/InstanceSwitcher';
```

Replace lines 22-24:
```tsx
{port && (
  <span className="text-xs text-muted-foreground font-mono">:{port}</span>
)}
```

With:
```tsx
{port && <InstanceSwitcher />}
```

Remove the unused `port` variable (line 17):
```typescript
const port = typeof window !== 'undefined' ? window.location.port : '';
```

Keep it since `InstanceSwitcher` rendering is still gated by `port &&`.

**Step 2: Commit**

```bash
git add frontend/src/components/mobile/MobileHeader.tsx
git commit -m "feat: add InstanceSwitcher to mobile header"
```

---

### Task 5: Merge instances from URL on page load

**Files:**
- Modify: `frontend/src/App.tsx:22` (top-level initialization section)

**Step 1: Add URL merge call**

Add import at top of App.tsx:
```typescript
import { mergeInstancesFromUrl } from '@/lib/instanceStore';
```

Add call after the existing `urlParams` parsing (around line 22), before any other code:
```typescript
// Merge instance list from URL params (for cross-origin sync)
mergeInstancesFromUrl();
```

**Step 2: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: merge instance list from URL on page load"
```

---

### Task 6: Test manually

**Step 1: Start the dev server and verify**

Run: `cd frontend && npm run dev`

Verify:
1. The `:port` badge in the titlebar is now clickable
2. Clicking it shows a dropdown with "Local (:5174)" checked
3. Clicking "Add Instance" shows the inline form
4. Adding a URL (e.g. `http://localhost:5173`) adds it to the list
5. Clicking a remote instance navigates to that URL
6. The `?instances=` param is present in the target URL
7. Refreshing removes the `?instances=` param (cleaned up)
8. Remote instances have an X button to delete
9. Local instance has no X button

**Step 2: Final commit**

If any fixes were needed, commit them.
