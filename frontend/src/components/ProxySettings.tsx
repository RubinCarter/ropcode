import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useTranslation } from 'react-i18next';

export interface ProxySettings {
  http_proxy: string | null;
  https_proxy: string | null;
  no_proxy: string | null;
  all_proxy: string | null;
  enabled: boolean;
}

interface ProxySettingsProps {
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  onChange?: (hasChanges: boolean, getSettings: () => ProxySettings, saveSettings: () => Promise<void>) => void;
}

export function ProxySettings({ setToast, onChange }: ProxySettingsProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ProxySettings>({
    http_proxy: null,
    https_proxy: null,
    no_proxy: null,
    all_proxy: null,
    enabled: false,
  });
  const [originalSettings, setOriginalSettings] = useState<ProxySettings>({
    http_proxy: null,
    https_proxy: null,
    no_proxy: null,
    all_proxy: null,
    enabled: false,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  // Save settings function
  const saveSettings = async () => {
    try {
      // Use api.saveSetting to store proxy settings as JSON
      await api.saveSetting('proxy_settings', JSON.stringify(settings));
      setOriginalSettings(settings);
      setToast({
        message: t('proxy.saveSuccess'),
        type: 'success',
      });
    } catch (error) {
      console.error('Failed to save proxy settings:', error);
      setToast({
        message: t('proxy.saveError'),
        type: 'error',
      });
      throw error; // Re-throw to let parent handle the error
    }
  };

  // Notify parent component of changes
  useEffect(() => {
    if (onChange) {
      const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);
      onChange(hasChanges, () => settings, saveSettings);
    }
  }, [settings, originalSettings, onChange]);

  const loadSettings = async () => {
    try {
      // Use api.getSetting to load proxy settings from JSON
      const settingsJson = await api.getSetting('proxy_settings');
      if (settingsJson) {
        const loadedSettings = JSON.parse(settingsJson) as ProxySettings;
        setSettings(loadedSettings);
        setOriginalSettings(loadedSettings);
      }
    } catch (error) {
      console.error('Failed to load proxy settings:', error);
      setToast({
        message: t('proxy.loadError'),
        type: 'error',
      });
    }
  };


  const handleInputChange = (field: keyof ProxySettings, value: string) => {
    setSettings(prev => ({
      ...prev,
      [field]: value || null,
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t('proxy.title')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('proxy.subtitle')}
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="proxy-enabled">{t('proxy.enabled')}</Label>
            <p className="text-sm text-muted-foreground">
              Use proxy for all Claude API requests
            </p>
          </div>
          <Switch
            id="proxy-enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enabled: checked }))}
          />
        </div>

        <div className="space-y-4" style={{ opacity: settings.enabled ? 1 : 0.5 }}>
          <div className="space-y-2">
            <Label htmlFor="http-proxy">{t('proxy.httpProxy')}</Label>
            <Input
              id="http-proxy"
              placeholder={t('proxy.httpProxyPlaceholder')}
              value={settings.http_proxy || ''}
              onChange={(e) => handleInputChange('http_proxy', e.target.value)}
              disabled={!settings.enabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="https-proxy">{t('proxy.httpsProxy')}</Label>
            <Input
              id="https-proxy"
              placeholder={t('proxy.httpsProxyPlaceholder')}
              value={settings.https_proxy || ''}
              onChange={(e) => handleInputChange('https_proxy', e.target.value)}
              disabled={!settings.enabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="no-proxy">{t('proxy.noProxy')}</Label>
            <Input
              id="no-proxy"
              placeholder={t('proxy.noProxyPlaceholder')}
              value={settings.no_proxy || ''}
              onChange={(e) => handleInputChange('no_proxy', e.target.value)}
              disabled={!settings.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of hosts that should bypass the proxy
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="all-proxy">{t('proxy.allProxy')}</Label>
            <Input
              id="all-proxy"
              placeholder={t('proxy.allProxyPlaceholder')}
              value={settings.all_proxy || ''}
              onChange={(e) => handleInputChange('all_proxy', e.target.value)}
              disabled={!settings.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Proxy URL to use for all protocols if protocol-specific proxies are not set
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}