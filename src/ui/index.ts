// Barrel for the vendored the shared UI components. At import into the shared UI, DELETE
// src/ui/ and repoint these imports to the shared UI's real modules:
//   Tooltip        → ui/src/pages/tasks/components/Tooltip
//   Modal          → ui/src/components/Modal
//   ConfirmProvider/useConfirm → ui/src/pages/tasks/components/ConfirmProvider
//   ToastProvider/useToast     → ui/src/pages/tasks/components/Toast
export { Tooltip } from './Tooltip'
export { Modal } from './Modal'
export { ConfirmProvider, useConfirm } from './ConfirmProvider'
export { ToastProvider, useToast } from './Toast'
