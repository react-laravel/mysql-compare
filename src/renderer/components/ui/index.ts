// Doge Desktop Design System — shared primitives.
// Tokens live in `src/renderer/styles/tokens.css`.
export { Badge, type BadgeProps, type BadgeVariant, type Tone } from './badge'
export { Button, buttonVariants, type ButtonProps, type ButtonVariant, type ControlSize } from './button'
export { Checkbox, type CheckboxProps } from './checkbox'
export { Combobox, type ComboboxProps } from './combobox'
export {
  CommandPalette,
  matchesQuery,
  rankCommands,
  type Command,
  type CommandGroup,
  type CommandPaletteProps
} from './command-palette'
export { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog'
export {
  ContextMenu,
  useContextMenu,
  type ContextMenuProps,
  type ContextMenuState
} from './context-menu'
export { DataTable, type Column, type DataTableProps, type DataTableSort } from './data-table'
export { Dialog, type DialogProps, type DialogSize } from './dialog'
export {
  DIFF_INK,
  DIFF_ROW_BG,
  DIFF_SIGN,
  DiffGutter,
  type DiffGutterProps,
  type DiffKind
} from './diff-gutter'
export { Drawer, type DrawerProps } from './drawer'
export { DropdownMenu, MenuList, type DropdownMenuProps, type MenuItem } from './dropdown-menu'
export { EmptyState, type EmptyStateProps, type EmptyStateVariant } from './empty-state'
export { Field, type FieldProps } from './field'
export { IconButton, type IconButtonProps } from './icon-button'
export { Input, Textarea, inputBase, type InputProps, type TextareaProps } from './input'
export { Kbd, formatChord, type KbdProps } from './kbd'
export { Label } from './label'
export { Panel, type PanelProps } from './panel'
export { Popover, type Align, type PopoverProps, type Side } from './popover'
export {
  ProgressBar,
  type JobStatus,
  type ProgressBarProps,
  type ProgressState
} from './progress-bar'
export { RadioGroup, type RadioGroupProps, type RadioOption } from './radio-group'
export { ScrollArea, type ScrollAreaProps } from './scroll-area'
export { SearchInput, type SearchInputProps } from './search-input'
export { Select, type SelectOption, type SelectProps } from './select'
export { Skeleton, type SkeletonProps } from './skeleton'
export { Spinner, type SpinnerProps } from './spinner'
export { SplitButton, type SplitButtonProps } from './split-button'
export { SplitPane, type SplitPaneProps } from './split-pane'
export { StatTile, type StatTileProps } from './stat-tile'
export {
  STATUS_ICON,
  StatusDot,
  WARNING_ICON,
  statusTone,
  type StatusDotProps,
  type StatusTone
} from './status-dot'
export { Switch, type SwitchProps } from './switch'
export {
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  type SortDirection,
  type TableDensity,
  type TableProps,
  type TableVariant,
  type TdProps,
  type ThProps,
  type TrProps
} from './table'
export { TabStrip, type DocumentTab, type TabStripProps } from './tab-strip'
export { Tabs, type TabItem, type TabsProps } from './tabs'
export { Toaster, type ToasterProps } from './toast'
export { ToggleGroup, type ToggleGroupProps, type ToggleOption } from './toggle-group'
export { Toolbar, type ToolbarProps } from './toolbar'
export { Tooltip, type TooltipProps } from './tooltip'
export { TreeRow, type TreeRowProps } from './tree-row'
export { useControllable } from './_internal/useControllable'
export { useDismiss } from './_internal/useDismiss'
export { useFloating, type FloatingOptions, type FloatingState } from './_internal/useFloating'
export { useFocusTrap } from './_internal/useFocusTrap'
export { useOverlayContainer, usePortal } from './_internal/usePortal'
export {
  useRovingTabIndex,
  type RovingOptions,
  type RovingState
} from './_internal/useRovingTabIndex'
