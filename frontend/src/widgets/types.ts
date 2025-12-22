/**
 * Widget 系统类型定义
 *
 * 借鉴 waveterm 的 ViewModel 模式，但适配到 ropcode 的 Zustand 架构
 */

// Widget 类型枚举
export type WidgetType = 'terminal' | 'files' | 'preview' | 'web';

// Widget 状态
export type WidgetStatus = 'initializing' | 'ready' | 'error' | 'disposed';

/**
 * Widget 基础接口
 * 所有 widget 都需要实现这个接口
 */
export interface WidgetModel {
  /** Widget 类型标识 */
  widgetType: WidgetType;

  /** Widget 唯一 ID */
  widgetId: string;

  /** Widget 当前状态 */
  status: WidgetStatus;

  /**
   * 初始化 Widget
   * 在 Widget 挂载时调用
   */
  initialize(): Promise<void>;

  /**
   * 销毁 Widget
   * 在 Widget 卸载时调用，释放资源
   */
  dispose(): void;

  /**
   * 获取焦点
   * @returns 是否成功获取焦点
   */
  giveFocus(): boolean;

  /**
   * 键盘事件处理
   * @param event 键盘事件
   * @returns 是否已处理该事件（阻止冒泡）
   */
  keyDownHandler?(event: KeyboardEvent): boolean;
}

/**
 * 文件信息类型
 * 对应 Go 后端的 FileInfo 结构
 */
export interface FileInfo {
  /** 文件名 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 所在目录 */
  dir: string;
  /** 文件大小（字节） */
  size: number;
  /** 权限字符串 (e.g., "drwxr-xr-x") */
  modestr: string;
  /** 修改时间 (ISO 8601) */
  modtime: string;
  /** 是否为目录 */
  isdir: boolean;
  /** MIME 类型 */
  mimetype: string;
  /** 是否只读 */
  readonly: boolean;
}

/**
 * 文件数据类型
 * 用于读取文件内容
 */
export interface FileData {
  /** 文件路径 */
  path: string;
  /** 文件内容 (文本文件为字符串) */
  content: string;
  /** MIME 类型 */
  mimetype: string;
}

/**
 * 文件列表选项
 */
export interface FileListOptions {
  /** 是否显示隐藏文件 */
  showHidden: boolean;
}

/**
 * Widget 配置接口
 * 用于创建 Widget 时传入配置
 */
export interface WidgetConfig {
  /** Widget ID，不传则自动生成 */
  id?: string;
  /** 初始化参数，根据 Widget 类型不同而不同 */
  initialParams?: Record<string, unknown>;
}

/**
 * Terminal Widget 特有配置
 */
export interface TerminalWidgetConfig extends WidgetConfig {
  initialParams?: {
    /** 字体大小 */
    fontSize?: number;
    /** 主题名称 */
    themeName?: string;
    /** 透明度 (0-1) */
    transparency?: number;
  };
}

/**
 * Files Widget 特有配置
 */
export interface FilesWidgetConfig extends WidgetConfig {
  initialParams?: {
    /** 初始路径 */
    initialPath?: string;
    /** 是否显示隐藏文件 */
    showHidden?: boolean;
  };
}

/**
 * Preview Widget 特有配置
 */
export interface PreviewWidgetConfig extends WidgetConfig {
  initialParams?: {
    /** 要预览的文件路径 */
    filePath?: string;
    /** 是否以编辑模式打开 */
    editMode?: boolean;
  };
}

/**
 * Web Widget 特有配置
 */
export interface WebWidgetConfig extends WidgetConfig {
  initialParams?: {
    /** 初始 URL */
    initialUrl?: string;
    /** 主页 URL */
    homepageUrl?: string;
  };
}

/**
 * 生成唯一 Widget ID
 */
export function generateWidgetId(type: WidgetType): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
