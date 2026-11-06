/** Runtime-neutral DTOs shared by the native observer and external OS sender, without Node or Gecko dependencies. */
/** Only form navigation, text replacement and closing the official preferences window need modifiers. */
export interface JourneyStroke { key: string; modifiers: readonly ('Shift_L' | 'Control_L')[] }
/** Initial setup may assign focus; continuation must observe existing native ownership. */
export type JourneyFocus = 'assign' | 'require';
