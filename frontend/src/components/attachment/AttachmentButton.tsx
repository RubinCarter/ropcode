import React, { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AttachmentMenu } from './AttachmentMenu';

interface AttachmentButtonProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

export const AttachmentButton: React.FC<AttachmentButtonProps> = ({
  onFileSelected,
  disabled = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleToggleMenu = () => {
    if (!disabled) {
      setIsMenuOpen((prev) => !prev);
    }
  };

  const handleClose = () => {
    setIsMenuOpen(false);
  };

  const handleFileSelected = (file: File) => {
    setIsMenuOpen(false);
    onFileSelected(file);
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggleMenu}
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

      <AttachmentMenu
        isOpen={isMenuOpen}
        onClose={handleClose}
        onFileSelected={handleFileSelected}
      />
    </div>
  );
};
