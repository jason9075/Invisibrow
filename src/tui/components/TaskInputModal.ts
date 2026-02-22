import blessed from 'blessed';

export class TaskInputModal {
  widget: blessed.Widgets.BoxElement;
  textarea: blessed.Widgets.TextareaElement;
  screen: blessed.Widgets.Screen;
  private resolveCallback: ((value: string | null) => void) | null = null;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
    
    this.widget = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: '40%',
      border: { type: 'line' },
      style: {
        border: { fg: 'green' },
        bg: 'black',
        fg: 'white'
      },
      label: ' {bold}New Task{/} ',
      tags: true,
      hidden: true,
      shadow: true
    });

    this.textarea = blessed.textarea({
      parent: this.widget,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      inputOnFocus: true,
      keys: true,
      mouse: true,
      vi: false, 
      style: {
        fg: 'white',
        bg: 'black',
        focus: { bg: 'black' }
      }
    });

    this.setupEvents();
  }

  private setupEvents() {
    // Ctrl+S to Submit
    this.textarea.key(['C-s'], () => {
      this.submit();
    });

    // Escape to Cancel
    this.textarea.key('escape', () => {
      this.cancel();
    });

    // Ctrl+C to Clear
    this.textarea.key(['C-c'], () => {
      this.textarea.setValue('');
      this.screen.render();
    });

  }

  show(initialValue: string = ''): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolveCallback = resolve;
      this.widget.show();
      this.widget.setFront();
      this.textarea.setValue(initialValue);
      this.textarea.focus();
      this.screen.render();
    });
  }

  private submit() {
    const value = this.textarea.getValue();
    this.close(value);
  }

  private cancel() {
    this.close(null);
  }

  private close(value: string | null) {
    this.widget.hide();
    this.textarea.clearValue();
    this.screen.render();
    
    if (this.resolveCallback) {
      this.resolveCallback(value);
      this.resolveCallback = null;
    }
  }
}
