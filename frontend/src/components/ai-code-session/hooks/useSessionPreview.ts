import { useCallback, useState } from 'react';

export interface UseSessionPreviewReturn {
  showPreview: boolean;
  previewUrl: string;
  showPreviewPrompt: boolean;
  splitPosition: number;
  setSplitPosition: (position: number) => void;
  isPreviewMaximized: boolean;
  handleLinkDetected: (url: string) => void;
  handleClosePreview: () => void;
  handlePreviewUrlChange: (url: string) => void;
  handleTogglePreviewMaximize: () => void;
}

export function useSessionPreview(): UseSessionPreviewReturn {
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [showPreviewPrompt, setShowPreviewPrompt] = useState(false);
  const [splitPosition, setSplitPosition] = useState(33);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);

  const handleLinkDetected = useCallback((url: string) => {
    if (!showPreview && !showPreviewPrompt) {
      setPreviewUrl(url);
      setShowPreviewPrompt(true);
    }
  }, [showPreview, showPreviewPrompt]);

  const handleClosePreview = useCallback(() => {
    setShowPreview(false);
    setIsPreviewMaximized(false);
  }, []);

  const handlePreviewUrlChange = useCallback((url: string) => {
    setPreviewUrl(url);
  }, []);

  const handleTogglePreviewMaximize = useCallback(() => {
    setIsPreviewMaximized(!isPreviewMaximized);
    if (isPreviewMaximized) {
      setSplitPosition(50);
    }
  }, [isPreviewMaximized]);

  return {
    showPreview,
    previewUrl,
    showPreviewPrompt,
    splitPosition,
    setSplitPosition,
    isPreviewMaximized,
    handleLinkDetected,
    handleClosePreview,
    handlePreviewUrlChange,
    handleTogglePreviewMaximize,
  };
}
