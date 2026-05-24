/**
 * Widget base model abstract class
 *
 * Provides default implementation of the WidgetModel interface.
 * Specific widgets should inherit this class and implement their own logic.
 */

import {
  WidgetModel,
  WidgetType,
  WidgetStatus,
  WidgetConfig,
  generateWidgetId,
} from '../types';

/**
 * Abstract base Widget model
 * All specific Widget Models should inherit this class.
 */
export abstract class BaseWidgetModel implements WidgetModel {
  readonly widgetType: WidgetType;
  readonly widgetId: string;
  status: WidgetStatus = 'initializing';

  /** Whether initialized */
  protected isInitialized = false;

  /** Whether disposed */
  protected isDisposed = false;

  /** DOM container reference */
  protected containerRef: HTMLElement | null = null;

  constructor(type: WidgetType, config?: WidgetConfig) {
    this.widgetType = type;
    this.widgetId = config?.id ?? generateWidgetId(type);
  }

  /**
   * Initialize Widget
   * Subclasses should override onInitialize to implement specific initialization logic.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn(`Widget ${this.widgetId} already initialized`);
      return;
    }

    if (this.isDisposed) {
      throw new Error(`Cannot initialize disposed widget ${this.widgetId}`);
    }

    try {
      await this.onInitialize();
      this.isInitialized = true;
      this.status = 'ready';
    } catch (error) {
      this.status = 'error';
      console.error(`Failed to initialize widget ${this.widgetId}:`, error);
      throw error;
    }
  }

  /**
   * Dispose Widget
   * Subclasses should override onDispose to implement specific cleanup logic.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    try {
      this.onDispose();
    } catch (error) {
      console.error(`Error disposing widget ${this.widgetId}:`, error);
    } finally {
      this.isDisposed = true;
      this.isInitialized = false;
      this.status = 'disposed';
      this.containerRef = null;
    }
  }

  /**
   * Set DOM container
   */
  setContainer(container: HTMLElement | null): void {
    this.containerRef = container;
  }

  /**
   * Get DOM container
   */
  getContainer(): HTMLElement | null {
    return this.containerRef;
  }

  /**
   * Get focus
   * Subclasses can override this method to implement custom focus logic.
   */
  giveFocus(): boolean {
    if (!this.containerRef || this.isDisposed) {
      return false;
    }

    // Default implementation: focus the container
    this.containerRef.focus();
    return true;
  }

  /**
   * Keyboard event handler
   * Subclasses can override this method to handle keyboard events.
   */
  keyDownHandler?(event: KeyboardEvent): boolean;

  /**
   * Initialization logic implemented by subclasses.
   * @abstract
   */
  protected abstract onInitialize(): Promise<void>;

  /**
   * Cleanup logic implemented by subclasses.
   * @abstract
   */
  protected abstract onDispose(): void;
}

/**
 * Widget registry
 * Manages all active Widget instances
 */
class WidgetRegistry {
  private widgets = new Map<string, BaseWidgetModel>();

  /**
   * Register Widget
   */
  register(widget: BaseWidgetModel): void {
    if (this.widgets.has(widget.widgetId)) {
      console.warn(`Widget ${widget.widgetId} already registered`);
      return;
    }
    this.widgets.set(widget.widgetId, widget);
  }

  /**
   * Unregister Widget
   */
  unregister(widgetId: string): void {
    const widget = this.widgets.get(widgetId);
    if (widget) {
      widget.dispose();
      this.widgets.delete(widgetId);
    }
  }

  /**
   * Get Widget
   */
  get(widgetId: string): BaseWidgetModel | undefined {
    return this.widgets.get(widgetId);
  }

  /**
   * Get all widgets
   */
  getAll(): BaseWidgetModel[] {
    return Array.from(this.widgets.values());
  }

  /**
   * Get Widget by type
   */
  getByType(type: WidgetType): BaseWidgetModel[] {
    return this.getAll().filter((w) => w.widgetType === type);
  }

  /**
   * Clear all widgets
   */
  clear(): void {
    for (const widget of this.widgets.values()) {
      widget.dispose();
    }
    this.widgets.clear();
  }
}

/** Global Widget registry instance */
export const widgetRegistry = new WidgetRegistry();
