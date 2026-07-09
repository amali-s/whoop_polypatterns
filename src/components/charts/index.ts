// Phase 4.0 charting foundation — barrel export for chart components (4.1–4.6).
export { useChartDimensions, DEFAULT_MARGIN } from './useChartDimensions';
export type { ChartDimensions, ChartMargin } from './useChartDimensions';
export { prefersReducedMotion, chartTransitionDuration } from './motion';
export { scaleLinear, scaleBand, scaleTime, scaleOrdinal, safeExtent, dayDomain } from './scales';
export { Axis } from './Axis';
export type { AxisProps } from './Axis';
export { Tooltip } from './Tooltip';
export { useTooltip } from './useTooltip';
export type { TooltipState } from './useTooltip';
export { Legend } from './Legend';
export type { LegendEntry } from './Legend';
export { ChartSvg } from './ChartSvg';
export { ChartDataTable } from './ChartDataTable';
export type { ChartDataColumn } from './ChartDataTable';
import './charts.css';
