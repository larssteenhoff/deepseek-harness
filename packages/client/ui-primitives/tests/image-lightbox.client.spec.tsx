// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ImageLightbox } from '../src/ImageLightbox.tsx'

afterEach(cleanup)

const labels = { dialog: '原图预览', close: '关闭原图预览' }

describe('ImageLightbox', () => {
  it('focuses the image, closes by Escape, and restores focus', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    const image = view.getByRole('img')
    expect(document.activeElement).toBe(image)
    fireEvent.keyDown(window, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    const outerKey = vi.fn()
    document.body.addEventListener('keydown', outerKey)
    try {
      fireEvent.keyDown(image, { key: 'Escape' })
      expect(outerKey).not.toHaveBeenCalled()
    } finally { document.body.removeEventListener('keydown', outerKey) }
    expect(onClose).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('tolerates a focus owner it cannot restore (no active element at mount)', () => {
    // jsdom always reports body as the fallback active element; stub the
    // element-less state a detached focus can leave.
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null })
    try {
      const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={vi.fn()} />)
      view.unmount()
    } finally {
      delete (document as { activeElement?: unknown }).activeElement
    }
  })

  it('closes when the image is clicked or the mask is pressed', () => {
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    fireEvent.mouseDown(view.getByRole('img'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('img'))
    expect(onClose).toHaveBeenCalledTimes(1)
    const mask = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.mouseDown(mask)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
