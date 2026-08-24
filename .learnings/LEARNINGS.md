
## [LRN-20260824-001] correction

**Logged**: 2026-08-24T22:13:00+07:00
**Priority**: high
**Status**: resolved
**Area**: automation

### Summary
The exact Flow model label is `Veo 3.1 - Lite [Lower Priority]`, not `Low Priority`.

### Details
User explicitly confirmed the current Flow UI label. A prior patch incorrectly changed the stable worker label to `Low Priority`, which breaks exact matching.

### Suggested Action
Keep all worker model aliases and exact checks on `Veo 3.1 - Lite [Lower Priority]` unless verified from captured live DOM.

### Metadata
- Source: user_feedback
- Related Files: apps/flow_auto_electron/payload/scripts/flow_batch_runner.py
- Tags: flow, model-selector, exact-label
