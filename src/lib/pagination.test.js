import { describe, expect, it } from 'vitest'
import { getPageItems } from './pagination'

describe('getPageItems', () => {
  it('lists every page when there are few', () => {
    expect(getPageItems(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('collapses distant pages into ellipses', () => {
    expect(getPageItems(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20])
  })

  it('handles the edges without duplicate pages', () => {
    expect(getPageItems(1, 20)).toEqual([1, 2, '…', 20])
    expect(getPageItems(20, 20)).toEqual([1, '…', 19, 20])
  })
})
