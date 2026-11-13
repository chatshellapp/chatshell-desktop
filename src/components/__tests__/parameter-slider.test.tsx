import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ParameterSlider } from '@/components/parameter-slider'

// The Radix slider measures itself with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const limits = { min: -2, max: 2, step: 0.1, defaultValue: 0.7 }

describe('ParameterSlider', () => {
  it('accepts zero instead of falling back to the default', () => {
    const onChange = vi.fn()
    render(<ParameterSlider label="Temperature" value={1} onChange={onChange} {...limits} />)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), {
      target: { value: '0' },
    })

    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('clamps typed values to the limits', () => {
    const onChange = vi.fn()
    render(<ParameterSlider label="Penalty" value={0} onChange={onChange} {...limits} />)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Penalty' }), {
      target: { value: '9' },
    })

    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('shows the unset label and a switch for optional parameters', () => {
    const onEnabledChange = vi.fn()
    render(
      <ParameterSlider
        label="Top P"
        value={undefined}
        onChange={vi.fn()}
        enabled={false}
        onEnabledChange={onEnabledChange}
        unsetLabel="Provider default"
        {...limits}
      />
    )

    expect(screen.getByText('Provider default')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Top P' }))
    expect(onEnabledChange).toHaveBeenCalledWith(true)
  })
})
