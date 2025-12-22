/**
 * Files Widget 模型实现
 *
 * 负责文件浏览器 Widget 的业务逻辑和状态管理
 */

import { BaseWidgetModel, widgetRegistry } from '../base';
import { FilesWidgetConfig } from '../types';

/**
 * Files Widget 模型类
 *
 * 提供文件浏览器的核心功能：
 * - 文件/目录浏览
 * - 隐藏文件显示控制
 * - 键盘导航支持
 * - 焦点管理
 */
export class FilesWidgetModel extends BaseWidgetModel {
  /** 当前路径 */
  private initialPath: string;

  /** 是否显示隐藏文件 */
  private showHidden: boolean;

  /**
   * 创建 Files Widget 实例
   *
   * @param config - Widget 配置
   * @param config.initialParams.initialPath - 初始路径，默认为用户主目录
   * @param config.initialParams.showHidden - 是否显示隐藏文件，默认为 false
   *
   * @example
   * ```typescript
   * const filesWidget = new FilesWidgetModel({
   *   initialParams: {
   *     initialPath: '/home/user/projects',
   *     showHidden: true
   *   }
   * });
   * await filesWidget.initialize();
   * ```
   */
  constructor(config?: FilesWidgetConfig) {
    super('files', config);

    // 初始化配置参数
    this.initialPath = config?.initialParams?.initialPath ?? '~';
    this.showHidden = config?.initialParams?.showHidden ?? false;
  }

  /**
   * 初始化 Widget
   *
   * 执行以下操作：
   * 1. 验证初始路径是否有效
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
      `FilesWidget ${this.widgetId} initialized with path: ${this.initialPath}, showHidden: ${this.showHidden}`
    );
  }

  /**
   * 清理 Widget 资源
   *
   * 执行以下操作：
   * 1. 从全局 Widget 注册表注销
   * 2. 清理文件浏览器相关资源
   * 3. 释放 DOM 引用
   *
   * @protected
   */
  protected onDispose(): void {
    // 从全局注册表注销
    widgetRegistry.unregister(this.widgetId);

    console.log(`FilesWidget ${this.widgetId} disposed`);
  }

  /**
   * 获取焦点
   *
   * 将焦点设置到文件列表容器，以便接收键盘输入
   *
   * @returns 是否成功获取焦点
   *
   * @example
   * ```typescript
   * if (filesWidget.giveFocus()) {
   *   console.log('Files widget has focus');
   * }
   * ```
   */
  override giveFocus(): boolean {
    if (!this.containerRef || this.isDisposed) {
      return false;
    }

    // 尝试聚焦到文件列表容器
    const fileListElement = this.containerRef.querySelector<HTMLElement>(
      '[data-files-list]'
    );

    if (fileListElement) {
      fileListElement.focus();
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
   * - ArrowUp: 选择上一个文件/目录
   * - ArrowDown: 选择下一个文件/目录
   * - Enter: 打开选中的文件/目录
   * - Backspace: 返回上级目录
   * - h: 切换隐藏文件显示（Ctrl/Cmd + h）
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

    // Ctrl/Cmd + h: 切换隐藏文件显示
    if ((ctrlKey || metaKey) && key === 'h') {
      this.toggleShowHidden();
      return true;
    }

    switch (key) {
      case 'ArrowUp':
        // 选择上一个文件
        this.selectPrevious();
        return true;

      case 'ArrowDown':
        // 选择下一个文件
        this.selectNext();
        return true;

      case 'Enter':
        // 打开选中的文件/目录
        this.openSelected();
        return true;

      case 'Backspace':
        // 返回上级目录
        if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
          this.navigateUp();
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * 获取初始路径
   *
   * @returns 初始路径字符串
   */
  getInitialPath(): string {
    return this.initialPath;
  }

  /**
   * 获取隐藏文件显示状态
   *
   * @returns 是否显示隐藏文件
   */
  getShowHidden(): boolean {
    return this.showHidden;
  }

  /**
   * 切换隐藏文件显示状态
   *
   * @private
   */
  private toggleShowHidden(): void {
    this.showHidden = !this.showHidden;
    console.log(`Toggle showHidden: ${this.showHidden}`);
    // TODO: 触发文件列表刷新
  }

  /**
   * 选择上一个文件/目录
   *
   * @private
   */
  private selectPrevious(): void {
    console.log('Select previous file');
    // TODO: 实现选择上一个文件的逻辑
  }

  /**
   * 选择下一个文件/目录
   *
   * @private
   */
  private selectNext(): void {
    console.log('Select next file');
    // TODO: 实现选择下一个文件的逻辑
  }

  /**
   * 打开选中的文件/目录
   *
   * @private
   */
  private openSelected(): void {
    console.log('Open selected file/directory');
    // TODO: 实现打开文件/目录的逻辑
  }

  /**
   * 导航到上级目录
   *
   * @private
   */
  private navigateUp(): void {
    console.log('Navigate to parent directory');
    // TODO: 实现导航到上级目录的逻辑
  }
}
