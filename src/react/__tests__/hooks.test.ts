import { DocumentStore } from '../../core/store'
import { useDocument } from '../'
import { renderHook, act } from '@testing-library/react'

describe('useDocument', () => {
  it('should return null for a document that does not exist', () => {
    const store = new DocumentStore()
    const { result } = renderHook(() => useDocument(store, 'user', '1'))
    expect(result.current).toBeNull()
  })
})
