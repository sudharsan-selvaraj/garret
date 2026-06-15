import { z } from 'zod'

/**
 * Declarative config fields. A widget describes its configuration once here, and
 * the framework derives BOTH the settings form UI and runtime validation from it.
 * This is what keeps "add a widget" near-zero-config.
 */
export type FieldType = 'text' | 'url' | 'password' | 'number' | 'boolean' | 'select'

export interface FieldBase {
  type: FieldType
  label: string
  required?: boolean
  help?: string
  placeholder?: string
  default?: unknown
}

export interface SelectField extends FieldBase {
  type: 'select'
  options: { label: string; value: string }[]
}

export type Field = FieldBase | SelectField

/** Map of config key → field descriptor. */
export type ConfigSchema = Record<string, Field>

type Opts<T extends Field> = Omit<T, 'type'>

/** Ergonomic builders so plugins read declaratively: `field.url({ label: '…' })`. */
export const field = {
  text: (o: Opts<FieldBase>): FieldBase => ({ type: 'text', ...o }),
  url: (o: Opts<FieldBase>): FieldBase => ({ type: 'url', ...o }),
  password: (o: Opts<FieldBase>): FieldBase => ({ type: 'password', ...o }),
  number: (o: Opts<FieldBase>): FieldBase => ({ type: 'number', ...o }),
  boolean: (o: Opts<FieldBase>): FieldBase => ({ type: 'boolean', ...o }),
  select: (o: Opts<SelectField>): SelectField => ({ type: 'select', ...o })
}

/** Build a zod validator from a config schema (single source of truth). */
export function zodFromSchema(schema: ConfigSchema): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {}
  for (const [key, f] of Object.entries(schema)) {
    let zt: z.ZodTypeAny
    switch (f.type) {
      case 'url':
        zt = z.string().url()
        break
      case 'number':
        zt = z.coerce.number()
        break
      case 'boolean':
        zt = z.boolean()
        break
      default:
        zt = z.string()
    }
    // Optional fields also accept empty string (cleared input).
    shape[key] = f.required ? zt : zt.optional().or(z.literal(''))
  }
  return z.object(shape)
}

/** Default config object derived from a schema's `default`s / empty values. */
export function defaultConfig(schema: ConfigSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, f] of Object.entries(schema)) {
    out[key] = f.default ?? (f.type === 'boolean' ? false : '')
  }
  return out
}
