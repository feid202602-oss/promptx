import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useFloatingPanelPosition(options) {
  const {
    props,
    panelRef,
    onClose,
  } = options

  const panelStyle = ref({
    left: '12px',
    top: '12px',
    width: '560px',
    maxHeight: '420px',
  })
  const panelReady = ref(false)
  const panelPlacement = ref('bottom')

  function closePicker() {
    onClose?.()
  }

  function buildPanelStyle(force = false) {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const margin = 12
    const gap = 8
    const minWidth = 320
    const preferredWidth = 560
    const preferredHeight = 420
    const minHeight = 180
    const width = Math.min(preferredWidth, Math.max(minWidth, viewportWidth - margin * 2))
    const safeWidth = Math.min(width, viewportWidth - margin * 2)
    const anchor = props.anchorRect || {
      left: (viewportWidth - safeWidth) / 2,
      top: viewportHeight / 2,
      bottom: viewportHeight / 2,
    }

    let left = anchor.left
    if (left + safeWidth > viewportWidth - margin) {
      left = viewportWidth - margin - safeWidth
    }
    if (left < margin) {
      left = margin
    }

    const availableBelow = Math.max(0, viewportHeight - margin - (anchor.bottom + gap))
    const availableAbove = Math.max(0, anchor.top - gap - margin)

    if (force) {
      panelPlacement.value = availableBelow >= availableAbove ? 'bottom' : 'top'
    } else if (panelPlacement.value === 'bottom' && availableBelow < minHeight && availableAbove > availableBelow + 24) {
      panelPlacement.value = 'top'
    } else if (panelPlacement.value === 'top' && availableAbove < minHeight && availableBelow > availableAbove + 24) {
      panelPlacement.value = 'bottom'
    }

    const placement = panelPlacement.value
    const selectedSpace = placement === 'bottom' ? availableBelow : availableAbove
    const viewportLimit = Math.max(140, viewportHeight - margin * 2)
    const maxHeight = Math.min(viewportLimit, Math.max(Math.min(preferredHeight, selectedSpace || preferredHeight), minHeight))
    const nextStyle = {
      left: `${Math.round(left)}px`,
      width: `${Math.round(safeWidth)}px`,
      maxHeight: `${Math.round(maxHeight)}px`,
      top: 'auto',
      bottom: 'auto',
    }

    if (placement === 'bottom') {
      nextStyle.top = `${Math.round(Math.max(margin, anchor.bottom + gap))}px`
    } else {
      nextStyle.bottom = `${Math.round(Math.max(margin, viewportHeight - anchor.top + gap))}px`
    }

    return nextStyle
  }

  function updatePanelPosition(force = false) {
    const nextStyle = buildPanelStyle(force)
    panelStyle.value = {
      ...panelStyle.value,
      left: nextStyle.left,
      top: nextStyle.top,
      bottom: nextStyle.bottom,
      width: nextStyle.width,
      maxHeight: nextStyle.maxHeight,
    }
  }

  function initializePanel() {
    if (!props.open || !props.anchorRect) {
      return false
    }

    panelPlacement.value = 'bottom'
    updatePanelPosition(true)
    panelReady.value = true
    return true
  }

  function resetPanel() {
    panelReady.value = false
  }

  function handlePointerDown(event) {
    if (!props.open || !panelRef.value) {
      return
    }

    if (!panelRef.value.contains(event.target)) {
      closePicker()
    }
  }

  onMounted(() => {
    document.addEventListener('pointerdown', handlePointerDown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', handlePointerDown)
  })

  return {
    closePicker,
    initializePanel,
    panelReady,
    panelStyle,
    resetPanel,
    updatePanelPosition,
  }
}
