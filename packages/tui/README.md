# @yaroslavlky/mink-tui

Ink interface for the shared Mink engine. The package owns interaction and presentation; `@yaroslavlky/mink-core` owns validation, planning, process execution, and service lifetime.

## Structure

- `app.tsx`: composition root, navigation, draft selection, and coordination of user actions.
- `hooks/use-session.ts`: invocation state, cancellation, process events, service snapshots, and throttled refresh.
- `hooks/use-project-state.ts`: favorites, history, and presets through the core facade.
- `hooks/use-parameter-form.ts`: typed input progression and conditional field visibility.
- `hooks/use-terminal-size.ts`: terminal resize subscription.
- `model/`: pure command ranking, masked previews, plan/result projections, and a bounded UTF-8 log buffer.
- `screens/`: palette, parameter form, execution review, output, services, and presets. Each screen owns its local keyboard interactions.
- `components/`: shared frame, bordered panels, input, status/type badges, command details, workflow steps, and scrollable logs.
- `theme.ts`: common colors and status semantics.
- `actions.ts`: explicit OS clipboard/browser actions and safe terminal text.
- `index.tsx`: Ink mount/unmount and foreground stdin/signal lifetime.

Screens use typed view data and callbacks. They do not spawn commands or write state files. Command execution remains behind the core facade. Buffering and projection logic can be tested without React; keyboard and layout behavior use the Ink renderer.

## Interaction

Tab cycles through Commands → Output → Services; Shift+Tab cycles in reverse. Search, selection, and unfinished form input survive tab changes. Only the visible screen handles keyboard input; Ctrl+B moves to the previous parameter within a form. Ctrl+P opens commands, Ctrl+O returns to output, and Ctrl+S opens owned services. The active section and focused panel use cyan; tasks, pipelines, and services have distinct badges. Ready/success is green, errors are red, and cancellation/warnings are yellow. Borders and text labels preserve meaning without color.

At 100+ columns, the palette, output, and services use a split layout. Smaller terminals stack the panels. The minimum interactive viewport is 48 × 20. The mouse wheel over the log pane scrolls three lines at a time; reaching the bottom resumes live output. PageUp/PageDown scroll logs and pause following; End resumes live output. Preview displays dependency relationships rather than implying that every step runs sequentially.

Run locally from the repository root after `pnpm build:packages`:

```sh
node packages/cli/dist/index.js ui --no-discovery
```
