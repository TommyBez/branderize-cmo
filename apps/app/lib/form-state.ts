export type FormState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'success'; readonly message: string }

export const initialFormState: FormState = { kind: 'idle' }
