import { watch } from 'vue'
import { useFloatingPanelPosition } from './useFloatingPanelPosition.js'
import { useWorkspacePickerData } from './useWorkspacePickerData.js'

export function useWorkspaceTree(options) {
  const {
    props,
    panelRef,
    onClose,
    onSelect,
  } = options

  const {
    closePicker,
    initializePanel,
    panelReady,
    panelStyle,
    resetPanel,
    updatePanelPosition,
  } = useFloatingPanelPosition({
    props,
    panelRef,
    onClose,
  })

  const pickerData = useWorkspacePickerData({
    props,
    onSelect,
  })

  watch(
    () => props.open,
    (open) => {
      if (!open) {
        pickerData.resetData()
        resetPanel()
        return
      }

      resetPanel()
      if (!props.anchorRect) {
        return
      }

      if (initializePanel()) {
        pickerData.initializeData()
      }
    },
    { flush: 'sync' }
  )

  watch(
    () => props.anchorRect,
    (anchorRect) => {
      if (!props.open || !anchorRect) {
        return
      }

      if (!panelReady.value) {
        if (initializePanel()) {
          pickerData.initializeData()
        }
        return
      }

      updatePanelPosition(false)
    },
    { flush: 'sync' }
  )

  watch(
    () => props.sessionId,
    () => {
      pickerData.handleSessionChange()
    },
    { flush: 'sync', immediate: true }
  )

  watch(
    () => props.query,
    () => {
      pickerData.handleQueryChange()
    },
    { immediate: true }
  )

  watch(
    pickerData.visibleItems,
    () => {
      pickerData.handleVisibleItemsChange()
    },
    { immediate: true }
  )

  watch(
    () => pickerData.activeKey.value,
    () => {
      pickerData.handleVisibleItemsChange()
    }
  )

  return {
    ...pickerData,
    closePicker,
    panelReady,
    panelStyle,
  }
}
