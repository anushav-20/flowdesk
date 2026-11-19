import { describe, expect, it } from 'vitest'
import { compose, email, isChecked, maxLength, minLength, required, validate } from './validators'

describe('validators', () => {
  it('required rejects empty and whitespace-only values', () => {
    expect(required('x')('')).toBe('x')
    expect(required('x')('   ')).toBe('x')
    expect(required('x')('hi')).toBe('')
  })

  it.each([
    ['name@company.com', true],
    ['a.b+tag@sub.domain.io', true],
    ['missing-at.com', false],
    ['no@tld', false],
    ['spaces in@mail.com', false],
  ])('email(%s) valid=%s', (value, valid) => {
    expect(email()(value) === '').toBe(valid)
  })

  it('length validators allow empty values (pair with required)', () => {
    expect(minLength(3)('')).toBe('')
    expect(minLength(3)('ab')).not.toBe('')
    expect(maxLength(3)('abcd')).not.toBe('')
  })

  it('isChecked requires an explicit true', () => {
    expect(isChecked('no')(false)).toBe('no')
    expect(isChecked('no')(true)).toBe('')
  })

  it('compose returns the first failing message', () => {
    const v = compose(required('needed'), minLength(5, 'too short'))
    expect(v('')).toBe('needed')
    expect(v('abc')).toBe('too short')
    expect(v('abcdef')).toBe('')
  })

  it('validate builds an errors object for a schema', () => {
    const schema = { a: required('A'), b: required('B') }
    expect(validate(schema, { a: 'x', b: '' })).toEqual({ b: 'B' })
  })
})
