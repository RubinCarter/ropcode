import type { AnalyticsSettings } from './types';

const ANALYTICS_STORAGE_KEY = 'ropcode-analytics-settings';

const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = {
  enabled: false,
  hasConsented: false,
};

export class ConsentManager {
  private static instance: ConsentManager;
  private settings: AnalyticsSettings | null = null;
  
  private constructor() {}
  
  static getInstance(): ConsentManager {
    if (!ConsentManager.instance) {
      ConsentManager.instance = new ConsentManager();
    }
    return ConsentManager.instance;
  }
  
  async initialize(): Promise<AnalyticsSettings> {
    try {
      // Try to load from localStorage first
      const stored = localStorage.getItem(ANALYTICS_STORAGE_KEY);
      let shouldSave = false;
      if (stored) {
        this.settings = JSON.parse(stored);
        shouldSave = this.migrateImplicitConsent();
      } else {
        this.settings = { ...DEFAULT_ANALYTICS_SETTINGS };
        shouldSave = true;
      }
      
      // Generate anonymous user ID if not exists
      if (this.settings && !this.settings.userId) {
        this.settings.userId = this.generateAnonymousId();
        shouldSave = true;
      }
      
      // Generate session ID
      if (this.settings) {
        this.settings.sessionId = this.generateSessionId();
      }

      if (shouldSave) {
        await this.saveSettings();
      }
      
      return this.settings || {
        ...DEFAULT_ANALYTICS_SETTINGS,
      };
    } catch (error) {
      console.error('Failed to initialize consent manager:', error);
      // Return default settings on error
      return {
        ...DEFAULT_ANALYTICS_SETTINGS,
      };
    }
  }
  
  async grantConsent(): Promise<void> {
    if (!this.settings) {
      await this.initialize();
    }
    
    this.settings!.enabled = true;
    this.settings!.hasConsented = true;
    this.settings!.consentDate = new Date().toISOString();
    
    await this.saveSettings();
  }
  
  async revokeConsent(): Promise<void> {
    if (!this.settings) {
      await this.initialize();
    }
    
    this.settings!.enabled = false;
    this.settings!.hasConsented = true;
    
    await this.saveSettings();
  }
  
  async deleteAllData(): Promise<void> {
    // Clear local storage
    localStorage.removeItem(ANALYTICS_STORAGE_KEY);
    
    // Reset settings with new anonymous ID
    this.settings = {
      ...DEFAULT_ANALYTICS_SETTINGS,
      userId: this.generateAnonymousId(),
      sessionId: this.generateSessionId(),
    };
    
    await this.saveSettings();
  }
  
  getSettings(): AnalyticsSettings | null {
    return this.settings;
  }
  
  hasConsented(): boolean {
    return this.settings?.hasConsented || false;
  }
  
  isEnabled(): boolean {
    return this.settings?.enabled || false;
  }
  
  getUserId(): string {
    return this.settings?.userId || this.generateAnonymousId();
  }
  
  getSessionId(): string {
    return this.settings?.sessionId || this.generateSessionId();
  }
  
  private async saveSettings(): Promise<void> {
    if (!this.settings) return;
    
    try {
      localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save analytics settings:', error);
    }
  }

  private migrateImplicitConsent(): boolean {
    if (!this.settings) return false;

    // Older builds wrote enabled/hasConsented=true without a consentDate by default.
    // Treat that state as "not answered" so analytics remains explicit opt-in.
    if (this.settings.hasConsented && this.settings.enabled && !this.settings.consentDate) {
      this.settings.enabled = false;
      this.settings.hasConsented = false;
      return true;
    }

    return false;
  }
  
  private generateAnonymousId(): string {
    // Generate a UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  
  private generateSessionId(): string {
    // Simple session ID based on timestamp and random value
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
