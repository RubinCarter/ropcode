/**
 * Widget Context Provider
 *
 * Shares widget state and registry access across the React component tree.
 * Inspired by waveterm's model, adapted for React 18 + TypeScript.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { BaseWidgetModel, widgetRegistry } from './WidgetModel';

/**
 * Widget Context interface
 */
interface WidgetContextType {
  /** Currently active widget ID */
  activeWidgetId: string | null;

  /** Set active Widget */
  setActiveWidget: (widgetId: string | null) => void;

  /** Get a specific widget */
  getWidget: (widgetId: string) => BaseWidgetModel | undefined;

  /** Get all Widgets */
  getAllWidgets: () => BaseWidgetModel[];

  /** Register Widget */
  registerWidget: (widget: BaseWidgetModel) => void;

  /** Unregister Widget */
  unregisterWidget: (widgetId: string) => void;

  /** Get the currently active widget */
  getActiveWidget: () => BaseWidgetModel | undefined;
}

/**
 * Widget Context
 */
const WidgetContext = createContext<WidgetContextType | undefined>(undefined);

/**
 * Widget Provider Props
 */
interface WidgetProviderProps {
  children: ReactNode;
  /** Initial active widget ID */
  initialActiveWidgetId?: string | null;
}

/**
 * Widget Provider component
 *
 * Provides widget state management and registry access.
 */
export function WidgetProvider({ children, initialActiveWidgetId = null }: WidgetProviderProps) {
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(initialActiveWidgetId);

  // Set active widget
  const setActiveWidget = useCallback((widgetId: string | null) => {
    setActiveWidgetId(widgetId);
  }, []);

  // Get specified widget
  const getWidget = useCallback((widgetId: string) => {
    return widgetRegistry.get(widgetId);
  }, []);

  // Get all widgets
  const getAllWidgets = useCallback(() => {
    return widgetRegistry.getAll();
  }, []);

  // Register Widget
  const registerWidget = useCallback((widget: BaseWidgetModel) => {
    widgetRegistry.register(widget);
  }, []);

  // Unregister Widget
  const unregisterWidget = useCallback((widgetId: string) => {
    widgetRegistry.unregister(widgetId);
    // If unregistering the active Widget, clear active state
    if (activeWidgetId === widgetId) {
      setActiveWidgetId(null);
    }
  }, [activeWidgetId]);

  // Get currently active widget
  const getActiveWidget = useCallback(() => {
    return activeWidgetId ? widgetRegistry.get(activeWidgetId) : undefined;
  }, [activeWidgetId]);

  const value = useMemo(
    () => ({
      activeWidgetId,
      setActiveWidget,
      getWidget,
      getAllWidgets,
      registerWidget,
      unregisterWidget,
      getActiveWidget,
    }),
    [activeWidgetId, setActiveWidget, getWidget, getAllWidgets, registerWidget, unregisterWidget, getActiveWidget]
  );

  return <WidgetContext.Provider value={value}>{children}</WidgetContext.Provider>;
}

/**
 * useWidgetContext Hook
 *
 * Access the Widget Context.
 * @throws If used outside of a WidgetProvider
 */
function useWidgetContext(): WidgetContextType {
  const context = useContext(WidgetContext);
  if (!context) {
    throw new Error('useWidgetContext must be used within a WidgetProvider');
  }
  return context;
}

/**
 * useWidget Hook
 *
 * Get a specific widget instance.
 * @param widgetId Widget ID
 * @returns Widget instance or undefined
 */
export function useWidget(widgetId: string | null | undefined): BaseWidgetModel | undefined {
  const { getWidget } = useWidgetContext();
  return useMemo(() => {
    return widgetId ? getWidget(widgetId) : undefined;
  }, [widgetId, getWidget]);
}

/**
 * useActiveWidget Hook
 *
 * Get the currently active widget.
 */
export function useActiveWidget() {
  const { activeWidgetId, setActiveWidget, getActiveWidget } = useWidgetContext();

  return useMemo(
    () => ({
      /** Active Widget ID */
      widgetId: activeWidgetId,
      /** Active Widget instance */
      widget: getActiveWidget(),
      /** Set active Widget */
      setActive: setActiveWidget,
    }),
    [activeWidgetId, getActiveWidget, setActiveWidget]
  );
}

/**
 * useWidgetRegistry Hook
 *
 * Access widget registry operations.
 */
export function useWidgetRegistry() {
  const { registerWidget, unregisterWidget, getWidget, getAllWidgets } = useWidgetContext();

  return useMemo(
    () => ({
      /** Register Widget */
      register: registerWidget,
      /** Unregister Widget */
      unregister: unregisterWidget,
      /** Get Widget */
      get: getWidget,
      /** Get all Widgets */
      getAll: getAllWidgets,
    }),
    [registerWidget, unregisterWidget, getWidget, getAllWidgets]
  );
}
