import type React from 'react';

export interface ControlledExpansionProps {
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export type ToolWidgetComponent<P = any> = React.FC<P & ControlledExpansionProps>;
