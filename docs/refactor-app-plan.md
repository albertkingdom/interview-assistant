# App Refactor Plan

## Goal
- Reduce `src/App.jsx` complexity and split responsibilities into reusable modules.
- Keep behavior stable during refactor (no intentional feature change).
- Make future changes safer with smaller, testable units.

## Current Pain Points
- `App.jsx` mixes UI rendering, speech engine orchestration, API calls, storage, and formatting.
- High coupling between state/refs and side effects makes debugging race conditions difficult.
- Large inline styles reduce readability and make responsive maintenance harder.

## Refactor Principles
- Keep each phase small and reversible.
- Prefer extraction of pure functions first, then side-effect services, then hooks/components.
- Every phase must pass `npm run lint` and `npm run build`.

## Phases

### Phase 0: Baseline Guardrail
- Create a manual smoke-check list:
  - setup flow
  - quick 3-step interview flow
  - background AI analysis
  - markdown export
  - speech engine switching (browser/openai realtime)
- Outcome: behavior baseline before structural changes.
- Suggested commit:
  - `chore(refactor): add baseline checklist for app modularization`

### Phase 1: Extract Pure Utils
- Move pure helpers from `App.jsx` to `src/utils`:
  - transcript/text merge helpers
  - AI JSON parse/repair helpers
  - record markdown formatting helpers
- Outcome: shrink `App.jsx` helper block and improve reusability.
- Suggested commit:
  - `refactor(utils): extract transcript json and markdown helpers`

### Phase 2: Extract Services
- Move side-effect logic to `src/services`:
  - AI analyze API request
  - records localStorage persistence
  - keep realtime session API unified
- Outcome: `App.jsx` stops handling low-level IO details.
- Suggested commit:
  - `refactor(services): isolate api and storage side effects`

### Phase 3: Extract Hooks
- Create domain hooks:
  - `useInterviewFlow`
  - `useSpeechController`
  - `useAiAnalysis`
- Outcome: logic lifecycle is encapsulated and easier to reason about.
- Suggested commit:
  - `refactor(hooks): split interview flow speech controller and ai analysis`

### Phase 4: Split UI Components
- Create focused components:
  - `SetupScreen`
  - `InterviewHeader`
  - `ConversationHistory`
  - `InterviewInputPanel`
  - `AnalysisSidebar`
- Outcome: `App.jsx` becomes composition entry point.
- Suggested commit:
  - `refactor(components): split app into focused presentational components`

### Phase 5: Style and Responsive Consolidation
- Replace large inline style duplication with shared style tokens/modules.
- Keep dynamic styles inline only when needed.
- Outcome: cleaner JSX and easier UI iteration.
- Suggested commit:
  - `refactor(styles): centralize responsive layout tokens and shared styles`

### Phase 6: Final Cleanup
- Remove dead code and normalize naming.
- Update README architecture section.
- Final smoke check and release notes.
- Suggested commit:
  - `refactor(app): finalize modular architecture and docs`

## Done Criteria
- `src/App.jsx` reduced to high-level orchestration + composition.
- No known regression in baseline flows.
- `npm run lint` and `npm run build` pass in each phase.
