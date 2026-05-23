import type { ToolWidgetComponent } from './types';
import { BashWidget } from './BashWidget';
import { EditWidget } from './EditWidget';
import { GlobWidget } from './GlobWidget';
import { GrepWidget } from './GrepWidget';
import { LSWidget } from './LSWidget';
import { MultiEditWidget } from './MultiEditWidget';
import { ReadWidget } from './ReadWidget';
import { TaskWidget } from './TaskWidget';
import { TodoReadWidget } from './TodoReadWidget';
import { TodoWidget } from './TodoWidget';
import { WebFetchWidget } from './WebFetchWidget';
import { WebSearchWidget } from './WebSearchWidget';
import { WriteWidget } from './WriteWidget';

export const toolWidgetRegistry: Record<string, ToolWidgetComponent> = {
  bash: BashWidget as ToolWidgetComponent,
  read: ReadWidget as ToolWidgetComponent,
  write: WriteWidget as ToolWidgetComponent,
  edit: EditWidget as ToolWidgetComponent,
  multiedit: MultiEditWidget as ToolWidgetComponent,
  grep: GrepWidget as ToolWidgetComponent,
  glob: GlobWidget as ToolWidgetComponent,
  ls: LSWidget as ToolWidgetComponent,
  todowrite: TodoWidget as ToolWidgetComponent,
  todoread: TodoReadWidget as ToolWidgetComponent,
  websearch: WebSearchWidget as ToolWidgetComponent,
  webfetch: WebFetchWidget as ToolWidgetComponent,
  task: TaskWidget as ToolWidgetComponent,
};

export function getToolWidget(toolName: string): ToolWidgetComponent | undefined {
  return toolWidgetRegistry[toolName.toLowerCase()];
}
