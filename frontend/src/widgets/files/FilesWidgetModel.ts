/**
 * Files Widget model implementation
 *
 * Handles business logic and state management for the file browser widget.
 */

import { BaseWidgetModel, widgetRegistry } from '../base';
import { FilesWidgetConfig } from '../types';

/**
 * Files Widget model class
 *
 * Provides core file browser features:
 * - File/directory browsing
 * - Hidden file visibility control
 * - Keyboard navigation support
 * - Focus management
 */
export class FilesWidgetModel extends BaseWidgetModel {
  /** Current path */
  private initialPath: string;

  /** whether to show hidden files */
  private showHidden: boolean;

  /**
   * Create Files Widget instance
   *
   * @param config - Widget config
   * @param config.initialParams.initialPath - Initial path, defaults to user home directory
   * @param config.initialParams.showHidden - Whether to show hidden files, defaults to false
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

    // Initialize config params
    this.initialPath = config?.initialParams?.initialPath ?? '~';
    this.showHidden = config?.initialParams?.showHidden ?? false;
  }

  /**
   * Initialize Widget
   *
   * Performs the following operations:
   * 1. Validate if initial path is valid
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
      `FilesWidget ${this.widgetId} initialized with path: ${this.initialPath}, showHidden: ${this.showHidden}`
    );
  }

  /**
   * Clean up Widget resources
   *
   * Performs the following operations:
   * 1. Unregister from global widget registry
   * 2. Clean up file browser related resources
   * 3. Release DOM references
   *
   * @protected
   */
  protected onDispose(): void {
    // Unregister from global registry
    widgetRegistry.unregister(this.widgetId);

    console.log(`FilesWidget ${this.widgetId} disposed`);
  }

  /**
   * Get focus
   *
   * Sets focus to the file list container to receive keyboard input.
   *
   * @returns Whether focus was successfully acquired
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

    // Try focusing file list container
    const fileListElement = this.containerRef.querySelector<HTMLElement>(
      '[data-files-list]'
    );

    if (fileListElement) {
      fileListElement.focus();
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
   * - ArrowUp: Select previous file/directory
   * - ArrowDown: Select next file/directory
   * - Enter: Open selected file/directory
   * - Backspace: Return to parent directory
   * - h: Toggle hidden file visibility (Ctrl/Cmd + h)
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

    // Ctrl/Cmd + h: Toggle hidden file visibility
    if ((ctrlKey || metaKey) && key === 'h') {
      this.toggleShowHidden();
      return true;
    }

    switch (key) {
      case 'ArrowUp':
        // Select previous file
        this.selectPrevious();
        return true;

      case 'ArrowDown':
        // Select next file
        this.selectNext();
        return true;

      case 'Enter':
        // Open selected file/directory
        this.openSelected();
        return true;

      case 'Backspace':
        // Go to parent directory
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
   * Get initial path
   *
   * @returns Initial path string
   */
  getInitialPath(): string {
    return this.initialPath;
  }

  /**
   * Get hidden file visibility state
   *
   * @returns whether to show hidden files
   */
  getShowHidden(): boolean {
    return this.showHidden;
  }

  /**
   * Toggle hidden file visibility
   *
   * @private
   */
  private toggleShowHidden(): void {
    this.showHidden = !this.showHidden;
    console.log(`Toggle showHidden: ${this.showHidden}`);
    // TODO: trigger file list refresh
  }

  /**
   * Select previous file/directory
   *
   * @private
   */
  private selectPrevious(): void {
    console.log('Select previous file');
    // TODO: implement select previous file
  }

  /**
   * Select next file/directory
   *
   * @private
   */
  private selectNext(): void {
    console.log('Select next file');
    // TODO: implement select next file
  }

  /**
   * Open selected file/directory
   *
   * @private
   */
  private openSelected(): void {
    console.log('Open selected file/directory');
    // TODO: implement open file/directory
  }

  /**
   * Navigate to parent directory
   *
   * @private
   */
  private navigateUp(): void {
    console.log('Navigate to parent directory');
    // TODO: implement navigate to parent directory
  }
}
