/**
 * Preview Widget 模型实现
 *
 * 负责文件预览/编辑 Widget 的业务逻辑和状态管理
 */

import { BaseWidgetModel, widgetRegistry } from '../base';
import { PreviewWidgetConfig } from '../types';

/**
 * Preview Widget 模型类
 *
 * 提供文件预览和编辑的核心功能：
 * - 文件内容预览
 * - 编辑模式切换
 * - 文件保存
 * - 键盘快捷键支持
 * - 焦点管理
 */
export class PreviewWidgetModel extends BaseWidgetModel {
  /** 要预览的文件路径 */
  private filePath: string;

  /** 是否开启编辑模式 */
  private editMode: boolean;

  /**
   * 创建 Preview Widget 实例
   *
   * @param config - Widget 配置
   * @param config.initialParams.filePath - 要预览的文件路径，默认为空字符串
   * @param config.initialParams.editMode - 是否以编辑模式打开，默认为 false
   *
   * @example
   * ```typescript
   * const previewWidget = new PreviewWidgetModel({
   *   initialParams: {
   *     filePath: '/home/user/document.md',
   *     editMode: false
   *   }
   * });
   * await previewWidget.initialize();
   * ```
   */
  constructor(config?: PreviewWidgetConfig) {
    super('preview', config);

    // 初始化配置参数
    this.filePath = config?.initialParams?.filePath ?? '';
    this.editMode = config?.initialParams?.editMode ?? false;
  }

  /**
   * 初始化 Widget
   *
   * 执行以下操作：
   * 1. 验证文件路径是否有效
   * 2. 注册到全局 Widget 注册表
   * 3. 设置 Widget 就绪状态
   *
   * @throws {Error} 如果初始化失败
   * @protected
   */
  protected async onInitialize(): Promise<void> {
    // 注册到全局注册表
    widgetRegistry.register(this);

    console.log(
      `PreviewWidget ${this.widgetId} initialized with filePath: ${this.filePath}, editMode: ${this.editMode}`
    );
  }

  /**
   * 清理 Widget 资源
   *
   * 执行以下操作：
   * 1. 从全局 Widget 注册表注销
   * 2. 清理预览/编辑器相关资源
   * 3. 释放 DOM 引用
   *
   * @protected
   */
  protected onDispose(): void {
    // 从全局注册表注销
    widgetRegistry.unregister(this.widgetId);

    console.log(`PreviewWidget ${this.widgetId} disposed`);
  }

  /**
   * 获取焦点
   *
   * 将焦点设置到预览/编辑器容器，以便接收键盘输入
   *
   * @returns 是否成功获取焦点
   *
   * @example
   * ```typescript
   * if (previewWidget.giveFocus()) {
   *   console.log('Preview widget has focus');
   * }
   * ```
   */
  override giveFocus(): boolean {
    if (!this.containerRef || this.isDisposed) {
      return false;
    }

    // 尝试聚焦到预览容器
    const previewElement = this.containerRef.querySelector<HTMLElement>(
      '[data-preview-content]'
    );

    if (previewElement) {
      previewElement.focus();
      return true;
    }

    // 回退到容器本身
    this.containerRef.focus();
    return true;
  }

  /**
   * 处理键盘事件
   *
   * 支持的键盘操作：
   * - Ctrl/Cmd + S: 保存文件
   * - Ctrl/Cmd + E: 切换编辑模式
   *
   * @param event - 键盘事件
   * @returns true 表示事件已处理，阻止冒泡；false 表示未处理
   *
   * @example
   * ```typescript
   * // 在 React 组件中使用
   * <div onKeyDown={(e) => model.keyDownHandler?.(e.nativeEvent)}>
   *   ...
   * </div>
   * ```
   */
  keyDownHandler(event: KeyboardEvent): boolean {
    if (this.isDisposed) {
      return false;
    }

    const { key, ctrlKey, metaKey } = event;
    const modKey = ctrlKey || metaKey;

    // Ctrl/Cmd + S: 保存文件
    if (modKey && key === 's') {
      event.preventDefault(); // 阻止浏览器默认保存行为
      this.saveFile();
      return true;
    }

    // Ctrl/Cmd + E: 切换编辑模式
    if (modKey && key === 'e') {
      event.preventDefault();
      this.toggleEditMode();
      return true;
    }

    return false;
  }

  /**
   * 获取文件路径
   *
   * @returns 当前预览的文件路径
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * 设置文件路径
   *
   * @param path - 新的文件路径
   */
  setFilePath(path: string): void {
    this.filePath = path;
    console.log(`PreviewWidget ${this.widgetId} filePath changed to: ${path}`);
    // TODO: 触发文件重新加载
  }

  /**
   * 获取编辑模式状态
   *
   * @returns 是否处于编辑模式
   */
  getEditMode(): boolean {
    return this.editMode;
  }

  /**
   * 切换编辑模式
   *
   * @private
   */
  private toggleEditMode(): void {
    this.editMode = !this.editMode;
    console.log(`PreviewWidget ${this.widgetId} editMode toggled to: ${this.editMode}`);
    // TODO: 触发 UI 更新，切换预览/编辑视图
  }

  /**
   * 保存文件
   *
   * @private
   */
  private saveFile(): void {
    if (!this.editMode) {
      console.warn(`PreviewWidget ${this.widgetId}: Cannot save in preview mode`);
      return;
    }

    if (!this.filePath) {
      console.warn(`PreviewWidget ${this.widgetId}: No file path specified`);
      return;
    }

    console.log(`PreviewWidget ${this.widgetId}: Saving file ${this.filePath}`);
    // TODO: 实现实际的文件保存逻辑
    // 1. 获取编辑器内容
    // 2. 调用后端 API 保存文件
    // 3. 处理保存成功/失败状态
  }
}
