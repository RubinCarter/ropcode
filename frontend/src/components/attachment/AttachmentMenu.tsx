import React, { useRef, useEffect } from 'react';
import { FolderOpen, Camera, Image } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AttachmentMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelected: (file: File) => void;
}

const isMobile = (): boolean => {
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  );
};

export const AttachmentMenu: React.FC<AttachmentMenuProps> = ({
  isOpen,
  onClose,
  onFileSelected,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const mobile = isMobile();

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
    onClose();
  };

  if (!isOpen) return null;

  const menuItemClass = cn(
    'flex items-center gap-2 w-full px-3 py-2 text-sm text-left',
    'text-foreground hover:bg-accent hover:text-accent-foreground',
    'transition-colors cursor-pointer border-none bg-transparent',
  );

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full right-0 mb-2 z-50 min-w-40 overflow-hidden rounded-md border border-border bg-popover shadow-md"
    >
      {/* Browse files (all platforms) */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className={menuItemClass}
      >
        <FolderOpen className="h-4 w-4 shrink-0" />
        浏览文件
      </button>

      {/* Camera capture (mobile only) */}
      {mobile && (
        <button
          onClick={() => cameraInputRef.current?.click()}
          className={cn(menuItemClass, 'border-t border-border')}
        >
          <Camera className="h-4 w-4 shrink-0" />
          拍照上传
        </button>
      )}

      {/* Photo library (mobile only) */}
      {mobile && (
        <button
          onClick={() => photoInputRef.current?.click()}
          className={cn(menuItemClass, 'border-t border-border')}
        >
          <Image className="h-4 w-4 shrink-0" />
          相册选择
        </button>
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
};
