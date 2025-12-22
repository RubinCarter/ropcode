/**
 * Widget 基础模型抽象类
 *
 * 提供 WidgetModel 接口的默认实现
 * 具体 Widget 应继承此类并实现特定逻辑
 */

import {
  WidgetModel,
  WidgetType,
  WidgetStatus,
  WidgetConfig,
  generateWidgetId,
} from '../types';

/**
 * 抽象基础 Widget 模型
 * 所有具体 Widget Model 都应继承此类
 */
export abstract class BaseWidgetModel implements WidgetModel {
  readonly widgetType: WidgetType;
  readonly widgetId: string;
  status: WidgetStatus = 'initializing';

  /** 是否已初始化 */
  protected isInitialized = false;

  /** 是否已销毁 */
  protected isDisposed = false;

  /** DOM 容器引用 */
  protected containerRef: HTMLElement | null = null;

  constructor(type: WidgetType, config?: WidgetConfig) {
    this.widgetType = type;
    this.widgetId = config?.id ?? generateWidgetId(type);
  }

  /**
   * 初始化 Widget
   * 子类应重写 onInitialize 方法实现具体初始化逻辑
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
   * 销毁 Widget
   * 子类应重写 onDispose 方法实现具体清理逻辑
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
   * 设置 DOM 容器
   */
  setContainer(container: HTMLElement | null): void {
    this.containerRef = container;
  }

  /**
   * 获取 DOM 容器
   */
  getContainer(): HTMLElement | null {
    return this.containerRef;
  }

  /**
   * 获取焦点
   * 子类可重写此方法实现自定义焦点逻辑
   */
  giveFocus(): boolean {
    if (!this.containerRef || this.isDisposed) {
      return false;
    }

    // 默认实现：聚焦容器
    this.containerRef.focus();
    return true;
  }

  /**
   * 键盘事件处理
   * 子类可重写此方法处理键盘事件
   */
  keyDownHandler?(event: KeyboardEvent): boolean;

  /**
   * 子类实现的初始化逻辑
   * @abstract
   */
  protected abstract onInitialize(): Promise<void>;

  /**
   * 子类实现的清理逻辑
   * @abstract
   */
  protected abstract onDispose(): void;
}

/**
 * Widget 注册表
 * 用于管理所有活跃的 Widget 实例
 */
class WidgetRegistry {
  private widgets = new Map<string, BaseWidgetModel>();

  /**
   * 注册 Widget
   */
  register(widget: BaseWidgetModel): void {
    if (this.widgets.has(widget.widgetId)) {
      console.warn(`Widget ${widget.widgetId} already registered`);
      return;
    }
    this.widgets.set(widget.widgetId, widget);
  }

  /**
   * 注销 Widget
   */
  unregister(widgetId: string): void {
    const widget = this.widgets.get(widgetId);
    if (widget) {
      widget.dispose();
      this.widgets.delete(widgetId);
    }
  }

  /**
   * 获取 Widget
   */
  get(widgetId: string): BaseWidgetModel | undefined {
    return this.widgets.get(widgetId);
  }

  /**
   * 获取所有 Widget
   */
  getAll(): BaseWidgetModel[] {
    return Array.from(this.widgets.values());
  }

  /**
   * 按类型获取 Widget
   */
  getByType(type: WidgetType): BaseWidgetModel[] {
    return this.getAll().filter((w) => w.widgetType === type);
  }

  /**
   * 清理所有 Widget
   */
  clear(): void {
    for (const widget of this.widgets.values()) {
      widget.dispose();
    }
    this.widgets.clear();
  }
}

/** 全局 Widget 注册表实例 */
export const widgetRegistry = new WidgetRegistry();
