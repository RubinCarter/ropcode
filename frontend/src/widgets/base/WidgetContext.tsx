/**
 * Widget Context Provider
 *
 * 在 React 组件树中共享 Widget 状态和注册表访问
 * 借鉴 waveterm 模式，但适配 React 18 + TypeScript
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { BaseWidgetModel, widgetRegistry } from './WidgetModel';

/**
 * Widget Context 接口
 */
interface WidgetContextType {
  /** 当前活跃的 Widget ID */
  activeWidgetId: string | null;

  /** 设置活跃 Widget */
  setActiveWidget: (widgetId: string | null) => void;

  /** 获取指定 Widget */
  getWidget: (widgetId: string) => BaseWidgetModel | undefined;

  /** 获取所有 Widget */
  getAllWidgets: () => BaseWidgetModel[];

  /** 注册 Widget */
  registerWidget: (widget: BaseWidgetModel) => void;

  /** 注销 Widget */
  unregisterWidget: (widgetId: string) => void;

  /** 获取当前活跃 Widget */
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
  /** 初始活跃 Widget ID */
  initialActiveWidgetId?: string | null;
}

/**
 * Widget Provider 组件
 *
 * 提供 Widget 状态管理和注册表访问
 */
export function WidgetProvider({ children, initialActiveWidgetId = null }: WidgetProviderProps) {
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(initialActiveWidgetId);

  // 设置活跃 Widget
  const setActiveWidget = useCallback((widgetId: string | null) => {
    setActiveWidgetId(widgetId);
  }, []);

  // 获取指定 Widget
  const getWidget = useCallback((widgetId: string) => {
    return widgetRegistry.get(widgetId);
  }, []);

  // 获取所有 Widget
  const getAllWidgets = useCallback(() => {
    return widgetRegistry.getAll();
  }, []);

  // 注册 Widget
  const registerWidget = useCallback((widget: BaseWidgetModel) => {
    widgetRegistry.register(widget);
  }, []);

  // 注销 Widget
  const unregisterWidget = useCallback((widgetId: string) => {
    widgetRegistry.unregister(widgetId);
    // 如果注销的是当前活跃 Widget，清除活跃状态
    if (activeWidgetId === widgetId) {
      setActiveWidgetId(null);
    }
  }, [activeWidgetId]);

  // 获取当前活跃 Widget
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
 * 访问 Widget Context
 * @throws 如果不在 WidgetProvider 内使用
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
 * 获取指定 Widget 实例
 * @param widgetId Widget ID
 * @returns Widget 实例或 undefined
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
 * 获取当前活跃的 Widget
 */
export function useActiveWidget() {
  const { activeWidgetId, setActiveWidget, getActiveWidget } = useWidgetContext();

  return useMemo(
    () => ({
      /** 活跃 Widget ID */
      widgetId: activeWidgetId,
      /** 活跃 Widget 实例 */
      widget: getActiveWidget(),
      /** 设置活跃 Widget */
      setActive: setActiveWidget,
    }),
    [activeWidgetId, getActiveWidget, setActiveWidget]
  );
}

/**
 * useWidgetRegistry Hook
 *
 * 访问 Widget 注册表操作
 */
export function useWidgetRegistry() {
  const { registerWidget, unregisterWidget, getWidget, getAllWidgets } = useWidgetContext();

  return useMemo(
    () => ({
      /** 注册 Widget */
      register: registerWidget,
      /** 注销 Widget */
      unregister: unregisterWidget,
      /** 获取 Widget */
      get: getWidget,
      /** 获取所有 Widget */
      getAll: getAllWidgets,
    }),
    [registerWidget, unregisterWidget, getWidget, getAllWidgets]
  );
}
