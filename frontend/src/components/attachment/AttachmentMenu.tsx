import React, { useRef, useEffect } from 'react';

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

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        bottom: '100%',
        right: 0,
        marginBottom: '8px',
        backgroundColor: 'var(--bg-secondary, #2a2a2a)',
        border: '1px solid var(--border-color, #444)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        overflow: 'hidden',
        zIndex: 1000,
        minWidth: '160px',
      }}
    >
      {/* Browse files (all platforms) */}
      <button
        onClick={() => fileInputRef.current?.click()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          padding: '10px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-primary, #fff)',
          fontSize: '14px',
          textAlign: 'left',
        }}
      >
        📁 浏览文件
      </button>

      {/* Camera capture (mobile only) */}
      {mobile && (
        <button
          onClick={() => cameraInputRef.current?.click()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '10px 16px',
            background: 'none',
            border: 'none',
            borderTop: '1px solid var(--border-color, #444)',
            cursor: 'pointer',
            color: 'var(--text-primary, #fff)',
            fontSize: '14px',
            textAlign: 'left',
          }}
        >
          📷 拍照上传
        </button>
      )}

      {/* Photo library (mobile only) */}
      {mobile && (
        <button
          onClick={() => photoInputRef.current?.click()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '10px 16px',
            background: 'none',
            border: 'none',
            borderTop: '1px solid var(--border-color, #444)',
            cursor: 'pointer',
            color: 'var(--text-primary, #fff)',
            fontSize: '14px',
            textAlign: 'left',
          }}
        >
          🖼️ 相册选择
        </button>
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
};
