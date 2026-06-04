import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

class ZedFixEditor extends CustomEditor {
  handleInput(data: string): void {
    if (data === "\x1b\r" || data === "\x1b[13;3u") {
      super.handleInput("\n");
      return;
    }

    super.handleInput(data);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if ((process.env.TERM_PROGRAM ?? "").toLowerCase() !== "zed") {
      return;
    }

    ctx.ui.setEditorComponent((tui, theme, keybindings) => new ZedFixEditor(tui, theme, keybindings));
  });
}
