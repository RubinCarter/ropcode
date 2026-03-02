import React, { useState, useRef } from 'react';
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);

  const instances = getInstances();
  const currentOrigin = window.location.origin;
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

  const handleAdd = () => {
    const trimmedUrl = newUrl.trim();
    if (!trimmedUrl) return;

    try {
      new URL(trimmedUrl);
    } catch {
      return;
    }

    addInstance(trimmedUrl, newLabel.trim() || undefined);
    setNewUrl('');
    setNewLabel('');
    setShowAddForm(false);
  };

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    removeInstance(id);
  };

  const handleSwitch = (instance: RopcodeInstance) => {
    if (instance.url === currentOrigin) return;
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

  const handleShowAddForm = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowAddForm(true);
    // Focus input after a small delay to ensure DOM is ready
    setTimeout(() => urlInputRef.current?.focus(), 50);
  };

  return (
    <DropdownMenu>
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
            onClick={handleShowAddForm}
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
