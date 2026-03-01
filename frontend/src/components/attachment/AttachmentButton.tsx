import React, { useState, useRef } from 'react';
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
  const buttonRef = useRef<HTMLButtonElement>(null);

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
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={handleToggleMenu}
        disabled={disabled}
        title="添加附件"
        aria-label="添加附件"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '6px',
          border: 'none',
          background: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          color: 'var(--text-secondary, #aaa)',
          fontSize: '16px',
          transition: 'background-color 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor = 'var(--bg-hover, rgba(255,255,255,0.1))';
            e.currentTarget.style.color = 'var(--text-primary, #fff)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = '';
          e.currentTarget.style.color = 'var(--text-secondary, #aaa)';
        }}
      >
        📎
      </button>

      <AttachmentMenu
        isOpen={isMenuOpen}
        onClose={handleClose}
        onFileSelected={handleFileSelected}
      />
    </div>
  );
};
