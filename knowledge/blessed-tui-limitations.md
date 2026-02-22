# Blessed TUI Library Limitations & Workarounds

## 1. Newline Handling in Textarea
### Issue
The `blessed.textarea` widget has inconsistent behavior across different terminal emulators when trying to trap standard newline combinations.
- **Shift+Space** / **Ctrl+Space**: Often intercepted by the OS or terminal emulator before reaching the application, or sent as a standard space/NUL character.
- **Enter**: By default, `blessed` treats Enter as a newline in a textarea. However, if you want `Enter` to *Submit* the form, you must trap it. If you trap it, you lose the native newline insertion capability unless you manually implement it.

### Workaround
- **Submission**: Bind **Ctrl+S** (or another non-standard key) to submit the form.
- **Newline**: Let the **Enter** key perform its default action (inserting a newline). Do not trap it.
- **Alternative**: If you *must* trap Enter for submission, you need to manually insert `\n` into the buffer. This is complex because `blessed` does not expose a clean public API for inserting text at the cursor position (the internal `editor` object is untyped and risky to rely on).

## 2. Cursor Navigation in Textbox/Textarea
### Issue
- **Arrow Keys**: `blessed` widgets generally handle arrow key navigation natively. However, adding custom key listeners for arrow keys (e.g., `up`, `down`) to a focused input widget can override the native behavior, breaking cursor movement.
- **History Navigation**: If you implement command history (like up/down to cycle previous inputs), you must ensure this logic only activates when appropriate (e.g., single-line inputs) or does not conflict with multi-line navigation.

### Best Practice
- Do **not** manually add listeners for `up`, `down`, `left`, `right` on a `textarea` unless you intend to completely reimplement cursor logic.
- Rely on the widget's built-in navigation.

## 3. Clearing Input
### Issue
Standard `Ctrl+C` behavior in many CLI apps is to exit the process.
### Workaround
- If you want `Ctrl+C` to clear the input field instead:
    ```typescript
    textarea.key(['C-c'], () => {
      textarea.setValue('');
      screen.render();
    });
    ```
- This effectively traps the signal for that specific focused element.

## 4. Modal Focus Management
### Issue
`blessed` does not have a strict "modal" system.
### Workaround
- When showing a "modal" (a box z-indexed to the front), explicitly call `.focus()` on the input element inside it.
- Ensure you handle the `escape` key to hide the modal and return focus to the previous element (e.g., the sidebar or main list).
