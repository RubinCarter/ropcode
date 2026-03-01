import React, { useState, useRef } from 'react';
import { Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AttachmentMenu } from './AttachmentMenu';

interface AttachmentButtonProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

const isMobile = (): boolean => {
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hasTouchScreen = window.matchMedia('(hover: none)').matches;
  const isMobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  return (hasCoarsePointer && hasTouchScreen) || isMobileUA;
};

export const AttachmentButton: React.FC<AttachmentButtonProps> = ({
  onFileSelected,
  disabled = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const mobileFileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (disabled) return;
    if (isMobile()) {
      // On mobile, let the OS native picker handle everything
      mobileFileInputRef.current?.click();
    } else {
      setIsMenuOpen((prev) => !prev);
    }
  };

  const handleMobileFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = '';
  };

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={disabled}
        title="添加附件"
        aria-label="添加附件"
        className={cn(
          'inline-flex items-center justify-center h-8 w-8 rounded-md text-sm font-medium transition-colors',
          'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <Paperclip className="h-3.5 w-3.5" />
      </button>

      {/* Mobile: single hidden input, OS handles picker natively */}
      <input
        ref={mobileFileInputRef}
        type="file"
        accept="*/*"
        className="hidden"
        onChange={handleMobileFileChange}
      />

      {/* Desktop: custom menu */}
      <AttachmentMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onFileSelected={(file) => {
          setIsMenuOpen(false);
          onFileSelected(file);
        }}
      />
    </div>
  );
};
