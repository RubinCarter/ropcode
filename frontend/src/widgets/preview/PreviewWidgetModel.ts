/**
 * Preview Widget model implementation
 *
 * Handles business logic and state management for the file preview/edit widget.
 */

import { BaseWidgetModel, widgetRegistry } from '../base';
import { PreviewWidgetConfig } from '../types';

/**
 * Preview Widget model class
 *
 * Provides core file preview and editing features:
 * - File content preview
 * - Edit mode toggle
 * - File save
 * - Keyboard shortcut support
 * - Focus management
 */
export class PreviewWidgetModel extends BaseWidgetModel {
  /** File path to preview */
  private filePath: string;

  /** Whether edit mode is enabled */
  private editMode: boolean;

  /**
   * Create Preview Widget instance
   *
   * @param config - Widget config
   * @param config.initialParams.filePath - File path to preview, defaults to empty string
   * @param config.initialParams.editMode - Whether to open in edit mode, defaults to false
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

    // Initialize config params
    this.filePath = config?.initialParams?.filePath ?? '';
    this.editMode = config?.initialParams?.editMode ?? false;
  }

  /**
   * Initialize Widget
   *
   * Performs the following operations:
   * 1. Validate file path
   * 2. Register to global widget registry
   * 3. Set widget ready state
   *
   * @throws {Error} If initialization fails
   * @protected
   */
  protected async onInitialize(): Promise<void> {
    // Register to global registry
    widgetRegistry.register(this);

    console.log(
      `PreviewWidget ${this.widgetId} initialized with filePath: ${this.filePath}, editMode: ${this.editMode}`
    );
  }

  /**
   * Clean up Widget resources
   *
   * Performs the following operations:
   * 1. Unregister from global widget registry
   * 2. Clean up preview/editor related resources
   * 3. Release DOM references
   *
   * @protected
   */
  protected onDispose(): void {
    // Unregister from global registry
    widgetRegistry.unregister(this.widgetId);

    console.log(`PreviewWidget ${this.widgetId} disposed`);
  }

  /**
   * Get focus
   *
   * Sets focus to the preview/editor container to receive keyboard input.
   *
   * @returns Whether focus was successfully acquired
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

    // Try focusing preview container
    const previewElement = this.containerRef.querySelector<HTMLElement>(
      '[data-preview-content]'
    );

    if (previewElement) {
      previewElement.focus();
      return true;
    }

    // Fall back to container itself
    this.containerRef.focus();
    return true;
  }

  /**
   * Handle keyboard event
   *
   * Supported keyboard operations:
   * - Ctrl/Cmd + S: Save file
   * - Ctrl/Cmd + E: Toggle edit mode
   *
   * @param event - Keyboard event
   * @returns true if event was handled (stops propagation); false otherwise
   *
   * @example
   * ```typescript
   * // Usage in React component
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

    // Ctrl/Cmd + S: Save file
    if (modKey && key === 's') {
      event.preventDefault(); // Prevent browser default save behavior
      this.saveFile();
      return true;
    }

    // Ctrl/Cmd + E: Toggle edit mode
    if (modKey && key === 'e') {
      event.preventDefault();
      this.toggleEditMode();
      return true;
    }

    return false;
  }

  /**
   * Get file path
   *
   * @returns Current file path being previewed
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Set file path
   *
   * @param path - New file path
   */
  setFilePath(path: string): void {
    this.filePath = path;
    console.log(`PreviewWidget ${this.widgetId} filePath changed to: ${path}`);
    // TODO: trigger file reload
  }

  /**
   * Get edit mode state
   *
   * @returns Whether the widget is in edit mode
   */
  getEditMode(): boolean {
    return this.editMode;
  }

  /**
   * Toggle edit mode
   *
   * @private
   */
  private toggleEditMode(): void {
    this.editMode = !this.editMode;
    console.log(`PreviewWidget ${this.widgetId} editMode toggled to: ${this.editMode}`);
    // TODO: trigger UI update, switch preview/edit view
  }

  /**
   * Save file
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
    // TODO: implement actual file save logic
    // 1. Get editor content
    // 2. Call backend API to save file
    // 3. Handle save success/failure state
  }
}
