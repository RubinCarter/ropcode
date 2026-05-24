import { useCallback, useEffect, useRef, useState } from 'react';

interface UseProviderApiSwitchNoticeOptions {
  isLoading: boolean;
}

export interface UseProviderApiSwitchNoticeReturn {
  notice: string | null;
  dismissNotice: () => void;
  showNotice: (configName: string) => void;
}

export function useProviderApiSwitchNotice({
  isLoading,
}: UseProviderApiSwitchNoticeOptions): UseProviderApiSwitchNoticeReturn {
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((configName: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    setNotice(configName);
    timerRef.current = setTimeout(() => {
      setNotice(null);
      timerRef.current = null;
    }, 8000);
  }, []);

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  useEffect(() => {
    if (isLoading || !notice) {
      return;
    }

    setNotice(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [isLoading, notice]);

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  return {
    notice,
    dismissNotice,
    showNotice,
  };
}
